import Foundation
import StoreKit
import OSLog

// Retained for post-beta billing reactivation.
extension Notification.Name {
    static let kabuyomiSubscriptionStateDidChange = Notification.Name("kabuyomi.subscriptionStateDidChange")
}

@MainActor
final class SubscriptionStore {
    static let shared = SubscriptionStore()

    static let proMonthlyProductID = "app.kabuyomi.pro.monthly"

    private let quotaSubjectKey = "kabuyomi.quotaSubject"
    private let planKey = "kabuyomi.plan"
    private let productIdKey = "kabuyomi.subscription.productId"
    private let originalTransactionIdKey = "kabuyomi.subscription.originalTransactionId"
    private let activeKey = "kabuyomi.subscription.active"
    private let lastSyncedOriginalTransactionIdKey = "kabuyomi.subscription.lastSynced.originalTransactionId"
    private let lastSyncedProductIdKey = "kabuyomi.subscription.lastSynced.productId"
    private let lastSyncedActiveKey = "kabuyomi.subscription.lastSynced.active"

    private let defaults = UserDefaults.standard
    private let logger = Logger(subsystem: "app.kabuyomi.ios", category: "subscription")

    private var updatesTask: Task<Void, Never>?
    private var cachedProducts: [Product] = []

    var quotaSubject: String? {
        defaults.string(forKey: quotaSubjectKey)
    }

    var plan: String {
        defaults.string(forKey: planKey) ?? "free"
    }

    var productId: String? {
        defaults.string(forKey: productIdKey)
    }

    var isSubscriptionActive: Bool {
        defaults.bool(forKey: activeKey)
    }

    func purchasePro() async throws -> Bool {
        startObservingTransactionsIfNeeded()
        let product = try await proProduct()
        let result = try await product.purchase()

        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification else {
                logger.error("purchase_result=unverified")
                return false
            }

            logger.notice(
                "purchase_result=success product_id=\(transaction.productID, privacy: .public) transaction_id=\(String(transaction.id), privacy: .public)"
            )
            await refreshEntitlements(reason: "purchase")
            await transaction.finish()
            return isSubscriptionActive

        case .userCancelled:
            logger.notice("purchase_result=cancelled")
            return false

        case .pending:
            logger.notice("purchase_result=pending")
            return false

        @unknown default:
            logger.error("purchase_result=unknown")
            return false
        }
    }

    func restorePurchases() async throws {
        logger.notice("restore_result=started")
        try await AppStore.sync()
        await refreshEntitlements(reason: "restore")
        logger.notice("restore_result=completed active=\(self.isSubscriptionActive, privacy: .public)")
    }

    func refreshEntitlements(reason: String) async {
        startObservingTransactionsIfNeeded()

        var latestActiveSubscription: Transaction?
        for await entitlement in Transaction.currentEntitlements {
            guard case .verified(let transaction) = entitlement else {
                logger.error("refresh_entitlements_result=unverified reason=\(reason, privacy: .public)")
                continue
            }

            guard transaction.productID == Self.proMonthlyProductID else {
                continue
            }

            if isActive(transaction) {
                latestActiveSubscription = transaction
            }
        }

        if let transaction = latestActiveSubscription {
            storeSubscriptionState(
                productId: transaction.productID,
                originalTransactionId: String(transaction.originalID),
                active: true
            )
            logger.notice(
                "refresh_entitlements_result=active reason=\(reason, privacy: .public) product_id=\(transaction.productID, privacy: .public) original_transaction_id=\(String(transaction.originalID), privacy: .public)"
            )
        } else if let previousOriginalTransactionId = defaults.string(forKey: originalTransactionIdKey) {
            storeSubscriptionState(
                productId: defaults.string(forKey: productIdKey),
                originalTransactionId: previousOriginalTransactionId,
                active: false
            )
            logger.notice(
                "refresh_entitlements_result=inactive reason=\(reason, privacy: .public) original_transaction_id=\(previousOriginalTransactionId, privacy: .public)"
            )
        } else {
            clearLocalEntitlement()
            logger.notice("refresh_entitlements_result=none reason=\(reason, privacy: .public)")
        }
    }

    func syncRequestIfAvailable() async throws -> BillingSyncRequest? {
        let snapshot = currentSnapshot()
        guard let originalTransactionId = snapshot.originalTransactionId else {
            return nil
        }

        let lastSyncedSnapshot = syncedSnapshot()
        guard snapshot != lastSyncedSnapshot else {
            return nil
        }

        logger.notice(
            "billing_sync_attempt active=\(snapshot.active, privacy: .public) product_id=\(snapshot.productId ?? "nil", privacy: .public) original_transaction_id=\(originalTransactionId, privacy: .public)"
        )

        return BillingSyncRequest(
            originalTransactionId: originalTransactionId,
            productId: snapshot.productId,
            active: snapshot.active
        )
    }

    func apply(_ response: BillingSyncResponse) {
        defaults.set(response.quotaSubject, forKey: quotaSubjectKey)
        defaults.set(response.plan, forKey: planKey)

        let snapshot = currentSnapshot()
        set(snapshot.originalTransactionId, forKey: lastSyncedOriginalTransactionIdKey)
        set(snapshot.productId, forKey: lastSyncedProductIdKey)
        defaults.set(snapshot.active, forKey: lastSyncedActiveKey)

        logger.notice(
            "billing_sync_result plan=\(response.plan, privacy: .public) quota_subject=\(response.quotaSubject, privacy: .public) product_id=\(response.productId ?? "nil", privacy: .public)"
        )
    }

    private func startObservingTransactionsIfNeeded() {
        guard updatesTask == nil else { return }

        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                guard let self else { return }

                switch update {
                case .verified(let transaction):
                    self.logger.notice(
                        "transaction_update product_id=\(transaction.productID, privacy: .public) original_transaction_id=\(String(transaction.originalID), privacy: .public)"
                    )
                    await self.refreshEntitlements(reason: "transaction_update")
                    await transaction.finish()
                    NotificationCenter.default.post(name: .kabuyomiSubscriptionStateDidChange, object: nil)

                case .unverified(_, let error):
                    self.logger.error("transaction_update=unverified error=\(error.localizedDescription, privacy: .public)")
                }
            }
        }
    }

    private func proProduct() async throws -> Product {
        if let cachedProduct = cachedProducts.first(where: { $0.id == Self.proMonthlyProductID }) {
            return cachedProduct
        }

        let products = try await Product.products(for: [Self.proMonthlyProductID])
        cachedProducts = products

        guard let product = products.first(where: { $0.id == Self.proMonthlyProductID }) else {
            logger.error("purchase_result=product_not_found product_id=\(Self.proMonthlyProductID, privacy: .public)")
            throw SubscriptionStoreError.productNotFound
        }

        return product
    }

    private func storeSubscriptionState(productId: String?, originalTransactionId: String, active: Bool) {
        set(productId, forKey: productIdKey)
        set(originalTransactionId, forKey: originalTransactionIdKey)
        defaults.set(active, forKey: activeKey)
    }

    private func clearLocalEntitlement() {
        defaults.removeObject(forKey: quotaSubjectKey)
        defaults.set("free", forKey: planKey)
        defaults.removeObject(forKey: productIdKey)
        defaults.removeObject(forKey: originalTransactionIdKey)
        defaults.set(false, forKey: activeKey)
    }

    private func syncedSnapshot() -> BillingSyncSnapshot {
        BillingSyncSnapshot(
            productId: defaults.string(forKey: lastSyncedProductIdKey),
            originalTransactionId: defaults.string(forKey: lastSyncedOriginalTransactionIdKey),
            active: defaults.bool(forKey: lastSyncedActiveKey)
        )
    }

    private func currentSnapshot() -> BillingSyncSnapshot {
        BillingSyncSnapshot(
            productId: defaults.string(forKey: productIdKey),
            originalTransactionId: defaults.string(forKey: originalTransactionIdKey),
            active: defaults.bool(forKey: activeKey)
        )
    }

    private func isActive(_ transaction: Transaction) -> Bool {
        if transaction.revocationDate != nil {
            return false
        }

        if let expirationDate = transaction.expirationDate {
            return expirationDate > Date()
        }

        return true
    }

    private func set(_ value: String?, forKey key: String) {
        if let value {
            defaults.set(value, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
}

private struct BillingSyncSnapshot: Equatable {
    let productId: String?
    let originalTransactionId: String?
    let active: Bool
}

enum SubscriptionStoreError: LocalizedError {
    case productNotFound

    var errorDescription: String? {
        switch self {
        case .productNotFound:
            "Pro 商品を取得できませんでした。時間をおいて再度お試しください。"
        }
    }
}
