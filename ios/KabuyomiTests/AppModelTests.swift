import XCTest
@testable import Kabuyomi

@MainActor
final class AppModelTests: XCTestCase {
    override func setUp() {
        super.setUp()
        Self.clearKabuyomiDefaults()
        DeviceIdentityStore().reset()
    }

    override func tearDown() {
        MockAppModelURLProtocol.requestHandler = nil
        Self.clearKabuyomiDefaults()
        DeviceIdentityStore().reset()
        super.tearDown()
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

    func testBootstrapDoesNotBlockOnUsageRefresh() async {
        MockAppModelURLProtocol.requestHandler = { request in
            Thread.sleep(forTimeInterval: 1.0)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData([
                "plan": "beta",
                "chatsUsed": 0,
                "chatLimit": 20,
                "stocksUsed": 0,
                "stockLimit": 25,
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

    func testResetLocalDataClearsRecentStateAndRotatesDeviceIdentity() async throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)

        let deviceIdentity = DeviceIdentityStore()
        deviceIdentity.reset()
        let originalDeviceKey = deviceIdentity.deviceKey()

        MockAppModelURLProtocol.requestHandler = { request in
            Thread.sleep(forTimeInterval: 0.05)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData([
                "plan": "beta",
                "chatsUsed": 0,
                "chatLimit": 20,
                "stocksUsed": 0,
                "stockLimit": 25,
                "dateJST": "2026-04-18"
            ])
            return (response, data)
        }

        let model = AppModel(
            apiClient: APIClient(
                session: {
                    let configuration = URLSessionConfiguration.ephemeral
                    configuration.protocolClasses = [MockAppModelURLProtocol.self]
                    return URLSession(configuration: configuration)
                }(),
                baseURL: URL(string: "https://example.com")!
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

        XCTAssertNotEqual(deviceIdentity.deviceKey(), originalDeviceKey)
        XCTAssertEqual(model.usage?.stocksUsed, 0)
    }

    func testResetLocalDataIgnoresStaleUsageRefreshFromPreviousDeviceIdentity() async {
        let deviceIdentity = DeviceIdentityStore()
        deviceIdentity.reset()
        let originalDeviceKey = deviceIdentity.deviceKey()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let deviceKey = request.value(forHTTPHeaderField: "x-device-key")

            if deviceKey == originalDeviceKey {
                Thread.sleep(forTimeInterval: 0.2)
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "beta",
                        "chatsUsed": 3,
                        "chatLimit": 20,
                        "stocksUsed": 9,
                        "stockLimit": 25,
                        "dateJST": "2026-04-18"
                    ])
                )
            }

            Thread.sleep(forTimeInterval: 0.05)
            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "beta",
                    "chatsUsed": 0,
                    "chatLimit": 20,
                    "stocksUsed": 0,
                    "stockLimit": 25,
                    "dateJST": "2026-04-18"
                ])
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)

        let model = AppModel(
            apiClient: APIClient(
                session: session,
                baseURL: URL(string: "https://example.com")!
            ),
            persistence: PersistenceController(inMemory: true),
            deviceIdentity: deviceIdentity
        )

        await model.bootstrap()
        await Task.yield()
        model.resetLocalData()

        try? await Task.sleep(nanoseconds: 350_000_000)

        XCTAssertNotEqual(deviceIdentity.deviceKey(), originalDeviceKey)
        XCTAssertEqual(model.usage?.stocksUsed, 0)
        XCTAssertEqual(model.usage?.chatsUsed, 0)
    }

    func testResetLocalDataKeepsCurrentCompanyLoadIndicatorWhenOldRequestFinishesLater() async {
        let deviceIdentity = DeviceIdentityStore()
        deviceIdentity.reset()
        let originalDeviceKey = deviceIdentity.deviceKey()

        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!

            switch request.url?.path {
            case "/v1/usage":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "plan": "beta",
                        "chatsUsed": 0,
                        "chatLimit": 20,
                        "stocksUsed": 0,
                        "stockLimit": 25,
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
            apiClient: APIClient(
                session: session,
                baseURL: URL(string: "https://example.com")!
            ),
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
                    "plan": "beta",
                    "chatsUsed": 0,
                    "chatLimit": 20,
                    "stocksUsed": 0,
                    "stockLimit": 25,
                    "dateJST": "2026-04-18"
                ])
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let model = AppModel(
            apiClient: APIClient(
                session: session,
                baseURL: URL(string: "https://example.com")!
            ),
            persistence: PersistenceController(inMemory: true),
            deviceIdentity: DeviceIdentityStore()
        )

        await model.search(query: "BRK.B")

        XCTAssertEqual(model.searchResults.map(\.ticker), ["BRK-B", "BRK-A"])
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
                "plan": "beta",
                "chatsUsed": 0,
                "chatLimit": 20,
                "stocksUsed": 0,
                "stockLimit": 25,
                "dateJST": "2026-04-18"
            ])
            return (response, data)
        }

        let sent = await model.sendChat(question: "今回の変化は？", ticker: "AAPL")

        XCTAssertFalse(sent)
        XCTAssertEqual(model.activeAlert?.message, "チャット応答を現在生成できません。少し待ってから、もう一度お試しください。")
    }

    func testRemoveFromWatchlistRevokesLocalAccessForNonStarterTickers() async throws {
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
                            "plan": "beta",
                            "chatsUsed": 0,
                            "chatLimit": 20,
                            "stocksUsed": 0,
                            "stockLimit": 25,
                            "dateJST": "2026-04-18",
                            "savedTickers": []
                        ]
                    ])
                )
            }

            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "beta",
                    "chatsUsed": 0,
                    "chatLimit": 20,
                    "stocksUsed": 0,
                    "stockLimit": 25,
                    "dateJST": "2026-04-18",
                    "savedTickers": []
                ])
            )
        }

        await model.removeFromWatchlist("ORCL")

        XCTAssertFalse(model.isTickerInWatchlist("ORCL"))
        XCTAssertNil(model.companyPayload(for: "ORCL"))
        XCTAssertNil(persistence.loadCompany(ticker: "ORCL"))
        XCTAssertNil(model.activeConversationTicker)
        XCTAssertNil(model.lastViewedTicker)
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
                "plan": "beta",
                "chatsUsed": 0,
                "chatLimit": 20,
                "stocksUsed": 1,
                "stockLimit": 25,
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
                        "plan": "beta",
                        "chatsUsed": 0,
                        "chatLimit": 20,
                        "stocksUsed": 1,
                        "stockLimit": 25,
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
        let model = AppModel(
            apiClient: APIClient(
                session: session,
                baseURL: URL(string: "https://example.com")!
            ),
            persistence: persistence,
            deviceIdentity: DeviceIdentityStore()
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

    func testRemoveFromWatchlistRevokesLocalAccessAcrossIssuerAliases() async throws {
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
                            "plan": "beta",
                            "chatsUsed": 0,
                            "chatLimit": 20,
                            "stocksUsed": 0,
                            "stockLimit": 25,
                            "dateJST": "2026-04-18",
                            "savedTickers": []
                        ]
                    ])
                )
            }

            return (
                response,
                try TestFixtures.jsonData([
                    "plan": "beta",
                    "chatsUsed": 0,
                    "chatLimit": 20,
                    "stocksUsed": 0,
                    "stockLimit": 25,
                    "dateJST": "2026-04-18",
                    "savedTickers": []
                ])
            )
        }

        await model.removeFromWatchlist("BRK-A")

        XCTAssertFalse(model.isTickerInWatchlist("BRK-A"))
        XCTAssertNil(model.companyPayload(for: "BRK-A"))
        XCTAssertNil(persistence.loadCompany(ticker: "BRK-A"))
        XCTAssertNil(model.activeConversationTicker)
        XCTAssertNil(model.lastViewedTicker)
        XCTAssertTrue(model.watchlist.isEmpty)
        XCTAssertTrue(model.recentCompanies.isEmpty)
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
                        "plan": "beta",
                        "chatsUsed": 0,
                        "chatLimit": 20,
                        "stocksUsed": 0,
                        "stockLimit": 25,
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
                        "plan": "beta",
                        "chatsUsed": 0,
                        "chatLimit": 20,
                        "stocksUsed": 2,
                        "stockLimit": 25,
                        "dateJST": "2026-04-18",
                        "savedTickers": ["AAPL", "AMZN"]
                    ])
                )
            case "/v1/company/AAPL":
                let failure = HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!
                return (failure, try TestFixtures.jsonData(["error": "Internal server error"]))
            default:
                throw URLError(.badServerResponse)
            }
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let model = AppModel(
            apiClient: APIClient(
                session: session,
                baseURL: URL(string: "https://example.com")!
            ),
            persistence: persistence,
            deviceIdentity: DeviceIdentityStore()
        )

        await model.bootstrap()
        try? await Task.sleep(nanoseconds: 250_000_000)

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
                        "plan": "beta",
                        "chatsUsed": 0,
                        "chatLimit": 20,
                        "stocksUsed": 1,
                        "stockLimit": 25,
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

    private func makeAppModel(persistence: PersistenceController = PersistenceController(inMemory: true)) -> AppModel {
        MockAppModelURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try TestFixtures.jsonData([
                "plan": "beta",
                "chatsUsed": 0,
                "chatLimit": 20,
                "stocksUsed": 0,
                "stockLimit": 25,
                "dateJST": "2026-04-18"
            ])
            return (response, data)
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockAppModelURLProtocol.self]
        let session = URLSession(configuration: configuration)

        return AppModel(
            apiClient: APIClient(
                session: session,
                baseURL: URL(string: "https://example.com")!
            ),
            persistence: persistence,
            deviceIdentity: DeviceIdentityStore()
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
