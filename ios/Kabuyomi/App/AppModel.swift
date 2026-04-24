import Foundation
import Observation

struct PendingChatState: Equatable {
    let id: UUID
    let ticker: String
    let question: String
    let submittedAt: Date

    init(id: UUID = UUID(), ticker: String, question: String, submittedAt: Date = .now) {
        self.id = id
        self.ticker = ticker
        self.question = question
        self.submittedAt = submittedAt
    }

    var optimisticUserMessage: LocalChatMessage {
        LocalChatMessage(
            id: id,
            role: "user",
            content: question,
            createdAt: submittedAt,
            modelName: "local",
            sources: []
        )
    }
}

enum UsageLoadState {
    case idle
    case loading
    case loaded
    case failed
}

private enum UsageUpdateSource {
    case refresh
    case chat
    case watchlistAdd
    case watchlistRemove
}

@MainActor
@Observable
final class AppModel {
    private let minimumPendingChatDuration: TimeInterval = 1.0
    private static let isRunningTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil

    static let aiConsentKey = "kabuyomi.aiConsentGranted"
    static let aiConsentAlertMessage = """
AI 利用前に、質問内容と対象の決算資料の抜粋を外部 AI モデルへ送信することへの同意が必要です。
個人情報や口座情報は入力しないでください。
"""
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
    #if DEBUG
    static let devModeEnabledKey = "kabuyomi.detachedAccess.devModeEnabled"
    #endif

    let apiClient: APIClient
    let persistence: PersistenceController
    let deviceIdentity: DeviceIdentityStore
    private let subscriptionStore: SubscriptionStore

    var watchlist: [WatchlistCard] = []
    var recentCompanies: [WatchlistCard] = []
    var searchResults: [SearchItem] = []
    var searchErrorMessage: String?
    var usage: UsagePayload?
    var usageLoadState: UsageLoadState = .idle
    var companyCache: [String: CompanyPayload] = [:]
    var companyLoadStates: [String: CompanyLoadStatePayload] = [:]
    var chatHistoryCache: [String: [LocalChatMessage]] = [:]
    var pendingChats: [String: PendingChatState] = [:]
    var lastViewedTicker = UserDefaults.standard.string(forKey: "kabuyomi.lastViewedTicker")
    var activeConversationTicker = UserDefaults.standard.string(forKey: "kabuyomi.activeConversationTicker")

    var isBootstrapped = false
    var searchIsLoading = false
    var companyIsLoading = false
    var chatIsSending = false
    var billingActionInFlight = false
    var activeAlert: AppAlertState?
    var aiConsentGranted = UserDefaults.standard.bool(forKey: "kabuyomi.aiConsentGranted")
    var showStarterCompanies = UserDefaults.standard.object(forKey: "kabuyomi.showStarterCompanies") as? Bool ?? true
    var hasCompletedInitialEntry = UserDefaults.standard.bool(forKey: "kabuyomi.hasCompletedInitialEntry")
    var appLaunchCount = UserDefaults.standard.integer(forKey: "kabuyomi.appLaunchCount")
    #if DEBUG
    var devModeEnabled = UserDefaults.standard.bool(forKey: "kabuyomi.detachedAccess.devModeEnabled")
    #endif

    private var searchGeneration = 0
    private var stateGeneration = 0
    private var addingTickers: Set<String> = []
    private var loadingTickers: Set<String> = []
    private var accessRevokedTickers: Set<String> = []
    private var refreshedTickersThisSession: Set<String> = []
    private var companyRetryTasks: [String: Task<Void, Never>] = [:]
    private var watchlistMutationInFlight = false
    private var watchlistMutationWaiters: [CheckedContinuation<Void, Never>] = []
    private var usageMutationGeneration = 0
    private var subscriptionStateObserver: NSObjectProtocol?
    private var savedTickers = AppModel.normalizedTickers(UserDefaults.standard.stringArray(forKey: "kabuyomi.savedTickers") ?? [])
    private var recentTickers = AppModel.normalizedTickers(UserDefaults.standard.stringArray(forKey: "kabuyomi.recentTickers") ?? [])
    private var pendingConversationTicker = UserDefaults.standard.string(forKey: "kabuyomi.pendingConversationTicker")
    private var pendingConversationQuestion = UserDefaults.standard.string(forKey: "kabuyomi.pendingConversationQuestion")
    private var starterCompaniesAutoHidden = UserDefaults.standard.bool(forKey: "kabuyomi.starterCompaniesAutoHidden")

    init(
        apiClient: APIClient,
        persistence: PersistenceController,
        deviceIdentity: DeviceIdentityStore,
        subscriptionStore: SubscriptionStore = .shared
    ) {
        self.apiClient = apiClient
        self.persistence = persistence
        self.deviceIdentity = deviceIdentity
        self.subscriptionStore = subscriptionStore
        self.subscriptionStateObserver = NotificationCenter.default.addObserver(
            forName: .kabuyomiSubscriptionStateDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.syncBillingState(showErrors: false)
                await self.refreshUsage()
            }
        }
    }

    static func live() -> AppModel {
        let deviceIdentity = DeviceIdentityStore.shared
        return AppModel(
            apiClient: APIClient(
                deviceIdentity: deviceIdentity
            ),
            persistence: PersistenceController.shared,
            deviceIdentity: deviceIdentity,
            subscriptionStore: .shared
        )
    }

    var starterCompanies: [StarterCompany] {
        StarterCompany.defaults
    }

    var rootConversationTicker: String {
        activeConversationTicker
            ?? lastViewedTicker
            ?? firstRestorableSavedTicker
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

    var currentBillingTier: BillingTier {
        let resolvedPlan = usage?.plan ?? (subscriptionStore.isSubscriptionActive ? BillingCatalog.pro.plan : BillingCatalog.free.plan)
        return BillingCatalog.tier(for: resolvedPlan)
    }

    var isProPlanActive: Bool {
        currentBillingTier.plan == BillingCatalog.pro.plan
    }

    var currentPlanBadgeTitle: String {
        usage?.displayPlanLabel ?? currentBillingTier.badgeTitle
    }

    var isDetachedDevAccessActive: Bool {
        usage?.detachedAccessMode == .devUnlimited
    }

    var currentPlanBadgeSystemImage: String {
        if isDetachedDevAccessActive {
            return "hammer.fill"
        }
        return isProPlanActive ? "crown.fill" : "bolt.badge.a"
    }

    var currentPlanBadgeUsesAccent: Bool {
        isProPlanActive || isDetachedDevAccessActive
    }

    var currentAPIBaseURLDisplay: String {
        apiClient.baseURLDisplayString
    }

    var currentDeviceKeyDisplay: String {
        deviceIdentity.deviceKey()
    }

    func bootstrap() async {
        isBootstrapped = false

        sanitizeRestoredConversationState()
        recordAppLaunch()
        loadHomeFromPersistence()
        isBootstrapped = true
        usageLoadState = .loading

        Task { [weak self] in
            guard let self else { return }
            if !Self.isRunningTests {
                await self.subscriptionStore.refreshEntitlements(reason: "bootstrap")
                await self.syncBillingState(showErrors: false)
            }
            await self.refreshUsage()
        }
    }

    func purchasePro() async {
        guard !billingActionInFlight else { return }
        billingActionInFlight = true
        defer { billingActionInFlight = false }

        do {
            let isActive = try await subscriptionStore.purchasePro()
            guard isActive else { return }
            await syncBillingState(showErrors: true)
            await refreshUsage()
        } catch {
            handle(error)
        }
    }

    func restorePurchases() async {
        guard !billingActionInFlight else { return }
        billingActionInFlight = true
        defer { billingActionInFlight = false }

        do {
            try await subscriptionStore.restorePurchases()
            await syncBillingState(showErrors: true)
            await refreshUsage()

            if !subscriptionStore.isSubscriptionActive {
                activeAlert = AppAlertState(
                    message: "復元できる Pro 購読は見つかりませんでした。",
                    kind: .dismissOnly
                )
            }
        } catch {
            handle(error)
        }
    }

    #if DEBUG
    func setDevModeEnabled(_ value: Bool) {
        let store = DetachedAccessStore.shared
        store.setDevModeEnabled(value)
        devModeEnabled = value
        Task { [weak self] in
            await self?.refreshUsage()
        }
    }
    #endif

    func search(query: String) async {
        let stateGeneration = self.stateGeneration
        searchGeneration += 1
        let generation = searchGeneration
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            if stateGeneration == self.stateGeneration, generation == searchGeneration {
                searchResults = []
                searchErrorMessage = nil
                searchIsLoading = false
            }
            return
        }

        searchIsLoading = true
        searchErrorMessage = nil

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
            guard stateGeneration == self.stateGeneration, generation == searchGeneration else { return }
            searchResults = results
            searchErrorMessage = nil
        } catch {
            guard stateGeneration == self.stateGeneration, generation == searchGeneration else { return }
            searchResults = []
            searchErrorMessage = shouldIgnore(error) ? nil : presentableMessage(for: error)
        }

        if stateGeneration == self.stateGeneration, generation == searchGeneration {
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

    func saveSearchResult(_ item: SearchItem) async {
        guard item.isSupportedInV1 else {
            activeAlert = AppAlertState(
                message: item.unsupportedAlertMessage,
                kind: .dismissOnly
            )
            return
        }
        await saveTicker(item.ticker, searchItem: item, redirectToConversation: false)
    }

    func saveTicker(_ ticker: String) async {
        await saveTicker(ticker, searchItem: nil, redirectToConversation: false)
    }

    func prefetchCompany(ticker: String) {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return }
        guard companyCache[normalized] == nil, !loadingTickers.contains(normalized) else { return }

        Task {
            await loadCompany(ticker: normalized)
        }
    }

    func loadCompany(ticker: String, forceRefresh: Bool = false) async {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return }

        if !forceRefresh, companyCache[normalized] != nil {
            return
        }

        if let local = persistence.loadCompany(ticker: normalized) {
            companyCache[normalized] = local.company
            chatHistoryCache[normalized] = local.chatHistory

            if !forceRefresh {
                refreshCompanyInBackgroundIfNeeded(ticker: normalized)
                return
            }
        }

        if !forceRefresh,
           let state = companyLoadStates[normalized],
           shouldRetryCompanyLoadState(state.status) {
            scheduleCompanyLoadRetry(ticker: normalized, state: state)
            return
        }

        await fetchCompanyRemote(ticker: normalized, forceRefresh: forceRefresh)
    }

    func sendChat(question: String, ticker: String) async -> Bool {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let normalized = normalizedTicker(ticker)
        let stateGeneration = self.stateGeneration
        guard aiConsentGranted else {
            requestAIConsent()
            return false
        }
        guard let company = companyPayload(for: normalized) else {
            activeAlert = AppAlertState(message: "企業データを先に読み込んでください。", kind: .dismissOnly)
            return false
        }

        let pendingStartedAt = Date()
        pendingChats[normalized] = PendingChatState(ticker: normalized, question: trimmed)
        chatIsSending = true
        defer {
            finishPendingChat(ticker: normalized, stateGeneration: stateGeneration)
        }

        do {
            let response = try await apiClient.sendChat(
                filingKey: company.filingKey,
                question: trimmed
            )
            guard stateGeneration == self.stateGeneration else {
                await ensureMinimumPendingChatDuration(since: pendingStartedAt)
                return false
            }
            try persistence.saveChat(question: trimmed, response: response, for: company)
            storeUsage(response.usage, source: .chat)
            chatHistoryCache[normalized] = persistence.loadCompany(ticker: normalized)?.chatHistory ?? []
            await ensureMinimumPendingChatDuration(since: pendingStartedAt)
            return true
        } catch {
            guard stateGeneration == self.stateGeneration else {
                await ensureMinimumPendingChatDuration(since: pendingStartedAt)
                return false
            }
            handle(error)
            await ensureMinimumPendingChatDuration(since: pendingStartedAt)
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

    func confirmAIConsent() {
        setAIConsent(true)
        dismissAlert()
    }

    func companyPayload(for ticker: String) -> CompanyPayload? {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return nil }
        return companyCache[normalized] ?? persistence.loadCompany(ticker: normalized)?.company
    }

    func companyLoadState(for ticker: String) -> CompanyLoadStatePayload? {
        companyLoadStates[normalizedTicker(ticker)]
    }

    func isCompanyLoading(_ ticker: String) -> Bool {
        loadingTickers.contains(normalizedTicker(ticker))
    }

    func openConversation(for ticker: String, draftQuestion: String? = nil) {
        let normalized = normalizedTicker(ticker)
        let trimmedDraft = draftQuestion?.trimmingCharacters(in: .whitespacesAndNewlines)
        completeInitialEntry()
        activeConversationTicker = normalized
        pendingConversationTicker = trimmedDraft == nil ? nil : normalized
        pendingConversationQuestion = trimmedDraft
        if shouldPersistConversationSelection(ticker: normalized, draftQuestion: trimmedDraft) {
            UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
        }
        UserDefaults.standard.set(pendingConversationTicker, forKey: Self.pendingConversationTickerKey)
        UserDefaults.standard.set(pendingConversationQuestion, forKey: Self.pendingConversationQuestionKey)
        prefetchCompany(ticker: normalized)
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

    func isTickerInWatchlist(_ ticker: String, cik: String? = nil) -> Bool {
        savedTicker(for: ticker, cik: cik) != nil
    }

    func isAddingTicker(_ ticker: String) -> Bool {
        addingTickers.contains(normalizedTicker(ticker))
    }

    func chatHistory(for ticker: String) -> [LocalChatMessage] {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return [] }
        if let cached = chatHistoryCache[normalized] {
            return cached
        }
        return persistence.loadCompany(ticker: normalized)?.chatHistory ?? []
    }

    func pendingChat(for ticker: String) -> PendingChatState? {
        pendingChats[normalizedTicker(ticker)]
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

    private func ensureMinimumPendingChatDuration(since startedAt: Date) async {
        let elapsed = Date().timeIntervalSince(startedAt)
        guard elapsed < minimumPendingChatDuration else { return }

        let remainingNanoseconds = UInt64((minimumPendingChatDuration - elapsed) * 1_000_000_000)
        try? await Task.sleep(nanoseconds: remainingNanoseconds)
    }

    func hasNewFiling(for card: WatchlistCard) -> Bool {
        guard let lastSeen = UserDefaults.standard.string(forKey: lastSeenFilingKeyKey(for: card.ticker)) else {
            return false
        }
        return lastSeen != card.filingKey
    }

    func recentCompanyCards(limit: Int, includeSaved: Bool = false) -> [WatchlistCard] {
        let filteredTickers = includeSaved ? recentTickers : recentTickers.filter { !isTickerInWatchlist($0) }
        return Array(orderedCards(for: filteredTickers).prefix(limit))
    }

    func dismissAlert() {
        activeAlert = nil
    }

    func requestAIConsent() {
        activeAlert = AppAlertState(
            message: Self.aiConsentAlertMessage,
            kind: .aiConsent
        )
    }

    func requestResetLocalDataConfirmation() {
        activeAlert = AppAlertState(
            message: """
保存済みデータと会話履歴をこの端末から削除します。
取得済みの決算資料も消え、利用状況は新規ユーザー状態に戻る可能性があります。
端末識別情報は再生成され、最初からやり直す状態に戻ります。
""",
            kind: .resetConfirmation
        )
    }

    func confirmResetLocalData() {
        dismissAlert()
        resetLocalData()
    }

    func resetLocalData() {
        do {
            stateGeneration += 1
            searchGeneration += 1
            try persistence.reset()
            deviceIdentity.reset()
            watchlist = []
            recentCompanies = []
            searchResults = []
            searchErrorMessage = nil
            usage = nil
            usageLoadState = .loading
            companyCache = [:]
            companyLoadStates = [:]
            chatHistoryCache = [:]
            pendingChats = [:]
            addingTickers = []
            loadingTickers = []
            cancelAllCompanyLoadRetries()
            accessRevokedTickers = []
            refreshedTickersThisSession = []
            savedTickers = []
            recentTickers = []
            lastViewedTicker = nil
            activeConversationTicker = nil
            searchIsLoading = false
            companyIsLoading = false
            chatIsSending = false
            UserDefaults.standard.removeObject(forKey: Self.savedTickersKey)
            UserDefaults.standard.removeObject(forKey: Self.recentTickersKey)
            UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.hasCompletedInitialEntryKey)
            UserDefaults.standard.removeObject(forKey: Self.appLaunchCountKey)
            UserDefaults.standard.removeObject(forKey: Self.starterCompaniesAutoHiddenKey)
            UserDefaults.standard.removeObject(forKey: Self.aiConsentKey)
            UserDefaults.standard.set(true, forKey: Self.showStarterCompaniesKey)
            hasCompletedInitialEntry = false
            appLaunchCount = 0
            showStarterCompanies = true
            aiConsentGranted = false
            pendingConversationTicker = nil
            pendingConversationQuestion = nil
            starterCompaniesAutoHidden = false
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
            clearCompanyNavigationState()
            loadHomeFromPersistence()

            Task {
                await refreshUsage()
            }
        } catch {
            usageLoadState = .failed
            activeAlert = AppAlertState(message: error.localizedDescription, kind: .dismissOnly)
        }
    }

    func removeFromWatchlist(_ ticker: String) async {
        let normalized = normalizedTicker(ticker)
        await acquireWatchlistMutationLock()
        defer { releaseWatchlistMutationLock() }
        guard !addingTickers.contains(normalized) else { return }
        let stateGeneration = self.stateGeneration

        addingTickers.insert(normalized)
        defer { finishTickerMutation(ticker: normalized, stateGeneration: stateGeneration) }

        do {
            let result = try await apiClient.removeFromWatchlist(
                ticker: normalized
            )
            guard stateGeneration == self.stateGeneration else { return }
            storeUsage(result.usage, source: .watchlistRemove)
            if result.usage.savedTickers == nil {
                applyLocalWatchlistRemovalFallback(for: normalized)
                loadHomeFromPersistence()
            }
        } catch {
            guard stateGeneration == self.stateGeneration else { return }
            handle(error)
        }
    }

    func displayPlanLabel(for usage: UsagePayload) -> String {
        usage.displayPlanLabel
    }

    func displayChatLimit(for usage: UsagePayload) -> String {
        usage.displayChatLimit
    }

    func displayStockLimit(for usage: UsagePayload) -> String {
        usage.displayStockLimit
    }

    private func saveTicker(_ ticker: String, searchItem: SearchItem?, redirectToConversation: Bool) async {
        let normalized = normalizedTicker(ticker)
        await acquireWatchlistMutationLock()
        defer { releaseWatchlistMutationLock() }
        guard !addingTickers.contains(normalized) else { return }
        let stateGeneration = self.stateGeneration

        if isTickerInWatchlist(normalized, cik: searchItem?.cik) {
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
        defer { finishTickerMutation(ticker: normalized, stateGeneration: stateGeneration) }

        do {
            let result = try await apiClient.addToWatchlist(
                ticker: normalized
            )
            guard stateGeneration == self.stateGeneration else { return }

            if let company = result.company {
                try handleReadyWatchlistAdd(
                    company: company,
                    requestedTicker: normalized,
                    searchItem: searchItem,
                    usage: result.usage,
                    redirectToConversation: redirectToConversation
                )
            } else if let loadState = result.loadState {
                handlePendingWatchlistAdd(
                    loadState: loadState,
                    requestedTicker: normalized,
                    searchItem: searchItem,
                    usage: result.usage,
                    redirectToConversation: redirectToConversation
                )
            } else {
                throw APIError.invalidResponse
            }
        } catch {
            guard stateGeneration == self.stateGeneration else { return }
            handle(error)
        }
    }

    private func handleReadyWatchlistAdd(
        company: CompanyPayload,
        requestedTicker: String,
        searchItem: SearchItem?,
        usage: UsagePayload,
        redirectToConversation: Bool
    ) throws {
        let savedTicker = normalizedTicker(company.ticker)
        try persistence.saveCompany(company, searchItem: searchItem)
        companyCache.removeValue(forKey: requestedTicker)
        companyLoadStates.removeValue(forKey: requestedTicker)
        chatHistoryCache.removeValue(forKey: requestedTicker)
        companyCache[savedTicker] = company
        companyLoadStates.removeValue(forKey: savedTicker)
        chatHistoryCache[savedTicker] = persistence.loadCompany(ticker: savedTicker)?.chatHistory ?? []
        accessRevokedTickers.remove(requestedTicker)
        accessRevokedTickers.remove(savedTicker)
        completeInitialEntry()
        storeUsage(usage, source: .watchlistAdd)
        if usage.savedTickers == nil {
            applyLocalWatchlistAddFallback(savedTicker: savedTicker, cik: company.cik)
        }
        setLastSeenFilingKey(company.filingKey, for: savedTicker)
        loadHomeFromPersistence()

        if redirectToConversation {
            activeConversationTicker = savedTicker
            UserDefaults.standard.set(savedTicker, forKey: Self.activeConversationTickerKey)
            openConversation(for: savedTicker)
        }
    }

    private func handlePendingWatchlistAdd(
        loadState: CompanyLoadStatePayload,
        requestedTicker: String,
        searchItem: SearchItem?,
        usage: UsagePayload,
        redirectToConversation: Bool
    ) {
        let savedTicker = normalizedTicker(loadState.ticker)
        accessRevokedTickers.remove(requestedTicker)
        accessRevokedTickers.remove(savedTicker)
        companyLoadStates[requestedTicker] = loadState
        companyLoadStates[savedTicker] = loadState
        scheduleCompanyLoadRetry(ticker: savedTicker, state: loadState)
        completeInitialEntry()
        storeUsage(usage, source: .watchlistAdd)
        if usage.savedTickers == nil {
            applyLocalWatchlistAddFallback(savedTicker: savedTicker, cik: loadState.cik ?? searchItem?.cik)
        }
        loadHomeFromPersistence()

        if redirectToConversation {
            activeConversationTicker = savedTicker
            UserDefaults.standard.set(savedTicker, forKey: Self.activeConversationTickerKey)
            openConversation(for: savedTicker)
        }
    }

    private func refreshUsage() async {
        let stateGeneration = self.stateGeneration
        let usageGeneration = usageMutationGeneration
        usageLoadState = .loading
        do {
            let usage = try await apiClient.fetchUsage()
            guard stateGeneration == self.stateGeneration else { return }
            guard usageGeneration == usageMutationGeneration else { return }
            storeUsage(usage, source: .refresh)
            usageLoadState = .loaded
        } catch {
            guard stateGeneration == self.stateGeneration else { return }
            guard !shouldIgnore(error) else { return }
            usageLoadState = .failed
            if usage == nil {
                presentAlert(for: error)
            }
        }
    }

    private func refreshCompanyInBackgroundIfNeeded(ticker: String) {
        guard !loadingTickers.contains(ticker), !refreshedTickersThisSession.contains(ticker) else { return }
        guard !isLocalAccessRevoked(for: ticker) else { return }

        Task {
            await fetchCompanyRemote(ticker: ticker, forceRefresh: false)
        }
    }

    private func fetchCompanyRemote(ticker: String, forceRefresh: Bool) async {
        guard !loadingTickers.contains(ticker), !isLocalAccessRevoked(for: ticker) else { return }
        let stateGeneration = self.stateGeneration

        loadingTickers.insert(ticker)
        companyIsLoading = true
        defer {
            finishCompanyLoad(ticker: ticker, stateGeneration: stateGeneration)
        }

        do {
            let response = try await (
                forceRefresh
                    ? apiClient.refreshCompany(
                        ticker: ticker
                    )
                    : apiClient.fetchCompany(
                        ticker: ticker
                    )
            )
            guard stateGeneration == self.stateGeneration else { return }
            guard !isLocalAccessRevoked(for: ticker) else { return }
            switch response {
            case .company(let company):
                try handleLoadedCompany(company, requestedTicker: ticker)
            case .retryable(let state):
                companyLoadStates[ticker] = state
                scheduleCompanyLoadRetry(ticker: ticker, state: state)
            }
        } catch {
            guard stateGeneration == self.stateGeneration else { return }
            guard !shouldIgnore(error) else { return }
            let recoveredSelection = clearUnavailableEphemeralSelectionIfNeeded(for: ticker)
            if companyCache[ticker] == nil, !recoveredSelection {
                presentAlert(for: error)
            }
        }
    }

    private func handleLoadedCompany(_ company: CompanyPayload, requestedTicker: String) throws {
        let normalizedCompanyTicker = normalizedTicker(company.ticker)
        let shouldPersist = !company.isStaleReady

        if shouldPersist {
            try persistence.saveCompany(company, searchItem: nil)
            companyLoadStates.removeValue(forKey: requestedTicker)
            companyLoadStates.removeValue(forKey: normalizedCompanyTicker)
            cancelCompanyLoadRetry(for: requestedTicker)
            cancelCompanyLoadRetry(for: normalizedCompanyTicker)
        } else {
            companyLoadStates[requestedTicker] = CompanyLoadStatePayload(
                status: .staleReady,
                ticker: company.ticker,
                companyName: company.companyName,
                cik: company.cik,
                message: nil,
                statusMessage: company.statusMessage,
                retryAfterSeconds: company.retryAfterSeconds
            )
        }

        companyCache[requestedTicker] = company
        companyCache[normalizedCompanyTicker] = company
        chatHistoryCache[requestedTicker] = persistence.loadCompany(ticker: requestedTicker)?.chatHistory ?? []
        chatHistoryCache[normalizedCompanyTicker] = persistence.loadCompany(ticker: normalizedCompanyTicker)?.chatHistory ?? []
        accessRevokedTickers.remove(requestedTicker)
        accessRevokedTickers.remove(normalizedCompanyTicker)
        if shouldPersist {
            refreshedTickersThisSession.insert(requestedTicker)
            refreshedTickersThisSession.insert(normalizedCompanyTicker)
        }
        loadHomeFromPersistence()
    }

    private func scheduleCompanyLoadRetry(ticker: String, state: CompanyLoadStatePayload) {
        let normalized = normalizedTicker(ticker)
        guard shouldRetryCompanyLoadState(state.status) else { return }
        guard companyCache[normalized] == nil, !loadingTickers.contains(normalized), !isLocalAccessRevoked(for: normalized) else { return }

        companyRetryTasks[normalized]?.cancel()
        let delay = companyRetryDelay(for: state)
        companyRetryTasks[normalized] = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.retryCompanyLoadIfStillPending(ticker: normalized)
        }
    }

    private func retryCompanyLoadIfStillPending(ticker: String) async {
        let normalized = normalizedTicker(ticker)
        companyRetryTasks[normalized] = nil
        guard companyCache[normalized] == nil else { return }
        guard !loadingTickers.contains(normalized), !isLocalAccessRevoked(for: normalized) else { return }
        guard let state = companyLoadStates[normalized], shouldRetryCompanyLoadState(state.status) else { return }

        await fetchCompanyRemote(ticker: normalized, forceRefresh: false)
    }

    private func shouldRetryCompanyLoadState(_ status: CompanyLoadStatus) -> Bool {
        status == .preparing || status == .failedRetryable
    }

    private func companyRetryDelay(for state: CompanyLoadStatePayload) -> Duration {
        let seconds = state.retryAfterSeconds ?? (state.status == .preparing ? 2 : 30)
        if seconds <= 0 {
            return .milliseconds(50)
        }

        switch state.status {
        case .preparing:
            return .seconds(min(seconds, 5))
        case .failedRetryable:
            return .seconds(min(max(seconds, 10), 60))
        case .ready, .staleReady:
            return .seconds(seconds)
        }
    }

    private func cancelCompanyLoadRetry(for ticker: String) {
        let normalized = normalizedTicker(ticker)
        companyRetryTasks[normalized]?.cancel()
        companyRetryTasks.removeValue(forKey: normalized)
    }

    private func cancelAllCompanyLoadRetries() {
        for task in companyRetryTasks.values {
            task.cancel()
        }
        companyRetryTasks = [:]
    }

    private func handle(_ error: Error) {
        guard !shouldIgnore(error) else { return }
        presentAlert(for: error)
    }

    private func finishPendingChat(ticker: String, stateGeneration: Int) {
        guard stateGeneration == self.stateGeneration else { return }
        pendingChats.removeValue(forKey: ticker)
        chatIsSending = !pendingChats.isEmpty
    }

    private func finishTickerMutation(ticker: String, stateGeneration: Int) {
        guard stateGeneration == self.stateGeneration else { return }
        addingTickers.remove(ticker)
    }

    private func finishCompanyLoad(ticker: String, stateGeneration: Int) {
        guard stateGeneration == self.stateGeneration else { return }
        loadingTickers.remove(ticker)
        companyIsLoading = !loadingTickers.isEmpty
    }

    private func acquireWatchlistMutationLock() async {
        if !watchlistMutationInFlight {
            watchlistMutationInFlight = true
            return
        }

        await withCheckedContinuation { continuation in
            watchlistMutationWaiters.append(continuation)
        }
    }

    private func releaseWatchlistMutationLock() {
        if let next = watchlistMutationWaiters.first {
            watchlistMutationWaiters.removeFirst()
            next.resume()
            return
        }

        watchlistMutationInFlight = false
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
            return "本日のチャット上限に達しました。日付が変わってから再度お試しください。"
        }

        if rawMessage.contains("Watchlist limit exceeded") {
            return "現在の保存銘柄上限に達しました。"
        }

        if rawMessage.contains("Ticker access requires watchlist add") {
            return "この銘柄は先に保存してから開いてください。スターター銘柄以外の直接表示はできません。"
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

        if rawMessage.contains("Chat response is temporarily unavailable") || rawMessage.contains("Internal server error") {
            return "チャット応答を現在生成できません。少し待ってから、もう一度お試しください。"
        }

        if rawMessage.contains("Chat is temporarily disabled") {
            return "現在チャット機能を一時停止しています。しばらくしてから再度お試しください。"
        }

        if rawMessage.contains("Filing cache not found") {
            return "表示中の決算データが古くなりました。企業画面を再読み込みしてから、もう一度お試しください。"
        }

        if rawMessage.contains("Device key is required") || rawMessage.contains("Client identity is unavailable") {
            return "端末識別情報の初期化に失敗しました。アプリを再起動してから、もう一度お試しください。"
        }

        if rawMessage.contains("Quota request failed") {
            return "利用状況の確認に失敗しました。少し待ってから、もう一度お試しください。"
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

    private func storeUsage(_ usage: UsagePayload, source: UsageUpdateSource) {
        if source != .refresh {
            usageMutationGeneration += 1
        }
        let effectiveUsage = mergeUsageSavedTickersIfNeeded(usage, source: source)
        self.usage = effectiveUsage
        guard let serverTickers = effectiveUsage.savedTickers else { return }
        reconcileSavedTickers(with: serverTickers)
    }

    private func mergeUsageSavedTickersIfNeeded(_ usage: UsagePayload, source: UsageUpdateSource) -> UsagePayload {
        guard source == .watchlistAdd else { return usage }
        guard let serverTickers = usage.savedTickers else { return usage }

        let mergedTickers = mergedSavedTickersPreservingServerOrder(
            serverTickers: serverTickers,
            existingTickers: savedTickers
        )
        guard mergedTickers != Self.normalizedTickers(serverTickers) || usage.stocksUsed != mergedTickers.count else {
            return usage
        }

        return UsagePayload(
            plan: usage.plan,
            chatsUsed: usage.chatsUsed,
            chatLimit: usage.chatLimit,
            stocksUsed: mergedTickers.count,
            stockLimit: usage.stockLimit,
            dateJST: usage.dateJST,
            savedTickers: mergedTickers,
            accessMode: usage.accessMode
        )
    }

    private func mergedSavedTickersPreservingServerOrder(serverTickers: [String], existingTickers: [String]) -> [String] {
        var mergedTickers = Self.normalizedTickers(serverTickers)
        var seenIssuerKeys = savedIssuerKeys(for: mergedTickers)

        for ticker in Self.normalizedTickers(existingTickers) {
            let issuerKey = issuerGroupKey(for: ticker)
            guard seenIssuerKeys.insert(issuerKey).inserted else { continue }
            mergedTickers.append(ticker)
        }

        return mergedTickers
    }

    private func reconcileSavedTickers(with serverTickers: [String]) {
        let normalizedServerTickers = Self.normalizedTickers(serverTickers)
        let previousSavedTickers = savedTickers
        let removedIssuerKeys = savedIssuerKeys(for: previousSavedTickers)
            .subtracting(savedIssuerKeys(for: normalizedServerTickers))

        savedTickers = normalizedServerTickers
        UserDefaults.standard.set(savedTickers, forKey: Self.savedTickersKey)

        for issuerKey in savedIssuerKeys(for: normalizedServerTickers) {
            for ticker in relatedTickers(forIssuerGroupKey: issuerKey, additionalTickers: normalizedServerTickers) {
                accessRevokedTickers.remove(ticker)
            }
        }

        for issuerKey in removedIssuerKeys {
            for ticker in relatedTickers(forIssuerGroupKey: issuerKey, additionalTickers: previousSavedTickers) {
                guard shouldRevokeLocalAccessWithoutWatchlist(for: ticker) else {
                    accessRevokedTickers.remove(ticker)
                    continue
                }
                revokeLocalAccess(for: ticker)
            }
        }

        loadHomeFromPersistence()
        hydrateMissingWatchlistCompanies(for: normalizedServerTickers)
    }

    private func hydrateMissingWatchlistCompanies(for tickers: [String]) {
        for ticker in tickers {
            guard companyCache[ticker] == nil else { continue }
            guard persistence.loadCompanyCard(ticker: ticker) == nil else { continue }
            guard !loadingTickers.contains(ticker) else { continue }

            Task { [weak self] in
                await self?.fetchCompanyRemote(ticker: ticker, forceRefresh: false)
            }
        }
    }

    private func shouldRevokeLocalAccessWithoutWatchlist(for ticker: String) -> Bool {
        !isStarterTicker(ticker)
    }

    @discardableResult
    private func clearUnavailableEphemeralSelectionIfNeeded(for ticker: String) -> Bool {
        let normalized = normalizedTicker(ticker)
        guard !isTickerInWatchlist(normalized) else { return false }
        guard !hasLocallyAvailableConversation(ticker: normalized) else { return false }

        var cleared = false

        if activeConversationTicker == normalized {
            activeConversationTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
            cleared = true
        }

        if lastViewedTicker == normalized {
            lastViewedTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
            cleared = true
        }

        if pendingConversationTicker == normalized {
            pendingConversationTicker = nil
            pendingConversationQuestion = nil
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
            cleared = true
        }

        if recentTickers.contains(normalized) {
            recentTickers.removeAll(where: { $0 == normalized })
            UserDefaults.standard.set(recentTickers, forKey: Self.recentTickersKey)
            cleared = true
        }

        if cleared {
            loadHomeFromPersistence()
        }

        return cleared
    }

    private func revokeLocalAccess(for ticker: String) {
        let normalized = normalizedTicker(ticker)
        accessRevokedTickers.insert(normalized)
        companyCache.removeValue(forKey: normalized)
        companyLoadStates.removeValue(forKey: normalized)
        chatHistoryCache.removeValue(forKey: normalized)
        pendingChats.removeValue(forKey: normalized)
        cancelCompanyLoadRetry(for: normalized)
        addingTickers.remove(normalized)
        loadingTickers.remove(normalized)
        refreshedTickersThisSession.remove(normalized)
        recentTickers.removeAll(where: { $0 == normalized })
        UserDefaults.standard.set(recentTickers, forKey: Self.recentTickersKey)
        if lastViewedTicker == normalized {
            lastViewedTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
        }
        if activeConversationTicker == normalized {
            activeConversationTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
        }
        if pendingConversationTicker == normalized {
            pendingConversationTicker = nil
            pendingConversationQuestion = nil
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
        }
        clearLastSeenFilingKey(for: normalized)
        try? persistence.removeStock(ticker: normalized)
        companyIsLoading = !loadingTickers.isEmpty
        chatIsSending = !pendingChats.isEmpty
    }

    private func searchScore(for item: SearchItem, query: String) -> Int {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let ticker = item.ticker.lowercased()
        let companyName = item.companyName.lowercased()
        let queryAlias = normalizedClassTickerAlias(query)
        let tickerAlias = normalizedClassTickerAlias(item.ticker)

        if ticker == normalizedQuery {
            return 0
        }

        if let queryAlias, tickerAlias == queryAlias {
            return 1
        }

        if ticker.hasPrefix(normalizedQuery) {
            return 2
        }

        if let queryAlias, let tickerAlias, tickerAlias.hasPrefix(queryAlias) {
            return 3
        }

        if companyName == normalizedQuery {
            return 4
        }

        if companyName.hasPrefix(normalizedQuery) {
            return 5
        }

        if ticker.contains(normalizedQuery) {
            return 6
        }

        if let queryAlias, let tickerAlias, tickerAlias.contains(queryAlias) {
            return 7
        }

        if companyName.contains(normalizedQuery) {
            return 8
        }

        return 9
    }

    private func normalizedClassTickerAlias(_ value: String) -> String? {
        let normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let components = normalized
            .components(separatedBy: CharacterSet(charactersIn: ".- "))
            .filter { !$0.isEmpty }
        guard components.count == 2 else {
            return nil
        }
        guard normalized.rangeOfCharacter(from: CharacterSet(charactersIn: ".- ")) != nil else {
            return nil
        }

        return "\(components[0]).\(components[1])"
    }

    private func loadHomeFromPersistence() {
        watchlist = persistence.loadWatchlistCards(savedTickers: savedTickers)
        recentCompanies = orderedCards(for: recentTickers.filter { !isTickerInWatchlist($0) })
    }

    private func sanitizeRestoredConversationState() {
        if let pendingConversationTicker {
            self.pendingConversationTicker = normalizedTicker(pendingConversationTicker)
        }

        if let lastViewedTicker {
            let normalized = normalizedTicker(lastViewedTicker)
            if shouldRestoreNavigationTicker(ticker: normalized) {
                self.lastViewedTicker = normalized
                UserDefaults.standard.set(normalized, forKey: Self.lastViewedTickerKey)
            } else {
                self.lastViewedTicker = nil
                UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
            }
        }

        if let activeConversationTicker {
            let normalized = normalizedTicker(activeConversationTicker)
            if shouldRestoreConversationSelection(ticker: normalized) {
                self.activeConversationTicker = normalized
                UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
            } else {
                self.activeConversationTicker = nil
                UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
            }
        }
    }

    private func shouldRestoreConversationSelection(ticker: String) -> Bool {
        shouldPersistConversationSelection(ticker: ticker, draftQuestion: pendingDraftQuestion(for: ticker))
    }

    private func shouldPersistConversationSelection(ticker: String, draftQuestion: String?) -> Bool {
        if shouldRestoreNavigationTicker(ticker: ticker) {
            return true
        }

        return !(draftQuestion?.isEmpty ?? true)
    }

    private func shouldRestoreNavigationTicker(ticker: String) -> Bool {
        hasLocallyAvailableConversation(ticker: ticker)
    }

    private func pendingDraftQuestion(for ticker: String) -> String? {
        guard pendingConversationTicker == ticker else { return nil }
        let trimmed = pendingConversationQuestion?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private var firstRestorableSavedTicker: String? {
        if let cachedWatchlistTicker = watchlist.first(where: { !$0.isPlaceholder })?.ticker {
            return cachedWatchlistTicker
        }

        return savedTickers.first(where: hasLocallyAvailableConversation(ticker:))
    }

    private func hasLocallyAvailableConversation(ticker: String) -> Bool {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return false }
        return companyCache[normalized] != nil || persistence.loadCompany(ticker: normalized) != nil
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

    private func clearLastSeenFilingKey(for ticker: String) {
        UserDefaults.standard.removeObject(forKey: lastSeenFilingKeyKey(for: ticker))
    }

    private func isStarterTicker(_ ticker: String) -> Bool {
        let normalized = normalizedTicker(ticker)
        return starterCompanies.contains(where: { $0.ticker == normalized })
    }

    private func applyLocalWatchlistAddFallback(savedTicker: String, cik: String?) {
        let normalizedSavedTicker = normalizedTicker(savedTicker)
        let issuerKey = issuerGroupKey(for: normalizedSavedTicker, cikHint: cik)
        savedTickers.removeAll { issuerGroupKey(for: $0) == issuerKey }
        savedTickers.insert(normalizedSavedTicker, at: 0)
        savedTickers = Array(savedTickers.prefix(25))
        UserDefaults.standard.set(savedTickers, forKey: Self.savedTickersKey)

        for ticker in relatedTickers(forIssuerGroupKey: issuerKey, additionalTickers: [normalizedSavedTicker]) {
            accessRevokedTickers.remove(ticker)
        }
    }

    private func applyLocalWatchlistRemovalFallback(for ticker: String) {
        let normalized = normalizedTicker(ticker)
        let issuerKey = issuerGroupKey(for: normalized)
        let previousSavedTickers = savedTickers

        savedTickers.removeAll { issuerGroupKey(for: $0) == issuerKey }
        UserDefaults.standard.set(savedTickers, forKey: Self.savedTickersKey)

        for relatedTicker in relatedTickers(forIssuerGroupKey: issuerKey, additionalTickers: previousSavedTickers + [normalized]) {
            guard shouldRevokeLocalAccessWithoutWatchlist(for: relatedTicker) else {
                accessRevokedTickers.remove(relatedTicker)
                continue
            }
            revokeLocalAccess(for: relatedTicker)
        }
    }

    private func savedIssuerKeys(for tickers: [String]) -> Set<String> {
        Set(tickers.map { issuerGroupKey(for: $0) })
    }

    private func issuerGroupKey(for ticker: String, cikHint: String? = nil) -> String {
        if let cik = resolvedCIK(for: ticker, cikHint: cikHint) {
            return "cik:\(cik)"
        }
        return "ticker:\(normalizedTicker(ticker))"
    }

    private func savedTicker(for ticker: String, cik: String? = nil) -> String? {
        let issuerKey = issuerGroupKey(for: ticker, cikHint: cik)
        return savedTickers.first(where: { issuerGroupKey(for: $0) == issuerKey })
    }

    private func resolvedCIK(for ticker: String, cikHint: String? = nil) -> String? {
        if let cik = normalizedCIK(cikHint) {
            return cik
        }

        let normalized = normalizedTicker(ticker)
        let tickerCIKMap = knownTickerCIKMap()

        if let cik = tickerCIKMap[normalized] {
            return cik
        }

        guard let familyKey = aliasFamilyKey(for: normalized) else { return nil }
        let familyCIKs = Set(
            tickerCIKMap.compactMap { pair in
                aliasFamilyKey(for: pair.key) == familyKey ? pair.value : nil
            }
        )
        guard familyCIKs.count == 1 else { return nil }
        return familyCIKs.first
    }

    private func knownTickerCIKMap() -> [String: String] {
        var result = persistence.loadTickerCIKMap().reduce(into: [String: String]()) { map, pair in
            if let cik = normalizedCIK(pair.value) {
                map[normalizedTicker(pair.key)] = cik
            }
        }

        for company in companyCache.values {
            guard let cik = normalizedCIK(company.cik) else { continue }
            result[normalizedTicker(company.ticker)] = cik
        }

        for state in companyLoadStates.values {
            guard let cik = normalizedCIK(state.cik) else { continue }
            result[normalizedTicker(state.ticker)] = cik
        }

        for item in searchResults {
            guard let cik = normalizedCIK(item.cik) else { continue }
            result[normalizedTicker(item.ticker)] = cik
        }

        return result
    }

    private func relatedTickers(forIssuerGroupKey issuerKey: String, additionalTickers: [String] = []) -> Set<String> {
        var related = Set<String>()

        if issuerKey.hasPrefix("cik:") {
            let cik = String(issuerKey.dropFirst(4))
            related.formUnion(persistence.loadTickers(cik: cik).map(normalizedTicker))

            for company in companyCache.values where normalizedCIK(company.cik) == cik {
                related.insert(normalizedTicker(company.ticker))
            }

            for item in searchResults where normalizedCIK(item.cik) == cik {
                related.insert(normalizedTicker(item.ticker))
            }
        }

        for ticker in additionalTickers where issuerGroupKey(for: ticker) == issuerKey {
            related.insert(normalizedTicker(ticker))
        }

        if issuerKey.hasPrefix("ticker:") {
            related.insert(String(issuerKey.dropFirst(7)))
        }

        return related
    }

    private func aliasFamilyKey(for ticker: String) -> String? {
        let normalized = normalizedTicker(ticker)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let components = normalized
            .components(separatedBy: CharacterSet(charactersIn: ".- "))
            .filter { !$0.isEmpty }

        guard components.count >= 2 else { return nil }
        guard normalized.rangeOfCharacter(from: CharacterSet(charactersIn: ".- ")) != nil else {
            return nil
        }

        return components[0]
    }

    private func isLocalAccessRevoked(for ticker: String) -> Bool {
        let normalized = normalizedTicker(ticker)
        return accessRevokedTickers.contains(normalized)
            && !isTickerInWatchlist(normalized)
            && shouldRevokeLocalAccessWithoutWatchlist(for: normalized)
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

    private func normalizedCIK(_ cik: String?) -> String? {
        guard let cik else { return nil }
        let normalized = cik.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }

    private static func normalizedTickers(_ tickers: [String]) -> [String] {
        var seen = Set<String>()
        return tickers.compactMap { ticker in
            let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard !normalized.isEmpty, seen.insert(normalized).inserted else { return nil }
            return normalized
        }
    }

    private func syncBillingState(showErrors: Bool) async {
        do {
            guard let request = try await subscriptionStore.syncRequestIfAvailable() else {
                return
            }
            let response = try await apiClient.syncBilling(request)
            subscriptionStore.apply(response)
        } catch {
            if showErrors {
                handle(error)
            }
        }
    }

    var isUsageSynchronizing: Bool {
        usage == nil && usageLoadState == .loading
    }
}
