import StoreKitTest
import XCTest

@MainActor
final class StoreKitCancellationUITests: XCTestCase {
    private var storeKitSession: SKTestSession?

    func testCancellingStoreKitSheetReturnsCancelledWithoutSuccess() throws {
        try configureStoreKitSession()
        defer { clearStoreKitSession() }
        let app = launchHarnessAndOpenPurchaseSheet()
        let cancelPredicate = NSPredicate(format: "label IN %@", ["閉じる", "Close", "キャンセル", "Cancel"])
        let appCancel = app.buttons.matching(cancelPredicate).firstMatch
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let systemDismiss = springboard.buttons["dismiss"]
        let systemCancel = systemDismiss.exists
            ? systemDismiss
            : springboard.buttons.matching(cancelPredicate).firstMatch

        let cancelButton: XCUIElement
        if appCancel.waitForExistence(timeout: 8) {
            cancelButton = appCancel
        } else {
            XCTAssertTrue(systemCancel.waitForExistence(timeout: 8))
            cancelButton = systemCancel
        }
        cancelButton.tap()

        let status = app.staticTexts["storekit.harness.status"]
        let cancelled = NSPredicate(format: "label == 'cancelled'")
        expectation(for: cancelled, evaluatedWith: status)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.staticTexts["succeeded"].exists)
    }

    func testCompletingStoreKitSheetReturnsVerifiedSuccess() throws {
        try configureStoreKitSession()
        defer { clearStoreKitSession() }
        let app = launchHarnessAndOpenPurchaseSheet()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let confirmPredicate = NSPredicate(
            format: "label IN %@",
            ["Subscribe", "Purchase", "購入", "登録", "サブスクリプションに登録"]
        )
        let confirmButton = springboard.buttons.matching(confirmPredicate).firstMatch

        XCTAssertTrue(confirmButton.waitForExistence(timeout: 10))
        confirmButton.tap()

        let completionButton = springboard.buttons["OK"]
        XCTAssertTrue(completionButton.waitForExistence(timeout: 10))
        completionButton.tap()

        let status = app.staticTexts["storekit.harness.status"]
        let succeeded = NSPredicate(format: "label == 'succeeded'")
        expectation(for: succeeded, evaluatedWith: status)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.staticTexts["cancelled"].exists)
    }

    private func launchHarnessAndOpenPurchaseSheet() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-StoreKitCancellationHarness",
            "-AppleLanguages", "(ja)",
            "-AppleLocale", "ja_JP"
        ]
        app.launch()

        let purchaseButton = app.buttons["storekit.harness.purchase"]
        XCTAssertTrue(purchaseButton.waitForExistence(timeout: 10))
        purchaseButton.tap()
        return app
    }

    private func configureStoreKitSession() throws {
        let session = try SKTestSession(configurationFileNamed: "KabuyomiTest")
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = false
        session.locale = Locale(identifier: "ja_JP")
        session.storefront = "JPN"
        storeKitSession = session
    }

    private func clearStoreKitSession() {
        storeKitSession?.clearTransactions()
        storeKitSession = nil
    }
}
