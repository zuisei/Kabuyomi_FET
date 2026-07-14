import StoreKit
import StoreKitTest
import XCTest
@testable import Kabuyomi

@MainActor
final class StoreKitEndToEndTests: XCTestCase {
    private struct TestContext {
        let session: SKTestSession
        let defaults: UserDefaults
        let suiteName: String
    }

    private func makeContext() throws -> TestContext {
        let session = try SKTestSession(configurationFileNamed: "KabuyomiTest")
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        session.locale = Locale(identifier: "ja_JP")
        session.storefront = "JPN"

        let suiteName = "StoreKitEndToEndTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        return TestContext(session: session, defaults: defaults, suiteName: suiteName)
    }

    private func cleanUp(_ context: TestContext) {
        context.session.clearTransactions()
        context.defaults.removePersistentDomain(forName: context.suiteName)
    }

    func testProductionCatalogLoadsFromLocalStoreKitConfiguration() async throws {
        let context = try makeContext()
        defer { cleanUp(context) }
        let store = SubscriptionStore(defaults: context.defaults)

        let subscriptions = try await store.subscriptionProducts()
        let creditPacks = try await store.creditPackProducts()

        XCTAssertEqual(subscriptions.map(\.id), SubscriptionStore.subscriptionProductIDs)
        XCTAssertTrue(subscriptions.allSatisfy(\.isAvailable))
        XCTAssertTrue(subscriptions.allSatisfy { $0.displayPrice?.isEmpty == false })
        XCTAssertEqual(creditPacks.map(\.id), SubscriptionStore.creditPackProductIDs)
        XCTAssertEqual(creditPacks.map(\.credits), [50, 100])
        XCTAssertTrue(creditPacks.allSatisfy(\.isAvailable))
        XCTAssertTrue(creditPacks.allSatisfy { $0.displayPrice?.isEmpty == false })
    }

    func testSubscriptionPurchaseAndRestoreUseVerifiedStoreKitTransactions() async throws {
        let context = try makeContext()
        defer { cleanUp(context) }
        let purchasingStore = SubscriptionStore(defaults: context.defaults)
        let purchaseResult = try await purchasingStore.purchaseSubscription(productId: "kabuyomi.sub.pro.monthly")
        let purchase = try XCTUnwrap(purchaseResult)

        XCTAssertEqual(purchase.syncRequest.productId, "kabuyomi.sub.pro.monthly")
        XCTAssertFalse(purchase.syncRequest.signedTransactionInfo.isEmpty)
        await purchase.finish()

        let restoredSuite = "StoreKitEndToEndTests.restore.\(UUID().uuidString)"
        let restoredDefaults = try XCTUnwrap(UserDefaults(suiteName: restoredSuite))
        defer { restoredDefaults.removePersistentDomain(forName: restoredSuite) }
        let restoredStore = SubscriptionStore(defaults: restoredDefaults)

        try await restoredStore.restorePurchases()

        XCTAssertTrue(restoredStore.isSubscriptionActive)
        XCTAssertEqual(restoredStore.productId, "kabuyomi.sub.pro.monthly")
        XCTAssertNotNil(restoredStore.entitlementLookupOriginalTransactionId)
    }

    func testConsumablePurchaseRemainsUnfinishedUntilServerGrantFinishesIt() async throws {
        let context = try makeContext()
        defer { cleanUp(context) }
        let store = SubscriptionStore(defaults: context.defaults)
        let purchaseResult = try await store.purchaseCreditPack(productId: SubscriptionStore.primaryCreditProductID)
        let purchase = try XCTUnwrap(purchaseResult)

        XCTAssertEqual(purchase.grantRequest.productId, SubscriptionStore.primaryCreditProductID)
        XCTAssertFalse(try XCTUnwrap(purchase.grantRequest.signedTransactionInfo).isEmpty)

        let recoveredBeforeFinish = await store.unfinishedCreditPurchases()
        XCTAssertEqual(recoveredBeforeFinish.map(\.grantRequest.transactionId), [purchase.grantRequest.transactionId])

        await purchase.finish()

        let recoveredAfterFinish = await store.unfinishedCreditPurchases()
        XCTAssertTrue(recoveredAfterFinish.isEmpty)
    }

    func testAskToBuyMapsToPendingWithoutGrantingOrFinishing() async throws {
        let context = try makeContext()
        defer { cleanUp(context) }
        context.session.askToBuyEnabled = true
        let store = SubscriptionStore(defaults: context.defaults)

        do {
            _ = try await store.purchaseCreditPack(productId: SubscriptionStore.primaryCreditProductID)
            XCTFail("Ask to Buy must not return a completed credit purchase")
        } catch let error as SubscriptionStoreError {
            guard case .purchasePending = error else {
                return XCTFail("Unexpected StoreKit result: \(error)")
            }
        }

        let pendingTransactions = context.session.allTransactions().filter(\.pendingAskToBuyConfirmation)
        XCTAssertEqual(pendingTransactions.count, 1)
        XCTAssertEqual(pendingTransactions.first?.productIdentifier, SubscriptionStore.primaryCreditProductID)
    }
}
