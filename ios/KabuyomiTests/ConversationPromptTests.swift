import XCTest
@testable import Kabuyomi

final class ConversationPromptTests: XCTestCase {
    func testBuildFollowUpQuestionsFallsBackToHistoricalForPeerComparison() {
        let company = TestFixtures.companyPayload()

        let suggestions = buildFollowUpQuestions(
            for: company,
            precedingUserPrompt: "MSFT と比較するとどう？"
        )

        XCTAssertEqual(suggestions.first, "前回決算との違いは？")
        XCTAssertTrue(suggestions.contains("この3年の利益率推移は？"))
    }

    func testStructureAssistantMessageKeepsBoilerplateOutOfConclusion() {
        let structure = structureAssistantMessage(
            """
            売上高は 451.8億ドル で、前年同期比 15.9%増 です。 \
            A detailed discussion of these and other risks and uncertainties that could cause actual results and events to differ materially from such forward-looking statements is included elsewhere. \
            この filing だけでは、これ以上の切り分けは難しいです。
            """
        )

        XCTAssertEqual(structure.conclusion, "売上高は 451.8億ドル で、前年同期比 15.9%増 です。")
        XCTAssertFalse(structure.evidence.contains { $0.contains("A detailed discussion") })
        XCTAssertTrue(structure.limitations.contains("この filing だけでは、これ以上の切り分けは難しいです。"))
    }

    func testLocalizedAssistantDisplayTextStripsLongEnglishBoilerplateWhenJapaneseExists() {
        let text = localizedAssistantDisplayText(
            "売上高は 451.8億ドル で、前年同期比 15.9%増 です。 A detailed discussion of these and other risks and uncertainties that could cause actual results and events to differ materially from such forward-looking statements is included elsewhere."
        )

        XCTAssertEqual(text, "売上高は 451.8億ドル で、前年同期比 15.9%増 です。")
    }

    func testPendingAssistantViewStateStartsWithThinking() {
        let submittedAt = Date()

        let state = buildPendingAssistantViewState(
            question: "前回決算との違いは？",
            submittedAt: submittedAt,
            now: submittedAt.addingTimeInterval(0.4),
            formType: "10-K"
        )

        XCTAssertEqual(state.badge, "Thinking")
        XCTAssertEqual(state.title, "質問の軸を整理しています")
    }

    func testPendingAssistantViewStateShowsHistoricalSearchingForQuarterlyComparison() {
        let submittedAt = Date()

        let state = buildPendingAssistantViewState(
            question: "この3年の同四半期で利益率は改善した？",
            submittedAt: submittedAt,
            now: submittedAt.addingTimeInterval(1.8),
            formType: "10-Q"
        )

        XCTAssertEqual(state.badge, "Searching")
        XCTAssertEqual(state.title, "比較に必要な提出資料を探しています")
        XCTAssertEqual(state.detail, "同四半期ベースで必要な過去年だけ補完しています。")
    }
}
