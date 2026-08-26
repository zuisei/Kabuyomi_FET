import Foundation

// MarketDocket では `DemoData.swift` という1ファイルに、同梱の架空イベントを読む
// `DemoDataLoader` と、**再生ロジックと検索という中身そのもの**が同居していた。
// 移植したのは後者だけで、架空データを読む口は持ってきていない(2026-08-26)。

enum ReplayEngine {
    static func date(for milestone: ReplayMilestone, event: PolicyEvent) -> Date {
        switch milestone {
        case .beforePublication: event.anchorDate.addingTimeInterval(-60)
        case .officialPublication: event.publishedAt ?? event.detectedAt ?? event.anchorDate
        case .firstReport: event.timelineItems.first(where: { $0.kind == .mediaReport })?.occurredAt ?? event.anchorDate
        case .revision: event.revisedAt ?? event.anchorDate
        case .marketReaction: event.timelineItems.first(where: { $0.kind == .marketReaction })?.occurredAt ?? event.anchorDate
        }
    }

    static func availableMilestones(for event: PolicyEvent) -> [ReplayMilestone] {
        ReplayMilestone.allCases.filter {
            switch $0 {
            case .beforePublication: true
            case .officialPublication: event.publishedAt != nil || event.detectedAt != nil
            case .firstReport: event.timelineItems.contains { $0.kind == .mediaReport }
            case .revision: event.revisedAt != nil
            case .marketReaction: event.timelineItems.contains { $0.kind == .marketReaction }
            }
        }
    }

    static func snapshot(event: PolicyEvent, asOf: Date) -> ReplaySnapshot {
        let visible = event.timelineItems.filter { $0.occurredAt <= asOf }.sorted { $0.occurredAt < $1.occurredAt }
        let document = event.documentVersions.filter { $0.publishedAt <= asOf }.max { $0.version < $1.version }
        let documents = visibleDocuments(event.relatedDocuments, asOf: asOf)
        let points = event.marketSeries.filter { $0.timestamp <= asOf }.sorted { $0.timestamp < $1.timestamp }
        let confounders = event.confounders.filter { ($0.availableAt ?? $0.occurredAt) <= asOf }
        let corrections = event.correctionNotes.filter { ($0.availableAt ?? $0.occurredAt) <= asOf }
        let summaries = event.marketSummaries.filter { $0.availableAt <= asOf }
        let laterCount = event.timelineItems.filter { $0.occurredAt > asOf }.count
            + event.confounders.filter { ($0.availableAt ?? $0.occurredAt) > asOf }.count
            + event.correctionNotes.filter { ($0.availableAt ?? $0.occurredAt) > asOf }.count
        return ReplaySnapshot(
            asOf: asOf,
            visibleTimelineItems: visible,
            activeDocumentVersion: document,
            visibleDocuments: documents,
            visibleMarketPoints: points,
            visibleConfounders: confounders,
            visibleCorrections: corrections,
            availableMarketSummaries: summaries,
            unavailableLaterFactsCount: laterCount
        )
    }

    static func visibleDocuments(_ documents: [PolicyDocument], asOf: Date) -> [PolicyDocument] {
        documents.filter { $0.availableAt <= asOf }.sorted { $0.availableAt < $1.availableAt }
    }
}

enum PolicyEventSearch {
    private static let aliasGroups = [
        ["btc", "bitcoin", "ビットコイン"],
        ["eth", "ethereum", "イーサリアム"],
        ["ai", "artificial intelligence", "人工知能"],
        ["semiconductor", "semiconductors", "chip", "chips", "半導体"],
        ["sec", "securities and exchange commission", "証券取引委員会"],
        ["tariff", "tariffs", "関税"],
        ["sanction", "sanctions", "制裁"],
        ["inflation", "インフレ"],
        ["whitehouse", "white house", "ホワイトハウス"],
        ["federalregister", "federal register", "連邦官報"]
    ]

    private static let aliasLookup: [String: [String]] = {
        var result: [String: [String]] = [:]
        for group in aliasGroups {
            let values = Array(Set(group.map(normalize))).sorted()
            for value in values { result[value] = values }
        }
        return result
    }()

    static func normalize(_ value: String) -> String {
        value
            .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US"))
            .lowercased()
            .replacingOccurrences(of: #"[-_/]+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"[^\p{L}\p{N}.]+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func queryGroups(_ query: String) -> [[String]] {
        let normalized = normalize(query)
        guard !normalized.isEmpty else { return [] }
        if let aliases = aliasLookup[normalized] { return [aliases] }
        return normalized.split(separator: " ").map { term in
            aliasLookup[String(term)] ?? [String(term)]
        }
    }

    static func highlightTerms(for query: String) -> [String] {
        Array(Set(queryGroups(query).flatMap { $0 }))
            .filter { !$0.isEmpty }
            .sorted { $0.count > $1.count }
    }

    private static func matches(haystack: String, query: String) -> Bool {
        let searchable = normalize(haystack)
        return queryGroups(query).allSatisfy { group in
            group.contains { searchable.contains($0) }
        }
    }

    static func matches(_ event: PolicyEvent, query: String) -> Bool {
        let haystack = ([event.titleJA, event.titleEN, event.summaryJA, event.agency.code, event.agency.displayNameJA, event.agency.displayNameEN, event.documentInfo.documentNumber]
            + event.topics + event.tickers).joined(separator: " ")
        return matches(haystack: haystack, query: query)
    }
}

extension PolicyEventSearch {
    static func matches(_ event: PolicyEventSummary, query: String) -> Bool {
        let haystack = ([event.titleJA, event.titleEN, event.summaryJA, event.agency.code, event.agency.displayNameJA, event.agency.displayNameEN]
            + event.topics + event.tickers).joined(separator: " ")
        return matches(haystack: haystack, query: query)
    }

    static func score(_ event: PolicyEventSummary, query: String) -> Int {
        let normalized = normalize(query)
        guard !normalized.isEmpty else { return 0 }
        if event.tickers.contains(where: { normalize($0) == normalized }) { return 100 }
        if normalize(event.agency.code) == normalized { return 95 }
        if normalize(event.titleJA).hasPrefix(normalized) || normalize(event.titleEN).hasPrefix(normalized) { return 80 }
        if matches(haystack: event.titleJA + " " + event.titleEN, query: query) { return 70 }
        if matches(haystack: event.agency.displayNameJA + " " + event.agency.displayNameEN, query: query) { return 60 }
        if event.topics.contains(where: { matches(haystack: $0, query: query) }) { return 50 }
        if matches(haystack: event.summaryJA, query: query) { return 40 }
        return 10
    }

    static func matchReason(_ event: PolicyEventSummary, query: String) -> String? {
        let normalized = normalize(query)
        guard !normalized.isEmpty else { return nil }
        if let ticker = event.tickers.first(where: { normalize($0) == normalized }) { return "銘柄 \(ticker) に一致" }
        if normalize(event.agency.code) == normalized { return "機関 \(event.agency.code) に一致" }
        if matches(haystack: event.titleJA + " " + event.titleEN, query: query) { return "タイトルに一致" }
        if matches(haystack: event.agency.displayNameJA + " " + event.agency.displayNameEN, query: query) { return "機関名に一致" }
        if let topic = event.topics.first(where: { matches(haystack: $0, query: query) }) { return "テーマ「\(topic)」に一致" }
        if matches(haystack: event.summaryJA, query: query) { return "要約に一致" }
        return nil
    }
}
