import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    static let aiConsentKey = "kabuyomi.aiConsentGranted"
    static let devUnlimitedModeKey = "kabuyomi.devUnlimitedModeEnabled"
    static let savedTickersKey = "kabuyomi.savedTickers"
    static let recentTickersKey = "kabuyomi.recentTickers"
    static let lastViewedTickerKey = "kabuyomi.lastViewedTicker"
    static let activeConversationTickerKey = "kabuyomi.activeConversationTicker"
    static let showStarterCompaniesKey = "kabuyomi.showStarterCompanies"
    static let hasCompletedInitialEntryKey = "kabuyomi.hasCompletedInitialEntry"
    static let pendingConversationTickerKey = "kabuyomi.pendingConversationTicker"
    static let pendingConversationQuestionKey = "kabuyomi.pendingConversationQuestion"
    static let appLaunchCountKey = "kabuyomi.appLaunchCount"
    static let starterCompaniesAutoHiddenKey = "kabuyomi.starterCompaniesAutoHidden"
    static let starterCompaniesAutoHideLaunchThreshold = 5

    let apiClient: APIClient
    let persistence: PersistenceController
    let deviceIdentity: DeviceIdentityStore

    var watchlist: [WatchlistCard] = []
    var recentCompanies: [WatchlistCard] = []
    var searchResults: [SearchItem] = []
    var usage: UsagePayload?
    var companyCache: [String: CompanyPayload] = [:]
    var chatHistoryCache: [String: [LocalChatMessage]] = [:]
    var lastViewedTicker = UserDefaults.standard.string(forKey: "kabuyomi.lastViewedTicker")
    var activeConversationTicker = UserDefaults.standard.string(forKey: "kabuyomi.activeConversationTicker")

    var isBootstrapped = false
    var searchIsLoading = false
    var companyIsLoading = false
    var chatIsSending = false
    var activeAlert: AppAlertState?
    var aiConsentGranted = UserDefaults.standard.bool(forKey: "kabuyomi.aiConsentGranted")
    var showStarterCompanies = UserDefaults.standard.object(forKey: "kabuyomi.showStarterCompanies") as? Bool ?? true
    var hasCompletedInitialEntry = UserDefaults.standard.bool(forKey: "kabuyomi.hasCompletedInitialEntry")
    var appLaunchCount = UserDefaults.standard.integer(forKey: "kabuyomi.appLaunchCount")
    #if DEBUG
    var devUnlimitedModeEnabled = UserDefaults.standard.bool(forKey: "kabuyomi.devUnlimitedModeEnabled")
    #else
    let devUnlimitedModeEnabled = false
    #endif

    private var searchGeneration = 0
    private var addingTickers: Set<String> = []
    private var savedTickers = AppModel.normalizedTickers(UserDefaults.standard.stringArray(forKey: "kabuyomi.savedTickers") ?? [])
    private var recentTickers = AppModel.normalizedTickers(UserDefaults.standard.stringArray(forKey: "kabuyomi.recentTickers") ?? [])
    private var pendingConversationTicker = UserDefaults.standard.string(forKey: "kabuyomi.pendingConversationTicker")
    private var pendingConversationQuestion = UserDefaults.standard.string(forKey: "kabuyomi.pendingConversationQuestion")
    private var starterCompaniesAutoHidden = UserDefaults.standard.bool(forKey: "kabuyomi.starterCompaniesAutoHidden")

    init(
        apiClient: APIClient,
        persistence: PersistenceController,
        deviceIdentity: DeviceIdentityStore
    ) {
        self.apiClient = apiClient
        self.persistence = persistence
        self.deviceIdentity = deviceIdentity
    }

    static func live() -> AppModel {
        AppModel(
            apiClient: APIClient(),
            persistence: PersistenceController.shared,
            deviceIdentity: .shared
        )
    }

    var starterCompanies: [StarterCompany] {
        StarterCompany.defaults
    }

    var rootConversationTicker: String {
        activeConversationTicker
            ?? lastViewedTicker
            ?? savedTickers.first
            ?? starterCompanies.first?.ticker
            ?? "AAPL"
    }

    var shouldShowConversationEntry: Bool {
        !hasCompletedInitialEntry
        && savedTickers.isEmpty
        && recentTickers.isEmpty
        && lastViewedTicker == nil
        && activeConversationTicker == nil
    }

    func bootstrap() async {
        isBootstrapped = false
        defer {
            isBootstrapped = true
        }

        recordAppLaunch()
        loadHomeFromPersistence()
        await refreshUsage()
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
        guard item.isSupportedInV1 else {
            activeAlert = AppAlertState(
                message: item.unsupportedAlertMessage,
                kind: .dismissOnly
            )
            return
        }
        await saveTicker(item.ticker, searchItem: item, redirectToConversation: true)
    }

    func saveTicker(_ ticker: String) async {
        await saveTicker(ticker, searchItem: nil, redirectToConversation: false)
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
            let deviceKey = quotaDeviceKey(purpose: forceRefresh ? "company-refresh-\(ticker)" : "company-\(ticker)")
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
                message: "AI チャットの利用前に、質問内容と SEC filing コンテキストを Gemini に送信することへの同意が必要です。\n個人情報や口座情報は入力しないでください。",
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
                deviceKey: quotaDeviceKey(purpose: "chat-\(ticker)")
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

    func setAIConsent(_ value: Bool) {
        aiConsentGranted = value
        UserDefaults.standard.set(value, forKey: Self.aiConsentKey)
    }

    func setShowStarterCompanies(_ value: Bool) {
        showStarterCompanies = value
        UserDefaults.standard.set(value, forKey: Self.showStarterCompaniesKey)
    }

    #if DEBUG
    func setDevUnlimitedMode(_ value: Bool) {
        devUnlimitedModeEnabled = value
        UserDefaults.standard.set(value, forKey: Self.devUnlimitedModeKey)
        Task {
            await refreshUsage()
        }
    }
    #endif

    func confirmAIConsent() {
        setAIConsent(true)
        dismissAlert()
    }

    func companyPayload(for ticker: String) -> CompanyPayload? {
        companyCache[ticker] ?? persistence.loadCompany(ticker: ticker)?.company
    }

    func openConversation(for ticker: String, draftQuestion: String? = nil) {
        let normalized = normalizedTicker(ticker)
        completeInitialEntry()
        activeConversationTicker = normalized
        pendingConversationTicker = draftQuestion == nil ? nil : normalized
        pendingConversationQuestion = draftQuestion?.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
        UserDefaults.standard.set(pendingConversationTicker, forKey: Self.pendingConversationTickerKey)
        UserDefaults.standard.set(pendingConversationQuestion, forKey: Self.pendingConversationQuestionKey)
    }

    func consumePendingDraftQuestion(for ticker: String) -> String? {
        let normalized = normalizedTicker(ticker)
        guard pendingConversationTicker == normalized else { return nil }

        let question = pendingConversationQuestion?.trimmingCharacters(in: .whitespacesAndNewlines)
        pendingConversationTicker = nil
        pendingConversationQuestion = nil
        UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
        UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
        return question?.isEmpty == false ? question : nil
    }

    func isTickerInWatchlist(_ ticker: String) -> Bool {
        savedTickers.contains(normalizedTicker(ticker))
    }

    func isAddingTicker(_ ticker: String) -> Bool {
        addingTickers.contains(normalizedTicker(ticker))
    }

    func chatHistory(for ticker: String) -> [LocalChatMessage] {
        if let cached = chatHistoryCache[ticker] {
            return cached
        }
        return persistence.loadCompany(ticker: ticker)?.chatHistory ?? []
    }

    func recordCompanyVisit(ticker: String) {
        guard let company = companyPayload(for: ticker) else { return }

        let normalized = normalizedTicker(ticker)
        completeInitialEntry()
        lastViewedTicker = normalized
        UserDefaults.standard.set(normalized, forKey: Self.lastViewedTickerKey)
        activeConversationTicker = normalized
        UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
        setLastSeenFilingKey(company.filingKey, for: normalized)

        recentTickers.removeAll(where: { $0 == normalized })
        recentTickers.insert(normalized, at: 0)
        recentTickers = Array(recentTickers.prefix(10))
        UserDefaults.standard.set(recentTickers, forKey: Self.recentTickersKey)

        loadHomeFromPersistence()
    }

    func hasNewFiling(for card: WatchlistCard) -> Bool {
        guard let lastSeen = UserDefaults.standard.string(forKey: lastSeenFilingKeyKey(for: card.ticker)) else {
            return false
        }
        return lastSeen != card.filingKey
    }

    func recentCompanyCards(limit: Int, includeSaved: Bool = false) -> [WatchlistCard] {
        let filteredTickers = includeSaved ? recentTickers : recentTickers.filter { !savedTickers.contains($0) }
        return Array(orderedCards(for: filteredTickers).prefix(limit))
    }

    func dismissAlert() {
        activeAlert = nil
    }

    func resetLocalData() {
        do {
            try persistence.reset()
            watchlist = []
            recentCompanies = []
            companyCache = [:]
            chatHistoryCache = [:]
            savedTickers = []
            recentTickers = []
            lastViewedTicker = nil
            activeConversationTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.savedTickersKey)
            UserDefaults.standard.removeObject(forKey: Self.recentTickersKey)
            UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.hasCompletedInitialEntryKey)
            UserDefaults.standard.removeObject(forKey: Self.appLaunchCountKey)
            UserDefaults.standard.removeObject(forKey: Self.starterCompaniesAutoHiddenKey)
            hasCompletedInitialEntry = false
            appLaunchCount = 0
            pendingConversationTicker = nil
            pendingConversationQuestion = nil
            starterCompaniesAutoHidden = false
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
            clearCompanyNavigationState()
        } catch {
            activeAlert = AppAlertState(message: error.localizedDescription, kind: .dismissOnly)
        }
    }

    func removeFromWatchlist(_ ticker: String) {
        let normalized = normalizedTicker(ticker)
        savedTickers.removeAll(where: { $0 == normalized })
        UserDefaults.standard.set(savedTickers, forKey: Self.savedTickersKey)
        loadHomeFromPersistence()
    }

    var isDevUnlimitedModeActive: Bool {
        #if DEBUG
        return devUnlimitedModeEnabled
        #else
        return false
        #endif
    }

    var devUnlimitedModeDescription: String {
        "DEBUG 専用の無限チャット / 無限保存モードです。TestFlight / Release では必ず外してください。"
    }

    func displayPlanLabel(for usage: UsagePayload) -> String {
        isDevUnlimitedModeActive ? "DEV∞" : usage.displayPlanLabel
    }

    func displayChatLimit(for usage: UsagePayload) -> String {
        isDevUnlimitedModeActive ? "∞" : usage.displayChatLimit
    }

    func displayStockLimit(for usage: UsagePayload) -> String {
        isDevUnlimitedModeActive ? "∞" : usage.displayStockLimit
    }

    private func saveTicker(_ ticker: String, searchItem: SearchItem?, redirectToConversation: Bool) async {
        let normalized = normalizedTicker(ticker)
        guard !addingTickers.contains(normalized) else { return }

        if isTickerInWatchlist(normalized) {
            if redirectToConversation {
                openConversation(for: normalized)
            }
            activeAlert = AppAlertState(
                message: "\(normalized) はすでに保存済みです。",
                kind: .dismissOnly
            )
            return
        }

        addingTickers.insert(normalized)
        defer { addingTickers.remove(normalized) }

        do {
            let result = try await apiClient.addToWatchlist(
                ticker: normalized,
                deviceKey: quotaDeviceKey(purpose: "bookmark-add-\(normalized)")
            )
            try persistence.saveCompany(result.company, searchItem: searchItem)
            usage = result.usage
            companyCache[normalized] = result.company
            chatHistoryCache[normalized] = persistence.loadCompany(ticker: normalized)?.chatHistory ?? []
            completeInitialEntry()
            savedTickers.removeAll(where: { $0 == normalized })
            savedTickers.insert(normalized, at: 0)
            savedTickers = Array(savedTickers.prefix(25))
            UserDefaults.standard.set(savedTickers, forKey: Self.savedTickersKey)
            setLastSeenFilingKey(result.company.filingKey, for: normalized)
            activeConversationTicker = normalized
            UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
            loadHomeFromPersistence()

            if redirectToConversation {
                openConversation(for: normalized)
            }
        } catch {
            handle(error)
        }
    }

    private func refreshUsage() async {
        do {
            usage = try await apiClient.fetchUsage(
                deviceKey: quotaDeviceKey(purpose: "usage")
            )
        } catch {
            guard !shouldIgnore(error) else { return }
            if usage == nil {
                presentAlert(for: error)
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
        let nsError = error as NSError
        if let urlError = error as? URLError, urlError.code == .timedOut {
            return "通信に時間がかかりすぎています。少し待ってから、もう一度試してください。"
        }

        if nsError.domain == NSURLErrorDomain && nsError.code == URLError.timedOut.rawValue {
            return "通信に時間がかかりすぎています。少し待ってから、もう一度試してください。"
        }

        let rawMessage = rawMessage(for: error)
        let normalizedMessage = rawMessage.lowercased()

        if normalizedMessage.contains("timed out") {
            return "通信に時間がかかりすぎています。少し待ってから、もう一度試してください。"
        }

        if rawMessage.contains("Daily chat quota exceeded") {
            return "本日のベータ版チャット上限に達しました。日付が変わってから再度お試しください。"
        }

        if rawMessage.contains("Watchlist limit exceeded") {
            return "現在のベータ版保存銘柄上限に達しました。"
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
        watchlist = orderedCards(for: savedTickers)
        recentCompanies = orderedCards(for: recentTickers.filter { !savedTickers.contains($0) })
    }

    private func orderedCards(for tickers: [String]) -> [WatchlistCard] {
        let cards = persistence.loadCompanyCards(tickers: tickers)
        let byTicker = Dictionary(uniqueKeysWithValues: cards.map { ($0.ticker, $0) })
        return tickers.compactMap { byTicker[$0] }
    }

    private func lastSeenFilingKeyKey(for ticker: String) -> String {
        "kabuyomi.lastSeenFiling.\(normalizedTicker(ticker))"
    }

    private func setLastSeenFilingKey(_ filingKey: String, for ticker: String) {
        UserDefaults.standard.set(filingKey, forKey: lastSeenFilingKeyKey(for: ticker))
    }

    private func clearCompanyNavigationState() {
        let defaults = UserDefaults.standard
        for key in defaults.dictionaryRepresentation().keys {
            if key.hasPrefix("kabuyomi.lastSeenFiling.") {
                defaults.removeObject(forKey: key)
            }
        }
    }

    private func completeInitialEntry() {
        guard !hasCompletedInitialEntry else { return }
        hasCompletedInitialEntry = true
        UserDefaults.standard.set(true, forKey: Self.hasCompletedInitialEntryKey)
    }

    private func recordAppLaunch() {
        appLaunchCount += 1
        UserDefaults.standard.set(appLaunchCount, forKey: Self.appLaunchCountKey)

        guard hasCompletedInitialEntry,
              !starterCompaniesAutoHidden,
              showStarterCompanies,
              appLaunchCount >= Self.starterCompaniesAutoHideLaunchThreshold else { return }

        starterCompaniesAutoHidden = true
        UserDefaults.standard.set(true, forKey: Self.starterCompaniesAutoHiddenKey)
        setShowStarterCompanies(false)
    }

    private func normalizedTicker(_ ticker: String) -> String {
        ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    private static func normalizedTickers(_ tickers: [String]) -> [String] {
        var seen = Set<String>()
        return tickers.compactMap { ticker in
            let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard !normalized.isEmpty, seen.insert(normalized).inserted else { return nil }
            return normalized
        }
    }

    private func quotaDeviceKey(purpose: String) -> String {
        if isDevUnlimitedModeActive {
            return "dev-unlimited-\(purpose)-\(UUID().uuidString)"
        }
        return deviceIdentity.deviceKey()
    }
}
