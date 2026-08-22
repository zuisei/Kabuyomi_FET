import XCTest
@testable import Kabuyomi

/// v2 IA Phase 6(docs/ui-redesign-v2/V2_IA_SPEC.md「Phase 6」節)の純ロジック。
/// 初回動線の可視条件はビューではなく述語が決める、という形をここで固定する。
final class FirstRunSupportTests: XCTestCase {
    func testStarterPickerStartRequiresAtLeastOneSelection() {
        XCTAssertFalse(redesignStarterPickerCanStart(selectionCount: 0))
        XCTAssertTrue(redesignStarterPickerCanStart(selectionCount: 1))
        XCTAssertTrue(redesignStarterPickerCanStart(selectionCount: 5))
    }

    /// 保存の順序は「選んだ順」。Set に落として順序を失うと、
    /// 同じ選択でも起動のたびに盤面の並びが変わる。
    func testStarterPickerSaveOrderKeepsTheOrderTheUserPicked() {
        let order = redesignStarterPickerSaveOrder(
            selection: ["NVDA", "AAPL", "TSLA"],
            isAlreadySaved: { _ in false }
        )

        XCTAssertEqual(order, ["NVDA", "AAPL", "TSLA"])
    }

    /// すでに保存済みの銘柄は保存へ渡さない。
    /// 渡すと `AppModel.saveTicker` が「すでに保存済みです。」を返し、
    /// 初回動線の最中に押した覚えのないダイアログが出る。
    func testStarterPickerSaveOrderSkipsAlreadySavedTickers() {
        let order = redesignStarterPickerSaveOrder(
            selection: ["AAPL", "MSFT", "NVDA"],
            isAlreadySaved: { $0 == "MSFT" }
        )

        XCTAssertEqual(order, ["AAPL", "NVDA"])
    }

    func testStarterPickerSaveOrderIsEmptyWhenEverythingIsAlreadySaved() {
        XCTAssertTrue(
            redesignStarterPickerSaveOrder(
                selection: ["AAPL", "MSFT"],
                isAlreadySaved: { _ in true }
            ).isEmpty
        )
    }

    /// 確定文言(仕様で決まっているもの)。言い換えが生まれていないことを固定する。
    func testFirstRunCopyMatchesTheSpecifiedStrings() {
        XCTAssertEqual(RedesignFirstRunCopy.welcomePrimary, "銘柄を選んではじめる")
        XCTAssertEqual(RedesignFirstRunCopy.welcomeSecondary, "あとで")
        XCTAssertEqual(RedesignFirstRunCopy.starterPickerTitle, "気になる会社を選ぶ")
        XCTAssertEqual(RedesignFirstRunCopy.starterPickerStart, "はじめる")
        XCTAssertEqual(RedesignFirstRunCopy.emptyTitle, "銘柄を追加しよう")
        XCTAssertEqual(RedesignFirstRunCopy.emptyBody, "会社を追加すると、新しい決算がここに流れます。")
        XCTAssertEqual(RedesignFirstRunCopy.emptyAction, "銘柄をさがす")
        XCTAssertEqual(RedesignFirstRunCopy.askContextPlaceholder, "銘柄を選ぶ")
    }

    /// ようこそ画面の3ステップ(Phase 6.5 の確定文言)。順序も文字列も仕様のまま。
    func testWelcomeStepsMatchTheSpecifiedStrings() {
        XCTAssertEqual(
            RedesignFirstRunCopy.welcomeSteps,
            ["気になる会社を選ぶ", "決算の要点を日本語で読む", "気になったことを質問する"]
        )
    }

    /// 予告編カードの1行。`homeFeedVerdictLine` が返すのと同じ形
    /// (1文で終わる)を保つ。実在の会社の業績を作文していないことも
    /// ここで目に入るようにしておく。
    func testWelcomePreviewVerdictIsASingleSentence() {
        let line = RedesignFirstRunCopy.welcomePreviewVerdict
        XCTAssertEqual(redesignLeadSentence(line), line)
        XCTAssertTrue(line.hasSuffix("。"))
        XCTAssertFalse(line.contains("%"))
    }

    /// アスクバーの会社チップ。会社がどこにも無ければ宛先は nil で、
    /// チップは「銘柄を選ぶ」を出す(スターター企業を勝手に据えない)。
    func testAskContextIsEmptyWithoutAnyCompany() {
        XCTAssertNil(streamAskContext(lastOpenedTicker: nil, saved: [], recent: []))
        XCTAssertNil(streamAskContext(lastOpenedTicker: "   ", saved: [], recent: []))
    }

    // MARK: - スターターカタログ(Phase 6.5)

    /// 本番の追跡リスト(workers/src/lib/tracked-tickers.ts の
    /// `DEFAULT_TRACKED_TICKERS`)をここに写している。**唯一の出所はあちら**で、
    /// この配列はカタログが勝手にはみ出していないかを見るための鏡でしかない。
    /// Worker 側で追跡銘柄を減らしたときは、まずこのテストが落ちる。
    private static let trackedTickers: Set<String> = [
        "NVDA", "GOOG", "AAPL", "MSFT", "AMZN", "AVGO", "META", "TSLA", "BRK-B", "WMT",
        "JPM", "LLY", "V", "XOM", "JNJ", "MU", "ORCL", "MA", "AMD", "COST",
        "NFLX", "BAC", "CAT", "ABBV", "CVX", "PLTR", "HD", "INTC", "PG", "CSCO"
    ]

    /// カタログは追跡銘柄の部分集合。外れた会社を置くと、
    /// 初回に選んだ会社だけが「資料がまだありません」のまま残る。
    func testStarterCatalogOnlyContainsTrackedTickers() {
        for company in StarterCatalog.companies {
            XCTAssertTrue(
                Self.trackedTickers.contains(company.ticker),
                "\(company.ticker) は本番の追跡リストに無い"
            )
        }
    }

    /// 分類は3〜4、社数は12社前後(v2 IA 仕様 Phase 6.5)。
    /// 同じ会社が2つの分類に出ない。
    func testStarterCatalogIsGroupedWithoutDuplicates() {
        XCTAssertTrue((3...4).contains(StarterCatalog.sections.count))
        XCTAssertEqual(StarterCatalog.companies.count, 14)

        let tickers = StarterCatalog.companies.map(\.ticker)
        XCTAssertEqual(Set(tickers).count, tickers.count, "同じ会社が2つの分類に出ている")

        for section in StarterCatalog.sections {
            XCTAssertFalse(section.title.isEmpty)
            XCTAssertFalse(section.companies.isEmpty)
        }
    }

    /// 先頭の分類は既存の5社そのまま。`defaults` は増やさない
    /// (空状態の候補一覧と `AppModel.starterCompanies` があの5社を指している)。
    func testStarterCatalogKeepsTheOriginalFiveDefaultsUntouched() {
        XCTAssertEqual(StarterCompany.defaults.count, 5)
        XCTAssertEqual(
            StarterCompany.defaults.map(\.ticker),
            ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA"]
        )
        XCTAssertEqual(StarterCatalog.sections.first?.title, "定番")
        XCTAssertEqual(StarterCatalog.sections.first?.companies, StarterCompany.defaults)
    }

    /// 拡張分の正式表記も表記オーバーライドへ流れている
    /// (`homeBoardCompanyName` が SEC の全大文字を置き換える)。
    func testCuratedNamesFromTheExpandedCatalogReachTheDisplayNameChokePoint() {
        XCTAssertEqual(homeBoardCompanyName(companyName: "BROADCOM INC.", ticker: "AVGO"), "Broadcom Inc.")
        XCTAssertEqual(
            homeBoardCompanyName(companyName: "JPMORGAN CHASE & CO", ticker: "JPM"),
            "JPMorgan Chase & Co."
        )
        XCTAssertEqual(homeBoardCompanyName(companyName: "Walmart Inc.", ticker: "wmt"), "Walmart Inc.")
        // カタログの外は加工しない(Phase 3 からの約束)。
        XCTAssertEqual(homeBoardCompanyName(companyName: "COCA COLA CO", ticker: "KO"), "COCA COLA CO")
    }
}
