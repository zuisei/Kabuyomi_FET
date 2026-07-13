import CryptoKit
import DeviceCheck
import Foundation
import Security

enum InstallationAttestationStatus: String, Codable, Equatable {
    case pending
    case verified
    case unavailable
}

enum InstallationCreditMode: String, Codable, Equatable {
    case full
    case reduced
    case none
}

struct InstallationCredential: Codable, Equatable {
    let token: String
    let principal: String
    let tokenReference: String
    let tokenVersion: Int
    let issuedAt: String
    let expiresAt: String?
    let attestationStatus: InstallationAttestationStatus
    let creditMode: InstallationCreditMode

    init(
        token: String,
        principal: String,
        tokenReference: String,
        tokenVersion: Int,
        issuedAt: String,
        expiresAt: String? = nil,
        attestationStatus: InstallationAttestationStatus,
        creditMode: InstallationCreditMode
    ) {
        self.token = token
        self.principal = principal
        self.tokenReference = tokenReference
        self.tokenVersion = tokenVersion
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
        self.attestationStatus = attestationStatus
        self.creditMode = creditMode
    }

    func shouldRebootstrap(
        now: Date = Date(),
        rotationLeadTime: TimeInterval = 14 * 24 * 60 * 60
    ) -> Bool {
        guard let expiresAt else { return false }
        guard let expiry = Self.parseISO8601(expiresAt) else { return true }
        return expiry <= now.addingTimeInterval(rotationLeadTime)
    }

    private static func parseISO8601(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct AccountCredential: Codable, Equatable, Sendable {
    let token: String
    let accountPrincipal: String
    let appAccountToken: String
    let issuedAt: String
    let expiresAt: String

    var appAccountTokenUUID: UUID? {
        UUID(uuidString: appAccountToken)
    }

    var isExpired: Bool {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = fractionalFormatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
        guard let date else { return true }
        return date <= Date()
    }
}

@MainActor
protocol AccountCredentialStoring: AnyObject {
    func load() throws -> AccountCredential?
    func save(_ credential: AccountCredential) throws
    func clear() throws
}

@MainActor
final class AccountCredentialStore: AccountCredentialStoring {
    static let shared = AccountCredentialStore()

    private let service: String
    private let account: String

    init(service: String = "app.kabuyomi.identity", account: String = "appleAccountCredential.v1") {
        self.service = service
        self.account = account
    }

    func load() throws -> AccountCredential? {
        var query = queryAttributes
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw InstallationIdentityError.keychainFailure(status)
        }
        guard let credential = try? JSONDecoder().decode(AccountCredential.self, from: data) else {
            throw InstallationIdentityError.invalidStoredCredential
        }
        return credential
    }

    func save(_ credential: AccountCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let status = SecItemUpdate(queryAttributes as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw InstallationIdentityError.keychainFailure(status) }
        var attributes = queryAttributes
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw InstallationIdentityError.keychainFailure(addStatus) }
    }

    func clear() throws {
        let status = SecItemDelete(queryAttributes as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw InstallationIdentityError.keychainFailure(status)
        }
    }

    private var queryAttributes: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

struct InstallationIdentityState: Codable, Equatable {
    var credential: InstallationCredential?
    var appAttestKeyId: String?
    var bootstrapOperationId: String?
    var consumedChallengeIds: [String]
    var consumedNonceDigests: [String]

    init(
        credential: InstallationCredential?,
        appAttestKeyId: String?,
        bootstrapOperationId: String?,
        consumedChallengeIds: [String],
        consumedNonceDigests: [String]
    ) {
        self.credential = credential
        self.appAttestKeyId = appAttestKeyId
        self.bootstrapOperationId = bootstrapOperationId
        self.consumedChallengeIds = consumedChallengeIds
        self.consumedNonceDigests = consumedNonceDigests
    }

    static let empty = InstallationIdentityState(
        credential: nil,
        appAttestKeyId: nil,
        bootstrapOperationId: nil,
        consumedChallengeIds: [],
        consumedNonceDigests: []
    )

    private enum CodingKeys: String, CodingKey {
        case credential
        case appAttestKeyId
        case bootstrapOperationId
        case consumedChallengeIds
        case consumedNonceDigests
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        credential = try container.decodeIfPresent(InstallationCredential.self, forKey: .credential)
        appAttestKeyId = try container.decodeIfPresent(String.self, forKey: .appAttestKeyId)
        bootstrapOperationId = try container.decodeIfPresent(String.self, forKey: .bootstrapOperationId)
        consumedChallengeIds = try container.decodeIfPresent([String].self, forKey: .consumedChallengeIds) ?? []
        consumedNonceDigests = try container.decodeIfPresent([String].self, forKey: .consumedNonceDigests) ?? []
    }
}

enum AppAttestFallbackPolicy {
    static let allowsUnverifiedCreditBypass = false
    static let unavailableCreditMode = InstallationCreditMode.none
}

enum InstallationIdentityError: LocalizedError, Equatable {
    case keychainFailure(Int32)
    case invalidStoredCredential
    case identityUnavailable
    case appAttestUnavailable
    case appAttestTemporarilyUnavailable
    case appAttestKeyInvalid
    case attestationNotVerified
    case replayedChallenge
    case expiredChallenge

    var errorDescription: String? {
        switch self {
        case .keychainFailure:
            "端末の安全な認証情報を読み書きできませんでした。"
        case .invalidStoredCredential:
            "端末の認証情報を確認できませんでした。"
        case .identityUnavailable:
            "端末の匿名認証を完了できませんでした。通信環境を確認して再度お試しください。"
        case .appAttestUnavailable:
            "この端末では安全なアプリ認証を利用できないため、クレジット機能は利用できません。"
        case .appAttestTemporarilyUnavailable:
            "Apple の安全なアプリ認証を一時的に完了できませんでした。"
        case .appAttestKeyInvalid:
            "端末のアプリ認証キーを更新できませんでした。"
        case .attestationNotVerified:
            "アプリの正当性を確認できなかったため、この操作は実行できません。"
        case .replayedChallenge:
            "認証チャレンジが再利用されたため、操作を中止しました。"
        case .expiredChallenge:
            "認証チャレンジの有効期限が切れました。"
        }
    }
}

@MainActor
protocol InstallationIdentityStateStoring: AnyObject {
    func loadState() throws -> InstallationIdentityState
    func saveState(_ state: InstallationIdentityState) throws
    func clear() throws
}

@MainActor
final class InstallationTokenStore: InstallationIdentityStateStoring {
    static let shared = InstallationTokenStore()
    #if DEBUG
    // Test Worker credentials must never overwrite or reuse production credentials.
    static let testWorker = InstallationTokenStore(account: "installationCredential.v1.test-worker")
    #endif

    private let service: String
    private let account: String

    init(
        service: String = "app.kabuyomi.identity",
        account: String = "installationCredential.v1"
    ) {
        self.service = service
        self.account = account
    }

    func loadState() throws -> InstallationIdentityState {
        var query = queryAttributes
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return .empty
        }
        guard status == errSecSuccess, let data = item as? Data else {
            throw InstallationIdentityError.keychainFailure(status)
        }

        do {
            return try JSONDecoder().decode(InstallationIdentityState.self, from: data)
        } catch {
            throw InstallationIdentityError.invalidStoredCredential
        }
    }

    func saveState(_ state: InstallationIdentityState) throws {
        let data = try JSONEncoder().encode(state)
        let updateStatus = SecItemUpdate(
            queryAttributes as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw InstallationIdentityError.keychainFailure(updateStatus)
        }

        var attributes = queryAttributes
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw InstallationIdentityError.keychainFailure(addStatus)
        }
    }

    func clear() throws {
        let status = SecItemDelete(queryAttributes as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw InstallationIdentityError.keychainFailure(status)
        }
    }

    private var queryAttributes: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

@MainActor
protocol AppAttestClient: AnyObject {
    var isSupported: Bool { get }
    func generateKey() async throws -> String
    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data
    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data
}

@MainActor
final class SystemAppAttestClient: AppAttestClient {
    static let shared = SystemAppAttestClient()

    private let service: DCAppAttestService

    init(service: DCAppAttestService = .shared) {
        self.service = service
    }

    var isSupported: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        service.isSupported
        #endif
    }

    func generateKey() async throws -> String {
        try await service.generateKey()
    }

    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data {
        try await service.attestKey(keyId, clientDataHash: clientDataHash)
    }

    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
        try await service.generateAssertion(keyId, clientDataHash: clientDataHash)
    }
}

enum InstallationRequestBinding {
    private struct AssertionPayload: Encodable {
        let bodySHA256: String
        let installationPrincipal: String
        let method: String
        let nonce: String
        let path: String
        let tokenReference: String
        let version: String
    }

    private struct AttestationPayload: Encodable {
        let installationPrincipal: String
        let keyId: String
        let nonce: String
        let purpose: String
        let tokenReference: String
        let version: String
    }

    static func bodySHA256(_ body: Data?) -> String {
        sha256Hex(body ?? Data())
    }

    static func assertionClientDataHash(
        nonce: String,
        method: String,
        path: String,
        bodySHA256: String,
        installationPrincipal: String,
        tokenReference: String
    ) throws -> Data {
        try clientDataHash(
            for: AssertionPayload(
                bodySHA256: bodySHA256,
                installationPrincipal: installationPrincipal,
                method: method.uppercased(),
                nonce: nonce,
                path: path,
                tokenReference: tokenReference,
                version: "kabuyomi-app-attest-request-v1"
            )
        )
    }

    static func attestationClientDataHash(
        nonce: String,
        keyId: String,
        installationPrincipal: String,
        tokenReference: String
    ) throws -> Data {
        try clientDataHash(
            for: AttestationPayload(
                installationPrincipal: installationPrincipal,
                keyId: keyId,
                nonce: nonce,
                purpose: "attestation",
                tokenReference: tokenReference,
                version: "kabuyomi-app-attest-key-v1"
            )
        )
    }

    static func nonceDigest(_ nonce: String) -> String {
        sha256Hex(Data(nonce.utf8))
    }

    private static func clientDataHash(for payload: some Encodable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return Data(SHA256.hash(data: try encoder.encode(payload)))
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

@MainActor
final class DeviceIdentityStore {
    static let shared = DeviceIdentityStore()
    private var cachedDeviceKey: String?

    private let service: String
    private let account: String

    init(
        service: String = "app.kabuyomi.identity",
        account: String = "deviceKey"
    ) {
        self.service = service
        self.account = account
    }

    // This UUID is retained only as migration input for /v1/identity/bootstrap.
    // Ongoing quota requests use the server-issued installation credential instead.
    func legacyDeviceKeyForMigration() -> String {
        if let cached = cachedDeviceKey {
            return cached
        }

        if let existing = readValue() {
            cachedDeviceKey = existing
            return existing
        }

        let newValue = UUID().uuidString.lowercased()
        cachedDeviceKey = newValue
        saveValue(newValue)
        return newValue
    }

    // Read-only lookup for migrations that must not manufacture legacy identity
    // evidence when this installation never had a legacy device key.
    func existingLegacyDeviceKeyForMigration() -> String? {
        if let cached = cachedDeviceKey {
            return cached
        }
        guard let existing = readValue() else { return nil }
        cachedDeviceKey = existing
        return existing
    }

    // Source-compatible alias for diagnostics and the one-release migration window.
    func deviceKey() -> String {
        legacyDeviceKeyForMigration()
    }

    func reset() {
        cachedDeviceKey = nil
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
