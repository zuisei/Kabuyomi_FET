import XCTest
@testable import Kabuyomi

@MainActor
final class AppModelTests: XCTestCase {
    override func setUp() {
        super.setUp()
        Self.clearKabuyomiDefaults()
    }

    override func tearDown() {
        Self.clearKabuyomiDefaults()
        super.tearDown()
    }

    func testOpenConversationNormalizesTickerAndConsumesDraftQuestion() {
        let model = makeAppModel()

        XCTAssertTrue(model.shouldShowConversationEntry)

        model.openConversation(for: " msft ", draftQuestion: "前回決算との違いは？")

        XCTAssertEqual(model.activeConversationTicker, "MSFT")
        XCTAssertFalse(model.shouldShowConversationEntry)
        XCTAssertEqual(model.consumePendingDraftQuestion(for: "MSFT"), "前回決算との違いは？")
        XCTAssertNil(model.consumePendingDraftQuestion(for: "MSFT"))
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
        AppModel(
            apiClient: APIClient(
                session: URLSession(configuration: .ephemeral),
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
