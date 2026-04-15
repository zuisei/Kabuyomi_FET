import SwiftUI

private enum CompanySidePanel {
    case library
    case summary
}

private enum DrawerLegalDocument: String, Identifiable {
    case privacy
    case terms
    case support

    var id: String { rawValue }

    var title: String {
        switch self {
        case .privacy:
            return "Privacy Policy"
        case .terms:
            return "利用条件"
        case .support:
            return "Support"
        }
    }

    var subtitle: String {
        switch self {
        case .privacy:
            return "beta 期間中の最小開示"
        case .terms:
            return "Kabuyomi beta の前提"
        case .support:
            return "beta フィードバック窓口"
        }
    }

    var sections: [DrawerLegalSection] {
        switch self {
        case .privacy:
            return [
                DrawerLegalSection(
                    title: "収集する情報",
                    body: "Kabuyomi beta は、匿名の device key、利用回数、購読状態の最小情報、エラー診断の最小ログを扱います。氏名、メールアドレス、証券口座情報、保有資産情報は前提にしていません。"
                ),
                DrawerLegalSection(
                    title: "AI 利用時に送信する情報",
                    body: "AI チャットを有効化した場合、質問文、対象企業の filing metadata、抽出済み MD&A、抽出済み XBRL 指標を Google Gemini に送信します。個人情報や機密情報は入力しないでください。"
                ),
                DrawerLegalSection(
                    title: "第三者サービス",
                    body: "API と利用制限管理には Cloudflare、SEC filing 取得には SEC と sec-fetcher、AI 応答には Google Gemini を利用します。beta 環境では一部の技術ログがサービス品質確認のために記録されます。"
                ),
                DrawerLegalSection(
                    title: "保存期間",
                    body: "ローカルの保存銘柄、取得済み filing、チャット履歴はアプリ内に保存され、設定の「データをリセット」で削除できます。サーバー側の filing cache は再利用と運用確認のため保持されます。"
                )
            ]
        case .terms:
            return [
                DrawerLegalSection(
                    title: "サービスの性質",
                    body: "Kabuyomi は SEC EDGAR の公開提出書類を日本語で読みやすくするための情報提供アプリです。投資助言、売買推奨、株価予測、アナリスト予想比較は提供しません。"
                ),
                DrawerLegalSection(
                    title: "beta 利用の前提",
                    body: "beta 版では仕様、UI、利用制限、出力品質が予告なく変更されることがあります。要約やチャットには誤りや省略が含まれる可能性があるため、必ず原文も確認してください。"
                ),
                DrawerLegalSection(
                    title: "禁止事項",
                    body: "個人情報、証券口座情報、未公開情報、第三者の機密情報を入力しないでください。サービスの不正利用、制限回避、過剰アクセスを目的とした利用は禁止します。"
                ),
                DrawerLegalSection(
                    title: "免責",
                    body: "Kabuyomi の情報を用いた投資判断は利用者自身の責任で行ってください。beta 版の不具合や停止によって生じる損失について、現段階では補償を前提としていません。"
                )
            ]
        case .support:
            return [
                DrawerLegalSection(
                    title: "beta フィードバック方法",
                    body: "TestFlight で配布された beta は、TestFlight アプリの「Send Beta Feedback」から報告してください。スクリーンショット、対象ティッカー、再現手順があると確認しやすくなります。"
                ),
                DrawerLegalSection(
                    title: "報告してほしい内容",
                    body: "対象企業、画面名、質問文、表示された出典、期待した結果、実際の結果、発生時刻をできるだけ具体的に記載してください。"
                ),
                DrawerLegalSection(
                    title: "正式サポート",
                    body: "正式公開前に Privacy Policy / Terms / Support の外部 URL と連絡先を設置予定です。beta 中はアプリ内案内と TestFlight フィードバックを窓口とします。"
                )
            ]
        }
    }
}

private struct DrawerLegalSection: Identifiable {
    let id = UUID()
    let title: String
    let body: String
}

private struct FilingInsight: Identifiable, Hashable {
    let text: String
    let sourceIds: [String]

    var id: String {
        text + sourceIds.joined(separator: ":")
    }
}

struct CompanyView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.openURL) private var openURL

    @State private var currentTicker: String
    @State private var question = ""
    @State private var libraryQuery = ""
    @State private var activePanel: CompanySidePanel?
    @State private var librarySearchTask: Task<Void, Never>?
    @State private var settingsPresented = false
    @State private var libraryPanelID = UUID()
    @State private var summaryPanelID = UUID()
    @FocusState private var isComposerFocused: Bool

    init(ticker: String) {
        _currentTicker = State(initialValue: ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())
    }

    private var company: CompanyPayload? {
        appModel.companyPayload(for: currentTicker)
    }

    private var chatHistory: [LocalChatMessage] {
        appModel.chatHistory(for: currentTicker)
    }

    private var savedCompanies: [WatchlistCard] {
        appModel.watchlist
    }

    private var recentCompanies: [WatchlistCard] {
        appModel.recentCompanyCards(limit: 8, includeSaved: false)
    }

    private var filteredStarterCompanies: [StarterCompany] {
        guard appModel.showStarterCompanies else { return [] }
        let occupiedTickers = Set(savedCompanies.map(\.ticker) + recentCompanies.map(\.ticker))
        let starters = appModel.starterCompanies.filter { !occupiedTickers.contains($0.ticker) }
        return filterStarters(starters, query: libraryQuery)
    }

    private var filteredSavedCompanies: [WatchlistCard] {
        filterCards(savedCompanies, query: libraryQuery)
    }

    private var filteredRecentCompanies: [WatchlistCard] {
        filterCards(recentCompanies, query: libraryQuery)
    }

    private var queryIsSearching: Bool {
        !libraryQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isCurrentTickerSaved: Bool {
        appModel.isTickerInWatchlist(currentTicker)
    }

    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            mainContent
                .blur(radius: activePanel == nil ? 0 : 10)
                .disabled(activePanel != nil)

            if activePanel != nil {
                overlayBackdrop
            }

            if activePanel == .library {
                HStack(spacing: 0) {
                    ConversationLibraryDrawer(
                        query: $libraryQuery,
                        currentTicker: currentTicker,
                        savedCompanies: filteredSavedCompanies,
                        recentCompanies: filteredRecentCompanies,
                        starterCompanies: filteredStarterCompanies,
                        searchResults: appModel.searchResults,
                        isSearchLoading: appModel.searchIsLoading,
                        selectTicker: selectTicker,
                        openSearchResult: openSearchResult,
                        openSettings: openSettingsScreen,
                        close: closePanels
                    )
                    .id(libraryPanelID)
                    .frame(maxWidth: 356)
                    Spacer(minLength: 0)
                }
                .transition(.move(edge: .leading).combined(with: .opacity))
            }

            if activePanel == .summary, let company {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    SummaryDrawer(
                        company: company,
                        positiveInsights: buildPositiveInsights(for: company),
                        negativeInsights: buildNegativeInsights(for: company),
                        focusInsights: buildFocusInsights(for: company),
                        openOriginal: { openPrimaryDocument(urlString: company.primaryDocumentUrl) },
                        close: closePanels
                    )
                    .id(summaryPanelID)
                    .frame(maxWidth: 372)
                }
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }

            if activePanel == nil {
                edgeSwipeHotspots
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: currentTicker) {
            await appModel.loadCompany(ticker: currentTicker)
            appModel.recordCompanyVisit(ticker: currentTicker)
        }
        .onChange(of: currentTicker) { _, newValue in
            question = ""
            libraryQuery = ""
            librarySearchTask?.cancel()
            Task { await appModel.search(query: "") }
            appModel.openConversation(for: newValue)
        }
        .onChange(of: libraryQuery) { _, newValue in
            librarySearchTask?.cancel()
            librarySearchTask = Task {
                try? await Task.sleep(for: .milliseconds(260))
                if !Task.isCancelled {
                    await appModel.search(query: newValue)
                }
            }
        }
        .onDisappear {
            librarySearchTask?.cancel()
        }
        .sheet(isPresented: $settingsPresented) {
            SettingsView()
            .presentationDragIndicator(.visible)
        }
    }

    private var mainContent: some View {
        VStack(spacing: 0) {
            ChatTopBar(
                ticker: currentTicker,
                companyName: company?.companyName,
                formType: company?.formType,
                isSaved: isCurrentTickerSaved,
                isLoading: appModel.companyIsLoading,
                openLibrary: { openPanel(.library) },
                openSummary: { openPanel(.summary) },
                toggleSaved: toggleSavedState,
                refresh: refreshCurrentCompany
            )

            if let company {
                ConversationTimeline(
                    company: company,
                    chatHistory: chatHistory,
                    isSending: appModel.chatIsSending,
                    suggestions: buildSuggestedQuestions(for: company),
                    draftQuestion: $question
                )
            } else {
                ConversationLoadingState(ticker: currentTicker)
            }
        }
        .safeAreaInset(edge: .bottom) {
            ComposerBar(
                question: $question,
                isSending: appModel.chatIsSending,
                isEnabled: company != nil,
                placeholder: composerPlaceholder,
                aiConsentGranted: appModel.aiConsentGranted,
                sendAction: sendCurrentQuestion
            )
        }
    }

    private var composerPlaceholder: String {
        guard let company else {
            return "左上から銘柄を選択してください"
        }

        let suggestions = buildSuggestedQuestions(for: company)
        if suggestions.contains("悪い材料もある？ それでも強い理由は？") {
            return "例: 悪い材料もある？ それでも強い理由は？"
        }

        if let firstSuggestion = suggestions.first {
            return "例: \(firstSuggestion)"
        }

        return "例: 今回の決算、ざっくりどうだった？"
    }

    private var overlayBackdrop: some View {
        Color.black.opacity(0.22)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture {
                closePanels()
            }
    }

    private var edgeSwipeHotspots: some View {
        HStack(spacing: 0) {
            EdgePullZone(edge: .leading) {
                openPanel(.library)
            }

            Spacer(minLength: 0)

            EdgePullZone(edge: .trailing) {
                if company != nil {
                    openPanel(.summary)
                }
            }
        }
        .ignoresSafeArea()
    }

    private func openPanel(_ panel: CompanySidePanel) {
        switch panel {
        case .library:
            libraryPanelID = UUID()
        case .summary:
            summaryPanelID = UUID()
        }

        withAnimation(.spring(response: 0.3, dampingFraction: 0.88)) {
            activePanel = panel
        }
    }

    private func closePanels() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
            activePanel = nil
        }
    }

    private func openSettingsScreen() {
        closePanels()
        Task {
            try? await Task.sleep(for: .milliseconds(180))
            settingsPresented = true
        }
    }

    private func toggleSavedState() {
        Task {
            if isCurrentTickerSaved {
                appModel.removeFromWatchlist(currentTicker)
            } else {
                await appModel.saveTicker(currentTicker)
            }
        }
    }

    private func refreshCurrentCompany() {
        Task {
            await appModel.loadCompany(ticker: currentTicker, forceRefresh: true)
            appModel.recordCompanyVisit(ticker: currentTicker)
        }
    }

    private func sendCurrentQuestion() {
        Task {
            let prompt = question
            let didSend = await appModel.sendChat(question: prompt, ticker: currentTicker)
            if didSend {
                question = ""
            }
        }
    }

    private func selectTicker(_ ticker: String) {
        let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard normalized != currentTicker else {
            closePanels()
            return
        }

        currentTicker = normalized
        closePanels()
    }

    private func openSearchResult(_ item: SearchItem) {
        selectTicker(item.ticker)
    }

    private func openPrimaryDocument(urlString: String) {
        guard let url = URL(string: urlString) else { return }
        openURL(url)
    }
}

private struct ChatTopBar: View {
    let ticker: String
    let companyName: String?
    let formType: String?
    let isSaved: Bool
    let isLoading: Bool
    let openLibrary: () -> Void
    let openSummary: () -> Void
    let toggleSaved: () -> Void
    let refresh: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button(action: openLibrary) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 48, height: 48)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .kabuyomiGlass(radius: 24)
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            VStack(spacing: 2) {
                Text(ticker)
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                if let companyName {
                    Text(companyName)
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .lineLimit(1)
                } else if let formType {
                    Text(formType)
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            Spacer(minLength: 0)

            HStack(spacing: 0) {
                iconButton(
                    systemName: "sidebar.right",
                    accessibilityLabel: "要点を開く",
                    action: openSummary
                )
                Divider()
                    .frame(height: 22)
                    .overlay(KabuyomiTheme.stroke(for: .secondary))
                iconButton(
                    systemName: isSaved ? "bookmark.fill" : "bookmark",
                    accessibilityLabel: isSaved ? "保存済み銘柄から外す" : "保存銘柄に追加",
                    action: toggleSaved
                )
                Divider()
                    .frame(height: 22)
                    .overlay(KabuyomiTheme.stroke(for: .secondary))
                Button(action: refresh) {
                    Group {
                        if isLoading {
                            ProgressView()
                                .controlSize(.small)
                                .tint(KabuyomiTheme.accentDeep)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 18, weight: .semibold))
                        }
                    }
                    .frame(width: 44, height: 48)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("企業データを更新")
            }
            .padding(.horizontal, 4)
            .kabuyomiGlass(radius: 24)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    private func iconButton(systemName: String, accessibilityLabel: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .semibold))
                .frame(width: 44, height: 48)
                .foregroundStyle(KabuyomiTheme.accentDeep)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}

private struct ConversationTimeline: View {
    let company: CompanyPayload
    let chatHistory: [LocalChatMessage]
    let isSending: Bool
    let suggestions: [String]
    @Binding var draftQuestion: String

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if chatHistory.isEmpty {
                        ConversationEmptyState(
                            company: company,
                            suggestions: Array(suggestions.prefix(4)),
                            draftQuestion: $draftQuestion
                        )
                    } else {
                        ConversationContextCard(company: company)
                        ForEach(chatHistory) { message in
                            ConversationMessageRow(company: company, message: message)
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
}

private struct ConversationContextCard: View {
    let company: CompanyPayload

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
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
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .kabuyomiGlass(radius: 24)
    }
}

private struct ConversationEmptyState: View {
    let company: CompanyPayload
    let suggestions: [String]
    @Binding var draftQuestion: String

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        VStack(spacing: 24) {
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
                            endRadius: 82
                        )
                    )
                    .frame(width: 140, height: 140)

                Image(systemName: "bubble.left.and.text.bubble.right.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }

            VStack(spacing: 10) {
                Text("気になることをそのまま聞く")
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                Text(introCopy)
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 320)
            }

            HStack(spacing: 8) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 13, weight: .bold))
                Text("気になる銘柄があるなら、左上から銘柄を選択してください")
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
            }
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .kabuyomiGlass(radius: 18, tint: Color.white.opacity(0.22), stroke: Color.white.opacity(0.5))

            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button {
                        draftQuestion = suggestion
                    } label: {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Image(systemName: "arrow.up.right.circle.fill")
                                    .foregroundStyle(KabuyomiTheme.accentDeep)
                                Spacer()
                            }

                            Text(suggestion)
                                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                                .foregroundStyle(KabuyomiTheme.ink)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .multilineTextAlignment(.leading)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
                        .kabuyomiGlass(radius: 22, tint: Color.white.opacity(0.26))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 26)
        .padding(.bottom, 8)
    }

    private var introCopy: String {
        let companyName = company.companyName
        return "「今回の決算、ざっくりどうだった？」「なんで株価が動いてるの？」「悪い材料もある？ それでも強い理由は？」のように、\(companyName) で気になることを日本語でそのまま聞けます。"
    }

    private func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

private struct ConversationLoadingState: View {
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

private struct ConversationMessageRow: View {
    let company: CompanyPayload
    let message: LocalChatMessage

    var body: some View {
        VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 10) {
                if message.role != "user" {
                    avatarBubble(label: company.ticker.prefix(1), accent: false)
                } else {
                    Spacer(minLength: 42)
                }

                VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 8) {
                    Text(message.role == "user" ? "あなた" : company.ticker)
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)

                    Text(message.content)
                        .font(.system(.body, design: .rounded))
                        .foregroundStyle(message.role == "user" ? Color.white : KabuyomiTheme.ink)
                        .padding(16)
                        .background(message.role == "user" ? AnyView(userBubble) : AnyView(assistantBubble))
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
                                HStack(spacing: 6) {
                                    Text(source.sourceKind.badgeTitle)
                                        .font(.system(size: 10, weight: .bold, design: .rounded))
                                        .foregroundStyle(sourceBadgeForeground(for: source))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 3)
                                        .background(Capsule().fill(sourceBadgeBackground(for: source)))

                                    Label(source.sourceLabelSnapshot, systemImage: source.sourceKind.systemImage)
                                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                                        .foregroundStyle(KabuyomiTheme.accentDeep)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
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
            .fill(KabuyomiTheme.fill(for: .primary))
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

        if kinds.contains(.secFiling) && kinds.contains(.webSupplement) {
            return "SEC filing を起点に外部補足あり"
        }

        return kinds.first?.groundingCaption
    }

    private var groundingIcon: String {
        let kinds = Set(message.sources.map(\.sourceKind))
        if kinds.contains(.secFiling) {
            return "checkmark.shield"
        }

        return "globe"
    }

    private func sourceBadgeBackground(for source: LocalMessageSourceRef) -> Color {
        switch source.sourceKind {
        case .secFiling:
            return KabuyomiTheme.accentDeep.opacity(0.12)
        case .webSupplement:
            return Color.white.opacity(0.72)
        }
    }

    private func sourceBadgeForeground(for source: LocalMessageSourceRef) -> Color {
        switch source.sourceKind {
        case .secFiling:
            return KabuyomiTheme.accentDeep
        case .webSupplement:
            return KabuyomiTheme.inkMuted
        }
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
}

private struct AssistantTypingRow: View {
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

private struct ComposerBar: View {
    @Binding var question: String
    let isSending: Bool
    let isEnabled: Bool
    let placeholder: String
    let aiConsentGranted: Bool
    let sendAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !aiConsentGranted {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("初回送信時に Gemini 送信の同意確認が表示されます。")
                        .lineLimit(2)
                }
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.negative)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .kabuyomiGlass(radius: 16, tint: KabuyomiTheme.accentSoft.opacity(0.18), stroke: Color.white.opacity(0.48))
            }

            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)

                TextField(
                    "",
                    text: $question,
                    prompt: Text(promptText)
                        .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.82)),
                    axis: .vertical
                )
                .lineLimit(1...5)
                .disabled(!isEnabled)
                .font(.system(.body, design: .rounded))
                .foregroundStyle(KabuyomiTheme.ink)
                .frame(minHeight: 24)

                Button(action: sendAction) {
                    Group {
                        if isSending {
                            ProgressView()
                                .tint(sendDisabled ? KabuyomiTheme.inkMuted : .white)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 18, weight: .bold))
                        }
                    }
                    .frame(width: 44, height: 44)
                    .foregroundStyle(sendDisabled ? KabuyomiTheme.inkMuted : .white)
                    .background(sendButtonBackground)
                }
                .buttonStyle(.plain)
                .disabled(sendDisabled)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(composerBackground)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private var sendDisabled: Bool {
        question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending || !isEnabled
    }

    private var promptText: String {
        placeholder
    }

    private var composerBackground: some View {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
            .fill(Color.white.opacity(0.96))
            .overlay(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .stroke(Color.white.opacity(0.95), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 14, x: 0, y: 10)
    }

    private var sendButtonBackground: some View {
        Circle()
            .fill(sendDisabled ? Color(red: 0.88, green: 0.87, blue: 0.85) : KabuyomiTheme.accentDeep)
            .overlay(
                Circle()
                    .stroke(sendDisabled ? Color.white.opacity(0.9) : Color.white.opacity(0.2), lineWidth: 1)
            )
            .shadow(color: sendDisabled ? Color.clear : KabuyomiTheme.accentDeep.opacity(0.24), radius: 10, x: 0, y: 6)
    }
}

private struct ConversationLibraryDrawer: View {
    @Environment(AppModel.self) private var appModel

    @Binding var query: String
    let currentTicker: String
    let savedCompanies: [WatchlistCard]
    let recentCompanies: [WatchlistCard]
    let starterCompanies: [StarterCompany]
    let searchResults: [SearchItem]
    let isSearchLoading: Bool
    let selectTicker: (String) -> Void
    let openSearchResult: (SearchItem) -> Void
    let openSettings: () -> Void
    let close: () -> Void

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            searchField

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    contentSections
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
            }

            settingsButton
        }
        .padding(18)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Rectangle().fill(Color.white.opacity(0.28)))
                .overlay(Rectangle().stroke(Color.white.opacity(0.55), lineWidth: 1))
                .shadow(color: Color.black.opacity(0.12), radius: 18, x: 8, y: 0)
        )
    }

    @ViewBuilder
    private var contentSections: some View {
        if isSearching {
            searchSection
        } else {
            recentSection
            savedSection
            starterSection
        }
    }

    @ViewBuilder
    private var recentSection: some View {
        if !recentCompanies.isEmpty {
            DrawerSection(title: "最近の会話") {
                ForEach(recentCompanies) { company in
                    DrawerCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        subtitle: drawerSubtitle(for: company),
                        isCurrent: company.ticker == currentTicker,
                        action: { selectTicker(company.ticker) }
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var savedSection: some View {
        if !savedCompanies.isEmpty {
            DrawerSection(title: "保存した銘柄") {
                ForEach(savedCompanies) { company in
                    DrawerCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        subtitle: drawerSubtitle(for: company),
                        isCurrent: company.ticker == currentTicker,
                        action: { selectTicker(company.ticker) }
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var starterSection: some View {
        if !starterCompanies.isEmpty {
            DrawerSection(title: "スターター銘柄") {
                ForEach(starterCompanies) { company in
                    DrawerCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        subtitle: "まず質問してみる",
                        isCurrent: company.ticker == currentTicker,
                        action: { selectTicker(company.ticker) }
                    )
                }
            }
        }
    }

    private func drawerSubtitle(for company: WatchlistCard) -> String {
        "\(company.formType) ・ \(company.filedAt.formatted(date: .abbreviated, time: .omitted))"
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("会話を切り替える")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text("左から引き出すか、この一覧から銘柄を切り替えます。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Spacer()

            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 36, height: 36)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .kabuyomiCard(.secondary, radius: 18)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("一覧を閉じる")
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(KabuyomiTheme.inkMuted)
            TextField("ティッカーや企業名を検索", text: $query)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            if !query.isEmpty {
                Button {
                    query = ""
                    Task { await appModel.search(query: "") }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
        }
        .padding(14)
        .kabuyomiCard(.input, radius: 18)
    }

    private var settingsButton: some View {
        Button(action: openSettings) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("設定")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("表示・AI・利用状況・法務")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Label("開く", systemImage: "chevron.right")
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .labelStyle(.titleAndIcon)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kabuyomiCard(.secondary, radius: 22)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var searchSection: some View {
        DrawerSection(title: "検索結果") {
            if isSearchLoading {
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                    Text("検索中...")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .kabuyomiCard(.muted, radius: 18)
            } else if searchResults.isEmpty {
                Text("一致する銘柄がありません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(searchResults) { item in
                    DrawerSearchRow(item: item, action: { openSearchResult(item) })
                }
            }
        }
    }
}

private struct DrawerSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
            content
        }
    }
}

private struct DrawerCompanyRow: View {
    let ticker: String
    let companyName: String
    let subtitle: String
    let isCurrent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(ticker)
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(companyName)
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                    Text(subtitle)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                if isCurrent {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kabuyomiCard(isCurrent ? .secondary : .muted, radius: 18)
        }
        .buttonStyle(.plain)
    }
}

private struct DrawerSearchRow: View {
    let item: SearchItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.ticker)
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(item.companyName)
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                    Text("\(item.latestFormType ?? "10-K / 10-Q 対応") ・ \(item.exchange)")
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Text("開く")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kabuyomiCard(.muted, radius: 18)
        }
        .buttonStyle(.plain)
    }
}

private struct DrawerSettingsSection: View {
    @Environment(AppModel.self) private var appModel
    @Binding var settingsExpanded: Bool
    let usage: UsagePayload?
    let openLegalDocument: (DrawerLegalDocument) -> Void

    var body: some View {
        DisclosureGroup(isExpanded: $settingsExpanded) {
            VStack(alignment: .leading, spacing: 14) {
                usageCard

                Toggle(isOn: Binding(
                    get: { appModel.aiConsentGranted },
                    set: { appModel.setAIConsent($0) }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Gemini 送信への同意")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("質問内容と filing コンテキストが Google Gemini に送信されます。")
                            .font(.system(.footnote, design: .rounded))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }

                #if DEBUG
                Toggle(isOn: Binding(
                    get: { appModel.devUnlimitedModeEnabled },
                    set: { appModel.setDevUnlimitedMode($0) }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("無限チャット / 無限保存")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text(appModel.devUnlimitedModeDescription)
                            .font(.system(.footnote, design: .rounded))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
                #endif

                VStack(spacing: 8) {
                    settingsActionButton(title: "Privacy Policy", subtitle: "収集・送信・保存の方針") {
                        openLegalDocument(.privacy)
                    }
                    settingsActionButton(title: "利用条件", subtitle: "投資助言ではないこと / beta 利用条件") {
                        openLegalDocument(.terms)
                    }
                    settingsActionButton(title: "Support", subtitle: "TestFlight フィードバック案内") {
                        openLegalDocument(.support)
                    }
                }

                Button("データをリセット", role: .destructive) {
                    appModel.resetLocalData()
                }
                .font(.system(.body, design: .rounded, weight: .semibold))
            }
            .padding(.top, 12)
        } label: {
            HStack {
                Text("設定")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Spacer()
                Text(settingsExpanded ? "閉じる" : "開く")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }
        }
        .padding(16)
        .kabuyomiCard(.secondary, radius: 22)
    }

    private var usageCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("利用状況")
                .font(.system(.footnote, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.inkMuted)

            if let usage {
                Text("今日のチャット: \(usage.chatsUsed) / \(appModel.displayChatLimit(for: usage))")
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text("保存銘柄: \(usage.stocksUsed) / \(appModel.displayStockLimit(for: usage))")
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.ink)
            } else {
                Text("利用状況を読み込み中です。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.muted, radius: 18)
    }

    private func settingsActionButton(title: String, subtitle: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(.body, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(subtitle)
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kabuyomiCard(.muted, radius: 18)
        }
        .buttonStyle(.plain)
    }
}

private struct SummaryDrawer: View {
    let company: CompanyPayload
    let positiveInsights: [FilingInsight]
    let negativeInsights: [FilingInsight]
    let focusInsights: [FilingInsight]
    let openOriginal: () -> Void
    let close: () -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("要点")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("\(company.ticker) ・ \(company.formType)")
                        .font(.system(.footnote, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 36, height: 36)
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .kabuyomiCard(.secondary, radius: 18)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("要点を閉じる")
            }

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    SummaryLeadCard(company: company, openOriginal: openOriginal)
                    InvestorOverviewSnapshot(
                        company: company,
                        positiveInsights: positiveInsights,
                        negativeInsights: negativeInsights,
                        focusInsights: focusInsights
                    )
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Rectangle().fill(Color.white.opacity(0.28)))
                .overlay(Rectangle().stroke(Color.white.opacity(0.55), lineWidth: 1))
                .shadow(color: Color.black.opacity(0.12), radius: 18, x: -8, y: 0)
        )
    }
}

private struct SummaryLeadCard: View {
    let company: CompanyPayload
    let openOriginal: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(company.companyName)
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("\(company.ticker) ・ \(company.formType)")
                        .font(.system(.footnote, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Button(action: openOriginal) {
                    Label("原文", systemImage: "arrow.up.right.square")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.6)))
                }
                .buttonStyle(.plain)
            }

            if let sentence = summarySentence {
                Text(sentence)
                    .font(.system(.body, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("この filing の要点を短く押さえ、そのまま会話で深掘りできます。")
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            HStack(spacing: 10) {
                SummaryMetaPill(title: "提出日", value: company.filedAt)
                SummaryMetaPill(title: "対象期末", value: company.periodOfReport)
            }
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 26)
    }

    private var summarySentence: String? {
        guard let sentence = leadSentence(from: company.summary.verdict) else { return nil }
        let normalizedSentence = sentence.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedCompanyName = company.companyName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalizedSentence == normalizedCompanyName ? nil : sentence
    }
}

private struct SummaryMetaPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(KabuyomiTheme.inkMuted)
            Text(value)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.ink)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(KabuyomiTheme.fill(for: .secondary))
                .overlay(Capsule().stroke(KabuyomiTheme.stroke(for: .secondary), lineWidth: 1))
        )
    }
}

private struct InvestorOverviewSnapshot: View {
    let company: CompanyPayload
    let positiveInsights: [FilingInsight]
    let negativeInsights: [FilingInsight]
    let focusInsights: [FilingInsight]

    private let signalColumns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    private var tone: InvestorOverviewTone {
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

    private var orderedMetrics: [MetricPayload] {
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

    private var snapshotSignals: [InvestorSnapshotSignal] {
        let preferredTitles: [String: String] = [
            "revenue": "成長",
            "operatingIncome": "収益性",
            "operatingCashFlow": "キャッシュ",
            "netIncome": "利益",
            "epsBasic": "EPS"
        ]

        var selected: [InvestorSnapshotSignal] = []
        var seen = Set<String>()

        for logicalName in ["revenue", "operatingIncome", "operatingCashFlow", "netIncome", "epsBasic"] {
            guard let metric = orderedMetrics.first(where: { $0.logicalName == logicalName }) else { continue }
            selected.append(
                InvestorSnapshotSignal(
                    sectionTitle: preferredTitles[logicalName] ?? "注目数字",
                    metricTitle: MetricLabeler.title(for: metric.logicalName),
                    value: formattedMetricValue(metric),
                    deltaText: metric.yoyPercent.map { "前年比 \(formattedSignedYoY($0))" } ?? "比較値なし",
                    tint: tint(for: metric.yoyPercent)
                )
            )
            seen.insert(metric.logicalName)
        }

        if selected.count < 4 {
            for metric in orderedMetrics where !seen.contains(metric.logicalName) {
                selected.append(
                    InvestorSnapshotSignal(
                        sectionTitle: "注目数字",
                        metricTitle: MetricLabeler.title(for: metric.logicalName),
                        value: formattedMetricValue(metric),
                        deltaText: metric.yoyPercent.map { "前年比 \(formattedSignedYoY($0))" } ?? "比較値なし",
                        tint: tint(for: metric.yoyPercent)
                    )
                )
                if selected.count == 4 {
                    break
                }
            }
        }

        return selected
    }

    private var keyMetrics: [MetricPayload] {
        Array(orderedMetrics.prefix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Overview")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("投資家が上から順に読める形に整理")
                            .font(.system(.footnote, design: .rounded))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }

                    Spacer()

                    InvestorToneBadge(tone: tone)
                }

                Text(tone.supportingCopy)
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineSpacing(3)

                HStack(spacing: 8) {
                    OverviewCountBadge(title: "追い風", count: positiveInsights.count, tint: KabuyomiTheme.positive)
                    OverviewCountBadge(title: "逆風", count: negativeInsights.count, tint: KabuyomiTheme.negative)
                    OverviewCountBadge(title: "論点", count: focusInsights.count, tint: KabuyomiTheme.accentDeep)
                }

                LazyVGrid(columns: signalColumns, spacing: 10) {
                    ForEach(snapshotSignals) { signal in
                        InvestorSignalCard(signal: signal)
                    }
                }
            }
            .padding(18)
            .kabuyomiCard(.primary, radius: 24)

            InvestorMetricMapCard(metrics: keyMetrics)

            InvestorDriverBoard(
                company: company,
                positiveInsights: Array(positiveInsights.prefix(3)),
                negativeInsights: Array(negativeInsights.prefix(3))
            )

            InvestorFocusBoard(
                company: company,
                focusInsights: Array(focusInsights.prefix(3))
            )
        }
    }

    private func tint(for yoy: Double?) -> Color {
        guard let yoy else { return KabuyomiTheme.accentDeep }
        return yoy >= 0 ? KabuyomiTheme.positive : KabuyomiTheme.negative
    }
}

private enum InvestorOverviewTone {
    case positive
    case mixed
    case negative

    var title: String {
        switch self {
        case .positive:
            return "改善優勢"
        case .mixed:
            return "強弱まちまち"
        case .negative:
            return "悪化優勢"
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
            return "数字と本文を並べると、今回はポジティブ要因がやや優勢です。まずは伸びた数字の持続性を確認したい局面です。"
        case .mixed:
            return "良化と悪化が混在しています。強い数字と弱い数字を分けて見ると、決算の解像度が上がります。"
        case .negative:
            return "悪化シグナルがやや多めです。一時要因か構造要因かを優先して切り分けたい局面です。"
        }
    }
}

private struct InvestorSnapshotSignal: Identifiable {
    let id = UUID()
    let sectionTitle: String
    let metricTitle: String
    let value: String
    let deltaText: String
    let tint: Color
}

private struct InvestorToneBadge: View {
    let tone: InvestorOverviewTone

    var body: some View {
        Text(tone.title)
            .font(.system(.footnote, design: .rounded, weight: .bold))
            .foregroundStyle(tone.tint)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(tone.tint.opacity(0.14)))
    }
}

private struct OverviewCountBadge: View {
    let title: String
    let count: Int
    let tint: Color

    var body: some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .bold))
            Text("\(count)")
                .font(.system(.caption, design: .rounded, weight: .bold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Capsule().fill(tint.opacity(0.12)))
    }
}

private struct InvestorSignalCard: View {
    let signal: InvestorSnapshotSignal

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(signal.sectionTitle)
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(signal.tint)

            Text(signal.metricTitle)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.ink)
                .lineLimit(1)

            Text(signal.value)
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text(signal.deltaText)
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(signal.tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .kabuyomiCard(.secondary, radius: 20)
    }
}

private struct InvestorMetricMapCard: View {
    let metrics: [MetricPayload]

    private var maxMagnitude: Double {
        max(metrics.compactMap(\.yoyPercent).map(abs).max() ?? 0, 10)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "chart.bar.xaxis")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 2) {
                    Text("数字の温度感")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("主要指標の増減をひと目で確認")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            if metrics.isEmpty {
                Text("比較できる主要指標はまだ抽出されていません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(metrics) { metric in
                    InvestorMetricMapRow(metric: metric, maxMagnitude: maxMagnitude)
                }
            }
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
    }
}

private struct InvestorMetricMapRow: View {
    let metric: MetricPayload
    let maxMagnitude: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(MetricLabeler.title(for: metric.logicalName))
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(formattedMetricValue(metric))
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                }

                Spacer(minLength: 0)

                Text(metric.yoyPercent.map { formattedSignedYoY($0) } ?? "YoY なし")
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(metricTint)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(metricTint.opacity(0.14)))
            }

            InvestorDeltaBar(yoyPercent: metric.yoyPercent, maxMagnitude: maxMagnitude)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.secondary, radius: 20)
    }

    private var metricTint: Color {
        guard let yoy = metric.yoyPercent else { return KabuyomiTheme.inkMuted }
        return yoy >= 0 ? KabuyomiTheme.positive : KabuyomiTheme.negative
    }
}

private struct InvestorDeltaBar: View {
    let yoyPercent: Double?
    let maxMagnitude: Double

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let filledWidth = max(4, (width / 2) * normalizedMagnitude)

            ZStack {
                Capsule()
                    .fill(KabuyomiTheme.mist.opacity(0.58))

                Rectangle()
                    .fill(Color.white.opacity(0.9))
                    .frame(width: 1)

                if yoyPercent != nil {
                    Capsule()
                        .fill(fillColor)
                        .frame(width: filledWidth)
                        .offset(x: horizontalOffset(for: filledWidth))
                }
            }
        }
        .frame(height: 10)
        .accessibilityLabel(accessibilityLabel)
    }

    private var normalizedMagnitude: Double {
        guard let yoyPercent else { return 0 }
        return min(abs(yoyPercent) / maxMagnitude, 1)
    }

    private var fillColor: Color {
        guard let yoyPercent else { return KabuyomiTheme.inkMuted }
        return yoyPercent >= 0 ? KabuyomiTheme.positive : KabuyomiTheme.negative
    }

    private var accessibilityLabel: String {
        guard let yoyPercent else { return "前年比データなし" }
        return yoyPercent >= 0 ? "前年比プラス" : "前年比マイナス"
    }

    private func horizontalOffset(for filledWidth: CGFloat) -> CGFloat {
        guard let yoyPercent else { return 0 }
        let direction: CGFloat = yoyPercent >= 0 ? 1 : -1
        return direction * (filledWidth / 2)
    }
}

private struct InvestorDriverBoard: View {
    let company: CompanyPayload
    let positiveInsights: [FilingInsight]
    let negativeInsights: [FilingInsight]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.left.arrow.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 2) {
                    Text("何が効いたか")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("追い風と逆風を分けて把握")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            InvestorInsightLane(
                company: company,
                title: "追い風",
                subtitle: "数字や本文で支えた要因",
                tint: KabuyomiTheme.positive,
                systemImage: "arrow.up.right.circle.fill",
                insights: positiveInsights,
                emptyMessage: "明確な追い風はまだ切り出されていません。"
            )

            InvestorInsightLane(
                company: company,
                title: "逆風",
                subtitle: "悪化した数字や気になる論点",
                tint: KabuyomiTheme.negative,
                systemImage: "arrow.down.right.circle.fill",
                insights: negativeInsights,
                emptyMessage: "明確な逆風はまだ切り出されていません。"
            )
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
    }
}

private struct InvestorInsightLane: View {
    let company: CompanyPayload
    let title: String
    let subtitle: String
    let tint: Color
    let systemImage: String
    let insights: [FilingInsight]
    let emptyMessage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(tint.opacity(0.14)))

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(subtitle)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            if insights.isEmpty {
                Text(emptyMessage)
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(Array(insights.enumerated()), id: \.element.id) { index, insight in
                    InvestorInsightRow(
                        company: company,
                        index: index + 1,
                        insight: insight,
                        tint: tint
                    )
                }
            }
        }
    }
}

private struct InvestorInsightRow: View {
    let company: CompanyPayload
    let index: Int
    let insight: FilingInsight
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(index)")
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(Circle().fill(tint.opacity(0.14)))

            VStack(alignment: .leading, spacing: 10) {
                Text(insight.text)
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)

                InsightSourceChips(company: company, sourceIds: insight.sourceIds)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.secondary, radius: 20)
    }
}

private struct InvestorFocusBoard: View {
    let company: CompanyPayload
    let focusInsights: [FilingInsight]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 2) {
                    Text("次に詰める論点")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("会話で深掘りする順番まで見える形に")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            if focusInsights.isEmpty {
                Text("質問で深掘りしやすい論点はまだ抽出されていません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(Array(focusInsights.enumerated()), id: \.element.id) { index, insight in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 10) {
                            Text("Q\(index + 1)")
                                .font(.system(.caption, design: .rounded, weight: .bold))
                                .foregroundStyle(KabuyomiTheme.accentDeep)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                            Text(insight.text)
                                .font(.system(.body, design: .rounded))
                                .foregroundStyle(KabuyomiTheme.inkSoft)
                                .lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        InsightSourceChips(company: company, sourceIds: insight.sourceIds)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.secondary, radius: 20)
                }
            }
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
    }
}

private struct InsightSourceChips: View {
    let company: CompanyPayload
    let sourceIds: [String]

    private var chips: [String] {
        var seen = Set<String>()
        return sourceIds.compactMap { sourceId in
            guard let chunk = company.sourceChunks.first(where: { $0.sourceId == sourceId }) else {
                let fallback = "出典 \(sourceId)"
                return seen.insert(fallback).inserted ? fallback : nil
            }

            let label = sourceChipLabel(for: chunk)
            return seen.insert(label).inserted ? label : nil
        }
    }

    var body: some View {
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(chips.prefix(2)), id: \.self) { chip in
                        Label(chip, systemImage: "bookmark")
                            .font(.system(.caption2, design: .rounded, weight: .semibold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
                    }

                    if chips.count > 2 {
                        Text("+\(chips.count - 2)")
                            .font(.system(.caption2, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
                    }
                }
            }
        }
    }

    private func sourceChipLabel(for chunk: SourceChunkPayload) -> String {
        if chunk.sectionType == "xbrl_metric" {
            return "主要指標"
        }

        let raw = chunk.sectionTitle.isEmpty ? chunk.sourceLabel : chunk.sectionTitle
        let lowercased = raw.lowercased()

        if lowercased.contains("management's discussion") || lowercased.contains("results of operations") {
            return "MD&A"
        }

        if lowercased.contains("risk") {
            return "Risk"
        }

        if let range = raw.range(of: #"Item\s+\d+[A-Za-z]?"#, options: .regularExpression) {
            return String(raw[range])
        }

        if raw.count > 18 {
            let endIndex = raw.index(raw.startIndex, offsetBy: 18)
            return String(raw[..<endIndex]) + "…"
        }

        return raw
    }
}

private struct EdgePullZone: View {
    let edge: HorizontalEdge
    let action: () -> Void

    var body: some View {
        Rectangle()
            .fill(Color.clear)
            .frame(width: 18)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 22)
                    .onEnded { value in
                        switch edge {
                        case .leading where value.translation.width > 60:
                            action()
                        case .trailing where value.translation.width < -60:
                            action()
                        default:
                            break
                        }
                    }
            )
    }
}

private struct DrawerLegalDocumentView: View {
    let document: DrawerLegalDocument

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(document.title)
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.heroText)
                    Text(document.subtitle)
                        .font(.system(.body, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.heroSubtext)
                }
                .padding(22)
                .frame(maxWidth: .infinity, alignment: .leading)
                .kabuyomiCard(.hero, radius: 28)

                ForEach(document.sections) { section in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(section.title)
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text(section.body)
                            .font(.system(.body, design: .rounded))
                            .foregroundStyle(KabuyomiTheme.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.primary, radius: 24)
                }
            }
            .padding(20)
        }
        .background(KabuyomiTheme.background.ignoresSafeArea())
        .navigationTitle(document.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private func buildFocusInsights(for company: CompanyPayload) -> [FilingInsight] {
    let highlights = company.summary.highlights.map { FilingInsight(text: $0.text, sourceIds: $0.sourceIds) }
    if !highlights.isEmpty {
        return highlights
    }
    return buildMetricInsights(for: company).filter { $0.text.contains("前年比") }
}

private func buildPositiveInsights(for company: CompanyPayload) -> [FilingInsight] {
    let positives = company.summary.changes
        .filter { sentiment(for: $0.text) == .positive }
        .map { FilingInsight(text: $0.text, sourceIds: $0.sourceIds) }
    if !positives.isEmpty {
        return positives
    }

    return buildMetricInsights(for: company).filter { sentiment(for: $0.text) == .positive }
}

private func buildNegativeInsights(for company: CompanyPayload) -> [FilingInsight] {
    let negatives = company.summary.changes
        .filter { sentiment(for: $0.text) == .negative }
        .map { FilingInsight(text: $0.text, sourceIds: $0.sourceIds) }
    if !negatives.isEmpty {
        return negatives
    }

    return buildMetricInsights(for: company).filter { sentiment(for: $0.text) == .negative }
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

private func buildSuggestedQuestions(for company: CompanyPayload) -> [String] {
    var suggestions: [String] = []
    let hasNegative = !buildNegativeInsights(for: company).isEmpty
    let hasPositive = !buildPositiveInsights(for: company).isEmpty

    suggestions.append("今回の決算、ざっくりどうだった？")
    suggestions.append("なんで株価が動いてるの？")
    if hasNegative {
        suggestions.append("悪い材料もある？ それでも強い理由は？")
    } else if hasPositive {
        suggestions.append("今回いちばん強かった点は？")
    }

    if let revenue = company.metrics.first(where: { $0.logicalName == "revenue" }),
       let yoy = revenue.yoyPercent {
        suggestions.append(yoy >= 0 ? "何が伸びを支えたの？" : "何が弱かったの？")
    } else if let lead = buildFocusInsights(for: company).first {
        suggestions.append("「\(questionSnippet(from: lead.text))」をかんたんに言うと？")
    } else if let featuredMetricQuestion = buildFeaturedMetricQuestion(for: company) {
        suggestions.append(featuredMetricQuestion)
    }

    if let operatingIncome = company.metrics.first(where: { $0.logicalName == "operatingIncome" }),
       let yoy = operatingIncome.yoyPercent {
        suggestions.append(yoy >= 0 ? "利益率はよくなった？" : "利益率が悪くなった理由は？")
    }

    if company.metrics.contains(where: { $0.logicalName == "operatingCashFlow" }) {
        suggestions.append("お金はちゃんと稼げてる？")
    }

    if hasNegative {
        suggestions.append("今いちばん気をつける点は？")
    }

    if suggestions.count < 5 {
        suggestions.append("この会社、今どう見るといい？")
    }

    return deduplicated(suggestions).prefix(5).map(\.self)
}

private func buildFeaturedMetricQuestion(for company: CompanyPayload) -> String? {
    let preferredMetricOrder = ["revenue", "operatingIncome", "netIncome", "epsBasic", "operatingCashFlow"]
    for logicalName in preferredMetricOrder {
        guard let metric = company.metrics.first(where: { $0.logicalName == logicalName }),
              let yoy = metric.yoyPercent else { continue }
        return "\(MetricLabeler.title(for: metric.logicalName)) \(formattedSignedYoY(yoy)) を詳しく教えて"
    }

    guard let metric = company.metrics.first(where: { $0.yoyPercent != nil }),
          let yoy = metric.yoyPercent else { return nil }
    return "\(MetricLabeler.title(for: metric.logicalName)) \(formattedSignedYoY(yoy)) を詳しく教えて"
}

private func filterCards(_ cards: [WatchlistCard], query: String) -> [WatchlistCard] {
    let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalized.isEmpty else { return cards }

    return cards.filter { card in
        card.ticker.lowercased().contains(normalized) || card.companyName.lowercased().contains(normalized)
    }
}

private func filterStarters(_ starters: [StarterCompany], query: String) -> [StarterCompany] {
    let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalized.isEmpty else { return starters }

    return starters.filter { starter in
        starter.ticker.lowercased().contains(normalized) || starter.companyName.lowercased().contains(normalized)
    }
}

private enum InsightSentiment {
    case positive
    case negative
    case neutral
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

private func questionSnippet(from text: String) -> String {
    let cleaned = text
        .replacingOccurrences(of: "。", with: "")
        .replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    if cleaned.count <= 26 {
        return cleaned
    }

    let endIndex = cleaned.index(cleaned.startIndex, offsetBy: 26)
    return String(cleaned[..<endIndex]) + "…"
}

private func deduplicated(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.filter { seen.insert($0).inserted }
}

private func formattedMetricValue(_ metric: MetricPayload) -> String {
    if metric.logicalName == "epsBasic" {
        return metric.value.formatted(.number.precision(.fractionLength(2)))
    }
    return metric.value.formatted(.number.notation(.compactName))
}

private func formattedYoY(_ yoyPercent: Double) -> String {
    "\(yoyPercent.formatted(.number.precision(.fractionLength(1))))%"
}

private func formattedSignedYoY(_ yoyPercent: Double) -> String {
    let sign = yoyPercent >= 0 ? "+" : ""
    return "\(sign)\(formattedYoY(yoyPercent))"
}

private func leadSentence(from text: String) -> String? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    let delimiters: [Character] = ["。", ".", "!", "?", "！", "？"]
    if let index = trimmed.firstIndex(where: { delimiters.contains($0) }) {
        let sentence = trimmed[...index].trimmingCharacters(in: .whitespacesAndNewlines)
        return sentence.isEmpty ? nil : String(sentence)
    }

    return trimmed
}

private extension View {
    func kabuyomiGlass(
        radius: CGFloat = 26,
        tint: Color = Color.white.opacity(0.34),
        stroke: Color = Color.white.opacity(0.72)
    ) -> some View {
        background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(tint)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(stroke, lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.08), radius: 14, x: 0, y: 10)
        )
    }
}
