import Foundation
import Security

@MainActor
final class DeviceIdentityStore {
    static let shared = DeviceIdentityStore()
    private static var cachedDeviceKey: String?

    private let service = "app.kabuyomi.identity"
    private let account = "deviceKey"

    func deviceKey() -> String {
        if let cached = Self.cachedDeviceKey {
            return cached
        }

        if let existing = readValue() {
            Self.cachedDeviceKey = existing
            return existing
        }

        let newValue = UUID().uuidString.lowercased()
        Self.cachedDeviceKey = newValue
        saveValue(newValue)
        return newValue
    }

    func reset() {
        Self.cachedDeviceKey = nil
        SecItemDelete(queryAttributes as CFDictionary)
    }

    private func readValue() -> String? {
        var query = queryAttributes
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

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
        var attributes = queryAttributes
        attributes[kSecValueData as String] = data

        SecItemDelete(attributes as CFDictionary)
        SecItemAdd(attributes as CFDictionary, nil)
    }

    private var queryAttributes: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
