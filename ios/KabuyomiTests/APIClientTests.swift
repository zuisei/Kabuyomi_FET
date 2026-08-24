import Foundation
import XCTest
@testable import Kabuyomi

private let apiClientTestCredential = InstallationCredential(
    token: "test-installation-token",
    principal: "installation:test-principal",
    tokenReference: "test-token-reference",
    tokenVersion: 1,
    issuedAt: "2026-07-10T00:00:00.000Z",
    attestationStatus: .verified,
    creditMode: .full
)

@MainActor
private final class InMemoryAccountCredentialStore: AccountCredentialStoring {
    var credential: AccountCredential?

    func load() throws -> AccountCredential? { credential }
    func save(_ credential: AccountCredential) throws { self.credential = credential }
    func clear() throws { credential = nil }
}

@MainActor
final class APIClientTests: XCTestCase {
    private let standardContext = QuotaRequestContext(
        deviceKey: "device-123",
        installationCredential: apiClientTestCredential,
        appAttestKeyId: "test-app-attest-key"
    )
    private let proContext = QuotaRequestContext(
        deviceKey: "device-123",
        installationCredential: apiClientTestCredential,
        appAttestKeyId: "test-app-attest-key",
        originalTransactionId: "tx-123"
    )
    private let devContext = QuotaRequestContext(
        deviceKey: "device-123",
        installationCredential: apiClientTestCredential,
        appAttestKeyId: "test-app-attest-key",
        detachedAccessMode: .devUnlimited
    )

    override func tearDown() {
        MockURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func testSearchBuildsQueryRequest() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/search?q=MSFT")
            XCTAssertEqual(request.httpMethod, "GET")
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.searchResponseData()
            )
        }

        let items = try await client.search(query: "MSFT")

        XCTAssertEqual(items.map(\.ticker), ["MSFT"])
    }

    #if DEBUG
    func testUsesSelectedDebugAPIBaseURLWhenNoExplicitOverride() async throws {
        let defaults = UserDefaults.standard
        let previousValue = defaults.string(forKey: APIBaseURLResolver.debugEnvironmentDefaultsKey)
        defaults.set(APIEnvironment.test.rawValue, forKey: APIBaseURLResolver.debugEnvironmentDefaultsKey)
        defer {
            if let previousValue {
                defaults.set(previousValue, forKey: APIBaseURLResolver.debugEnvironmentDefaultsKey)
            } else {
                defaults.removeObject(forKey: APIBaseURLResolver.debugEnvironmentDefaultsKey)
            }
        }

        let client = makeClient(baseURL: nil) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://kabuyomi-api-test.dznqjmctk7.workers.dev/v1/search?q=MSFT")
            XCTAssertEqual(request.httpMethod, "GET")
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.searchResponseData()
            )
        }

        let items = try await client.search(query: "MSFT")

        XCTAssertEqual(items.map(\.ticker), ["MSFT"])
    }
    #endif

    func testSearchItemAllowsUnknownFilingStatusToBeVerifiedOnOpenOrSave() {
        let item = SearchItem(
            ticker: "SSB",
            companyName: "SouthState Bank Corp",
            cik: "0000764038",
            exchange: "NYSE",
            latestFormType: nil
        )

        XCTAssertFalse(item.hasSupportedLatestFiling)
        XCTAssertFalse(item.isSupportedInV1)
        XCTAssertTrue(item.canAttemptInV1)
        XCTAssertTrue(item.requiresFilingVerification)
        XCTAssertEqual(item.supportDisplayLabel, "対応書類 未確認")
        XCTAssertEqual(item.availabilityNote, "保存または表示時に対応書類を確認します。")
    }

    /// 20-F は外国企業(ADR)の年次報告で、10-K に相当する。
    /// TSM・ASML・SAP・トヨタ等は 10-K / 10-Q を 1 本も出さないので、
    /// ここが未対応のままだと検索しても「未対応」としか出ない(2026-08-24 に対応)。
    func testSearchItemTreatsTwentyFAsSupported() {
        let item = SearchItem(
            ticker: "TSM",
            companyName: "Taiwan Semiconductor Manufacturing Co Ltd",
            cik: "0001046179",
            exchange: "NYSE",
            latestFormType: "20-F"
        )

        XCTAssertTrue(item.hasSupportedLatestFiling)
        XCTAssertEqual(item.supportDisplayLabel, "最新 20-F")
        XCTAssertEqual(item.availabilityBadgeTitle, "保存可")
    }

    func testSearchItemBlocksKnownUnsupportedFilingStatus() {
        let item = SearchItem(
            ticker: "SSL",
            companyName: "SASOL LTD",
            cik: "0000314590",
            exchange: "NYSE",
            latestFormType: "6-K"
        )

        XCTAssertFalse(item.hasSupportedLatestFiling)
        XCTAssertFalse(item.isSupportedInV1)
        XCTAssertFalse(item.canAttemptInV1)
        XCTAssertFalse(item.requiresFilingVerification)
        XCTAssertEqual(item.supportDisplayLabel, "6-K 対象")
    }

    func testAddToWatchlistSendsDeviceHeaderAndJSONBody() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/watchlist/add")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-kabuyomi-watchlist-mode"), "async")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")

            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
            XCTAssertEqual(json["ticker"], "AAPL")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.watchlistAddResponseData()
            )
        }

        let response = try await client.addToWatchlist(ticker: "AAPL")

        let company = try XCTUnwrap(response.company)
        XCTAssertEqual(company.ticker, "AAPL")
        XCTAssertNil(response.loadState)
        XCTAssertEqual(response.usage.stocksUsed, 1)
    }

    func testAddToWatchlistDecodesPreparingState() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/watchlist/add")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-kabuyomi-watchlist-mode"), "async")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.watchlistPreparingResponseData()
            )
        }

        let response = try await client.addToWatchlist(ticker: "AAPL")

        XCTAssertNil(response.company)
        XCTAssertEqual(response.loadState?.status, .preparing)
        XCTAssertEqual(response.loadState?.ticker, "AAPL")
        XCTAssertEqual(response.usage.savedTickers, ["AAPL"])
    }

    func testFetchCompanyDecodesCompanyWebsiteURLWhenPresent() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/company/AAPL")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.companyPayloadData()
            )
        }

        let response = try await client.fetchCompany(ticker: "AAPL")

        guard case .company(let company) = response else {
            XCTFail("Expected company payload")
            return
        }
        XCTAssertEqual(company.companyWebsiteUrl, "https://www.aapl.com")
    }

    func testFetchCompanyDecodesRetryableCompanyState() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/company/AAPL")
            XCTAssertEqual(request.httpMethod, "GET")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "status": "failed_retryable",
                    "ticker": "AAPL",
                    "message": "SEC data is temporarily unavailable",
                    "retryAfterSeconds": 60
                ])
            )
        }

        let response = try await client.fetchCompany(ticker: "AAPL")

        guard case .retryable(let state) = response else {
            XCTFail("Expected retryable company state")
            return
        }
        XCTAssertEqual(state.status, .failedRetryable)
        XCTAssertEqual(state.ticker, "AAPL")
        XCTAssertEqual(state.displayMessage, "SEC data is temporarily unavailable")
        XCTAssertEqual(state.retryAfterSeconds, 60)
    }

    func testFetchCompanyDecodesStaleReadyCompanyStatus() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/company/AAPL")
            let base = try JSONSerialization.jsonObject(with: TestFixtures.companyPayloadData()) as? [String: Any]
            var payload = try XCTUnwrap(base)
            payload["status"] = "stale_ready"
            payload["statusMessage"] = "SEC data is temporarily unavailable"
            payload["retryAfterSeconds"] = 60

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData(payload)
            )
        }

        let response = try await client.fetchCompany(ticker: "AAPL")

        guard case .company(let company) = response else {
            XCTFail("Expected stale company payload")
            return
        }
        XCTAssertTrue(company.isStaleReady)
        XCTAssertEqual(company.statusMessage, "SEC data is temporarily unavailable")
        XCTAssertEqual(company.retryAfterSeconds, 60)
    }

    func testFetchUsageSendsDeviceHeader() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/usage")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 1,
                    "chatLimit": 10,
                    "stocksUsed": 1,
                    "stockLimit": 3,
                    "dateJST": "2026-04-17",
                    "savedTickers": ["AAPL"]
                ])
            )
        }

        let usage = try await client.fetchUsage()

        XCTAssertEqual(usage.chatsUsed, 1)
        XCTAssertEqual(usage.chatLimit, 10)
        XCTAssertEqual(usage.savedTickers, ["AAPL"])
    }

    func testFetchUsageIncludesOriginalTransactionIdWhenPresent() async throws {
        let client = makeClient(context: proContext) { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-kabuyomi-original-transaction-id"), "tx-123")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "plan": "pro",
                    "chatsUsed": 2,
                    "chatLimit": 50,
                    "stocksUsed": 4,
                    "stockLimit": 20,
                    "dateJST": "2026-04-20",
                    "savedTickers": ["AAPL", "MSFT", "AMZN", "NVDA"]
                ])
            )
        }

        let usage = try await client.fetchUsage()

        XCTAssertEqual(usage.plan, "pro")
        XCTAssertEqual(usage.chatLimit, 50)
        XCTAssertEqual(usage.stockLimit, 20)
    }

    func testFetchUsageKeepsEntitlementLocatorHeaderWhenLocalSubscriptionIsInactive() async throws {
        let suiteName = "APIClientTests.inactive-entitlement-locator.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(false, forKey: "kabuyomi.subscription.active")
        defaults.set("orig-inactive-12345678", forKey: "kabuyomi.subscription.originalTransactionId")
        let subscriptionStore = SubscriptionStore(defaults: defaults)

        let client = makeClient(subscriptionStore: subscriptionStore) { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "x-kabuyomi-original-transaction-id"),
                "orig-inactive-12345678"
            )

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-07-10",
                    "savedTickers": []
                ])
            )
        }

        _ = try await client.fetchUsage()
        XCTAssertEqual(subscriptionStore.entitlementLookupOriginalTransactionId, "orig-inactive-12345678")
    }

    func testSyncBillingSendsDeviceBindingHeaders() async throws {
        let client = makeClient(context: proContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/ios/subscriptions/sync")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-kabuyomi-original-transaction-id"), "tx-123")

            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["originalTransactionId"] as? String, "orig-tx-123")
            XCTAssertEqual(json["transactionId"] as? String, "tx-123")
            XCTAssertEqual(json["productId"] as? String, "kabuyomi.sub.pro.monthly")
            XCTAssertEqual(json["signedTransactionInfo"] as? String, "signed-jws")
            XCTAssertNil(json["active"])
            XCTAssertEqual(
                Set(json.keys),
                Set(["originalTransactionId", "transactionId", "productId", "signedTransactionInfo"])
            )

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "plan": "pro",
                    "quotaSubject": "pro:abcdef",
                    "productId": "kabuyomi.sub.pro.monthly",
                    "activePlan": "pro",
                    "activeSubscription": [
                        "plan": "pro",
                        "productId": "kabuyomi.sub.pro.monthly",
                        "originalTransactionId": "orig-tx-123",
                        "transactionId": "tx-123",
                        "periodStart": "2026-05-01T00:00:00.000Z",
                        "periodEnd": "2026-06-01T00:00:00.000Z",
                        "expiresAt": "2026-06-01T00:00:00.000Z",
                        "monthlyCredits": 900
                    ],
                    "syncedAt": "2026-04-26T00:00:00.000Z"
                ])
            )
        }

        let response = try await client.syncBilling(
            BillingSyncRequest(
                originalTransactionId: "orig-tx-123",
                transactionId: "tx-123",
                productId: "kabuyomi.sub.pro.monthly",
                signedTransactionInfo: "signed-jws"
            )
        )

        XCTAssertEqual(response.plan, "pro")
        XCTAssertEqual(response.quotaSubject, "pro:abcdef")
        XCTAssertEqual(response.activeSubscription?.monthlyCredits, 900)
    }

    func testSyncBilling404MapsToRouteMissingWithEndpointDetails() async throws {
        let client = makeClient(context: proContext) { request in
            XCTAssertEqual(request.url?.path, "/v1/ios/subscriptions/sync")
            return (
                HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData(["error": "Not found"])
            )
        }

        do {
            _ = try await client.syncBilling(
                BillingSyncRequest(
                    originalTransactionId: "orig-tx-123",
                    transactionId: "tx-123",
                    productId: "kabuyomi.sub.pro.monthly",
                    signedTransactionInfo: "signed-jws"
                )
            )
            XCTFail("Expected routeMissing")
        } catch let error as APIError {
            XCTAssertEqual(
                error,
                .routeMissing(
                    statusCode: 404,
                    path: "/v1/ios/subscriptions/sync",
                    url: "https://example.com/v1/ios/subscriptions/sync",
                    message: "Not found"
                )
            )
        }
    }

    func testFetchUsageIncludesDetachedAccessHeaderWhenPresent() async throws {
        let client = makeClient(context: devContext) { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-kabuyomi-detached-access"), "dev_unlimited")
            XCTAssertNil(request.value(forHTTPHeaderField: "x-kabuyomi-original-transaction-id"))

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "plan": "pro",
                    "accessMode": "dev_unlimited",
                    "chatsUsed": 0,
                    "chatLimit": 999999,
                    "stocksUsed": 0,
                    "stockLimit": 999999,
                    "dateJST": "2026-04-20",
                    "savedTickers": []
                ])
            )
        }

        let usage = try await client.fetchUsage()

        XCTAssertEqual(usage.displayPlanLabel, "DEV")
        XCTAssertEqual(usage.displayChatLimit, "∞")
        XCTAssertEqual(usage.displayStockLimit, "∞")
    }

    func testSendChatDecodesResponsePathWhenPresent() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/chat")
            XCTAssertEqual(request.httpMethod, "POST")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "answer": "営業利益率は改善しました。",
                    "sources": [
                        [
                            "sourceId": "metric-op",
                            "sourceKind": "sec_filing",
                            "sectionType": "xbrl_metric",
                            "sourceLabel": "OperatingIncomeLoss",
                            "excerpt": "123456000000",
                            "sourceUrl": "https://www.sec.gov/Archives/AAPL.htm"
                        ]
                    ],
                    "responsePath": "gemini",
                    "modelName": "gemini-2.5-flash",
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 1,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ]
                ])
            )
        }

        let response = try await client.sendChat(
            filingKey: "v1:AAPL:0000320193-24-000001",
            question: "今回の変化は？",
            operationId: "chat-response-path-operation"
        )

        XCTAssertEqual(response.responsePath, .gemini)
        XCTAssertEqual(response.modelName, "gemini-2.5-flash")
        XCTAssertEqual(response.sources.first?.sourceUrl, "https://www.sec.gov/Archives/AAPL.htm")
    }

    func testUnsupportedAppAttestUsesInstallationCredentialForCoreChatWithoutAssertion() async throws {
        let credential = InstallationCredential(
            token: "unsupported-installation-token",
            principal: "installation:unsupported-device",
            tokenReference: "unsupported-token-reference",
            tokenVersion: 1,
            issuedAt: "2026-07-11T00:00:00.000Z",
            attestationStatus: .unavailable,
            creditMode: .none
        )
        let context = QuotaRequestContext(
            deviceKey: "legacy-unsupported-device",
            installationCredential: credential,
            appAttestKeyId: nil
        )
        let client = makeClient(context: context) { request in
            XCTAssertEqual(request.url?.path, "/v1/chat")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Authorization"),
                "Installation unsupported-installation-token"
            )
            XCTAssertNil(request.value(forHTTPHeaderField: "x-kabuyomi-app-attest-key-id"))
            XCTAssertNil(request.value(forHTTPHeaderField: "x-kabuyomi-app-attest-challenge-id"))
            XCTAssertNil(request.value(forHTTPHeaderField: "x-kabuyomi-app-attest-assertion"))
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "answer": "利用可能です。",
                    "sources": [],
                    "responsePath": "deterministic",
                    "modelName": NSNull(),
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 1,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-07-11"
                    ]
                ])
            )
        }

        XCTAssertTrue(client.authenticatedCreditActionsAvailable)
        XCTAssertFalse(client.fraudSensitiveCreditActionsAvailable)
        let response = try await client.sendChat(
            filingKey: "v1:AAPL:0000320193-24-000001",
            question: "売上高は？",
            operationId: "unsupported-core-chat"
        )
        XCTAssertEqual(response.answer, "利用可能です。")
    }

    func testUnsupportedAppAttestRejectsFraudSensitiveRewardIntentBeforeNetwork() async {
        let credential = InstallationCredential(
            token: "unsupported-installation-token",
            principal: "installation:unsupported-device",
            tokenReference: "unsupported-token-reference",
            tokenVersion: 1,
            issuedAt: "2026-07-11T00:00:00.000Z",
            attestationStatus: .unavailable,
            creditMode: .none
        )
        let client = makeClient(context: QuotaRequestContext(
            deviceKey: "legacy-unsupported-device",
            installationCredential: credential,
            appAttestKeyId: nil
        )) { request in
            XCTFail("Fraud-sensitive request reached the network: \(request.url?.path ?? "")")
            throw URLError(.badServerResponse)
        }

        do {
            _ = try await client.createAdMobRewardIntent()
            XCTFail("Expected unsupported App Attest to block the reward intent")
        } catch let error as InstallationIdentityError {
            guard case .appAttestUnavailable = error else {
                return XCTFail("Unexpected identity error: \(error)")
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testPendingAttestationRejectsCoreMutationBeforeNetwork() async {
        let credential = InstallationCredential(
            token: "pending-installation-token",
            principal: "installation:pending-device",
            tokenReference: "pending-token-reference",
            tokenVersion: 1,
            issuedAt: "2026-07-11T00:00:00.000Z",
            attestationStatus: .pending,
            creditMode: .none
        )
        let client = makeClient(context: QuotaRequestContext(
            deviceKey: "legacy-pending-device",
            installationCredential: credential,
            appAttestKeyId: "pending-app-attest-key"
        )) { request in
            XCTFail("Pending identity request reached the network: \(request.url?.path ?? "")")
            throw URLError(.badServerResponse)
        }

        XCTAssertFalse(client.authenticatedCreditActionsAvailable)
        do {
            _ = try await client.sendChat(
                filingKey: "v1:AAPL:0000320193-24-000001",
                question: "売上高は？",
                operationId: "pending-core-chat"
            )
            XCTFail("Expected pending attestation to block the chat")
        } catch let error as InstallationIdentityError {
            guard case .attestationNotVerified = error else {
                return XCTFail("Unexpected identity error: \(error)")
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testSendChatIncludesConversationContext() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/chat")
            XCTAssertEqual(request.httpMethod, "POST")

            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["filingKey"] as? String, "v1:AAPL:0000320193-24-000001")
            XCTAssertEqual(json["question"] as? String, "なぜ？")
            XCTAssertEqual(json["operationId"] as? String, "chat-context-operation")
            let context = try XCTUnwrap(json["conversationContext"] as? [[String: String]])
            XCTAssertEqual(context, [
                ["role": "user", "content": "営業CF"],
                ["role": "assistant", "content": "営業CFは 312億ドル です。"]
            ])

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "answer": "営業CFの理由です。",
                    "sources": [],
                    "responsePath": "deterministic",
                    "modelName": NSNull(),
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 1,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ]
                ])
            )
        }

        let response = try await client.sendChat(
            filingKey: "v1:AAPL:0000320193-24-000001",
            question: "なぜ？",
            conversationContext: [
                ChatContextMessage(role: "user", content: "営業CF"),
                ChatContextMessage(role: "assistant", content: "営業CFは 312億ドル です。")
            ],
            operationId: "chat-context-operation"
        )

        XCTAssertEqual(response.responsePath, .deterministic)
    }

    func testSendChatPollsExecutionPendingUsingSameOperationId() async throws {
        let recorder = OperationIDRecorder()
        let client = makeClient(context: standardContext) { request in
            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let operationId = try XCTUnwrap(json["operationId"] as? String)
            let requestNumber = recorder.record(operationId)

            if requestNumber == 1 {
                return (
                    HTTPURLResponse(
                        url: request.url!,
                        statusCode: 202,
                        httpVersion: nil,
                        headerFields: ["Retry-After": "0"]
                    )!,
                    try TestFixtures.jsonData([
                        "error": "execution_pending",
                        "retryAfterSeconds": 0
                    ])
                )
            }

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "answer": "再試行で同じ結果を取得しました。",
                    "sources": [],
                    "responsePath": "deterministic",
                    "modelName": NSNull(),
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 1,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ]
                ])
            )
        }

        let response = try await client.sendChat(
            filingKey: "v1:AAPL:0000320193-24-000001",
            question: "今回の変化は？",
            operationId: "chat-pending-operation"
        )

        XCTAssertEqual(response.answer, "再試行で同じ結果を取得しました。")
        XCTAssertEqual(recorder.operationIds, ["chat-pending-operation", "chat-pending-operation"])
    }

    func testSendChatSurfacesOperationResultExpiredWithoutChangingOperationId() async {
        let recorder = OperationIDRecorder()
        let client = makeClient(context: standardContext) { request in
            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            recorder.record(try XCTUnwrap(json["operationId"] as? String))

            return (
                HTTPURLResponse(url: request.url!, statusCode: 410, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData(["error": "operation_result_expired"])
            )
        }

        do {
            let _: ChatResponse = try await client.sendChat(
                filingKey: "v1:AAPL:0000320193-24-000001",
                question: "今回の変化は？",
                operationId: "chat-expired-operation"
            )
            XCTFail("Expected operation_result_expired")
        } catch {
            XCTAssertEqual(error as? APIError, .operationResultExpired)
        }

        XCTAssertEqual(recorder.operationIds, ["chat-expired-operation"])
    }

    func testSendChatDecodesLegacyResponseWithoutResponsePath() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/chat")
            XCTAssertEqual(request.httpMethod, "POST")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "answer": "営業利益率は改善しました。",
                    "sources": [
                        [
                            "sourceId": "metric-op",
                            "sourceKind": "sec_filing",
                            "sectionType": "xbrl_metric",
                            "sourceLabel": "OperatingIncomeLoss",
                            "excerpt": "123456000000"
                        ]
                    ],
                    "modelName": NSNull(),
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 1,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ]
                ])
            )
        }

        let response = try await client.sendChat(
            filingKey: "v1:AAPL:0000320193-24-000001",
            question: "今回の変化は？",
            operationId: "chat-legacy-operation"
        )

        XCTAssertNil(response.responsePath)
        XCTAssertNil(response.modelName)
    }

    func testSendChatDecodesOpenAIResponsePath() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/chat")
            XCTAssertEqual(request.httpMethod, "POST")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "answer": "売上の主な要因です。",
                    "sources": [],
                    "responsePath": "openai",
                    "modelName": "gpt-5-nano",
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 1,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ]
                ])
            )
        }

        let response = try await client.sendChat(
            filingKey: "v1:AAPL:0000320193-24-000001",
            question: "今回の変化は？",
            operationId: "chat-openai-operation"
        )

        XCTAssertEqual(response.responsePath, .openai)
        XCTAssertEqual(response.modelName, "gpt-5-nano")
        XCTAssertEqual(response.responsePath?.usesRemoteModel, true)
    }

    func testSendChatDoesNotFailOnUnknownResponsePath() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/chat")
            XCTAssertEqual(request.httpMethod, "POST")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "answer": "回答です。",
                    "sources": [],
                    "responsePath": "future_provider",
                    "modelName": "future-model",
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 1,
                        "chatLimit": 10,
                        "stocksUsed": 1,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ]
                ])
            )
        }

        let response = try await client.sendChat(
            filingKey: "v1:AAPL:0000320193-24-000001",
            question: "今回の変化は？",
            operationId: "chat-unknown-path-operation"
        )

        XCTAssertEqual(response.responsePath, .unknown)
        XCTAssertEqual(response.modelName, "future-model")
    }

    func testGrantCreditPurchaseSendsDeviceHeaderAndStoreKitTransaction() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/ios/purchases/credits/complete")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertNil(request.value(forHTTPHeaderField: "x-internal-token"))

            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
            XCTAssertEqual(json["productId"], "kabuyomi.credits.50")
            XCTAssertEqual(json["transactionId"], "tx-50")
            XCTAssertEqual(json["originalTransactionId"], "orig-tx-50")
            XCTAssertEqual(json["signedTransactionInfo"], "signed-jws")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "transactionId": "tx-50",
                    "productId": "kabuyomi.credits.50",
                    "creditsGranted": 50,
                    "creditsRemaining": 80,
                    "transactionStatus": "granted",
                    "didMutate": true,
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-26",
                        "credits": [
                            "monthlyRemaining": 30,
                            "monthlyLimit": 30,
                            "purchasedRemaining": 50,
                            "totalRemaining": 130,
                            "resetsAt": "2026-05-01T00:00:00+09:00"
                        ],
                        "creditBillingEnabled": false
                    ]
                ])
            )
        }

        let response = try await client.grantCreditPurchase(
            CreditPurchaseGrantRequest(
                productId: "kabuyomi.credits.50",
                transactionId: "tx-50",
                originalTransactionId: "orig-tx-50",
                purchasedAt: "2026-04-26T00:00:00.000Z",
                signedTransactionInfo: "signed-jws"
            )
        )

        XCTAssertEqual(response.creditsGranted, 50)
        XCTAssertEqual(response.creditsRemaining, 80)
        XCTAssertEqual(response.usage.credits?.purchasedRemaining, 50)
    }

    func testGrantCreditPurchase404MapsToRouteMissingWithEndpointDetails() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.path, "/v1/ios/purchases/credits/complete")
            return (
                HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData(["error": "Not found"])
            )
        }

        do {
            _ = try await client.grantCreditPurchase(
                CreditPurchaseGrantRequest(
                    productId: "kabuyomi.credits.50",
                    transactionId: "tx-50",
                    originalTransactionId: "orig-tx-50",
                    purchasedAt: "2026-04-26T00:00:00.000Z",
                    signedTransactionInfo: "signed-jws"
                )
            )
            XCTFail("Expected routeMissing")
        } catch let error as APIError {
            XCTAssertEqual(
                error,
                .routeMissing(
                    statusCode: 404,
                    path: "/v1/ios/purchases/credits/complete",
                    url: "https://example.com/v1/ios/purchases/credits/complete",
                    message: "Not found"
                )
            )
        }
    }

    func testBillingAPIHealthCheckReportsRouteMissingSeparatelyFromValidationErrors() async throws {
        let client = makeClient(context: standardContext) { request in
            let path = try XCTUnwrap(request.url?.path)
            let statusCode: Int
            let error: String
            switch path {
            case "/v1/usage":
                statusCode = 200
                error = "ok"
            case "/v1/ios/subscriptions/sync":
                statusCode = 404
                error = "Not found"
            case "/v1/ios/purchases/credits/complete":
                statusCode = 400
                error = "Invalid credit purchase payload"
            default:
                statusCode = 500
                error = "unexpected"
            }

            return (
                HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData(["error": error])
            )
        }

        let report = await client.checkBillingAPIHealth()

        XCTAssertEqual(report.entries.map(\.path), [
            "/v1/usage",
            "/v1/ios/subscriptions/sync",
            "/v1/ios/purchases/credits/complete"
        ])
        XCTAssertTrue(report.hasRouteMissing)
        XCTAssertEqual(report.entries.first { $0.path == "/v1/ios/subscriptions/sync" }?.statusCode, 404)
        XCTAssertEqual(report.entries.first { $0.path == "/v1/ios/purchases/credits/complete" }?.statusCode, 400)
    }

    func testCreateAdMobRewardIntentSendsDeviceHeaderAndDecodesResponse() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/admob/reward-intents")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "rewardIntentId": "intent-1",
                    "customData": "intent-1.nonce",
                    "rewardCredits": 2,
                    "dailyRemaining": 3
                ])
            )
        }

        let response = try await client.createAdMobRewardIntent()

        XCTAssertEqual(response.rewardIntentId, "intent-1")
        XCTAssertEqual(response.customData, "intent-1.nonce")
        XCTAssertEqual(response.rewardCredits, 2)
        XCTAssertEqual(response.dailyRemaining, 3)
    }

    func testFetchAdMobRewardStatusDecodesPromotionalCreditUsage() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/admob/reward-status?id=intent-1")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "rewardIntentId": "intent-1",
                    "status": "granted",
                    "rewardCredits": 2,
                    "creditsRemaining": 32,
                    "dailyRemaining": 2,
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-26",
                        "credits": [
                            "monthlyRemaining": 30,
                            "monthlyLimit": 30,
                            "rewardedAdRemaining": 2,
                            "rewardedAdExpiresAt": "2026-05-26T00:00:00.000Z",
                            "purchasedRemaining": 0,
                            "totalRemaining": 32,
                            "resetsAt": "2026-05-01T00:00:00+09:00"
                        ],
                        "creditBillingEnabled": true
                    ]
                ])
            )
        }

        let response = try await client.fetchAdMobRewardStatus(rewardIntentId: "intent-1")

        XCTAssertEqual(response.status, "granted")
        XCTAssertEqual(response.usage.credits?.rewardedAdRemaining, 2)
        XCTAssertEqual(response.usage.credits?.totalRemaining, 32)
    }

    func testTranslateQuoteSendsDeviceHeaderAndDecodesResponse() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/translate-quote")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")

            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
            XCTAssertEqual(json["text"], "Revenue increased year over year.")
            XCTAssertEqual(json["targetLanguage"], "ja")
            XCTAssertNil(json["sourceLanguage"])
            XCTAssertEqual(json["operationId"], "quote-translation-operation")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "translatedText": "売上高は前年同期比で増加しました。",
                    "modelName": "gemma-4-26b-a4b-it"
                ])
            )
        }

        let response = try await client.translateQuote(
            text: "Revenue increased year over year.",
            operationId: "quote-translation-operation"
        )

        XCTAssertEqual(response.translatedText, "売上高は前年同期比で増加しました。")
        XCTAssertEqual(response.modelName, "gemma-4-26b-a4b-it")
    }

    func testRemoveFromWatchlistSendsDeviceHeaderAndJSONBody() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/watchlist/remove")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")

            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
            XCTAssertEqual(json["ticker"], "AAPL")

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-04-18"
                    ]
                ])
            )
        }

        let response = try await client.removeFromWatchlist(ticker: "AAPL")

        XCTAssertEqual(response.usage.stocksUsed, 0)
    }

    func testAppleAccountSessionPersistsOpaqueCredentialAndMigrationUsesAccountAndLegacyEvidence() async throws {
        let store = InMemoryAccountCredentialStore()
        let expected = AccountCredential(
            token: "opaque-account-session",
            accountPrincipal: "account:v1:opaque-principal",
            appAccountToken: "43fbd3f0-78b1-4d65-9968-0f5bc42aab47",
            issuedAt: "2026-07-11T00:00:00.000Z",
            // 有効な資格情報を表すため、実時刻に追い越されない遠い将来を使う。
            // AccountCredential.isExpired は Date() と比較するので、
            // 固定の近い日付を置くとその日を境にテストが落ちる。
            expiresAt: "2099-01-01T00:00:00.000Z"
        )
        let requestRecorder = OperationIDRecorder()
        let client = makeClient(accountCredentialStore: store) { request in
            let requestCount = requestRecorder.record(request.url?.path ?? "missing")
            if requestCount == 1 {
                XCTAssertEqual(request.url?.path, "/v1/account/apple/session")
                XCTAssertNil(request.value(forHTTPHeaderField: "x-kabuyomi-account-token"))
                let body = try XCTUnwrap(Self.requestBodyData(from: request))
                let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
                XCTAssertEqual(json["identityToken"], "apple-identity-token")
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try TestFixtures.jsonData([
                        "credential": [
                            "token": expected.token,
                            "accountPrincipal": expected.accountPrincipal,
                            "appAccountToken": expected.appAccountToken,
                            "issuedAt": expected.issuedAt,
                            "expiresAt": expected.expiresAt
                        ]
                    ])
                )
            }

            XCTAssertEqual(request.url?.path, "/v1/account/paid-credit-migration")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-kabuyomi-account-token"), expected.token)
            // This helper injects a legacy header explicitly through QuotaRequestContext.
            // Live clients have no request context and no longer add one for this route.
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-device-key"), "device-123")
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "status": "applied",
                    "expectedPurchasedRemaining": 25,
                    "purchaseEvidenceCount": 1
                ])
            )
        }

        let credential = try await client.createAppleAccountSession(identityToken: "apple-identity-token")
        XCTAssertEqual(credential, expected)
        XCTAssertEqual(store.credential, expected)

        let migration = try await client.migratePaidCreditsToAccount(
            mode: "apply",
            migrationId: "paid-credit-account-v1-test"
        )
        XCTAssertEqual(migration.status, "applied")
        XCTAssertEqual(migration.expectedPurchasedRemaining, 25)
    }

    private func makeClient(
        baseURL: URL? = URL(string: "https://example.com")!,
        context: QuotaRequestContext? = nil,
        subscriptionStore: SubscriptionStore? = nil,
        accountCredentialStore: (any AccountCredentialStoring)? = nil,
        handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> APIClient {
        MockURLProtocol.requestHandler = handler

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)

        return APIClient(
            session: session,
            baseURL: baseURL,
            requestContext: context ?? standardContext,
            subscriptionStore: subscriptionStore,
            detachedAccessStore: nil,
            installationIdentityStore: nil,
            appAttestClient: nil,
            accountCredentialStore: accountCredentialStore,
            prevalidatedAssertionHeaders: [
                "x-kabuyomi-app-attest-key-id": "test-app-attest-key",
                "x-kabuyomi-app-attest-challenge-id": "test-challenge",
                "x-kabuyomi-app-attest-assertion": "dGVzdA=="
            ]
        )
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

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
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
