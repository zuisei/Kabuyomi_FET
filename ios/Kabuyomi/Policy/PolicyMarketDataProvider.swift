import Foundation
import Security

enum MarketDataLicenseMode: String, Codable, CaseIterable {
    case licensedProxy = "licensed_proxy"
    case bringYourOwnKey = "bring_your_own_key"
    case marketDisabled = "market_disabled"
}

struct MarketBarsRequest: Sendable {
    let symbol: String
    let interval: String
    let outputSize: Int
    let startDate: Date?
    let endDate: Date?

    init(
        symbol: String,
        interval: String,
        outputSize: Int,
        startDate: Date? = nil,
        endDate: Date? = nil
    ) {
        self.symbol = symbol
        self.interval = interval
        self.outputSize = outputSize
        self.startDate = startDate
        self.endDate = endDate
    }
}

struct MarketQuoteRequest: Sendable { let symbol: String }
struct ProviderMarketBar: Sendable, Hashable { let timestamp: Date; let open, high, low, close, volume: Double }
struct MarketBarsResponse: Sendable { let symbol, providerID, attribution: String; let isDelayed: Bool; let bars: [ProviderMarketBar] }
struct MarketQuoteResponse: Sendable { let symbol, providerID, attribution: String; let price: Double; let observedAt: Date? }

protocol MarketDataProvider: Sendable {
    var providerID: String { get }
    var licenseMode: MarketDataLicenseMode { get }
    func bars(request: MarketBarsRequest) async throws -> MarketBarsResponse
    func quote(request: MarketQuoteRequest) async throws -> MarketQuoteResponse
}

enum MarketProviderError: LocalizedError {
    case keyMissing, invalidResponse, provider(String)
    var errorDescription: String? {
        switch self {
        case .keyMissing: "APIキーがKeychainにありません。"
        case .invalidResponse: "市場データ提供元の応答を読み取れませんでした。"
        case .provider(let message): "市場データ提供元: \(message)"
        }
    }
}

enum MarketDataKeychain {
    static let service = "com.t4dano.MarketDocket.market-data"
    static let account = "twelve-data-api-key"

    static func read(service: String = service, account: String = account) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ value: String, service: String = service, account: String = account) throws {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw MarketProviderError.keyMissing }
        delete(service: service, account: account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(trimmed.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw MarketProviderError.provider("Keychain error \(status)") }
    }

    static func delete(service: String = service, account: String = account) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ] as CFDictionary)
    }
}

struct TwelveDataBYOKProvider: MarketDataProvider {
    let providerID = "twelve-data-byok"
    let licenseMode = MarketDataLicenseMode.bringYourOwnKey
    private let session: URLSession
    private let apiKey: String

    init(apiKey: String? = MarketDataKeychain.read(), session: URLSession = .shared) throws {
        guard let apiKey, !apiKey.isEmpty else { throw MarketProviderError.keyMissing }
        self.apiKey = apiKey
        self.session = session
    }

    func bars(request: MarketBarsRequest) async throws -> MarketBarsResponse {
        var components = URLComponents(string: "https://api.twelvedata.com/time_series")!
        var queryItems = [
            URLQueryItem(name: "symbol", value: request.symbol),
            URLQueryItem(name: "interval", value: request.interval),
            URLQueryItem(name: "outputsize", value: String(min(max(request.outputSize, 1), 5000))),
            URLQueryItem(name: "timezone", value: "America/New_York"),
            URLQueryItem(name: "apikey", value: apiKey)
        ]
        if request.startDate != nil || request.endDate != nil {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "America/New_York")
            formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
            if let startDate = request.startDate {
                queryItems.append(URLQueryItem(name: "start_date", value: formatter.string(from: startDate)))
            }
            if let endDate = request.endDate {
                queryItems.append(URLQueryItem(name: "end_date", value: formatter.string(from: endDate)))
            }
        }
        components.queryItems = queryItems
        let payload: TimeSeriesPayload = try await requestJSON(components.url!)
        if let message = payload.message { throw MarketProviderError.provider(message) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let bars = (payload.values ?? []).compactMap { value -> ProviderMarketBar? in
            guard let timestamp = formatter.date(from: value.datetime), let open = Double(value.open), let high = Double(value.high),
                  let low = Double(value.low), let close = Double(value.close), let volume = Double(value.volume ?? "0") else { return nil }
            return ProviderMarketBar(timestamp: timestamp, open: open, high: high, low: low, close: close, volume: volume)
        }.sorted { $0.timestamp < $1.timestamp }
        guard !bars.isEmpty else { throw MarketProviderError.invalidResponse }
        return MarketBarsResponse(symbol: request.symbol, providerID: providerID, attribution: "Data provided by Twelve Data", isDelayed: true, bars: bars)
    }

    func quote(request: MarketQuoteRequest) async throws -> MarketQuoteResponse {
        var components = URLComponents(string: "https://api.twelvedata.com/quote")!
        components.queryItems = [URLQueryItem(name: "symbol", value: request.symbol), URLQueryItem(name: "apikey", value: apiKey)]
        let payload: QuotePayload = try await requestJSON(components.url!)
        if let message = payload.message { throw MarketProviderError.provider(message) }
        guard let priceString = payload.close ?? payload.price, let price = Double(priceString) else { throw MarketProviderError.invalidResponse }
        return MarketQuoteResponse(symbol: request.symbol, providerID: providerID, attribution: "Data provided by Twelve Data", price: price, observedAt: nil)
    }

    private func requestJSON<Value: Decodable>(_ url: URL) async throws -> Value {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw MarketProviderError.invalidResponse }
        return try JSONDecoder().decode(Value.self, from: data)
    }
}

private struct TimeSeriesPayload: Decodable {
    let values: [Value]?
    let message: String?
    struct Value: Decodable { let datetime, open, high, low, close: String; let volume: String? }
}

private struct QuotePayload: Decodable { let close, price, message: String? }
