import Foundation
import SwiftUI

struct ConversationMessageRow: View {
    let company: CompanyPayload
    let message: LocalChatMessage
    let precedingUserPrompt: String?
    let recoverySuggestions: [String]
    let followUpSuggestions: [String]
    let applySuggestion: (String) -> Void
    let openSource: (LocalMessageSourceRef) -> Void

    var body: some View {
        VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 10) {
                if message.role != "user" {
                    avatarBubble(label: company.ticker.prefix(1), accent: false)
                } else {
                    Spacer(minLength: 42)
                }

                VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 8) {
                    messageMetaLine

                    messageBubbleContent
                        .padding(16)
                        .background(message.role == "user" ? AnyView(userBubble) : AnyView(assistantBubble))

                    if showsSuggestionStrip {
                        ConversationRecoverySuggestions(
                            title: suggestionStripTitle,
                            suggestions: activeSuggestions,
                            applySuggestion: applySuggestion
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)

                if message.role == "user" {
                    avatarBubble(label: "You", accent: true)
                }
            }

            if !message.sources.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    if let groundingCaption {
                        Label(groundingCaption, systemImage: groundingIcon)
                            .font(.system(.caption2, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(message.sources) { source in
                                Button(action: { openSource(source) }) {
                                    sourceChip(for: source)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var assistantBubble: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill((showsRecoverySuggestions || comparisonLimitationNotice != nil) ? KabuyomiTheme.fill(for: .secondary) : KabuyomiTheme.fill(for: .primary))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(Color.white.opacity(0.7), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.05), radius: 10, x: 0, y: 6)
    }

    private var userBubble: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [KabuyomiTheme.accentDeep, KabuyomiTheme.accent],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .shadow(color: KabuyomiTheme.accentDeep.opacity(0.22), radius: 12, x: 0, y: 8)
    }

    private var groundingCaption: String? {
        let kinds = Set(message.sources.map(\.sourceKind))

        if kinds.contains(.historicalFiling) && kinds.contains(.secFiling) {
            return "最新決算資料と過去資料を併用"
        }

        if kinds.contains(.historicalFiling) && kinds.contains(.webSupplement) {
            return "過去提出資料を起点に外部補足あり"
        }

        if kinds.contains(.secFiling) && kinds.contains(.webSupplement) {
            return "SEC資料を起点に外部補足あり"
        }

        if comparisonLimitationNotice != nil {
            return "比較は限定的"
        }

        if kinds.contains(.historicalFiling) {
            return MessageSourceKind.historicalFiling.groundingCaption
        }

        return kinds.first?.groundingCaption
    }

    private var showsRecoverySuggestions: Bool {
        message.role != "user"
            && (isUnavailableMessage(message.content) || comparisonLimitationNotice != nil)
            && !recoverySuggestions.isEmpty
    }

    private var showsSuggestionStrip: Bool {
        message.role != "user" && !activeSuggestions.isEmpty
    }

    private var activeSuggestions: [String] {
        if showsRecoverySuggestions {
            return Array(recoverySuggestions.prefix(3))
        }

        return Array(followUpSuggestions.prefix(3))
    }

    private var suggestionStripTitle: String {
        if showsRecoverySuggestions {
            return recoverySuggestionTitle
        }

        if let precedingUserPrompt, isHistoricalQuestionText(precedingUserPrompt) {
            return "同じ軸で続きを見る"
        }

        return "続きを聞く"
    }

    @ViewBuilder
    private var messageBubbleContent: some View {
        if message.role == "user" {
            Text(message.content)
                .font(.system(.body, design: .rounded))
                .foregroundStyle(Color.white)
        } else if isUnavailableMessage(message.content) {
            AssistantFallbackBubble(
                message: fallbackCopy,
                comparisonLimitation: comparisonLimitationCopy
            )
        } else {
            AssistantStructuredBubble(
                content: message.content,
                comparisonLimitation: comparisonLimitationNotice
            )
        }
    }

    private var groundingIcon: String {
        let kinds = Set(message.sources.map(\.sourceKind))
        if kinds.contains(.historicalFiling) {
            return "clock.arrow.circlepath"
        }
        if kinds.contains(.secFiling) {
            return "checkmark.shield"
        }

        return "globe"
    }

    private func sourceBadgeBackground(for source: LocalMessageSourceRef) -> Color {
        switch source.sourceKind {
        case .secFiling:
            return KabuyomiTheme.accentDeep.opacity(0.12)
        case .historicalFiling:
            return KabuyomiTheme.accent.opacity(0.16)
        case .webSupplement:
            return Color.white.opacity(0.72)
        }
    }

    private func sourceBadgeForeground(for source: LocalMessageSourceRef) -> Color {
        switch source.sourceKind {
        case .secFiling:
            return KabuyomiTheme.accentDeep
        case .historicalFiling:
            return KabuyomiTheme.accent
        case .webSupplement:
            return KabuyomiTheme.inkMuted
        }
    }

    private func displaySourceLabel(for source: LocalMessageSourceRef) -> String {
        investorFacingSourceLabel(for: source, in: company)
    }

    @ViewBuilder
    private func sourceChip(for source: LocalMessageSourceRef) -> some View {
        HStack(spacing: 6) {
            Text(source.sourceKind.badgeTitle)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(sourceBadgeForeground(for: source))
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Capsule().fill(sourceBadgeBackground(for: source)))

            Label(displaySourceLabel(for: source), systemImage: source.sourceKind.systemImage)
                .font(.system(.caption2, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.accentDeep)

            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep.opacity(0.55))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
    }

    private var messageMetaLine: some View {
        HStack(spacing: 6) {
            Text(message.role == "user" ? "あなた" : company.ticker)
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.inkMuted)

            if message.role != "user" {
                Text(message.createdAt, format: .dateTime.hour().minute())
                    .font(.system(.caption2, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.92))

                if let compactModelLabel {
                    Text(compactModelLabel)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.55)))
                }
            }
        }
    }

    private var compactModelLabel: String? {
        guard message.role != "user" else { return nil }
        return AIModelName.compactLabel(for: message.modelName)
    }

    private func avatarBubble<S: StringProtocol>(label: S, accent: Bool) -> some View {
        Text(String(label))
            .font(.system(.caption2, design: .rounded, weight: .bold))
            .foregroundStyle(accent ? Color.white : KabuyomiTheme.accentDeep)
            .frame(width: 34, height: 34)
            .background(
                Circle()
                    .fill(
                        accent
                            ? AnyShapeStyle(
                                LinearGradient(
                                    colors: [KabuyomiTheme.accentDeep, KabuyomiTheme.accent],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            : AnyShapeStyle(Color.white.opacity(0.68))
                    )
                    .overlay(Circle().stroke(Color.white.opacity(0.7), lineWidth: 1))
            )
    }

    private var recoverySuggestionTitle: String {
        isPeerComparisonQuestion ? "代わりに履歴比較なら確認できます" : "代わりに次は確認できます"
    }

    private var isPeerComparisonQuestion: Bool {
        guard let precedingUserPrompt, message.role != "user" else { return false }
        return isPeerComparisonQuestionText(precedingUserPrompt)
    }

    private var comparisonLimitationNotice: AssistantComparisonNotice? {
        guard isPeerComparisonQuestion,
              !isUnavailableMessage(message.content),
              !answerLooksComparative(message.content, for: precedingUserPrompt) else {
            return nil
        }

        return AssistantComparisonNotice(
            title: "この beta では他社比較はまだ限定的です",
            message: "今回の回答は主に \(company.ticker) 単体の今回の決算資料をもとに整理しています。代わりに、同社の前回比や今回の変化はすぐ追えます。"
        )
    }

    private var comparisonLimitationCopy: String? {
        guard isPeerComparisonQuestion else { return nil }
        return "この beta では他社比較はまだ限定的です。"
    }

    private var fallbackCopy: String {
        if comparisonLimitationCopy != nil {
            return "代わりに、この決算資料から確認できる同社の前回比や注目点を続けて見ていけます。"
        }

        return "この決算資料ではその論点を十分に確認できませんでした。代わりに、ここから追いやすいポイントを続けて見ていけます。"
    }
}

struct ConversationRecoverySuggestions: View {
    let title: String
    let suggestions: [String]
    let applySuggestion: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        ConversationPromptChip(
                            text: suggestion,
                            systemImage: "arrow.turn.down.right",
                            action: { applySuggestion(suggestion) }
                        )
                    }
                }
                .padding(.trailing, 2)
            }
        }
    }
}

private struct AssistantComparisonNotice {
    let title: String
    let message: String
}

struct AssistantMessageStructure {
    let conclusion: String
    let evidence: [String]
    let limitations: [String]
}

private struct AssistantStructuredBubble: View {
    let content: String
    let comparisonLimitation: AssistantComparisonNotice?

    private var structure: AssistantMessageStructure {
        structureAssistantMessage(content)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let comparisonLimitation {
                AssistantInlineNotice(
                    title: comparisonLimitation.title,
                    message: comparisonLimitation.message
                )
            }

            AssistantSectionBlock(title: "結論", tint: KabuyomiTheme.accentDeep) {
                Text(localizedAssistantDisplayText(structure.conclusion))
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !structure.evidence.isEmpty {
                AssistantSectionBlock(title: "根拠", tint: KabuyomiTheme.inkMuted) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(structure.evidence.enumerated()), id: \.offset) { _, sentence in
                            AssistantSentenceRow(text: sentence)
                        }
                    }
                }
            }

            if !structure.limitations.isEmpty {
                AssistantSectionBlock(title: "限界 / 追加確認", tint: KabuyomiTheme.negative) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(structure.limitations.enumerated()), id: \.offset) { _, sentence in
                            AssistantSentenceRow(text: sentence)
                        }
                    }
                }
            }
        }
    }
}

private struct AssistantFallbackBubble: View {
    let message: String
    let comparisonLimitation: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let comparisonLimitation {
                AssistantInlineNotice(
                    title: "比較質問は限定対応です",
                    message: comparisonLimitation
                )
            }

            AssistantSectionBlock(title: "いま分かること", tint: KabuyomiTheme.accentDeep) {
                Text(message)
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct AssistantInlineNotice: View {
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)

            Text(message)
                .font(.system(.footnote, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiGlass(radius: 18, tint: Color.white.opacity(0.18), stroke: Color.white.opacity(0.52))
    }
}

private struct AssistantSectionBlock<Content: View>: View {
    let title: String
    let tint: Color
    let content: Content

    init(title: String, tint: Color, @ViewBuilder content: () -> Content) {
        self.title = title
        self.tint = tint
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(tint)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(Capsule().fill(tint.opacity(0.12)))

            content
        }
    }
}

private struct AssistantSentenceRow: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(KabuyomiTheme.accentDeep.opacity(0.72))
                .frame(width: 5, height: 5)
                .padding(.top, 7)

            Text(localizedAssistantDisplayText(text))
                .font(.system(.footnote, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
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

    let firstSentenceLength = baseSentences.first?.count ?? 0
    let canExtendConclusion = firstSentenceLength < 42
        && baseSentences.count > 1
        && isConclusionFriendlySentence(baseSentences[1])
    let conclusionCount = canExtendConclusion ? 2 : 1
    let conclusion = baseSentences.prefix(conclusionCount).joined(separator: " ")
    let evidence = regularSentences.isEmpty ? [] : Array(baseSentences.dropFirst(conclusionCount))
    let filteredLimitations = regularSentences.isEmpty ? Array(limitationSentences.dropFirst(conclusionCount)) : limitationSentences

    return AssistantMessageStructure(
        conclusion: conclusion,
        evidence: evidence,
        limitations: filteredLimitations
    )
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
        "限定的",
        "だけでは",
        "切り分け",
        "ただし",
        "資料では",
        "不明",
        "cannot",
        "not enough",
        "limited"
    ]

    return patterns.contains(where: { normalized.contains($0.lowercased()) })
}

private func isUnavailableMessage(_ text: String) -> Bool {
    let normalized = text.lowercased()
    let patterns = [
        "この決算資料の範囲では確認できません",
        "この filing の提供コンテキストでは確認できません",
        "十分確認できません",
        "確認できません",
        "cannot confirm",
        "not enough context"
    ]

    return patterns.contains(where: { normalized.contains($0.lowercased()) })
}

func localizedAssistantDisplayText(_ text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return text }

    let strippedEnglishBoilerplate = stripMixedEnglishBoilerplate(from: trimmed)
    let candidate = strippedEnglishBoilerplate.isEmpty ? trimmed : strippedEnglishBoilerplate
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

private func containsJapaneseCharacters(_ text: String) -> Bool {
    text.range(of: #"[ぁ-んァ-ヶ一-龠]"#, options: .regularExpression) != nil
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

private func stripMixedEnglishBoilerplate(from text: String) -> String {
    guard containsJapaneseCharacters(text) else { return text }

    var cleaned = text
    let patterns = [
        #"\bItem\s+\d+[A-Za-z]?\.\s*"#,
        #"(?i)\b(?:Management'?s Discussion|Results of Operations|Our Business Risks|Forward-?looking statements|Investors are cautioned|Available Information)\b[^ぁ-んァ-ヶ一-龠]{0,280}"#,
        #"(?i)\b[A-Z][A-Za-z0-9'’\-.,/:;() ]{24,}(?=(?:[ぁ-んァ-ヶ一-龠]|$))"#
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
