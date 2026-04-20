import Foundation

struct BillingTier: Equatable {
    let plan: String
    let title: String
    let stockLimit: Int
    let chatLimit: Int

    var badgeTitle: String {
        title.uppercased()
    }

    var summary: String {
        "\(stockLimit)銘柄 / 1日\(chatLimit)会話"
    }
}

enum BillingCatalog {
    static let free = BillingTier(plan: "free", title: "Free", stockLimit: 3, chatLimit: 10)
    static let pro = BillingTier(plan: "pro", title: "Pro", stockLimit: 20, chatLimit: 50)

    // Keep detachable offers outside the standard free/pro ladder.
    // If an unlimited SKU returns later, isolate it here instead of widening the
    // main quota and settings flow again.
    static let detachedOfferProductIDs: [String] = []

    static func tier(for plan: String) -> BillingTier {
        switch plan.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case pro.plan:
            pro
        default:
            free
        }
    }

    static func displayLabel(for plan: String) -> String {
        switch plan.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case free.plan:
            free.badgeTitle
        case pro.plan:
            pro.badgeTitle
        default:
            plan.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        }
    }
}
