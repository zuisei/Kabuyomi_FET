import Foundation

struct BillingTier: Equatable, Hashable {
    let plan: String
    let title: String
    let stockLimit: Int
    let chatLimit: Int
    let monthlyCredits: Int
    let productID: String?

    var badgeTitle: String {
        title.uppercased()
    }

    var summary: String {
        "\(monthlyCredits) credits"
    }
}

enum DetachedAccessMode: String {
    case devUnlimited = "dev_unlimited"

    var displayLabel: String {
        switch self {
        case .devUnlimited:
            "DEV"
        }
    }
}

enum BillingCatalog {
    static let free = BillingTier(
        plan: "free",
        title: "無料",
        stockLimit: 3,
        chatLimit: 25,
        monthlyCredits: 50,
        productID: nil
    )
    static let lite = BillingTier(
        plan: "lite",
        title: "Lite",
        stockLimit: 3,
        chatLimit: 10,
        monthlyCredits: 150,
        productID: "app.kabuyomi.lite.monthly"
    )
    static let pro = BillingTier(
        plan: "pro",
        title: "Pro",
        stockLimit: 20,
        chatLimit: 50,
        monthlyCredits: 500,
        productID: "app.kabuyomi.pro.monthly"
    )
    static let proMax = BillingTier(
        plan: "pro_max",
        title: "Pro Max",
        stockLimit: 20,
        chatLimit: 50,
        monthlyCredits: 1200,
        productID: "app.kabuyomi.pro_max.monthly"
    )
    // v1.1 recurring credit grant candidates. Keep isolated from v1 public UI.
    static let subscriptionTiers = [lite, pro, proMax]
    static let recognizedSubscriptionTiers = subscriptionTiers

    // Keep detachable offers outside the standard free/pro ladder.
    // If an unlimited SKU returns later, isolate it here instead of widening the
    // main quota and settings flow again.
    static let detachedOfferProductIDs: [String] = []

    static func tier(for plan: String) -> BillingTier {
        switch plan.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case lite.plan:
            lite
        case pro.plan:
            pro
        case proMax.plan:
            proMax
        default:
            free
        }
    }

    static func tier(forProductID productID: String) -> BillingTier? {
        recognizedSubscriptionTiers.first { $0.productID == productID }
    }

    static func displayLabel(for plan: String) -> String {
        switch plan.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case free.plan:
            free.badgeTitle
        case lite.plan:
            lite.badgeTitle
        case pro.plan:
            pro.badgeTitle
        case proMax.plan:
            proMax.badgeTitle
        default:
            plan.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        }
    }
}

@MainActor
final class DetachedAccessStore {
    static let shared = DetachedAccessStore()

    private let defaults = UserDefaults.standard
    private let devModeEnabledKey = "kabuyomi.detachedAccess.devModeEnabled"

    var isDevModeEnabled: Bool {
        #if DEBUG
        defaults.bool(forKey: devModeEnabledKey)
        #else
        false
        #endif
    }

    var requestDetachedAccessMode: DetachedAccessMode? {
        #if DEBUG
        isDevModeEnabled ? .devUnlimited : nil
        #else
        nil
        #endif
    }

    func setDevModeEnabled(_ value: Bool) {
        #if DEBUG
        defaults.set(value, forKey: devModeEnabledKey)
        #endif
    }
}
