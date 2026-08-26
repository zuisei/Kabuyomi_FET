import XCTest
@testable import Kabuyomi

final class AppPromotionTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "AppPromotionTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testShareTextCarriesSourceDisclaimerAndCampaignLink() {
        let text = AppPromotion.shareText(
            ticker: "aapl",
            companyName: "Apple Inc.",
            question: "iPhone の売上は伸びていますか",
            conclusion: "直近四半期の iPhone 売上は前年同期比で増加しています。"
        )

        XCTAssertTrue(text.contains("AAPL Apple Inc."), text)
        XCTAssertTrue(text.contains("Q. iPhone の売上は伸びていますか"), text)
        XCTAssertTrue(text.contains("A. 直近四半期の iPhone 売上は前年同期比で増加しています。"), text)
        // アプリの外には画面の注意書きが付いていかないので、本文に必ず入れる。
        XCTAssertTrue(text.contains("投資助言ではありません"), text)
        XCTAssertTrue(text.contains("https://apps.apple.com/jp/app/kabuyomi/id6762764426?ct=app-share&mt=8"), text)
    }

    func testShareTextTruncatesLongConclusion() {
        let conclusion = String(repeating: "あ", count: AppPromotion.sharedConclusionLimit + 40)
        let text = AppPromotion.shareText(
            ticker: "MSFT",
            companyName: "Microsoft",
            question: "クラウドの利益率は",
            conclusion: conclusion
        )

        let answerLine = text
            .split(separator: "\n")
            .first { $0.hasPrefix("A. ") }
        let body = String(answerLine ?? "").dropFirst(3)
        XCTAssertEqual(body.count, AppPromotion.sharedConclusionLimit + 1, "上限 + 省略記号1文字")
        XCTAssertTrue(body.hasSuffix("…"))
    }

    func testShareTextOmitsEmptyQuestionLine() {
        let text = AppPromotion.shareText(
            ticker: "NVDA",
            companyName: "NVIDIA",
            question: "   ",
            conclusion: "データセンター部門が売上の中心です。"
        )

        XCTAssertFalse(text.contains("Q. "), text)
        XCTAssertTrue(text.contains("A. データセンター部門が売上の中心です。"), text)
    }

    func testShareTextFallsBackToTickerWhenCompanyNameMissing() {
        let text = AppPromotion.shareText(
            ticker: "TSLA",
            companyName: "",
            question: "粗利率は",
            conclusion: "粗利率は前年から低下しています。"
        )

        XCTAssertTrue(text.contains("TSLA の決算資料を Kabuyomi で読みました。"), text)
    }

    func testReviewPromptStaysSilentBeforeThreshold() {
        let gate = ReviewPromptGate(defaults: defaults)

        for _ in 1..<ReviewPromptGate.successfulAnswerThreshold {
            XCTAssertFalse(gate.recordSuccessfulAnswer(appVersion: "1.2"))
        }
        XCTAssertEqual(gate.successfulAnswerCount, ReviewPromptGate.successfulAnswerThreshold - 1)
    }

    func testReviewPromptFiresOnceAtThreshold() {
        let gate = ReviewPromptGate(defaults: defaults)

        for _ in 1..<ReviewPromptGate.successfulAnswerThreshold {
            _ = gate.recordSuccessfulAnswer(appVersion: "1.2")
        }
        XCTAssertTrue(gate.recordSuccessfulAnswer(appVersion: "1.2"))
        // 同じバージョンでは二度と聞かない。
        XCTAssertFalse(gate.recordSuccessfulAnswer(appVersion: "1.2"))
        XCTAssertFalse(gate.recordSuccessfulAnswer(appVersion: "1.2"))
    }

    func testReviewPromptFiresAgainAfterNewVersion() {
        let gate = ReviewPromptGate(defaults: defaults)

        for _ in 1..<ReviewPromptGate.successfulAnswerThreshold {
            _ = gate.recordSuccessfulAnswer(appVersion: "1.2")
        }
        XCTAssertTrue(gate.recordSuccessfulAnswer(appVersion: "1.2"))
        XCTAssertTrue(gate.recordSuccessfulAnswer(appVersion: "1.3"))
        XCTAssertFalse(gate.recordSuccessfulAnswer(appVersion: "1.3"))
    }

    func testReviewPromptRequiresKnownAppVersion() {
        let gate = ReviewPromptGate(defaults: defaults)

        for _ in 1...ReviewPromptGate.successfulAnswerThreshold {
            XCTAssertFalse(gate.recordSuccessfulAnswer(appVersion: ""))
        }
    }
}
