import Foundation

struct QuotaRequestContext {
    let legacyDeviceKey: String?
    let installationCredential: InstallationCredential?
    let appAttestKeyId: String?
    let originalTransactionId: String?
    let detachedAccessMode: DetachedAccessMode?

    init(
        deviceKey: String? = nil,
        installationCredential: InstallationCredential? = nil,
        appAttestKeyId: String? = nil,
        originalTransactionId: String? = nil,
        detachedAccessMode: DetachedAccessMode? = nil
    ) {
        self.legacyDeviceKey = deviceKey
        self.installationCredential = installationCredential
        self.appAttestKeyId = appAttestKeyId
        self.originalTransactionId = originalTransactionId
        self.detachedAccessMode = detachedAccessMode
    }
}

struct BillingAPIHealthReport: Equatable {
    let checkedAt: Date
    let entries: [BillingAPIHealthEntry]

    var hasRouteMissing: Bool {
        entries.contains { $0.statusCode == 404 }
    }
}

struct BillingAPIHealthEntry: Identifiable, Equatable {
    let id: String
    let label: String
    let method: String
    let path: String
    let statusCode: Int?
    let message: String

    var statusSummary: String {
        guard let statusCode else { return message }
        return "HTTP \(statusCode): \(message)"
    }
}

enum APIEnvironment: String {
    case production
    #if DEBUG
    case test
    #endif

    var displayName: String {
        switch self {
        case .production:
            return "Production API"
        #if DEBUG
        case .test:
            return "Test API"
        #endif
        }
    }
}

enum APIBaseURLResolver {
    static let productionURL = URL(string: "https://kabuyomi-api.dznqjmctk7.workers.dev")!
    #if DEBUG
    static let testURL = URL(string: "https://kabuyomi-api-test.dznqjmctk7.workers.dev")!

    static let debugEnvironmentDefaultsKey = "kabuyomi.apiEnvironment"

    static var selectedDebugEnvironment: APIEnvironment {
        guard let rawValue = UserDefaults.standard.string(forKey: debugEnvironmentDefaultsKey),
              let environment = APIEnvironment(rawValue: rawValue) else {
            return .production
        }
        return environment
    }

    static func setSelectedDebugEnvironment(_ environment: APIEnvironment) {
        UserDefaults.standard.set(environment.rawValue, forKey: debugEnvironmentDefaultsKey)
    }
    #endif

    static func resolve(baseURL: URL?) -> URL {
        if let baseURL {
            return baseURL
        }

        #if DEBUG
        if let configuredURL = configuredBaseURL() {
            return configuredURL
        }
        return url(for: selectedDebugEnvironment)
        #else
        return productionURL
        #endif
    }

    static func url(for environment: APIEnvironment) -> URL {
        #if DEBUG
        switch environment {
        case .production:
            return productionURL
        case .test:
            return testURL
        }
        #else
        productionURL
        #endif
    }

    private static func parsedURL(from rawValue: String) -> URL? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return nil
        }
        return url
    }

    #if DEBUG
    private static func configuredBaseURL() -> URL? {
        if let override = ProcessInfo.processInfo.environment["KABUYOMI_API_BASE_URL"],
           let url = parsedURL(from: override) {
            return url
        }

        if let plistValue = Bundle.main.object(forInfoDictionaryKey: "KABUYOMI_API_BASE_URL") as? String,
           let url = parsedURL(from: plistValue) {
            return url
        }

        return nil
    }
    #endif
}

@MainActor
struct APIClient {
    private enum Timeout {
        static let request: TimeInterval = 45
        static let resource: TimeInterval = 75
    }

    private enum RequestSecurity {
        case publicRoute
        case installationToken
        case appAttestAssertionWhenSupported
        case appAttestAssertion
    }

    private let session: URLSession
    private let baseURL: URL
    private let deviceIdentity: DeviceIdentityStore?
    private let requestContext: QuotaRequestContext?
    private let subscriptionStore: SubscriptionStore?
    private let detachedAccessStore: DetachedAccessStore?
    private let installationIdentityStore: (any InstallationIdentityStateStoring)?
    private let appAttestClient: (any AppAttestClient)?
    private let accountCredentialStore: (any AccountCredentialStoring)?
    #if DEBUG
    private var prevalidatedAssertionHeaders: [String: String]?
    #endif

    init(
        session: URLSession = APIClient.makeSession(),
        baseURL: URL? = nil,
        deviceIdentity: DeviceIdentityStore? = DeviceIdentityStore.shared,
        requestContext: QuotaRequestContext? = nil,
        subscriptionStore: SubscriptionStore? = SubscriptionStore.shared,
        detachedAccessStore: DetachedAccessStore? = DetachedAccessStore.shared,
        installationIdentityStore: (any InstallationIdentityStateStoring)? = InstallationTokenStore.shared,
        appAttestClient: (any AppAttestClient)? = SystemAppAttestClient.shared,
        accountCredentialStore: (any AccountCredentialStoring)? = AccountCredentialStore.shared
    ) {
        self.session = session
        self.baseURL = APIBaseURLResolver.resolve(baseURL: baseURL)
        self.deviceIdentity = deviceIdentity
        self.requestContext = requestContext
        self.subscriptionStore = subscriptionStore
        self.detachedAccessStore = detachedAccessStore
        self.installationIdentityStore = installationIdentityStore
        self.appAttestClient = appAttestClient
        self.accountCredentialStore = accountCredentialStore
        #if DEBUG
        self.prevalidatedAssertionHeaders = nil
        #endif
    }

    #if DEBUG
    init(
        session: URLSession = APIClient.makeSession(),
        baseURL: URL? = nil,
        deviceIdentity: DeviceIdentityStore? = DeviceIdentityStore.shared,
        requestContext: QuotaRequestContext? = nil,
        subscriptionStore: SubscriptionStore? = SubscriptionStore.shared,
        detachedAccessStore: DetachedAccessStore? = DetachedAccessStore.shared,
        installationIdentityStore: (any InstallationIdentityStateStoring)? = InstallationTokenStore.shared,
        appAttestClient: (any AppAttestClient)? = SystemAppAttestClient.shared,
        accountCredentialStore: (any AccountCredentialStoring)? = AccountCredentialStore.shared,
        prevalidatedAssertionHeaders: [String: String]
    ) {
        self.init(
            session: session,
            baseURL: baseURL,
            deviceIdentity: deviceIdentity,
            requestContext: requestContext,
            subscriptionStore: subscriptionStore,
            detachedAccessStore: detachedAccessStore,
            installationIdentityStore: installationIdentityStore,
            appAttestClient: appAttestClient,
            accountCredentialStore: accountCredentialStore
        )
        self.prevalidatedAssertionHeaders = prevalidatedAssertionHeaders
    }
    #endif

    var baseURLDisplayString: String {
        baseURL.absoluteString
    }

    var baseURLKindDisplayString: String {
        if baseURL == APIBaseURLResolver.productionURL {
            return "prod"
        }
        #if DEBUG
        if baseURL == APIBaseURLResolver.testURL {
            return "test"
        }
        #endif
        return "custom"
    }

    var adMobRewardIntentURLDisplayString: String {
        baseURL.appending(path: "/v1/admob/reward-intents").absoluteString
    }

    var subscriptionSyncEndpointDisplayString: String {
        endpointDisplayString(path: Self.subscriptionSyncPath)
    }

    var creditPurchaseEndpointDisplayString: String {
        endpointDisplayString(path: Self.creditPurchaseCompletePath)
    }

    var usageEndpointDisplayString: String {
        endpointDisplayString(path: Self.usagePath)
    }

    var installationPrincipalDisplayString: String? {
        try? currentCredential()?.principal
    }

    var hasInstallationCredential: Bool {
        do {
            return try currentCredential() != nil
        } catch {
            return false
        }
    }

    var authenticatedCreditActionsAvailable: Bool {
        do {
            guard let credential = try currentCredential() else { return false }
            return (credential.attestationStatus == .verified && credential.creditMode == .full)
                || credential.attestationStatus == .unavailable
        } catch {
            return false
        }
    }

    var fraudSensitiveCreditActionsAvailable: Bool {
        do {
            guard let credential = try currentCredential() else { return false }
            return credential.attestationStatus == .verified && credential.creditMode == .full
        } catch {
            return false
        }
    }

    var authenticatedActionUnavailableError: InstallationIdentityError {
        do {
            if try currentCredential()?.attestationStatus == .unavailable {
                return .appAttestUnavailable
            }
        } catch {
            // A corrupt or unavailable credential store is reported as identity unavailable
            // without manufacturing a client-side fallback identity.
        }
        return .identityUnavailable
    }

    func bootstrapInstallationIdentity() async throws -> InstallationCredential {
        if let credential = requestContext?.installationCredential {
            return credential
        }

        guard let installationIdentityStore else {
            throw InstallationIdentityError.identityUnavailable
        }

        var state = try installationIdentityStore.loadState()
        if let credential = state.credential {
            if credential.attestationStatus == .pending {
                do {
                    return try await completeAppAttestation(
                        credential: credential,
                        state: state,
                        store: installationIdentityStore
                    )
                } catch APIError.serverStatus(let statusCode, _) where statusCode == 401 {
                    // The completion response may have been lost after the Worker replaced
                    // the pending token. Preserve the operation/key binding and ask bootstrap
                    // for the current server-issued credential instead of minting an identity.
                    state.credential = nil
                    try installationIdentityStore.saveState(state)
                    return try await bootstrapInstallationIdentity()
                }
            }
            if credential.shouldRebootstrap() {
                // Rotate through the same server-bound bootstrap operation before
                // expiry. The App Attest key and legacy migration evidence remain.
                state.credential = nil
                try installationIdentityStore.saveState(state)
            } else if credential.attestationStatus == .unavailable,
                      appAttestClient?.isSupported == true {
                // A previous outage/unsupported state may become recoverable. Keep the
                // stable operation and key material, but let bootstrap negotiate an
                // upgrade with the Worker instead of treating `unavailable` as forever.
                state.credential = nil
                try installationIdentityStore.saveState(state)
            } else {
                return credential
            }
        }

        let appAttestCapability: AppAttestCapability
        if appAttestClient?.isSupported == true {
            appAttestCapability = .supported
            if state.appAttestKeyId == nil {
                guard let appAttestClient else {
                    throw InstallationIdentityError.identityUnavailable
                }
                do {
                    state.appAttestKeyId = try await appAttestClient.generateKey()
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    throw InstallationIdentityError.appAttestTemporarilyUnavailable
                }
                try installationIdentityStore.saveState(state)
            }
        } else {
            appAttestCapability = .unavailable
        }

        if state.bootstrapOperationId == nil {
            state.bootstrapOperationId = UUID().uuidString.lowercased()
            try installationIdentityStore.saveState(state)
        }

        guard let bootstrapOperationId = state.bootstrapOperationId,
              let deviceIdentity else {
            throw InstallationIdentityError.identityUnavailable
        }

        let response: InstallationBootstrapResponse = try await sendIdentityRequest(
            path: Self.identityBootstrapPath,
            method: "POST",
            body: InstallationBootstrapRequest(
                bootstrapOperationId: bootstrapOperationId,
                legacyDeviceKey: deviceIdentity.legacyDeviceKeyForMigration(),
                appAttestCapability: appAttestCapability,
                appAttestKeyId: state.appAttestKeyId
            )
        )

        state.credential = response.credential
        try installationIdentityStore.saveState(state)

        if response.attestationRequired {
            return try await completeAppAttestation(
                credential: response.credential,
                state: state,
                store: installationIdentityStore
            )
        }

        if appAttestCapability == .unavailable,
           response.credential.creditMode == .full {
            throw InstallationIdentityError.attestationNotVerified
        }
        return response.credential
    }

    @discardableResult
    func invalidateInstallationCredentialForRebootstrap() throws -> Bool {
        guard requestContext?.installationCredential == nil,
              let installationIdentityStore else {
            return false
        }
        var state = try installationIdentityStore.loadState()
        guard state.credential != nil else { return false }
        // Preserve bootstrapOperationId, App Attest key ID, and replay history. A
        // rejected/rotated token must never cause a new client-selected identity.
        state.credential = nil
        try installationIdentityStore.saveState(state)
        return true
    }

    func adMobRewardStatusURLDisplayString(rewardIntentId: String) -> String {
        var components = URLComponents(
            url: baseURL.appending(path: "/v1/admob/reward-status"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "id", value: rewardIntentId)]
        return (components?.url ?? baseURL.appending(path: "/v1/admob/reward-status")).absoluteString
    }

    func search(query: String) async throws -> [SearchItem] {
        var components = URLComponents(url: baseURL.appending(path: "/v1/search"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        let response: SearchResponse = try await sendRequest(
            url: components?.url ?? baseURL,
            security: .publicRoute
        )
        return response.items
    }

    func addToWatchlist(
        ticker: String
    ) async throws -> WatchlistAddResponse {
        var headers = requestMetadataHeaders()
        headers["x-kabuyomi-watchlist-mode"] = "async"

        return try await sendRequest(
            path: "/v1/watchlist/add",
            method: "POST",
            headers: headers,
            body: ["ticker": ticker],
            security: .appAttestAssertionWhenSupported
        )
    }

    func removeFromWatchlist(
        ticker: String
    ) async throws -> WatchlistRemoveResponse {
        try await sendRequest(
            path: "/v1/watchlist/remove",
            method: "POST",
            headers: requestMetadataHeaders(),
            body: ["ticker": ticker],
            security: .appAttestAssertionWhenSupported
        )
    }

    func fetchCompany(
        ticker: String
    ) async throws -> CompanyLoadResponse {
        try await sendRequest(
            path: "/v1/company/\(ticker)",
            headers: requestMetadataHeaders()
        )
    }

    func refreshCompany(
        ticker: String
    ) async throws -> CompanyLoadResponse {
        try await sendRequest(
            path: "/v1/company/\(ticker)/refresh",
            method: "POST",
            headers: requestMetadataHeaders(),
            security: .appAttestAssertionWhenSupported
        )
    }

    func sendChat(
        filingKey: String,
        question: String,
        conversationContext: [ChatContextMessage] = [],
        operationId: String
    ) async throws -> ChatResponse {
        try await sendReplayableRequest(
            path: "/v1/chat",
            method: "POST",
            headers: requestMetadataHeaders(),
            body: ChatRequest(
                filingKey: filingKey,
                question: question,
                conversationContext: conversationContext,
                operationId: operationId
            ),
            security: .appAttestAssertionWhenSupported
        )
    }

    func translateQuote(
        text: String,
        sourceLanguage: String? = nil,
        targetLanguage: String = "ja",
        operationId: String
    ) async throws -> QuoteTranslationResponse {
        let normalizedSourceLanguage = sourceLanguage?.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = QuoteTranslationRequest(
            text: text,
            sourceLanguage: normalizedSourceLanguage?.isEmpty == false ? normalizedSourceLanguage : nil,
            targetLanguage: targetLanguage,
            operationId: operationId
        )

        return try await sendReplayableRequest(
            path: "/v1/translate-quote",
            method: "POST",
            headers: requestMetadataHeaders(),
            body: body,
            security: .appAttestAssertionWhenSupported
        )
    }

    func fetchUsage() async throws -> UsagePayload {
        try await sendRequest(
            path: Self.usagePath,
            headers: requestMetadataHeaders()
        )
    }

    func syncBilling(_ request: BillingSyncRequest) async throws -> BillingSyncResponse {
        try await sendRequest(
            path: Self.subscriptionSyncPath,
            method: "POST",
            headers: requestMetadataHeaders(),
            body: request,
            security: .appAttestAssertionWhenSupported
        )
    }

    func grantCreditPurchase(_ request: CreditPurchaseGrantRequest) async throws -> CreditPurchaseGrantResponse {
        try await sendRequest(
            path: Self.creditPurchaseCompletePath,
            method: "POST",
            headers: requestMetadataHeaders(),
            body: request,
            security: .appAttestAssertionWhenSupported
        )
    }

    func createAppleAccountSession(identityToken: String) async throws -> AccountCredential {
        let response: AppleAccountSessionResponse = try await sendRequest(
            path: "/v1/account/apple/session",
            method: "POST",
            headers: requestMetadataHeaders(),
            body: AppleAccountSessionRequest(identityToken: identityToken),
            security: .appAttestAssertion
        )
        try accountCredentialStore?.save(response.credential)
        return response.credential
    }

    func migratePaidCreditsToAccount(mode: String, migrationId: String) async throws -> PaidCreditAccountMigrationResponse {
        return try await sendRequest(
            path: "/v1/account/paid-credit-migration",
            method: "POST",
            headers: requestMetadataHeaders(),
            body: PaidCreditAccountMigrationRequest(mode: mode, migrationId: migrationId),
            security: .appAttestAssertion
        )
    }

    func checkBillingAPIHealth() async -> BillingAPIHealthReport {
        let entries = await [
            probeEndpoint(label: "Usage", method: "GET", path: Self.usagePath, body: Optional<EmptyRequestBody>.none),
            probeEndpoint(label: "Subscription sync", method: "POST", path: Self.subscriptionSyncPath, body: EmptyRequestBody()),
            probeEndpoint(label: "Credit purchase complete", method: "POST", path: Self.creditPurchaseCompletePath, body: EmptyRequestBody())
        ]

        return BillingAPIHealthReport(checkedAt: Date(), entries: entries)
    }

    func createAdMobRewardIntent() async throws -> AdMobRewardIntentResponse {
        try await sendRequest(
            path: "/v1/admob/reward-intents",
            method: "POST",
            headers: requestMetadataHeaders().merging([
                "x-kabuyomi-ad-unit-id": AdMobConfig.rewardedCreditAdUnitID,
                "x-kabuyomi-ad-environment": AdMobConfig.rewardedAdRuntimeMode.allowsProductionRewardIntent
                    ? "production"
                    : "unavailable"
            ]) { _, new in new },
            body: EmptyRequestBody(),
            security: .appAttestAssertion
        )
    }

    func fetchAdMobRewardStatus(rewardIntentId: String) async throws -> AdMobRewardStatusResponse {
        var components = URLComponents(
            url: baseURL.appending(path: "/v1/admob/reward-status"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "id", value: rewardIntentId)]
        return try await sendRequest(
            headers: requestMetadataHeaders(),
            url: components?.url ?? baseURL.appending(path: "/v1/admob/reward-status"),
            security: .appAttestAssertion
        )
    }

    private func requestMetadataHeaders() -> [String: String] {
        let originalTransactionId =
            requestContext?.originalTransactionId
            ?? subscriptionStore?.entitlementLookupOriginalTransactionId
        let detachedAccessMode = requestContext?.detachedAccessMode ?? detachedAccessStore?.requestDetachedAccessMode
        var headers: [String: String] = [:]

        if let originalTransactionId,
           !originalTransactionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            headers["x-kabuyomi-original-transaction-id"] = originalTransactionId
        }
        if let detachedAccessMode {
            headers["x-kabuyomi-detached-access"] = detachedAccessMode.rawValue
        }
        if let accountCredential = currentAccountCredential() {
            headers["x-kabuyomi-account-token"] = accountCredential.token
        }

        return headers
    }

    private func currentAccountCredential() -> AccountCredential? {
        guard let accountCredentialStore else { return nil }
        guard let credential = try? accountCredentialStore.load(), !credential.isExpired else { return nil }
        return credential
    }

    private func sendRequest<ResponseType: Decodable>(
        path: String? = nil,
        method: String = "GET",
        headers: [String: String] = [:],
        body: (some Encodable)? = Optional<String>.none,
        url: URL? = nil,
        security: RequestSecurity = .installationToken
    ) async throws -> ResponseType {
        let endpoint = url ?? baseURL.appending(path: path ?? "")
        let bodyData = try encodeBody(body)
        var authorizedHeaders = headers
        let identityHeaders = try await identityHeaders(
            for: security,
            method: method,
            url: endpoint,
            bodyData: bodyData
        )
        identityHeaders.forEach { authorizedHeaders[$0.key] = $0.value }
        let request = try buildRequest(
            url: endpoint,
            method: method,
            headers: authorizedHeaders,
            bodyData: bodyData
        )

        return try await decodeResponse(for: request)
    }

    private func sendReplayableRequest<ResponseType: Decodable, Body: Encodable>(
        path: String,
        method: String,
        headers: [String: String],
        body: Body,
        security: RequestSecurity
    ) async throws -> ResponseType {
        var pendingPollCount = 0

        while true {
            do {
                return try await sendRequest(
                    path: path,
                    method: method,
                    headers: headers,
                    body: body,
                    security: security
                )
            } catch APIError.executionPending(let retryAfterSeconds) {
                guard pendingPollCount < Self.maximumExecutionPendingPolls else {
                    throw APIError.executionPending(retryAfterSeconds: retryAfterSeconds)
                }

                pendingPollCount += 1
                try Task.checkCancellation()
                let boundedDelay = min(max(retryAfterSeconds, 0), Self.maximumExecutionPendingRetryDelaySeconds)
                if boundedDelay > 0 {
                    try await Task.sleep(nanoseconds: UInt64(boundedDelay) * 1_000_000_000)
                }
            }
        }
    }

    private func identityHeaders(
        for security: RequestSecurity,
        method: String,
        url: URL,
        bodyData: Data?
    ) async throws -> [String: String] {
        guard security != .publicRoute else {
            return [:]
        }
        guard let credential = try currentCredential() else {
            throw InstallationIdentityError.identityUnavailable
        }

        var headers = authorizationHeaders(for: credential)
        guard security == .appAttestAssertion || security == .appAttestAssertionWhenSupported else {
            return headers
        }
        if credential.attestationStatus == .unavailable,
           security == .appAttestAssertionWhenSupported {
            return headers
        }
        guard credential.attestationStatus == .verified else {
            if credential.attestationStatus == .unavailable {
                throw InstallationIdentityError.appAttestUnavailable
            }
            throw InstallationIdentityError.attestationNotVerified
        }
        #if DEBUG
        if let prevalidatedAssertionHeaders {
            prevalidatedAssertionHeaders.forEach { headers[$0.key] = $0.value }
            return headers
        }
        #endif
        guard let appAttestClient,
              appAttestClient.isSupported,
              let keyId = try currentAppAttestKeyId() else {
            throw InstallationIdentityError.appAttestUnavailable
        }

        let bodySHA256 = InstallationRequestBinding.bodySHA256(bodyData)
        let path = requestTarget(for: url)
        let challenge = try await fetchAppAttestChallenge(
            purpose: .assertion,
            keyId: keyId,
            method: method.uppercased(),
            path: path,
            bodySHA256: bodySHA256,
            credential: credential
        )
        try consumeChallenge(challenge)

        let clientDataHash = try InstallationRequestBinding.assertionClientDataHash(
            nonce: challenge.nonce,
            method: method,
            path: path,
            bodySHA256: bodySHA256,
            installationPrincipal: credential.principal,
            tokenReference: credential.tokenReference
        )
        let assertion: Data
        do {
            assertion = try await appAttestClient.generateAssertion(
                keyId,
                clientDataHash: clientDataHash
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw InstallationIdentityError.appAttestTemporarilyUnavailable
        }

        headers["x-kabuyomi-app-attest-key-id"] = keyId
        headers["x-kabuyomi-app-attest-challenge-id"] = challenge.challengeId
        headers["x-kabuyomi-app-attest-assertion"] = assertion.base64EncodedString()
        headers["x-kabuyomi-app-attest-client-data-hash"] = clientDataHash.base64EncodedString()
        headers["x-kabuyomi-request-body-sha256"] = bodySHA256
        return headers
    }

    private func completeAppAttestation(
        credential: InstallationCredential,
        state: InstallationIdentityState,
        store: any InstallationIdentityStateStoring
    ) async throws -> InstallationCredential {
        guard let appAttestClient,
              appAttestClient.isSupported,
              let keyId = state.appAttestKeyId else {
            throw InstallationIdentityError.appAttestUnavailable
        }

        let challenge = try await fetchAppAttestChallenge(
            purpose: .attestation,
            keyId: keyId,
            method: nil,
            path: nil,
            bodySHA256: nil,
            credential: credential
        )
        try consumeChallenge(challenge)

        let clientDataHash = try InstallationRequestBinding.attestationClientDataHash(
            nonce: challenge.nonce,
            keyId: keyId,
            installationPrincipal: credential.principal,
            tokenReference: credential.tokenReference
        )
        let attestationObject: Data
        do {
            attestationObject = try await appAttestClient.attestKey(
                keyId,
                clientDataHash: clientDataHash
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw InstallationIdentityError.appAttestTemporarilyUnavailable
        }
        let response: AppAttestCompleteResponse = try await sendIdentityRequest(
            path: Self.identityAttestCompletePath,
            method: "POST",
            headers: authorizationHeaders(for: credential),
            body: AppAttestCompleteRequest(
                challengeId: challenge.challengeId,
                keyId: keyId,
                clientDataHash: clientDataHash.base64EncodedString(),
                attestationObject: attestationObject.base64EncodedString()
            )
        )
        guard response.credential.attestationStatus == .verified else {
            throw InstallationIdentityError.attestationNotVerified
        }

        var updatedState = try store.loadState()
        updatedState.credential = response.credential
        updatedState.appAttestKeyId = keyId
        try store.saveState(updatedState)
        return response.credential
    }

    private func fetchAppAttestChallenge(
        purpose: AppAttestChallengePurpose,
        keyId: String,
        method: String?,
        path: String?,
        bodySHA256: String?,
        credential: InstallationCredential
    ) async throws -> AppAttestChallengeResponse {
        try await sendIdentityRequest(
            path: Self.identityAttestChallengePath,
            method: "POST",
            headers: authorizationHeaders(for: credential),
            body: AppAttestChallengeRequest(
                purpose: purpose,
                keyId: keyId,
                method: method,
                path: path,
                bodySHA256: bodySHA256,
                installationPrincipal: credential.principal,
                tokenReference: credential.tokenReference
            )
        )
    }

    private func consumeChallenge(_ challenge: AppAttestChallengeResponse) throws {
        if let expiresAt = challenge.expiresAt,
           let expiry = Self.parseISO8601Date(expiresAt),
           expiry <= Date() {
            throw InstallationIdentityError.expiredChallenge
        }
        guard let installationIdentityStore else {
            throw InstallationIdentityError.identityUnavailable
        }

        var state = try installationIdentityStore.loadState()
        let nonceDigest = InstallationRequestBinding.nonceDigest(challenge.nonce)
        guard !state.consumedChallengeIds.contains(challenge.challengeId),
              !state.consumedNonceDigests.contains(nonceDigest) else {
            throw InstallationIdentityError.replayedChallenge
        }

        state.consumedChallengeIds.append(challenge.challengeId)
        state.consumedNonceDigests.append(nonceDigest)
        state.consumedChallengeIds = Array(state.consumedChallengeIds.suffix(Self.maximumRememberedChallenges))
        state.consumedNonceDigests = Array(state.consumedNonceDigests.suffix(Self.maximumRememberedChallenges))
        try installationIdentityStore.saveState(state)
    }

    private func currentCredential() throws -> InstallationCredential? {
        if let credential = requestContext?.installationCredential {
            return credential
        }
        return try installationIdentityStore?.loadState().credential
    }

    private func currentAppAttestKeyId() throws -> String? {
        if let keyId = requestContext?.appAttestKeyId {
            return keyId
        }
        return try installationIdentityStore?.loadState().appAttestKeyId
    }

    private func authorizationHeaders(for credential: InstallationCredential) -> [String: String] {
        var headers = [
            "Authorization": "Installation \(credential.token)",
            "x-kabuyomi-installation-principal": credential.principal,
            "x-kabuyomi-installation-token-reference": credential.tokenReference
        ]
        if let legacyDeviceKey = requestContext?.legacyDeviceKey,
           !legacyDeviceKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            headers["x-device-key"] = legacyDeviceKey
        }
        return headers
    }

    private func sendIdentityRequest<ResponseType: Decodable>(
        path: String,
        method: String,
        headers: [String: String] = [:],
        body: some Encodable
    ) async throws -> ResponseType {
        let request = try buildRequest(
            url: baseURL.appending(path: path),
            method: method,
            headers: headers,
            bodyData: try encodeBody(body)
        )
        return try await decodeResponse(for: request)
    }

    private func requestTarget(for url: URL) -> String {
        var target = url.path(percentEncoded: true)
        if let query = url.query(percentEncoded: true), !query.isEmpty {
            target += "?\(query)"
        }
        return target
    }

    private func probeEndpoint(
        label: String,
        method: String,
        path: String,
        body: (some Encodable)?
    ) async -> BillingAPIHealthEntry {
        do {
            let bodyData = try encodeBody(body)
            var headers = requestMetadataHeaders()
            let identityHeaders = try await identityHeaders(
                for: .installationToken,
                method: method,
                url: baseURL.appending(path: path),
                bodyData: bodyData
            )
            identityHeaders.forEach { headers[$0.key] = $0.value }
            let request = try buildRequest(
                url: baseURL.appending(path: path),
                method: method,
                headers: headers,
                bodyData: bodyData
            )
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                return BillingAPIHealthEntry(
                    id: path,
                    label: label,
                    method: method,
                    path: path,
                    statusCode: nil,
                    message: "invalid_response"
                )
            }
            let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data)
            let message = payload?.error ?? (200..<300 ~= httpResponse.statusCode ? "ok" : "HTTP \(httpResponse.statusCode)")
            return BillingAPIHealthEntry(
                id: path,
                label: label,
                method: method,
                path: path,
                statusCode: httpResponse.statusCode,
                message: message
            )
        } catch {
            return BillingAPIHealthEntry(
                id: path,
                label: label,
                method: method,
                path: path,
                statusCode: nil,
                message: error.localizedDescription
            )
        }
    }

    private func buildRequest(
        url: URL,
        method: String,
        headers: [String: String],
        bodyData: Data?
    ) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = Timeout.request
        request.cachePolicy = .reloadIgnoringLocalCacheData
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        if let bodyData {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
        }

        return request
    }

    private func encodeBody(_ body: (some Encodable)?) throws -> Data? {
        guard let body else { return nil }
        return try JSONEncoder().encode(AnyEncodable(body))
    }

    private func decodeResponse<ResponseType: Decodable>(for request: URLRequest) async throws -> ResponseType {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data)
        let errorCode = payload?.error ?? payload?.status

        if httpResponse.statusCode == 202, errorCode == "execution_pending" {
            let headerRetryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init)
            throw APIError.executionPending(
                retryAfterSeconds: headerRetryAfter ?? payload?.retryAfterSeconds ?? 1
            )
        }

        if errorCode == "operation_result_expired" {
            throw APIError.operationResultExpired
        }

        if errorCode == "operation_id_payload_mismatch" {
            throw APIError.operationIdPayloadMismatch
        }

        guard 200..<300 ~= httpResponse.statusCode else {
            if httpResponse.statusCode == 402, errorCode == "insufficient_credits" {
                throw APIError.insufficientCredits(
                    required: payload?.creditsRequired ?? 1,
                    remaining: payload?.creditsRemaining ?? 0
                )
            }
            if httpResponse.statusCode == 404 {
                throw APIError.routeMissing(
                    statusCode: httpResponse.statusCode,
                    path: request.url?.path ?? "unknown",
                    url: request.url?.absoluteString ?? "unknown",
                    message: errorCode ?? "Not found"
                )
            }
            throw APIError.serverStatus(
                statusCode: httpResponse.statusCode,
                message: errorCode ?? "HTTP \(httpResponse.statusCode)"
            )
        }

        return try JSONDecoder().decode(ResponseType.self, from: data)
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Timeout.request
        configuration.timeoutIntervalForResource = Timeout.resource
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }

    private func endpointDisplayString(path: String) -> String {
        baseURL.appending(path: path).absoluteString
    }

    private static func parseISO8601Date(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }
        return ISO8601DateFormatter().date(from: value)
    }

    private static let usagePath = "/v1/usage"
    private static let subscriptionSyncPath = "/v1/ios/subscriptions/sync"
    private static let creditPurchaseCompletePath = "/v1/ios/purchases/credits/complete"
    private static let identityBootstrapPath = "/v1/identity/bootstrap"
    private static let identityAttestChallengePath = "/v1/identity/app-attest/challenge"
    private static let identityAttestCompletePath = "/v1/identity/app-attest/complete"
    private static let maximumExecutionPendingPolls = 4
    private static let maximumExecutionPendingRetryDelaySeconds = 5
    private static let maximumRememberedChallenges = 32
}

private struct APIErrorPayload: Decodable {
    let error: String?
    let status: String?
    let creditsRequired: Int?
    let creditsRemaining: Int?
    let retryAfterSeconds: Int?
}

private struct EmptyRequestBody: Encodable {}

enum APIError: LocalizedError, Equatable {
    case invalidResponse
    case server(String)
    case serverStatus(statusCode: Int, message: String)
    case routeMissing(statusCode: Int, path: String, url: String, message: String)
    case insufficientCredits(required: Int, remaining: Int)
    case executionPending(retryAfterSeconds: Int)
    case operationResultExpired
    case operationIdPayloadMismatch

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "レスポンスを解釈できませんでした。"
        case .server(let message):
            message
        case .serverStatus(let statusCode, let message):
            "HTTP \(statusCode): \(message)"
        case .routeMissing(let statusCode, let path, _, let message):
            "HTTP \(statusCode): \(path): \(message)"
        case .insufficientCredits(let required, let remaining):
            "creditが不足しています。必要: \(required)、残り: \(remaining)"
        case .executionPending:
            "処理を続行しています。少し待ってから再試行してください。"
        case .operationResultExpired:
            "処理結果の再取得期限が切れています。"
        case .operationIdPayloadMismatch:
            "同じ操作IDに異なる内容が指定されました。"
        }
    }
}

private struct AnyEncodable: Encodable {
    private let encoder: (Encoder) throws -> Void

    init(_ wrapped: some Encodable) {
        encoder = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try self.encoder(encoder)
    }
}
