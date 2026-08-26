import Foundation

@MainActor
final class EventDataStore: ObservableObject {
    @Published private(set) var summaries: [PolicyEventSummary] = []
    @Published private(set) var dataMode: APIDataMode = .synthetic
    @Published private(set) var origin: RepositoryOrigin = .localFixture
    @Published private(set) var isLoading = false
    @Published private(set) var loadedSummaryCount = 0
    @Published private(set) var totalSummaryCount = 0
    @Published private(set) var errorMessage: String?

    let environment: AppEnvironment
    private let repository: any EventRepository
    private var lastSuccessfulSyncAt: Date?

    init(environment: AppEnvironment = .current, repository: (any EventRepository)? = nil) {
        self.environment = environment
        self.repository = repository ?? EventRepositoryFactory.make(environment: environment)
    }

    /// 続きを取るための位置。`nil` は「まだ読んでいない」か「読み切った」。
    private(set) var nextCursor: String?
    var hasMoreSummaries: Bool { nextCursor != nil }

    /// **開いたときは1ページだけ。**
    ///
    /// 以前はここで最後のページまで回していた。サーバーはどのページを求められても
    /// 全件を読んで JSON に起こしてから 100 件を切り出すので、1往復 1.4 秒が
    /// ページ数だけ積み上がる — 2,447 件で 25 往復・約35秒、全件パース6万回。
    /// 開いた直後に見えるのは最新の1日ぶんだけで、その全部が1ページ目に入る。
    /// 残りは要るときに `loadMoreSummaries()` で取る(2026-08-26)。
    func loadSummaries() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        let syncStartedAt = Date()
        do {
            let page = try await repository.loadSummaryPage(cursor: nil, updatedSince: nil)
            summaries = deduplicated(page.value)
            loadedSummaryCount = summaries.count
            totalSummaryCount = page.total
            dataMode = page.dataMode
            origin = page.origin
            nextCursor = page.nextCursor
            lastSuccessfulSyncAt = syncStartedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// 続きを1ページ。末尾が見えたときと、1日ぶんより広い絞り込みに切り替えたときに呼ぶ。
    func loadMoreSummaries() async {
        guard !isLoading, let cursor = nextCursor else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await repository.loadSummaryPage(cursor: cursor, updatedSince: nil)
            summaries = deduplicated(summaries + page.value)
            loadedSummaryCount = summaries.count
            totalSummaryCount = max(page.total, summaries.count)
            dataMode = page.dataMode
            origin = page.origin
            nextCursor = page.nextCursor
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshSummaries() async {
        guard let updatedSince = lastSuccessfulSyncAt, !summaries.isEmpty else {
            await loadSummaries()
            return
        }
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        let syncStartedAt = Date()
        do {
            var cursor: String?
            var updates: [PolicyEventSummary] = []
            repeat {
                let page = try await repository.loadSummaryPage(cursor: cursor, updatedSince: updatedSince)
                updates.append(contentsOf: page.value)
                dataMode = page.dataMode
                origin = page.origin
                cursor = page.nextCursor
            } while cursor != nil
            summaries = deduplicated(summaries + updates)
            loadedSummaryCount = summaries.count
            totalSummaryCount = max(totalSummaryCount, summaries.count)
            lastSuccessfulSyncAt = syncStartedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadEvent(_ summary: PolicyEventSummary) async throws -> RepositoryValue<PolicyEvent> {
        try await repository.loadEvent(id: summary.id, asOf: summary.lastActivityAt)
    }

    func translationStatus(for id: UUID) async throws -> TranslationRequestStatus? {
        try await repository.translationStatus(id: id)
    }

    func requestTranslation(for id: UUID) async throws -> TranslationRequestStatus {
        try await repository.requestTranslation(id: id)
    }

    func searchSummaries(queryItems: [URLQueryItem]) async throws -> RepositoryValue<[PolicyEventSummary]> {
        guard let baseURL = environment.baseURL else {
            return RepositoryValue(value: summaries, dataMode: dataMode, origin: origin)
        }
        let client = EventAPIClient(baseURL: baseURL)
        var cursor: String?
        var values: [PolicyEventSummary] = []
        var firstResult: CachedAPIValue<[PolicyEventSummary]>?
        repeat {
            var pageQuery = queryItems + [URLQueryItem(name: "limit", value: "100")]
            if let cursor { pageQuery.append(URLQueryItem(name: "cursor", value: cursor)) }
            let result: CachedAPIValue<[PolicyEventSummary]> = try await client.get(path: "/v1/search", query: pageQuery)
            firstResult = firstResult ?? result
            values.append(contentsOf: result.value)
            cursor = result.pagination?.nextCursor
        } while cursor != nil
        guard let firstResult else { throw EventRepositoryError.invalidResponse }
        return RepositoryValue(value: values, dataMode: firstResult.dataMode, origin: firstResult.origin)
    }

    private func deduplicated(_ values: [PolicyEventSummary]) -> [PolicyEventSummary] {
        var byID: [UUID: PolicyEventSummary] = [:]
        for value in values { byID[value.id] = value }
        return byID.values.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }
}
