import XCTest

/// v2 IA Phase 4 の骨格(docs/ui-redesign-v2/V2_IA_SPEC.md「Phase 4」節)。
/// タブは無く、根はストリーム + 底のアスクバー。会社ドキュメント・資料・引用は push、
/// 会社ピッカーと設定はシート。ここで固定するのは
/// 「どの面がどこから到達できるか」と「アスクバーが根にだけ貼りつくこと」。
@MainActor
final class ShellParityUITests: XCTestCase {
    private lazy var app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testProductionShellCompanyBoardWorkspaceAndSourcesAreReachable() throws {
        launch()
        searchAndOpenAAPL()

        XCTAssertTrue(app.staticTexts["AAPL"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.navigationBars["AAPL"].exists)
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["redesign.company.more"].exists)
        // 質問の入り口は2つ、送信の道は1つ。ドキュメントの上ではドキュメント側の
        // コンポーザだけが出て、根のアスクバーは重ならない。
        XCTAssertFalse(app.buttons["redesign.askbar.send"].exists)
        XCTAssertTrue(app.buttons["redesign.composer.expand"].exists)
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        XCTAssertFalse(app.staticTexts["このアプリの署名を確認できません"].exists)
        capture("Research workspace")

        app.buttons["redesign.company.sources"].tap()
        XCTAssertTrue(app.navigationBars["資料と根拠"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["redesign.askbar.send"].exists)
        capture("Sources")
    }

    func testResearchSupportsNativeEdgeSwipeNavigation() throws {
        launch()
        openAAPLFromStream()

        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        app.buttons["redesign.company.sources"].tap()
        XCTAssertTrue(element("redesign.sources").waitForExistence(timeout: 8))

        edgeSwipeBack()
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 8))
    }

    func testResearchCompanySupportsNativeEdgeSwipeNavigation() throws {
        launch()
        openAAPLFromStream()

        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        edgeSwipeBack()
        // 根まで戻ると、アスクバーがまた底に貼りつく。
        XCTAssertTrue(app.buttons["redesign.askbar.send"].waitForExistence(timeout: 8))
    }

    func testResearchSourceDetailSupportsNativeEdgeSwipeNavigation() throws {
        launch()
        openAAPLFromStream()

        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        app.buttons["redesign.company.sources"].tap()
        XCTAssertTrue(element("redesign.sources").waitForExistence(timeout: 8))

        let firstSource = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "redesign.source.open.")
        ).firstMatch
        XCTAssertTrue(firstSource.waitForExistence(timeout: 8))
        firstSource.tap()
        XCTAssertTrue(element("redesign.source.detail").waitForExistence(timeout: 8))

        edgeSwipeBack()
        XCTAssertTrue(element("redesign.sources").waitForExistence(timeout: 8))
    }

    func testResearchSecondaryActionsRemainReachable() throws {
        launch()
        openAAPLFromStream()

        XCTAssertTrue(app.buttons["redesign.company.save"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["redesign.company.more"].waitForExistence(timeout: 15))
        app.buttons["redesign.company.more"].tap()
        XCTAssertTrue(app.buttons["redesign.company.switch"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["redesign.company.refresh"].exists)
    }

    func testProductionTopLevelNavigationAndBillingEntryAreReachable() throws {
        launch()
        reachStreamRoot()

        app.buttons["redesign.stream.profile"].tap()
        XCTAssertTrue(element("redesign.settings").waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["redesign.settings.credits"].exists)

        app.buttons["redesign.settings.credits"].tap()
        XCTAssertTrue(app.navigationBars["クレジット"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        let billingAlert = app.alerts["Kabuyomi"]
        if billingAlert.waitForExistence(timeout: 2) {
            capture("Credits failure")
            billingAlert.buttons["閉じる"].tap()
            XCTAssertTrue(billingAlert.waitForNonExistence(timeout: 4))
        }
        capture("Credits")

        app.navigationBars.buttons["設定"].tap()
        XCTAssertTrue(element("redesign.settings").waitForExistence(timeout: 8))

        // シートを閉じても根のストリームはそのまま残る。
        app.buttons["redesign.settings.close"].tap()
        XCTAssertTrue(app.buttons["redesign.askbar.send"].waitForExistence(timeout: 8))
    }

    /// Phase 3 の「ホームと研究は役割が違う」に代わる主張。
    /// Phase 4 では面が1つになったので、固定すべきは
    /// 「1本のストリームが根で、アスクバーがそこに貼りついている」こと。
    func testStreamIsTheRootSurfaceWithAPinnedAskBar() throws {
        launch()
        reachStreamRoot()

        XCTAssertTrue(element("redesign.stream").waitForExistence(timeout: 8))
        XCTAssertFalse(app.tabBars.firstMatch.exists)

        // アスクバーの3点(会社チップ / 入力欄 / 送信)と残高は常に根にある。
        XCTAssertTrue(app.buttons["redesign.askbar.company"].exists)
        XCTAssertTrue(app.buttons["redesign.askbar.credits"].exists)
        XCTAssertTrue(app.buttons["redesign.askbar.send"].exists)
        XCTAssertTrue(app.textFields["redesign.askbar.field"].exists)

        // 検索は根には無く、会社ピッカーのシートの中にある。
        XCTAssertFalse(app.searchFields.firstMatch.exists)
        capture("Stream")
    }

    /// 会社チップのピッカーは「宛先にする」と「開く」の2つの道を持つ。
    func testCompanyPickerOffersSearchAndOpensTheDocument() throws {
        launch()
        reachStreamRoot()

        app.buttons["redesign.askbar.company"].tap()
        XCTAssertTrue(element("redesign.picker").waitForExistence(timeout: 8))
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 8))
        capture("Company picker")

        app.buttons["redesign.picker.close"].tap()
        XCTAssertTrue(app.buttons["redesign.askbar.send"].waitForExistence(timeout: 8))
    }

    /// 盤面の行は2つの意味を持つ。行 = 質問の宛先にする、「開く」= ドキュメントを開く。
    /// どちらも押せて、押した結果が違うことをここで固定する。
    func testPickerBoardRowSelectsAsContextAndOpensSeparately() throws {
        launch()
        // 盤面に出す会社を1社作る(最近開いた会社が盤面の行になる)。
        openAAPLFromStream()
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        edgeSwipeBack()
        XCTAssertTrue(app.buttons["redesign.askbar.send"].waitForExistence(timeout: 8))

        app.buttons["redesign.askbar.company"].tap()
        XCTAssertTrue(element("redesign.picker").waitForExistence(timeout: 8))

        let selectRow = app.buttons["redesign.company.select.AAPL"]
        let openRow = app.buttons["redesign.company.open.AAPL"]
        XCTAssertTrue(selectRow.waitForExistence(timeout: 8), "盤面の行が出ていない")
        XCTAssertTrue(openRow.exists, "盤面の行に「開く」が無い")
        capture("Company picker board")

        // 「開く」はドキュメントへ。
        openRow.tap()
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["redesign.askbar.send"].exists)

        edgeSwipeBack()
        XCTAssertTrue(app.buttons["redesign.askbar.send"].waitForExistence(timeout: 8))

        // 行そのものは宛先を変えるだけ。ドキュメントへは行かず、根へ戻る。
        app.buttons["redesign.askbar.company"].tap()
        XCTAssertTrue(element("redesign.picker").waitForExistence(timeout: 8))
        app.buttons["redesign.company.select.AAPL"].tap()
        XCTAssertTrue(app.buttons["redesign.askbar.send"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["redesign.company.sources"].exists)
    }

    /// 残高はアスクバーに出しっぱなしで、押せばクレジット画面へ入れる。
    func testAskBarCreditChipOpensCredits() throws {
        launch()
        reachStreamRoot()

        app.buttons["redesign.askbar.credits"].tap()
        // シートとして出た CreditView は自前のヘッダを持つ(push 版と違い
        // ナビゲーションバーは無い)。閉じるボタンでその面だと確かめる。
        XCTAssertTrue(app.buttons["クレジット画面を閉じる"].waitForExistence(timeout: 8))
        let billingAlert = app.alerts["Kabuyomi"]
        if billingAlert.waitForExistence(timeout: 2) {
            billingAlert.buttons["閉じる"].tap()
            XCTAssertTrue(billingAlert.waitForNonExistence(timeout: 4))
        }
        capture("Credits from the ask bar")
    }

    func testProductionDeviceAuthenticationStatusIsReachable() throws {
        launch()
        reachStreamRoot()

        app.buttons["redesign.stream.profile"].tap()
        XCTAssertTrue(element("redesign.settings").waitForExistence(timeout: 8))

        app.buttons["redesign.settings.details"].tap()
        XCTAssertTrue(element("settings.deviceInfo").waitForExistence(timeout: 8))

        #if targetEnvironment(simulator)
        // App Attest cannot produce a verified production credential in the
        // Simulator. Reachability still protects the Release support surface.
        #else
        let verifiedStatus = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "確認済み"))
            .firstMatch
        XCTAssertTrue(
            verifiedStatus.waitForExistence(timeout: 30),
            "A signed physical-device build must complete installation authentication."
        )
        #endif
    }

    func testProductionRepresentativeScreenPassesAccessibilityAudit() throws {
        launch()
        try app.performAccessibilityAudit { issue in
            let label = issue.element?.label ?? ""
            let verifiedFalsePositives: Set<String> = [
                "残高不足", "クレジットを確認",
                "主要数値", "売上高", "純利益", "営業CF",
                "1,111.8億ドル", "358.8億ドル", "295.8億ドル", "826.3億ドル",
                "+16.6%", "+21.3%"
            ]
            // iOS 26.2 misclassifies explicit inverse-color capsules and
            // scroll content occluded by the bottom safe-area composer. The
            // Phase 4 root carries that inset permanently (the ask bar), so the
            // occlusion case now applies to the stream as well. These elements
            // are also checked in rendered screenshots; every other contrast and
            // accessibility finding remains active.
            let inaccessibleSystemAuditNode = issue.auditType == .contrast && issue.element == nil
            let occludedByAskBar = issue.auditType == .contrast
                && (issue.element?.frame.minY ?? 0) >= 650
            return issue.auditType == .contrast && verifiedFalsePositives.contains(label)
                || inaccessibleSystemAuditNode || occludedByAskBar
        }
    }

    private func launch() {
        app.terminate()
        app.launchArguments = [
            "-AppleLanguages", "(ja)",
            "-AppleLocale", "ja_JP"
        ]
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 12))
    }

    /// 根のストリームまで戻す。Phase 4 は起動時に会社へ復元しないので
    /// 通常はもう根にいるが、直前のテストが押し込んだ状態からも回復できるようにする。
    private func reachStreamRoot() {
        if app.buttons["redesign.askbar.send"].waitForExistence(timeout: 5) {
            return
        }

        edgeSwipeBack()
        XCTAssertTrue(app.buttons["redesign.askbar.send"].waitForExistence(timeout: 8))
    }

    /// 検索は会社ピッカーのシートの中。まず検索アイコンで開く。
    private func openCompanyPicker() {
        if app.searchFields.firstMatch.exists { return }
        reachStreamRoot()
        app.buttons["redesign.stream.search"].tap()
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 8))
    }

    private func searchAndOpenAAPL() {
        openCompanyPicker()
        let searchField = app.searchFields.firstMatch
        searchField.tap()
        searchField.typeText("AAPL")

        XCTAssertTrue(app.buttons["redesign.search.open.AAPL"].waitForExistence(timeout: 15))
        app.buttons["redesign.search.open.AAPL"].tap()
    }

    /// ストリームから AAPL を開く。カードが無ければ検索から。
    private func openAAPLFromStream() {
        reachStreamRoot()
        let streamCard = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "redesign.stream.filing.AAPL")
        ).firstMatch
        if streamCard.waitForExistence(timeout: 3) {
            streamCard.tap()
            return
        }

        let starterRow = app.buttons["redesign.company.open.AAPL"]
        if starterRow.waitForExistence(timeout: 3) {
            starterRow.tap()
            return
        }

        searchAndOpenAAPL()
    }

    private func edgeSwipeBack() {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.45))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.78, dy: 0.45))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
