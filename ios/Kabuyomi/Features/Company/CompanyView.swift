import SwiftUI

private enum CompanySidePanel {
    case library
    case summary
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

    init(ticker: String) {
        _currentTicker = State(initialValue: ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())
    }

    private var company: CompanyPayload? {
        appModel.companyPayload(for: currentTicker)
    }

    private var chatHistory: [LocalChatMessage] {
        appModel.chatHistory(for: currentTicker)
    }

    private var pendingChat: PendingChatState? {
        appModel.pendingChat(for: currentTicker)
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

    private var isCurrentTickerSaved: Bool {
        appModel.isTickerInWatchlist(currentTicker, cik: company?.cik)
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
                    ZStack(alignment: .leading) {
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

                        CompanyDrawerEdgeBlendLayer(style: .library)
                    }
                    .frame(maxWidth: 356, maxHeight: .infinity)
                    Spacer(minLength: 0)
                }
                .transition(.move(edge: .leading).combined(with: .opacity))
            }

            if activePanel == .summary, let company {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    ZStack(alignment: .trailing) {
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

                        CompanyDrawerEdgeBlendLayer(style: .summary)
                    }
                    .frame(maxWidth: 372, maxHeight: .infinity)
                }
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }

            if activePanel == nil {
                edgeSwipeHotspots
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: currentTicker) {
            if let pendingQuestion = appModel.consumePendingDraftQuestion(for: currentTicker),
               question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                question = pendingQuestion
            }
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
                canOpenSummary: company != nil,
                openLibrary: { openPanel(.library) },
                openSummary: {
                    if company != nil {
                        openPanel(.summary)
                    }
                },
                toggleSaved: toggleSavedState,
                refresh: refreshCurrentCompany
            )

            if let company {
                ConversationTimeline(
                    company: company,
                    chatHistory: chatHistory,
                    pendingChat: pendingChat,
                    isSending: appModel.chatIsSending,
                    suggestions: buildSuggestedQuestions(for: company),
                    historicalSuggestions: buildHistoricalQuestions(for: company),
                    draftQuestion: $question
                )
            } else {
                ConversationLoadingState(ticker: currentTicker, isLoading: appModel.companyIsLoading)
            }
        }
        .safeAreaInset(edge: .bottom) {
            ComposerBar(
                question: $question,
                isSending: appModel.chatIsSending,
                isEnabled: company != nil,
                placeholder: composerPlaceholder,
                aiConsentGranted: appModel.aiConsentGranted,
                applyPrompt: { question = $0 },
                sendAction: sendCurrentQuestion
            )
        }
    }

    private var composerPlaceholder: String {
        guard let company else {
            if appModel.companyIsLoading {
                return "\(currentTicker) を読み込み中..."
            }

            return "\(currentTicker) を開けませんでした。左上から別の銘柄を選択してください"
        }

        let suggestions = buildSuggestedQuestions(for: company)
        if let firstSuggestion = suggestions.first {
            return "この決算で気になる点を聞く\n例: \(firstSuggestion)"
        }

        return "この決算で気になる点を聞く\n例: 利益率は改善した？"
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
                await appModel.removeFromWatchlist(currentTicker)
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
        let prompt = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }

        question = ""
        Task {
            let didSend = await appModel.sendChat(question: prompt, ticker: currentTicker)
            if !didSend && question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                question = prompt
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
        guard item.isSupportedInV1 else {
            appModel.activeAlert = AppAlertState(
                message: item.unsupportedAlertMessage,
                kind: .dismissOnly
            )
            return
        }

        let normalized = item.ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if appModel.isTickerInWatchlist(normalized, cik: item.cik) {
            selectTicker(normalized)
            return
        }

        Task {
            await appModel.addToWatchlist(item)
            if appModel.isTickerInWatchlist(normalized, cik: item.cik) {
                selectTicker(normalized)
            }
        }
    }

    private func openPrimaryDocument(urlString: String) {
        guard let url = URL(string: urlString) else { return }
        openURL(url)
    }
}

func buildSuggestedQuestions(for company: CompanyPayload) -> [String] {
    var suggestions: [String] = []

    suggestions.append("今回の一番大きい変化は？")

    if let revenue = company.metrics.first(where: { $0.logicalName == "revenue" }),
       let yoy = revenue.yoyPercent {
        suggestions.append(yoy >= 0 ? "売上成長を支えた要因は？" : "売上が弱かった要因は？")
    } else if let featuredMetricQuestion = buildFeaturedMetricQuestion(for: company) {
        suggestions.append(featuredMetricQuestion)
    }

    if let operatingIncome = company.metrics.first(where: { $0.logicalName == "operatingIncome" }),
       let yoy = operatingIncome.yoyPercent {
        suggestions.append(yoy >= 0 ? "利益率は改善した？" : "利益率が悪化した理由は？")
    }

    if let managementQuestion = buildManagementQuestion(for: company) {
        suggestions.append(managementQuestion)
    }

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
    var suggestions = [
        isQuarterly ? "前回四半期との違いは？" : "前回決算との違いは？",
        isQuarterly ? "この3年の同四半期で利益率は改善した？" : "この3年の利益率推移は？",
        isQuarterly ? "この3年の同四半期で売上ドライバーはどう変わった？" : "この3年で売上ドライバーはどう変わった？",
        isQuarterly ? "この3年の同四半期で見ると？" : "この3年の年次比較で見ると？"
    ]

    if company.metrics.contains(where: { $0.logicalName == "operatingIncome" && $0.yoyPercent != nil }) {
        suggestions.insert(
            isQuarterly ? "この3年の同四半期で営業利益率はどう動いた？" : "この3年の営業利益率推移は？",
            at: 2
        )
    }

    return deduplicated(suggestions).prefix(4).map(\.self)
}

func buildRecoveryQuestions(for company: CompanyPayload, precedingUserPrompt: String? = nil) -> [String] {
    if let precedingUserPrompt, isComparisonQuestionText(precedingUserPrompt) {
        return Array(buildHistoricalQuestions(for: company).prefix(3))
    }

    var suggestions: [String] = []

    if let revenue = company.metrics.first(where: { $0.logicalName == "revenue" }),
       let yoy = revenue.yoyPercent {
        suggestions.append(yoy >= 0 ? "売上成長の要因は？" : "売上が弱かった要因は？")
    }

    if let operatingIncome = company.metrics.first(where: { $0.logicalName == "operatingIncome" }),
       let yoy = operatingIncome.yoyPercent {
        suggestions.append(yoy >= 0 ? "利益率は改善した？" : "利益率が悪化した理由は？")
    }

    if let managementQuestion = buildManagementQuestion(for: company) {
        suggestions.append(managementQuestion)
    }

    if let lead = buildFocusInsights(for: company).first {
        suggestions.append("「\(questionSnippet(from: lead.text))」をかみ砕くと？")
    }

    if suggestions.count < 3 {
        suggestions.append("前回決算との違いは？")
    }

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
        suggestions.append(isQuarterly ? "この3年の同四半期でも改善している？" : "この3年でも改善している？")
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

    return deduplicated(suggestions)
        .filter { $0 != precedingUserPrompt }
        .prefix(3)
        .map(\.self)
}

private func buildManagementQuestion(for company: CompanyPayload) -> String? {
    let texts = company.summary.highlights.map(\.text) + company.summary.changes.map(\.text)
    let cautionKeywords = [
        "慎重", "需要", "見通し", "ガイダンス", "在庫", "価格", "マクロ",
        "soft", "demand", "guidance", "inventory", "pricing", "macro"
    ]

    if texts.contains(where: { text in
        let lowered = text.lowercased()
        return cautionKeywords.contains(where: { lowered.contains($0.lowercased()) })
    }) {
        return "経営陣は何を慎重視している？"
    }

    if !buildFocusInsights(for: company).isEmpty {
        return "経営陣が強調している論点は？"
    }

    return nil
}

private func buildFeaturedMetricQuestion(for company: CompanyPayload) -> String? {
    let preferredMetricOrder = ["revenue", "operatingIncome", "netIncome", "epsBasic", "operatingCashFlow"]
    for logicalName in preferredMetricOrder {
        guard let metric = company.metrics.first(where: { $0.logicalName == logicalName }),
              metric.yoyPercent != nil else { continue }
        return "\(MetricLabeler.title(for: metric.logicalName))の変化を詳しく教えて"
    }

    guard let metric = company.metrics.first(where: { $0.yoyPercent != nil }) else { return nil }
    return "\(MetricLabeler.title(for: metric.logicalName))の変化を詳しく教えて"
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

func isHistoricalQuestionText(_ text: String) -> Bool {
    let normalized = text.lowercased()
    let patterns = [
        "前回",
        "前年",
        "昨年",
        "推移",
        "3年",
        "三年",
        "同四半期",
        "trend",
        "history",
        "historical"
    ]

    return containsAny(normalized, patterns: patterns)
}

private func containsAny(_ text: String, patterns: [String]) -> Bool {
    patterns.contains { pattern in
        text.contains(pattern.lowercased())
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

struct CompanyDrawerShellFadeMask: View {
    let topFade: CGFloat
    let bottomFade: CGFloat

    init(topFade: CGFloat = 22, bottomFade: CGFloat = 30) {
        self.topFade = topFade
        self.bottomFade = bottomFade
    }

    var body: some View {
        GeometryReader { proxy in
            let height = max(proxy.size.height, 1)
            let topStop = min(topFade / height, 0.22)
            let bottomStart = max(1 - (bottomFade / height), topStop)

            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .black, location: topStop),
                    .init(color: .black, location: bottomStart),
                    .init(color: .clear, location: 1)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
}

private enum CompanyDrawerBlendStyle {
    case library
    case summary
}

private struct CompanyDrawerEdgeBlendLayer: View {
    let style: CompanyDrawerBlendStyle

    var body: some View {
        VStack(spacing: 0) {
            edgeBand(top: true)
            Spacer(minLength: 0)
            edgeBand(top: false)
        }
        .compositingGroup()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func edgeBand(top: Bool) -> some View {
        let bandHeight = top ? 36.0 : 42.0

        ZStack {
            Rectangle()
                .fill(sceneGradient(top: top))

            Rectangle()
                .fill(shellGradient(top: top))
        }
        .mask(edgeMask(top: top))
        .frame(height: bandHeight)
        .blur(radius: top ? 8 : 10)
        .opacity(top ? 0.58 : 0.5)
    }

    private func sceneGradient(top: Bool) -> LinearGradient {
        let anchorColors = top
            ? [
                Color(red: 0.995, green: 0.985, blue: 0.97).opacity(0.62),
                Color.white.opacity(0.34),
                Color(red: 0.97, green: 0.94, blue: 0.89).opacity(0.08)
            ]
            : [
                Color(red: 0.93, green: 0.90, blue: 0.84).opacity(0.08),
                Color(red: 0.97, green: 0.94, blue: 0.89).opacity(0.26),
                Color(red: 0.995, green: 0.985, blue: 0.97).opacity(0.56)
            ]

        return LinearGradient(
            colors: anchorColors,
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private func shellGradient(top: Bool) -> LinearGradient {
        let leadColor: Color = switch style {
        case .library:
            Color.white.opacity(top ? 0.44 : 0.36)
        case .summary:
            KabuyomiTheme.paper.opacity(top ? 0.54 : 0.44)
        }

        let materialTint: Color = switch style {
        case .library:
            Color.white.opacity(top ? 0.12 : 0.08)
        case .summary:
            KabuyomiTheme.accentMist.opacity(top ? 0.16 : 0.12)
        }

        return LinearGradient(
            stops: top
                ? [
                    .init(color: leadColor, location: 0),
                    .init(color: materialTint, location: 0.42),
                    .init(color: .clear, location: 1)
                ]
                : [
                    .init(color: .clear, location: 0),
                    .init(color: materialTint, location: 0.58),
                    .init(color: leadColor, location: 1)
                ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private func edgeMask(top: Bool) -> LinearGradient {
        LinearGradient(
            stops: top
                ? [
                    .init(color: .black, location: 0),
                    .init(color: .black.opacity(0.84), location: 0.34),
                    .init(color: .clear, location: 1)
                ]
                : [
                    .init(color: .clear, location: 0),
                    .init(color: .black.opacity(0.84), location: 0.66),
                    .init(color: .black, location: 1)
                ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
