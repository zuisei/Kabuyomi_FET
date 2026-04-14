import Foundation
import Security

@MainActor
final class DeviceIdentityStore {
    static let shared = DeviceIdentityStore()

    private let service = "app.kabuyomi.identity"
    private let account = "deviceKey"

    func deviceKey() -> String {
        if let existing = readValue() {
            return existing
        }

        let newValue = UUID().uuidString.lowercased()
        saveValue(newValue)
        return newValue
    }

    private func readValue() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }

        return value
    }

    private func saveValue(_ value: String) {
        let data = Data(value.utf8)
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data
        ]

        SecItemDelete(attributes as CFDictionary)
        SecItemAdd(attributes as CFDictionary, nil)
    }
}
