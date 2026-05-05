import Foundation

struct QuotaRequestContext {
    let deviceKey: String
    let originalTransactionId: String?
    let detachedAccessMode: DetachedAccessMode?

    init(deviceKey: String, originalTransactionId: String? = nil, detachedAccessMode: DetachedAccessMode? = nil) {
        self.deviceKey = deviceKey
        self.originalTransactionId = originalTransactionId
        self.detachedAccessMode = detachedAccessMode
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

    private let session: URLSession
    private let baseURL: URL
    private let deviceIdentity: DeviceIdentityStore?
    private let requestContext: QuotaRequestContext?
    private let subscriptionStore: SubscriptionStore?
    private let detachedAccessStore: DetachedAccessStore?

    init(
        session: URLSession = APIClient.makeSession(),
        baseURL: URL? = nil,
        deviceIdentity: DeviceIdentityStore? = DeviceIdentityStore.shared,
        requestContext: QuotaRequestContext? = nil,
        subscriptionStore: SubscriptionStore? = SubscriptionStore.shared,
        detachedAccessStore: DetachedAccessStore? = DetachedAccessStore.shared
    ) {
        self.session = session
        self.baseURL = APIBaseURLResolver.resolve(baseURL: baseURL)
        self.deviceIdentity = deviceIdentity
        self.requestContext = requestContext
        self.subscriptionStore = subscriptionStore
        self.detachedAccessStore = detachedAccessStore
    }

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
        let response: SearchResponse = try await sendRequest(url: components?.url ?? baseURL)
        return response.items
    }

    func addToWatchlist(
        ticker: String
    ) async throws -> WatchlistAddResponse {
        var headers = requestHeaders()
        headers["x-kabuyomi-watchlist-mode"] = "async"

        return try await sendRequest(
            path: "/v1/watchlist/add",
            method: "POST",
            headers: headers,
            body: ["ticker": ticker]
        )
    }

    func removeFromWatchlist(
        ticker: String
    ) async throws -> WatchlistRemoveResponse {
        try await sendRequest(
            path: "/v1/watchlist/remove",
            method: "POST",
            headers: requestHeaders(),
            body: ["ticker": ticker]
        )
    }

    func fetchCompany(
        ticker: String
    ) async throws -> CompanyLoadResponse {
        try await sendRequest(
            path: "/v1/company/\(ticker)",
            headers: requestHeaders()
        )
    }

    func refreshCompany(
        ticker: String
    ) async throws -> CompanyLoadResponse {
        try await sendRequest(
            path: "/v1/company/\(ticker)/refresh",
            method: "POST",
            headers: requestHeaders()
        )
    }

    func sendChat(
        filingKey: String,
        question: String,
        conversationContext: [ChatContextMessage] = []
    ) async throws -> ChatResponse {
        try await sendRequest(
            path: "/v1/chat",
            method: "POST",
            headers: requestHeaders(),
            body: ChatRequest(
                filingKey: filingKey,
                question: question,
                conversationContext: conversationContext,
                operationId: UUID().uuidString
            )
        )
    }

    func translateQuote(
        text: String,
        sourceLanguage: String? = nil,
        targetLanguage: String = "ja"
    ) async throws -> QuoteTranslationResponse {
        var body: [String: String] = [
            "text": text,
            "targetLanguage": targetLanguage,
            "operationId": UUID().uuidString
        ]
        if let sourceLanguage,
           !sourceLanguage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["sourceLanguage"] = sourceLanguage
        }

        return try await sendRequest(
            path: "/v1/translate-quote",
            method: "POST",
            headers: requestHeaders(),
            body: body
        )
    }

    func fetchUsage() async throws -> UsagePayload {
        try await sendRequest(
            path: "/v1/usage",
            headers: requestHeaders()
        )
    }

    func syncBilling(_ request: BillingSyncRequest) async throws -> BillingSyncResponse {
        try await sendRequest(
            path: "/v1/billing/sync",
            method: "POST",
            headers: requestHeaders(),
            body: request
        )
    }

    func grantCreditPurchase(_ request: CreditPurchaseGrantRequest) async throws -> CreditPurchaseGrantResponse {
        try await sendRequest(
            path: "/v1/ios/purchases/credits/complete",
            method: "POST",
            headers: requestHeaders(),
            body: request
        )
    }

    func createAdMobRewardIntent() async throws -> AdMobRewardIntentResponse {
        try await sendRequest(
            path: "/v1/admob/reward-intents",
            method: "POST",
            headers: requestHeaders(),
            body: EmptyRequestBody()
        )
    }

    func fetchAdMobRewardStatus(rewardIntentId: String) async throws -> AdMobRewardStatusResponse {
        var components = URLComponents(
            url: baseURL.appending(path: "/v1/admob/reward-status"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "id", value: rewardIntentId)]
        return try await sendRequest(
            headers: requestHeaders(),
            url: components?.url ?? baseURL.appending(path: "/v1/admob/reward-status")
        )
    }

    private func requestHeaders() -> [String: String] {
        let deviceKey = requestContext?.deviceKey ?? deviceIdentity?.deviceKey() ?? ""
        let originalTransactionId =
            requestContext?.originalTransactionId
            ?? subscriptionStore?.requestOriginalTransactionId
        let detachedAccessMode = requestContext?.detachedAccessMode ?? detachedAccessStore?.requestDetachedAccessMode
        var headers = ["x-device-key": deviceKey]

        if let originalTransactionId,
           !originalTransactionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            headers["x-kabuyomi-original-transaction-id"] = originalTransactionId
        }
        if let detachedAccessMode {
            headers["x-kabuyomi-detached-access"] = detachedAccessMode.rawValue
        }

        return headers
    }

    private func sendRequest<ResponseType: Decodable>(
        path: String? = nil,
        method: String = "GET",
        headers: [String: String] = [:],
        body: (some Encodable)? = Optional<String>.none,
        url: URL? = nil
    ) async throws -> ResponseType {
        let endpoint = url ?? baseURL.appending(path: path ?? "")
        let request = try buildRequest(
            url: endpoint,
            method: method,
            headers: headers,
            body: body
        )

        return try await decodeResponse(for: request)
    }

    private func buildRequest(
        url: URL,
        method: String,
        headers: [String: String],
        body: (some Encodable)?
    ) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = Timeout.request
        request.cachePolicy = .reloadIgnoringLocalCacheData
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }

        return request
    }

    private func decodeResponse<ResponseType: Decodable>(for request: URLRequest) async throws -> ResponseType {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data)
            if httpResponse.statusCode == 402, payload?.error == "insufficient_credits" {
                throw APIError.insufficientCredits(
                    required: payload?.creditsRequired ?? 1,
                    remaining: payload?.creditsRemaining ?? 0
                )
            }
            throw APIError.serverStatus(
                statusCode: httpResponse.statusCode,
                message: payload?.error ?? "HTTP \(httpResponse.statusCode)"
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
}

private struct APIErrorPayload: Decodable {
    let error: String
    let creditsRequired: Int?
    let creditsRemaining: Int?
}

private struct EmptyRequestBody: Encodable {}

enum APIError: LocalizedError, Equatable {
    case invalidResponse
    case server(String)
    case serverStatus(statusCode: Int, message: String)
    case insufficientCredits(required: Int, remaining: Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "レスポンスを解釈できませんでした。"
        case .server(let message):
            message
        case .serverStatus(let statusCode, let message):
            "HTTP \(statusCode): \(message)"
        case .insufficientCredits(let required, let remaining):
            "creditが不足しています。必要: \(required)、残り: \(remaining)"
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
