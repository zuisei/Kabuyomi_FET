import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    static let publicMonetizationEnabled = false
    static let billingSyncEnabled = false

    let apiClient: APIClient
    let persistence: PersistenceController
    let deviceIdentity: DeviceIdentityStore
    let subscriptionStore: SubscriptionStore

    var watchlist: [WatchlistCard] = []
    var searchResults: [SearchItem] = []
    var usage: UsagePayload?
    var companyCache: [String: CompanyPayload] = [:]
    var chatHistoryCache: [String: [LocalChatMessage]] = [:]

    var homeIsLoading = false
    var searchIsLoading = false
    var companyIsLoading = false
    var chatIsSending = false
    var purchaseIsRunning = false
    var activeAlert: AppAlertState?
    var aiConsentGranted = UserDefaults.standard.bool(forKey: "kabuyomi.aiConsentGranted")

    private var subscriptionObservationTask: Task<Void, Never>?
    private var searchGeneration = 0

    static let aiConsentKey = "kabuyomi.aiConsentGranted"

    init(
        apiClient: APIClient,
        persistence: PersistenceController,
        deviceIdentity: DeviceIdentityStore,
        subscriptionStore: SubscriptionStore
    ) {
        self.apiClient = apiClient
        self.persistence = persistence
        self.deviceIdentity = deviceIdentity
        self.subscriptionStore = subscriptionStore
    }

    static func live() -> AppModel {
        AppModel(
            apiClient: APIClient(),
            persistence: PersistenceController.shared,
            deviceIdentity: .shared,
            subscriptionStore: .shared
        )
    }

    func bootstrap() async {
        homeIsLoading = true
        defer { homeIsLoading = false }

        if Self.billingSyncEnabled {
            startSubscriptionObservationIfNeeded()
        }
        loadHomeFromPersistence()
        if Self.billingSyncEnabled {
            await subscriptionStore.refreshEntitlements(reason: "bootstrap")
            await syncSubscriptionIfNeeded()
        }
        await refreshUsage()
    }

    func refreshHome() async {
        homeIsLoading = true
        defer { homeIsLoading = false }

        loadHomeFromPersistence()
        await refreshWatchlistFromServer()
        await refreshUsage()
        loadHomeFromPersistence()
    }

    func search(query: String) async {
        searchGeneration += 1
        let generation = searchGeneration
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            if generation == searchGeneration {
                searchResults = []
                searchIsLoading = false
            }
            return
        }

        searchIsLoading = true

        do {
            let results = try await apiClient.search(query: trimmed)
                .sorted(by: { left, right in
                    let leftScore = searchScore(for: left, query: trimmed)
                    let rightScore = searchScore(for: right, query: trimmed)

                    if leftScore != rightScore {
                        return leftScore < rightScore
                    }

                    if left.ticker.count != right.ticker.count {
                        return left.ticker.count < right.ticker.count
                    }

                    return left.ticker.localizedCaseInsensitiveCompare(right.ticker) == .orderedAscending
                })
            guard generation == searchGeneration else { return }
            searchResults = results
        } catch {
            guard generation == searchGeneration else { return }
            handle(error)
        }

        if generation == searchGeneration {
            searchIsLoading = false
        }
    }

    func addToWatchlist(_ item: SearchItem) async {
        do {
            let result = try await apiClient.addToWatchlist(
                ticker: item.ticker,
                deviceKey: deviceIdentity.deviceKey()
            )
            try persistence.saveCompany(result.company, searchItem: item)
            usage = result.usage
            companyCache[item.ticker] = result.company
            loadHomeFromPersistence()
        } catch {
            handle(error)
        }
    }

    func loadCompany(ticker: String, forceRefresh: Bool = false) async {
        if !forceRefresh, companyCache[ticker] != nil {
            return
        }

        if let local = persistence.loadCompany(ticker: ticker) {
            companyCache[ticker] = local.company
            chatHistoryCache[ticker] = local.chatHistory
        }

        companyIsLoading = true
        defer { companyIsLoading = false }

        do {
            let deviceKey = deviceIdentity.deviceKey()
            let company = try await (
                forceRefresh
                    ? apiClient.refreshCompany(ticker: ticker, deviceKey: deviceKey)
                    : apiClient.fetchCompany(ticker: ticker, deviceKey: deviceKey)
            )
            try persistence.saveCompany(company, searchItem: nil)
            companyCache[ticker] = company
            chatHistoryCache[ticker] = persistence.loadCompany(ticker: ticker)?.chatHistory ?? []
            loadHomeFromPersistence()
        } catch {
            guard !shouldIgnore(error) else { return }
            if companyCache[ticker] == nil {
                presentAlert(for: error)
            }
        }
    }

    func sendChat(question: String, ticker: String) async -> Bool {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        guard aiConsentGranted else {
            activeAlert = AppAlertState(
                message: "AI チャットの利用前に、質問内容と SEC filing コンテキストを Gemini に送信することへの同意が必要です。",
                kind: .aiConsent
            )
            return false
        }
        guard let company = companyCache[ticker] ?? persistence.loadCompany(ticker: ticker)?.company else {
            activeAlert = AppAlertState(message: "企業データを先に読み込んでください。", kind: .dismissOnly)
            return false
        }

        chatIsSending = true
        defer { chatIsSending = false }

        do {
            let response = try await apiClient.sendChat(
                filingKey: company.filingKey,
                question: trimmed,
                deviceKey: deviceIdentity.deviceKey()
            )
            try persistence.saveChat(question: trimmed, response: response, for: company)
            usage = response.usage
            chatHistoryCache[ticker] = persistence.loadCompany(ticker: ticker)?.chatHistory ?? []
            return true
        } catch {
            handle(error)
            return false
        }
    }

    func purchasePro() async {
        guard Self.publicMonetizationEnabled else {
            activeAlert = AppAlertState(message: "課金機能は現在の beta では無効です。", kind: .dismissOnly)
            return
        }
        purchaseIsRunning = true
        defer { purchaseIsRunning = false }

        do {
            let didPurchase = try await subscriptionStore.purchasePro()
            guard didPurchase else { return }
            await syncSubscriptionIfNeeded()
            await refreshUsage()
        } catch {
            handle(error)
        }
    }

    func restorePurchases() async {
        guard Self.publicMonetizationEnabled else {
            activeAlert = AppAlertState(message: "購読復元は現在の beta では無効です。", kind: .dismissOnly)
            return
        }
        do {
            try await subscriptionStore.restorePurchases()
            await syncSubscriptionIfNeeded()
            await refreshUsage()
        } catch {
            handle(error)
        }
    }

    func syncSubscriptionIfNeeded() async {
        guard Self.billingSyncEnabled else { return }
        do {
            guard let syncRequest = try await subscriptionStore.syncRequestIfAvailable() else { return }
            let response = try await apiClient.syncBilling(syncRequest)
            subscriptionStore.apply(response)
            await refreshUsage()
        } catch {
            handle(error)
        }
    }

    func setAIConsent(_ value: Bool) {
        aiConsentGranted = value
        UserDefaults.standard.set(value, forKey: Self.aiConsentKey)
    }

    func confirmAIConsent() {
        setAIConsent(true)
        dismissAlert()
    }

    func companyPayload(for ticker: String) -> CompanyPayload? {
        companyCache[ticker] ?? persistence.loadCompany(ticker: ticker)?.company
    }

    func chatHistory(for ticker: String) -> [LocalChatMessage] {
        if let cached = chatHistoryCache[ticker] {
            return cached
        }
        return persistence.loadCompany(ticker: ticker)?.chatHistory ?? []
    }

    func dismissAlert() {
        activeAlert = nil
    }

    func resetLocalData() {
        do {
            try persistence.reset()
            watchlist = []
            companyCache = [:]
            chatHistoryCache = [:]
        } catch {
            activeAlert = AppAlertState(message: error.localizedDescription, kind: .dismissOnly)
        }
    }

    var currentPlan: String {
        if !Self.publicMonetizationEnabled {
            return "beta"
        }
        return usage?.plan ?? subscriptionStore.plan
    }

    var shouldShowUpgradeButton: Bool {
        Self.publicMonetizationEnabled && currentPlan != "pro"
    }

    private func refreshUsage() async {
        do {
            usage = try await apiClient.fetchUsage(
                deviceKey: deviceIdentity.deviceKey()
            )
        } catch {
            guard !shouldIgnore(error) else { return }
            if usage == nil {
                presentAlert(for: error)
            }
        }
    }

    private func refreshWatchlistFromServer() async {
        let tickers = Array(Set(watchlist.map(\.ticker))).sorted()
        guard !tickers.isEmpty else { return }

        for ticker in tickers {
            do {
                let company = try await apiClient.refreshCompany(
                    ticker: ticker,
                    deviceKey: deviceIdentity.deviceKey()
                )
                try persistence.saveCompany(company, searchItem: nil)
                companyCache[ticker] = company
                chatHistoryCache[ticker] = persistence.loadCompany(ticker: ticker)?.chatHistory ?? []
            } catch {
                guard !shouldIgnore(error) else { continue }
            }
        }
    }

    private func startSubscriptionObservationIfNeeded() {
        guard subscriptionObservationTask == nil else { return }

        subscriptionObservationTask = Task { [weak self] in
            guard let self else { return }

            for await _ in NotificationCenter.default.notifications(named: .kabuyomiSubscriptionStateDidChange) {
                await self.syncSubscriptionIfNeeded()
            }
        }
    }

    private func handle(_ error: Error) {
        guard !shouldIgnore(error) else { return }
        presentAlert(for: error)
    }

    private func presentAlert(for error: Error) {
        activeAlert = AppAlertState(
            message: presentableMessage(for: error),
            kind: .dismissOnly
        )
    }

    private func shouldIgnore(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }

        if let urlError = error as? URLError, urlError.code == .cancelled {
            return true
        }

        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == URLError.cancelled.rawValue
    }

    private func presentableMessage(for error: Error) -> String {
        let rawMessage = rawMessage(for: error)

        if rawMessage.contains("Daily chat quota exceeded") {
            return "本日のベータ版チャット上限に達しました。日付が変わってから再度お試しください。"
        }

        if rawMessage.contains("Watchlist limit exceeded") {
            return "現在のベータ版ウォッチ銘柄上限に達しました。"
        }

        if rawMessage.contains("No supported filing found") {
            return "この銘柄の最新開示は v1 の対応範囲外です。Kabuyomi v1 は 10-K / 10-Q のみ対応しており、20-F / 6-K はまだ未対応です。"
        }

        if rawMessage.contains("Ticker not found") {
            return "ティッカーが見つかりませんでした。"
        }

        if rawMessage.contains("SEC data is temporarily unavailable") {
            return "SEC データを現在取得できません。しばらくしてから再度お試しください。"
        }

        if rawMessage.contains("Failed to extract MD&A section") {
            return "本文抽出に失敗しました。時間を置いて再試行するか、原文を直接確認してください。"
        }

        if rawMessage.contains("under maintenance") {
            return "現在メンテナンス中です。しばらくしてから再度お試しください。"
        }

        return rawMessage
    }

    private func rawMessage(for error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .invalidResponse:
                return "レスポンスを解釈できませんでした。"
            case .server(let message):
                return message
            }
        }

        return error.localizedDescription
    }

    private func searchScore(for item: SearchItem, query: String) -> Int {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let ticker = item.ticker.lowercased()
        let companyName = item.companyName.lowercased()

        if ticker == normalizedQuery {
            return 0
        }

        if ticker.hasPrefix(normalizedQuery) {
            return 1
        }

        if companyName == normalizedQuery {
            return 2
        }

        if companyName.hasPrefix(normalizedQuery) {
            return 3
        }

        if ticker.contains(normalizedQuery) {
            return 4
        }

        if companyName.contains(normalizedQuery) {
            return 5
        }

        return 6
    }

    private func loadHomeFromPersistence() {
        watchlist = persistence.loadWatchlistCards()
    }
}
