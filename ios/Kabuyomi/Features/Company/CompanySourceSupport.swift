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
            return MetricLabeler.title(for: metric.logicalName)
        }
        return "主要指標"
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

    if lowered.contains("revenue") || lowered.contains("net sales") {
        return "売上高"
    }

    if lowered.contains("operating income") || lowered.contains("operating margin") {
        return "営業利益"
    }

    if lowered.contains("net income") || lowered.contains("earnings") {
        return "純利益"
    }

    if lowered.contains("margin") || lowered.contains("profitability") || lowered.contains("gross profit") {
        return "利益率"
    }

    if lowered.contains("cash flow") || lowered.contains("liquidity") {
        return "キャッシュフロー"
    }

    if lowered.contains("segment") {
        return "セグメント"
    }

    if let range = raw.range(of: #"Part\s+[IVXLC]+\s+Item\s+\d+[A-Za-z]?"#, options: .regularExpression) {
        return "\(company.formType) \(translatedItemLabel(from: String(raw[range])))"
    }

    if let range = raw.range(of: #"Item\s+\d+[A-Za-z]?"#, options: .regularExpression) {
        return "\(company.formType) \(translatedItemLabel(from: String(raw[range])))"
    }

    if lowered.contains("xbrl") {
        return "主要指標"
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
        return japaneseFacingLabel(String(raw[..<endIndex]) + "…")
    }

    return japaneseFacingLabel(raw)
}

/// 訳語に当たらなかった英語の見出しをそのまま出さないための歯止め。
/// 個別のキーワードを足し続けても SEC の節見出しは網羅できないので、
/// 日本語をひとつも含まないラベルは総称に落とす
/// (「Margin and profitability…」のような英語の断片が画面に出ていた)。
/// 副題も同じ扱いにする。タイトルが「利益率」になっていても
/// その下に "Margin and profitability discussion" が残っていては意味がない。
/// 日本語を含まない副題は情報より雑音なので出さない。
func japaneseFacingSubtitle(_ subtitle: String, matching label: String) -> String? {
    let trimmed = subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed != label else { return nil }
    return containsJapanese(trimmed) ? trimmed : nil
}

private func containsJapanese(_ text: String) -> Bool {
    text.unicodeScalars.contains { scalar in
        (0x3040...0x30FF).contains(scalar.value)
            || (0x4E00...0x9FFF).contains(scalar.value)
    }
}

private func japaneseFacingLabel(_ label: String) -> String {
    containsJapanese(label) ? label : "提出資料の記述"
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
    let relativeBaseURL: String?
    let allowsBareDomain: Bool
    switch source.sourceKind {
    case .secFiling:
        fallbackURL = company.primaryDocumentUrl
        relativeBaseURL = company.primaryDocumentUrl
        allowsBareDomain = false
    case .historicalFiling, .webSupplement:
        fallbackURL = nil
        relativeBaseURL = nil
        allowsBareDomain = source.sourceKind == .webSupplement
    }

    return resolvedExternalHTTPURL(
        from: source.sourceUrl ?? fallbackURL,
        relativeTo: relativeBaseURL,
        allowBareDomain: allowsBareDomain
    )
}

func resolvedExternalHTTPURL(
    from rawValue: String?,
    relativeTo baseValue: String? = nil,
    allowBareDomain: Bool = true
) -> URL? {
    guard let trimmed = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty else {
        return nil
    }

    if let url = URL(string: trimmed),
       isOpenableHTTPURL(url) {
        return url
    }

    if allowBareDomain,
       looksLikeBareDomain(trimmed),
       let url = URL(string: "https://\(trimmed)"),
       isOpenableHTTPURL(url) {
        return url
    }

    if let baseValue,
       let baseURL = URL(string: baseValue),
       isOpenableHTTPURL(baseURL),
       let url = URL(string: trimmed, relativeTo: baseURL)?.absoluteURL,
       isOpenableHTTPURL(url) {
        return url
    }

    return nil
}

private func isOpenableHTTPURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https",
          let host = url.host?.lowercased(),
          host.contains("."),
          !host.hasSuffix(".htm"),
          !host.hasSuffix(".html") else {
        return false
    }

    return true
}

private func looksLikeBareDomain(_ value: String) -> Bool {
    let lowered = value.lowercased()
    guard !lowered.contains("://"),
          !lowered.hasPrefix("/"),
          !lowered.hasPrefix("."),
          !lowered.contains(" "),
          !looksLikeBareHTMLFilename(lowered) else {
        return false
    }

    return lowered.range(
        of: #"^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/:?#].*)?$"#,
        options: .regularExpression
    ) != nil
}

private func looksLikeBareHTMLFilename(_ value: String) -> Bool {
    value.range(
        of: #"^[a-z0-9_-]+\.html?(?:[?#].*)?$"#,
        options: .regularExpression
    ) != nil
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

    let sourceText = [matchedChunk?.text, source.excerpt, source.sourceLabelSnapshot]
        .compactMap { $0 }
        .joined(separator: " ")
    let candidates: [String?] =
        searchSnippets(from: matchedChunk?.text).map(Optional.some)
        + searchSnippets(from: source.excerpt).map(Optional.some)
        + inferredEnglishSearchAnchors(from: sourceText).map(Optional.some)
        + inferredNumericSearchAnchors(from: sourceText).map(Optional.some)
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

        if deduped.count >= 8 {
            break
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

    if trimmed.count <= 96 {
        return [trimmed]
    }

    var snippets: [String] = []
    let maxLength = 96
    var startIndex = trimmed.startIndex

    while startIndex < trimmed.endIndex && snippets.count < 1 {
        let endIndex = trimmed.index(startIndex, offsetBy: maxLength, limitedBy: trimmed.endIndex) ?? trimmed.endIndex
        let snippet = String(trimmed[startIndex..<endIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        if snippet.count >= 24 {
            snippets.append(snippet)
        }

        guard endIndex < trimmed.endIndex else { break }
        startIndex = endIndex
    }

    return snippets
}

private func inferredEnglishSearchAnchors(from text: String) -> [String] {
    let lowered = text.lowercased()
    var anchors: [String] = []

    if lowered.contains("売上") || lowered.contains("revenue") || lowered.contains("sales") {
        anchors += ["net sales", "revenue", "total net sales"]
    }
    if lowered.contains("営業利益") || lowered.contains("operating income") || lowered.contains("operations") {
        anchors += ["income from operations", "operating income", "operating income (loss)"]
    }
    if lowered.contains("純利益") || lowered.contains("net income") || lowered.contains("net earnings") {
        anchors += ["net income", "net earnings", "net income (loss)"]
    }
    if lowered.contains("キャッシュ") || lowered.contains("cash flow") || lowered.contains("operating activities") {
        anchors += ["net cash provided by operating activities", "statements of cash flows"]
    }
    if lowered.contains("eps") || lowered.contains("1株") || lowered.contains("per share") {
        anchors += ["earnings per share", "basic earnings per share"]
    }

    return anchors
}

private func inferredNumericSearchAnchors(from text: String) -> [String] {
    let pattern = #"[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|[-+]?\d+(?:\.\d+)?"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }

    let nsText = text as NSString
    let matches = regex.matches(
        in: text,
        range: NSRange(location: 0, length: nsText.length)
    )
    guard !matches.isEmpty else { return [] }

    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = 0
    formatter.locale = Locale(identifier: "en_US")
    formatter.usesGroupingSeparator = true

    var anchors: [String] = []
    let containsOkuDollars = text.contains("億ドル")

    for match in matches.prefix(4) {
        let raw = nsText.substring(with: match.range)
        let normalized = raw.replacingOccurrences(of: ",", with: "")
        guard let value = Double(normalized), value.isFinite else { continue }

        anchors.append(raw)

        if containsOkuDollars {
            let millions = (value * 100).rounded()
            if let grouped = formatter.string(from: NSNumber(value: millions)) {
                anchors.append(grouped)
            }
        }
    }

    return anchors
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

// MARK: - 根拠チップの識別性
//
// 監査(2026-08-22)で「利益率」が3つ並び、どれを開いても分からない状態になっていた。
// `investorFacingSourceLabel` はキーワードで総称に畳むので、別の抜粋が同じラベルに
// 落ちるのは仕様上避けられない。ラベルに
//   セクション種別バッジ + 決定論的な抜粋の先頭断片
// を添えて、開く前に1つずつ見分けられるようにする。

/// 根拠チップに添えるセクション種別バッジ。
/// `sectionType` は Worker 側の閉じた集合(`md_a` / `xbrl_metric` /
/// `historical_metric` / `historical_segment` / `web_search`)。
func sourceSectionBadge(sectionType: String, sectionTitle: String = "", sourceLabel: String = "") -> String {
    switch sectionType {
    case "xbrl_metric":
        return "XBRL"
    case "historical_metric":
        return "履歴"
    case "historical_segment":
        return "セグメント"
    case "web_search":
        return "WEB"
    default:
        break
    }

    let raw = (sectionTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? sourceLabel : sectionTitle)
        .lowercased()
    if raw.contains("risk") || raw.contains("リスク") { return "リスク" }
    if raw.contains("management's discussion")
        || raw.contains("results of operations")
        || raw.contains("md&a")
        || raw.contains("mda") { return "MD&A" }
    if raw.contains("segment") || raw.contains("セグメント") { return "セグメント" }
    if raw.contains("cash flow") || raw.contains("liquidity") { return "CF" }
    return "本文"
}

func sourceSectionBadge(for chunk: SourceChunkPayload) -> String {
    sourceSectionBadge(
        sectionType: chunk.sectionType,
        sectionTitle: chunk.sectionTitle,
        sourceLabel: chunk.sourceLabel
    )
}

func sourceSectionBadge(for source: LocalMessageSourceRef, in company: CompanyPayload) -> String {
    if let chunk = matchedSourceChunk(for: source, in: company) {
        return sourceSectionBadge(for: chunk)
    }
    switch source.sourceKind {
    case .secFiling:
        return sourceSectionBadge(sectionType: "md_a", sourceLabel: source.sourceLabelSnapshot)
    case .historicalFiling:
        return "履歴"
    case .webSupplement:
        return "WEB"
    }
}

/// 1行に収まる長さの、決定論的な抜粋の先頭断片。
/// 同じ入力からは常に同じ断片が出る(要約でも AI 呼び出しでもない)。
/// ラベルと同じ文字列にしかならないときは `nil` を返し、呼び出し側で別の手掛かりに逃がす。
func sourceFragmentText(text: String, sectionTitle: String, label: String, limit: Int = 72) -> String? {
    let preview = sourceListPreviewText(text: text, sectionTitle: sectionTitle, fallback: "", limit: limit)
    let trimmed = preview.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    guard trimmed.caseInsensitiveCompare(label) != .orderedSame else { return nil }
    return trimmed
}

/// 根拠チップ1つ分の表示内容。ラベルが衝突した組にだけ `ordinal` が入る。
struct SourceChipDescriptor: Identifiable, Hashable {
    let key: String
    let label: String
    let badge: String
    let fragment: String?
    let ordinal: Int?
    let source: LocalMessageSourceRef?

    var id: String { key }

    /// VoiceOver 用。色や配置に頼らず、行の区別がそのまま読み上げられるようにする。
    var accessibilityText: String {
        var parts = [label, badge]
        if let ordinal { parts.append("抜粋\(ordinal)") }
        if let fragment { parts.append(fragment) }
        return parts.joined(separator: "、")
    }
}

private func assignedOrdinals(_ descriptors: [SourceChipDescriptor]) -> [SourceChipDescriptor] {
    // ラベル・バッジ・断片まで同じ行が残ったときだけ通し番号を振る。
    // 断片で区別できている行に番号を足すとノイズにしかならない。
    var collisionCounts: [String: Int] = [:]
    for descriptor in descriptors {
        let signature = "\(descriptor.label)|\(descriptor.badge)|\(descriptor.fragment ?? "")"
        collisionCounts[signature, default: 0] += 1
    }

    var running: [String: Int] = [:]
    return descriptors.map { descriptor in
        let signature = "\(descriptor.label)|\(descriptor.badge)|\(descriptor.fragment ?? "")"
        guard (collisionCounts[signature] ?? 0) > 1 else { return descriptor }
        let index = (running[signature] ?? 0) + 1
        running[signature] = index
        return SourceChipDescriptor(
            key: descriptor.key,
            label: descriptor.label,
            badge: descriptor.badge,
            fragment: descriptor.fragment,
            ordinal: index,
            source: descriptor.source
        )
    }
}

func sourceChipDescriptors(
    for chunks: [SourceChunkPayload],
    in company: CompanyPayload,
    fragmentLimit: Int = 72
) -> [SourceChipDescriptor] {
    var seen = Set<String>()
    let base = chunks.compactMap { chunk -> SourceChipDescriptor? in
        guard seen.insert(chunk.sourceId).inserted else { return nil }
        let label = investorFacingSourceLabel(for: chunk, in: company)
        return SourceChipDescriptor(
            key: chunk.sourceId,
            label: label,
            badge: sourceSectionBadge(for: chunk),
            fragment: sourceFragmentText(
                text: chunk.text,
                sectionTitle: chunk.sectionTitle,
                label: label,
                limit: fragmentLimit
            ),
            ordinal: nil,
            source: sourceReference(from: chunk, in: company)
        )
    }
    return assignedOrdinals(base)
}

func sourceChipDescriptors(
    for sources: [LocalMessageSourceRef],
    in company: CompanyPayload,
    fragmentLimit: Int = 72
) -> [SourceChipDescriptor] {
    let base = sources.map { source -> SourceChipDescriptor in
        let label = investorFacingSourceLabel(for: source, in: company)
        let chunk = matchedSourceChunk(for: source, in: company)
        let excerpt = source.excerpt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? (chunk?.text ?? "")
            : source.excerpt
        return SourceChipDescriptor(
            key: source.id.uuidString,
            label: label,
            badge: sourceSectionBadge(for: source, in: company),
            fragment: sourceFragmentText(
                text: excerpt,
                sectionTitle: chunk?.sectionTitle ?? "",
                label: label,
                limit: fragmentLimit
            ),
            ordinal: nil,
            source: source
        )
    }
    return assignedOrdinals(base)
}
