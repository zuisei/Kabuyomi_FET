import Foundation

struct APIClient {
    private enum Timeout {
        static let request: TimeInterval = 45
        static let resource: TimeInterval = 75
    }

    private let session: URLSession
    private let baseURL: URL

    init(
        session: URLSession = APIClient.makeSession(),
        baseURL: URL = APIClient.defaultBaseURL()
    ) {
        self.session = session
        self.baseURL = baseURL
    }

    func search(query: String) async throws -> [SearchItem] {
        var components = URLComponents(url: baseURL.appending(path: "/v1/search"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        let response: SearchResponse = try await sendRequest(url: components?.url ?? baseURL)
        return response.items
    }

    func addToWatchlist(ticker: String, deviceKey: String) async throws -> WatchlistAddResponse {
        try await sendRequest(
            path: "/v1/watchlist/add",
            method: "POST",
            headers: requestHeaders(deviceKey: deviceKey),
            body: ["ticker": ticker]
        )
    }

    func fetchCompany(ticker: String, deviceKey: String) async throws -> CompanyPayload {
        try await sendRequest(
            path: "/v1/company/\(ticker)",
            headers: requestHeaders(deviceKey: deviceKey)
        )
    }

    func refreshCompany(ticker: String, deviceKey: String) async throws -> CompanyPayload {
        try await sendRequest(
            path: "/v1/company/\(ticker)/refresh",
            method: "POST",
            headers: requestHeaders(deviceKey: deviceKey)
        )
    }

    func sendChat(
        filingKey: String,
        question: String,
        deviceKey: String
    ) async throws -> ChatResponse {
        try await sendRequest(
            path: "/v1/chat",
            method: "POST",
            headers: requestHeaders(deviceKey: deviceKey),
            body: ["filingKey": filingKey, "question": question]
        )
    }

    func fetchUsage(deviceKey: String) async throws -> UsagePayload {
        try await sendRequest(
            path: "/v1/usage",
            headers: requestHeaders(deviceKey: deviceKey)
        )
    }

    func syncBilling(_ request: BillingSyncRequest) async throws -> BillingSyncResponse {
        try await sendRequest(path: "/v1/billing/sync", method: "POST", body: request)
    }

    private func requestHeaders(deviceKey: String) -> [String: String] {
        ["x-device-key": deviceKey]
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

    private static func defaultBaseURL() -> URL {
        if let url = configuredBaseURL() {
            return url
        }

        return URL(string: "https://kabuyomi-api.dznqjmctk7.workers.dev")!
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = Timeout.request
        configuration.timeoutIntervalForResource = Timeout.resource
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }

    private static func configuredBaseURL() -> URL? {
        if let override = ProcessInfo.processInfo.environment["KABUYOMI_API_BASE_URL"],
           let url = URL(string: override) {
            return url
        }

        if let plistValue = Bundle.main.object(forInfoDictionaryKey: "KABUYOMI_API_BASE_URL") as? String,
           let url = URL(string: plistValue) {
            return url
        }

        return nil
    }
}

private struct APIErrorPayload: Decodable {
    let error: String
}

enum APIError: LocalizedError {
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
