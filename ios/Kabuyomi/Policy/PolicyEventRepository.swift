import CryptoKit
import Foundation

enum AppEnvironment: String, CaseIterable {
    case syntheticLocal
    case previewAPI
    case testflightAPI
    case productionAPI

    static var current: AppEnvironment {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let raw = arguments.value(after: "-appEnvironment"), let value = AppEnvironment(rawValue: raw) { return value }
        #endif
        if let configured = Bundle.main.object(forInfoDictionaryKey: "MARKET_DOCKET_DEFAULT_ENVIRONMENT") as? String,
           let value = AppEnvironment(rawValue: configured) { return value }
        return .previewAPI
    }

    var baseURL: URL? {
        switch self {
        case .syntheticLocal: return nil
        case .previewAPI: return URL(string: "https://md-api-preview.dznqjmctk7.workers.dev")
        case .testflightAPI:
            let value = Bundle.main.object(forInfoDictionaryKey: "MARKET_DOCKET_TESTFLIGHT_API_URL") as? String
            return URL(string: value ?? "https://md-api-testflight.dznqjmctk7.workers.dev")
        case .productionAPI:
            #if DEBUG
            if let override = ProcessInfo.processInfo.arguments.value(after: "-productionAPIURLOverride") {
                return override == "missing" ? nil : URL(string: override)
            }
            #endif
            guard let value = Bundle.main.object(forInfoDictionaryKey: "MARKET_DOCKET_PRODUCTION_API_URL") as? String else { return nil }
            return URL(string: value)
        }
    }
}

enum RepositoryOrigin: Equatable { case localFixture, network, validatedCache, offlineCache }

struct RepositoryValue<Value> {
    let value: Value
    let dataMode: APIDataMode
    let origin: RepositoryOrigin
}

struct SummaryRepositoryPage {
    let value: [PolicyEventSummary]
    let dataMode: APIDataMode
    let origin: RepositoryOrigin
    let total: Int
    let nextCursor: String?
}

enum EventRepositoryError: LocalizedError {
    case productionURLMissing
    case invalidResponse
    case httpStatus(Int)
    case cacheMissing
    case contractChanged(String)

    var errorDescription: String? {
        return switch self {
        case .productionURLMissing: "Production API URLが設定されていません。"
        case .invalidResponse: "APIから有効な応答を受け取れませんでした。"
        case .httpStatus(let status): "APIがHTTP \(status)を返しました。"
        case .cacheMissing: "304応答に対応するローカルキャッシュがありません。"
        case .contractChanged(let detail): "API契約を読み取れませんでした: \(detail)"
        }
    }
}

@MainActor
protocol EventRepository {
    func loadSummaries() async throws -> RepositoryValue<[PolicyEventSummary]>
    func loadSummaryPage(cursor: String?, updatedSince: Date?) async throws -> SummaryRepositoryPage
    func loadEvent(id: UUID, asOf: Date) async throws -> RepositoryValue<PolicyEvent>
    func translationStatus(id: UUID) async throws -> TranslationRequestStatus?
    func requestTranslation(id: UUID) async throws -> TranslationRequestStatus
}

extension EventRepository {
    func loadSummaryPage(cursor: String?, updatedSince: Date?) async throws -> SummaryRepositoryPage {
        let result = try await loadSummaries()
        return SummaryRepositoryPage(
            value: result.value,
            dataMode: result.dataMode,
            origin: result.origin,
            total: result.value.count,
            nextCursor: nil
        )
    }
}


struct RemoteEventRepository: EventRepository {
    let client: EventAPIClient

    func loadSummaries() async throws -> RepositoryValue<[PolicyEventSummary]> {
        var cursor: String?
        var values: [PolicyEventSummary] = []
        var firstPage: SummaryRepositoryPage?
        repeat {
            let page = try await loadSummaryPage(cursor: cursor, updatedSince: nil)
            firstPage = firstPage ?? page
            values.append(contentsOf: page.value)
            cursor = page.nextCursor
        } while cursor != nil
        guard let page = firstPage else { throw EventRepositoryError.invalidResponse }
        return RepositoryValue(value: values, dataMode: page.dataMode, origin: page.origin)
    }

    func loadSummaryPage(cursor: String?, updatedSince: Date?) async throws -> SummaryRepositoryPage {
        var query = [URLQueryItem(name: "limit", value: "100")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let updatedSince { query.append(URLQueryItem(name: "updated_since", value: APIFormatters.string(from: updatedSince))) }
        let result: CachedAPIValue<[PolicyEventSummary]> = try await client.get(path: "/v1/events", query: query)
        return SummaryRepositoryPage(
            value: result.value,
            dataMode: result.dataMode,
            origin: result.origin,
            total: result.pagination?.total ?? result.value.count,
            nextCursor: result.pagination?.nextCursor
        )
    }

    func loadEvent(id: UUID, asOf: Date) async throws -> RepositoryValue<PolicyEvent> {
        let base = "/v1/events/\(id.uuidString.lowercased())"
        async let detail: CachedAPIValue<EventDetailPayload> = client.get(path: base)
        async let evidence: CachedAPIValue<EvidencePayload> = client.get(path: base + "/evidence")
        async let market: CachedAPIValue<MarketPayload> = client.get(path: base + "/market")
        async let replay: CachedAPIValue<ReplayPayload> = client.get(path: base + "/replay", query: [URLQueryItem(name: "as_of", value: APIFormatters.string(from: asOf))])
        let parts = try await (detail, evidence, market, replay)
        let event = PolicyEvent(detail: parts.0.value, evidence: parts.1.value, market: parts.2.value, replay: parts.3.value)
        let origins = [parts.0.origin, parts.1.origin, parts.2.origin, parts.3.origin]
        let origin: RepositoryOrigin = if origins.contains(.offlineCache) {
            .offlineCache
        } else if origins.contains(.validatedCache) {
            .validatedCache
        } else {
            .network
        }
        return RepositoryValue(value: event, dataMode: parts.0.dataMode, origin: origin)
    }

    func translationStatus(id: UUID) async throws -> TranslationRequestStatus? {
        let result: CachedAPIValue<TranslationRequestStatus> = try await client.getFresh(
            path: "/v1/events/\(id.uuidString.lowercased())/translation"
        )
        return result.value
    }

    func requestTranslation(id: UUID) async throws -> TranslationRequestStatus {
        let result: CachedAPIValue<TranslationRequestStatus> = try await client.post(
            path: "/v1/events/\(id.uuidString.lowercased())/translation"
        )
        return result.value
    }
}

@MainActor
enum EventRepositoryFactory {
    /// **架空データへ落ちる道は持たない。** MarketDocket には同梱の
    /// デモ政策イベント(架空の BIS 事例)を返す `LocalEventRepository` と
    /// 起動引数で選ぶ `LaunchScenarioRepository` があったが、移植時に落とした。
    /// Kabuyomi は公開文書を根拠付きで読ませるアプリで、
    /// **作り話の開示が本物の隣に並ぶ余地を1つも残さない**(2026-08-26)。
    /// 設定が無いときは、黙って何か出すのではなく設定が無いと言う。
    static func make(environment: AppEnvironment = .current) -> any EventRepository {
        guard let baseURL = environment.baseURL else { return MissingConfigurationRepository() }
        return RemoteEventRepository(client: EventAPIClient(baseURL: baseURL))
    }
}


private struct MissingConfigurationRepository: EventRepository {
    func loadSummaries() async throws -> RepositoryValue<[PolicyEventSummary]> { throw EventRepositoryError.productionURLMissing }
    func loadEvent(id: UUID, asOf: Date) async throws -> RepositoryValue<PolicyEvent> { throw EventRepositoryError.productionURLMissing }
    func translationStatus(id: UUID) async throws -> TranslationRequestStatus? { throw EventRepositoryError.productionURLMissing }
    func requestTranslation(id: UUID) async throws -> TranslationRequestStatus { throw EventRepositoryError.productionURLMissing }
}

private enum APIFormatters {
    static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}

struct CacheRecord: Codable { let etag: String?; let body: Data }

actor ResponseCache {
    private let directory: URL

    init(directory: URL? = nil) {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.directory = base.appendingPathComponent("MarketDocket/APIResponseCache", isDirectory: true)
    }

    func read(key: String) -> CacheRecord? {
        try? JSONDecoder().decode(CacheRecord.self, from: Data(contentsOf: fileURL(key: key)))
    }

    func write(key: String, etag: String?, body: Data) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(CacheRecord(etag: etag, body: body)).write(to: fileURL(key: key), options: .atomic)
    }

    nonisolated func clear() throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    private func fileURL(key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(digest + ".json")
    }
}

struct CachedAPIValue<Value>: @unchecked Sendable {
    let value: Value
    let dataMode: APIDataMode
    let origin: RepositoryOrigin
    let pagination: APIPagination?
}

@MainActor
struct EventAPIClient {
    let baseURL: URL
    var session: URLSession = .shared
    var cache = ResponseCache()

    func get<Value: Codable>(path: String, query: [URLQueryItem] = []) async throws -> CachedAPIValue<Value> {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { throw EventRepositoryError.invalidResponse }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw EventRepositoryError.invalidResponse }
        let key = url.absoluteString
        let cached = await cache.read(key: key)
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let etag = cached?.etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }

        do {
            let (body, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw EventRepositoryError.invalidResponse }
            if http.statusCode == 304 {
                guard let cached else { throw EventRepositoryError.cacheMissing }
                return try decode(cached.body, origin: .validatedCache)
            }
            guard (200..<300).contains(http.statusCode) else { throw EventRepositoryError.httpStatus(http.statusCode) }
            let decoded: CachedAPIValue<Value> = try decode(body, origin: .network)
            try await cache.write(key: key, etag: http.value(forHTTPHeaderField: "ETag"), body: body)
            return decoded
        } catch let error as EventRepositoryError {
            throw error
        } catch let error as DecodingError {
            throw EventRepositoryError.contractChanged(String(describing: error))
        } catch {
            guard let cached else { throw error }
            return try decode(cached.body, origin: .offlineCache)
        }
    }

    func getFresh<Value: Codable>(path: String, query: [URLQueryItem] = []) async throws -> CachedAPIValue<Value> {
        try await sendUncached(path: path, query: query, method: "GET", body: nil)
    }

    func post<Value: Codable>(path: String, body: Data = Data("{}".utf8)) async throws -> CachedAPIValue<Value> {
        try await sendUncached(path: path, query: [], method: "POST", body: body)
    }

    private func sendUncached<Value: Codable>(
        path: String,
        query: [URLQueryItem],
        method: String,
        body: Data?
    ) async throws -> CachedAPIValue<Value> {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw EventRepositoryError.invalidResponse
        }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw EventRepositoryError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        do {
            let (responseBody, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw EventRepositoryError.invalidResponse }
            guard (200..<300).contains(http.statusCode) else { throw EventRepositoryError.httpStatus(http.statusCode) }
            return try decode(responseBody, origin: .network)
        } catch let error as EventRepositoryError {
            throw error
        } catch let error as DecodingError {
            throw EventRepositoryError.contractChanged(String(describing: error))
        } catch {
            throw error
        }
    }

    private func decode<Value: Codable>(_ body: Data, origin: RepositoryOrigin) throws -> CachedAPIValue<Value> {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = APIFormatters.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date: \(value)")
        }
        do {
            let envelope = try decoder.decode(APIEnvelope<Value>.self, from: body)
            return CachedAPIValue(value: envelope.data, dataMode: envelope.dataMode, origin: origin, pagination: envelope.pagination)
        } catch {
            throw EventRepositoryError.contractChanged(String(describing: error))
        }
    }
}

extension PolicyEventSummary {
    init(event: PolicyEvent) {
        self.init(
            id: event.id, agency: event.agency, titleJA: event.titleJA, titleEN: event.titleEN,
            summaryJA: event.summaryJA, topics: event.topics, tickers: event.tickers, status: event.status,
            lastActivityAt: event.lastActivityAt, publishedAt: event.publishedAt, revisedAt: event.revisedAt,
            marketEvaluationAvailableAt: event.marketSummaries.first?.availableAt,
            hasMarketData: !event.marketSeries.isEmpty, timelineItemCount: event.timelineItems.count,
            updateCount: event.timelineItems.count, relatedDocumentCount: event.relatedDocuments.count,
            confounderCount: event.confounders.count, hasCorrectionDocument: event.relatedDocuments.contains { $0.documentType == .correctingAmendment },
            coverageState: event.coverageState, verificationState: event.eventVerificationState,
            instrumentType: event.instrumentType, domain: event.policyDomain, analysis: event.productAnalysis,
            translation: event.translation,
            publicationGrouping: event.relatedDocuments.first(where: { $0.relationship == .primary }).map {
                PublicationGroupingMetadata(
                    documentNumber: $0.documentNumber,
                    docketIDs: $0.docketIDs ?? [],
                    regulationIDNumbers: $0.regulationIDNumbers ?? [],
                    cfrReferences: $0.cfrReferences ?? []
                )
            },
            legalDates: event.relatedDocuments.flatMap { document in
                [
                    document.commentsCloseOn.map {
                        PolicyLegalDateSummary(
                            kind: .commentsClose, date: $0, documentID: document.id,
                            documentNumber: document.documentNumber, officialURL: document.officialURL
                        )
                    },
                    document.effectiveOn.map {
                        PolicyLegalDateSummary(
                            kind: .effective, date: $0, documentID: document.id,
                            documentNumber: document.documentNumber, officialURL: document.officialURL
                        )
                    },
                    document.applicableOn.map {
                        PolicyLegalDateSummary(
                            kind: .applicable, date: $0, documentID: document.id,
                            documentNumber: document.documentNumber, officialURL: document.officialURL
                        )
                    }
                ].compactMap { $0 }
            }
        )
    }
}

extension PolicyEvent {
    init(detail: EventDetailPayload, evidence: EvidencePayload, market: MarketPayload, replay: ReplayPayload) {
        self.init(
            id: detail.id, isSynthetic: detail.isSynthetic, lastActivityAt: detail.lastActivityAt,
            agency: detail.agency, titleJA: detail.titleJA, titleEN: detail.titleEN, summaryJA: detail.summaryJA,
            topics: detail.topics, tickers: detail.tickers, category: detail.category, status: detail.status,
            timestampState: detail.timestampState, analysisAnchor: detail.analysisAnchor,
            officialPublicationDate: detail.officialPublicationDate, publishedAt: detail.publishedAt,
            detectedAt: detail.detectedAt, revisedAt: detail.revisedAt, sourceURL: detail.sourceURL,
            documentInfo: evidence.documentInfo, timelineItems: replay.timelineItems,
            exposures: detail.exposures, marketSummaries: market.evaluations, marketSeries: market.series,
            marketProvenance: market.provenance,
            confounders: detail.confounders, confounderReviewState: detail.confounderReviewState,
            importantClauses: detail.importantClauses, documentVersions: evidence.documentVersions,
            documents: evidence.documents, relationshipCandidates: evidence.relationshipCandidates,
            documentDiff: evidence.documentDiff, correctionNotes: evidence.correctionNotes,
            coverageState: detail.coverageState, eventVerificationState: detail.eventVerificationState,
            instrumentType: detail.instrumentType, policyDomain: detail.policyDomain, analysis: detail.analysis,
            translation: detail.translation
        )
    }
}
