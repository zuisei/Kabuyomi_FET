import SwiftUI

struct ConversationTimeline: View {
    let company: CompanyPayload
    let chatHistory: [LocalChatMessage]
    let pendingChat: PendingChatState?
    let isSending: Bool
    let suggestions: [String]
    let historicalSuggestions: [String]
    @Binding var draftQuestion: String

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if hasStartedConversation {
                        ConversationSessionHeader(
                            company: company,
                            followUpQuestion: buildFollowUpQuestions(
                                for: company,
                                precedingUserPrompt: latestVisibleUserPrompt
                            ).first,
                            historicalQuestion: historicalSuggestions.first,
                            selectQuestion: { draftQuestion = $0 }
                        )

                        ForEach(Array(chatHistory.enumerated()), id: \.element.id) { index, message in
                            let prompt = latestUserPrompt(before: index)
                            ConversationMessageRow(
                                company: company,
                                message: message,
                                precedingUserPrompt: prompt,
                                recoverySuggestions: buildRecoveryQuestions(
                                    for: company,
                                    precedingUserPrompt: prompt
                                ),
                                followUpSuggestions: latestAssistantIndex == index
                                    ? buildFollowUpQuestions(for: company, precedingUserPrompt: prompt)
                                    : [],
                                applySuggestion: { draftQuestion = $0 }
                            )
                        }

                        if let pendingChat {
                            ConversationMessageRow(
                                company: company,
                                message: pendingChat.optimisticUserMessage,
                                precedingUserPrompt: latestVisibleUserPrompt,
                                recoverySuggestions: [],
                                followUpSuggestions: [],
                                applySuggestion: { _ in }
                            )

                            PendingAssistantStatusRow(company: company, pendingChat: pendingChat)
                        } else if isSending {
                            AssistantTypingRow(ticker: company.ticker)
                        }
                    } else {
                        ConversationContextCard(
                            company: company,
                            suggestedQuestions: Array(suggestions.prefix(3)),
                            historicalQuestions: Array(historicalSuggestions.prefix(4)),
                            selectQuestion: { draftQuestion = $0 }
                        )

                        ConversationEmptyState(
                            company: company,
                            suggestions: Array(suggestions.prefix(3)),
                            historicalSuggestions: Array(historicalSuggestions.prefix(2))
                        )
                    }

                    Color.clear
                        .frame(height: 2)
                        .id("conversation-bottom")
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .onAppear {
                if hasStartedConversation {
                    scrollToBottom(proxy)
                }
            }
            .onChange(of: chatHistory.count) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: pendingChat) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: isSending) { _, _ in
                scrollToBottom(proxy)
            }
        }
    }

    private var hasStartedConversation: Bool {
        !chatHistory.isEmpty || pendingChat != nil
    }

    private var latestAssistantIndex: Int? {
        chatHistory.indices.reversed().first(where: { chatHistory[$0].role != "user" })
    }

    private var latestVisibleUserPrompt: String? {
        pendingChat?.question ?? latestUserPrompt(before: chatHistory.count)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard hasStartedConversation else { return }

        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.22)) {
                proxy.scrollTo("conversation-bottom", anchor: .bottom)
            }
        }
    }

    private func latestUserPrompt(before index: Int) -> String? {
        guard index > 0 else { return nil }

        for candidate in chatHistory[..<index].reversed() where candidate.role == "user" {
            return candidate.content
        }

        return nil
    }
}

struct PendingAssistantViewState: Equatable {
    let badge: String
    let title: String
    let detail: String
}

func buildPendingAssistantViewState(
    question: String,
    submittedAt: Date,
    now: Date,
    formType: String
) -> PendingAssistantViewState {
    let elapsed = now.timeIntervalSince(submittedAt)
    let isHistorical = isHistoricalQuestionText(question)

    if elapsed < 1.1 {
        return PendingAssistantViewState(
            badge: "Thinking",
            title: "質問の軸を整理しています",
            detail: isHistorical
                ? "比較する期間と論点を先に揃えています。"
                : "質問に対応する指標と本文の論点を絞っています。"
        )
    }

    if elapsed < 2.6 {
        return PendingAssistantViewState(
            badge: "Searching",
            title: isHistorical ? "比較に必要な提出資料を探しています" : "関連箇所を探しています",
            detail: isHistorical
                ? pendingHistoryDetail(formType: formType)
                : "\(formType) の本文と主要指標から根拠を拾っています。"
        )
    }

    return PendingAssistantViewState(
        badge: "Drafting",
        title: isHistorical ? "比較しやすい形に整えています" : "返答を短くまとめています",
        detail: isHistorical
            ? "数字と本文の差分をつないで、読みやすい順に並べています。"
            : "数字を先に、本文の意味づけを後ろに置いて整理しています。"
    )
}

private func pendingHistoryDetail(formType: String) -> String {
    if formType == "10-Q" {
        return "同四半期ベースで必要な過去年だけ補完しています。"
    }

    return "年次ベースで必要な過去年だけ補完しています。"
}

private struct ConversationSessionHeader: View {
    let company: CompanyPayload
    let followUpQuestion: String?
    let historicalQuestion: String?
    let selectQuestion: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(company.formType == "10-Q" ? "最新 10-Q を起点に会話中" : "最新 10-K を起点に会話中")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)

                    Text("\(company.companyName) ・ filed \(company.filedAt)")
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Text(company.formType)
                    .font(.system(.caption2, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.55)))
            }

            HStack(spacing: 8) {
                if let followUpQuestion {
                    ConversationMiniPromptChip(
                        text: followUpQuestion,
                        systemImage: "arrow.turn.down.right",
                        action: { selectQuestion(followUpQuestion) }
                    )
                }

                if let historicalQuestion {
                    ConversationMiniPromptChip(
                        text: historicalQuestion,
                        systemImage: "clock.arrow.circlepath",
                        action: { selectQuestion(historicalQuestion) }
                    )
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .kabuyomiGlass(radius: 20, tint: Color.white.opacity(0.2), stroke: Color.white.opacity(0.48))
    }
}

struct ConversationContextCard: View {
    let company: CompanyPayload
    let suggestedQuestions: [String]
    let historicalQuestions: [String]
    let selectQuestion: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [KabuyomiTheme.accent.opacity(0.95), KabuyomiTheme.accentDeep.opacity(0.95)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 12, height: 12)

                VStack(alignment: .leading, spacing: 5) {
                    Text("Live Filing")
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text(company.companyName)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("\(company.formType) ・ filed \(company.filedAt)")
                        .font(.system(.footnote, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Text(company.formType)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
            }

            if !suggestedQuestions.isEmpty {
                promptSection(
                    title: "まず聞く",
                    systemImage: "arrow.up.right.circle.fill",
                    questions: suggestedQuestions,
                    icon: "bubble.left.and.bubble.right.fill"
                )
            }

            if !historicalQuestions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    promptSection(
                        title: company.formType == "10-Q" ? "3年の同四半期で比べる" : "3年の年次で比べる",
                        systemImage: "clock.arrow.circlepath",
                        questions: historicalQuestions,
                        icon: "chart.bar.xaxis"
                    )

                    Text(historyPromptFootnote)
                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .kabuyomiGlass(radius: 24)
    }

    private func promptSection(
        title: String,
        systemImage: String,
        questions: [String],
        icon: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .bold))
                Text(title)
                    .font(.system(.footnote, design: .rounded, weight: .bold))
            }
            .foregroundStyle(KabuyomiTheme.accentDeep)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(questions, id: \.self) { question in
                        ConversationPromptChip(
                            text: question,
                            systemImage: icon,
                            action: { selectQuestion(question) }
                        )
                    }
                }
                .padding(.trailing, 2)
            }
        }
    }

    private var historyPromptFootnote: String {
        if company.formType == "10-Q" {
            return "履歴比較は同四半期ベースです。必要な過去年だけ自動補完して、無駄な取得を増やさないようにしています。"
        }

        return "履歴比較は年次 10-K ベースです。必要な過去年だけ自動補完して、無駄な取得を増やさないようにしています。"
    }
}

struct ConversationPromptChip: View {
    let text: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)

                Text(text)
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                Capsule()
                    .fill(Color.white.opacity(0.88))
                    .overlay(Capsule().stroke(Color.white.opacity(0.95), lineWidth: 1))
            )
        }
        .buttonStyle(.plain)
    }
}

private struct ConversationMiniPromptChip: View {
    let text: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .bold))
                Text(text)
                    .font(.system(.caption, design: .rounded, weight: .semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(Color.white.opacity(0.84))
                    .overlay(
                        RoundedRectangle(cornerRadius: 15, style: .continuous)
                            .stroke(Color.white.opacity(0.94), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

struct ConversationEmptyState: View {
    let company: CompanyPayload
    let suggestions: [String]
    let historicalSuggestions: [String]

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                KabuyomiTheme.accent.opacity(0.28),
                                KabuyomiTheme.accentSoft.opacity(0.08),
                                .clear
                            ],
                            center: .center,
                            startRadius: 6,
                            endRadius: 72
                        )
                    )
                    .frame(width: 120, height: 120)

                Image(systemName: "bubble.left.and.text.bubble.right.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }

            VStack(spacing: 8) {
                Text("まず 1 つだけ確認する")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                Text(introCopy)
                    .font(.system(.subheadline, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 314)
            }

            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 13, weight: .bold))
                VStack(alignment: .leading, spacing: 4) {
                    Text("上の提案から始めるか、履歴比較のショートカットで前回比や推移をそのまま聞けます")
                    Text(company.formType == "10-Q" ? "同四半期ベースで必要な過去年だけ補完します" : "年次ベースで必要な過去年だけ補完します")
                }
                .font(.system(.footnote, design: .rounded, weight: .semibold))
            }
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .kabuyomiGlass(radius: 18, tint: Color.white.opacity(0.22), stroke: Color.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 2)
        .padding(.bottom, 4)
    }

    private var introCopy: String {
        let openingExample = suggestions.prefix(2).map { "「\($0)」" }.joined(separator: " / ")
        let historyExample = historicalSuggestions.first

        if openingExample.isEmpty {
            if let historyExample {
                return "\(company.companyName) の今回の filing で、最初に確認したい点をそのまま聞けます。たとえば \(historyExample) のような履歴比較にもすぐ進めます。"
            }
            return "\(company.companyName) の今回の filing で、最初に確認したい点をそのまま聞けます。"
        }

        if let historyExample {
            return "\(company.companyName) の今回の filing で、最初に確認したい点をそのまま聞けます。たとえば \(openingExample) から入り、\(historyExample) のような履歴比較にもすぐ進めます。"
        }

        return "\(company.companyName) の今回の filing で、最初に確認したい点をそのまま聞けます。たとえば \(openingExample) から入ると全体像を掴みやすくなります。"
    }
}

struct ConversationLoadingState: View {
    let ticker: String
    let isLoading: Bool

    var body: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 48)

            if isLoading {
                ProgressView()
                    .controlSize(.large)
                    .tint(KabuyomiTheme.accentDeep)
            } else {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }

            Text(isLoading ? "\(ticker) の会話を準備中..." : "\(ticker) をまだ開けませんでした")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text(
                isLoading
                    ? "英語の決算を日本語で読みやすくしています。"
                    : "左上から別の銘柄を選ぶか、右上の再読み込みでもう一度試してください。"
            )
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .multilineTextAlignment(.center)

            Spacer()
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct AssistantTypingRow: View {
    let ticker: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(ticker)
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.inkMuted)

            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                    .tint(KabuyomiTheme.accentDeep)
                Text("決算書と市場の見方を整理しています...")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .padding(16)
            .kabuyomiCard(.primary, radius: 22)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PendingAssistantStatusRow: View {
    let company: CompanyPayload
    let pendingChat: PendingChatState

    var body: some View {
        TimelineView(.periodic(from: pendingChat.submittedAt, by: 0.8)) { context in
            let state = buildPendingAssistantViewState(
                question: pendingChat.question,
                submittedAt: pendingChat.submittedAt,
                now: context.date,
                formType: company.formType
            )

            HStack(alignment: .bottom, spacing: 10) {
                avatarBubble(label: company.ticker.prefix(1), accent: false)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Text(company.ticker)
                            .font(.system(.caption, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.inkMuted)

                        Text(state.badge)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.55)))
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text(state.title)
                            .font(.system(.body, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)

                        Text(state.detail)
                            .font(.system(.footnote, design: .rounded, weight: .medium))
                            .foregroundStyle(KabuyomiTheme.inkMuted)

                        PendingDotsRow(submittedAt: pendingChat.submittedAt, now: context.date)
                    }
                    .padding(16)
                    .kabuyomiCard(.primary, radius: 24)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func avatarBubble<S: StringProtocol>(label: S, accent: Bool) -> some View {
        Text(String(label))
            .font(.system(.caption2, design: .rounded, weight: .bold))
            .foregroundStyle(accent ? Color.white : KabuyomiTheme.accentDeep)
            .frame(width: 34, height: 34)
            .background(
                Circle()
                    .fill(accent ? Color.white.opacity(0.18) : Color.white.opacity(0.68))
                    .overlay(Circle().stroke(Color.white.opacity(0.6), lineWidth: 1))
            )
    }
}

private struct PendingDotsRow: View {
    let submittedAt: Date
    let now: Date

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(dotColor(for: index))
                    .frame(width: 8, height: 8)
            }
        }
    }

    private func dotColor(for index: Int) -> Color {
        let phase = Int(now.timeIntervalSince(submittedAt) / 0.35)
        return phase % 3 == index
            ? KabuyomiTheme.accentDeep
            : KabuyomiTheme.accentSoft.opacity(0.45)
    }
}
