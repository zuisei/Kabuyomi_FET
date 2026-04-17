import Foundation

enum BetaBilling {
    static let isEnabled = false
    static let statusLabel = "beta preview"
    static let disabledMessage = "課金導線は beta 中は無効です。StoreKit と entitlement 同期コードは将来の再開用に隔離して保持しています。"
}
