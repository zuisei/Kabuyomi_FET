import XCTest

/// v2 IA の骨格(2026-08-24 改訂)。
/// 根はタブ2枚(ホーム = 盤面 / 会話 = 会社ごとの会話履歴)。
/// 質問は会社ワークスペースのコンポーザだけ — ホームに質問バーは無い
/// (2026-08-24 オーナー再監査「ホームにこれがある理由がわからん」で撤去)。
/// 会社ドキュメント・資料・引用はどちらのタブからも push、
/// 会社ピッカーと設定はシート。ここで固定するのは
/// 「どの面がどこから到達できるか」「質問の道はワークスペースの1本だけであること」
/// 「タブを跨いでも面と状態がリセットされないこと」。
@MainActor
final class ShellParityUITests: XCTestCase {
    private lazy var app = XCUIApplication()
    /// このテストケース中のすべての launch に足す引数(再起動を跨いで保つ)。
    private var launchExtraArguments: [String] = []

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
        // 資料パネルに会話は埋め込まない。あるのは会話画面への入口だけ。
        XCTAssertTrue(app.buttons["redesign.company.chat"].exists)
        // 質問の道は会話画面の1本だけ。資料の面に入力欄は無い。
        XCTAssertFalse(app.textFields["redesign.composer.field"].exists)
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        XCTAssertFalse(app.staticTexts["このアプリの署名を確認できません"].exists)
        capture("Research workspace")

        // 会話画面はチャットの形: メッセージ面+下に固定のコンポーザ。
        app.buttons["redesign.company.chat"].tap()
        XCTAssertTrue(element("redesign.chat").waitForExistence(timeout: 8))
        // 入力欄は最初から出ている。開くための一手は挟まない(2026-08-26)。
        XCTAssertTrue(app.textFields["redesign.composer.field"].waitForExistence(timeout: 8))
        capture("Chat")

        edgeSwipeBack()
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 8))

        app.buttons["redesign.company.sources"].tap()
        XCTAssertTrue(app.navigationBars["資料と根拠"].waitForExistence(timeout: 8))
        capture("Sources")
    }

    func testResearchSupportsNativeEdgeSwipeNavigation() throws {
        launch()
        openAAPLFromHome()

        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        app.buttons["redesign.company.sources"].tap()
        XCTAssertTrue(element("redesign.sources").waitForExistence(timeout: 8))

        edgeSwipeBack()
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 8))
    }

    func testResearchCompanySupportsNativeEdgeSwipeNavigation() throws {
        launch()
        openAAPLFromHome()

        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        edgeSwipeBack()
        // 根まで戻ると、ホームの盤面に帰る。
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))
    }

    func testResearchSourceDetailSupportsNativeEdgeSwipeNavigation() throws {
        launch()
        openAAPLFromHome()

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
        openAAPLFromHome()

        XCTAssertTrue(app.buttons["redesign.company.save"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["redesign.company.more"].waitForExistence(timeout: 15))
        app.buttons["redesign.company.more"].tap()
        XCTAssertTrue(app.buttons["redesign.company.switch"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["redesign.company.refresh"].exists)
    }

    func testProductionTopLevelNavigationAndBillingEntryAreReachable() throws {
        launch()
        reachHomeRoot()

        app.buttons["redesign.home.profile"].tap()
        XCTAssertTrue(element("redesign.settings").waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["redesign.settings.credits"].exists)

        app.buttons["redesign.settings.credits"].tap()
        XCTAssertTrue(app.navigationBars["クレジット"].waitForExistence(timeout: 8))
        let billingAlert = app.alerts["Kabuyomi"]
        if billingAlert.waitForExistence(timeout: 2) {
            capture("Credits failure")
            billingAlert.buttons["閉じる"].tap()
            XCTAssertTrue(billingAlert.waitForNonExistence(timeout: 4))
        }
        capture("Credits")

        app.navigationBars.buttons["設定"].tap()
        XCTAssertTrue(element("redesign.settings").waitForExistence(timeout: 8))

        // シートを閉じても根の盤面とタブはそのまま残る。
        app.buttons["redesign.settings.close"].tap()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))
        XCTAssertTrue(app.tabBars.buttons["会話"].exists)
    }

    /// 根はタブ2枚。ホームの根は盤面で、質問バーはどこにも無い。
    func testHomeTabRootIsTheBoardWithoutAnAskBar() throws {
        launch()
        reachHomeRoot()

        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))

        // タブは2枚だけ(設定は3枚目のタブにしない)。
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 8))
        XCTAssertTrue(app.tabBars.buttons["ホーム"].exists)
        XCTAssertTrue(app.tabBars.buttons["会話"].exists)
        XCTAssertEqual(app.tabBars.firstMatch.buttons.count, 2)

        // 質問バー(旧アスクバー)は根に無い。
        XCTAssertFalse(app.buttons["redesign.askbar.send"].exists)
        XCTAssertFalse(app.textFields["redesign.askbar.field"].exists)

        // 検索は根には無く、会社ピッカーのシートの中にある。
        XCTAssertFalse(app.searchFields.firstMatch.exists)
        XCTAssertTrue(app.buttons["redesign.home.search"].exists)
        XCTAssertTrue(app.buttons["redesign.home.profile"].exists)
        capture("Home board")
    }

    /// 盤面カードはドキュメントへ真っ直ぐ。戻ればホームに帰る。
    func testHomeBoardCardPushesTheDocumentAndBackReturnsHome() throws {
        launch()
        seedBoardWithAAPL()

        let card = app.buttons["redesign.home.open.AAPL"]
        XCTAssertTrue(card.waitForExistence(timeout: 8), "ホームの盤面にカードが出ていない")

        card.tap()
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        // ドキュメントの上ではタブバーは出ない。
        XCTAssertFalse(app.tabBars.firstMatch.exists)

        edgeSwipeBack()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))
    }

    /// 盤面には常に「銘柄を追加」の導線が1つある。押せばピッカーが開く。
    func testHomeBoardOffersAnAddAffordance() throws {
        launch()
        seedBoardWithAAPL()

        let add = app.buttons["redesign.home.add"]
        XCTAssertTrue(add.waitForExistence(timeout: 8))
        add.tap()
        XCTAssertTrue(element("redesign.picker").waitForExistence(timeout: 8))
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 8))
        capture("Company picker")

        app.buttons["redesign.picker.close"].tap()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))
    }

    /// タブは目的地。切り替えても盤面は作り直されない。
    func testSwitchingTabsKeepsTheBoard() throws {
        launch()
        reachHomeRoot()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))

        selectTab("会話")
        XCTAssertTrue(element("redesign.conversations").waitForExistence(timeout: 8))
        XCTAssertFalse(element("redesign.home").exists)

        selectTab("ホーム")
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))
    }

    /// ピッカーの盤面行は1本道。押せばその会社が開く(「宛先にする」の二役は無い)。
    func testPickerBoardRowOpensTheDocument() throws {
        launch()
        seedBoardWithAAPL()

        app.buttons["redesign.home.search"].tap()
        XCTAssertTrue(element("redesign.picker").waitForExistence(timeout: 8))
        clearPickerSearchIfNeeded()

        let openRow = app.buttons["redesign.company.open.AAPL"]
        XCTAssertTrue(openRow.waitForExistence(timeout: 8), "盤面の行が出ていない")
        // 旧「宛先にする」の行は無い。
        XCTAssertFalse(app.buttons["redesign.company.select.AAPL"].exists)
        capture("Company picker board")

        openRow.tap()
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))

        edgeSwipeBack()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))
    }

    /// 会話タブ。会話が無いうちは案内、会話を持つ会社は1行に畳まれる。
    func testConversationsTabListsCompaniesWithHistory() throws {
        launch()
        seedBoardWithAAPL()

        selectTab("会話")
        XCTAssertTrue(element("redesign.conversations").waitForExistence(timeout: 8))
        // この端末はまだ質問していないので空状態の案内が出る。
        // (会話がある端末では行が出る — その場合この前段は落ちて状況の変化を知らせる。)
        XCTAssertTrue(app.buttons["redesign.conversations.empty.find"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["redesign.askbar.send"].exists)
        capture("Conversations empty")

        app.buttons["redesign.conversations.empty.find"].tap()
        XCTAssertTrue(element("redesign.picker").waitForExistence(timeout: 8))
    }

    func testProductionDeviceAuthenticationStatusIsReachable() throws {
        launch()
        reachHomeRoot()

        app.buttons["redesign.home.profile"].tap()
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
        // 監査対象は自分の UI。Google デモ広告の中身は制御できないので枠ごと外す。
        // seed 中の再起動でも落ちないよう、このテストの間ずっと付ける。
        launchExtraArguments = ["-KabuyomiUITestDisableBannerAds"]
        launch()
        // 代表画面は「カードが1枚ある盤面」= 実際に使う人が見る面にする。
        seedBoardWithAAPL()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))

        try app.performAccessibilityAudit { issue in
            let label = issue.element?.label ?? ""
            let verifiedFalsePositives: Set<String> = [
                "残高不足", "クレジットを確認",
                "主要数値", "売上高", "営業利益", "純利益", "営業CF",
                "+16.6%", "+21.3%"
            ]
            // iOS 26.2 misclassifies explicit inverse-color capsules and
            // audit nodes it cannot attach to an element.
            let inaccessibleSystemAuditNode = issue.auditType == .contrast && issue.element == nil

            // `inkMuted` の小さな文字(節見出しの件数・カードの提出日)は
            // トークン側の既知の指摘でリリースオーナーの判断待ち(旧テストから継承)。
            let mutedTokenShapes = [
                "^[0-9]+[件社]$",
                "^[0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日$",
                "^10-[KQ] ・ .*$"
            ]
            let sectionHeaderCountUsesTheMutedToken = issue.auditType == .contrast
                && mutedTokenShapes.contains {
                    label.range(of: $0, options: .regularExpression) != nil
                }
            let missionHeadlineWrapsAtAX3 = issue.auditType == .textClipped
                && label == "SEC資料から、会社を理解する"
            // 「銘柄を追加」は .footnote(動的)+折り返し可で AX サイズでも欠けない
            // (シミュレータ実機確認 2026-08-24)。監査ヒューリスティックの空振り。
            let addAffordanceUsesADynamicFootnote = (issue.auditType == .dynamicType || issue.auditType == .textClipped)
                && label == "銘柄を追加"

            return issue.auditType == .contrast && verifiedFalsePositives.contains(label)
                || inaccessibleSystemAuditNode
                || sectionHeaderCountUsesTheMutedToken
                || missionHeadlineWrapsAtAX3
                || addAffordanceUsesADynamicFootnote
        }
    }

    // MARK: - 初回動線と空状態

    /// 本当の初回インストール。「ようこそ」が根を覆い、「あとで」で空の盤面へ落ちる。
    func testFirstRunShowsTheWelcomeAndSkippingLandsOnTheEmptyBoard() throws {
        launch(freshInstall: true)

        XCTAssertTrue(app.buttons["redesign.welcome.start"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.buttons["redesign.welcome.skip"].exists)
        XCTAssertTrue(app.staticTexts["SEC資料から、会社を理解する"].exists)
        XCTAssertEqual(app.pageIndicators.count, 0)

        for step in ["気になる会社を選ぶ", "決算の要点を日本語で読む", "気になったことを質問する"] {
            XCTAssertTrue(
                app.descendants(matching: .any)
                    .matching(NSPredicate(format: "label CONTAINS %@", step))
                    .firstMatch
                    .waitForExistence(timeout: 4),
                "ようこそに「\(step)」が出ていない"
            )
        }
        capture("Welcome")

        app.buttons["redesign.welcome.skip"].tap()

        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["銘柄を追加しよう"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["redesign.home.empty.find"].exists)
        // ミッション文(法務上の断り書きを含む)は空状態に残る。
        XCTAssertTrue(app.staticTexts["SEC資料から、会社を理解する"].exists)
        capture("Empty board")

        // 空状態の CTA はスターターの複数選択ピッカーを開く。
        app.buttons["redesign.home.empty.find"].tap()
        XCTAssertTrue(app.navigationBars["気になる会社を選ぶ"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["redesign.picker.starter.AAPL"].waitForExistence(timeout: 12))

        // 1社も選んでいないうちは「はじめる」を押せない。
        XCTAssertFalse(app.buttons["redesign.picker.start"].isEnabled)
        app.buttons["redesign.picker.starter.AAPL"].tap()
        XCTAssertTrue(app.buttons["redesign.picker.start"].isEnabled)
        capture("Starter picker")

        func assertSectionReachable(_ title: String) {
            XCTAssertTrue(
                scrollPickerUntilFound(
                    app.descendants(matching: .any)
                        .matching(NSPredicate(format: "label BEGINSWITH %@", title))
                        .firstMatch
                ),
                "ピッカーに分類「\(title)」が無い"
            )
        }

        assertSectionReachable("定番")
        assertSectionReachable("半導体・AI")

        let broadcom = app.buttons["redesign.picker.starter.AVGO"]
        XCTAssertTrue(scrollPickerUntilFound(broadcom), "AVGO の行に届かない")
        broadcom.tap()
        XCTAssertTrue(app.buttons["redesign.picker.start"].isEnabled)

        assertSectionReachable("金融・決済")
        assertSectionReachable("生活・消費")

        app.buttons["redesign.picker.close"].tap()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))

        // 一度閉じた「ようこそ」は再起動しても出ない。
        launch()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 12))
        XCTAssertFalse(app.buttons["redesign.welcome.skip"].exists)
    }

    /// 「銘柄を選んではじめる」はスターターの複数選択ピッカーへ渡す。
    func testWelcomePrimaryActionOpensTheStarterPicker() throws {
        launch(freshInstall: true)

        XCTAssertTrue(app.buttons["redesign.welcome.start"].waitForExistence(timeout: 12))
        app.buttons["redesign.welcome.start"].tap()

        XCTAssertTrue(app.navigationBars["気になる会社を選ぶ"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.buttons["redesign.picker.start"].exists)
        XCTAssertTrue(app.searchFields.firstMatch.exists)

        // ここでも閉じられる。閉じたら空の盤面が受け止める。
        app.buttons["redesign.picker.close"].tap()
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["銘柄を追加しよう"].waitForExistence(timeout: 8))
    }

    /// ピッカーの一覧を下へ送りながら要素を探す。
    private func scrollPickerUntilFound(_ element: XCUIElement, swipes: Int = 4) -> Bool {
        if element.exists && element.isHittable { return true }
        let list = self.element("redesign.picker")
        for _ in 0..<swipes {
            if element.exists && element.isHittable { return true }
            list.swipeUp()
        }
        return element.exists && element.isHittable
    }

    private func launch(freshInstall: Bool = false) {
        app.terminate()
        var arguments = [
            "-AppleLanguages", "(ja)",
            "-AppleLocale", "ja_JP"
        ]
        arguments.append(contentsOf: launchExtraArguments)
        if freshInstall { arguments.append("-KabuyomiUITestFreshInstall") }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 12))
        if !freshInstall { dismissWelcomeIfPresent() }
    }

    /// クリーンインストールの直後は「ようこそ」が根を覆っている。
    @discardableResult
    private func dismissWelcomeIfPresent() -> Bool {
        let skip = app.buttons["redesign.welcome.skip"]
        let home = element("redesign.home")
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            if skip.exists {
                skip.tap()
                XCTAssertTrue(skip.waitForNonExistence(timeout: 8))
                return true
            }
            if home.exists { return false }
            _ = skip.waitForExistence(timeout: 0.4)
        }
        return false
    }

    /// 根のホーム盤面まで戻す。
    private func reachHomeRoot() {
        if element("redesign.home").waitForExistence(timeout: 5) {
            return
        }
        if !app.tabBars.firstMatch.exists {
            edgeSwipeBack()
        }
        selectTab("ホーム")
        XCTAssertTrue(element("redesign.home").waitForExistence(timeout: 8))
    }

    /// ピッカーは検索語が残っているあいだ盤面ではなく検索結果を出す。
    private func clearPickerSearchIfNeeded() {
        let searchField = app.searchFields.firstMatch
        guard searchField.exists,
              let value = searchField.value as? String,
              !value.isEmpty,
              value != searchField.placeholderValue else { return }
        let clearButton = searchField.buttons.firstMatch
        if clearButton.exists {
            clearButton.tap()
        } else {
            searchField.tap()
            searchField.typeText(XCUIKeyboardKey.delete.rawValue)
        }
    }

    /// 盤面に会社を1社用意する。
    /// 開いただけ(保存していない)の会社は、同じセッションのあいだ盤面に出ない。
    /// 起動し直すと出る(Phase 3 からの挙動)。
    private func seedBoardWithAAPL() {
        openAAPLFromHome()
        XCTAssertTrue(app.buttons["redesign.company.sources"].waitForExistence(timeout: 15))
        launch()
        reachHomeRoot()
    }

    private func selectTab(_ name: String) {
        let tab = app.tabBars.buttons[name]
        XCTAssertTrue(tab.waitForExistence(timeout: 8), "タブ「\(name)」が無い")
        tab.tap()
    }

    /// 検索は会社ピッカーのシートの中。まず検索アイコンで開く。
    private func openCompanyPicker() {
        if app.searchFields.firstMatch.exists { return }
        reachHomeRoot()
        app.buttons["redesign.home.search"].tap()
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

    /// ホームから AAPL を開く。盤面カードが無ければ検索から。
    private func openAAPLFromHome() {
        reachHomeRoot()
        let card = app.buttons["redesign.home.open.AAPL"]
        if card.waitForExistence(timeout: 3) {
            card.tap()
            return
        }

        // 初回インストールは bootstrap が終わるまでスターター一覧が出ない。
        // ピッカーの盤面(スターター候補)行から開けるならそれを使う。
        app.buttons["redesign.home.search"].tap()
        XCTAssertTrue(element("redesign.picker").waitForExistence(timeout: 8))
        clearPickerSearchIfNeeded()
        let starterRow = app.buttons["redesign.company.open.AAPL"]
        if starterRow.waitForExistence(timeout: 12) {
            starterRow.tap()
            return
        }

        let searchField = app.searchFields.firstMatch
        searchField.tap()
        searchField.typeText("AAPL")
        XCTAssertTrue(app.buttons["redesign.search.open.AAPL"].waitForExistence(timeout: 15))
        app.buttons["redesign.search.open.AAPL"].tap()
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
