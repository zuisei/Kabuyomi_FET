import Foundation

struct QuotaRequestContext {
    let deviceKey: String
    let originalTransactionId: String?
    let detachedAccessMode: String?

    init(deviceKey: String, originalTransactionId: String? = nil, detachedAccessMode: String? = nil) {
        self.deviceKey = deviceKey
        self.originalTransactionId = originalTransactionId
        self.detachedAccessMode = detachedAccessMode
    }
}

private enum APIBaseURLResolver {
    static let productionURL = URL(string: "https://kabuyomi-api.dznqjmctk7.workers.dev")!

    static func resolve(baseURL: URL?) -> URL {
        baseURL ?? configuredBaseURL() ?? productionURL
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

    func search(query: String) async throws -> [SearchItem] {
        var components = URLComponents(url: baseURL.appending(path: "/v1/search"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        let response: SearchResponse = try await sendRequest(url: components?.url ?? baseURL)
        return response.items
    }

    func addToWatchlist(
        ticker: String
    ) async throws -> WatchlistAddResponse {
        try await sendRequest(
            path: "/v1/watchlist/add",
            method: "POST",
            headers: requestHeaders(),
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
    ) async throws -> CompanyPayload {
        try await sendRequest(
            path: "/v1/company/\(ticker)",
            headers: requestHeaders()
        )
    }

    func refreshCompany(
        ticker: String
    ) async throws -> CompanyPayload {
        try await sendRequest(
            path: "/v1/company/\(ticker)/refresh",
            method: "POST",
            headers: requestHeaders()
        )
    }

    func sendChat(
        filingKey: String,
        question: String
    ) async throws -> ChatResponse {
        try await sendRequest(
            path: "/v1/chat",
            method: "POST",
            headers: requestHeaders(),
            body: ["filingKey": filingKey, "question": question]
        )
    }

    func fetchUsage() async throws -> UsagePayload {
        try await sendRequest(
            path: "/v1/usage",
            headers: requestHeaders()
        )
    }

    func syncBilling(_ request: BillingSyncRequest) async throws -> BillingSyncResponse {
        try await sendRequest(path: "/v1/billing/sync", method: "POST", body: request)
    }

    private func requestHeaders() -> [String: String] {
        let deviceKey = requestContext?.deviceKey ?? deviceIdentity?.deviceKey() ?? ""
        let originalTransactionId = requestContext?.originalTransactionId ?? subscriptionStore?.requestOriginalTransactionId
        let detachedAccessMode = requestContext?.detachedAccessMode ?? detachedAccessStore?.requestDetachedAccessMode
        var headers = ["x-device-key": deviceKey]

        if let originalTransactionId,
           !originalTransactionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            headers["x-kabuyomi-original-transaction-id"] = originalTransactionId
        }

        if let detachedAccessMode,
           !detachedAccessMode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            headers["x-kabuyomi-detached-access"] = detachedAccessMode
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
            throw APIError.server(payload?.error ?? "HTTP \(httpResponse.statusCode)")
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
}

enum APIError: LocalizedError, Equatable {
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "レスポンスを解釈できませんでした。"
        case .server(let message):
            message
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
