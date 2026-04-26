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
        XCTAssertEqual(loaded.chatHistory.last?.sources.first?.sourceIdSnapshot, "metric-op")
        XCTAssertEqual(loaded.chatHistory.last?.sources.first?.sourceLabelSnapshot, "OperatingIncomeLoss")
        XCTAssertEqual(loaded.chatHistory.last?.sources.first?.sourceUrl, "https://www.sec.gov/Archives/AAPL.htm")
        XCTAssertEqual(loaded.company.companyWebsiteUrl, company.companyWebsiteUrl)

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
                        excerpt: "Revenue increased",
                        sourceUrl: "https://www.sec.gov/Archives/AAPL.htm"
                    )
                ],
                responsePath: nil,
                modelName: "gemini-2.5-flash",
                usage: TestFixtures.usagePayload(),
                creditsCharged: nil,
                creditsRemaining: nil
            ),
            for: company
        )

        let loaded = try XCTUnwrap(persistence.loadCompany(ticker: "AAPL"))
        XCTAssertEqual(loaded.chatHistory.last?.modelName, "gemini-2.5-flash")
    }

    func testSaveCompanyReusesExistingFilingWhenExtractorVersionChanges() throws {
        let persistence = PersistenceController(inMemory: true)
        let original = TestFixtures.companyPayload()
        let refreshed = CompanyPayload(
            filingKey: "v2:AAPL:0000320193-24-000001",
            ticker: original.ticker,
            companyName: original.companyName,
            cik: original.cik,
            formType: original.formType,
            filedAt: original.filedAt,
            periodOfReport: original.periodOfReport,
            primaryDocumentUrl: original.primaryDocumentUrl,
            companyWebsiteUrl: original.companyWebsiteUrl,
            summary: original.summary,
            metrics: [
                MetricPayload(
                    logicalName: "revenue",
                    tagUsed: "Revenues",
                    value: 401_220_000_000,
                    unit: "USD",
                    periodEnd: "2024-09-30",
                    comparisonValue: 383_285_000_000,
                    yoyPercent: 4.7
                )
            ],
            historicalOverview: original.historicalOverview,
            sourceChunks: original.sourceChunks,
            lastUpdatedAt: original.lastUpdatedAt
        )

        try persistence.saveCompany(original, searchItem: nil)
        try persistence.saveCompany(refreshed, searchItem: nil)

        let loaded = try XCTUnwrap(persistence.loadCompany(ticker: "AAPL"))
        XCTAssertEqual(loaded.company.filingKey, refreshed.filingKey)
        XCTAssertEqual(loaded.company.metrics.first?.tagUsed, "Revenues")
    }

    func testSaveChatKeepsBadgeHiddenForLegacyResponseWithoutModelName() throws {
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
                        excerpt: "Revenue increased",
                        sourceUrl: "https://www.sec.gov/Archives/AAPL.htm"
                    )
                ],
                responsePath: nil,
                modelName: nil,
                usage: TestFixtures.usagePayload(),
                creditsCharged: nil,
                creditsRemaining: nil
            ),
            for: company
        )

        let loaded = try XCTUnwrap(persistence.loadCompany(ticker: "AAPL"))
        XCTAssertEqual(loaded.chatHistory.last?.modelName, "")
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
                        excerpt: "Revenue increased",
                        sourceUrl: "https://www.sec.gov/Archives/AAPL.htm"
                    )
                ],
                responsePath: .deterministic,
                modelName: nil,
                usage: TestFixtures.usagePayload(),
                creditsCharged: nil,
                creditsRemaining: nil
            ),
            for: company
        )

        let loaded = try XCTUnwrap(persistence.loadCompany(ticker: "AAPL"))
        XCTAssertEqual(loaded.chatHistory.last?.modelName, "")
    }
}
