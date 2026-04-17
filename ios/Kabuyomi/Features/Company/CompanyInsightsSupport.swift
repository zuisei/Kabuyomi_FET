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
    let highlights = company.summary.highlights.map { FilingInsight(text: $0.text, sourceIds: $0.sourceIds) }
    if !highlights.isEmpty {
        return highlights
    }
    return buildMetricInsights(for: company).filter { $0.text.contains("前年比") }
}

func buildPositiveInsights(for company: CompanyPayload) -> [FilingInsight] {
    let positives = company.summary.changes
        .filter { sentiment(for: $0.text) == .positive }
        .map { FilingInsight(text: $0.text, sourceIds: $0.sourceIds) }
    if !positives.isEmpty {
        return positives
    }

    return buildMetricInsights(for: company).filter { sentiment(for: $0.text) == .positive }
}

func buildNegativeInsights(for company: CompanyPayload) -> [FilingInsight] {
    let negatives = company.summary.changes
        .filter { sentiment(for: $0.text) == .negative }
        .map { FilingInsight(text: $0.text, sourceIds: $0.sourceIds) }
    if !negatives.isEmpty {
        return negatives
    }

    return buildMetricInsights(for: company).filter { sentiment(for: $0.text) == .negative }
}

func buildChangeInsights(for company: CompanyPayload) -> [FilingInsight] {
    let explicitChanges = company.summary.changes.map { FilingInsight(text: $0.text, sourceIds: $0.sourceIds) }
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
    formattedMetricValue(metric.value, logicalName: metric.logicalName)
}

func formattedMetricValue(_ value: Double, logicalName: String) -> String {
    if logicalName == "epsBasic" {
        return value.formatted(.number.precision(.fractionLength(2)))
    }
    return value.formatted(.number.notation(.compactName))
}

func formattedYoY(_ yoyPercent: Double) -> String {
    "\(yoyPercent.formatted(.number.precision(.fractionLength(1))))%"
}

func formattedSignedYoY(_ yoyPercent: Double) -> String {
    let sign = yoyPercent >= 0 ? "+" : ""
    return "\(sign)\(formattedYoY(yoyPercent))"
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
