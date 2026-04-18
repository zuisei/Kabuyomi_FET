import XCTest
@testable import Kabuyomi

@MainActor
final class AppModelTests: XCTestCase {
    override func setUp() {
        super.setUp()
        Self.clearKabuyomiDefaults()
    }

    override func tearDown() {
        MockAppModelURLProtocol.requestHandler = nil
        Self.clearKabuyomiDefaults()
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
