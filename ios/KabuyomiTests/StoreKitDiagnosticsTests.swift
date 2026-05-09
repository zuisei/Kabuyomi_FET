import XCTest
@testable import Kabuyomi

final class StoreKitDiagnosticsTests: XCTestCase {
    func testDiagnosticsStateUpdatesOnProductLoadSuccess() {
        var diagnostics = StoreKitDiagnosticsSnapshot.initial(
            appVersion: "1.0",
            buildNumber: "7",
            bundleIdentifier: "app.kabuyomi.ios",
            requestedProductIds: ["kabuyomi.credits.50"]
        )

        diagnostics.markProductLoadStarted(
            requestedProductIds: ["kabuyomi.credits.50"],
            canMakePayments: true,
            storefrontCountryCode: "JPN",
            storefrontId: "143462",
            at: "2026-05-05T10:00:00Z"
        )
        diagnostics.markProductLoadCompleted(
            returnedProductIds: ["kabuyomi.credits.50"],
            at: "2026-05-05T10:00:01Z"
        )

        XCTAssertEqual(diagnostics.productLoadStatus, .success)
        XCTAssertEqual(diagnostics.requestedProductIds, ["kabuyomi.credits.50"])
        XCTAssertEqual(diagnostics.returnedProductCount, 1)
        XCTAssertEqual(diagnostics.returnedProductIds, ["kabuyomi.credits.50"])
        XCTAssertEqual(diagnostics.canMakePayments, true)
        XCTAssertEqual(diagnostics.storefrontCountryCode, "JPN")
    }

    func testDiagnosticsStateUpdatesOnEmptyProductResponse() {
        var diagnostics = StoreKitDiagnosticsSnapshot.initial(
            appVersion: "1.0",
            buildNumber: "7",
            bundleIdentifier: "app.kabuyomi.ios",
            requestedProductIds: ["kabuyomi.credits.50"]
        )

        diagnostics.markProductLoadStarted(
            requestedProductIds: ["kabuyomi.credits.50"],
            canMakePayments: true,
            storefrontCountryCode: nil,
            storefrontId: nil,
            at: "2026-05-05T10:00:00Z"
        )
        diagnostics.markProductLoadCompleted(returnedProductIds: [], at: "2026-05-05T10:00:01Z")

        XCTAssertEqual(diagnostics.productLoadStatus, .empty)
        XCTAssertEqual(diagnostics.returnedProductCount, 0)
        XCTAssertEqual(diagnostics.returnedProductIds, [])
        XCTAssertNil(diagnostics.lastProductLoadError)
        XCTAssertTrue(diagnostics.diagnosticLines.contains("returnedProductCount: 0"))
    }

    func testDiagnosticsLinesDoNotExposeSensitiveIdentifiers() {
        var diagnostics = StoreKitDiagnosticsSnapshot.initial(requestedProductIds: ["kabuyomi.credits.50"])

        diagnostics.markPurchaseStarted(productId: "kabuyomi.credits.50")
        diagnostics.markBackendGrantStatus("already_granted")

        let joinedLines = diagnostics.diagnosticLines.joined(separator: "\n")
        XCTAssertFalse(joinedLines.contains("signedTransactionInfo"))
        XCTAssertFalse(joinedLines.contains("deviceKey"))
        XCTAssertFalse(joinedLines.contains("transactionId"))
    }
}
