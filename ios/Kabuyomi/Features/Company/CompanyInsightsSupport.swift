import SwiftUI

struct FilingInsight: Identifiable, Hashable {
    let text: String
    let sourceIds: [String]

    var id: String {
        text + sourceIds.joined(separator: ":")
    }
}

enum InvestorOverviewTone {
    case positive
    case mixed
    case negative

    var title: String {
        switch self {
        case .positive:
            return "良い材料が優勢"
        case .mixed:
            return "強弱が混在"
        case .negative:
            return "慎重に見たい決算"
        }
    }

    var tint: Color {
        switch self {
        case .positive:
            return KabuyomiTheme.positive
        case .mixed:
            return KabuyomiTheme.accentDeep
        case .negative:
            return KabuyomiTheme.negative
        }
    }

    var supportingCopy: String {
        switch self {
        case .positive:
            return "数字と本文を並べると、今回は良い材料がやや優勢です。まずは伸びた要因の持続性を確認したい局面です。"
        case .mixed:
            return "良化と悪化が混在しています。強い数字と弱い数字を分けて見ると、決算の解像度が上がります。"
        case .negative:
            return "慎重に見たい材料がやや多めです。一時要因か構造要因かを優先して切り分けたい局面です。"
        }
    }
}

func buildFocusInsights(for company: CompanyPayload) -> [FilingInsight] {
    let highlights = company.summary.highlights.map { summaryLine in
        FilingInsight(
            text: localizedOverviewInsightText(summaryLine.text, sourceIds: summaryLine.sourceIds, company: company),
            sourceIds: summaryLine.sourceIds
        )
    }
    if !highlights.isEmpty {
        return highlights
    }
    return buildMetricInsights(for: company).filter { $0.text.contains("前年比") }
}

func buildPositiveInsights(for company: CompanyPayload) -> [FilingInsight] {
    let positives = company.summary.changes
        .filter { sentiment(for: $0.text) == .positive }
        .map { summaryLine in
            FilingInsight(
                text: localizedOverviewInsightText(summaryLine.text, sourceIds: summaryLine.sourceIds, company: company),
                sourceIds: summaryLine.sourceIds
            )
        }
    if !positives.isEmpty {
        return positives
    }

    return buildMetricInsights(for: company).filter { sentiment(for: $0.text) == .positive }
}

func buildNegativeInsights(for company: CompanyPayload) -> [FilingInsight] {
    let negatives = company.summary.changes
        .filter { sentiment(for: $0.text) == .negative }
        .map { summaryLine in
            FilingInsight(
                text: localizedOverviewInsightText(summaryLine.text, sourceIds: summaryLine.sourceIds, company: company),
                sourceIds: summaryLine.sourceIds
            )
        }
    if !negatives.isEmpty {
        return negatives
    }

    return buildMetricInsights(for: company).filter { sentiment(for: $0.text) == .negative }
}

func buildChangeInsights(for company: CompanyPayload) -> [FilingInsight] {
    let explicitChanges = company.summary.changes.map { summaryLine in
        FilingInsight(
            text: localizedOverviewInsightText(summaryLine.text, sourceIds: summaryLine.sourceIds, company: company),
            sourceIds: summaryLine.sourceIds
        )
    }
    if !explicitChanges.isEmpty {
        return explicitChanges
    }

    return Array(buildMetricInsights(for: company).prefix(3))
}

func orderedInvestorMetrics(for company: CompanyPayload) -> [MetricPayload] {
    let preferredOrder = ["revenue", "operatingIncome", "netIncome", "operatingCashFlow", "epsBasic"]
    let orderMap = Dictionary(uniqueKeysWithValues: preferredOrder.enumerated().map { ($1, $0) })

    return company.metrics.sorted { lhs, rhs in
        let lhsOrder = orderMap[lhs.logicalName] ?? Int.max
        let rhsOrder = orderMap[rhs.logicalName] ?? Int.max

        if lhsOrder != rhsOrder {
            return lhsOrder < rhsOrder
        }

        let lhsMagnitude = abs(lhs.yoyPercent ?? 0)
        let rhsMagnitude = abs(rhs.yoyPercent ?? 0)
        if lhsMagnitude != rhsMagnitude {
            return lhsMagnitude > rhsMagnitude
        }

        return MetricLabeler.title(for: lhs.logicalName) < MetricLabeler.title(for: rhs.logicalName)
    }
}

func investorTone(
    for company: CompanyPayload,
    positiveInsights: [FilingInsight],
    negativeInsights: [FilingInsight]
) -> InvestorOverviewTone {
    let positiveScore = positiveInsights.count + company.metrics.filter { ($0.yoyPercent ?? 0) > 0 }.count
    let negativeScore = negativeInsights.count + company.metrics.filter { ($0.yoyPercent ?? 0) < 0 }.count

    if positiveScore >= negativeScore + 2 {
        return .positive
    }

    if negativeScore >= positiveScore + 2 {
        return .negative
    }

    return .mixed
}

func formattedMetricValue(_ metric: MetricPayload) -> String {
    formattedMetricValue(metric.value, logicalName: metric.logicalName, unit: metric.unit)
}

func formattedMetricValue(_ value: Double, logicalName: String, unit: String = "USD") -> String {
    if logicalName == "epsBasic" {
        return value.formatted(.number.precision(.fractionLength(2)))
    }
    return formattedCurrencyLikeMetric(value, unit: unit)
}

func formattedYoY(_ yoyPercent: Double) -> String {
    "\(yoyPercent.formatted(.number.precision(.fractionLength(1))))%"
}

func formattedSignedYoY(_ yoyPercent: Double) -> String {
    let sign = yoyPercent >= 0 ? "+" : ""
    return "\(sign)\(formattedYoY(yoyPercent))"
}

enum MetricDeltaTone: Equatable {
    case positive
    case negative
    case neutral

    var tint: Color {
        switch self {
        case .positive:
            return KabuyomiTheme.positive
        case .negative:
            return KabuyomiTheme.negative
        case .neutral:
            return KabuyomiTheme.inkMuted
        }
    }
}

enum MetricDeltaDirection: Equatable {
    case positive
    case negative
    case none
}

struct MetricYoYDisplay: Equatable {
    let text: String
    let tone: MetricDeltaTone
    let direction: MetricDeltaDirection
    let magnitudePercent: Double

    var tint: Color {
        tone.tint
    }
}

func metricYoYDisplay(for metric: MetricPayload) -> MetricYoYDisplay? {
    metricYoYDisplay(
        logicalName: metric.logicalName,
        value: metric.value,
        comparisonValue: metric.comparisonValue,
        yoyPercent: metric.yoyPercent
    )
}

func metricYoYDisplay(
    logicalName: String,
    value: Double,
    comparisonValue: Double?,
    yoyPercent: Double?
) -> MetricYoYDisplay? {
    guard let yoyPercent else { return nil }

    let magnitude = abs(yoyPercent)
    if let comparisonValue {
        if isProfitLikeMetric(logicalName) {
            if value < 0, comparisonValue < 0 {
                if value > comparisonValue {
                    return MetricYoYDisplay(
                        text: "赤字縮小 \(formattedYoY(magnitude))",
                        tone: .positive,
                        direction: .positive,
                        magnitudePercent: magnitude
                    )
                }

                if value < comparisonValue {
                    return MetricYoYDisplay(
                        text: "赤字拡大 \(formattedYoY(magnitude))",
                        tone: .negative,
                        direction: .negative,
                        magnitudePercent: magnitude
                    )
                }

                return MetricYoYDisplay(text: "赤字横ばい", tone: .neutral, direction: .none, magnitudePercent: 0)
            }

            if value >= 0, comparisonValue < 0 {
                return MetricYoYDisplay(text: "黒字転換", tone: .positive, direction: .positive, magnitudePercent: magnitude)
            }

            if value < 0, comparisonValue >= 0 {
                return MetricYoYDisplay(text: "赤字転落", tone: .negative, direction: .negative, magnitudePercent: magnitude)
            }
        }

        if isCashFlowMetric(logicalName) {
            if value < 0, comparisonValue < 0 {
                if value > comparisonValue {
                    return MetricYoYDisplay(
                        text: "流出縮小 \(formattedYoY(magnitude))",
                        tone: .positive,
                        direction: .positive,
                        magnitudePercent: magnitude
                    )
                }

                if value < comparisonValue {
                    return MetricYoYDisplay(
                        text: "流出拡大 \(formattedYoY(magnitude))",
                        tone: .negative,
                        direction: .negative,
                        magnitudePercent: magnitude
                    )
                }

                return MetricYoYDisplay(text: "流出横ばい", tone: .neutral, direction: .none, magnitudePercent: 0)
            }

            if value >= 0, comparisonValue < 0 {
                return MetricYoYDisplay(text: "流入転換", tone: .positive, direction: .positive, magnitudePercent: magnitude)
            }

            if value < 0, comparisonValue >= 0 {
                return MetricYoYDisplay(text: "流出転落", tone: .negative, direction: .negative, magnitudePercent: magnitude)
            }
        }
    } else if value < 0, isProfitLikeMetric(logicalName) {
        return MetricYoYDisplay(
            text: yoyPercent >= 0 ? "赤字縮小 \(formattedYoY(magnitude))" : "赤字拡大 \(formattedYoY(magnitude))",
            tone: yoyPercent >= 0 ? .positive : .negative,
            direction: yoyPercent >= 0 ? .positive : .negative,
            magnitudePercent: magnitude
        )
    } else if value < 0, isCashFlowMetric(logicalName) {
        return MetricYoYDisplay(
            text: yoyPercent >= 0 ? "流出縮小 \(formattedYoY(magnitude))" : "流出拡大 \(formattedYoY(magnitude))",
            tone: yoyPercent >= 0 ? .positive : .negative,
            direction: yoyPercent >= 0 ? .positive : .negative,
            magnitudePercent: magnitude
        )
    }

    return MetricYoYDisplay(
        text: formattedSignedYoY(yoyPercent),
        tone: yoyPercent >= 0 ? .positive : .negative,
        direction: yoyPercent >= 0 ? .positive : .negative,
        magnitudePercent: magnitude
    )
}

private func isProfitLikeMetric(_ logicalName: String) -> Bool {
    ["operatingIncome", "netIncome", "epsBasic"].contains(logicalName)
}

private func isCashFlowMetric(_ logicalName: String) -> Bool {
    logicalName == "operatingCashFlow"
}

func leadSentence(from text: String) -> String? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    let delimiters: [Character] = ["。", ".", "!", "?", "！", "？"]
    if let index = trimmed.firstIndex(where: { delimiters.contains($0) }) {
        let sentence = trimmed[...index].trimmingCharacters(in: .whitespacesAndNewlines)
        return sentence.isEmpty ? nil : String(sentence)
    }

    return trimmed
}

private enum InsightSentiment {
    case positive
    case negative
    case neutral
}

private func localizedOverviewInsightText(_ text: String, sourceIds: [String], company: CompanyPayload) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
        return "提出資料の該当箇所を確認してください。"
    }

    if containsJapaneseText(trimmed) {
        return trimmed
    }

    if let metricText = localizedMetricInsightFromSource(sourceIds: sourceIds, company: company) {
        return metricText
    }

    guard let chunk = sourceIds.compactMap({ sourceId in
        company.sourceChunks.first(where: { $0.sourceId == sourceId })
    }).first else {
        return "提出資料の該当箇所を確認してください。"
    }

    let label = investorFacingSourceLabel(for: chunk, in: company)
    if label.contains("MD&A") {
        return "MD&A に、今回の増減要因や事業動向の説明があります。"
    }

    if label.contains("リスク") {
        return "リスク要因の欄に、注意したい論点の説明があります。"
    }

    return "\(label) の記述を確認してください。"
}

private func buildMetricInsights(for company: CompanyPayload) -> [FilingInsight] {
    company.metrics.compactMap { metric in
        guard let yoy = metric.yoyPercent else { return nil }
        let direction = yoy >= 0 ? "改善" : "悪化"
        let sourceIds = company.sourceChunks
            .filter { $0.sectionType == "xbrl_metric" && $0.tagName == metric.tagUsed }
            .map(\.sourceId)
        let text = "\(MetricLabeler.title(for: metric.logicalName))は前年比 \(formattedYoY(yoy)) で、\(direction)が確認できます。"
        return FilingInsight(text: text, sourceIds: sourceIds)
    }
}

private func localizedMetricInsightFromSource(sourceIds: [String], company: CompanyPayload) -> String? {
    for sourceId in sourceIds {
        guard let chunk = company.sourceChunks.first(where: { $0.sourceId == sourceId }),
              chunk.sectionType == "xbrl_metric",
              let tagName = chunk.tagName,
              let metric = company.metrics.first(where: { $0.tagUsed == tagName }) else {
            continue
        }

        if let yoy = metric.yoyPercent {
            let direction = yoy >= 0 ? "増加" : "減少"
            return "\(MetricLabeler.title(for: metric.logicalName))は前年同期比 \(formattedYoY(yoy)) で、\(direction)が確認できます。"
        }

        if let comparisonValue = metric.comparisonValue {
            return "\(MetricLabeler.title(for: metric.logicalName))は \(formattedMetricValue(metric))、比較値は \(formattedMetricValue(comparisonValue, logicalName: metric.logicalName, unit: metric.unit)) です。"
        }
    }

    return nil
}

private func containsJapaneseText(_ value: String) -> Bool {
    value.range(of: #"[ぁ-んァ-ン一-龥]"#, options: .regularExpression) != nil
}

private func formattedCurrencyLikeMetric(_ value: Double, unit: String) -> String {
    guard unit.uppercased() == "USD" else {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 1
        let formatted = formatter.string(from: NSNumber(value: value)) ?? value.formatted(.number.precision(.fractionLength(0 ... 1)))
        return [formatted, unit].filter { !$0.isEmpty }.joined(separator: " ")
    }

    let absolute = abs(value)

    if absolute >= 1_000_000_000_000 {
        return "\(formattedJapaneseCompact(value / 1_000_000_000_000))兆ドル"
    }

    if absolute >= 100_000_000 {
        return "\(formattedJapaneseCompact(value / 100_000_000))億ドル"
    }

    if absolute >= 1_000_000 {
        return "\(formattedJapaneseCompact(value / 1_000_000))百万ドル"
    }

    return "\(formattedJapaneseCompact(value))ドル"
}

private func formattedJapaneseCompact(_ value: Double) -> String {
    value.formatted(
        .number
            .precision(.fractionLength(0 ... 1))
            .locale(Locale(identifier: "ja_JP"))
    )
}

private func sentiment(for text: String) -> InsightSentiment {
    let negativeKeywords = ["悪化", "低下", "減少", "鈍化", "圧迫", "逆風", "弱含み", "落ち込み", "慎重", "軟調", "縮小"]
    let positiveKeywords = ["改善", "増加", "伸長", "拡大", "堅調", "成長", "回復", "上昇", "寄与", "牽引", "伸び"]

    if negativeKeywords.contains(where: text.contains) {
        return .negative
    }

    if positiveKeywords.contains(where: text.contains) {
        return .positive
    }

    return .neutral
}
