import XCTest
@testable import Kabuyomi

@MainActor
final class StartupAuthenticationTests: XCTestCase {
    private static func makeTestDeviceIdentityStore() -> DeviceIdentityStore {
        DeviceIdentityStore(
            service: "app.kabuyomi.identity.unit-tests",
            account: "deviceKey.startup-authentication-tests"
        )
    }

    override func setUp() async throws {
        try await super.setUp()
        StartupAuthenticationURLProtocol.requestHandler = nil
        Self.makeTestDeviceIdentityStore().reset()
        Self.clearKabuyomiDefaults()
    }

    override func tearDown() async throws {
        StartupAuthenticationURLProtocol.requestHandler = nil
        Self.makeTestDeviceIdentityStore().reset()
        Self.clearKabuyomiDefaults()
        try await super.tearDown()
    }

    func testProductionRetryPolicyIsBoundedExponentialBackoff() {
        XCTAssertEqual(
            InstallationIdentityRetryPolicy.production.automaticRetryDelaysNanoseconds,
            [1_000_000_000, 2_000_000_000, 4_000_000_000]
        )
    }

    func testInstallationCredentialRequestsRotationInsideFourteenDayWindow() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-11T00:00:00Z"))
        let insideWindow = Self.credential(
            expiresAt: "2026-07-20T00:00:00.000Z",
            attestationStatus: .verified,
            creditMode: .full
        )
        let outsideWindow = Self.credential(
            expiresAt: "2026-08-20T00:00:00.000Z",
            attestationStatus: .verified,
            creditMode: .full
        )

        XCTAssertTrue(insideWindow.shouldRebootstrap(now: now))
        XCTAssertFalse(outsideWindow.shouldRebootstrap(now: now))
    }

    func testFailureClassificationDistinguishesRequiredStartupStates() {
        XCTAssertEqual(
            InstallationIdentityFailure.classify(URLError(.notConnectedToInternet)).kind,
            .networkUnavailable
        )
        XCTAssertEqual(
            InstallationIdentityFailure.classify(InstallationIdentityError.appAttestTemporarilyUnavailable).kind,
            .appAttestTemporarilyUnavailable
        )
        XCTAssertEqual(
            InstallationIdentityFailure.classify(InstallationIdentityError.appAttestUnavailable).kind,
            .appAttestUnsupported
        )
        XCTAssertEqual(
            InstallationIdentityFailure.classify(APIError.serverStatus(statusCode: 503, message: "maintenance")).kind,
            .serverMaintenance
        )
        XCTAssertEqual(
            InstallationIdentityFailure.classify(APIError.serverStatus(statusCode: 401, message: "invalid")).kind,
            .invalidCredentials
        )
        XCTAssertEqual(
            InstallationIdentityFailure.classify(APIError.serverStatus(statusCode: 409, message: "conflict")).kind,
            .identityConflict
        )
        XCTAssertEqual(
            InstallationIdentityFailure.classify(InstallationIdentityError.invalidStoredCredential).kind,
            .secureStorageUnavailable
        )
        XCTAssertEqual(
            InstallationIdentityFailure.classify(APIError.serverStatus(statusCode: 403, message: "disabled")).kind,
            .permanentAuthenticationFailure
        )
    }

    func testStartupNetworkFailureKeepsCacheAndPublicSearchUsableWithoutStartupAlert() async throws {
        let controller = StartupAuthenticationRequestController(mode: .offline)
        StartupAuthenticationURLProtocol.requestHandler = { request in
            return try controller.handle(request)
        }
        let persistence = PersistenceController(inMemory: true)
        let company = TestFixtures.companyPayload()
        try persistence.saveCompany(company, searchItem: nil)
        let model = makeModel(
            persistence: persistence,
            identityStore: StartupIdentityStore(),
            appAttestClient: StartupAppAttestClient(isSupported: true)
        )

        await model.bootstrap()
        await model.retryInstallationAuthentication()

        XCTAssertTrue(model.isBootstrapped)
        XCTAssertEqual(model.companyPayload(for: "AAPL"), company)
        XCTAssertNil(model.activeAlert)
        XCTAssertEqual(controller.bootstrapCount, 4)
        guard case .degraded(let failure, let attemptCount) = model.installationIdentityLoadState else {
            return XCTFail("Expected degraded startup authentication")
        }
        XCTAssertEqual(failure.kind, .networkUnavailable)
        XCTAssertEqual(attemptCount, 4)
        XCTAssertEqual(model.installationAuthenticationStatus?.failure.kind, .networkUnavailable)

        await model.search(query: "Apple")
        XCTAssertEqual(model.searchResults.map(\.ticker), ["AAPL"])
        XCTAssertNil(model.activeAlert)

        model.setAIConsent(true)
        let didSend = await model.sendChat(question: "売上高は？", ticker: "AAPL")
        XCTAssertFalse(didSend)
        XCTAssertEqual(controller.chatCount, 0)
        XCTAssertNil(model.activeAlert)
        _ = await model.sendChat(question: "売上高は？", ticker: "AAPL")
        XCTAssertNil(model.activeAlert)
        XCTAssertEqual(model.installationAuthenticationStatus?.failure.kind, .networkUnavailable)
    }

    func testTemporaryAppAttestFailureRetriesThenDegradesWithoutDialog() async {
        let controller = StartupAuthenticationRequestController(mode: .authenticated)
        StartupAuthenticationURLProtocol.requestHandler = { request in
            try controller.handle(request)
        }
        let appAttest = StartupAppAttestClient(
            isSupported: true,
            generateKeyError: URLError(.cannotConnectToHost)
        )
        let model = makeModel(
            identityStore: StartupIdentityStore(),
            appAttestClient: appAttest
        )

        await model.bootstrap()
        await model.retryInstallationAuthentication()

        guard case .degraded(let failure, let attemptCount) = model.installationIdentityLoadState else {
            return XCTFail("Expected temporary App Attest degradation")
        }
        XCTAssertEqual(failure.kind, .appAttestTemporarilyUnavailable)
        XCTAssertEqual(attemptCount, 4)
        XCTAssertEqual(appAttest.generateKeyCallCount, 4)
        XCTAssertEqual(controller.bootstrapCount, 0)
        XCTAssertNil(model.activeAlert)
    }

    func testManualRetryRecoversAfterAutomaticRetryBudgetIsExhausted() async {
        let controller = StartupAuthenticationRequestController(mode: .offline)
        StartupAuthenticationURLProtocol.requestHandler = { request in
            try controller.handle(request)
        }
        let model = makeModel(
            identityStore: StartupIdentityStore(),
            appAttestClient: StartupAppAttestClient(isSupported: true)
        )

        await model.bootstrap()
        await model.retryInstallationAuthentication()
        XCTAssertEqual(controller.bootstrapCount, 4)
        XCTAssertNotNil(model.installationAuthenticationStatus)

        controller.setMode(.authenticated)
        await model.retryInstallationAuthentication()

        guard case .ready(let attestationStatus, let creditMode) = model.installationIdentityLoadState else {
            return XCTFail("Expected manual retry to authenticate")
        }
        XCTAssertEqual(attestationStatus, .verified)
        XCTAssertEqual(creditMode, .full)
        XCTAssertEqual(controller.bootstrapCount, 5)
        XCTAssertNil(model.installationAuthenticationStatus)
        XCTAssertNil(model.activeAlert)
        XCTAssertTrue(model.authenticatedCreditActionsAvailable)
    }

    func testSimulatorBootstrapConflictResetsLocalIdentityOnceAndRecovers() async throws {
        let controller = StartupAuthenticationRequestController(mode: .bootstrapConflictThenUnavailable)
        StartupAuthenticationURLProtocol.requestHandler = { request in
            try controller.handle(request)
        }
        let store = StartupIdentityStore(state: InstallationIdentityState(
            credential: nil,
            appAttestKeyId: nil,
            bootstrapOperationId: "stale-bootstrap-operation",
            consumedChallengeIds: [],
            consumedNonceDigests: []
        ))
        let client = makeClient(
            identityStore: store,
            appAttestClient: StartupAppAttestClient(isSupported: false)
        )

        let credential = try await client.bootstrapInstallationIdentity()

        XCTAssertEqual(controller.bootstrapCount, 2)
        XCTAssertEqual(credential.attestationStatus, .unavailable)
        XCTAssertEqual(credential.creditMode, .none)
        XCTAssertNotEqual(try store.loadState().bootstrapOperationId, "stale-bootstrap-operation")
    }

    func testInvalidStoredCredentialIsNonBlockingAndDoesNotLoop() async {
        let store = StartupIdentityStore(loadError: InstallationIdentityError.invalidStoredCredential)
        let controller = StartupAuthenticationRequestController(mode: .authenticated)
        StartupAuthenticationURLProtocol.requestHandler = { request in
            try controller.handle(request)
        }
        let model = makeModel(
            identityStore: store,
            appAttestClient: StartupAppAttestClient(isSupported: true)
        )

        await model.bootstrap()
        await model.retryInstallationAuthentication()

        guard case .degraded(let failure, let attemptCount) = model.installationIdentityLoadState else {
            return XCTFail("Expected secure-storage degradation")
        }
        XCTAssertEqual(failure.kind, .secureStorageUnavailable)
        XCTAssertEqual(attemptCount, 1)
        XCTAssertEqual(controller.bootstrapCount, 0)
        XCTAssertNil(model.activeAlert)
    }

    func testUnsupportedAppAttestAllowsCoreMutationButKeepsFraudSensitiveActionsGated() async throws {
        let credential = Self.credential(attestationStatus: .unavailable, creditMode: .none)
        let controller = StartupAuthenticationRequestController(mode: .authenticated)
        StartupAuthenticationURLProtocol.requestHandler = { request in
            if request.url?.path == "/v1/chat" {
                XCTAssertEqual(
                    request.value(forHTTPHeaderField: "Authorization"),
                    "Installation \(credential.token)"
                )
                XCTAssertNil(request.value(forHTTPHeaderField: "x-kabuyomi-app-attest-key-id"))
                XCTAssertNil(request.value(forHTTPHeaderField: "x-kabuyomi-app-attest-assertion"))
            }
            return try controller.handle(request)
        }
        let persistence = PersistenceController(inMemory: true)
        try persistence.saveCompany(TestFixtures.companyPayload(), searchItem: nil)
        let model = makeModel(
            persistence: persistence,
            requestContext: QuotaRequestContext(
                deviceKey: "legacy-test-device-key",
                installationCredential: credential,
                appAttestKeyId: nil
            ),
            identityStore: nil,
            appAttestClient: nil
        )

        await model.bootstrap()
        await model.retryInstallationAuthentication()

        XCTAssertEqual(model.usageLoadState, .loaded)
        XCTAssertNil(model.installationAuthenticationStatus)
        XCTAssertTrue(model.authenticatedCreditActionsAvailable)
        XCTAssertFalse(model.fraudSensitiveCreditActionsAvailable)
        model.setAIConsent(true)
        let didSend = await model.sendChat(question: "売上高は？", ticker: "AAPL")
        XCTAssertTrue(didSend)
        XCTAssertEqual(controller.chatCount, 1)

        await model.completeAppleAccountSignIn(identityToken: "must-not-reach-network")
        XCTAssertEqual(model.activeAlert?.message, InstallationIdentityError.appAttestUnavailable.localizedDescription)
    }

    func testAPIClientUsesWorkerAppAttestRoutesAndPersistsVerifiedCredential() async throws {
        let store = StartupIdentityStore()
        let appAttest = StartupAppAttestClient(isSupported: true)
        let recorder = StartupPathRecorder()
        StartupAuthenticationURLProtocol.requestHandler = { request in
            let path = request.url?.path ?? "missing"
            recorder.record(path)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch path {
            case "/v1/identity/bootstrap":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "credential": Self.credentialObject(attestationStatus: "pending", creditMode: "none"),
                        "attestationRequired": true
                    ])
                )
            case "/v1/identity/app-attest/challenge":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "challengeId": "challenge-1",
                        "nonce": "nonce-1",
                        "expiresAt": "2099-01-01T00:00:00.000Z"
                    ])
                )
            case "/v1/identity/app-attest/complete":
                return (
                    response,
                    try TestFixtures.jsonData([
                        "credential": Self.credentialObject(attestationStatus: "verified", creditMode: "full")
                    ])
                )
            default:
                throw URLError(.badURL)
            }
        }
        let client = makeClient(identityStore: store, appAttestClient: appAttest)

        let credential = try await client.bootstrapInstallationIdentity()

        XCTAssertEqual(credential.attestationStatus, .verified)
        XCTAssertEqual(credential.creditMode, .full)
        XCTAssertEqual(try store.loadState().credential, credential)
        XCTAssertEqual(recorder.paths, [
            "/v1/identity/bootstrap",
            "/v1/identity/app-attest/challenge",
            "/v1/identity/app-attest/complete"
        ])
        XCTAssertEqual(appAttest.attestCallCount, 1)
    }

    func testPendingCredential401RebootstrapsWithoutDiscardingStableBinding() async throws {
        let pending = Self.credential(attestationStatus: .pending, creditMode: .none)
        let store = StartupIdentityStore(state: InstallationIdentityState(
            credential: pending,
            appAttestKeyId: "stable-app-attest-key",
            bootstrapOperationId: "stable-bootstrap-operation",
            consumedChallengeIds: [],
            consumedNonceDigests: []
        ))
        let recorder = StartupPathRecorder()
        StartupAuthenticationURLProtocol.requestHandler = { request in
            let path = request.url?.path ?? "missing"
            recorder.record(path)
            if path == "/v1/identity/app-attest/challenge" {
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!,
                    try TestFixtures.jsonData(["error": "Installation credential has been replaced"])
                )
            }
            if path == "/v1/identity/bootstrap" {
                let body = try XCTUnwrap(Self.requestBodyData(from: request))
                let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
                XCTAssertEqual(object["bootstrapOperationId"] as? String, "stable-bootstrap-operation")
                XCTAssertEqual(object["appAttestKeyId"] as? String, "stable-app-attest-key")
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try TestFixtures.jsonData([
                        "credential": Self.credentialObject(attestationStatus: "verified", creditMode: "full"),
                        "attestationRequired": false
                    ])
                )
            }
            throw URLError(.badURL)
        }
        let client = makeClient(
            identityStore: store,
            appAttestClient: StartupAppAttestClient(isSupported: true)
        )

        let recovered = try await client.bootstrapInstallationIdentity()

        XCTAssertEqual(recovered.attestationStatus, .verified)
        XCTAssertEqual(recorder.paths, [
            "/v1/identity/app-attest/challenge",
            "/v1/identity/bootstrap"
        ])
        let state = try store.loadState()
        XCTAssertEqual(state.bootstrapOperationId, "stable-bootstrap-operation")
        XCTAssertEqual(state.appAttestKeyId, "stable-app-attest-key")
    }

    func testCredentialInsideRotationWindowRebootstrapsProactively() async throws {
        let expiring = Self.credential(
            expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(24 * 60 * 60)),
            attestationStatus: .verified,
            creditMode: .full
        )
        let store = StartupIdentityStore(state: InstallationIdentityState(
            credential: expiring,
            appAttestKeyId: "stable-app-attest-key",
            bootstrapOperationId: "stable-bootstrap-operation",
            consumedChallengeIds: [],
            consumedNonceDigests: []
        ))
        let recorder = StartupPathRecorder()
        StartupAuthenticationURLProtocol.requestHandler = { request in
            recorder.record(request.url?.path ?? "missing")
            let rotatedExpiry = ISO8601DateFormatter().string(from: Date().addingTimeInterval(90 * 24 * 60 * 60))
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "credential": Self.credentialObject(
                        tokenVersion: 2,
                        expiresAt: rotatedExpiry,
                        attestationStatus: "verified",
                        creditMode: "full"
                    ),
                    "attestationRequired": false
                ])
            )
        }
        let client = makeClient(
            identityStore: store,
            appAttestClient: StartupAppAttestClient(isSupported: true)
        )

        let rotated = try await client.bootstrapInstallationIdentity()

        XCTAssertEqual(rotated.tokenVersion, 2)
        XCTAssertEqual(recorder.paths, ["/v1/identity/bootstrap"])
        let state = try store.loadState()
        XCTAssertEqual(state.bootstrapOperationId, "stable-bootstrap-operation")
        XCTAssertEqual(state.appAttestKeyId, "stable-app-attest-key")
        XCTAssertEqual(state.credential, rotated)
    }

    func testStartup401ClearsOnlyRejectedCredentialAndRebootstrapsOnce() async throws {
        let current = Self.credential(
            expiresAt: "2099-01-01T00:00:00.000Z",
            attestationStatus: .verified,
            creditMode: .full
        )
        let store = StartupIdentityStore(state: InstallationIdentityState(
            credential: current,
            appAttestKeyId: "stable-app-attest-key",
            bootstrapOperationId: "stable-bootstrap-operation",
            consumedChallengeIds: ["old-challenge"],
            consumedNonceDigests: ["old-nonce"]
        ))
        let recorder = StartupPathRecorder()
        StartupAuthenticationURLProtocol.requestHandler = { request in
            let path = request.url?.path ?? "missing"
            let occurrence = recorder.record(path)
            if path == "/v1/usage", occurrence == 1 {
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!,
                    try TestFixtures.jsonData(["error": "Installation credential has expired"])
                )
            }
            if path == "/v1/identity/bootstrap" {
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try TestFixtures.jsonData([
                        "credential": Self.credentialObject(
                            tokenVersion: 2,
                            expiresAt: "2099-04-01T00:00:00.000Z",
                            attestationStatus: "verified",
                            creditMode: "full"
                        ),
                        "attestationRequired": false
                    ])
                )
            }
            if path == "/v1/usage" {
                return (
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try TestFixtures.jsonData([
                        "plan": "free",
                        "chatsUsed": 0,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-07-11"
                    ])
                )
            }
            throw URLError(.badURL)
        }
        let model = makeModel(
            identityStore: store,
            appAttestClient: StartupAppAttestClient(isSupported: true)
        )

        await model.bootstrap()
        await model.retryInstallationAuthentication()

        XCTAssertEqual(recorder.paths, [
            "/v1/usage",
            "/v1/identity/bootstrap",
            "/v1/usage"
        ])
        guard case .ready(.verified, .full) = model.installationIdentityLoadState else {
            return XCTFail("Expected rejected credential recovery")
        }
        XCTAssertNil(model.activeAlert)
        let state = try store.loadState()
        XCTAssertEqual(state.bootstrapOperationId, "stable-bootstrap-operation")
        XCTAssertEqual(state.appAttestKeyId, "stable-app-attest-key")
        XCTAssertEqual(state.consumedChallengeIds, ["old-challenge"])
        XCTAssertEqual(state.consumedNonceDigests, ["old-nonce"])
        XCTAssertEqual(state.credential?.tokenVersion, 2)
    }

    private func makeModel(
        persistence: PersistenceController = PersistenceController(inMemory: true),
        requestContext: QuotaRequestContext? = nil,
        identityStore: (any InstallationIdentityStateStoring)?,
        appAttestClient: (any AppAttestClient)?
    ) -> AppModel {
        let deviceIdentity = Self.makeTestDeviceIdentityStore()
        return AppModel(
            apiClient: makeClient(
                deviceIdentity: deviceIdentity,
                requestContext: requestContext,
                identityStore: identityStore,
                appAttestClient: appAttestClient
            ),
            persistence: persistence,
            deviceIdentity: deviceIdentity,
            rewardedAdService: StartupRewardedAdService(),
            installationIdentityRetryPolicy: .immediateForTests
        )
    }

    private func makeClient(
        deviceIdentity: DeviceIdentityStore? = nil,
        requestContext: QuotaRequestContext? = nil,
        identityStore: (any InstallationIdentityStateStoring)?,
        appAttestClient: (any AppAttestClient)?
    ) -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StartupAuthenticationURLProtocol.self]
        let deviceIdentity = deviceIdentity ?? Self.makeTestDeviceIdentityStore()
        return APIClient(
            session: URLSession(configuration: configuration),
            baseURL: URL(string: "https://example.com")!,
            deviceIdentity: deviceIdentity,
            requestContext: requestContext,
            subscriptionStore: nil,
            detachedAccessStore: nil,
            installationIdentityStore: identityStore,
            appAttestClient: appAttestClient,
            accountCredentialStore: nil
        )
    }

    private nonisolated static func credential(
        expiresAt: String? = nil,
        attestationStatus: InstallationAttestationStatus,
        creditMode: InstallationCreditMode
    ) -> InstallationCredential {
        InstallationCredential(
            token: "server-issued-installation-token",
            principal: "installation:v1:startup-test",
            tokenReference: "itok_startup_test",
            tokenVersion: 1,
            issuedAt: "2026-07-11T00:00:00.000Z",
            expiresAt: expiresAt,
            attestationStatus: attestationStatus,
            creditMode: creditMode
        )
    }

    private nonisolated static func credentialObject(
        tokenVersion: Int = 1,
        expiresAt: String? = nil,
        attestationStatus: String,
        creditMode: String
    ) -> [String: Any] {
        var object: [String: Any] = [
            "token": "server-issued-installation-token",
            "principal": "installation:v1:startup-test",
            "tokenReference": "itok_startup_test",
            "tokenVersion": tokenVersion,
            "issuedAt": "2026-07-11T00:00:00.000Z",
            "attestationStatus": attestationStatus,
            "creditMode": creditMode
        ]
        if let expiresAt {
            object["expiresAt"] = expiresAt
        }
        return object
    }

    private nonisolated static func requestBodyData(from request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1_024)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: 1_024)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data.isEmpty ? nil : data
    }

    private nonisolated static func clearKabuyomiDefaults() {
        let defaults = UserDefaults.standard
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("kabuyomi.") {
            defaults.removeObject(forKey: key)
        }
    }
}

@MainActor
private final class StartupIdentityStore: InstallationIdentityStateStoring {
    private var state: InstallationIdentityState
    private let loadError: Error?

    init(state: InstallationIdentityState = .empty, loadError: Error? = nil) {
        self.state = state
        self.loadError = loadError
    }

    func loadState() throws -> InstallationIdentityState {
        if let loadError { throw loadError }
        return state
    }

    func saveState(_ state: InstallationIdentityState) throws {
        self.state = state
    }

    func clear() throws {
        state = .empty
    }
}

@MainActor
private final class StartupAppAttestClient: AppAttestClient {
    let isSupported: Bool
    private(set) var attestCallCount = 0
    private(set) var generateKeyCallCount = 0
    private let generateKeyError: Error?

    init(isSupported: Bool, generateKeyError: Error? = nil) {
        self.isSupported = isSupported
        self.generateKeyError = generateKeyError
    }

    func generateKey() async throws -> String {
        generateKeyCallCount += 1
        if let generateKeyError { throw generateKeyError }
        return "startup-test-app-attest-key"
    }

    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data {
        attestCallCount += 1
        return Data("attestation".utf8)
    }

    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
        Data("assertion".utf8)
    }
}

@MainActor
private final class StartupRewardedAdService: RewardedAdServing {
    func presentRewardedAd(customData: String) async throws -> Bool { false }
}

private final class StartupAuthenticationRequestController: @unchecked Sendable {
    enum Mode: Equatable {
        case offline
        case authenticated
        case bootstrapConflictThenUnavailable
    }

    private let lock = NSLock()
    private var mode: Mode
    private var bootstrapRequests = 0
    private var chatRequests = 0

    init(mode: Mode) {
        self.mode = mode
    }

    func setMode(_ mode: Mode) {
        lock.lock()
        self.mode = mode
        lock.unlock()
    }

    func handle(_ request: URLRequest) throws -> (HTTPURLResponse, Data) {
        let path = request.url?.path ?? "missing"
        lock.lock()
        let mode = self.mode
        if path == "/v1/identity/bootstrap" { bootstrapRequests += 1 }
        let bootstrapRequestNumber = bootstrapRequests
        if path == "/v1/chat" { chatRequests += 1 }
        lock.unlock()

        if path == "/v1/search" {
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "items": [[
                        "ticker": "AAPL",
                        "companyName": "Apple Inc.",
                        "cik": "0000320193",
                        "exchange": "Nasdaq",
                        "latestFormType": "10-Q"
                    ]]
                ])
            )
        }

        if path == "/v1/identity/bootstrap", mode == .offline {
            throw URLError(.notConnectedToInternet)
        }

        if path == "/v1/identity/bootstrap",
           mode == .bootstrapConflictThenUnavailable,
           bootstrapRequestNumber == 1 {
            return (
                HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData(["error": "Installation bootstrap idempotency conflict"])
            )
        }

        if path == "/v1/identity/bootstrap" {
            let unavailable = mode == .bootstrapConflictThenUnavailable
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "credential": [
                        "token": "server-issued-installation-token",
                        "principal": "installation:v1:startup-test",
                        "tokenReference": "itok_startup_test",
                        "tokenVersion": 1,
                        "issuedAt": "2026-07-11T00:00:00.000Z",
                        "attestationStatus": unavailable ? "unavailable" : "verified",
                        "creditMode": unavailable ? "none" : "full"
                    ],
                    "attestationRequired": false
                ])
            )
        }

        if path == "/v1/usage" {
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "plan": "free",
                    "chatsUsed": 0,
                    "chatLimit": 10,
                    "stocksUsed": 0,
                    "stockLimit": 3,
                    "dateJST": "2026-07-11"
                ])
            )
        }

        if path == "/v1/chat" {
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try TestFixtures.jsonData([
                    "answer": "売上高は増加しました。",
                    "sources": [],
                    "responsePath": "deterministic",
                    "modelName": NSNull(),
                    "usage": [
                        "plan": "free",
                        "chatsUsed": 1,
                        "chatLimit": 10,
                        "stocksUsed": 0,
                        "stockLimit": 3,
                        "dateJST": "2026-07-11"
                    ]
                ])
            )
        }

        throw URLError(.badServerResponse)
    }

    var bootstrapCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return bootstrapRequests
    }

    var chatCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return chatRequests
    }
}

private final class StartupPathRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var recordedPaths: [String] = []

    @discardableResult
    func record(_ path: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        recordedPaths.append(path)
        return recordedPaths.lazy.filter { $0 == path }.count
    }

    var paths: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recordedPaths
    }
}

private final class StartupAuthenticationURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
