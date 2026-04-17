import SwiftUI

struct ConversationTimeline: View {
    let company: CompanyPayload
    let chatHistory: [LocalChatMessage]
    let isSending: Bool
    let suggestions: [String]
    let historicalSuggestions: [String]
    @Binding var draftQuestion: String

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ConversationContextCard(
                        company: company,
                        suggestedQuestions: Array(suggestions.prefix(3)),
                        historicalQuestions: Array(historicalSuggestions.prefix(4)),
                        selectQuestion: { draftQuestion = $0 }
                    )

                    if chatHistory.isEmpty {
                        ConversationEmptyState(
                            company: company,
                            suggestions: Array(suggestions.prefix(3)),
                            historicalSuggestions: Array(historicalSuggestions.prefix(2))
                        )
                    } else {
                        ForEach(Array(chatHistory.enumerated()), id: \.element.id) { index, message in
                            ConversationMessageRow(
                                company: company,
                                message: message,
                                precedingUserPrompt: latestUserPrompt(before: index),
                                recoverySuggestions: buildRecoveryQuestions(
                                    for: company,
                                    precedingUserPrompt: latestUserPrompt(before: index)
                                ),
                                applySuggestion: { draftQuestion = $0 }
                            )
                        }
                    }

                    if isSending {
                        AssistantTypingRow(ticker: company.ticker)
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
                scrollToBottom(proxy)
            }
            .onChange(of: chatHistory.count) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: isSending) { _, _ in
                scrollToBottom(proxy)
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
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
                promptSection(
                    title: "履歴で比べる",
                    systemImage: "clock.arrow.circlepath",
                    questions: historicalQuestions,
                    icon: "chart.bar.xaxis"
                )
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

            HStack(spacing: 8) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 13, weight: .bold))
                Text("上の提案から始めるか、履歴比較のショートカットで前回比や推移をそのまま聞けます")
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

    var body: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 48)

            ProgressView()
                .controlSize(.large)
                .tint(KabuyomiTheme.accentDeep)

            Text("\(ticker) の会話を準備中...")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text("英語の決算を日本語で読みやすくしています。")
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)

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
