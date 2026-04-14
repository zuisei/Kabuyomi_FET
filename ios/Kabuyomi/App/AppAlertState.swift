import Foundation

struct AppAlertState: Identifiable {
    enum Kind {
        case dismissOnly
        case aiConsent
    }

    let id = UUID()
    let message: String
    let kind: Kind
}
