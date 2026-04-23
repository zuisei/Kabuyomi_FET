import Foundation

enum SourceDocumentSearchMode: String, Equatable {
    case narrative
    case tabular
}

func sourceReference(from chunk: SourceChunkPayload, in company: CompanyPayload) -> LocalMessageSourceRef {
    let sourceLabel = chunk.sectionTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? chunk.sourceLabel
        : chunk.sectionTitle

    return LocalMessageSourceRef(
        id: UUID(),
        sourceIdSnapshot: chunk.sourceId,
        sourceKind: .secFiling,
        sourceLabelSnapshot: sourceLabel,
        excerpt: chunk.text,
        sourceUrl: company.primaryDocumentUrl
    )
}

func primarySourceReference(sourceIds: [String], in company: CompanyPayload) -> LocalMessageSourceRef? {
    sourceIds.lazy
        .compactMap { sourceId in
            company.sourceChunks.first(where: { $0.sourceId == sourceId })
        }
        .map { sourceReference(from: $0, in: company) }
        .first
}

func investorFacingSourceLabel(for chunk: SourceChunkPayload, in company: CompanyPayload) -> String {
    if chunk.sectionType == "xbrl_metric" {
        if let tagName = chunk.tagName,
           let metric = company.metrics.first(where: { $0.tagUsed == tagName }) {
            return "\(MetricLabeler.title(for: metric.logicalName))（XBRL）"
        }
        return "主要指標（XBRL）"
    }

    let raw = chunk.sectionTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? chunk.sourceLabel : chunk.sectionTitle
    return investorFacingSourceLabel(rawLabel: raw, in: company)
}

func investorFacingSourceLabel(rawLabel: String, in company: CompanyPayload) -> String {
    let raw = rawLabel
        .replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    guard !raw.isEmpty else { return "提出資料" }

    let lowered = raw.lowercased()
    if lowered.range(of: #"^[a-z]?\d+$"#, options: .regularExpression) != nil {
        return "提出資料"
    }

    if lowered.contains("management's discussion") || lowered.contains("results of operations") || lowered.contains("md&a") {
        return "\(company.formType) MD&A"
    }

    if lowered.contains("risk factors") || lowered.contains("risk") {
        return "\(company.formType) リスク要因"
    }

    if let range = raw.range(of: #"Part\s+[IVXLC]+\s+Item\s+\d+[A-Za-z]?"#, options: .regularExpression) {
        return "\(company.formType) \(translatedItemLabel(from: String(raw[range])))"
    }

    if let range = raw.range(of: #"Item\s+\d+[A-Za-z]?"#, options: .regularExpression) {
        return "\(company.formType) \(translatedItemLabel(from: String(raw[range])))"
    }

    if lowered.contains("xbrl") {
        return "主要指標（XBRL）"
    }

    if let historicalMatch = raw.range(
        of: #"(10-[KQ])\s+filed\s+(\d{4}-\d{2}-\d{2})(?:\s+·\s+period\s+(\d{4}-\d{2}-\d{2}))?"#,
        options: .regularExpression
    ) {
        let label = String(raw[historicalMatch])
        let components = label.components(separatedBy: " · period ")
        let filed = components[0]
            .replacingOccurrences(of: " filed ", with: " 提出日 ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if components.count > 1 {
            return "\(filed) / 期末 \(components[1])"
        }
        return filed
    }

    if let range = raw.range(of: #"\d{4}-\d{2}-\d{2}"#, options: .regularExpression), raw.count <= 24 {
        return "提出日 \(String(raw[range]))"
    }

    if raw.count > 24 {
        let endIndex = raw.index(raw.startIndex, offsetBy: 24)
        return String(raw[..<endIndex]) + "…"
    }

    return raw
}

func matchedSourceChunk(for source: LocalMessageSourceRef, in company: CompanyPayload) -> SourceChunkPayload? {
    if let sourceId = source.sourceIdSnapshot,
       let chunk = company.sourceChunks.first(where: { $0.sourceId == sourceId }) {
        return chunk
    }

    if let chunk = company.sourceChunks.first(where: {
        $0.sourceLabel == source.sourceLabelSnapshot || $0.sectionTitle == source.sourceLabelSnapshot
    }) {
        return chunk
    }

    let excerpt = source.excerpt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !excerpt.isEmpty else { return nil }

    return company.sourceChunks.first(where: { chunk in
        chunk.text.localizedCaseInsensitiveContains(excerpt)
            || excerpt.localizedCaseInsensitiveContains(chunk.text.prefix(120))
    })
}

func investorFacingSourceLabel(for source: LocalMessageSourceRef, in company: CompanyPayload) -> String {
    if let matchedChunk = matchedSourceChunk(for: source, in: company) {
        return investorFacingSourceLabel(for: matchedChunk, in: company)
    }

    return investorFacingSourceLabel(rawLabel: source.sourceLabelSnapshot, in: company)
}

func resolvedSourceURL(for source: LocalMessageSourceRef, in company: CompanyPayload) -> URL? {
    let fallbackURL: String?
    switch source.sourceKind {
    case .secFiling:
        fallbackURL = company.primaryDocumentUrl
    case .historicalFiling, .webSupplement:
        fallbackURL = nil
    }

    guard let candidate = source.sourceUrl ?? fallbackURL,
          let url = URL(string: candidate) else {
        return nil
    }

    return url
}

func sourceDocumentSearchMode(for source: LocalMessageSourceRef, in company: CompanyPayload) -> SourceDocumentSearchMode {
    guard let matchedChunk = matchedSourceChunk(for: source, in: company) else {
        return .narrative
    }

    return matchedChunk.sectionType == "xbrl_metric" ? .tabular : .narrative
}

func sourceDocumentSearchTerms(for source: LocalMessageSourceRef, in company: CompanyPayload) -> [String] {
    let matchedChunk = matchedSourceChunk(for: source, in: company)
    if let matchedChunk, matchedChunk.sectionType == "xbrl_metric" {
        return xbrlSearchTerms(for: matchedChunk, source: source, in: company)
    }

    let candidates: [String?] =
        searchSnippets(from: matchedChunk?.text).map(Optional.some)
        + searchSnippets(from: source.excerpt).map(Optional.some)
        + [
            matchedChunk?.sectionTitle,
            matchedChunk?.sourceLabel,
            source.sourceLabelSnapshot,
            matchedChunk?.tagName
        ]

    var deduped: [String] = []
    var seen = Set<String>()

    for candidate in candidates {
        guard let candidate else { continue }
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 3 else { continue }

        let key = trimmed.lowercased()
        if seen.insert(key).inserted {
            deduped.append(trimmed)
        }
    }

    return deduped
}

func sourceDocumentManualHint(for source: LocalMessageSourceRef, in company: CompanyPayload) -> String? {
    sourceDocumentSearchTerms(for: source, in: company).first
}

private func searchSnippets(from text: String?) -> [String] {
    guard let text else { return [] }

    let trimmed = text
        .replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: "\t", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    guard !trimmed.isEmpty else { return [] }

    if trimmed.count <= 140 {
        return [trimmed]
    }

    var snippets: [String] = []
    let maxLength = 160
    let step = 120
    var startIndex = trimmed.startIndex

    while startIndex < trimmed.endIndex && snippets.count < 2 {
        let endIndex = trimmed.index(startIndex, offsetBy: maxLength, limitedBy: trimmed.endIndex) ?? trimmed.endIndex
        let snippet = String(trimmed[startIndex..<endIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        if snippet.count >= 24 {
            snippets.append(snippet)
        }

        guard endIndex < trimmed.endIndex else { break }
        startIndex = trimmed.index(startIndex, offsetBy: step, limitedBy: trimmed.endIndex) ?? trimmed.endIndex
    }

    return snippets
}

private func xbrlSearchTerms(for chunk: SourceChunkPayload, source: LocalMessageSourceRef, in company: CompanyPayload) -> [String] {
    let metric = chunk.tagName.flatMap { tagName in
        company.metrics.first(where: { $0.tagUsed == tagName })
    }

    let candidates: [String?] =
        metricSearchAnchors(for: metric)
        + filingTableAnchors(for: metric)
        + [
            humanizedXBRLTagName(chunk.tagName),
            cleanedXBRLLabel(chunk.sectionTitle),
            cleanedXBRLLabel(chunk.sourceLabel),
            humanizedXBRLTagName(source.sourceLabelSnapshot),
            numericSearchTerms(for: metric?.value).first,
            numericSearchTerms(for: metric?.comparisonValue).first
        ]

    var deduped: [String] = []
    var seen = Set<String>()

    for candidate in candidates {
        guard let candidate else { continue }
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 3 else { continue }

        let key = trimmed.lowercased()
        if seen.insert(key).inserted {
            deduped.append(trimmed)
        }
    }

    return deduped
}

private func metricSearchAnchors(for metric: MetricPayload?) -> [String?] {
    guard let metric else { return [] }

    switch metric.logicalName {
    case "revenue":
        return ["net sales", "revenue", "total net sales"]
    case "operatingIncome":
        if metric.value < 0 {
            return ["loss from operations", "operating loss", "income (loss) from operations", "operating income (loss)"]
        }
        return ["income from operations", "operating income", "operating income (loss)"]
    case "netIncome":
        if metric.value < 0 {
            return ["net loss", "net income (loss)", "net earnings (loss)"]
        }
        return ["net income", "net earnings", "net income (loss)"]
    case "operatingCashFlow":
        if metric.value < 0 {
            return ["net cash used in operating activities", "cash used in operating activities", "operating cash flow"]
        }
        return ["net cash provided by operating activities", "cash generated by operating activities", "operating cash flow"]
    case "epsBasic":
        if metric.value < 0 {
            return ["basic net loss per share", "net loss per share", "basic earnings per share"]
        }
        return ["basic earnings per share", "earnings per share", "basic net income per share"]
    default:
        return [humanizedXBRLTagName(metric.tagUsed)]
    }
}

private func filingTableAnchors(for metric: MetricPayload?) -> [String?] {
    guard let metric else { return [] }

    switch metric.logicalName {
    case "revenue", "operatingIncome", "netIncome", "epsBasic":
        return ["statements of operations", "consolidated statements of operations"]
    case "operatingCashFlow":
        return ["statements of cash flows", "consolidated statements of cash flows"]
    default:
        return []
    }
}

private func numericSearchTerms(for value: Double?) -> [String] {
    guard let value else { return [] }

    let rounded = value.rounded()
    guard rounded.isFinite else { return [] }

    let absoluteFormatter = NumberFormatter()
    absoluteFormatter.numberStyle = .decimal
    absoluteFormatter.maximumFractionDigits = 0
    absoluteFormatter.locale = Locale(identifier: "en_US")
    absoluteFormatter.usesGroupingSeparator = true

    let groupedAbsolute = absoluteFormatter.string(from: NSNumber(value: abs(rounded))) ?? ""
    let groupedSigned = absoluteFormatter.string(from: NSNumber(value: rounded)) ?? ""

    var terms = [groupedSigned, groupedAbsolute]
    if rounded < 0 {
        terms.append("(\(groupedAbsolute))")
    }
    return terms.filter { !$0.isEmpty }
}

private func cleanedXBRLLabel(_ raw: String?) -> String? {
    guard let raw else { return nil }
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    if trimmed.localizedCaseInsensitiveContains("xbrl") {
        if let tag = trimmed.split(separator: "(").last?.replacingOccurrences(of: ")", with: "") {
            return humanizedXBRLTagName(String(tag))
        }
    }

    return humanizedXBRLTagName(trimmed) ?? trimmed
}

private func humanizedXBRLTagName(_ raw: String?) -> String? {
    guard let raw else { return nil }

    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    let withSpaces = trimmed.replacingOccurrences(
        of: #"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])"#,
        with: " ",
        options: .regularExpression
    )

    let normalized = withSpaces.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)

    return normalized.isEmpty ? nil : normalized
}

private func translatedItemLabel(from raw: String) -> String {
    guard let match = raw.range(of: #"Item\s+\d+[A-Za-z]?"#, options: .regularExpression) else {
        return raw
    }

    return String(raw[match])
        .replacingOccurrences(of: "Item", with: "項目")
        .replacingOccurrences(of: "  ", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}
