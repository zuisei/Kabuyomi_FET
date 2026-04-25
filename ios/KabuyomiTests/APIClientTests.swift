import Foundation
import XCTest
@testable import Kabuyomi

@MainActor
final class APIClientTests: XCTestCase {
    private let standardContext = QuotaRequestContext(deviceKey: "device-123")
    private let proContext = QuotaRequestContext(deviceKey: "device-123", originalTransactionId: "tx-123")
    private let devContext = QuotaRequestContext(deviceKey: "device-123", detachedAccessMode: .devUnlimited)

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
        XCTAssertEqual(item.supportDisplayLabel, "10-K / 10-Q 未確認")
        XCTAssertEqual(item.availabilityNote, "保存または表示時に 10-K / 10-Q を確認します。")
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
            question: "今回の変化は？"
        )

        XCTAssertEqual(response.responsePath, .gemini)
        XCTAssertEqual(response.modelName, "gemini-2.5-flash")
        XCTAssertEqual(response.sources.first?.sourceUrl, "https://www.sec.gov/Archives/AAPL.htm")
    }

    func testSendChatIncludesConversationContext() async throws {
        let client = makeClient(context: standardContext) { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/chat")
            XCTAssertEqual(request.httpMethod, "POST")

            let body = try XCTUnwrap(Self.requestBodyData(from: request))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["filingKey"] as? String, "v1:AAPL:0000320193-24-000001")
            XCTAssertEqual(json["question"] as? String, "なぜ？")
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
            ]
        )

        XCTAssertEqual(response.responsePath, .deterministic)
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
            question: "今回の変化は？"
        )

        XCTAssertNil(response.responsePath)
        XCTAssertNil(response.modelName)
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

            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "translatedText": "売上高は前年同期比で増加しました。",
                    "modelName": "gemma-4-26b-a4b-it"
                ])
            )
        }

        let response = try await client.translateQuote(text: "Revenue increased year over year.")

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

    private func makeClient(
        context: QuotaRequestContext = QuotaRequestContext(deviceKey: "device-123"),
        handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> APIClient {
        MockURLProtocol.requestHandler = handler

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)

        return APIClient(
            session: session,
            baseURL: URL(string: "https://example.com")!,
            requestContext: context,
            subscriptionStore: nil,
            detachedAccessStore: nil
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
