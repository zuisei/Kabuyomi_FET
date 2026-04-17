import XCTest
@testable import Kabuyomi

@MainActor
final class PersistenceControllerTests: XCTestCase {
    func testSaveLoadChatAndResetRoundTrip() throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()

        try persistence.saveCompany(
            company,
            searchItem: SearchItem(
                ticker: "AAPL",
                companyName: "Apple Inc.",
                cik: "0000320193",
                exchange: "NASDAQ",
                latestFormType: "10-K"
            )
        )
        try persistence.saveChat(
            question: "利益率は改善した？",
            response: TestFixtures.chatResponse(),
            for: company
        )

        let loaded = try XCTUnwrap(persistence.loadCompany(ticker: "AAPL"))

        XCTAssertEqual(loaded.company, company)
        XCTAssertEqual(loaded.chatHistory.count, 2)
        XCTAssertEqual(loaded.chatHistory.last?.content, "営業利益率は改善しました。")
        XCTAssertEqual(loaded.chatHistory.last?.sources.first?.sourceLabelSnapshot, "OperatingIncomeLoss")

        try persistence.reset()

        XCTAssertNil(persistence.loadCompany(ticker: "AAPL"))
        XCTAssertTrue(persistence.loadCompanyCards(tickers: ["AAPL"]).isEmpty)
    }
}
