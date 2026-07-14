import XCTest
@testable import Kabuyomi

@MainActor
private final class TestAccountCredentialStore: AccountCredentialStoring {
    var credential: AccountCredential?

    init(credential: AccountCredential? = nil) {
        self.credential = credential
    }

    func load() throws -> AccountCredential? { credential }
    func save(_ credential: AccountCredential) throws { self.credential = credential }
    func clear() throws { credential = nil }
}

@MainActor
final class AppModelTests: XCTestCase {
    private static func makeTestDeviceIdentityStore() -> DeviceIdentityStore {
        DeviceIdentityStore(
            service: "app.kabuyomi.identity.unit-tests",
            account: "deviceKey.app-model-tests"
        )
    }

    override func setUp() async throws {
        try await super.setUp()
        Self.clearKabuyomiDefaults()
        Self.makeTestDeviceIdentityStore().reset()
        #if DEBUG
        AdMobConfig.setRewardedCreditSSVSmokeModeEnabled(false)
        AdMobConfig.setTestDeviceIdentifiers([])
        #endif
    }

    override func tearDown() async throws {
        MockAppModelURLProtocol.requestHandler = nil
        Self.clearKabuyomiDefaults()
        Self.makeTestDeviceIdentityStore().reset()
        #if DEBUG
        AdMobConfig.setRewardedCreditSSVSmokeModeEnabled(false)
        AdMobConfig.setTestDeviceIdentifiers([])
        #endif
        try await super.tearDown()
    }

    func testOpenConversationNormalizesTickerAndConsumesDraftQuestion() {
        let model = makeAppModel()

        XCTAssertTrue(model.shouldShowConversationEntry)

        model.openConversation(for: " msft ", draftQuestion: "前回決算との違いは？")

        XCTAssertEqual(model.activeConversationTicker, "MSFT")
        XCTAssertEqual(UserDefaults.standard.string(forKey: AppModel.activeConversationTickerKey), "MSFT")
        XCTAssertFalse(model.shouldShowConversationEntry)
        XCTAssertEqual(model.consumePendingDraftQuestion(for: "MSFT"), "前回決算との違いは？")
        XCTAssertNil(model.consumePendingDraftQuestion(for: "MSFT"))
    }

    func testPaidCreditAccountSignOutClearsOnlyLocalSessionAndRefreshesInstallationUsage() async {
        let store = TestAccountCredentialStore(credential: AccountCredential(
            token: "opaque-account-session",
            accountPrincipal: "account:v1:opaque",
            appAccountToken: "43fbd3f0-78b1-4d65-9968-0f5bc42aab47",
            issuedAt: "2026-07-11T00:00:00.000Z",
            expiresAt: "2026-08-10T00:00:00.000Z"
        ))
        let recorder = AccountSignOutRequestRecorder()
        MockAppModelURLProtocol.requestHandler = { request in
            recorder.record(request)
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-07-11"
                ])
            )
        }
        let model = makeAppModel(accountCredentialStore: store)
        XCTAssertTrue(model.isPaidCreditAccountSignedIn)

        await model.signOutPaidCreditAccount()

        XCTAssertNil(store.credential)
        XCTAssertFalse(model.isPaidCreditAccountSignedIn)
        XCTAssertEqual(recorder.snapshot.path, "/v1/usage")
        XCTAssertNil(recorder.snapshot.accountHeader)
    }

    func testConsumablePurchaseUIKeepsSurfaceVisibleButEnablesActionOnlyWhenEveryRuntimeGatePasses() {
        XCTAssertTrue(ConsumableCreditReviewUI.canPurchase(
            creditBillingEnabled: true,
            consumablePurchasesEnabled: true,
            accountRecoveryReady: false,
            isAccountSignedIn: false,
            authenticatedCreditActionsAvailable: true
        ))
        XCTAssertFalse(ConsumableCreditReviewUI.canPurchase(
            creditBillingEnabled: false,
            consumablePurchasesEnabled: true,
            accountRecoveryReady: false,
            isAccountSignedIn: false,
            authenticatedCreditActionsAvailable: true
        ))
        XCTAssertFalse(ConsumableCreditReviewUI.canPurchase(
            creditBillingEnabled: true,
            consumablePurchasesEnabled: false,
            accountRecoveryReady: false,
            isAccountSignedIn: false,
            authenticatedCreditActionsAvailable: true
        ))
        XCTAssertFalse(ConsumableCreditReviewUI.canPurchase(
            creditBillingEnabled: true,
            consumablePurchasesEnabled: true,
            accountRecoveryReady: false,
            isAccountSignedIn: false,
            authenticatedCreditActionsAvailable: false
        ))
        XCTAssertFalse(ConsumableCreditReviewUI.canPurchase(
            creditBillingEnabled: true,
            consumablePurchasesEnabled: true,
            accountRecoveryReady: true,
            isAccountSignedIn: false,
            authenticatedCreditActionsAvailable: true
        ))
        XCTAssertTrue(ConsumableCreditReviewUI.canPurchase(
            creditBillingEnabled: true,
            consumablePurchasesEnabled: true,
            accountRecoveryReady: true,
            isAccountSignedIn: true,
            authenticatedCreditActionsAvailable: true
        ))
    }

    func testOpenConversationDoesNotPersistEphemeralTickerWithoutLocalData() {
        let model = makeAppModel()

        model.openConversation(for: " mu ")

        XCTAssertEqual(model.activeConversationTicker, "MU")
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.activeConversationTickerKey))
    }

    func testBootstrapClearsRestoredEphemeralTickerWithoutLocalData() async {
        UserDefaults.standard.set("MU", forKey: AppModel.activeConversationTickerKey)
        UserDefaults.standard.set("AAPL", forKey: AppModel.lastViewedTickerKey)
        UserDefaults.standard.set(["AAPL"], forKey: AppModel.recentTickersKey)
        UserDefaults.standard.set(true, forKey: AppModel.hasCompletedInitialEntryKey)

        let model = makeAppModel()

        await model.bootstrap()

        XCTAssertNil(model.activeConversationTicker)
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.activeConversationTickerKey))
        XCTAssertEqual(model.rootConversationTicker, "AAPL")
    }

    func testBootstrapClearsRestoredRecentOnlyNonStarterTickerWithoutWatchlistOrLocalData() async {
        UserDefaults.standard.set("MU", forKey: AppModel.activeConversationTickerKey)
        UserDefaults.standard.set("MU", forKey: AppModel.lastViewedTickerKey)
        UserDefaults.standard.set(["MU"], forKey: AppModel.recentTickersKey)
        UserDefaults.standard.set(true, forKey: AppModel.hasCompletedInitialEntryKey)

        let model = makeAppModel()

        await model.bootstrap()

        XCTAssertNil(model.activeConversationTicker)
        XCTAssertNil(model.lastViewedTicker)
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.activeConversationTickerKey))
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.lastViewedTickerKey))
        XCTAssertEqual(model.rootConversationTicker, "AAPL")
    }

    func testBootstrapClearsRestoredSavedOnlyTickerWithoutLocalData() async {
        UserDefaults.standard.set(["NVDA"], forKey: AppModel.savedTickersKey)
        UserDefaults.standard.set("NVDA", forKey: AppModel.activeConversationTickerKey)
        UserDefaults.standard.set("NVDA", forKey: AppModel.lastViewedTickerKey)
        UserDefaults.standard.set(true, forKey: AppModel.hasCompletedInitialEntryKey)

        let model = makeAppModel()

        await model.bootstrap()

        XCTAssertNil(model.activeConversationTicker)
        XCTAssertNil(model.lastViewedTicker)
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.activeConversationTickerKey))
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.lastViewedTickerKey))
        XCTAssertEqual(model.rootConversationTicker, "AAPL")
    }

    func testBootstrapClearsRestoredStarterTickerWithoutLocalData() async {
        UserDefaults.standard.set("MSFT", forKey: AppModel.activeConversationTickerKey)
        UserDefaults.standard.set("MSFT", forKey: AppModel.lastViewedTickerKey)
        UserDefaults.standard.set(true, forKey: AppModel.hasCompletedInitialEntryKey)

        let model = makeAppModel()

        await model.bootstrap()

        XCTAssertNil(model.activeConversationTicker)
        XCTAssertNil(model.lastViewedTicker)
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.activeConversationTickerKey))
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.lastViewedTickerKey))
        XCTAssertEqual(model.rootConversationTicker, "AAPL")
    }

    func testRootConversationTickerIgnoresSavedOnlyTickerPlaceholderWithoutLocalData() async {
        UserDefaults.standard.set(["NVDA"], forKey: AppModel.savedTickersKey)
        UserDefaults.standard.set(true, forKey: AppModel.hasCompletedInitialEntryKey)

        let model = makeAppModel()

        await model.bootstrap()

        XCTAssertEqual(model.watchlist.map(\.ticker), ["NVDA"])
        XCTAssertEqual(model.watchlist.map(\.isPlaceholder), [true])
        XCTAssertEqual(model.rootConversationTicker, "AAPL")
    }

    func testLoadCompanyFailureClearsRestoredUnsavedStarterTickerSelection() async {
        UserDefaults.standard.set(true, forKey: AppModel.hasCompletedInitialEntryKey)

        let model = makeAppModel()

        MockAppModelURLProtocol.requestHandler = { request in
            switch request.url?.path {
            case "/v1/usage":
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                let data = try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18"
                ])
                return (response, data)
            case "/v1/company/MSFT":
                let response = HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!
                let data = try TestFixtures.jsonData(["error": "Internal server error"])
                return (response, data)
            default:
                throw URLError(.badServerResponse)
            }
        }

        await model.bootstrap()
        model.openConversation(for: "MSFT")
        XCTAssertEqual(model.activeConversationTicker, "MSFT")

        await model.loadCompany(ticker: "MSFT")

        XCTAssertNil(model.activeConversationTicker)
        XCTAssertNil(model.lastViewedTicker)
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.activeConversationTickerKey))
        XCTAssertNil(UserDefaults.standard.string(forKey: AppModel.lastViewedTickerKey))
        XCTAssertEqual(model.rootConversationTicker, "AAPL")
        XCTAssertNil(model.activeAlert)
    }

    func testLoadCompanyRetryableStateDoesNotPresentAlert() async {
        UserDefaults.standard.set(true, forKey: AppModel.hasCompletedInitialEntryKey)
        let model = makeAppModel()

        MockAppModelURLProtocol.requestHandler = { request in
            switch request.url?.path {
            case "/v1/company/AAPL":
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                let data = try TestFixtures.jsonData([
                    "status": "failed_retryable",
                    "ticker": "AAPL",
                    "message": "SEC data is temporarily unavailable",
                    "retryAfterSeconds": 60
                ])
                return (response, data)
            default:
                throw URLError(.badServerResponse)
            }
        }

        await model.loadCompany(ticker: "AAPL")

        XCTAssertNil(model.activeAlert)
        XCTAssertNil(model.companyPayload(for: "AAPL"))
        XCTAssertEqual(model.companyLoadState(for: "AAPL")?.status, .failedRetryable)
        XCTAssertEqual(model.companyLoadState(for: "AAPL")?.retryAfterSeconds, 60)
    }

    func testBootstrapDoesNotBlockOnUsageRefresh() async {
        MockAppModelURLProtocol.requestHandler = { request in
            Thread.sleep(forTimeInterval: 1.0)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData([
                "plan": "free",
                "chatsUsed": 0,
                "chatLimit": 10,
                "stocksUsed": 0,
                "stockLimit": 3,
                "dateJST": "2026-04-18"
            ])
            return (response, data)
        }

        let model = makeAppModel()
        let startedAt = ContinuousClock.now

        await model.bootstrap()

        let elapsed = startedAt.duration(to: .now)
        XCTAssertTrue(model.isBootstrapped)
        XCTAssertLessThan(elapsed, .seconds(0.5))
    }

    func testNormalizedSourcePreviewTextCompactsAndClipsLongEnglishChunks() {
        let raw = """
        The strength in foreign currencies relative to the U.S. dollar had a net favorable year-over-year impact on Europe net sales during the first quarter of 2026.Greater ChinaGreater China net sales increased during the first quarter of 2026 compared to the same quarter in 2025 due to higher net sales of iPhone.JapanJapan net sales increased during the first quarter of 2026 compared to the same quarter in 2025 primarily due to higher net sales of iPhone and iPad. The weakness in the yen relative to the U.S. dollar had an unfavorable year-over-year impact on Japan net sales during the first quarter of 2026.Rest of Asia PacificRest of Asia Pacific net sales increased during the first quarter of 2026 compared to the same quarter in 2025 primarily due to higher net sales of iPhone and Services.Apple Inc.
        """

        let preview = normalizedSourcePreviewText(raw, limit: 450)

        XCTAssertLessThanOrEqual(preview.count, 451)
        XCTAssertTrue(preview.hasSuffix("…"))
        XCTAssertTrue(preview.contains("2026. Greater China Greater China"))
        XCTAssertTrue(preview.contains("higher net sales of iPhone"))
        XCTAssertFalse(preview.contains("i Phone"))
    }

    func testSourceListPreviewUsesExcerptInsteadOfRepeatedSectionHeading() {
        let preview = sourceListPreviewText(
            text: "Management Discussion and Analysis. Revenue increased 15.7% year over year due to stronger demand.",
            sectionTitle: "Management Discussion and Analysis",
            fallback: "10-Q Item 2",
            limit: 180
        )

        XCTAssertEqual(preview, "Revenue increased 15.7% year over year due to stronger demand.")
    }

    func testSourceListPreviewFallsBackWhenExcerptIsEmpty() {
        XCTAssertEqual(
            sourceListPreviewText(text: "  ", sectionTitle: "Part I, Item 2", fallback: "10-Q Item 2"),
            "10-Q Item 2"
        )
    }

    func testResetLocalDataRestoresConversationEntryState() throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.openConversation(for: "AAPL")
        model.recordCompanyVisit(ticker: "AAPL")

        XCTAssertFalse(model.shouldShowConversationEntry)

        model.resetLocalData()

        XCTAssertTrue(model.shouldShowConversationEntry)
        XCTAssertNil(model.activeConversationTicker)
        XCTAssertNil(model.lastViewedTicker)
        XCTAssertTrue(model.watchlist.isEmpty)
        XCTAssertTrue(model.recentCompanies.isEmpty)
        XCTAssertTrue(model.showStarterCompanies)
    }

    func testResetLocalDataClearsAIConsentAndRequiresReconsentBeforeChat() async {
        let model = makeAppModel()
        model.setAIConsent(true)

        XCTAssertTrue(model.aiConsentGranted)

        model.resetLocalData()

        XCTAssertFalse(model.aiConsentGranted)
        XCTAssertFalse(UserDefaults.standard.bool(forKey: AppModel.aiConsentKey))

        let didSend = await model.sendChat(question: "売上高は？", ticker: "AAPL")

        XCTAssertFalse(didSend)
        XCTAssertEqual(model.activeAlert?.kind, .aiConsent)
    }

    func testConfirmAIConsentAfterBlockedSendDoesNotTriggerChatRequestOrUsageMutation() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 0,
            stockLimit: 3,
            dateJST: "2026-04-23",
            savedTickers: [],
            accessMode: nil,
            credits: nil,
            creditBillingEnabled: nil
        )

        MockAppModelURLProtocol.requestHandler = { request in
            XCTFail("Unexpected network request: \(request.url?.path ?? "")")
            throw URLError(.badServerResponse)
        }

        let didSend = await model.sendChat(question: "売上高は？", ticker: "AAPL")

        XCTAssertFalse(didSend)
        XCTAssertEqual(model.activeAlert?.kind, .aiConsent)
        XCTAssertFalse(model.chatIsSending)
        XCTAssertNil(model.pendingChat(for: "AAPL"))

        model.confirmAIConsent()

        XCTAssertTrue(model.aiConsentGranted)
        XCTAssertNil(model.activeAlert)
        XCTAssertEqual(model.usage?.chatsUsed, 0)
    }

    func testConversationRefreshWithSameFilingKeepsChatHistory() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)
        try persistence.saveChat(question: "売上高は？", response: TestFixtures.chatResponse(), for: company)

        let model = makeAppModel(persistence: persistence)
        model.openConversation(for: "AAPL")

        MockAppModelURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/company/AAPL/refresh")
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, try TestFixtures.companyPayloadData())
        }

        let result = await model.refreshConversationCompany(ticker: "AAPL")

        XCTAssertEqual(result, .unchanged)
        XCTAssertEqual(model.companyPayload(for: "AAPL")?.filingKey, company.filingKey)
        XCTAssertEqual(model.chatHistory(for: "AAPL").count, 2)
    }

    func testRecentConversationLibraryDataIncludesUnsavedVisitAndOlderFilingThread() throws {
        UserDefaults.standard.set(["AAPL"], forKey: AppModel.savedTickersKey)

        let persistence = PersistenceController(inMemory: true)
        let priorAAPL = TestFixtures.companyPayload(
            filingKey: "v1:AAPL:0000320193-24-000001",
            filedAt: "2024-11-01"
        )
        let latestAAPL = TestFixtures.companyPayload(
            filingKey: "v1:AAPL:0000320193-25-000001",
            filedAt: "2025-11-01"
        )
        let recentMSFT = TestFixtures.companyPayload(
            ticker: "MSFT",
            cik: "0000789019",
            filingKey: "v1:MSFT:0000789019-25-000001",
            filedAt: "2025-10-25"
        )

        for company in [priorAAPL, latestAAPL, recentMSFT] {
            try persistence.saveCompany(company, searchItem: nil)
            try persistence.saveChat(
                question: "この決算の重要点は？",
                response: TestFixtures.chatResponse(),
                for: company
            )
        }

        let model = makeAppModel(persistence: persistence)
        model.openConversation(for: "MSFT")
        model.recordCompanyVisit(ticker: "MSFT")
        model.openConversation(for: "AAPL")
        model.recordCompanyVisit(ticker: "AAPL")

        XCTAssertEqual(model.recentCompanyCards(limit: 8).map(\.ticker), ["MSFT"])
        XCTAssertEqual(
            model.conversationHistory(for: "AAPL").map(\.company.filingKey),
            [latestAAPL.filingKey, priorAAPL.filingKey]
        )
        XCTAssertEqual(model.conversationHistory(for: "AAPL").map(\.chatHistory.count), [2, 2])
    }

    func testRecentConversationSectionShowsExplicitEmptyCopyAndKeepsPopulatedBranch() {
        XCTAssertEqual(
            ConversationLibraryRecentSectionState(recentCompanies: []),
            .empty
        )
        XCTAssertEqual(
            ConversationLibraryRecentEmptyCopy.title,
            "最近見た銘柄はまだありません"
        )
        XCTAssertEqual(
            ConversationLibraryRecentEmptyCopy.message,
            "銘柄を開くと、ここから前回の会話へ戻れます。"
        )

        let recentCompany = WatchlistCard(
            filingKey: "v1:MSFT:0000789019-25-000001",
            ticker: "MSFT",
            companyName: "Microsoft Corporation",
            formType: "10-K",
            filedAt: Date(timeIntervalSince1970: 1_750_000_000),
            verdict: "クラウド成長を確認",
            metrics: [],
            isPlaceholder: false
        )

        XCTAssertEqual(
            ConversationLibraryRecentSectionState(recentCompanies: [recentCompany]),
            .populated
        )
    }

    func testConversationRefreshWithNewerFilingRequiresConfirmationBeforeSwitching() async throws {
        let persistence = PersistenceController(inMemory: true)
        let oldCompany = TestFixtures.companyPayload(
            filingKey: "v1:AAPL:0000320193-24-000001",
            filedAt: "2024-11-01"
        )
        let newCompany = TestFixtures.companyPayload(
            filingKey: "v1:AAPL:0000320193-25-000001",
            filedAt: "2025-11-01"
        )
        try persistence.saveCompany(oldCompany, searchItem: nil)
        try persistence.saveChat(question: "営業利益率は？", response: TestFixtures.chatResponse(), for: oldCompany)

        let model = makeAppModel(persistence: persistence)
        model.openConversation(for: "AAPL")

        MockAppModelURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/company/AAPL/refresh")
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (
                response,
                try TestFixtures.companyPayloadData(
                    ticker: newCompany.ticker,
                    cik: newCompany.cik,
                    filingKey: newCompany.filingKey,
                    filedAt: newCompany.filedAt
                )
            )
        }

        let result = await model.refreshConversationCompany(ticker: "AAPL")

        XCTAssertEqual(result, .needsConfirmation(newCompany))
        XCTAssertEqual(model.companyPayload(for: "AAPL")?.filingKey, oldCompany.filingKey)
        XCTAssertEqual(model.chatHistory(for: "AAPL").count, 2)
        XCTAssertEqual(persistence.loadCompany(ticker: "AAPL")?.company.filingKey, oldCompany.filingKey)

        model.startNewConversation(with: newCompany)

        XCTAssertEqual(model.companyPayload(for: "AAPL")?.filingKey, newCompany.filingKey)
        XCTAssertTrue(model.chatHistory(for: "AAPL").isEmpty)
        XCTAssertEqual(model.conversationHistory(for: "AAPL").map(\.company.filingKey), [oldCompany.filingKey])

        model.openConversation(for: "AAPL", filingKey: oldCompany.filingKey)

        XCTAssertTrue(model.isViewingOlderFilingConversation(ticker: "AAPL"))
        XCTAssertEqual(model.companyPayload(for: "AAPL")?.filingKey, oldCompany.filingKey)
        XCTAssertEqual(model.chatHistory(for: "AAPL").count, 2)
    }

    func testSendChatBlocksLocallyWhenCreditBalanceIsZero() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.setAIConsent(true)
        model.usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 1,
            stockLimit: 3,
            dateJST: "2026-04-26",
            savedTickers: ["AAPL"],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 0,
                monthlyLimit: 30,
                rewardedAdRemaining: nil,
                rewardedAdExpiresAt: nil,
                purchasedRemaining: 0,
                totalRemaining: 0,
                resetsAt: "2026-05-01T00:00:00+09:00"
            ),
            creditBillingEnabled: true
        )

        MockAppModelURLProtocol.requestHandler = { request in
            XCTFail("Unexpected network request: \(request.url?.path ?? "")")
            throw URLError(.badServerResponse)
        }

        let didSend = await model.sendChat(question: "売上高は？", ticker: "AAPL")

        XCTAssertFalse(didSend)
        XCTAssertNil(model.activeAlert)
        XCTAssertEqual(
            model.insufficientCreditRecovery,
            InsufficientCreditRecoveryState(
                requiredCredits: 2,
                remainingCredits: 0,
                source: .localChatPreflight
            )
        )
        XCTAssertNotNil(model.insufficientCreditRecoveryRequestID)
        XCTAssertEqual(model.usage?.credits?.totalRemaining, 0)
    }

    func testRequestCreditOptionsOpensRecoveryStateFromComposer() {
        let model = makeAppModel()
        model.usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 1,
            stockLimit: 3,
            dateJST: "2026-04-26",
            savedTickers: ["AAPL"],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 1,
                monthlyLimit: 30,
                rewardedAdRemaining: nil,
                rewardedAdExpiresAt: nil,
                purchasedRemaining: 0,
                totalRemaining: 1,
                resetsAt: "2026-05-01T00:00:00+09:00"
            ),
            creditBillingEnabled: true
        )

        model.requestCreditOptions()

        XCTAssertEqual(
            model.insufficientCreditRecovery,
            InsufficientCreditRecoveryState(
                requiredCredits: 2,
                remainingCredits: 1,
                source: .chatComposer
            )
        )
        XCTAssertNotNil(model.insufficientCreditRecoveryRequestID)
    }

    func testChatCreditPreflightRemainsActiveWhenStoreKitBillingIsDisabled() async {
        let persistence = PersistenceController(inMemory: true)
        try? persistence.saveCompany(TestFixtures.companyPayload(), searchItem: nil)
        let model = makeAppModel(persistence: persistence)
        model.setAIConsent(true)
        model.usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 25,
            stocksUsed: 1,
            stockLimit: 3,
            dateJST: "2026-07-11",
            savedTickers: ["AAPL"],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 0,
                monthlyLimit: 0,
                rewardedAdRemaining: 0,
                rewardedAdExpiresAt: nil,
                purchasedRemaining: 0,
                totalRemaining: 0,
                resetsAt: "2026-08-01T00:00:00+09:00"
            ),
            creditBillingEnabled: false
        )
        MockAppModelURLProtocol.requestHandler = { request in
            XCTFail("Credit preflight must reject before network: \(request.url?.path ?? "")")
            throw URLError(.badServerResponse)
        }

        let didSend = await model.sendChat(question: "売上高は？", ticker: "AAPL")

        XCTAssertFalse(didSend)
        XCTAssertFalse(model.hasChatCreditAvailable)
        XCTAssertEqual(model.insufficientCreditRecovery?.remainingCredits, 0)
    }

    func testSendChatServerInsufficientCreditsOpensRecoveryState() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.setAIConsent(true)
        model.usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 1,
            stockLimit: 3,
            dateJST: "2026-04-26",
            savedTickers: ["AAPL"],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 2,
                monthlyLimit: 30,
                rewardedAdRemaining: nil,
                rewardedAdExpiresAt: nil,
                purchasedRemaining: 0,
                totalRemaining: 2,
                resetsAt: "2026-05-01T00:00:00+09:00"
            ),
            creditBillingEnabled: true
        )

        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/chat" {
                let response = HTTPURLResponse(url: request.url!, statusCode: 402, httpVersion: nil, headerFields: nil)!
                let data = try TestFixtures.jsonData([
                    "error": "insufficient_credits",
                    "creditsRequired": 2,
                    "creditsRemaining": 0
                ])
                return (response, data)
            }

            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 0))
        }

        let didSend = await model.sendChat(question: "売上高は？", ticker: "AAPL")

        XCTAssertFalse(didSend)
        XCTAssertNil(model.activeAlert)
        XCTAssertEqual(
            model.insufficientCreditRecovery,
            InsufficientCreditRecoveryState(
                requiredCredits: 2,
                remainingCredits: 0,
                source: .serverChatResponse
            )
        )
        XCTAssertNotNil(model.insufficientCreditRecoveryRequestID)
        XCTAssertEqual(model.usage?.credits?.totalRemaining, 2)
    }

    func testInsufficientCreditRecoveryTracksWhenCreditsBecomeSufficient() {
        let model = makeAppModel()
        model.requestInsufficientCreditRecovery(requiredCredits: 2, remainingCredits: 0, source: .chatComposer)

        XCTAssertFalse(model.hasRecoveredEnoughCreditsForPendingRecovery)

        model.usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 1,
            stockLimit: 3,
            dateJST: "2026-04-26",
            savedTickers: ["AAPL"],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 0,
                monthlyLimit: 30,
                rewardedAdRemaining: 2,
                rewardedAdExpiresAt: "2026-05-26T00:00:00+09:00",
                purchasedRemaining: 0,
                totalRemaining: 2,
                resetsAt: "2026-05-01T00:00:00+09:00"
            ),
            creditBillingEnabled: true
        )

        XCTAssertTrue(model.hasRecoveredEnoughCreditsForPendingRecovery)
    }

    func testRecoveryUsesAuthoritativeCreditsWhenStoreKitBillingIsDisabled() {
        let model = makeAppModel()
        model.requestInsufficientCreditRecovery(requiredCredits: 2, remainingCredits: 0, source: .chatComposer)
        model.usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 25,
            stocksUsed: 0,
            stockLimit: 3,
            dateJST: "2026-07-11",
            savedTickers: [],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 0,
                monthlyLimit: 0,
                rewardedAdRemaining: 0,
                rewardedAdExpiresAt: nil,
                purchasedRemaining: 2,
                totalRemaining: 2,
                resetsAt: "2026-08-01T00:00:00+09:00"
            ),
            creditBillingEnabled: false
        )

        XCTAssertTrue(model.hasRecoveredEnoughCreditsForPendingRecovery)
    }

    func testClosingInsufficientCreditRecoveryClearsRecoveryState() {
        let model = makeAppModel()
        model.requestInsufficientCreditRecovery(requiredCredits: 2, remainingCredits: 0, source: .chatComposer)

        model.dismissInsufficientCreditRecovery()

        XCTAssertNil(model.insufficientCreditRecovery)
        XCTAssertNil(model.insufficientCreditRecoveryRequestID)
        XCTAssertFalse(model.hasRecoveredEnoughCreditsForPendingRecovery)
    }

    func testPurchaseCreditPackBlocksWhenCreditBillingIsDisabled() async {
        let model = makeAppModel()
        model.usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 0,
            stockLimit: 3,
            dateJST: "2026-04-26",
            savedTickers: [],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 30,
                monthlyLimit: 30,
                rewardedAdRemaining: nil,
                rewardedAdExpiresAt: nil,
                purchasedRemaining: 0,
                totalRemaining: 30,
                resetsAt: "2026-05-01T00:00:00+09:00"
            ),
            creditBillingEnabled: false
        )

        MockAppModelURLProtocol.requestHandler = { request in
            XCTFail("Unexpected network request: \(request.url?.path ?? "")")
            throw URLError(.badServerResponse)
        }

        await model.purchaseCreditPack(productId: "kabuyomi.credits.50")

        XCTAssertEqual(model.activeAlert?.message, "追加クレジット購入は現在利用できません。時間をおいてからもう一度お試しください。")
        XCTAssertFalse(model.billingActionInFlight)
    }

    func testDisabledCreditBillingStillLoadsSubscriptionMetadataButGuardsPurchaseAndRestore() async throws {
        let suiteName = "AppModelTests.disabled-billing-product-metadata.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let subscriptionStore = SubscriptionStore(defaults: defaults, productLoader: { _ in [] })
        let model = makeAppModel(subscriptionStore: subscriptionStore)
        model.usage = makeBillingUsage(
            creditBillingEnabled: false,
            consumablePurchasesEnabled: true
        )
        model.subscriptionProductLoadErrorMessage = "stale error"

        MockAppModelURLProtocol.requestHandler = { request in
            XCTFail("Unexpected network request: \(request.url?.path ?? "")")
            throw URLError(.badServerResponse)
        }

        await model.loadSubscriptionProducts(showErrors: true)
        if case .unavailable = model.subscriptionProductLoadState {
            // Product metadata is independent from the server-side purchase gate.
        } else {
            XCTFail("Disabled billing must still resolve StoreKit metadata to a terminal state")
        }
        XCTAssertNotNil(model.subscriptionProductLoadErrorMessage)

        await model.purchaseSubscription(productId: "kabuyomi.sub.pro.monthly")
        XCTAssertEqual(
            model.activeAlert?.message,
            "月額プランは現在利用できません。時間をおいてからもう一度お試しください。"
        )
        model.activeAlert = nil

        await model.restorePurchases()
        XCTAssertEqual(
            model.activeAlert?.message,
            "購入の復元は現在利用できません。時間をおいてからもう一度お試しください。"
        )
        XCTAssertFalse(model.billingActionInFlight)
    }

    func testDisabledConsumableCapabilityStillLoadsPackMetadataButGuardsPurchaseAndRecovery() async throws {
        let suiteName = "AppModelTests.disabled-consumable-product-metadata.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let subscriptionStore = SubscriptionStore(defaults: defaults, productLoader: { _ in [] })
        let model = makeAppModel(subscriptionStore: subscriptionStore)
        model.usage = makeBillingUsage(
            creditBillingEnabled: true,
            consumablePurchasesEnabled: false
        )
        model.creditPackProducts = [
            CreditPackProduct(
                id: SubscriptionStore.primaryCreditProductID,
                credits: 50,
                displayPrice: "¥100",
                isAvailable: true
            )
        ]
        model.creditPackProductLoadErrorMessage = "stale error"

        MockAppModelURLProtocol.requestHandler = { request in
            XCTFail("Unexpected network request: \(request.url?.path ?? "")")
            throw URLError(.badServerResponse)
        }

        XCTAssertTrue(model.isCreditBillingEnabled)
        XCTAssertFalse(model.isConsumableCreditPurchasingEnabled)
        await model.loadCreditPackProducts(showErrors: true)
        XCTAssertEqual(model.creditPackProducts.count, 2)
        XCTAssertTrue(model.creditPackProducts.allSatisfy { !$0.isAvailable })
        if case .unavailable = model.creditPackProductLoadState {
            // Product metadata is independent from the server-side purchase gate.
        } else {
            XCTFail("Disabled consumables must still resolve StoreKit metadata to a terminal state")
        }
        XCTAssertNotNil(model.creditPackProductLoadErrorMessage)

        await model.purchaseCreditPack(productId: SubscriptionStore.primaryCreditProductID)
        XCTAssertEqual(
            model.activeAlert?.message,
            "追加クレジット購入は現在利用できません。時間をおいてからもう一度お試しください。"
        )

        model.activeAlert = nil
        await model.recoverUnfinishedCreditPurchases(showErrors: true)
        XCTAssertNil(model.activeAlert)
        XCTAssertFalse(model.billingActionInFlight)
    }

    func testMiniConsumableUsesProductionStoreKitProductId() {
        XCTAssertEqual(SubscriptionStore.miniCreditProductID, "kabuyomi.credits.50")
        XCTAssertEqual(SubscriptionStore.creditPackProductIDs, ["kabuyomi.credits.50", "kabuyomi.credits.100"])
    }

    func testSubscriptionCatalogUsesV102StoreKitProducts() {
        XCTAssertEqual(SubscriptionStore.subscriptionProductIDs, [
            "kabuyomi.sub.lite.monthly",
            "kabuyomi.sub.pro.monthly",
            "kabuyomi.sub.max.monthly"
        ])
        XCTAssertEqual(BillingCatalog.lite.monthlyCredits, 400)
        XCTAssertEqual(BillingCatalog.pro.monthlyCredits, 900)
        XCTAssertEqual(BillingCatalog.proMax.monthlyCredits, 2000)
        XCTAssertEqual(BillingCatalog.proMax.title, "Max")
    }

    func testSubscriptionProductLoadHasFiniteTimeout() async throws {
        let suiteName = "AppModelTests.subscription-product-timeout.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = SubscriptionStore(
            defaults: defaults,
            productLoadTimeoutNanoseconds: 1_000_000,
            productLoader: { _ in
                try await Task.sleep(nanoseconds: 1_000_000_000)
                return []
            }
        )

        do {
            _ = try await store.subscriptionProducts()
            XCTFail("Expected product loading to time out")
        } catch let error as SubscriptionStoreError {
            guard case .productLoadTimedOut = error else {
                return XCTFail("Unexpected StoreKit error: \(error)")
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testStoreProductPresentationStopsClaimingItIsLoadingAfterTerminalState() {
        XCTAssertEqual(
            StoreProductPresentation.priceText(displayPrice: nil, loadState: .loading),
            "価格を確認中"
        )
        XCTAssertEqual(
            StoreProductPresentation.unavailableActionTitle(loadState: .loading),
            "App Storeに接続中"
        )

        for terminalState: SubscriptionProductLoadState in [.loaded, .unavailable, .failed] {
            XCTAssertEqual(
                StoreProductPresentation.priceText(displayPrice: nil, loadState: terminalState),
                "価格を取得できません"
            )
            XCTAssertEqual(
                StoreProductPresentation.unavailableActionTitle(loadState: terminalState),
                "再読み込みできます"
            )
        }

        XCTAssertEqual(
            StoreProductPresentation.priceText(displayPrice: "¥980", loadState: .loaded),
            "¥980"
        )
    }

    func testSubscriptionStoreInactiveStateCannotCreateDemotingSyncRequest() async throws {
        let suiteName = "AppModelTests.inactive-subscription-sync.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("kabuyomi.sub.pro.monthly", forKey: "kabuyomi.subscription.productId")
        defaults.set("orig-inactive-12345678", forKey: "kabuyomi.subscription.originalTransactionId")
        defaults.set(false, forKey: "kabuyomi.subscription.active")
        let store = SubscriptionStore(defaults: defaults)

        XCTAssertFalse(store.isSubscriptionActive)
        XCTAssertEqual(store.entitlementLookupOriginalTransactionId, "orig-inactive-12345678")
        let syncRequest = try await store.syncRequestIfAvailable()
        XCTAssertNil(syncRequest)
    }

    func testSubscriptionStoreVerifiedMaterialSyncAndApplyRemainIdempotent() async throws {
        let suiteName = "AppModelTests.verified-subscription-sync.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("kabuyomi.sub.pro.monthly", forKey: "kabuyomi.subscription.productId")
        defaults.set("tx-verified-12345678", forKey: "kabuyomi.subscription.transactionId")
        defaults.set("orig-verified-12345678", forKey: "kabuyomi.subscription.originalTransactionId")
        defaults.set("signed-transaction-jws", forKey: "kabuyomi.subscription.signedTransactionInfo")
        defaults.set(true, forKey: "kabuyomi.subscription.active")
        let store = SubscriptionStore(defaults: defaults)

        let pendingRequest = try await store.syncRequestIfAvailable()
        let request = try XCTUnwrap(pendingRequest)
        XCTAssertEqual(request.productId, "kabuyomi.sub.pro.monthly")
        XCTAssertEqual(request.transactionId, "tx-verified-12345678")
        XCTAssertEqual(request.originalTransactionId, "orig-verified-12345678")
        XCTAssertEqual(request.signedTransactionInfo, "signed-transaction-jws")

        store.apply(
            BillingSyncResponse(
                plan: "pro",
                quotaSubject: "subscription:v1:stable-principal",
                productId: "kabuyomi.sub.pro.monthly",
                syncedAt: "2026-07-10T00:00:00.000Z",
                activePlan: "pro",
                activeSubscription: nil,
                creditBillingEnabled: true,
                usage: nil
            )
        )

        XCTAssertEqual(store.plan, "pro")
        XCTAssertEqual(store.quotaSubject, "subscription:v1:stable-principal")
        let duplicateRequest = try await store.syncRequestIfAvailable()
        XCTAssertNil(duplicateRequest)
    }

    func testCreditPackPresentationKeepsPrimaryAndCompatibilityRowsSeparate() {
        let products = CreditPackPresentation.visibleProducts(from: [
            CreditPackProduct(id: "kabuyomi.credits.100", credits: 100, displayPrice: "¥200", isAvailable: true),
            CreditPackProduct(id: "kabuyomi.credits.50", credits: 50, displayPrice: "¥100", isAvailable: true)
        ])

        XCTAssertEqual(products.map(\.id), ["kabuyomi.credits.50", "kabuyomi.credits.100"])
        XCTAssertEqual(CreditPackPresentation.primaryProduct(from: products)?.id, "kabuyomi.credits.50")
        XCTAssertEqual(CreditPackPresentation.secondaryProducts(from: products).map(\.id), ["kabuyomi.credits.100"])
    }

    func testAccountStatusDisplayModelUsesServerUsageAndHandlesMissingActiveSubscription() {
        let usage = UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 25,
            stocksUsed: 0,
            stockLimit: 3,
            dateJST: "2026-05-09",
            savedTickers: [],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 0,
                monthlyLimit: 0,
                welcomeRemaining: 50,
                rewardedAdRemaining: nil,
                rewardedAdExpiresAt: nil,
                purchasedRemaining: 100,
                totalRemaining: 150,
                resetsAt: "2026-06-01T00:00:00+09:00"
            ),
            creditBillingEnabled: true
        )

        let viewModel = AccountStatusDisplayModel(
            apiEnvironment: "prod",
            apiBaseURL: "https://example.com",
            appVersion: "1.0.2(4)",
            deviceKeySuffix: "abc123",
            usage: usage,
            lastUsageRefreshAt: nil,
            lastBillingSyncStatus: "not_started",
            lastBillingSyncAt: nil,
            healthReport: nil
        )

        let rows = Dictionary(uniqueKeysWithValues: viewModel.rows.map { ($0.title, $0.value) })
        let normalRows = Dictionary(uniqueKeysWithValues: viewModel.normalRows.map { ($0.title, $0.value) })
        let debugRows = Dictionary(uniqueKeysWithValues: viewModel.debugRows.map { ($0.title, $0.value) })
        XCTAssertEqual(rows["接続状態"], "未確認")
        XCTAssertEqual(rows["環境"], "本番")
        XCTAssertEqual(rows["現在のプラン"], "無料")
        XCTAssertEqual(rows["合計クレジット"], "150")
        XCTAssertEqual(rows["月額分"], "0 / 0")
        XCTAssertEqual(rows["ウェルカム"], "50")
        XCTAssertEqual(rows["広告分"], "未提供")
        XCTAssertEqual(rows["購入分"], "100")
        XCTAssertEqual(normalRows["端末情報"], "…abc123")
        XCTAssertNil(normalRows["Device"])
        XCTAssertNil(normalRows["API"])
        XCTAssertNil(normalRows["Route detail"])
        XCTAssertFalse(viewModel.rows.contains { $0.value.contains("https://example.com") })
        XCTAssertNil(debugRows["端末ID末尾"])
        XCTAssertNil(debugRows["API"])
    }

    func testSettingsDeviceInfoUsesOnlyRedactedReleaseSafeValues() {
        XCTAssertEqual(AppModel.deviceKeySuffixDisplay(from: nil), "unknown")
        XCTAssertEqual(AppModel.deviceKeySuffixDisplay(from: "not_bootstrapped"), "unknown")
        XCTAssertEqual(AppModel.deviceKeySuffixDisplay(from: "installation:private-abc123"), "abc123")

        let ready = SettingsDeviceInfoDisplayModel(
            deviceKeySuffix: "private-installation-abc123",
            isAuthenticated: true,
            authenticationIssueTitle: nil,
            appVersion: "1.0.2(6)"
        )

        XCTAssertEqual(ready.supportCode, "…abc123")
        XCTAssertEqual(ready.authenticationStatus, "確認済み")
        XCTAssertEqual(ready.appVersion, "1.0.2(6)")
        XCTAssertFalse(ready.supportCode.contains("private-installation"))

        let unavailable = SettingsDeviceInfoDisplayModel(
            deviceKeySuffix: "unknown",
            isAuthenticated: false,
            authenticationIssueTitle: "端末認証を確認できません",
            appVersion: "1.0.2(6)"
        )

        XCTAssertEqual(unavailable.supportCode, "準備中")
        XCTAssertEqual(unavailable.authenticationStatus, "端末認証を確認できません")
    }

    func testAccountStatusDisplayModelHidesRouteMissingDetailsFromDisplayRows() {
        let viewModel = AccountStatusDisplayModel(
            apiEnvironment: "prod",
            apiBaseURL: "https://example.com",
            appVersion: "1.0.2(4)",
            deviceKeySuffix: "abc123",
            usage: nil,
            lastUsageRefreshAt: nil,
            lastBillingSyncStatus: "route_missing HTTP 404 /v1/ios/subscriptions/sync",
            lastBillingSyncAt: nil,
            healthReport: nil
        )

        let normalRows = Dictionary(uniqueKeysWithValues: viewModel.normalRows.map { ($0.title, $0.value) })
        let debugRows = Dictionary(uniqueKeysWithValues: viewModel.debugRows.map { ($0.title, $0.value) })
        XCTAssertEqual(normalRows["接続状態"], "エラー")
        XCTAssertNil(normalRows["Route detail"])
        XCTAssertNil(debugRows["Route detail"])
        XCTAssertFalse(viewModel.rows.contains { $0.value.contains("/v1/ios/subscriptions/sync") })
        XCTAssertFalse(viewModel.rows.contains { $0.value.contains("https://example.com") })
    }

    func testSubscriptionStoreErrorMessagesUseReleaseSafePurchaseCopy() {
        XCTAssertEqual(SubscriptionStoreError.purchasePending.errorDescription, "購入は保留中です。App Store側の処理が完了すると反映されます。")
        XCTAssertEqual(SubscriptionStoreError.purchaseUnverified.errorDescription, "購入を確認できませんでした。購入を復元してください。")
    }

    func testProjectVersionMetadataIsV12Build6() throws {
        let testFile = URL(fileURLWithPath: #filePath)
        let repoRoot = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let projectYML = try String(contentsOf: repoRoot.appendingPathComponent("ios/project.yml"), encoding: .utf8)
        let pbxproj = try String(contentsOf: repoRoot.appendingPathComponent("ios/Kabuyomi.xcodeproj/project.pbxproj"), encoding: .utf8)

        XCTAssertTrue(projectYML.contains("MARKETING_VERSION: 1.2"))
        XCTAssertTrue(projectYML.contains("CURRENT_PROJECT_VERSION: 6"))
        XCTAssertTrue(pbxproj.contains("MARKETING_VERSION = 1.2;"))
        XCTAssertTrue(pbxproj.contains("CURRENT_PROJECT_VERSION = 6;"))
    }

    func testResetLocalDataClearsRecentStateAndKeepsDeviceIdentity() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)

        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        deviceIdentity.reset()
        let originalDeviceKey = deviceIdentity.deviceKey()

        MockAppModelURLProtocol.requestHandler = { request in
            Thread.sleep(forTimeInterval: 0.05)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData([
                "plan": "free",
                "chatsUsed": 0,
                "chatLimit": 10,
                "stocksUsed": 0,
                "stockLimit": 3,
                "dateJST": "2026-04-18"
            ])
            return (response, data)
        }

        let model = AppModel(
            apiClient: makeAPIClient(
                session: {
                    let configuration = URLSessionConfiguration.ephemeral
                    configuration.protocolClasses = [MockAppModelURLProtocol.self]
                    return URLSession(configuration: configuration)
                }(),
                deviceIdentity: deviceIdentity
            ),
            persistence: persistence,
            deviceIdentity: deviceIdentity
        )
        model.usage = TestFixtures.usagePayload()
        model.openConversation(for: "AAPL", draftQuestion: "前回決算との違いは？")
        model.recordCompanyVisit(ticker: "AAPL")

        model.resetLocalData()

        XCTAssertNil(model.usage)
        XCTAssertTrue(model.recentCompanies.isEmpty)
        XCTAssertNil(model.lastViewedTicker)
        XCTAssertNil(model.activeConversationTicker)
        XCTAssertTrue(model.shouldShowConversationEntry)
        XCTAssertTrue(model.showStarterCompanies)

        try? await Task.sleep(nanoseconds: 150_000_000)

        XCTAssertEqual(deviceIdentity.deviceKey(), originalDeviceKey)
        XCTAssertEqual(model.usage?.stocksUsed, 0)
    }

    func testResetLocalDataIgnoresStaleUsageRefreshFromPreviousGeneration() async {
        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        deviceIdentity.reset()
        let originalDeviceKey = deviceIdentity.deviceKey()
        let usageRequestCounter = ThreadSafeCounter()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            if usageRequestCounter.incrementAndGet() == 1 {
                Thread.sleep(forTimeInterval: 0.2)
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 3,
                        "chatLimit": 10,
                        "stocksUsed": 9,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ])
                )
            }

            Thread.sleep(forTimeInterval: 0.05)
            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18"
                ])
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)

        let model = AppModel(
            apiClient: makeAPIClient(session: session, deviceIdentity: deviceIdentity),
            persistence: PersistenceController(inMemory: true),
            deviceIdentity: deviceIdentity
        )

        await model.bootstrap()
        await Task.yield()
        model.resetLocalData()

        try? await Task.sleep(nanoseconds: 350_000_000)

        XCTAssertEqual(deviceIdentity.deviceKey(), originalDeviceKey)
        XCTAssertEqual(model.usage?.stocksUsed, 0)
        XCTAssertEqual(model.usage?.chatsUsed, 0)
    }

    func testPaidUsageRefreshPreservesLocalSavedTickersWhenEntitlementQuotaStartsEmpty() async throws {
        UserDefaults.standard.set(["AAPL"], forKey: AppModel.savedTickersKey)

        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(), searchItem: nil)

        let model = makeAppModel(persistence: persistence)

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            XCTAssertEqual(request.url?.path, "/v1/usage")
            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "pro",
                    "chatsUsed": 0,
                    "chatLimit": 50,
                    "stocksUsed": 0,
                    "stockLimit": 20,
                    "dateJST": "2026-04-26",
                    "savedTickers": [],
                    "credits": [
                        "monthlyRemaining": 500,
                        "monthlyLimit": 500,
                        "purchasedRemaining": 0,
                        "totalRemaining": 500,
                        "resetsAt": "2026-05-01T00:00:00+09:00"
                    ],
                    "creditBillingEnabled": true
                ])
            )
        }

        await model.bootstrap()
        try? await Task.sleep(nanoseconds: 150_000_000)

        XCTAssertEqual(model.usage?.plan, "pro")
        XCTAssertEqual(model.usage?.savedTickers, ["AAPL"])
        XCTAssertEqual(model.usage?.stocksUsed, 1)
        XCTAssertTrue(model.isTickerInWatchlist("AAPL"))
    }

    func testResetLocalDataKeepsCurrentCompanyLoadIndicatorWhenOldRequestFinishesLater() async {
        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        deviceIdentity.reset()
        let originalDeviceKey = deviceIdentity.deviceKey()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/usage":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ])
                )
            case "/v1/company/AAPL":
                if request.value(forHTTPHeaderField: "x-device-key") == originalDeviceKey {
                    Thread.sleep(forTimeInterval: 0.15)
                } else {
                    Thread.sleep(forTimeInterval: 0.30)
                }

                let company = TestFixtures.companyPayload()
                return (
                    response,
                    try TestFixtures.jsonData([
                        "filingKey": company.filingKey,
                        "ticker": company.ticker,
                        "companyName": company.companyName,
                        "cik": company.cik,
                        "formType": company.formType,
                        "filedAt": company.filedAt,
                        "periodOfReport": company.periodOfReport,
                        "primaryDocumentUrl": company.primaryDocumentUrl,
                        "summary": [
                            "verdict": company.summary.verdict,
                            "highlights": company.summary.highlights.map {
                                ["text": $0.text, "sourceIds": $0.sourceIds]
                            },
                            "changes": company.summary.changes.map {
                                ["text": $0.text, "sourceIds": $0.sourceIds]
                            }
                        ],
                        "metrics": company.metrics.map {
                            [
                                "logicalName": $0.logicalName,
                                "tagUsed": $0.tagUsed,
                                "value": $0.value,
                                "unit": $0.unit,
                                "periodEnd": $0.periodEnd,
                                "comparisonValue": $0.comparisonValue as Any? ?? NSNull(),
                                "yoyPercent": $0.yoyPercent as Any? ?? NSNull()
                            ]
                        },
                        "historicalOverview": [
                            "comparisonBasis": company.historicalOverview?.comparisonBasis as Any? ?? NSNull(),
                            "years": company.historicalOverview?.years as Any? ?? NSNull(),
                            "series": company.historicalOverview?.series.map {
                                [
                                    "logicalName": $0.logicalName,
                                    "label": $0.label,
                                    "points": $0.points.map {
                                        [
                                            "filingKey": $0.filingKey,
                                            "filedAt": $0.filedAt,
                                            "periodEnd": $0.periodEnd,
                                            "value": $0.value,
                                            "unit": $0.unit,
                                            "yoyPercent": $0.yoyPercent as Any? ?? NSNull(),
                                            "sourceId": $0.sourceId
                                        ]
                                    }
                                ]
                            } as Any? ?? NSNull()
                        ],
                        "sourceChunks": company.sourceChunks.map {
                            [
                                "sourceId": $0.sourceId,
                                "sectionType": $0.sectionType,
                                "sectionTitle": $0.sectionTitle,
                                "sourceLabel": $0.sourceLabel,
                                "text": $0.text,
                                "startOffset": $0.startOffset,
                                "endOffset": $0.endOffset,
                                "tagName": $0.tagName as Any? ?? NSNull(),
                                "sortOrder": $0.sortOrder
                            ]
                        },
                        "lastUpdatedAt": company.lastUpdatedAt
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let model = AppModel(
            apiClient: makeAPIClient(session: session, deviceIdentity: deviceIdentity),
            persistence: PersistenceController(inMemory: true),
            deviceIdentity: deviceIdentity
        )

        let firstLoad = Task { await model.loadCompany(ticker: "AAPL") }
        try? await Task.sleep(nanoseconds: 50_000_000)
        model.resetLocalData()
        let secondLoad = Task { await model.loadCompany(ticker: "AAPL") }

        try? await Task.sleep(nanoseconds: 180_000_000)
        XCTAssertTrue(model.companyIsLoading)

        await firstLoad.value
        await secondLoad.value

        XCTAssertFalse(model.companyIsLoading)
        XCTAssertEqual(model.companyCache["AAPL"]?.ticker, "AAPL")
    }

    func testSearchPreservesClassTickerAliasPriorityFromAPIResults() async {
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            if request.url?.path == "/v1/search" {
                return (
                    response,
                    try TestFixtures.jsonData([
                        "items": [
                            [
                                "ticker": "BRK-B",
                                "companyName": "Berkshire Hathaway Class B",
                                "cik": "0001067983",
                                "exchange": "NYSE",
                                "latestFormType": "10-K"
                            ],
                            [
                                "ticker": "BRK-A",
                                "companyName": "Berkshire Hathaway Class A",
                                "cik": "0001067983",
                                "exchange": "NYSE",
                                "latestFormType": "10-K"
                            ]
                        ],
                        "snapshotUpdatedAt": NSNull()
                    ])
                )
            }

            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18"
                ])
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        let model = AppModel(
            apiClient: makeAPIClient(session: session, deviceIdentity: deviceIdentity),
            persistence: PersistenceController(inMemory: true),
            deviceIdentity: deviceIdentity
        )

        await model.search(query: "BRK.B")

        XCTAssertEqual(model.searchResults.map(\.ticker), ["BRK-B", "BRK-A"])
    }

    func testSearchFailureClearsStaleResultsAndStoresInlineError() async throws {
        let model = makeAppModel()

        MockAppModelURLProtocol.requestHandler = { request in
            guard request.url?.path == "/v1/search" else {
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                let data = try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18"
                ])
                return (response, data)
            }

            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "q" })?
                .value

            if query == "AAPL" {
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                return (
                    response,
                    try TestFixtures.jsonData([
                        "items": [
                            [
                                "ticker": "AAPL",
                                "companyName": "Apple Inc.",
                                "cik": "0000320193",
                                "exchange": "Nasdaq",
                                "latestFormType": "10-K"
                            ]
                        ],
                        "snapshotUpdatedAt": NSNull()
                    ])
                )
            }

            let response = HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData(["error": "SEC data is temporarily unavailable"])
            return (response, data)
        }

        await model.search(query: "AAPL")
        XCTAssertEqual(model.searchResults.map(\.ticker), ["AAPL"])
        XCTAssertNil(model.searchErrorMessage)

        await model.search(query: "MSFT")
        XCTAssertTrue(model.searchResults.isEmpty)
        XCTAssertEqual(model.searchErrorMessage, "SEC データを現在取得できません。しばらくしてから再度お試しください。")
    }

    func testSendChatPresentsLocalizedTemporaryBackendFailure() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.setAIConsent(true)

        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/chat" {
                let response = HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
                let data = try TestFixtures.jsonData(["error": "Chat response is temporarily unavailable"])
                return (response, data)
            }

            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData([
                "plan": "free",
                "chatsUsed": 0,
                "chatLimit": 10,
                "stocksUsed": 0,
                "stockLimit": 3,
                "dateJST": "2026-04-18"
            ])
            return (response, data)
        }

        let sent = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")

        XCTAssertFalse(sent)
        XCTAssertEqual(model.activeAlert?.message, "チャット応答を現在生成できません。少し待ってから、もう一度お試しください。")
    }

    func testSendChatFilingCacheMissRefreshesCompanyAndRetriesWithLatestFiling() async throws {
        let persistence = PersistenceController(inMemory: true)
        let oldCompany = TestFixtures.companyPayload(
            filingKey: "v1:AAPL:0000320193-24-000001",
            filedAt: "2024-11-01"
        )
        let newCompany = TestFixtures.companyPayload(
            filingKey: "v1:AAPL:0000320193-25-000001",
            filedAt: "2025-11-01"
        )
        try persistence.saveCompany(oldCompany, searchItem: nil)
        let chatRequests = ThreadSafeCounter()
        let filingKeys = StringRecorder()

        let model = makeAppModel(persistence: persistence) { request, body in
            guard request.url?.path == "/v1/chat" else { return }
            let body = try XCTUnwrap(body)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            filingKeys.record(try XCTUnwrap(json["filingKey"] as? String))
        }
        model.setAIConsent(true)

        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/chat" {
                if chatRequests.incrementAndGet() == 1 {
                    let response = HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!
                    let data = try TestFixtures.jsonData(["error": "filing_cache_not_found"])
                    return (response, data)
                }
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try Self.chatSuccessData(answer: "最新の決算データで回答しました。", chatsUsed: 1)
                )
            }

            if request.url?.path == "/v1/usage" {
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30)
                )
            }

            XCTAssertEqual(request.url?.path, "/v1/company/AAPL/refresh")
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.companyPayloadData(
                    ticker: newCompany.ticker,
                    cik: newCompany.cik,
                    filingKey: newCompany.filingKey,
                    filedAt: newCompany.filedAt
                )
            )
        }

        let sent = await model.sendChat(question: "売上成長の要因は？", ticker: "AAPL")

        XCTAssertTrue(sent)
        XCTAssertEqual(chatRequests.count, 2)
        XCTAssertEqual(filingKeys.values, [oldCompany.filingKey, newCompany.filingKey])
        XCTAssertEqual(model.companyPayload(for: "AAPL")?.filingKey, newCompany.filingKey)
        XCTAssertNil(model.activeAlert)
        XCTAssertEqual(model.chatHistory(for: "AAPL").last?.content, "最新の決算データで回答しました。")
    }

    func testSendChatFilingCacheMissWithFailedRefreshUsesSanitizedRecoveryCopy() async throws {
        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(), searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.setAIConsent(true)

        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/chat" {
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!,
                    try TestFixtures.jsonData(["error": "Filing cache not found"])
                )
            }

            if request.url?.path == "/v1/usage" {
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30)
                )
            }

            XCTAssertEqual(request.url?.path, "/v1/company/AAPL/refresh")
            return (
                HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData(["error": "SEC data is temporarily unavailable"])
            )
        }

        let sent = await model.sendChat(question: "売上成長の要因は？", ticker: "AAPL")

        XCTAssertFalse(sent)
        let message = try XCTUnwrap(model.activeAlert?.message)
        XCTAssertEqual(
            message,
            "表示中の決算データが古くなりました。右上の更新ボタンで企業データを再読み込みしてから、もう一度お試しください。"
        )
        XCTAssertFalse(message.contains("購入"))
        XCTAssertFalse(message.contains("route_missing"))
        XCTAssertFalse(message.contains("workers.dev"))
        XCTAssertFalse(message.contains("/v1/chat"))
    }

    func testSendChatPresentsLocalizedGenericHTTP503Failure() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.setAIConsent(true)

        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/chat" {
                let response = HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
                return (response, Data())
            }

            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData([
                "plan": "free",
                "chatsUsed": 0,
                "chatLimit": 10,
                "stocksUsed": 0,
                "stockLimit": 3,
                "dateJST": "2026-04-18"
            ])
            return (response, data)
        }

        let sent = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")

        XCTAssertFalse(sent)
        XCTAssertEqual(model.activeAlert?.message, "チャット応答を現在生成できません。少し待ってから、もう一度お試しください。")
    }

    func testSendChatRetryAfterResponseLossReusesOperationId() async throws {
        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(), searchItem: nil)
        let recorder = OperationIDRecorder()
        let model = makeAppModel(persistence: persistence) { request, body in
            guard request.url?.path == "/v1/chat" else { return }
            let body = try XCTUnwrap(body)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            recorder.record(try XCTUnwrap(json["operationId"] as? String))
        }
        model.setAIConsent(true)

        MockAppModelURLProtocol.requestHandler = { request in
            let requestNumber = recorder.operationIds.count

            if requestNumber == 1 {
                throw URLError(.networkConnectionLost)
            }

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try Self.chatSuccessData(answer: "再取得できました。", chatsUsed: 1)
            )
        }

        let firstAttempt = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")
        let retryAttempt = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")

        XCTAssertFalse(firstAttempt)
        XCTAssertTrue(retryAttempt)
        XCTAssertEqual(recorder.operationIds.count, 2)
        XCTAssertEqual(Set(recorder.operationIds).count, 1)
    }

    func testSendChatChangedPayloadAfterResponseLossGetsNewOperationId() async throws {
        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(), searchItem: nil)
        let recorder = OperationIDRecorder()
        let model = makeAppModel(persistence: persistence) { request, body in
            guard request.url?.path == "/v1/chat" else { return }
            let body = try XCTUnwrap(body)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            recorder.record(try XCTUnwrap(json["operationId"] as? String))
        }
        model.setAIConsent(true)

        MockAppModelURLProtocol.requestHandler = { request in
            let requestNumber = recorder.operationIds.count

            if requestNumber == 1 {
                throw URLError(.networkConnectionLost)
            }

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try Self.chatSuccessData(answer: "別の質問に回答しました。", chatsUsed: 1)
            )
        }

        let firstAttempt = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")
        let changedAttempt = await model.sendChat(question: "利益率は？", ticker: "AAPL")

        XCTAssertFalse(firstAttempt)
        XCTAssertTrue(changedAttempt)
        XCTAssertEqual(recorder.operationIds.count, 2)
        XCTAssertNotEqual(recorder.operationIds[0], recorder.operationIds[1])
    }

    func testSendChatSuccessfulUserActionsGetDifferentOperationIds() async throws {
        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(), searchItem: nil)
        let recorder = OperationIDRecorder()
        let model = makeAppModel(persistence: persistence) { request, body in
            guard request.url?.path == "/v1/chat" else { return }
            let body = try XCTUnwrap(body)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            recorder.record(try XCTUnwrap(json["operationId"] as? String))
        }
        model.setAIConsent(true)

        MockAppModelURLProtocol.requestHandler = { request in
            let requestNumber = recorder.operationIds.count
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try Self.chatSuccessData(answer: "回答 \(requestNumber)", chatsUsed: requestNumber)
            )
        }

        let firstAction = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")
        let secondAction = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")

        XCTAssertTrue(firstAction)
        XCTAssertTrue(secondAction)
        XCTAssertEqual(recorder.operationIds.count, 2)
        XCTAssertNotEqual(recorder.operationIds[0], recorder.operationIds[1])
    }

    func testSendChatOperationResultExpiredRetryDoesNotMintNewOperationId() async throws {
        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(), searchItem: nil)
        let recorder = OperationIDRecorder()
        let model = makeAppModel(persistence: persistence) { request, body in
            guard request.url?.path == "/v1/chat" else { return }
            let body = try XCTUnwrap(body)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            recorder.record(try XCTUnwrap(json["operationId"] as? String))
        }
        model.setAIConsent(true)

        MockAppModelURLProtocol.requestHandler = { request in
            return (
                HTTPURLResponse(url: request.url!, statusCode: 410, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData(["error": "operation_result_expired"])
            )
        }

        let firstAttempt = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")
        let retryAttempt = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")

        XCTAssertFalse(firstAttempt)
        XCTAssertFalse(retryAttempt)
        XCTAssertEqual(recorder.operationIds.count, 2)
        XCTAssertEqual(Set(recorder.operationIds).count, 1)
    }

    func testQuoteTranslationOperationReusesExactPayloadAndChangesForNewPayload() {
        let original = PendingQuoteTranslationState(
            text: "Revenue increased.",
            sourceLanguage: "en",
            targetLanguage: "ja",
            operationId: "quote-operation"
        )

        let exactRetry = PendingQuoteTranslationState.resolve(
            existing: original,
            text: "Revenue increased.",
            sourceLanguage: "en",
            targetLanguage: "ja"
        )
        let changedText = PendingQuoteTranslationState.resolve(
            existing: original,
            text: "Operating income increased.",
            sourceLanguage: "en",
            targetLanguage: "ja"
        )
        let changedTarget = PendingQuoteTranslationState.resolve(
            existing: original,
            text: "Revenue increased.",
            sourceLanguage: "en",
            targetLanguage: "fr"
        )

        XCTAssertEqual(exactRetry.operationId, "quote-operation")
        XCTAssertNotEqual(changedText.operationId, "quote-operation")
        XCTAssertNotEqual(changedTarget.operationId, "quote-operation")
    }

    func testTranslateQuoteUsesInjectedClientAndCallerOperationId() async throws {
        let model = makeAppModel()
        let recorder = OperationIDRecorder()

        MockAppModelURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/translate-quote")
            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            recorder.record(try XCTUnwrap(json["operationId"] as? String))
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "translatedText": "売上高は増加しました。",
                    "modelName": "translation-model"
                ])
            )
        }

        let response = try await model.translateQuote(
            text: "Revenue increased.",
            sourceLanguage: "en",
            targetLanguage: "ja",
            operationId: "injected-quote-operation"
        )

        XCTAssertEqual(response.translatedText, "売上高は増加しました。")
        XCTAssertEqual(recorder.operationIds, ["injected-quote-operation"])
    }

    func testSendChatSendsRecentConversationContextForFollowUps() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)
        try persistence.saveChat(
            question: "営業CF",
            response: ChatResponse(
                answer: "営業CFは 312億ドル で、前年同期比 11.0%増です。",
                sources: [],
                responsePath: .deterministic,
                modelName: nil,
                usage: TestFixtures.usagePayload(),
                creditsCharged: nil,
                creditsRemaining: nil
            ),
            for: company
        )

        let model = makeAppModel(persistence: persistence)
        model.setAIConsent(true)
        let chatRequests = ThreadSafeCounter()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            if request.url?.path == "/v1/chat" {
                XCTAssertEqual(chatRequests.incrementAndGet(), 1)
                let body = try XCTUnwrap(Self.requestBodyData(from: request))
                let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
                XCTAssertEqual(json["question"] as? String, "なぜ？")
                let context = try XCTUnwrap(json["conversationContext"] as? [[String: String]])
                XCTAssertEqual(context.map { $0["role"] }, ["user", "assistant"])
                XCTAssertEqual(context.map { $0["content"] }, [
                    "営業CF",
                    "営業CFは 312億ドル で、前年同期比 11.0%増です。"
                ])

                return (
                    response,
                    try TestFixtures.jsonData([
                        "answer": "営業CFの変化理由です。",
                        "sources": [],
                        "responsePath": "deterministic",
                        "modelName": NSNull(),
                        "usage": [
                            "plan": "free",
                            "chatsUsed": 2,
                            "chatLimit": 10,
                            "stocksUsed": 1,
                            "stockLimit": 3,
                            "dateJST": "2026-04-18"
                        ]
                    ])
                )
            }

            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 1,
                    "chatLimit": 10,
                    "stocksUsed": 1,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18"
                ])
            )
        }

        let sent = await model.sendChat(question: "なぜ？", ticker: "AAPL")

        XCTAssertTrue(sent)
        XCTAssertEqual(chatRequests.count, 1)
    }

    func testRemoveFromWatchlistKeepsLocalConversationForNonStarterTickers() async throws {
        UserDefaults.standard.set(["ORCL"], forKey: AppModel.savedTickersKey)
        UserDefaults.standard.set(["ORCL"], forKey: AppModel.recentTickersKey)
        UserDefaults.standard.set("ORCL", forKey: AppModel.lastViewedTickerKey)
        UserDefaults.standard.set("ORCL", forKey: AppModel.activeConversationTickerKey)

        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload(ticker: "ORCL")
        try persistence.saveCompany(company, searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.recordCompanyVisit(ticker: "ORCL")

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            if request.url?.path == "/v1/watchlist/remove" {
                return (
                    response,
                    try TestFixtures.jsonData([
                        "usage": [
                            "plan": "free",
                            "chatsUsed": 0,
                            "chatLimit": 10,
                            "stocksUsed": 0,
                            "stockLimit": 3,
                            "dateJST": "2026-04-18",
                            "savedTickers": []
                        ]
                    ])
                )
            }

            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18",
                    "savedTickers": []
                ])
            )
        }

        await model.removeFromWatchlist("ORCL")

        XCTAssertFalse(model.isTickerInWatchlist("ORCL"))
        XCTAssertNotNil(model.companyPayload(for: "ORCL"))
        XCTAssertNotNil(persistence.loadCompany(ticker: "ORCL"))
        XCTAssertEqual(model.activeConversationTicker, "ORCL")
        XCTAssertEqual(model.lastViewedTicker, "ORCL")
        XCTAssertFalse(model.watchlist.contains(where: { $0.ticker == "ORCL" }))
    }

    func testAddToWatchlistTreatsSameIssuerAliasAsAlreadySaved() async throws {
        let cik = "0001067983"
        UserDefaults.standard.set(["BRK-B"], forKey: AppModel.savedTickersKey)

        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(ticker: "BRK-A", cik: cik), searchItem: nil)

        let model = makeAppModel(persistence: persistence)

        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/watchlist/add" {
                throw URLError(.badServerResponse)
            }

            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData([
                "plan": "free",
                "chatsUsed": 0,
                "chatLimit": 10,
                "stocksUsed": 1,
                "stockLimit": 3,
                "dateJST": "2026-04-18",
                "savedTickers": ["BRK-B"]
            ])
            return (response, data)
        }

        await model.addToWatchlist(
            SearchItem(
                ticker: "BRK.A",
                companyName: "Berkshire Hathaway Inc. Class A",
                cik: cik,
                exchange: "NYSE",
                latestFormType: "10-K"
            )
        )

        XCTAssertEqual(model.activeAlert?.message, "BRK.A はすでに保存済みです。")
        XCTAssertEqual(model.activeConversationTicker, "BRK.A")
        XCTAssertTrue(model.isTickerInWatchlist("BRK.A", cik: cik))
    }

    func testAddToWatchlistOpensConversationWhileCompanyIsPreparing() async throws {
        let persistence = PersistenceController(inMemory: true)
        let model = makeAppModel(persistence: persistence)

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/watchlist/add":
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-kabuyomi-watchlist-mode"), "async")
                return (
                    response,
                    try TestFixtures.watchlistPreparingResponseData()
                )
            case "/v1/company/AAPL":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "status": "preparing",
                        "ticker": "AAPL",
                        "companyName": "Apple Inc.",
                        "cik": "0000320193",
                        "message": "SEC filing is being prepared",
                        "retryAfterSeconds": 5
                    ])
                )
            default:
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": []
                    ])
                )
            }
        }

        await model.addToWatchlist(
            SearchItem(
                ticker: "AAPL",
                companyName: "Apple Inc.",
                cik: "0000320193",
                exchange: "NASDAQ",
                latestFormType: "10-Q"
            )
        )

        XCTAssertTrue(model.isTickerInWatchlist("AAPL", cik: "0000320193"))
        XCTAssertEqual(model.activeConversationTicker, "AAPL")
        XCTAssertNil(model.companyPayload(for: "AAPL"))
        XCTAssertEqual(model.companyLoadState(for: "AAPL")?.status, .preparing)
        XCTAssertEqual(model.watchlist.map(\.ticker), ["AAPL"])
        XCTAssertEqual(model.watchlist.map(\.isPlaceholder), [true])
    }

    func testSaveSearchResultAddsWatchlistWithoutOpeningConversation() async throws {
        let model = makeAppModel()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            if request.url?.path == "/v1/watchlist/add" {
                return (
                    response,
                    try TestFixtures.watchlistAddResponseData(ticker: "AA", cik: "0000004281")
                )
            }

            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18",
                    "savedTickers": []
                ])
            )
        }

        await model.saveSearchResult(
            SearchItem(
                ticker: "AA",
                companyName: "Alcoa Corp",
                cik: "0000004281",
                exchange: "NYSE",
                latestFormType: "10-K"
            )
        )

        XCTAssertTrue(model.isTickerInWatchlist("AA", cik: "0000004281"))
        XCTAssertEqual(model.watchlist.map(\.ticker), ["AA"])
        XCTAssertEqual(model.companyPayload(for: "AA")?.ticker, "AA")
        XCTAssertNil(model.activeConversationTicker)
    }

    func testPreparingCompanyLoadDoesNotWaitForRemoteFetchImmediately() async throws {
        let persistence = PersistenceController(inMemory: true)
        let model = makeAppModel(persistence: persistence)
        let companyRequestCounter = ThreadSafeCounter()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/watchlist/add":
                return (
                    response,
                    try TestFixtures.watchlistPreparingResponseData(retryAfterSeconds: 30)
                )
            case "/v1/company/AAPL":
                _ = companyRequestCounter.incrementAndGet()
                return (
                    response,
                    try TestFixtures.companyPayloadData(ticker: "AAPL", cik: "0000320193")
                )
            default:
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": []
                    ])
                )
            }
        }

        await model.addToWatchlist(
            SearchItem(
                ticker: "AAPL",
                companyName: "Apple Inc.",
                cik: "0000320193",
                exchange: "NASDAQ",
                latestFormType: "10-Q"
            )
        )

        await model.loadCompany(ticker: "AAPL")

        XCTAssertEqual(companyRequestCounter.count, 0)
        XCTAssertFalse(model.isCompanyLoading("AAPL"))
        XCTAssertEqual(model.companyLoadState(for: "AAPL")?.status, .preparing)
    }

    func testPreparingCompanyAutomaticallyRetriesUntilReady() async throws {
        let persistence = PersistenceController(inMemory: true)
        let model = makeAppModel(persistence: persistence)
        let companyRequestCounter = ThreadSafeCounter()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/watchlist/add":
                return (
                    response,
                    try TestFixtures.watchlistPreparingResponseData(retryAfterSeconds: 0)
                )
            case "/v1/company/AAPL":
                let requestCount = companyRequestCounter.incrementAndGet()
                if requestCount == 1 {
                    return (
                        response,
                        try TestFixtures.jsonData([
                            "status": "preparing",
                            "ticker": "AAPL",
                            "companyName": "Apple Inc.",
                            "cik": "0000320193",
                            "message": "SEC filing is being prepared",
                            "retryAfterSeconds": 0
                        ])
                    )
                }

                return (
                    response,
                    try TestFixtures.companyPayloadData(ticker: "AAPL", cik: "0000320193")
                )
            default:
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": []
                    ])
                )
            }
        }

        await model.addToWatchlist(
            SearchItem(
                ticker: "AAPL",
                companyName: "Apple Inc.",
                cik: "0000320193",
                exchange: "NASDAQ",
                latestFormType: "10-Q"
            )
        )
        try? await Task.sleep(nanoseconds: 250_000_000)

        XCTAssertGreaterThanOrEqual(companyRequestCounter.count, 2)
        XCTAssertNotNil(model.companyPayload(for: "AAPL"))
        XCTAssertNil(model.companyLoadState(for: "AAPL"))
        XCTAssertEqual(model.watchlist.map(\.isPlaceholder), [false])
    }

    func testBootstrapKeepsIssuerAliasLocallyAccessibleWhenCanonicalTickerChanges() async throws {
        let cik = "0001067983"
        UserDefaults.standard.set(["BRK-A"], forKey: AppModel.savedTickersKey)
        UserDefaults.standard.set(["BRK-A"], forKey: AppModel.recentTickersKey)
        UserDefaults.standard.set("BRK-A", forKey: AppModel.lastViewedTickerKey)
        UserDefaults.standard.set("BRK-A", forKey: AppModel.activeConversationTickerKey)

        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(ticker: "BRK-A", cik: cik), searchItem: nil)

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/usage":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": ["BRK-B"]
                    ])
                )
            case "/v1/company/BRK-B":
                return (
                    response,
                    try TestFixtures.companyPayloadData(ticker: "BRK-B", cik: cik)
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        let model = AppModel(
            apiClient: makeAPIClient(session: session, deviceIdentity: deviceIdentity),
            persistence: persistence,
            deviceIdentity: deviceIdentity
        )

        await model.bootstrap()
        try? await Task.sleep(nanoseconds: 250_000_000)

        XCTAssertTrue(model.isTickerInWatchlist("BRK-A"))
        XCTAssertTrue(model.isTickerInWatchlist("BRK.B", cik: cik))
        XCTAssertNotNil(model.companyPayload(for: "BRK-A"))
        XCTAssertEqual(model.watchlist.map(\.ticker), ["BRK-B"])
        XCTAssertTrue(model.recentCompanies.isEmpty)
        XCTAssertEqual(model.activeConversationTicker, "BRK-A")
    }

    func testRemoveFromWatchlistKeepsLocalConversationAcrossIssuerAliases() async throws {
        let cik = "0001067983"
        UserDefaults.standard.set(["BRK-B"], forKey: AppModel.savedTickersKey)
        UserDefaults.standard.set(["BRK-A"], forKey: AppModel.recentTickersKey)
        UserDefaults.standard.set("BRK-A", forKey: AppModel.lastViewedTickerKey)
        UserDefaults.standard.set("BRK-A", forKey: AppModel.activeConversationTickerKey)

        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(ticker: "BRK-A", cik: cik), searchItem: nil)

        let model = makeAppModel(persistence: persistence)
        model.recordCompanyVisit(ticker: "BRK-A")

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            if request.url?.path == "/v1/watchlist/remove" {
                return (
                    response,
                    try TestFixtures.jsonData([
                        "usage": [
                            "plan": "free",
                            "chatsUsed": 0,
                            "chatLimit": 10,
                            "stocksUsed": 0,
                            "stockLimit": 3,
                            "dateJST": "2026-04-18",
                            "savedTickers": []
                        ]
                    ])
                )
            }

            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18",
                    "savedTickers": []
                ])
            )
        }

        await model.removeFromWatchlist("BRK-A")

        XCTAssertFalse(model.isTickerInWatchlist("BRK-A"))
        XCTAssertNotNil(model.companyPayload(for: "BRK-A"))
        XCTAssertNotNil(persistence.loadCompany(ticker: "BRK-A"))
        XCTAssertEqual(model.activeConversationTicker, "BRK-A")
        XCTAssertEqual(model.lastViewedTicker, "BRK-A")
        XCTAssertTrue(model.watchlist.isEmpty)
        XCTAssertEqual(model.recentCompanies.map(\.ticker), ["BRK-A"])
    }

    func testAddToWatchlistKeepsMultipleDistinctTickersVisible() async throws {
        let persistence = PersistenceController(inMemory: true)
        let model = makeAppModel(persistence: persistence)
        let aapl = TestFixtures.companyPayload(ticker: "AAPL", cik: "0000320193")
        let amzn = TestFixtures.companyPayload(ticker: "AMZN", cik: "0001018724")

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/watchlist/add":
                let body = try XCTUnwrap(Self.requestBodyData(from: request))
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
                let ticker = try XCTUnwrap(payload["ticker"])
                let company = ticker == "AAPL" ? aapl : amzn
                let savedTickers = ticker == "AAPL" ? ["AAPL"] : ["AAPL", "AMZN"]
                let baseData = try TestFixtures.watchlistAddResponseData(ticker: company.ticker, cik: company.cik)
                var json = try XCTUnwrap(JSONSerialization.jsonObject(with: baseData) as? [String: Any])
                var usage = try XCTUnwrap(json["usage"] as? [String: Any])
                usage["stocksUsed"] = savedTickers.count
                usage["savedTickers"] = savedTickers
                json["usage"] = usage

                return (
                    response,
                    try TestFixtures.jsonData(json)
                )
            default:
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": []
                    ])
                )
            }
        }

        await model.addToWatchlist(
            SearchItem(
                ticker: "AAPL",
                companyName: "Apple Inc.",
                cik: "0000320193",
                exchange: "NASDAQ",
                latestFormType: "10-Q"
            )
        )
        await model.addToWatchlist(
            SearchItem(
                ticker: "AMZN",
                companyName: "AMAZON COM INC",
                cik: "0001018724",
                exchange: "NASDAQ",
                latestFormType: "10-K"
            )
        )

        XCTAssertEqual(model.watchlist.map(\.ticker), ["AAPL", "AMZN"])
        XCTAssertTrue(model.isTickerInWatchlist("AAPL", cik: "0000320193"))
        XCTAssertTrue(model.isTickerInWatchlist("AMZN", cik: "0001018724"))
    }

    func testConcurrentWatchlistAddsDoNotDropEarlierSavedTicker() async throws {
        let persistence = PersistenceController(inMemory: true)
        let model = makeAppModel(persistence: persistence)
        let aapl = TestFixtures.companyPayload(ticker: "AAPL", cik: "0000320193")
        let amzn = TestFixtures.companyPayload(ticker: "AMZN", cik: "0001018724")

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/watchlist/add":
                let body = try XCTUnwrap(Self.requestBodyData(from: request))
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
                let ticker = try XCTUnwrap(payload["ticker"])
                let company = ticker == "AAPL" ? aapl : amzn
                let savedTickers = ticker == "AAPL" ? ["AAPL"] : ["AAPL", "AMZN"]

                if ticker == "AAPL" {
                    Thread.sleep(forTimeInterval: 0.2)
                } else {
                    Thread.sleep(forTimeInterval: 0.02)
                }

                let baseData = try TestFixtures.watchlistAddResponseData(ticker: company.ticker, cik: company.cik)
                var json = try XCTUnwrap(JSONSerialization.jsonObject(with: baseData) as? [String: Any])
                var usage = try XCTUnwrap(json["usage"] as? [String: Any])
                usage["stocksUsed"] = savedTickers.count
                usage["savedTickers"] = savedTickers
                json["usage"] = usage

                return (
                    response,
                    try TestFixtures.jsonData(json)
                )
            default:
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": []
                    ])
                )
            }
        }

        async let first: Void = model.addToWatchlist(
            SearchItem(
                ticker: "AAPL",
                companyName: "Apple Inc.",
                cik: "0000320193",
                exchange: "NASDAQ",
                latestFormType: "10-Q"
            )
        )
        async let second: Void = model.addToWatchlist(
            SearchItem(
                ticker: "AMZN",
                companyName: "AMAZON COM INC",
                cik: "0001018724",
                exchange: "NASDAQ",
                latestFormType: "10-K"
            )
        )

        _ = await (first, second)

        XCTAssertEqual(model.watchlist.map(\.ticker), ["AAPL", "AMZN"])
        XCTAssertEqual(model.usage?.savedTickers, ["AAPL", "AMZN"])
    }

    func testWatchlistAddsReuseStableDeviceKey() async throws {
        let persistence = PersistenceController(inMemory: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        let model = AppModel(
            apiClient: makeAPIClient(session: session, deviceIdentity: deviceIdentity),
            persistence: persistence,
            deviceIdentity: deviceIdentity
        )
        let aapl = TestFixtures.companyPayload(ticker: "AAPL", cik: "0000320193")
        let amzn = TestFixtures.companyPayload(ticker: "AMZN", cik: "0001018724")
        let recorder = DeviceKeyWatchlistRecorder()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/watchlist/add":
                let deviceKey = try XCTUnwrap(request.value(forHTTPHeaderField: "x-device-key"))

                let body = try XCTUnwrap(Self.requestBodyData(from: request))
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
                let ticker = try XCTUnwrap(payload["ticker"])
                let company = ticker == "AAPL" ? aapl : amzn

                let savedTickers = recorder.record(deviceKey: deviceKey, ticker: ticker)

                let baseData = try TestFixtures.watchlistAddResponseData(ticker: company.ticker, cik: company.cik)
                var json = try XCTUnwrap(JSONSerialization.jsonObject(with: baseData) as? [String: Any])
                var usage = try XCTUnwrap(json["usage"] as? [String: Any])
                usage["stocksUsed"] = savedTickers.count
                usage["savedTickers"] = savedTickers
                json["usage"] = usage

                return (response, try TestFixtures.jsonData(json))
            default:
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": []
                    ])
                )
            }
        }

        await model.addToWatchlist(
            SearchItem(
                ticker: "AAPL",
                companyName: "Apple Inc.",
                cik: "0000320193",
                exchange: "NASDAQ",
                latestFormType: "10-Q"
            )
        )
        await model.addToWatchlist(
            SearchItem(
                ticker: "AMZN",
                companyName: "AMAZON COM INC",
                cik: "0001018724",
                exchange: "NASDAQ",
                latestFormType: "10-K"
            )
        )

        XCTAssertEqual(recorder.uniqueDeviceKeyCount, 1)
        XCTAssertEqual(model.watchlist.map(\.ticker), ["AAPL", "AMZN"])
        XCTAssertEqual(model.usage?.savedTickers, ["AAPL", "AMZN"])
    }

    func testStaleUsageRefreshDoesNotOverwriteLaterWatchlistAdds() async throws {
        let persistence = PersistenceController(inMemory: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        let model = AppModel(
            apiClient: makeAPIClient(session: session, deviceIdentity: deviceIdentity),
            persistence: persistence,
            deviceIdentity: deviceIdentity
        )
        let aapl = TestFixtures.companyPayload(ticker: "AAPL", cik: "0000320193")
        let amzn = TestFixtures.companyPayload(ticker: "AMZN", cik: "0001018724")

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/usage":
                Thread.sleep(forTimeInterval: 0.3)
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": ["AMZN"]
                    ])
                )
            case "/v1/watchlist/add":
                let body = try XCTUnwrap(Self.requestBodyData(from: request))
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
                let ticker = try XCTUnwrap(payload["ticker"])
                let company = ticker == "AAPL" ? aapl : amzn
                let savedTickers = ticker == "AAPL" ? ["AAPL"] : ["AAPL", "AMZN"]
                let baseData = try TestFixtures.watchlistAddResponseData(ticker: company.ticker, cik: company.cik)
                var json = try XCTUnwrap(JSONSerialization.jsonObject(with: baseData) as? [String: Any])
                var usage = try XCTUnwrap(json["usage"] as? [String: Any])
                usage["stocksUsed"] = savedTickers.count
                usage["savedTickers"] = savedTickers
                json["usage"] = usage
                return (response, try TestFixtures.jsonData(json))
            default:
                throw URLError(.badServerResponse)
            }
        }

        await model.bootstrap()
        await model.addToWatchlist(
            SearchItem(
                ticker: "AAPL",
                companyName: "Apple Inc.",
                cik: "0000320193",
                exchange: "NASDAQ",
                latestFormType: "10-Q"
            )
        )
        await model.addToWatchlist(
            SearchItem(
                ticker: "AMZN",
                companyName: "AMAZON COM INC",
                cik: "0001018724",
                exchange: "NASDAQ",
                latestFormType: "10-K"
            )
        )
        try? await Task.sleep(nanoseconds: 400_000_000)

        XCTAssertEqual(model.watchlist.map(\.ticker), ["AAPL", "AMZN"])
        XCTAssertEqual(model.usage?.savedTickers, ["AAPL", "AMZN"])
    }

    func testBootstrapShowsPlaceholderForSavedTickerWithoutLocalCard() async throws {
        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(ticker: "AMZN", cik: "0001018724"), searchItem: nil)

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/usage":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 2,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": ["AAPL", "AMZN"]
                    ])
                )
            case "/v1/company/AAPL":
                let failure = HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!
                return (failure, try TestFixtures.jsonData(["error": "Internal server error"]))
            case "/v1/company/AMZN":
                return (
                    response,
                    try TestFixtures.companyPayloadData(ticker: "AMZN", cik: "0001018724")
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        let model = AppModel(
            apiClient: makeAPIClient(session: session, deviceIdentity: deviceIdentity),
            persistence: persistence,
            deviceIdentity: deviceIdentity
        )

        await model.bootstrap()
        try? await Task.sleep(nanoseconds: 500_000_000)

        XCTAssertEqual(model.watchlist.map(\.ticker), ["AAPL", "AMZN"])
        XCTAssertEqual(model.watchlist.map(\.isPlaceholder), [true, false])
    }

    func testBootstrapReconcilesServerWatchlistAndHydratesMissingCards() async {
        let msft = TestFixtures.companyPayload(ticker: "MSFT")
        let model = makeAppModel()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/usage":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18",
                        "savedTickers": ["MSFT"]
                    ])
                )
            case "/v1/company/MSFT":
                return (
                    response,
                    try TestFixtures.companyPayloadData(ticker: "MSFT")
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        await model.bootstrap()
        try? await Task.sleep(nanoseconds: 250_000_000)

        XCTAssertTrue(model.isTickerInWatchlist("MSFT"))
        XCTAssertEqual(model.watchlist.map(\.ticker), ["MSFT"])
        XCTAssertEqual(model.companyPayload(for: "MSFT")?.filingKey, msft.filingKey)
    }

    func testSourceDocumentSearchTermsPreferMatchedExcerptBeforeSectionHeading() {
        let company = TestFixtures.companyPayload()
        let source = LocalMessageSourceRef(
            id: UUID(),
            sourceIdSnapshot: "md1",
            sourceKind: .secFiling,
            sourceLabelSnapshot: "Item 7",
            excerpt: "Management discussion fallback",
            sourceUrl: company.primaryDocumentUrl
        )

        let terms = sourceDocumentSearchTerms(for: source, in: company)

        XCTAssertEqual(terms.first, "Services revenue increased year over year.")
        XCTAssertEqual(terms.last, "Item 7")
    }

    func testSourceDocumentManualHintUsesExcerptBeforeGenericLabel() {
        let company = TestFixtures.companyPayload()
        let source = LocalMessageSourceRef(
            id: UUID(),
            sourceIdSnapshot: nil,
            sourceKind: .secFiling,
            sourceLabelSnapshot: "Part I Item 2",
            excerpt: "Revenue increased year over year because Services and iPhone both grew.",
            sourceUrl: company.primaryDocumentUrl
        )

        XCTAssertEqual(
            sourceDocumentManualHint(for: source, in: company),
            "Revenue increased year over year because Services and iPhone both grew."
        )
    }

    func testSourceDocumentSearchTermsForXBRLPreferMetricAnchorsOverSyntheticNumericText() {
        let company = TestFixtures.companyPayload()
        let source = LocalMessageSourceRef(
            id: UUID(),
            sourceIdSnapshot: "metric-op",
            sourceKind: .secFiling,
            sourceLabelSnapshot: "OperatingIncomeLoss",
            excerpt: "123456000000",
            sourceUrl: company.primaryDocumentUrl
        )

        let terms = sourceDocumentSearchTerms(for: source, in: company)

        XCTAssertEqual(terms.first, "income from operations")
        XCTAssertEqual(sourceDocumentManualHint(for: source, in: company), "income from operations")
        XCTAssertEqual(sourceDocumentSearchMode(for: source, in: company), .tabular)
        XCTAssertFalse(terms.contains("123456000000"))
    }

    func testPreviewTranslationIsOfferedForEnglishSourcePreview() {
        XCTAssertTrue(shouldOfferPreviewTranslation(for: "Trade and other international disputes can have an adverse impact on the overall macroeconomic environment."))
        XCTAssertFalse(shouldOfferPreviewTranslation(for: "提出資料の本文に、増減要因や事業上の論点の説明があります。"))
    }

    func testPreviewTranslationFallbackUsesLocalizedHeuristicWhenAvailable() {
        XCTAssertEqual(
            fallbackPreviewTranslation(for: "Management's Discussion and Analysis of Financial Condition and Results of Operations"),
            "提出資料の本文に、増減要因や事業上の論点の説明があります。"
        )
        XCTAssertNil(
            fallbackPreviewTranslation(for: "Trade and other international disputes can have an adverse impact on the overall macroeconomic environment.")
        )
    }

    func testRewardedAdCreditSuccessRefreshesBalance() async throws {
        let rewardedAdService = MockRewardedAdService(result: true)
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            case "/v1/admob/reward-status":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "status": "granted",
                        "rewardCredits": 2,
                        "creditsRemaining": 32,
                        "dailyRemaining": 2,
                        "usage": try Self.creditUsageObject(rewardedAdRemaining: 2, totalRemaining: 32)
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        await model.earnRewardedAdCredits()

        XCTAssertEqual(rewardedAdService.presentedCustomData, "intent-1.nonce")
        XCTAssertEqual(model.rewardedAdCreditState, .idle)
        XCTAssertEqual(model.rewardedAdStatusMessage, "2無料/ad creditを獲得しました。")
        XCTAssertEqual(model.creditUsage?.rewardedAdRemaining, 2)
        XCTAssertEqual(model.creditUsage?.totalRemaining, 32)
        XCTAssertEqual(model.rewardedAdLastDebugReason, "granted")
        XCTAssertTrue(model.rewardedAdDeveloperDiagnosticLine.contains("API: custom"))
        XCTAssertTrue(model.rewardedAdDeveloperDiagnosticLine.contains("AdUnit:"))
    }

    func testRewardedAdCreditsRecordsReturnDestinationBeforeFlow() {
        let model = makeAppModel()

        model.prepareRewardedAdReturnDestination(.credits, visibleSurface: "credits")

        XCTAssertEqual(model.rewardedAdReturnDestination, .credits)
        XCTAssertTrue(model.shouldRestoreRewardedAdReturnDestination)
    }

    func testRewardedAdCreditSuccessRequestsCreditsReturnDestination() async throws {
        let rewardedAdService = MockRewardedAdService(result: true)
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            case "/v1/admob/reward-status":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "status": "granted",
                        "rewardCredits": 2,
                        "creditsRemaining": 32,
                        "dailyRemaining": 2,
                        "usage": try Self.creditUsageObject(rewardedAdRemaining: 2, totalRemaining: 32)
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        model.prepareRewardedAdReturnDestination(.credits, visibleSurface: "credits")

        await model.earnRewardedAdCredits()

        XCTAssertEqual(model.rewardedAdReturnDestination, .credits)
        XCTAssertNotNil(model.rewardedAdReturnRestorationRequestID)
        XCTAssertTrue(model.shouldRestoreRewardedAdReturnDestination)
        XCTAssertEqual(model.rewardedAdLastDebugReason, "granted")
    }

    func testRewardedAdPendingSSVKeepsCreditsReturnDestination() async {
        let rewardedAdService = MockRewardedAdService(error: RewardedAdServiceError.ssvNotReceivedOrRewardStatusPending)
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        model.prepareRewardedAdReturnDestination(.credits, visibleSurface: "credits")

        await model.earnRewardedAdCredits()

        XCTAssertEqual(model.rewardedAdReturnDestination, .credits)
        XCTAssertNotNil(model.rewardedAdReturnRestorationRequestID)
        XCTAssertTrue(model.shouldRestoreRewardedAdReturnDestination)
        XCTAssertEqual(model.rewardedAdCreditState, .idle)
    }

    func testRewardedAdDismissedWithoutRewardDoesNotPollOrGrant() async {
        let rewardedAdService = MockRewardedAdService(result: false)
        let statusRequestCounter = ThreadSafeCounter()
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            case "/v1/admob/reward-status":
                _ = statusRequestCounter.incrementAndGet()
                throw URLError(.badServerResponse)
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        await model.earnRewardedAdCredits()

        XCTAssertEqual(rewardedAdService.presentedCustomData, "intent-1.nonce")
        XCTAssertEqual(statusRequestCounter.count, 0)
        XCTAssertEqual(model.rewardedAdCreditState, .idle)
        XCTAssertEqual(model.rewardedAdStatusMessage, RewardedAdServiceError.dismissedWithoutReward.localizedDescription)
        XCTAssertEqual(model.creditUsage?.totalRemaining, 30)
        XCTAssertEqual(model.rewardedAdLastDebugReason, "ad_dismissed_without_reward")
    }

    func testRewardedAdDismissedWithoutRewardRequestsCreditsReturnDestination() async {
        let rewardedAdService = MockRewardedAdService(result: false)
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        model.prepareRewardedAdReturnDestination(.credits, visibleSurface: "credits")

        await model.earnRewardedAdCredits()

        XCTAssertEqual(model.rewardedAdReturnDestination, .credits)
        XCTAssertNotNil(model.rewardedAdReturnRestorationRequestID)
        XCTAssertTrue(model.shouldRestoreRewardedAdReturnDestination)
        XCTAssertEqual(model.rewardedAdLastDebugReason, "ad_dismissed_without_reward")
    }

    func testRewardedAdUsageRefreshAfterGrantDoesNotClearCreditsReturnDestination() async {
        let rewardedAdService = MockRewardedAdService(result: true)
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 2, totalRemaining: 32))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            case "/v1/admob/reward-status":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "status": "granted",
                        "rewardCredits": 2,
                        "creditsRemaining": 32,
                        "dailyRemaining": 2,
                        "usage": try Self.creditUsageObject(rewardedAdRemaining: 2, totalRemaining: 32)
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        model.prepareRewardedAdReturnDestination(.credits, visibleSurface: "credits")
        await model.earnRewardedAdCredits()
        let requestID = model.rewardedAdReturnRestorationRequestID

        await model.refreshCreditUsage()

        XCTAssertEqual(model.rewardedAdReturnDestination, .credits)
        XCTAssertEqual(model.rewardedAdReturnRestorationRequestID, requestID)
        XCTAssertTrue(model.shouldRestoreRewardedAdReturnDestination)
    }

    func testRewardedAdManualCreditsCloseSkipsReturnDestinationRestore() {
        let model = makeAppModel()
        model.prepareRewardedAdReturnDestination(.credits, visibleSurface: "credits")

        model.markRewardedAdCreditsClosedByUser()

        XCTAssertNil(model.rewardedAdReturnDestination)
        XCTAssertNil(model.rewardedAdReturnRestorationRequestID)
        XCTAssertFalse(model.shouldRestoreRewardedAdReturnDestination)
    }

    func testRewardedAdPresentFailureMapsAlreadyPresenting() async {
        let rewardedAdService = MockRewardedAdService(error: RewardedAdServiceError.presentFailedAlreadyPresenting)
        let statusRequestCounter = ThreadSafeCounter()
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            case "/v1/admob/reward-status":
                _ = statusRequestCounter.incrementAndGet()
                throw URLError(.badServerResponse)
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        await model.earnRewardedAdCredits()

        XCTAssertEqual(rewardedAdService.presentedCustomData, "intent-1.nonce")
        XCTAssertEqual(statusRequestCounter.count, 0)
        XCTAssertEqual(model.rewardedAdCreditState, .idle)
        XCTAssertEqual(model.rewardedAdStatusMessage, RewardedAdServiceError.presentFailedAlreadyPresenting.localizedDescription)
        XCTAssertEqual(model.rewardedAdLastDebugReason, "rewarded_ad_present_failed_already_presenting")
    }

    func testRewardedAdPendingSSVFailureUsesPreciseDebugReason() async {
        let rewardedAdService = MockRewardedAdService(error: RewardedAdServiceError.ssvNotReceivedOrRewardStatusPending)
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        await model.earnRewardedAdCredits()

        XCTAssertEqual(rewardedAdService.presentedCustomData, "intent-1.nonce")
        XCTAssertEqual(model.rewardedAdCreditState, .idle)
        XCTAssertEqual(model.rewardedAdLastDebugReason, "ssv_not_received_or_reward_status_pending_google_demo_ad_unit_does_not_verify_production_ssv")
        XCTAssertEqual(model.rewardedAdStatusMessage, "DEBUGのGoogleデモ広告では本番SSVが届かないため、クレジット付与確認はできません。Xcode scheme に KABUYOMI_ADMOB_TEST_DEVICE_IDS を設定し、SSV smoke mode をONにしてください。")
        XCTAssertFalse(model.rewardedAdStatusMessage?.contains("広告を表示できませんでした") ?? true)
    }

    #if DEBUG
    func testRewardedAdProductionAPIWithDemoAdUnitBlocksBeforeRewardIntent() async {
        AdMobConfig.setRewardedCreditSSVSmokeModeEnabled(false)
        AdMobConfig.setTestDeviceIdentifiers([])
        let rewardedAdService = MockRewardedAdService(result: true)
        let rewardIntentCounter = ThreadSafeCounter()
        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/admob/reward-intents" {
                _ = rewardIntentCounter.incrementAndGet()
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            if request.url?.path == "/v1/usage" {
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            }
            throw URLError(.badServerResponse)
        }

        let model = makeAppModel(
            rewardedAdService: rewardedAdService,
            baseURL: APIBaseURLResolver.productionURL
        )
        await model.refreshCreditUsage()

        await model.earnRewardedAdCredits()

        XCTAssertNil(rewardedAdService.presentedCustomData)
        XCTAssertEqual(rewardIntentCounter.count, 0)
        XCTAssertEqual(AdMobConfig.rewardedCreditAdUnitID, AdMobConfig.testRewardedCreditAdUnitID)
        XCTAssertEqual(AdMobConfig.rewardedCreditAdUnitKind, "demo")
        XCTAssertEqual(AdMobConfig.rewardedCreditSSVSmokeModeStatus, "off_demo_ad_unit")
        XCTAssertEqual(AdMobConfig.rewardedAdRuntimeMode, .debugDemo)
        XCTAssertEqual(model.rewardedAdCreditState, .idle)
        XCTAssertEqual(model.rewardedAdLastDebugReason, AdMobConfig.debugDemoAdUnitCannotVerifyProductionSSVReason)
        XCTAssertEqual(model.rewardedAdStatusMessage, "DEBUGのGoogleデモ広告では本番SSVが届かないため、クレジット付与確認はできません。Xcode scheme に KABUYOMI_ADMOB_TEST_DEVICE_IDS を設定し、SSV smoke mode をONにしてください。")
    }

    func testRewardedAdSSVSmokeModeRequiresGoogleTestDeviceMode() {
        AdMobConfig.setRewardedCreditSSVSmokeModeEnabled(true)
        AdMobConfig.setTestDeviceIdentifiers([])

        XCTAssertEqual(AdMobConfig.rewardedCreditAdUnitID, AdMobConfig.testRewardedCreditAdUnitID)
        XCTAssertEqual(AdMobConfig.rewardedCreditAdUnitKind, "demo")
        XCTAssertEqual(AdMobConfig.rewardedCreditSSVSmokeModeStatus, "blocked_no_test_device_id")
        XCTAssertEqual(AdMobConfig.rewardedAdRuntimeMode, .debugSmokeBlockedNoTestDevice)
    }

    func testRewardedAdSSVSmokeModeWithoutTestDeviceBlocksBeforeRewardIntent() async {
        AdMobConfig.setRewardedCreditSSVSmokeModeEnabled(true)
        AdMobConfig.setTestDeviceIdentifiers([])
        let rewardedAdService = MockRewardedAdService(result: true)
        let rewardIntentCounter = ThreadSafeCounter()
        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/admob/reward-intents" {
                _ = rewardIntentCounter.incrementAndGet()
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            if request.url?.path == "/v1/usage" {
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            }
            throw URLError(.badServerResponse)
        }

        let model = makeAppModel(
            rewardedAdService: rewardedAdService,
            baseURL: APIBaseURLResolver.productionURL
        )
        await model.refreshCreditUsage()

        await model.earnRewardedAdCredits()

        XCTAssertNil(rewardedAdService.presentedCustomData)
        XCTAssertEqual(rewardIntentCounter.count, 0)
        XCTAssertTrue(model.rewardedAdDeveloperDiagnosticLine.contains("AdUnit: demo"))
        XCTAssertTrue(model.rewardedAdDeveloperDiagnosticLine.contains("SSV smoke: blocked_no_test_device_id"))
        XCTAssertEqual(model.rewardedAdLastDebugReason, AdMobConfig.debugDemoAdUnitCannotVerifyProductionSSVReason)
    }

    func testRewardedAdSSVSmokeModeUsesProductionAdUnitWithTestDeviceMode() {
        AdMobConfig.setRewardedCreditSSVSmokeModeEnabled(true)
        AdMobConfig.setTestDeviceIdentifiers(["test-device-id"])

        XCTAssertEqual(AdMobConfig.rewardedCreditAdUnitID, AdMobConfig.productionRewardedCreditAdUnitID)
        XCTAssertEqual(AdMobConfig.rewardedCreditAdUnitKind, "prod_ssv_smoke")
        XCTAssertEqual(AdMobConfig.rewardedCreditSSVSmokeModeStatus, "on_test_device")
        XCTAssertEqual(AdMobConfig.rewardedAdRuntimeMode, .debugSmokeProductionTestDevice)
    }

    func testRewardedAdProductionSSVSmokeModeAllowsRewardIntentWithTestDeviceMode() async throws {
        AdMobConfig.setRewardedCreditSSVSmokeModeEnabled(true)
        AdMobConfig.setTestDeviceIdentifiers(["test-device-id"])
        let rewardedAdService = MockRewardedAdService(result: true)
        let rewardIntentCounter = ThreadSafeCounter()
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                _ = rewardIntentCounter.incrementAndGet()
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 3
                    ])
                )
            case "/v1/admob/reward-status":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "status": "granted",
                        "rewardCredits": 2,
                        "creditsRemaining": 32,
                        "dailyRemaining": 2,
                        "usage": try Self.creditUsageObject(rewardedAdRemaining: 2, totalRemaining: 32)
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(
            rewardedAdService: rewardedAdService,
            baseURL: APIBaseURLResolver.productionURL
        )
        await model.refreshCreditUsage()

        await model.earnRewardedAdCredits()

        XCTAssertEqual(rewardIntentCounter.count, 1)
        XCTAssertEqual(rewardedAdService.presentedCustomData, "intent-1.nonce")
        XCTAssertEqual(model.rewardedAdLastDebugReason, "granted")
        XCTAssertTrue(model.rewardedAdDeveloperDiagnosticLine.contains("AdUnit: prod_ssv_smoke"))
        XCTAssertTrue(model.rewardedAdDeveloperDiagnosticLine.contains("SSV smoke: on_test_device"))
    }

    func testRewardedAdTestDeviceIdentifiersAreTrimmedDedupedAndMasked() {
        AdMobConfig.setTestDeviceIdentifiers([" test-device-1 ", "", "test-device-2", "test-device-1"])

        XCTAssertEqual(AdMobConfig.testDeviceIdentifiers, ["test-device-1", "test-device-2"])
        XCTAssertEqual(AdMobConfig.testDeviceModeDiagnostic, "configured(2)")
    }
    #endif

    func testRewardedAdDailyCapDisablesGrantFlow() async {
        let rewardedAdService = MockRewardedAdService(result: true)
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/v1/usage":
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30))
            case "/v1/admob/reward-intents":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "rewardIntentId": "intent-1",
                        "customData": "intent-1.nonce",
                        "rewardCredits": 2,
                        "dailyRemaining": 0
                    ])
                )
            default:
                throw URLError(.badServerResponse)
            }
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()
        await model.earnRewardedAdCredits()

        XCTAssertNil(rewardedAdService.presentedCustomData)
        XCTAssertEqual(model.rewardedAdCreditState, .dailyCapReached)
        XCTAssertEqual(model.rewardedAdStatusMessage, "本日の広告報酬上限に達しました。")
        XCTAssertEqual(model.rewardedAdLastDebugReason, "daily_cap_reached")
    }

    func testRewardedAdCreditBillingDisabledReturnsBeforeRewardIntentRequest() async {
        let rewardedAdService = MockRewardedAdService(result: true)
        let requestCounter = ThreadSafeCounter()
        MockAppModelURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/admob/reward-intents" {
                _ = requestCounter.incrementAndGet()
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            if request.url?.path == "/v1/usage" {
                return (response, try Self.creditUsageData(rewardedAdRemaining: 0, totalRemaining: 30, creditBillingEnabled: false))
            }
            throw URLError(.badServerResponse)
        }

        let model = makeAppModel(rewardedAdService: rewardedAdService)
        await model.refreshCreditUsage()

        await model.earnRewardedAdCredits()

        XCTAssertNil(rewardedAdService.presentedCustomData)
        XCTAssertEqual(requestCounter.count, 0)
        XCTAssertEqual(model.rewardedAdLastDebugReason, "credit_billing_disabled")
        XCTAssertEqual(model.rewardedAdCreditState, .idle)
    }

    private func makeAppModel(
        persistence: PersistenceController = PersistenceController(inMemory: true),
        rewardedAdService: RewardedAdServing = MockRewardedAdService(result: false),
        baseURL: URL = URL(string: "https://example.com")!,
        accountCredentialStore: (any AccountCredentialStoring)? = nil,
        subscriptionStore: SubscriptionStore = .shared,
        encodedRequestObserver: ((URLRequest, Data?) throws -> Void)? = nil
    ) -> AppModel {
        if MockAppModelURLProtocol.requestHandler == nil {
            MockAppModelURLProtocol.requestHandler = { request in
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                let data = try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-04-18"
                ])
                return (response, data)
            }
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let deviceIdentity = Self.makeTestDeviceIdentityStore()

        return AppModel(
            apiClient: makeAPIClient(
                session: session,
                deviceIdentity: deviceIdentity,
                baseURL: baseURL,
                accountCredentialStore: accountCredentialStore,
                encodedRequestObserver: encodedRequestObserver
            ),
            persistence: persistence,
            deviceIdentity: deviceIdentity,
            subscriptionStore: subscriptionStore,
            rewardedAdService: rewardedAdService,
            accountCredentialStore: accountCredentialStore
        )
    }

    private func makeBillingUsage(
        creditBillingEnabled: Bool,
        consumablePurchasesEnabled: Bool
    ) -> UsagePayload {
        UsagePayload(
            plan: "free",
            activePlan: nil,
            activeSubscription: nil,
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 0,
            stockLimit: 3,
            dateJST: "2026-07-11",
            savedTickers: [],
            accessMode: nil,
            credits: CreditUsagePayload(
                monthlyRemaining: 0,
                monthlyLimit: 0,
                welcomeRemaining: 50,
                rewardedAdRemaining: 0,
                rewardedAdExpiresAt: nil,
                purchasedRemaining: 0,
                totalRemaining: 50,
                resetsAt: "2026-08-01T00:00:00+09:00"
            ),
            creditBillingEnabled: creditBillingEnabled,
            capabilities: UsageCapabilitiesPayload(
                configVersion: "test",
                configSource: "unit-test",
                chatEnabled: true,
                webSupplementEnabled: false,
                consumablePurchasesEnabled: consumablePurchasesEnabled,
                accountRecoveryReady: consumablePurchasesEnabled,
                rewardedCredit: RewardedCreditCapabilityPayload(
                    enabled: false,
                    rewardedCreditEnabled: false,
                    ssvReady: false,
                    environment: "test",
                    dailyCap: 0,
                    dailyRemaining: 0,
                    rewardCredits: 0,
                    expiryDays: 0,
                    reasonCode: "unit_test",
                    configVersion: "test",
                    emergencyDisabled: true
                )
            )
        )
    }

    private func makeAPIClient(
        session: URLSession,
        deviceIdentity: DeviceIdentityStore,
        baseURL: URL = URL(string: "https://example.com")!,
        accountCredentialStore: (any AccountCredentialStoring)? = nil,
        encodedRequestObserver: ((URLRequest, Data?) throws -> Void)? = nil
    ) -> APIClient {
        let credential = InstallationCredential(
            token: "app-model-test-installation-token",
            principal: "installation:app-model-test",
            tokenReference: "app-model-test-token-reference",
            tokenVersion: 1,
            issuedAt: "2026-07-10T00:00:00.000Z",
            attestationStatus: .verified,
            creditMode: .full
        )
        return APIClient(
            session: session,
            baseURL: baseURL,
            deviceIdentity: deviceIdentity,
            requestContext: QuotaRequestContext(
                deviceKey: deviceIdentity.legacyDeviceKeyForMigration(),
                installationCredential: credential,
                appAttestKeyId: "app-model-test-key"
            ),
            installationIdentityStore: nil,
            appAttestClient: nil,
            accountCredentialStore: accountCredentialStore,
            prevalidatedAssertionHeaders: [
                "x-kabuyomi-app-attest-key-id": "app-model-test-key",
                "x-kabuyomi-app-attest-challenge-id": "app-model-test-challenge",
                "x-kabuyomi-app-attest-assertion": "dGVzdA=="
            ],
            encodedRequestObserver: encodedRequestObserver
        )
    }

    private nonisolated static func clearKabuyomiDefaults() {
        let defaults = UserDefaults.standard
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("kabuyomi.") {
            defaults.removeObject(forKey: key)
        }
    }

    private nonisolated static func requestBodyData(from request: URLRequest) -> Data? {
        if let httpBody = request.httpBody {
            return httpBody
        }

        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }

        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        var data = Data()
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 {
                break
            }
            data.append(buffer, count: read)
        }

        return data.isEmpty ? nil : data
    }

    private nonisolated static func chatSuccessData(answer: String, chatsUsed: Int) throws -> Data {
        try TestFixtures.jsonData([
            "answer": answer,
            "sources": [],
            "responsePath": "deterministic",
            "modelName": NSNull(),
            "usage": [
                "plan": "free",
                "chatsUsed": chatsUsed,
                "chatLimit": 10,
                "stocksUsed": 1,
                "stockLimit": 3,
                "dateJST": "2026-04-18"
            ]
        ])
    }

    private nonisolated static func creditUsageData(
        rewardedAdRemaining: Int,
        totalRemaining: Int,
        creditBillingEnabled: Bool = true
    ) throws -> Data {
        try TestFixtures.jsonData(creditUsageObject(
            rewardedAdRemaining: rewardedAdRemaining,
            totalRemaining: totalRemaining,
            creditBillingEnabled: creditBillingEnabled
        ))
    }

    private nonisolated static func creditUsageObject(
        rewardedAdRemaining: Int,
        totalRemaining: Int,
        creditBillingEnabled: Bool = true
    ) throws -> [String: Any] {
        [
            "plan": "free",
            "chatsUsed": 0,
            "chatLimit": 10,
            "stocksUsed": 0,
            "stockLimit": 3,
            "dateJST": "2026-05-03",
            "credits": [
                "monthlyRemaining": 30,
                "monthlyLimit": 30,
                "rewardedAdRemaining": rewardedAdRemaining,
                "rewardedAdExpiresAt": "2026-06-02T00:00:00.000Z",
                "purchasedRemaining": 0,
                "totalRemaining": totalRemaining,
                "resetsAt": "2026-06-01T00:00:00+09:00"
            ],
            "creditBillingEnabled": creditBillingEnabled
        ]
    }
}

private final class ThreadSafeCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func incrementAndGet() -> Int {
        lock.lock()
        defer { lock.unlock() }
        value += 1
        return value
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

private final class OperationIDRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []

    @discardableResult
    func record(_ operationId: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        values.append(operationId)
        return values.count
    }

    var operationIds: [String] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}

private final class StringRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storedValues: [String] = []

    func record(_ value: String) {
        lock.lock()
        defer { lock.unlock() }
        storedValues.append(value)
    }

    var values: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storedValues
    }
}

private final class DeviceKeyWatchlistRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var seenDeviceKeys: [String] = []
    private var savedTickersByDeviceKey: [String: [String]] = [:]

    func record(deviceKey: String, ticker: String) -> [String] {
        lock.lock()
        defer { lock.unlock() }

        seenDeviceKeys.append(deviceKey)
        var savedTickers = savedTickersByDeviceKey[deviceKey] ?? []
        if !savedTickers.contains(ticker) {
            savedTickers.append(ticker)
        }
        savedTickersByDeviceKey[deviceKey] = savedTickers
        return savedTickers
    }

    var uniqueDeviceKeyCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return Set(seenDeviceKeys).count
    }
}

private final class AccountSignOutRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var path: String?
    private var accountHeader: String?

    func record(_ request: URLRequest) {
        lock.lock()
        defer { lock.unlock() }
        path = request.url?.path
        accountHeader = request.value(forHTTPHeaderField: "x-kabuyomi-account-token")
    }

    var snapshot: (path: String?, accountHeader: String?) {
        lock.lock()
        defer { lock.unlock() }
        return (path, accountHeader)
    }
}

private final class MockAppModelURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

@MainActor
private final class MockRewardedAdService: RewardedAdServing {
    let result: Bool
    let error: Error?
    var presentedCustomData: String?

    init(result: Bool = false, error: Error? = nil) {
        self.result = result
        self.error = error
    }

    func presentRewardedAd(customData: String) async throws -> Bool {
        presentedCustomData = customData
        if let error {
            throw error
        }
        return result
    }
}
