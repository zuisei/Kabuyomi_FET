import Foundation
import SwiftUI

func displayableMessageSources(_ sources: [LocalMessageSourceRef], in company: CompanyPayload) -> [LocalMessageSourceRef] {
    var seen = Set<String>()

    return sources.filter { source in
        let label = investorFacingSourceLabel(for: source, in: company)
        let key = "\(source.sourceKind.rawValue):\(label)"
        return seen.insert(key).inserted
    }
}

struct AssistantMessageStructure {
    let conclusion: String
    let evidence: [String]
    let limitations: [String]
}

struct AssistantMetricDisplayRow: Equatable, Identifiable {
    let metric: String
    let value: String
    let context: String

    var id: String { metric }
}

func assistantMetricRows(from text: String) -> [AssistantMetricDisplayRow] {
    let sentences = splitAssistantSentences(text).map(localizedAssistantDisplayText)
    var rows: [AssistantMetricDisplayRow] = []
    var seen = Set<String>()

    for sentence in sentences {
        for metric in assistantMetricLabels where sentence.contains(metric) && !seen.contains(metric) {
            guard let value = firstMetricValue(in: sentence, after: metric) else { continue }
            rows.append(
                AssistantMetricDisplayRow(
                    metric: metric,
                    value: value,
                    context: metricContext(in: sentence, excluding: value)
                )
            )
            seen.insert(metric)
        }
    }

    return rows
}

private var assistantMetricLabels: [String] {
    [
        "売上高",
        "営業利益",
        "純利益",
        "粗利益",
        "営業キャッシュフロー",
        "フリーキャッシュフロー",
        "利益率",
        "営業利益率"
    ]
}

private func assistantSentenceContainsMetric(_ sentence: String) -> Bool {
    assistantMetricLabels.contains { sentence.contains($0) }
}

private func firstMetricValue(in sentence: String, after metric: String) -> String? {
    guard let metricRange = sentence.range(of: metric) else { return nil }
    let tail = String(sentence[metricRange.upperBound...])
    let patterns = [
        #"([0-9０-９][0-9０-９,，.．]*\s*(?:億ドル|百万ドル|万ドル|ドル|億円|百万円|万円|円))"#,
        #"([0-9０-９][0-9０-９,，.．]*\s*(?:%|％))"#
    ]

    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
        let range = NSRange(tail.startIndex..<tail.endIndex, in: tail)
        guard let match = regex.firstMatch(in: tail, range: range),
              let valueRange = Range(match.range(at: 1), in: tail) else {
            continue
        }

        return String(tail[valueRange])
            .replacingOccurrences(of: "，", with: ",")
            .replacingOccurrences(of: "．", with: ".")
            .replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
    }

    return nil
}

private func metricContext(in sentence: String, excluding value: String) -> String {
    let contextPatterns = [
        #"(前年同期比\s*[+-]?[0-9０-９][0-9０-９,.．，]*\s*(?:%|％)\s*(?:増|減)?)"#,
        #"([+-][0-9０-９][0-9０-９,.．，]*\s*(?:%|％))"#,
        #"((?:増加|減少|改善|悪化)[^。！？!?]{0,18})"#
    ]

    for pattern in contextPatterns {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
        let range = NSRange(sentence.startIndex..<sentence.endIndex, in: sentence)
        guard let match = regex.firstMatch(in: sentence, range: range),
              let contextRange = Range(match.range(at: 1), in: sentence) else {
            continue
        }

        let context = String(sentence[contextRange])
            .replacingOccurrences(of: "，", with: ",")
            .replacingOccurrences(of: "．", with: ".")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !context.contains(value) {
            return context
        }
    }

    return ""
}

func isComparisonQuestionText(_ text: String) -> Bool {
    let normalized = text.lowercased()
    let patterns = [
        "compare",
        "compared",
        "comparison",
        "versus",
        " vs ",
        "比べ",
        "比較",
        "他社",
        "競合",
        "peer"
    ]

    return patterns.contains(where: { normalized.contains($0) })
}

func isPeerComparisonQuestionText(_ text: String) -> Bool {
    let normalized = text.lowercased()
    let peerPatterns = [
        "versus",
        " vs ",
        "他社",
        "競合",
        "peer",
        "with "
    ]

    return peerPatterns.contains(where: { normalized.contains($0) })
}

private func extractComparisonTarget(from prompt: String?) -> String? {
    guard let prompt else { return nil }

    let normalized = prompt.replacingOccurrences(of: "\n", with: " ")
    let patterns = [
        #"(?i)(?:with|vs\.?|versus|against)\s+([A-Za-z0-9&.\- ]{2,40})$"#,
        #"(?i)比較(?:すると|したい)?\s*([A-Za-z0-9&.\- ]{2,40})"#
    ]

    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
        let range = NSRange(normalized.startIndex..<normalized.endIndex, in: normalized)
        guard let match = regex.firstMatch(in: normalized, range: range),
              match.numberOfRanges > 1,
              let targetRange = Range(match.range(at: 1), in: normalized) else {
            continue
        }

        let target = normalized[targetRange]
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        if !target.isEmpty {
            return String(target)
        }
    }

    let uppercaseTokens = prompt
        .split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == "?" || $0 == "？" })
        .map(String.init)
        .filter { $0.count >= 2 && $0 == $0.uppercased() }

    return uppercaseTokens.dropFirst().first ?? uppercaseTokens.first
}

private func answerLooksComparative(_ answer: String, for prompt: String?) -> Bool {
    let normalizedAnswer = answer.lowercased()

    if let target = extractComparisonTarget(from: prompt)?.lowercased(),
       normalizedAnswer.contains(target) {
        return true
    }

    let comparisonMarkers = [
        "比較すると",
        "比べると",
        "一方",
        "対して",
        "versus",
        "compared with",
        "relative to"
    ]

    return comparisonMarkers.contains(where: { normalizedAnswer.contains($0.lowercased()) })
}

func structureAssistantMessage(_ text: String) -> AssistantMessageStructure {
    let sentences = splitAssistantSentences(text)
    guard !sentences.isEmpty else {
        return AssistantMessageStructure(conclusion: text, evidence: [], limitations: [])
    }

    let normalizedSentences = sentences.compactMap(normalizeAssistantSentence)
    guard !normalizedSentences.isEmpty else {
        return AssistantMessageStructure(
            conclusion: "この決算資料だけでは、これ以上の切り分けは難しいです。",
            evidence: [],
            limitations: []
        )
    }

    let limitationSentences = normalizedSentences
        .filter(\.isLimitation)
        .map(\.text)
    let regularSentences = normalizedSentences
        .filter { !$0.isLimitation }
        .map(\.text)
    let baseSentences = regularSentences.isEmpty ? limitationSentences : regularSentences

    let conclusionCount = preferredConclusionSentenceCount(baseSentences)
    let conclusion = baseSentences.prefix(conclusionCount).joined(separator: " ")
    let evidence = regularSentences.isEmpty ? [] : Array(baseSentences.dropFirst(conclusionCount))
    let filteredLimitations = regularSentences.isEmpty ? Array(limitationSentences.dropFirst(conclusionCount)) : limitationSentences

    return AssistantMessageStructure(
        conclusion: conclusion,
        evidence: evidence,
        limitations: filteredLimitations
    )
}

private func preferredConclusionSentenceCount(_ sentences: [String]) -> Int {
    guard !sentences.isEmpty else { return 0 }

    let firstSentenceLength = sentences[0].count
    let canExtendConclusion = firstSentenceLength < 42
        && sentences.count > 1
        && isConclusionFriendlySentence(sentences[1])
    var conclusionCount = canExtendConclusion ? 2 : 1

    if let enumerationStart = sentences.indices.prefix(2).first(where: { isEnumeratedReasonSentence(sentences[$0]) }) {
        var enumerationEnd = enumerationStart
        while sentences.indices.contains(enumerationEnd + 1),
              isEnumeratedReasonSentence(sentences[enumerationEnd + 1]) {
            enumerationEnd += 1
        }
        conclusionCount = max(conclusionCount, enumerationEnd + 1)
    }

    return min(conclusionCount, sentences.count)
}

private func splitAssistantSentences(_ text: String) -> [String] {
    let normalized = text
        .replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)

    guard !normalized.isEmpty else { return [] }

    let japaneseSplit = normalized.replacingOccurrences(
        of: #"([。！？!?])"#,
        with: "$1\n",
        options: .regularExpression
    )
    let englishSplit = japaneseSplit.replacingOccurrences(
        of: #"\.\s+(?=[A-Z0-9])"#,
        with: ".\n",
        options: .regularExpression
    )

    return englishSplit
        .split(separator: "\n")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
}

private func isLimitationSentence(_ sentence: String) -> Bool {
    let normalized = sentence.lowercased()
    let patterns = [
        "確認できません",
        "十分確認できません",
        "特定できません",
        "だけでは",
        "断定できません",
        "分かりません",
        "わかりません",
        "切り分け",
        "追加情報",
        "別情報",
        "外部",
        "精度が上が",
        "不明",
        "cannot",
        "not enough",
        "limited"
    ]

    return patterns.contains(where: { normalized.contains($0.lowercased()) })
}

func isUnavailableMessage(_ text: String) -> Bool {
    let compact = text
        .lowercased()
        .replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "。.!！?？"))

    let exactPatterns = [
        "この決算資料の範囲では確認できません",
        "このfilingの提供コンテキストでは確認できません"
    ]

    if exactPatterns.contains(compact) {
        return true
    }

    let unavailablePatterns = [
        "確認できません",
        "十分確認できません",
        "分かりません",
        "わかりません",
        "cannotconfirm",
        "notenoughcontext"
    ]
    let containsUnavailablePhrase = unavailablePatterns.contains(where: { compact.contains($0) })
    guard containsUnavailablePhrase else { return false }

    return compact.count <= 70 && !hasAssistantFactSignal(text)
}

func localizedAssistantDisplayText(_ text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return text }

    let strippedEnglishBoilerplate = stripMixedEnglishBoilerplate(from: trimmed)
    let rawCandidate = strippedEnglishBoilerplate.isEmpty ? trimmed : strippedEnglishBoilerplate
    let candidate = containsJapaneseCharacters(rawCandidate)
        ? localizeAssistantInternalLabels(in: rawCandidate)
        : rawCandidate
    let candidateNormalized = candidate.lowercased()

    if containsJapaneseCharacters(candidate),
       !candidate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
       !looksLikePureBoilerplate(candidate) {
        let strippedItemReference = candidate.replacingOccurrences(
            of: #"\s*Item\s+\d+[A-Za-z]?\.\s*$"#,
            with: "",
            options: .regularExpression
        )

        let cleaned = strippedItemReference
            .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if !cleaned.isEmpty {
            return cleaned
        }
    }

    if candidateNormalized.contains("management's discussion")
        || candidateNormalized.contains("results of operations")
        || candidateNormalized.contains("our business risks")
        || candidateNormalized.contains("md&a") {
        return "提出資料の本文に、増減要因や事業上の論点の説明があります。"
    }

    if candidateNormalized.contains("forward-looking statements")
        || candidateNormalized.contains("investors are cautioned")
        || candidateNormalized.contains("actual results and events")
        || candidateNormalized.contains("could cause actual results") {
        return "この決算資料だけでは、これ以上の切り分けは難しいです。"
    }

    let strippedItemReference = trimmed.replacingOccurrences(
        of: #"\s*Item\s+\d+[A-Za-z]?\.\s*$"#,
        with: "",
        options: .regularExpression
    )

    if strippedItemReference != trimmed, containsJapaneseCharacters(strippedItemReference) {
        return strippedItemReference.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    if !containsJapaneseCharacters(trimmed), candidateNormalized.contains("form 10-q") || candidateNormalized.contains("form 10-k") {
        return "提出資料の該当項目を確認してください。"
    }

    return trimmed
}

private let assistantInternalDisplayTerms: [(String, String)] = [
    ("MD&A revenue discussion", "MD&Aの売上要因説明"),
    ("mda revenue discussion", "MD&Aの売上要因説明"),
    ("revenue discussion", "売上要因の説明"),
    ("product revenue", "製品別売上"),
    ("services revenue", "サービス売上"),
    ("service revenue", "サービス売上"),
    ("geographic revenue", "地域別売上"),
    ("geography revenue", "地域別売上"),
    ("segment results", "セグメント別業績"),
    ("segment result", "セグメント別業績"),
    ("segment information", "セグメント情報"),
    ("sector-specific KPIs", "業界固有KPI"),
    ("sector specific KPIs", "業界固有KPI"),
    ("sector KPIs", "業界KPI"),
    ("new product launches", "新製品投入"),
    ("product launches", "新製品投入"),
    ("new product introductions", "新製品投入"),
    ("product introductions", "新製品投入"),
    ("channel inventory", "販売チャネル在庫"),
    ("operating cash flow", "営業キャッシュフロー"),
    ("free cash flow", "フリーキャッシュフロー"),
    ("cash flow", "キャッシュフロー"),
    ("gross margin", "粗利益率"),
    ("operating margin", "営業利益率"),
    ("margin drivers", "利益率要因"),
    ("product mix", "製品ミックス"),
    ("foreign exchange", "為替影響"),
    ("customer demand", "顧客需要"),
    ("market demand", "市場需要"),
    ("holiday demand", "季節需要"),
    ("pricing", "価格動向"),
    ("inventory", "在庫"),
    ("demand", "需要")
]

private func localizeAssistantInternalLabels(in text: String) -> String {
    var localized = text

    for (source, replacement) in assistantInternalDisplayTerms {
        let escaped = NSRegularExpression.escapedPattern(for: source)
        let pattern = #"(?i)(?<![A-Za-z0-9])"# + escaped + #"(?![A-Za-z0-9])"#
        localized = localized.replacingOccurrences(
            of: pattern,
            with: replacement,
            options: .regularExpression
        )
    }

    let localizedLabelPattern = Set(assistantInternalDisplayTerms.map(\.1))
        .sorted { $0.count > $1.count }
        .map(NSRegularExpression.escapedPattern)
        .joined(separator: "|")
    let labelsBeforeParticlePattern = #"("# + localizedLabelPattern + #")\s+([のをにはがともで])"#

    return localized
        .replacingOccurrences(of: #"\s*,\s*(?=[ぁ-んァ-ヶ一-龠])"#, with: "、", options: .regularExpression)
        .replacingOccurrences(of: labelsBeforeParticlePattern, with: "$1$2", options: .regularExpression)
        .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func containsJapaneseCharacters(_ text: String) -> Bool {
    text.range(of: #"[ぁ-んァ-ヶ一-龠]"#, options: .regularExpression) != nil
}

private func hasAssistantFactSignal(_ text: String) -> Bool {
    let normalized = text.lowercased()
    let patterns = [
        #"売上高|営業利益|純利益|営業キャッシュフロー|前年同期比|比較値|億ドル|%|revenue|operating income|net income|cash flow"#,
        #"\d"#
    ]

    return patterns.contains { pattern in
        normalized.range(of: pattern, options: .regularExpression) != nil
    }
}

private struct NormalizedAssistantSentence {
    let text: String
    let isLimitation: Bool
}

private func normalizeAssistantSentence(_ sentence: String) -> NormalizedAssistantSentence? {
    let localized = localizedAssistantDisplayText(sentence)
        .trimmingCharacters(in: .whitespacesAndNewlines)

    guard !localized.isEmpty else { return nil }
    guard !looksLikePureBoilerplate(localized) else { return nil }

    return NormalizedAssistantSentence(
        text: localized,
        isLimitation: isLimitationSentence(localized)
    )
}

private func isConclusionFriendlySentence(_ sentence: String) -> Bool {
    guard containsJapaneseCharacters(sentence) else { return false }
    guard !looksLikePureBoilerplate(sentence) else { return false }
    guard !isLimitationSentence(sentence) else { return false }

    let latinCount = sentence.unicodeScalars.filter(\.isASCII).count
    return latinCount < max(18, sentence.count / 2)
}

private func isEnumeratedReasonSentence(_ sentence: String) -> Bool {
    let trimmed = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }

    let patterns = [
        #"^(?:[0-9０-９]+|[一二三四五六七八九十]+)つ目"#,
        #"^第[一二三四五六七八九十0-9０-９]+"#,
        #"^(?i)(?:first|second|third|firstly|secondly|thirdly)\b"#,
        #"^(?:まず|次に|最後に)"#
    ]

    return patterns.contains { pattern in
        trimmed.range(of: pattern, options: .regularExpression) != nil
    }
}

private func stripMixedEnglishBoilerplate(from text: String) -> String {
    guard containsJapaneseCharacters(text) else { return text }

    var cleaned = text
    let patterns = [
        #"\bItem\s+\d+[A-Za-z]?\.\s*"#,
        #"(?i)\b(?:Management'?s Discussion|Results of Operations|Our Business Risks|Forward-?looking statements|Investors are cautioned|Available Information)\b[^ぁ-んァ-ヶ一-龠]{0,280}"#,
        #"(?i)\bA detailed discussion of [^ぁ-んァ-ヶ一-龠]{0,320}(?:forward-?looking statements|actual results|included elsewhere)[^ぁ-んァ-ヶ一-龠]{0,160}"#,
        #"(?i)\b(?:risks and uncertainties|actual results and events|could cause actual results)[^ぁ-んァ-ヶ一-龠]{0,220}"#
    ]

    for pattern in patterns {
        cleaned = cleaned.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
    }

    return cleaned
        .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func looksLikePureBoilerplate(_ text: String) -> Bool {
    let normalized = text.lowercased()

    return normalized.contains("management's discussion")
        || normalized.contains("results of operations")
        || normalized.contains("our business risks")
        || normalized.contains("forward-looking statements")
        || normalized.contains("investors are cautioned")
        || normalized.contains("available information")
}
