import SwiftUI

func restoreDraftAfterConsentDismissal(currentDraft: String, pendingSubmission: String?) -> String? {
    guard let pendingSubmission else { return nil }
    guard currentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    let trimmedPending = pendingSubmission.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedPending.isEmpty ? nil : trimmedPending
}

func shouldOfferPreviewTranslation(for text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }
    return trimmed.range(of: #"[ぁ-んァ-ヶ一-龠]"#, options: .regularExpression) == nil
}

func fallbackPreviewTranslation(for text: String) -> String? {
    let localized = localizedAssistantDisplayText(text).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !localized.isEmpty else { return nil }
    guard localized != text.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
    guard localized.range(of: #"[ぁ-んァ-ヶ一-龠]"#, options: .regularExpression) != nil else { return nil }
    return localized
}

func normalizedSourcePreviewText(_ text: String, limit: Int = 520) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "" }

    var normalized = ""
    normalized.reserveCapacity(trimmed.count + 16)
    var previousVisibleScalar: UnicodeScalar?
    var scalarBeforePreviousVisible: UnicodeScalar?
    var consecutiveLowercaseCount = 0
    var lastWasWhitespace = false

    for scalar in trimmed.unicodeScalars {
        if CharacterSet.whitespacesAndNewlines.contains(scalar) {
            if !lastWasWhitespace, !normalized.isEmpty { normalized.append(" ") }
            consecutiveLowercaseCount = 0
            lastWasWhitespace = true
            continue
        }
        if let previousVisibleScalar,
           shouldInsertPreviewSeparator(
               after: previousVisibleScalar,
               before: scalar,
               priorVisible: scalarBeforePreviousVisible,
               consecutiveLowercaseCount: consecutiveLowercaseCount
           ), !normalized.hasSuffix(" ") {
            normalized.append(" ")
        }
        normalized.unicodeScalars.append(scalar)
        scalarBeforePreviousVisible = previousVisibleScalar
        previousVisibleScalar = scalar
        consecutiveLowercaseCount = isASCIILowercase(scalar) ? consecutiveLowercaseCount + 1 : 0
        lastWasWhitespace = false
    }

    normalized = normalized.trimmingCharacters(in: .whitespacesAndNewlines)
    guard normalized.count > limit else { return normalized }
    let prefix = String(normalized.prefix(limit))
    let boundary = prefix.range(of: ". ", options: .backwards)
        ?? prefix.range(of: "; ", options: .backwards)
        ?? prefix.range(of: ", ", options: .backwards)
    let clipped = boundary.map { String(prefix[..<$0.lowerBound]) } ?? prefix
    return clipped.trimmingCharacters(in: .whitespacesAndNewlines) + "…"
}

func sourceListPreviewText(
    text: String,
    sectionTitle: String,
    fallback: String,
    limit: Int = 180
) -> String {
    let preview = normalizedSourcePreviewText(text, limit: limit)
    guard !preview.isEmpty else { return fallback }

    let section = normalizedSourcePreviewText(sectionTitle, limit: limit)
    guard !section.isEmpty,
          preview.localizedCaseInsensitiveContains(section),
          let range = preview.range(of: section, options: [.caseInsensitive, .anchored]) else {
        return preview
    }

    var remainder = String(preview[range.upperBound...])
        .trimmingCharacters(in: .whitespacesAndNewlines)
    while let first = remainder.unicodeScalars.first,
          CharacterSet.punctuationCharacters.contains(first) {
        remainder.removeFirst()
        remainder = remainder.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return remainder.count >= 24 ? remainder : preview
}

private func shouldInsertPreviewSeparator(
    after previous: UnicodeScalar,
    before current: UnicodeScalar,
    priorVisible: UnicodeScalar?,
    consecutiveLowercaseCount: Int
) -> Bool {
    if isASCIILowercase(previous) && isASCIIUppercase(current) && consecutiveLowercaseCount >= 2 { return true }
    if isASCIIDigit(previous) && isASCIIUppercase(current) { return true }
    if isSentencePunctuation(previous),
       let priorVisible,
       (isASCIILowercase(priorVisible) || isASCIIDigit(priorVisible)),
       isASCIIUppercase(current) { return true }
    return false
}

private func isASCIILowercase(_ scalar: UnicodeScalar) -> Bool { (97...122).contains(scalar.value) }
private func isASCIIUppercase(_ scalar: UnicodeScalar) -> Bool { (65...90).contains(scalar.value) }
private func isASCIIDigit(_ scalar: UnicodeScalar) -> Bool { (48...57).contains(scalar.value) }
private func isSentencePunctuation(_ scalar: UnicodeScalar) -> Bool { scalar == "." || scalar == "!" || scalar == "?" }

func buildSuggestedQuestions(for company: CompanyPayload) -> [String] {
    var suggestions = ["今回の最大変化は？"]
    if let revenue = company.metrics.first(where: { $0.logicalName == "revenue" }),
       let yoy = revenue.yoyPercent {
        suggestions.append(yoy >= 0 ? "売上を伸ばした要因は？" : "売上が弱かった要因は？")
    } else if let question = buildFeaturedMetricQuestion(for: company) {
        suggestions.append(question)
    }
    if let operatingIncome = company.metrics.first(where: { $0.logicalName == "operatingIncome" }),
       let yoy = operatingIncome.yoyPercent {
        suggestions.append(yoy >= 0 ? "利益率は改善？" : "利益率が悪化した理由は？")
    }
    if let question = buildManagementQuestion(for: company) { suggestions.append(question) }
    if let lead = buildFocusInsights(for: company).first {
        suggestions.append("「\(questionSnippet(from: lead.text))」はどう読むといい？")
    }
    if suggestions.count < 4 {
        suggestions.append(buildHistoricalQuestions(for: company).first ?? "前回決算との違いは？")
    }
    return deduplicated(suggestions).prefix(4).map(\.self)
}

func buildHistoricalQuestions(for company: CompanyPayload) -> [String] {
    let isQuarterly = company.formType == "10-Q"
    let hasOperatingIncome = company.metrics.contains { $0.logicalName == "operatingIncome" && $0.yoyPercent != nil }
    if isQuarterly {
        let marginQuestion = hasOperatingIncome ? "営業利益率の3年推移は？" : "利益率の3年推移は？"
        return deduplicated(["前回四半期との差は？", marginQuestion, "売上要因の3年変化は？", "同四半期で見ると？"])
            .prefix(4).map(\.self)
    }
    var suggestions = ["前回決算との違いは？", "この3年の利益率推移は？", "この3年で売上ドライバーはどう変わった？", "この3年の年次比較で見ると？"]
    if hasOperatingIncome { suggestions.insert("この3年の営業利益率推移は？", at: 2) }
    return deduplicated(suggestions).prefix(4).map(\.self)
}

func buildRecoveryQuestions(for company: CompanyPayload, precedingUserPrompt: String? = nil) -> [String] {
    if let precedingUserPrompt, isComparisonQuestionText(precedingUserPrompt) {
        return Array(buildHistoricalQuestions(for: company).prefix(3))
    }
    var suggestions: [String] = []
    if let revenue = company.metrics.first(where: { $0.logicalName == "revenue" }), let yoy = revenue.yoyPercent {
        suggestions.append(yoy >= 0 ? "売上成長の要因は？" : "売上が弱かった要因は？")
    }
    if let operatingIncome = company.metrics.first(where: { $0.logicalName == "operatingIncome" }), let yoy = operatingIncome.yoyPercent {
        suggestions.append(yoy >= 0 ? "利益率は改善？" : "利益率が悪化した理由は？")
    }
    if let question = buildManagementQuestion(for: company) { suggestions.append(question) }
    if let lead = buildFocusInsights(for: company).first {
        suggestions.append("「\(questionSnippet(from: lead.text))」をかみ砕くと？")
    }
    if suggestions.count < 3 { suggestions.append("前回決算との違いは？") }
    return deduplicated(suggestions).prefix(3).map(\.self)
}

func buildFollowUpQuestions(for company: CompanyPayload, precedingUserPrompt: String? = nil) -> [String] {
    if let precedingUserPrompt, isPeerComparisonQuestionText(precedingUserPrompt) {
        return Array(buildHistoricalQuestions(for: company).prefix(3))
    }
    let normalized = precedingUserPrompt?.lowercased() ?? ""
    let isQuarterly = company.formType == "10-Q"
    var suggestions: [String] = []
    if let precedingUserPrompt, isHistoricalQuestionText(precedingUserPrompt) {
        suggestions.append(isQuarterly ? "どの四半期が一番強かった？" : "どの年が一番強かった？")
        suggestions.append("今回だけ特に強い / 弱い要因は？")
    }
    if containsAny(normalized, patterns: ["売上", "revenue", "成長", "growth", "driver", "ドライバー"]) {
        suggestions.append("その要因は一時的？")
        suggestions.append(isQuarterly ? "前回四半期と比べると？" : "前回決算と比べると？")
    }
    if containsAny(normalized, patterns: ["利益率", "margin", "profit", "採算", "営業利益"]) {
        suggestions.append("どの費用項目が効いた？")
        suggestions.append(isQuarterly ? "3年でも改善傾向？" : "この3年でも改善している？")
    }
    if containsAny(normalized, patterns: ["見通し", "guidance", "慎重", "risk", "リスク", "需要", "demand"]) {
        suggestions.append("次の四半期で何を見ればいい？")
        suggestions.append("経営陣は何を慎重視している？")
    }
    if suggestions.isEmpty {
        suggestions.append(contentsOf: buildRecoveryQuestions(for: company, precedingUserPrompt: precedingUserPrompt))
    } else {
        suggestions.append(contentsOf: buildSuggestedQuestions(for: company))
        suggestions.append(contentsOf: buildHistoricalQuestions(for: company).prefix(2))
    }
    return deduplicated(suggestions).filter { $0 != precedingUserPrompt }.prefix(3).map(\.self)
}

private func buildManagementQuestion(for company: CompanyPayload) -> String? {
    let texts = company.summary.highlights.map(\.text) + company.summary.changes.map(\.text)
    let keywords = ["慎重", "需要", "見通し", "ガイダンス", "在庫", "価格", "マクロ", "soft", "demand", "guidance", "inventory", "pricing", "macro"]
    if texts.contains(where: { text in keywords.contains(where: { text.lowercased().contains($0.lowercased()) }) }) {
        return "経営陣は何を慎重視している？"
    }
    return buildFocusInsights(for: company).isEmpty ? nil : "経営陣が強調している論点は？"
}

private func buildFeaturedMetricQuestion(for company: CompanyPayload) -> String? {
    for logicalName in ["revenue", "operatingIncome", "netIncome", "epsBasic", "operatingCashFlow"] {
        if let metric = company.metrics.first(where: { $0.logicalName == logicalName && $0.yoyPercent != nil }) {
            return "\(MetricLabeler.title(for: metric.logicalName))の変化を詳しく教えて"
        }
    }
    guard let metric = company.metrics.first(where: { $0.yoyPercent != nil }) else { return nil }
    return "\(MetricLabeler.title(for: metric.logicalName))の変化を詳しく教えて"
}

private func questionSnippet(from text: String) -> String {
    let cleaned = text.replacingOccurrences(of: "。", with: "").replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard cleaned.count > 26 else { return cleaned }
    return String(cleaned.prefix(26)) + "…"
}

private func deduplicated(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.filter { seen.insert($0).inserted }
}

func isHistoricalQuestionText(_ text: String) -> Bool {
    containsAny(text.lowercased(), patterns: ["前回", "前年", "昨年", "推移", "3年", "三年", "同四半期", "trend", "history", "historical"])
}

private func containsAny(_ text: String, patterns: [String]) -> Bool {
    patterns.contains { text.contains($0.lowercased()) }
}

enum ConversationLibraryRecentSectionState: Equatable {
    case empty
    case populated

    init(recentCompanies: [WatchlistCard]) {
        self = recentCompanies.isEmpty ? .empty : .populated
    }
}

enum ConversationLibraryRecentEmptyCopy {
    static let title = "最近見た銘柄はまだありません"
    static let message = "銘柄を開くと、ここから前回の会話へ戻れます。"
}

/// 提案質問のチップ。無地のテキストボタンで、頭に飾りのアイコンは持たない
/// (v2 IA 仕様 Phase 6「AI 臭の除去」= sparkles 全廃。置き換えのアイコンも置かない)。
/// 末尾の ↖ は「押すと入力欄に入る(送信ではない)」の合図で、
/// Phase 4 の「プレフィルは送信にならない」規約を目で見せている部分。
/// ただし入力欄がチップのすぐ下に見えている面では、押した先が目の前にあるので
/// 記号で言い直す必要がない。そこだけ `showsPrefillGlyph: false` で落とす
/// (規約自体は VoiceOver ラベル「質問を入力: 〜」が引き続き持つ)。
struct ConversationPromptChip: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let text: String
    var showsPrefillGlyph: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(text)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)

                Spacer(minLength: 0)

                if showsPrefillGlyph {
                    Image(systemName: "arrow.up.left")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.accent)
                }
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(KabuyomiTheme.inputWell, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("質問を入力: \(text)")
    }
}

struct HistoricalBoardCopy: Equatable {
    let eyebrow: String
    let title: String
    let subtitle: String
    let note: String
}

func historicalMetricSummaryText(for series: [HistoricalMetricSeriesPayload]) -> String? {
    guard !series.isEmpty else { return nil }
    let labels = series.prefix(2).map(\.label).joined(separator: " / ")
    return series.count > 2 ? "表示指標: \(labels) ほか \(series.count - 2) 件" : "表示指標: \(labels)"
}

/// `comparisonBasis` は Worker 側で `"annual" | "quarterly"` の閉じた union
/// (`workers/src/lib/history-store.ts`)。生の値を画面に出さないための唯一の変換点。
func historicalBasisTitle(_ comparisonBasis: String) -> String {
    comparisonBasis == "quarterly" ? "同四半期" : "年次"
}

func historicalBoardCopy(
    comparisonBasis: String,
    requestedYears: Int,
    availablePeriodCount: Int,
    singleSeriesLabel: String?
) -> HistoricalBoardCopy {
    let isQuarterly = comparisonBasis == "quarterly"
    let basisTitle = historicalBasisTitle(comparisonBasis)
    let basisNote = isQuarterly ? "同四半期ベース" : "年次ベース"
    let safeAvailableCount = max(availablePeriodCount, 0)
    let safeRequestedYears = max(requestedYears, safeAvailableCount)
    let isComplete = safeRequestedYears > 0 && safeAvailableCount >= safeRequestedYears
    let subject = singleSeriesLabel.map { "\($0)の" } ?? ""
    if isComplete {
        return HistoricalBoardCopy(
            eyebrow: "\(safeRequestedYears)年",
            title: "\(subject)\(safeRequestedYears)年の\(basisTitle)比較",
            subtitle: "\(basisTitle)で \(safeRequestedYears) 年分の推移を比較",
            note: "履歴比較は\(basisNote)です。"
        )
    }
    return HistoricalBoardCopy(
        eyebrow: "\(safeAvailableCount)期",
        title: "\(subject)取得済み\(safeAvailableCount)期比較",
        subtitle: "\(basisTitle)。\(safeRequestedYears)年分のうち取得済み\(safeAvailableCount)期の推移を表示",
        note: "履歴比較は\(basisNote)です。\(safeRequestedYears)年分が揃うまでは取得済み期間だけ表示します。"
    )
}

struct HistoricalChartScale: Equatable {
    let minValue: Double
    let maxValue: Double
    var range: Double { max(maxValue - minValue, 1) }
}

func historicalChartScale(values: [Double]) -> HistoricalChartScale {
    let minValue = min(values.min() ?? 0, 0)
    let maxValue = max(values.max() ?? 0, 0)
    return minValue == maxValue
        ? HistoricalChartScale(minValue: minValue - 1, maxValue: maxValue + 1)
        : HistoricalChartScale(minValue: minValue, maxValue: maxValue)
}

func historicalChartY(value: Double, scale: HistoricalChartScale, height: CGFloat) -> CGFloat {
    let clampedValue = min(max(value, scale.minValue), scale.maxValue)
    let normalized = (scale.maxValue - clampedValue) / scale.range
    return min(max(CGFloat(normalized) * height, 0), height)
}

func summarySignalSegmentWidths(
    totalWidth: CGFloat,
    counts: [Int],
    spacing: CGFloat = 6,
    minimumVisibleWidth: CGFloat = 10
) -> [CGFloat] {
    guard !counts.isEmpty else { return [] }
    let spacingTotal = spacing * CGFloat(max(counts.count - 1, 0))
    let availableWidth = max(totalWidth - spacingTotal, 0)
    guard availableWidth > 0 else { return Array(repeating: 0, count: counts.count) }
    let baselineWidth = min(minimumVisibleWidth, availableWidth / CGFloat(counts.count))
    let totalCount = counts.reduce(0, +)
    guard totalCount > 0 else { return Array(repeating: baselineWidth, count: counts.count) }
    let remainingWidth = max(availableWidth - baselineWidth * CGFloat(counts.count), 0)
    return counts.map { count in
        count > 0 ? baselineWidth + remainingWidth * CGFloat(count) / CGFloat(totalCount) : baselineWidth
    }
}

struct InsightSourceChip: Identifiable, Hashable {
    let label: String
    let source: LocalMessageSourceRef?
    var id: String { "\(label):\(source?.sourceIdSnapshot ?? "none")" }
}

func insightSourceChips(sourceIds: [String], in company: CompanyPayload) -> [InsightSourceChip] {
    var seen = Set<String>()
    return sourceIds.compactMap { sourceId in
        guard let chunk = company.sourceChunks.first(where: { $0.sourceId == sourceId }) else {
            let fallback = "提出資料"
            guard seen.insert(fallback).inserted else { return nil }
            return InsightSourceChip(label: fallback, source: nil)
        }
        let baseLabel = investorFacingSourceLabel(for: chunk, in: company)
        let label = chunk.sectionType == "xbrl_metric" ? "\(baseLabel)（XBRL）" : baseLabel
        guard seen.insert(label).inserted else { return nil }
        return InsightSourceChip(label: label, source: sourceReference(from: chunk, in: company))
    }
}

func analyticalQuestion(from text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "次に何を確認する？" }
    if trimmed.hasSuffix("？") || trimmed.hasSuffix("?") { return trimmed }
    if trimmed.contains("確認でき"), !trimmed.contains("確認できません") {
        if let label = sourceReferenceLabelForQuestion(from: trimmed) { return "\(label)で何を確認する？" }
        return "提出資料の記述で何を確認する？"
    }
    if trimmed.contains("売上") || trimmed.localizedCaseInsensitiveContains("revenue") { return "売上成長の主因は何か？" }
    if trimmed.contains("利益率") || trimmed.contains("マージン") { return "利益率の改善は続きそうか？" }
    if trimmed.contains("営業キャッシュ") || trimmed.contains("営業CF") || trimmed.localizedCaseInsensitiveContains("cash flow") {
        return "営業CFの増加は利益改善と連動しているか？"
    }
    if trimmed.contains("成長") || trimmed.contains("増加") || trimmed.contains("改善") { return "この成長は一時的か、継続的か？" }
    return "\(analyticalHeadline(from: trimmed))をどう確認する？"
}

private func analyticalHeadline(from text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "確認事項" }
    for separator in ["で、", "ため、", "が、", "。", "です", "ます"] {
        if let range = trimmed.range(of: separator) {
            let candidate = String(trimmed[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !candidate.isEmpty { return String(candidate.prefix(32)) }
        }
    }
    return String(trimmed.prefix(32))
}

private func sourceReferenceLabelForQuestion(from text: String) -> String? {
    let patterns = [#"((?:10-[KQ]|10K|10Q)\s*(?:項目|Item)\s*[0-9A-Za-z.]+)"#, #"((?:Form\s+)?10-[KQ]\s+Item\s+[0-9A-Za-z.]+)"#, #"(Item\s+[0-9A-Za-z.]+)"#]
    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: range), let matchRange = Range(match.range(at: 1), in: text) else { continue }
        return String(text[matchRange]).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return nil
}

enum ConversationIdleState: Equatable {
    case intro
    case drafted(question: String)
}

func resolveConversationIdleState(draftQuestion: String) -> ConversationIdleState {
    let trimmed = draftQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? .intro : .drafted(question: trimmed)
}

func shouldDisplayPendingOptimisticMessage(chatHistory: [LocalChatMessage], pendingChat: PendingChatState?) -> Bool {
    guard let pendingChat else { return false }
    let pendingQuestion = pendingChat.question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let latest = chatHistory.last(where: { $0.role == "user" }) else { return true }
    guard latest.content.trimmingCharacters(in: .whitespacesAndNewlines) == pendingQuestion else { return true }
    return latest.createdAt < pendingChat.submittedAt
}

func shouldDisplayPendingAssistantStatus(chatHistory: [LocalChatMessage], pendingChat: PendingChatState?) -> Bool {
    guard let pendingChat else { return false }
    guard let latest = chatHistory.last(where: { $0.role != "user" }) else { return true }
    return latest.createdAt < pendingChat.submittedAt
}

struct PendingAssistantViewState: Equatable {
    let badge: String
    let title: String
    let detail: String
}

func buildPendingAssistantViewState(question: String, submittedAt: Date, now: Date, formType: String) -> PendingAssistantViewState {
    let elapsed = now.timeIntervalSince(submittedAt)
    let historical = isHistoricalQuestionText(question)
    if elapsed < 1.1 {
        return PendingAssistantViewState(
            badge: "整理中",
            title: "質問の軸を整理しています",
            detail: historical ? "比較する期間と論点を先に揃えています。" : "質問に対応する指標と本文の論点を絞っています。"
        )
    }
    if elapsed < 2.6 {
        return PendingAssistantViewState(
            badge: "検索中",
            title: historical ? "比較に必要な提出資料を探しています" : "関連箇所を探しています",
            detail: historical ? (formType == "10-Q" ? "同四半期ベースで必要な過去年だけ補完しています。" : "年次ベースで必要な過去年だけ補完しています。") : "\(formType) の本文と主要指標から根拠を拾っています。"
        )
    }
    return PendingAssistantViewState(
        badge: "作成中",
        title: historical ? "比較しやすい形に整えています" : "返答を短くまとめています",
        detail: historical ? "数字と本文の差分をつないで、読みやすい順に並べています。" : "数字を先に、本文の意味づけを後ろに置いて整理しています。"
    )
}
