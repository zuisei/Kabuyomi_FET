import SwiftUI

enum ConversationIdleState: Equatable {
    case intro
    case drafted(question: String)
}

func resolveConversationIdleState(draftQuestion: String) -> ConversationIdleState {
    let trimmed = draftQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .intro }
    return .drafted(question: trimmed)
}

func shouldDisplayPendingOptimisticMessage(
    chatHistory: [LocalChatMessage],
    pendingChat: PendingChatState?
) -> Bool {
    guard let pendingChat else { return false }

    let pendingQuestion = pendingChat.question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let latestPersistedUserMessage = chatHistory.last(where: { $0.role == "user" }) else {
        return true
    }

    let latestPersistedQuestion = latestPersistedUserMessage.content.trimmingCharacters(in: .whitespacesAndNewlines)
    guard latestPersistedQuestion == pendingQuestion else {
        return true
    }

    return latestPersistedUserMessage.createdAt < pendingChat.submittedAt
}

func shouldDisplayPendingAssistantStatus(
    chatHistory: [LocalChatMessage],
    pendingChat: PendingChatState?
) -> Bool {
    guard let pendingChat else { return false }
    guard let latestPersistedAssistantMessage = chatHistory.last(where: { $0.role != "user" }) else {
        return true
    }

    return latestPersistedAssistantMessage.createdAt < pendingChat.submittedAt
}

struct ConversationTimeline: View {
    let company: CompanyPayload
    let chatHistory: [LocalChatMessage]
    let pendingChat: PendingChatState?
    let isSending: Bool
    let suggestions: [String]
    let historicalSuggestions: [String]
    let openSource: (LocalMessageSourceRef) -> Void
    @Binding var draftQuestion: String

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if hasStartedConversation {
                        ConversationSessionHeader(
                            company: company
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
                                applySuggestion: { draftQuestion = $0 },
                                openSource: openSource
                            )
                        }

                        if let pendingChat {
                            if shouldDisplayPendingOptimisticMessage(chatHistory: chatHistory, pendingChat: pendingChat) {
                                ConversationMessageRow(
                                    company: company,
                                    message: pendingChat.optimisticUserMessage,
                                    precedingUserPrompt: latestVisibleUserPrompt,
                                    recoverySuggestions: [],
                                    followUpSuggestions: [],
                                    applySuggestion: { _ in },
                                    openSource: openSource
                                )
                            }

                            if shouldDisplayPendingAssistantStatus(chatHistory: chatHistory, pendingChat: pendingChat) {
                                PendingAssistantStatusRow(company: company, pendingChat: pendingChat)
                            }
                        } else if isSending {
                            AssistantTypingRow(ticker: company.ticker)
                        }
                    } else {
                        ConversationContextCard(
                            company: company,
                            suggestedQuestions: Array(suggestions.prefix(3)),
                            historicalQuestions: Array(historicalSuggestions.prefix(3)),
                            selectQuestion: { draftQuestion = $0 }
                        )
                    }

                    Color.clear
                        .frame(height: 2)
                        .id("conversation-bottom")
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
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

    private var idleState: ConversationIdleState {
        resolveConversationIdleState(draftQuestion: draftQuestion)
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
            badge: "整理中",
            title: "質問の軸を整理しています",
            detail: isHistorical
                ? "比較する期間と論点を先に揃えています。"
                : "質問に対応する指標と本文の論点を絞っています。"
        )
    }

    if elapsed < 2.6 {
        return PendingAssistantViewState(
            badge: "検索中",
            title: isHistorical ? "比較に必要な提出資料を探しています" : "関連箇所を探しています",
            detail: isHistorical
                ? pendingHistoryDetail(formType: formType)
                : "\(formType) の本文と主要指標から根拠を拾っています。"
        )
    }

    return PendingAssistantViewState(
        badge: "作成中",
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

    var body: some View {
        HStack(alignment: .center, spacing: 7) {
            Image(systemName: "doc.text")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.70))

            Text("\(company.formType) ・ \(company.filedAt) 提出")
                .font(.system(.caption2, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.86))
                .lineLimit(1)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 2)
        .accessibilityLabel("参照資料: \(company.formType)、\(company.filedAt) 提出")
    }
}

struct ConversationContextCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let company: CompanyPayload
    let suggestedQuestions: [String]
    let historicalQuestions: [String]
    let selectQuestion: (String) -> Void

    private var promptColumns: [GridItem] {
        if dynamicTypeSize.isAccessibilitySize {
            return [GridItem(.flexible(), spacing: 10, alignment: .top)]
        }

        return [GridItem(.adaptive(minimum: 260), spacing: 8, alignment: .top)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            filingHeader

            if !suggestedQuestions.isEmpty {
                promptSection(
                    title: "今回を読む",
                    caption: "この資料だけで先に押さえる",
                    systemImage: "doc.text.magnifyingglass",
                    questions: suggestedQuestions,
                    icon: "bubble.left.and.bubble.right.fill"
                )
            }

            if !historicalQuestions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    promptSection(
                        title: company.formType == "10-Q" ? "過去3年と比べる" : "過去3年の年次比較",
                        caption: company.formType == "10-Q" ? "10-Q は同四半期同士で比較" : "年次 10-K 同士で比較",
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
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .kabuyomiGlass(radius: 24)
    }

    @ViewBuilder
    private var filingHeader: some View {
        let marker = Image(systemName: "doc.text.fill")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .frame(width: 34, height: 34)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(KabuyomiTheme.accentSoft.opacity(0.62))
            )

        let titleBlock = VStack(alignment: .leading, spacing: 5) {
            Text("最新資料")
                .font(.system(.caption2, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
            Text(company.companyName)
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(company.formType) ・ \(company.filedAt) 提出")
                .font(.system(.footnote, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }

        let formBadge = Text(company.formType)
            .font(.system(.caption, design: .rounded, weight: .bold))
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(KabuyomiTheme.accentSoft.opacity(0.58)))

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    marker
                    titleBlock
                }
                formBadge
            }
        } else {
            HStack(alignment: .center, spacing: 10) {
                marker
                titleBlock
                Spacer()
                formBadge
            }
        }
    }

    private func promptSection(
        title: String,
        caption: String,
        systemImage: String,
        questions: [String],
        icon: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .bold))

                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                    Text(caption)
                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
            .foregroundStyle(KabuyomiTheme.accentDeep)

            LazyVGrid(columns: promptColumns, alignment: .leading, spacing: 10) {
                ForEach(questions, id: \.self) { question in
                    ConversationPromptChip(
                        text: question,
                        systemImage: icon,
                        action: { selectQuestion(question) }
                    )
                }
            }
        }
    }

    private var historyPromptFootnote: String {
        if company.formType == "10-Q" {
            return "初回だけ準備に時間がかかることがあります。揃った分から比較します。"
        }

        return "初回だけ準備に時間がかかることがあります。揃った分から比較します。"
    }
}

struct ConversationPromptChip: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let text: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.64))
                    .frame(width: 18, height: 24)

                Text(text)
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .multilineTextAlignment(.leading)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .minimumScaleFactor(0.9)

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.38))
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(0.30))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(KabuyomiTheme.accentDeep.opacity(0.12), lineWidth: 0.8)
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("質問を入力: \(text)")
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
                return "\(company.companyName) の今回の決算資料で、最初に確認したい点をそのまま聞けます。たとえば \(historyExample) のような履歴比較にもすぐ進めます。"
            }
            return "\(company.companyName) の今回の決算資料で、最初に確認したい点をそのまま聞けます。"
        }

        if let historyExample {
            return "\(company.companyName) の今回の決算資料で、最初に確認したい点をそのまま聞けます。たとえば \(openingExample) から入り、\(historyExample) のような履歴比較にもすぐ進めます。"
        }

        return "\(company.companyName) の今回の決算資料で、最初に確認したい点をそのまま聞けます。たとえば \(openingExample) から入ると全体像を掴みやすくなります。"
    }
}

struct ConversationLoadingState: View {
    let ticker: String
    let isLoading: Bool
    let loadState: CompanyLoadStatePayload?
    let openLibrary: () -> Void
    let retry: () -> Void

    private var isPreparingState: Bool {
        loadState?.status == .preparing
    }

    private var showsRetryableState: Bool {
        loadState?.status == .failedRetryable
    }

    private var titleText: String {
        if isPreparingState {
            return "決算資料を準備中…"
        }

        if isLoading {
            return "\(ticker) の会話を準備中…"
        }

        if showsRetryableState {
            return "\(ticker) の取得を再試行できます"
        }

        return "\(ticker) をまだ開けませんでした"
    }

    private var detailText: String {
        if isPreparingState {
            return "保存は完了しています。準備中は一覧に戻って、別の銘柄を開けます。"
        }

        if isLoading {
            return "取得中です。待たずに一覧へ戻れます。"
        }

        if showsRetryableState {
            return "SEC データの取得が一時的に失敗しました。右上の再読み込みで、少し待ってからもう一度取得できます。"
        }

        return "左上から別の銘柄を選ぶか、右上の再読み込みでもう一度試してください。"
    }

    var body: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 48)

            if isLoading || isPreparingState {
                ProgressView()
                    .controlSize(.large)
                    .tint(KabuyomiTheme.accentDeep)
            } else if showsRetryableState {
                Image(systemName: "arrow.triangle.2.circlepath.circle")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            } else {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }

            Text(titleText)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text(detailText)
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .multilineTextAlignment(.center)

            VStack(spacing: 10) {
                Button(action: openLibrary) {
                    Label("一覧に戻る", systemImage: "list.bullet")
                        .frame(maxWidth: 210)
                }
                .buttonStyle(.borderedProminent)
                .tint(KabuyomiTheme.accentDeep)

                if showsRetryableState {
                    Button(action: retry) {
                        Label("もう一度取得", systemImage: "arrow.clockwise")
                            .frame(maxWidth: 210)
                    }
                    .buttonStyle(.bordered)
                    .tint(KabuyomiTheme.accentDeep)
                }
            }
            .font(.system(.callout, design: .rounded, weight: .bold))
            .padding(.top, 2)

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
