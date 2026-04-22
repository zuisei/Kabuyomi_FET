import CoreData
import Foundation

@MainActor
final class PersistenceController {
    static let shared = PersistenceController()
    private static let managedObjectModel = CoreDataSchema.makeModel()

    let container: NSPersistentContainer

    var viewContext: NSManagedObjectContext {
        container.viewContext
    }

    init(inMemory: Bool = false) {
        container = NSPersistentContainer(name: "Kabuyomi", managedObjectModel: Self.managedObjectModel)

        if inMemory {
            container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null")
        }

        container.persistentStoreDescriptions.forEach { description in
            description.shouldMigrateStoreAutomatically = true
            description.shouldInferMappingModelAutomatically = true
        }

        container.loadPersistentStores { _, error in
            if let error {
                fatalError("Failed to load persistent store: \(error)")
            }
        }

        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergePolicy.mergeByPropertyObjectTrump
    }

    func loadWatchlistCards(savedTickers: [String]) -> [WatchlistCard] {
        guard !savedTickers.isEmpty else { return [] }

        let cardsByTicker = Dictionary(uniqueKeysWithValues: loadCompanyCards(tickers: savedTickers).map { ($0.ticker, $0) })
        return savedTickers.map { ticker in
            cardsByTicker[ticker] ?? WatchlistCard(
                filingKey: "",
                ticker: ticker,
                companyName: ticker,
                formType: "",
                filedAt: .distantPast,
                verdict: "",
                metrics: [],
                isPlaceholder: true
            )
        }
    }

    func loadCompanyCard(ticker: String) -> WatchlistCard? {
        loadCompanyCards(tickers: [ticker]).first
    }

    func loadTickerCIKMap() -> [String: String] {
        let request = StockEntity.fetchRequest()

        do {
            return try viewContext.fetch(request).reduce(into: [String: String]()) { result, stock in
                result[stock.ticker] = stock.cik
            }
        } catch {
            return [:]
        }
    }

    func loadTickers(cik: String) -> [String] {
        let normalized = cik.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return [] }

        let request = StockEntity.fetchRequest()
        request.predicate = NSPredicate(format: "cik == %@", normalized)

        do {
            return try viewContext.fetch(request)
                .map(\.ticker)
                .sorted()
        } catch {
            return []
        }
    }

    func loadCompanyCards(tickers: [String]) -> [WatchlistCard] {
        guard !tickers.isEmpty else { return [] }

        let request = StockEntity.fetchRequest()
        request.predicate = NSPredicate(format: "ticker IN %@", tickers)

        do {
            return try viewContext.fetch(request)
                .compactMap(cardPayload(from:))
                .sorted { $0.filedAt > $1.filedAt }
        } catch {
            return []
        }
    }

    func loadCompany(ticker: String) -> LocalCompanyRecord? {
        let request = StockEntity.fetchRequest()
        request.fetchLimit = 1
        request.predicate = NSPredicate(format: "ticker == %@", ticker)

        do {
            guard let stock = try viewContext.fetch(request).first,
                  let filing = stock.filingArray.first,
                  let summary = filing.summary else {
                return nil
            }

            let company = CompanyPayload(
                filingKey: filing.filingKey,
                ticker: stock.ticker,
                companyName: stock.companyName,
                cik: stock.cik,
                formType: filing.formType,
                filedAt: Self.dayString(from: filing.filedAt),
                periodOfReport: Self.dayString(from: filing.periodOfReport),
                primaryDocumentUrl: filing.primaryDocumentUrl,
                companyWebsiteUrl: filing.companyWebsiteUrl.map(Self.detachedString),
                summary: SummaryPayload(
                    verdict: summary.verdictText,
                    highlights: summary.itemArray.filter { $0.kind == "highlight" }.map(summaryItemPayload(from:)),
                    changes: summary.itemArray.filter { $0.kind == "change" }.map(summaryItemPayload(from:))
                ),
                metrics: filing.metricArray.map(metricPayload(from:)),
                historicalOverview: decodeHistoricalOverview(from: filing.historicalOverviewJSON),
                sourceChunks: filing.sourceChunkArray.map(sourceChunkPayload(from:)),
                lastUpdatedAt: Self.isoString(from: stock.lastUpdatedAt)
            )

            let messages = filing.chatMessageArray.map { message in
                LocalChatMessage(
                    id: message.id,
                    role: Self.detachedString(message.role),
                    content: Self.detachedString(message.content),
                    createdAt: message.createdAt,
                    modelName: Self.detachedString(message.modelName),
                    sources: message.sourceRefArray.map {
                        LocalMessageSourceRef(
                            id: $0.id,
                            sourceIdSnapshot: $0.sourceIdSnapshot.map(Self.detachedString),
                            sourceKind: MessageSourceKind(rawValue: $0.sourceKindSnapshot ?? "") ?? .secFiling,
                            sourceLabelSnapshot: Self.detachedString($0.sourceLabelSnapshot),
                            excerpt: Self.detachedString($0.excerpt),
                            sourceUrl: $0.sourceUrlSnapshot.map(Self.detachedString)
                        )
                    }
                )
            }

            return LocalCompanyRecord(company: company, chatHistory: messages)
        } catch {
            return nil
        }
    }

    func saveCompany(_ company: CompanyPayload, searchItem: SearchItem?) throws {
        let stock = try fetchOrCreateStock(ticker: company.ticker)
        stock.companyName = company.companyName
        stock.cik = company.cik
        stock.exchange = searchItem?.exchange ?? stock.exchange
        stock.lastUpdatedAt = Self.parseDate(company.lastUpdatedAt) ?? Date()
        if stock.addedAt == .distantPast {
            stock.addedAt = Date()
        }

        let accessionNumber = company.filingKey.split(separator: ":").last.map(String.init) ?? company.filingKey
        let filing = try fetchOrCreateFiling(key: company.filingKey, accessionNumber: accessionNumber, stock: stock)
        filing.filingKey = company.filingKey
        filing.formType = company.formType
        filing.filedAt = Self.parseDate(company.filedAt) ?? Date()
        filing.periodOfReport = Self.parseDate(company.periodOfReport) ?? filing.filedAt
        filing.accessionNumber = accessionNumber
        filing.primaryDocumentUrl = company.primaryDocumentUrl
        filing.companyWebsiteUrl = company.companyWebsiteUrl
        filing.mdaText = company.sourceChunks.filter { $0.sectionType == "md_a" }.map(\.text).joined(separator: "\n\n")
        filing.mdaTokenCount = Int32(max(0, filing.mdaText.count / 4))
        filing.extractorVersion = company.filingKey.split(separator: ":").first.map(String.init) ?? "v1"
        filing.promptVersion = "v1"
        filing.historicalOverviewJSON = encodeHistoricalOverview(company.historicalOverview)

        replaceSummary(on: filing, summary: company.summary)
        replaceMetrics(on: filing, metrics: company.metrics)
        replaceSourceChunks(on: filing, sourceChunks: company.sourceChunks)

        try viewContext.save()
    }

    func saveChat(question: String, response: ChatResponse, for company: CompanyPayload) throws {
        guard let filing = try fetchFiling(key: company.filingKey) else {
            return
        }

        let userMessage = ChatMessageEntity(context: viewContext)
        userMessage.id = UUID()
        userMessage.role = "user"
        userMessage.content = question
        userMessage.createdAt = Date()
        userMessage.modelName = "local"
        userMessage.filing = filing

        let assistantMessage = ChatMessageEntity(context: viewContext)
        assistantMessage.id = UUID()
        assistantMessage.role = "assistant"
        assistantMessage.content = response.answer
        assistantMessage.createdAt = Date()
        assistantMessage.modelName = storedMessageModelName(for: response)
        assistantMessage.filing = filing

        for source in response.sources {
            let ref = MessageSourceRefEntity(context: viewContext)
            ref.id = UUID()
            ref.sourceIdSnapshot = source.sourceId
            ref.sourceKindSnapshot = source.sourceKind.rawValue
            ref.sourceLabelSnapshot = source.sourceLabel
            ref.excerpt = source.excerpt
            ref.sourceUrlSnapshot = source.sourceUrl
            ref.chatMessage = assistantMessage
            ref.sourceChunk = filing.sourceChunkArray.first(where: { $0.sourceId == source.sourceId })
        }

        try viewContext.save()
    }

    func reset() throws {
        for entityName in [
            "MessageSourceRefEntity",
            "ChatMessageEntity",
            "SourceChunkEntity",
            "FinancialMetricEntity",
            "SummaryItemEntity",
            "SummaryEntity",
            "FilingEntity",
            "StockEntity"
        ] {
            let request = NSFetchRequest<NSFetchRequestResult>(entityName: entityName)
            let delete = NSBatchDeleteRequest(fetchRequest: request)
            try viewContext.execute(delete)
        }

        try viewContext.save()
    }

    func removeStock(ticker: String) throws {
        let request = StockEntity.fetchRequest()
        request.fetchLimit = 1
        request.predicate = NSPredicate(format: "ticker == %@", ticker)

        guard let stock = try viewContext.fetch(request).first else {
            return
        }

        viewContext.delete(stock)
        try viewContext.save()
    }

    private func cardPayload(from stock: StockEntity) -> WatchlistCard? {
        guard let latest = stock.filingArray.first else { return nil }
        return WatchlistCard(
            filingKey: latest.filingKey,
            ticker: stock.ticker,
            companyName: stock.companyName,
            formType: latest.formType,
            filedAt: latest.filedAt,
            verdict: latest.summary?.verdictText ?? "",
            metrics: latest.metricArray.map(metricPayload(from:)),
            isPlaceholder: false
        )
    }

    private func fetchOrCreateStock(ticker: String) throws -> StockEntity {
        let request = StockEntity.fetchRequest()
        request.fetchLimit = 1
        request.predicate = NSPredicate(format: "ticker == %@", ticker)

        if let existing = try viewContext.fetch(request).first {
            return existing
        }

        let stock = StockEntity(context: viewContext)
        stock.id = UUID()
        stock.ticker = ticker
        stock.companyName = ""
        stock.cik = ""
        stock.exchange = ""
        stock.addedAt = Date()
        stock.lastUpdatedAt = .distantPast
        return stock
    }

    private func fetchOrCreateFiling(key: String, accessionNumber: String, stock: StockEntity) throws -> FilingEntity {
        if let filing = try fetchFiling(key: key) {
            return filing
        }

        let request = FilingEntity.fetchRequest()
        request.fetchLimit = 1
        request.predicate = NSPredicate(format: "stock == %@ AND accessionNumber == %@", stock, accessionNumber)
        if let existing = try viewContext.fetch(request).first {
            return existing
        }

        let filing = FilingEntity(context: viewContext)
        filing.id = UUID()
        filing.filingKey = key
        filing.formType = ""
        filing.filedAt = Date()
        filing.periodOfReport = Date()
        filing.accessionNumber = ""
        filing.primaryDocumentUrl = ""
        filing.companyWebsiteUrl = nil
        filing.mdaText = ""
        filing.mdaTokenCount = 0
        filing.extractorVersion = "v1"
        filing.promptVersion = "v1"
        filing.stock = stock
        return filing
    }

    private func fetchFiling(key: String) throws -> FilingEntity? {
        let request = FilingEntity.fetchRequest()
        request.fetchLimit = 1
        request.predicate = NSPredicate(format: "filingKey == %@", key)
        return try viewContext.fetch(request).first
    }

    private func replaceSummary(on filing: FilingEntity, summary: SummaryPayload) {
        if let existing = filing.summary {
            existing.itemArray.forEach(viewContext.delete)
            viewContext.delete(existing)
        }

        let entity = SummaryEntity(context: viewContext)
        entity.id = UUID()
        entity.generatedAt = Date()
        entity.verdictText = summary.verdict
        entity.comparisonLabel = ""
        entity.modelName = AIModelName.remoteFallback
        entity.filing = filing

        for (index, item) in summary.highlights.enumerated() {
            let summaryItem = SummaryItemEntity(context: viewContext)
            summaryItem.id = UUID()
            summaryItem.kind = "highlight"
            summaryItem.text = item.text
            summaryItem.sortOrder = Int32(index)
            summaryItem.sourceIdsJSON = encodeSourceIds(item.sourceIds)
            summaryItem.summary = entity
        }

        for (index, item) in summary.changes.enumerated() {
            let summaryItem = SummaryItemEntity(context: viewContext)
            summaryItem.id = UUID()
            summaryItem.kind = "change"
            summaryItem.text = item.text
            summaryItem.sortOrder = Int32(index)
            summaryItem.sourceIdsJSON = encodeSourceIds(item.sourceIds)
            summaryItem.summary = entity
        }
    }

    private func replaceMetrics(on filing: FilingEntity, metrics: [MetricPayload]) {
        filing.metricArray.forEach(viewContext.delete)

        for metric in metrics {
            let entity = FinancialMetricEntity(context: viewContext)
            entity.id = UUID()
            entity.logicalName = metric.logicalName
            entity.tagUsed = metric.tagUsed
            entity.value = metric.value
            entity.unit = metric.unit
            entity.periodEnd = Self.parseDate(metric.periodEnd) ?? Date()
            entity.comparisonValue = metric.comparisonValue.map(NSNumber.init(value:))
            entity.yoyPercent = metric.yoyPercent.map(NSNumber.init(value:))
            entity.filing = filing
        }
    }

    private func storedMessageModelName(for response: ChatResponse) -> String {
        if let responsePath = response.responsePath {
            return responsePath.usesRemoteModel ? AIModelName.storedRemoteModelName(response.modelName) : ""
        }

        return AIModelName.storedLegacyModelName(response.modelName)
    }

    private func replaceSourceChunks(on filing: FilingEntity, sourceChunks: [SourceChunkPayload]) {
        filing.sourceChunkArray.forEach(viewContext.delete)

        for chunk in sourceChunks {
            let entity = SourceChunkEntity(context: viewContext)
            entity.id = UUID()
            entity.sourceId = chunk.sourceId
            entity.sectionType = chunk.sectionType
            entity.sectionTitle = chunk.sectionTitle
            entity.sourceLabel = chunk.sourceLabel
            entity.text = chunk.text
            entity.startOffset = Int32(chunk.startOffset)
            entity.endOffset = Int32(chunk.endOffset)
            entity.tagName = chunk.tagName
            entity.sortOrder = Int32(chunk.sortOrder)
            entity.filing = filing
        }
    }

    private func encodeSourceIds(_ sourceIds: [String]) -> String {
        let data = (try? JSONEncoder().encode(sourceIds)) ?? Data("[]".utf8)
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    private func encodeHistoricalOverview(_ overview: HistoricalOverviewPayload?) -> String? {
        guard let overview,
              let data = try? JSONEncoder().encode(overview) else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    private func decodeHistoricalOverview(from json: String?) -> HistoricalOverviewPayload? {
        guard let json,
              let data = json.data(using: .utf8),
              let overview = try? JSONDecoder().decode(HistoricalOverviewPayload.self, from: data) else {
            return nil
        }

        return overview
    }

    private func decodeSourceIds(_ sourceIdsJSON: String) -> [String] {
        guard let data = sourceIdsJSON.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data) else {
            return []
        }
        return ids
    }

    private func summaryItemPayload(from entity: SummaryItemEntity) -> SummaryLinePayload {
        SummaryLinePayload(text: entity.text, sourceIds: decodeSourceIds(entity.sourceIdsJSON))
    }

    private func metricPayload(from entity: FinancialMetricEntity) -> MetricPayload {
        MetricPayload(
            logicalName: entity.logicalName,
            tagUsed: entity.tagUsed,
            value: entity.value,
            unit: entity.unit,
            periodEnd: Self.dayString(from: entity.periodEnd),
            comparisonValue: entity.comparisonValue?.doubleValue,
            yoyPercent: entity.yoyPercent?.doubleValue
        )
    }

    private func sourceChunkPayload(from entity: SourceChunkEntity) -> SourceChunkPayload {
        SourceChunkPayload(
            sourceId: entity.sourceId,
            sectionType: entity.sectionType,
            sectionTitle: entity.sectionTitle,
            sourceLabel: entity.sourceLabel,
            text: entity.text,
            startOffset: Int(entity.startOffset),
            endOffset: Int(entity.endOffset),
            tagName: entity.tagName,
            sortOrder: Int(entity.sortOrder)
        )
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func parseDate(_ string: String) -> Date? {
        isoFormatter.date(from: string) ?? dayFormatter.date(from: string)
    }

    static func isoString(from date: Date) -> String {
        isoFormatter.string(from: date)
    }

    static func dayString(from date: Date) -> String {
        dayFormatter.string(from: date)
    }

    private static func detachedString(_ value: String) -> String {
        String(decoding: Array(value.utf8), as: UTF8.self)
    }
}
