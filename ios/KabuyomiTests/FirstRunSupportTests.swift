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

    /// アスクバーの会社チップ。会社がどこにも無ければ宛先は nil で、
    /// チップは「銘柄を選ぶ」を出す(スターター企業を勝手に据えない)。
    func testAskContextIsEmptyWithoutAnyCompany() {
        XCTAssertNil(streamAskContext(lastOpenedTicker: nil, saved: [], recent: []))
        XCTAssertNil(streamAskContext(lastOpenedTicker: "   ", saved: [], recent: []))
    }
}
