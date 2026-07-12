import Foundation
import StoreKit
import OSLog

extension Notification.Name {
    static let kabuyomiSubscriptionStateDidChange = Notification.Name("kabuyomi.subscriptionStateDidChange")
}

@MainActor
final class SubscriptionStore {
    static let shared = SubscriptionStore()

    static let subscriptionProductIDs = BillingCatalog.subscriptionTiers.compactMap(\.productID)
    static let recognizedSubscriptionProductIDs = BillingCatalog.recognizedSubscriptionTiers.compactMap(\.productID)
    static let primaryCreditProductID = "kabuyomi.credits.50"
    static let legacyCreditProductID = "kabuyomi.credits.100"
    static let miniCreditProductID = primaryCreditProductID
    static let creditPackProductIDs = [primaryCreditProductID, legacyCreditProductID]
    private static let creditPackProductLoadTimeoutNanoseconds: UInt64 = 10_000_000_000

    private let quotaSubjectKey = "kabuyomi.quotaSubject"
    private let planKey = "kabuyomi.plan"
    private let productIdKey = "kabuyomi.subscription.productId"
    private let transactionIdKey = "kabuyomi.subscription.transactionId"
    private let originalTransactionIdKey = "kabuyomi.subscription.originalTransactionId"
    private let signedTransactionInfoKey = "kabuyomi.subscription.signedTransactionInfo"
    private let activeKey = "kabuyomi.subscription.active"
    private let lastSyncedOriginalTransactionIdKey = "kabuyomi.subscription.lastSynced.originalTransactionId"
    private let lastSyncedProductIdKey = "kabuyomi.subscription.lastSynced.productId"
    private let lastSyncedTransactionIdKey = "kabuyomi.subscription.lastSynced.transactionId"

    private let defaults: UserDefaults
    private let logger = Logger(subsystem: "app.kabuyomi.ios", category: "subscription")

    private var updatesTask: Task<Void, Never>?
    private var cachedProducts: [Product] = []
    private var cachedCreditPackProducts: [Product] = []
    private var diagnostics = StoreKitDiagnosticsSnapshot.initial(requestedProductIds: creditPackProductIDs)

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

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

    var entitlementLookupOriginalTransactionId: String? {
        let value = defaults.string(forKey: originalTransactionIdKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }

    // Kept as a source-compatible alias while callers migrate to locator terminology.
    var requestOriginalTransactionId: String? {
        entitlementLookupOriginalTransactionId
    }

    var storeKitDiagnostics: StoreKitDiagnosticsSnapshot {
        diagnostics
    }

    func recordPurchaseButtonVisibilityReason(_ reason: String) {
        diagnostics.updatePurchaseButtonVisibilityReason(reason)
    }

    func recordBackendGrantStarted() {
        diagnostics.markBackendGrantStatus("started")
        logger.notice("mini_iap_backend_grant_started product_ids=\(Self.creditPackProductIDs.joined(separator: ","), privacy: .public)")
    }

    func recordBackendGrantSucceeded(didMutate: Bool) {
        let status = didMutate ? "succeeded" : "already_granted"
        diagnostics.markBackendGrantStatus(status)
        if didMutate {
            logger.notice("mini_iap_backend_grant_succeeded product_ids=\(Self.creditPackProductIDs.joined(separator: ","), privacy: .public)")
        } else {
            logger.notice("mini_iap_backend_grant_already_granted product_ids=\(Self.creditPackProductIDs.joined(separator: ","), privacy: .public)")
        }
    }

    func recordBackendGrantFailed(_ error: Error) {
        diagnostics.markBackendGrantFailed(error)
        let nsError = error as NSError
        logger.error(
            "mini_iap_backend_grant_failed domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) message=\(nsError.localizedDescription, privacy: .public)"
        )
    }

    func recordTransactionFinished() {
        diagnostics.markTransactionFinished()
        logger.notice("mini_iap_transaction_finished")
    }

    func subscriptionProducts() async throws -> [SubscriptionProduct] {
        let products = try await loadSubscriptionProducts()
        return BillingCatalog.subscriptionTiers.map { tier in
            guard let productID = tier.productID else {
                return SubscriptionProduct(tier: tier, displayPrice: nil, isAvailable: false)
            }
            let product = products.first(where: { $0.id == productID })
            return SubscriptionProduct(
                tier: tier,
                displayPrice: product?.displayPrice,
                isAvailable: product != nil
            )
        }
    }

    func purchaseSubscription(productId: String) async throws -> PendingSubscriptionPurchase? {
        startObservingTransactionsIfNeeded()
        let product = try await subscriptionProduct(id: productId)
        let result = try await product.purchase()

        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification else {
                logger.error("purchase_result=unverified")
                throw SubscriptionStoreError.purchaseUnverified
            }

            logger.notice(
                "purchase_result=success product_id=\(transaction.productID, privacy: .public) transaction_id=\(Self.redactedIdentifier(String(transaction.id)), privacy: .public)"
            )
            storeSubscriptionState(
                productId: transaction.productID,
                transactionId: String(transaction.id),
                originalTransactionId: String(transaction.originalID),
                signedTransactionInfo: verification.jwsRepresentation,
                active: isActive(transaction)
            )
            return PendingSubscriptionPurchase(transaction: transaction, signedTransactionInfo: verification.jwsRepresentation)

        case .userCancelled:
            logger.notice("purchase_result=cancelled")
            return nil

        case .pending:
            logger.notice("purchase_result=pending")
            throw SubscriptionStoreError.purchasePending

        @unknown default:
            logger.error("purchase_result=unknown")
            throw SubscriptionStoreError.purchaseUnknown
        }
    }

    func purchasePro() async throws -> PendingSubscriptionPurchase? {
        try await purchaseSubscription(productId: BillingCatalog.pro.productID ?? "")
    }

    func restorePurchases() async throws {
        logger.notice("restore_result=started")
        try await AppStore.sync()
        await refreshEntitlements(reason: "restore")
        logger.notice("restore_result=completed active=\(self.isSubscriptionActive, privacy: .public)")
    }

    func creditPackProducts() async throws -> [CreditPackProduct] {
        let products = try await loadCreditPackProducts()
        return Self.creditPackProductIDs.map { productId in
            if let product = products.first(where: { $0.id == productId }) {
                return CreditPackProduct(
                    id: product.id,
                    credits: Self.credits(for: product.id),
                    displayPrice: product.displayPrice,
                    isAvailable: true
                )
            }

            return CreditPackProduct(
                id: productId,
                credits: Self.credits(for: productId),
                displayPrice: nil,
                isAvailable: false
            )
        }
    }

    func purchaseCreditPack(productId: String, appAccountToken: UUID? = nil) async throws -> PendingCreditPurchase? {
        startObservingTransactionsIfNeeded()
        diagnostics.markPurchaseStarted(productId: productId)
        logger.notice("mini_iap_purchase_started product_id=\(productId, privacy: .public)")
        let product = try await creditPackProduct(id: productId)
        let result: Product.PurchaseResult
        if let appAccountToken {
            result = try await product.purchase(options: [.appAccountToken(appAccountToken)])
        } else {
            result = try await product.purchase()
        }

        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification else {
                diagnostics.markPurchaseFailed(SubscriptionStoreError.purchaseUnverified)
                logger.error("mini_iap_purchase_failed product_id=\(productId, privacy: .public) reason=unverified")
                throw SubscriptionStoreError.purchaseUnverified
            }

            diagnostics.markPurchaseStatus("succeeded:\(productId)")
            logger.notice(
                "mini_iap_purchase_succeeded product_id=\(transaction.productID, privacy: .public) transaction_id=\(Self.redactedIdentifier(String(transaction.id)), privacy: .public)"
            )
            return PendingCreditPurchase(transaction: transaction, signedTransactionInfo: verification.jwsRepresentation)

        case .userCancelled:
            diagnostics.markPurchaseStatus("cancelled:\(productId)")
            logger.notice("mini_iap_purchase_failed product_id=\(productId, privacy: .public) reason=user_cancelled")
            return nil

        case .pending:
            diagnostics.markPurchaseFailed(SubscriptionStoreError.purchasePending)
            logger.notice("mini_iap_purchase_failed product_id=\(productId, privacy: .public) reason=pending")
            throw SubscriptionStoreError.purchasePending

        @unknown default:
            diagnostics.markPurchaseFailed(SubscriptionStoreError.purchaseUnknown)
            logger.error("mini_iap_purchase_failed product_id=\(productId, privacy: .public) reason=unknown")
            throw SubscriptionStoreError.purchaseUnknown
        }
    }

    func unfinishedCreditPurchases() async -> [PendingCreditPurchase] {
        startObservingTransactionsIfNeeded()

        var purchases: [PendingCreditPurchase] = []
        for await verification in Transaction.unfinished {
            switch verification {
            case .verified(let transaction):
                guard Self.isCreditPackProduct(transaction.productID) else {
                    continue
                }
                logger.notice(
                    "credit_purchase_recovery=found product_id=\(transaction.productID, privacy: .public) transaction_id=\(Self.redactedIdentifier(String(transaction.id)), privacy: .public)"
                )
                purchases.append(PendingCreditPurchase(transaction: transaction, signedTransactionInfo: verification.jwsRepresentation))

            case .unverified(_, let error):
                logger.error("credit_purchase_recovery=unverified error=\(error.localizedDescription, privacy: .public)")
            }
        }
        return purchases
    }

    func refreshEntitlements(reason: String) async {
        startObservingTransactionsIfNeeded()

        var latestActiveSubscription: (transaction: Transaction, signedTransactionInfo: String)?
        for await entitlement in Transaction.currentEntitlements {
            guard case .verified(let transaction) = entitlement else {
                logger.error("refresh_entitlements_result=unverified reason=\(reason, privacy: .public)")
                continue
            }

            guard Self.isSubscriptionProduct(transaction.productID) else {
                continue
            }

            if isActive(transaction) {
                if latestActiveSubscription == nil || planPriority(transaction.productID) > planPriority(latestActiveSubscription?.transaction.productID) {
                    latestActiveSubscription = (transaction, entitlement.jwsRepresentation)
                }
            }
        }

        if let latestActiveSubscription {
            let transaction = latestActiveSubscription.transaction
            storeSubscriptionState(
                productId: transaction.productID,
                transactionId: String(transaction.id),
                originalTransactionId: String(transaction.originalID),
                signedTransactionInfo: latestActiveSubscription.signedTransactionInfo,
                active: true
            )
            logger.notice(
                "refresh_entitlements_result=active reason=\(reason, privacy: .public) product_id=\(transaction.productID, privacy: .public) original_transaction_id=\(Self.redactedIdentifier(String(transaction.originalID)), privacy: .public)"
            )
        } else if let previousOriginalTransactionId = defaults.string(forKey: originalTransactionIdKey) {
            storeSubscriptionState(
                productId: defaults.string(forKey: productIdKey),
                transactionId: nil,
                originalTransactionId: previousOriginalTransactionId,
                signedTransactionInfo: nil,
                active: false
            )
            logger.notice(
                "refresh_entitlements_result=inactive reason=\(reason, privacy: .public) original_transaction_id=\(Self.redactedIdentifier(previousOriginalTransactionId), privacy: .public)"
            )
        } else {
            clearLocalEntitlement()
            logger.notice("refresh_entitlements_result=none reason=\(reason, privacy: .public)")
        }
    }

    func syncRequestIfAvailable() async throws -> BillingSyncRequest? {
        let snapshot = currentSnapshot()
        guard let request = snapshot.verifiedRequest else {
            return nil
        }

        let lastSyncedSnapshot = syncedSnapshot()
        guard snapshot != lastSyncedSnapshot else {
            return nil
        }

        logger.notice(
            "billing_sync_attempt material=verified product_id=\(request.productId, privacy: .public) original_transaction_id=\(Self.redactedIdentifier(request.originalTransactionId), privacy: .public) transaction_id=\(Self.redactedIdentifier(request.transactionId), privacy: .public)"
        )

        return request
    }

    func apply(_ response: BillingSyncResponse) {
        defaults.set(response.quotaSubject, forKey: quotaSubjectKey)
        defaults.set(response.plan, forKey: planKey)

        let snapshot = currentSnapshot()
        set(snapshot.originalTransactionId, forKey: lastSyncedOriginalTransactionIdKey)
        set(snapshot.productId, forKey: lastSyncedProductIdKey)
        set(snapshot.transactionId, forKey: lastSyncedTransactionIdKey)

        logger.notice(
            "billing_sync_result plan=\(response.plan, privacy: .public) quota_subject=\(Self.redactedIdentifier(response.quotaSubject), privacy: .public) product_id=\(response.productId ?? "nil", privacy: .public)"
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
                        "transaction_update product_id=\(transaction.productID, privacy: .public) original_transaction_id=\(Self.redactedIdentifier(String(transaction.originalID)), privacy: .public)"
                    )
                    if Self.isCreditPackProduct(transaction.productID) {
                        self.logger.notice(
                            "transaction_update=mini_credit_pending_server_grant product_id=\(transaction.productID, privacy: .public) transaction_id=\(Self.redactedIdentifier(String(transaction.id)), privacy: .public)"
                        )
                        NotificationCenter.default.post(name: .kabuyomiSubscriptionStateDidChange, object: nil)
                        continue
                    }

                    await self.refreshEntitlements(reason: "transaction_update")
                    await transaction.finish()
                    NotificationCenter.default.post(name: .kabuyomiSubscriptionStateDidChange, object: nil)

                case .unverified(_, let error):
                    self.logger.error("transaction_update=unverified error=\(error.localizedDescription, privacy: .public)")
                }
            }
        }
    }

    private func subscriptionProduct(id productId: String) async throws -> Product {
        guard Self.isPurchasableSubscriptionProduct(productId) else {
            throw SubscriptionStoreError.productNotFound
        }

        if let cachedProduct = cachedProducts.first(where: { $0.id == productId }) {
            return cachedProduct
        }

        let products = try await loadSubscriptionProducts()

        guard let product = products.first(where: { $0.id == productId }) else {
            logger.error("purchase_result=product_not_found product_id=\(productId, privacy: .public)")
            throw SubscriptionStoreError.productNotFound
        }

        return product
    }

    private func loadSubscriptionProducts() async throws -> [Product] {
        if !cachedProducts.isEmpty {
            return cachedProducts
        }

        let products = try await Product.products(for: Self.subscriptionProductIDs)
        cachedProducts = products
        return products
    }

    private func creditPackProduct(id productId: String) async throws -> Product {
        guard Self.creditPackProductIDs.contains(productId) else {
            diagnostics.markPurchaseFailed(SubscriptionStoreError.productNotFound)
            throw SubscriptionStoreError.productNotFound
        }

        let products = try await loadCreditPackProducts()
        guard let product = products.first(where: { $0.id == productId }) else {
            diagnostics.markPurchaseFailed(SubscriptionStoreError.productNotFound)
            logger.error("mini_iap_purchase_failed product_id=\(productId, privacy: .public) reason=product_not_found")
            throw SubscriptionStoreError.productNotFound
        }

        return product
    }

    private func loadCreditPackProducts() async throws -> [Product] {
        if !cachedCreditPackProducts.isEmpty {
            diagnostics.markProductLoadCompleted(returnedProductIds: cachedCreditPackProducts.map(\.id))
            return cachedCreditPackProducts
        }

        let canMakePayments = AppStore.canMakePayments
        let storefront = await Storefront.current
        diagnostics.markProductLoadStarted(
            requestedProductIds: Self.creditPackProductIDs,
            canMakePayments: canMakePayments,
            storefrontCountryCode: storefront?.countryCode,
            storefrontId: storefront?.id
        )
        let diagnosticBundleIdentifier = diagnostics.bundleIdentifier
        let diagnosticAppVersion = diagnostics.appVersion
        let diagnosticBuildNumber = diagnostics.buildNumber
        let storefrontCountry = storefront?.countryCode ?? "unknown"
        let storefrontIdentifier = storefront?.id ?? "unknown"
        logger.notice(
            "mini_iap_can_make_payments_result can_make_payments=\(canMakePayments, privacy: .public) bundle_id=\(diagnosticBundleIdentifier, privacy: .public) app_version=\(diagnosticAppVersion, privacy: .public) build_number=\(diagnosticBuildNumber, privacy: .public)"
        )
        logger.notice(
            "mini_iap_storefront_loaded country=\(storefrontCountry, privacy: .public) storefront_id=\(storefrontIdentifier, privacy: .public)"
        )
        logger.notice(
            "mini_iap_product_load_started product_ids=\(Self.creditPackProductIDs.joined(separator: ","), privacy: .public) bundle_id=\(diagnosticBundleIdentifier, privacy: .public) app_version=\(diagnosticAppVersion, privacy: .public) build_number=\(diagnosticBuildNumber, privacy: .public) storefront_country=\(storefrontCountry, privacy: .public) can_make_payments=\(canMakePayments, privacy: .public)"
        )

        let products: [Product]
        do {
            products = try await productsWithTimeout(
                for: Self.creditPackProductIDs,
                timeoutNanoseconds: Self.creditPackProductLoadTimeoutNanoseconds
            )
        } catch SubscriptionStoreError.productLoadTimedOut {
            diagnostics.markProductLoadFailed(SubscriptionStoreError.productLoadTimedOut)
            logger.error(
                "mini_iap_product_load_failed product_ids=\(Self.creditPackProductIDs.joined(separator: ","), privacy: .public) domain=Kabuyomi.SubscriptionStoreError code=0 message=timed_out timeout_seconds=10"
            )
            throw SubscriptionStoreError.productLoadTimedOut
        } catch {
            diagnostics.markProductLoadFailed(error)
            let nsError = error as NSError
            logger.error(
                "mini_iap_product_load_failed product_ids=\(Self.creditPackProductIDs.joined(separator: ","), privacy: .public) domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) message=\(nsError.localizedDescription, privacy: .public)"
            )
            throw error
        }

        diagnostics.markProductLoadCompleted(returnedProductIds: products.map(\.id))
        let returnedProductIds = products.map(\.id).joined(separator: ",")
        let diagnosticCanMakePayments = diagnostics.canMakePayments.map(String.init) ?? "unknown"
        let diagnosticStorefrontCountry = diagnostics.storefrontCountryCode ?? "unknown"
        let completedDiagnosticBundleIdentifier = diagnostics.bundleIdentifier
        let completedDiagnosticAppVersion = diagnostics.appVersion
        let completedDiagnosticBuildNumber = diagnostics.buildNumber
        if products.isEmpty {
            logger.error(
                "mini_iap_product_load_empty product_ids=\(Self.creditPackProductIDs.joined(separator: ","), privacy: .public) returned_count=0 returned_product_ids= bundle_id=\(completedDiagnosticBundleIdentifier, privacy: .public) app_version=\(completedDiagnosticAppVersion, privacy: .public) build_number=\(completedDiagnosticBuildNumber, privacy: .public) storefront_country=\(diagnosticStorefrontCountry, privacy: .public) can_make_payments=\(diagnosticCanMakePayments, privacy: .public)"
            )
        } else {
            logger.notice(
                "mini_iap_product_load_success product_ids=\(Self.creditPackProductIDs.joined(separator: ","), privacy: .public) returned_count=\(products.count, privacy: .public) returned_product_ids=\(returnedProductIds, privacy: .public) bundle_id=\(completedDiagnosticBundleIdentifier, privacy: .public) app_version=\(completedDiagnosticAppVersion, privacy: .public) build_number=\(completedDiagnosticBuildNumber, privacy: .public) storefront_country=\(diagnosticStorefrontCountry, privacy: .public) can_make_payments=\(diagnosticCanMakePayments, privacy: .public)"
            )
        }

        cachedCreditPackProducts = products
        return products
    }

    private func productsWithTimeout(for productIDs: [String], timeoutNanoseconds: UInt64) async throws -> [Product] {
        try await withThrowingTaskGroup(of: [Product].self) { group in
            group.addTask {
                try await Product.products(for: productIDs)
            }
            group.addTask {
                try await Task.sleep(nanoseconds: timeoutNanoseconds)
                throw SubscriptionStoreError.productLoadTimedOut
            }

            guard let products = try await group.next() else {
                group.cancelAll()
                throw SubscriptionStoreError.productNotFound
            }
            group.cancelAll()
            return products
        }
    }

    private func storeSubscriptionState(
        productId: String?,
        transactionId: String?,
        originalTransactionId: String,
        signedTransactionInfo: String?,
        active: Bool
    ) {
        set(productId, forKey: productIdKey)
        set(transactionId, forKey: transactionIdKey)
        set(originalTransactionId, forKey: originalTransactionIdKey)
        set(signedTransactionInfo, forKey: signedTransactionInfoKey)
        defaults.set(active, forKey: activeKey)
    }

    private func clearLocalEntitlement() {
        defaults.removeObject(forKey: quotaSubjectKey)
        defaults.set("free", forKey: planKey)
        defaults.removeObject(forKey: productIdKey)
        defaults.removeObject(forKey: transactionIdKey)
        defaults.removeObject(forKey: originalTransactionIdKey)
        defaults.removeObject(forKey: signedTransactionInfoKey)
        defaults.set(false, forKey: activeKey)
    }

    private func syncedSnapshot() -> BillingSyncSnapshot {
        BillingSyncSnapshot(
            productId: defaults.string(forKey: lastSyncedProductIdKey),
            transactionId: defaults.string(forKey: lastSyncedTransactionIdKey),
            originalTransactionId: defaults.string(forKey: lastSyncedOriginalTransactionIdKey),
            signedTransactionInfo: nil
        )
    }

    private func currentSnapshot() -> BillingSyncSnapshot {
        BillingSyncSnapshot(
            productId: defaults.string(forKey: productIdKey),
            transactionId: defaults.string(forKey: transactionIdKey),
            originalTransactionId: defaults.string(forKey: originalTransactionIdKey),
            signedTransactionInfo: defaults.string(forKey: signedTransactionInfoKey)
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

    private static func credits(for productId: String) -> Int {
        switch productId {
        case primaryCreditProductID:
            return 50
        case legacyCreditProductID:
            return 100
        default:
            return 0
        }
    }

    private static func isCreditPackProduct(_ productId: String) -> Bool {
        creditPackProductIDs.contains(productId)
    }

    private static func isSubscriptionProduct(_ productId: String) -> Bool {
        recognizedSubscriptionProductIDs.contains(productId)
    }

    private static func isPurchasableSubscriptionProduct(_ productId: String) -> Bool {
        subscriptionProductIDs.contains(productId)
    }

    private static func redactedIdentifier(_ value: String) -> String {
        guard value.count > 8 else { return "redacted" }
        return "\(value.prefix(4))...\(value.suffix(4))"
    }

    private func planPriority(_ productId: String?) -> Int {
        guard let productId,
              let tier = BillingCatalog.tier(forProductID: productId) else {
            return 0
        }

        switch tier.plan {
        case BillingCatalog.proMax.plan:
            return 3
        case BillingCatalog.pro.plan:
            return 2
        case BillingCatalog.lite.plan:
            return 1
        default:
            return 0
        }
    }
}

struct SubscriptionProduct: Identifiable, Hashable {
    let tier: BillingTier
    let displayPrice: String?
    let isAvailable: Bool

    var id: String {
        tier.productID ?? tier.plan
    }
}

struct CreditPackProduct: Identifiable, Hashable {
    let id: String
    let credits: Int
    let displayPrice: String?
    let isAvailable: Bool
}

struct PendingCreditPurchase {
    let transaction: Transaction
    let signedTransactionInfo: String

    var grantRequest: CreditPurchaseGrantRequest {
        CreditPurchaseGrantRequest(
            productId: transaction.productID,
            transactionId: String(transaction.id),
            originalTransactionId: String(transaction.originalID),
            purchasedAt: Self.iso8601String(from: transaction.purchaseDate),
            signedTransactionInfo: signedTransactionInfo
        )
    }

    func finish() async {
        await transaction.finish()
    }

    private static func iso8601String(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

struct PendingSubscriptionPurchase {
    let transaction: Transaction
    let signedTransactionInfo: String

    var syncRequest: BillingSyncRequest {
        BillingSyncRequest(
            originalTransactionId: String(transaction.originalID),
            transactionId: String(transaction.id),
            productId: transaction.productID,
            signedTransactionInfo: signedTransactionInfo
        )
    }

    func finish() async {
        await transaction.finish()
    }
}

private struct BillingSyncSnapshot: Equatable {
    let productId: String?
    let transactionId: String?
    let originalTransactionId: String?
    let signedTransactionInfo: String?

    var verifiedRequest: BillingSyncRequest? {
        guard let productId = normalized(productId),
              let transactionId = normalized(transactionId),
              let originalTransactionId = normalized(originalTransactionId),
              let signedTransactionInfo = normalized(signedTransactionInfo) else {
            return nil
        }

        return BillingSyncRequest(
            originalTransactionId: originalTransactionId,
            transactionId: transactionId,
            productId: productId,
            signedTransactionInfo: signedTransactionInfo
        )
    }

    static func == (lhs: BillingSyncSnapshot, rhs: BillingSyncSnapshot) -> Bool {
        lhs.productId == rhs.productId
            && lhs.transactionId == rhs.transactionId
            && lhs.originalTransactionId == rhs.originalTransactionId
    }

    private func normalized(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }
}

enum SubscriptionStoreError: LocalizedError {
    case productNotFound
    case productLoadTimedOut
    case purchaseUnverified
    case purchasePending
    case purchaseUnknown

    var errorDescription: String? {
        switch self {
        case .productNotFound, .productLoadTimedOut:
            "クレジット商品を読み込めませんでした。少し時間をおいて再試行してください。"
        case .purchaseUnverified:
            "購入を確認できませんでした。購入を復元してください。"
        case .purchasePending:
            "購入は保留中です。App Store側の処理が完了すると反映されます。"
        case .purchaseUnknown:
            "購入を完了できませんでした。少し時間をおいて再試行してください。"
        }
    }
}
