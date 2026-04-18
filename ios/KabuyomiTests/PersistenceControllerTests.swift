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

    func testSaveChatFallsBackToModelNameWhenResponsePathIsAbsent() throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()

        try persistence.saveCompany(company, searchItem: nil)
        try persistence.saveChat(
            question: "今回の変化は？",
            response: ChatResponse(
                answer: "売上高は増加しました。",
                sources: [
                    ChatSourcePayload(
                        sourceId: "metric-revenue",
                        sourceKind: .secFiling,
                        sectionType: "xbrl_metric",
                        sourceLabel: "Revenue",
                        excerpt: "Revenue increased"
                    )
                ],
                responsePath: nil,
                modelName: "gemini-2.5-flash",
                usage: TestFixtures.usagePayload()
            ),
            for: company
        )

        let loaded = try XCTUnwrap(persistence.loadCompany(ticker: "AAPL"))
        XCTAssertEqual(loaded.chatHistory.last?.modelName, "gemini-2.5-flash")
    }

    func testSaveChatClearsModelBadgeForNonRemoteResponsePath() throws {
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()

        try persistence.saveCompany(company, searchItem: nil)
        try persistence.saveChat(
            question: "今回の変化は？",
            response: ChatResponse(
                answer: "売上高は増加しました。",
                sources: [
                    ChatSourcePayload(
                        sourceId: "metric-revenue",
                        sourceKind: .secFiling,
                        sectionType: "xbrl_metric",
                        sourceLabel: "Revenue",
                        excerpt: "Revenue increased"
                    )
                ],
                responsePath: .deterministic,
                modelName: nil,
                usage: TestFixtures.usagePayload()
            ),
            for: company
        )

        let loaded = try XCTUnwrap(persistence.loadCompany(ticker: "AAPL"))
        XCTAssertEqual(loaded.chatHistory.last?.modelName, "")
    }
}
