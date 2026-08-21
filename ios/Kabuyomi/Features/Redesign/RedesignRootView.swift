import SwiftUI

enum RedesignTab: Hashable {
    case research
    case history
    case settings
}

private enum RedesignResearchRoute: Hashable {
    case company(String)
    case sources(String)
    case source(String, LocalMessageSourceRef)
}

private enum RedesignSettingsRoute: Hashable {
    case credits
    case details
}

struct RedesignRootView: View {
    @Environment(AppModel.self) private var appModel
    @State private var selectedTab: RedesignTab = .research
    @State private var creditsPresented = false
    @State private var creditInitialSheet: CreditInitialSheet?
    @State private var requestedResearchTicker: String?

    var body: some View {
        TabView(selection: $selectedTab) {
            RedesignResearchRoot(
                openCredits: openCredits,
                requestedTicker: $requestedResearchTicker
            )
            .tag(RedesignTab.research)
            .tabItem {
                Label("リサーチ", systemImage: "doc.text.magnifyingglass")
            }
            .accessibilityIdentifier("redesign.tab.research")

            NavigationStack {
                RedesignHistoryView(
                    openResearch: { selectedTab = .research },
                    openCompany: { ticker, filingKey in
                        appModel.openConversation(for: ticker, filingKey: filingKey)
                        requestedResearchTicker = ticker
                        selectedTab = .research
                    }
                )
            }
            .tag(RedesignTab.history)
            .tabItem {
                Label("履歴", systemImage: "clock.arrow.circlepath")
            }
            .accessibilityIdentifier("redesign.tab.history")

            RedesignSettingsRoot()
            .tag(RedesignTab.settings)
            .tabItem {
                Label("設定", systemImage: "gearshape")
            }
            .accessibilityIdentifier("redesign.tab.settings")
        }
        .tint(KabuyomiTheme.accentDeep)
        .sheet(isPresented: $creditsPresented) {
            CreditView(initialSheet: creditInitialSheet)
                .interactiveDismissDisabled(true)
        }
        .onChange(of: creditsPresented) { _, isPresented in
            if !isPresented {
                creditInitialSheet = nil
            }
        }
        .onChange(of: appModel.insufficientCreditRecoveryRequestID) { _, requestID in
            guard requestID != nil else { return }
            let required = appModel.insufficientCreditRecovery?.requiredCredits ?? appModel.chatCreditCost
            selectedTab = .settings
            openCredits(.insufficientCredits(requiredCredits: required))
        }
        .onChange(of: appModel.rewardedAdReturnRestorationRequestID) { _, _ in
            guard appModel.rewardedAdReturnDestination == .credits,
                  appModel.shouldRestoreRewardedAdReturnDestination else { return }
            selectedTab = .settings
            openCredits(nil)
            appModel.confirmRewardedAdReturnDestinationRestored(visibleSurface: "redesign_credits")
        }
    }

    private func openCredits(_ initialSheet: CreditInitialSheet?) {
        creditInitialSheet = initialSheet
        creditsPresented = true
    }
}

private struct RedesignSettingsRoot: View {
    @State private var path: [RedesignSettingsRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            RedesignSettingsView()
                .navigationDestination(for: RedesignSettingsRoute.self) { route in
                    switch route {
                    case .credits:
                        CreditView(showsDismissButton: false)
                    case .details:
                        SettingsView(showsDismissButton: false)
                    }
                }
        }
    }
}

private struct RedesignResearchRoot: View {
    @Environment(AppModel.self) private var appModel
    let openCredits: (CreditInitialSheet?) -> Void
    @Binding var requestedTicker: String?
    @State private var path: [RedesignResearchRoute] = []
    @State private var didRestoreNavigation = false

    var body: some View {
        NavigationStack(path: $path) {
            RedesignCompanyDiscoveryView(openedCompany: openCompany)
                .navigationDestination(for: RedesignResearchRoute.self) { route in
                    destination(for: route)
                }
        }
        .kabuyomiEdgeSwipeBack(enabled: !path.isEmpty) {
            guard !path.isEmpty else { return }
            path.removeLast()
        }
        .task {
            guard !didRestoreNavigation else { return }
            didRestoreNavigation = true
            if !appModel.shouldShowConversationEntry {
                openCompany(appModel.rootConversationTicker)
            }
        }
        .onChange(of: requestedTicker) { _, ticker in
            guard didRestoreNavigation, let ticker else { return }
            let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            if normalized.isEmpty {
                requestedTicker = nil
                return
            }
            path = [.company(normalized)]
            requestedTicker = nil
        }
    }

    @ViewBuilder
    private func destination(for route: RedesignResearchRoute) -> some View {
        switch route {
        case .company(let ticker):
            RedesignCompanyWorkspace(
                ticker: ticker,
                openCredits: openCredits,
                openSources: { path.append(.sources(ticker)) },
                openSource: { path.append(.source(ticker, $0)) }
            )
            .id(ticker)
        case .sources(let ticker):
            if let company = appModel.companyPayload(for: ticker) {
                RedesignSourceBrowser(
                    company: company,
                    selectFiling: { filingKey in
                        appModel.openConversation(for: ticker, filingKey: filingKey)
                        path = [.company(ticker)]
                    },
                    openSource: { path.append(.source(ticker, $0)) }
                )
            } else {
                ProgressView("資料を準備しています")
                    .task { await appModel.loadCompany(ticker: ticker) }
            }
        case .source(let ticker, let source):
            if let company = appModel.companyPayload(for: ticker) {
                RedesignSourceDetail(company: company, source: source)
            } else {
                ProgressView("根拠を準備しています")
                    .task { await appModel.loadCompany(ticker: ticker) }
            }
        }
    }

    private func openCompany(_ ticker: String) {
        let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else { return }
        path = [.company(normalized)]
    }
}

private struct RedesignCompanyDiscoveryView: View {
    @Environment(AppModel.self) private var appModel
    var openedCompany: (String) -> Void = { _ in }
    @State private var query = ""
    @State private var searchTask: Task<Void, Never>?

    private var recentCompanies: [WatchlistCard] {
        appModel.recentCompanyCards(limit: 5, includeSaved: true)
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("SEC資料から、会社を理解する")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.primary)
                    Text("10-K / 10-Qを日本語で読み、根拠を確認しながら質問できます。投資助言や売買推奨は行いません。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }

            if appModel.searchIsLoading {
                Section {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("銘柄を検索中…")
                            .foregroundStyle(.secondary)
                    }
                }
            } else if let message = appModel.searchErrorMessage {
                Section {
                    ContentUnavailableView {
                        Label("検索できませんでした", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("再検索") {
                            searchNow()
                        }
                    }
                }
            } else if !appModel.searchResults.isEmpty {
                Section("検索結果") {
                    ForEach(appModel.searchResults) { item in
                        RedesignSearchResultRow(item: item, opened: openedCompany)
                    }
                }
            } else {
                if !recentCompanies.isEmpty {
                    Section("最近開いた会社") {
                        ForEach(recentCompanies) { company in
                            RedesignCompanyRow(
                                ticker: company.ticker,
                                companyName: company.companyName,
                                detail: filingDetail(company),
                                isSaved: appModel.isTickerInWatchlist(company.ticker)
                            ) {
                                appModel.openConversation(for: company.ticker)
                                openedCompany(company.ticker)
                            }
                        }
                    }
                }

                if appModel.showStarterCompanies {
                    Section("はじめに見る会社") {
                        ForEach(appModel.starterCompanies) { company in
                            RedesignCompanyRow(
                                ticker: company.ticker,
                                companyName: company.companyName,
                                detail: "10-K / 10-Qを確認",
                                isSaved: false
                            ) {
                                appModel.openConversation(for: company.ticker)
                                openedCompany(company.ticker)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(KabuyomiTheme.canvas)
        .navigationTitle("リサーチ")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "ティッカーまたは会社名")
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
        .onSubmit(of: .search, searchNow)
        .onChange(of: query) { _, newValue in
            searchTask?.cancel()
            searchTask = Task {
                try? await Task.sleep(for: .milliseconds(280))
                guard !Task.isCancelled else { return }
                await appModel.search(query: newValue)
            }
        }
        .onDisappear {
            searchTask?.cancel()
        }
        .accessibilityIdentifier("redesign.research.discovery")
    }

    private func searchNow() {
        searchTask?.cancel()
        searchTask = Task {
            await appModel.search(query: query)
        }
    }

    private func filingDetail(_ company: WatchlistCard) -> String {
        guard !company.formType.isEmpty else { return "資料を確認" }
        return "\(company.formType) ・ \(company.filedAt.formatted(date: .abbreviated, time: .omitted))"
    }
}

private struct RedesignSearchResultRow: View {
    @Environment(AppModel.self) private var appModel
    let item: SearchItem
    let opened: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                open()
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            Text(item.ticker)
                                .font(.headline)
                            Text(item.exchange)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(item.companyName)
                            .font(.subheadline)
                            .foregroundStyle(.primary)
                        Text(item.supportDisplayLabel)
                            .font(.caption)
                            .foregroundStyle(item.canAttemptInV1 ? KabuyomiTheme.accentDeep : .secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("redesign.search.open.\(item.ticker)")

            if item.canAttemptInV1 {
                Button {
                    Task { await appModel.saveSearchResult(item) }
                } label: {
                    Label(
                        appModel.isTickerInWatchlist(item.ticker, cik: item.cik) ? "保存済み" : "会社を保存",
                        systemImage: appModel.isTickerInWatchlist(item.ticker, cik: item.cik) ? "checkmark" : "bookmark"
                    )
                    .font(.subheadline.weight(.semibold))
                }
                .disabled(appModel.isAddingTicker(item.ticker) || appModel.isTickerInWatchlist(item.ticker, cik: item.cik))
                .frame(minHeight: 44)
                .accessibilityIdentifier("redesign.search.save.\(item.ticker)")
            } else {
                Text(item.availabilityNote)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    private func open() {
        guard item.canAttemptInV1 else {
            appModel.activeAlert = AppAlertState(message: item.unsupportedAlertMessage, kind: .dismissOnly)
            return
        }
        appModel.openConversation(for: item.ticker)
        opened(item.ticker)
    }
}

private struct RedesignCompanyRow: View {
    let ticker: String
    let companyName: String
    let detail: String
    let isSaved: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Text(String(ticker.prefix(2)))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 38, height: 38)
                    .background(KabuyomiTheme.evidence, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text(ticker)
                            .font(.headline)
                        if isSaved {
                            Image(systemName: "bookmark.fill")
                                .font(.caption)
                                .foregroundStyle(KabuyomiTheme.accentDeep)
                                .accessibilityLabel("保存済み")
                        }
                    }
                    Text(companyName)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(KabuyomiTheme.paper)
        .accessibilityIdentifier("redesign.company.open.\(ticker)")
    }
}

private struct RedesignCompanyWorkspace: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    let ticker: String
    let openCredits: (CreditInitialSheet?) -> Void
    let openSources: () -> Void
    let openSource: (LocalMessageSourceRef) -> Void
    @State private var question = ""
    /// コンポーザを開いているか。`RedesignComposer` 側の @State に持たせると
    /// safeAreaInset の再生成で毎回初期値に戻り、開いた直後に畳まれてしまう。
    @State private var composerExpanded = false
    @State private var surface: CompanySurface = .document
    @State private var deferredConsentQuestion: String?
    @State private var pendingNewFiling: CompanyPayload?
    @FocusState private var composerFocused: Bool

    private var normalizedTicker: String {
        ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    private var company: CompanyPayload? {
        appModel.companyPayload(for: normalizedTicker)
    }

    private var messages: [LocalChatMessage] {
        appModel.chatHistory(for: normalizedTicker)
    }

    private var pendingChat: PendingChatState? {
        appModel.pendingChat(for: normalizedTicker)
    }

    private var hasConversation: Bool {
        !messages.isEmpty || pendingChat != nil
    }

    private var surfacePicker: some View {
        Picker("表示", selection: $surface) {
            Text("資料").tag(CompanySurface.document)
            Text("会話").tag(CompanySurface.conversation)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 20)
        .padding(.bottom, 10)
        .background(KabuyomiTheme.paper)
        .accessibilityIdentifier("redesign.company.surface")
    }

    private func documentSurface(company: CompanyPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                RedesignResearchOverview(company: company) { source in
                    openSource(source)
                }

                if !hasConversation {
                    Divider().padding(.horizontal, 20)
                    RedesignQuestionStarters(company: company) { prompt in
                        question = prompt
                        composerExpanded = true
                        composerFocused = true
                    }
                }

                Color.clear.frame(height: 12)
            }
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .background(KabuyomiTheme.paper)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func conversationSurface(company: CompanyPayload) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    conversationSection(company: company)
                    Color.clear
                        .frame(height: 12)
                        .id("research-end")
                }
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                .background(KabuyomiTheme.paper)
            }
            .scrollDismissesKeyboard(.interactively)
            // 最新に貼りつくのは会話の面だけ。資料の読み位置は動かさない。
            .onChange(of: pendingChat?.id) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo("research-end", anchor: .bottom)
                }
            }
            .onChange(of: messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo("research-end", anchor: .bottom)
                }
            }
        }
    }

    var body: some View {
        Group {
            if let company {
                VStack(spacing: 0) {
                    RedesignWorkspaceContextHeader(
                        company: company,
                        isOlderFiling: appModel.isViewingOlderFilingConversation(ticker: normalizedTicker),
                        openSources: openSources,
                        openLatest: { appModel.openLatestConversation(for: normalizedTicker) }
                    )
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                    .background(KabuyomiTheme.paper)

                    if hasConversation {
                        surfacePicker
                    }

                    // 資料と会話は読み方が逆。資料は据え置きで参照したいが、
                    // 会話は下へ伸び最新に貼りつきたい。1本のスクロールに入れると
                    // 回答が増えるほど業績が上へ押し流され、数字を見るたびに
                    // 会話を全部遡ることになる。面を分けて横で行き来する。
                    TabView(selection: $surface) {
                        documentSurface(company: company)
                            .tag(CompanySurface.document)
                        if hasConversation {
                            conversationSurface(company: company)
                                .tag(CompanySurface.conversation)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                }
                .onChange(of: hasConversation) { _, exists in
                    // 最初の質問を送ったら回答の面へ連れていく。
                    // 逆に会話が消えたら資料へ戻す。選択したまま会話タグが外れると
                    // TabView に対応するページが無くなり、空の面から戻れなくなる。
                    surface = exists ? .conversation : .document
                }
            } else if let state = appModel.companyLoadState(for: normalizedTicker) {
                RedesignCompanyLoadState(state: state) {
                    Task { await appModel.loadCompany(ticker: normalizedTicker, forceRefresh: true) }
                }
            } else {
                VStack(spacing: 14) {
                    ProgressView()
                    Text("\(normalizedTicker) のSEC資料を準備しています")
                        .font(.headline)
                    Text("保存済みデータがあれば先に表示し、最新資料を確認します。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("redesign.company.loading")
            }
        }
        .background(KabuyomiTheme.canvas)
        .navigationTitle(normalizedTicker)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: toggleSavedState) {
                    Image(systemName: appModel.isTickerInWatchlist(normalizedTicker) ? "bookmark.fill" : "bookmark")
                        .frame(minWidth: 32, minHeight: 44)
                }
                .disabled(company == nil)
                .accessibilityLabel(appModel.isTickerInWatchlist(normalizedTicker) ? "保存済み。保存から削除" : "会社を保存")
                .accessibilityIdentifier("redesign.company.save")
            }

            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        dismiss()
                    } label: {
                        Label("会社を切り替える", systemImage: "building.2")
                    }
                    .accessibilityIdentifier("redesign.company.switch")

                    Button(action: refresh) {
                        Label("企業データを更新", systemImage: "arrow.clockwise")
                    }
                    .disabled(company == nil || appModel.isCompanyLoading(normalizedTicker))
                    .accessibilityIdentifier("redesign.company.refresh")
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .frame(minWidth: 32, minHeight: 44)
                }
                .accessibilityLabel("その他の操作")
                .accessibilityIdentifier("redesign.company.more")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if company != nil {
                RedesignComposer(
                    question: $question,
                    isExpandedByUser: $composerExpanded,
                    isFocused: $composerFocused,
                    creditText: appModel.chatCreditStatusText,
                    disabledReason: composerDisabledReason,
                    isSending: pendingChat != nil,
                    send: sendQuestion,
                    openCredits: {
                        appModel.requestCreditOptions()
                        let required = appModel.chatCreditCost
                        openCredits(.insufficientCredits(requiredCredits: required))
                    }
                )
            }
        }
        .task(id: normalizedTicker) {
            if let pending = appModel.consumePendingDraftQuestion(for: normalizedTicker),
               question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                question = pending
            }
            await appModel.loadCompany(ticker: normalizedTicker)
            appModel.recordCompanyVisit(ticker: normalizedTicker)
        }
        .onChange(of: appModel.activeAlert?.id) { _, alertID in
            guard alertID == nil, let deferredConsentQuestion else { return }
            self.deferredConsentQuestion = nil
            if appModel.aiConsentGranted {
                submit(deferredConsentQuestion)
            } else if question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                question = deferredConsentQuestion
            }
        }
        .alert(
            "新しい決算資料が見つかりました",
            isPresented: Binding(
                get: { pendingNewFiling != nil },
                set: { if !$0 { pendingNewFiling = nil } }
            ),
            presenting: pendingNewFiling
        ) { filing in
            Button("新しい会話を開始") {
                appModel.startNewConversation(with: filing)
                pendingNewFiling = nil
            }
            Button("今の会話を続ける", role: .cancel) {
                pendingNewFiling = nil
            }
        } message: { _ in
            Text("現在の会話は前の資料に紐づいています。新しい資料で別の会話を開始しますか？")
        }
    }

    @ViewBuilder
    private func conversationSection(company: CompanyPayload) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("リサーチノート")
                .font(.title3.weight(.bold))
                .padding(.top, 24)

            ForEach(messages) { message in
                RedesignResearchMessage(message: message, company: company) { source in
                    openSource(source)
                }
            }

            if let pendingChat {
                RedesignPendingResearch(question: pendingChat.question)
                    .id(pendingChat.id)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
    }

    private var composerDisabledReason: String? {
        if pendingChat != nil { return "回答を作成中です" }
        if !appModel.hasChatCreditAvailable { return "残高不足" }
        if !appModel.authenticatedCreditActionsAvailable { return "端末認証を確認中" }
        if appModel.usage?.capabilities?.chatEnabled == false { return "質問機能を一時停止中" }
        return nil
    }

    private func sendQuestion() {
        let prompt = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        guard composerDisabledReason == nil else {
            if !appModel.hasChatCreditAvailable {
                appModel.requestCreditOptions()
            }
            return
        }
        guard appModel.aiConsentGranted else {
            deferredConsentQuestion = prompt
            appModel.requestAIConsent()
            return
        }
        submit(prompt)
    }

    private func submit(_ prompt: String) {
        composerFocused = false
        question = ""
        Task {
            let didSend = await appModel.sendChat(question: prompt, ticker: normalizedTicker)
            if !didSend, question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                question = prompt
            }
        }
    }

    private func toggleSavedState() {
        Task {
            if appModel.isTickerInWatchlist(normalizedTicker) {
                await appModel.removeFromWatchlist(normalizedTicker)
            } else {
                await appModel.saveTicker(normalizedTicker)
            }
        }
    }

    private func refresh() {
        Task {
            let result = await appModel.refreshConversationCompany(ticker: normalizedTicker)
            if case .needsConfirmation(let company) = result {
                pendingNewFiling = company
            } else if case .unchanged = result {
                appModel.recordCompanyVisit(ticker: normalizedTicker)
            }
        }
    }
}

private func formattedFilingDate(_ raw: String) -> String {
    let prefix = String(raw.prefix(10))
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ja_JP")
    formatter.dateFormat = "yyyy-MM-dd"
    guard let date = formatter.date(from: prefix) else { return prefix }
    formatter.dateStyle = .medium
    formatter.timeStyle = .none
    return formatter.string(from: date)
}

private struct RedesignWorkspaceContextHeader: View {
    let company: CompanyPayload
    let isOlderFiling: Bool
    let openSources: () -> Void
    let openLatest: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(company.companyName)
                .font(.title2.weight(.bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(company.formType)
                    .font(.subheadline.weight(.bold))
                Text("・")
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .accessibilityHidden(true)
                Text(formattedFilingDate(company.filedAt))
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                Text("更新 \(formattedFilingDate(company.lastUpdatedAt))")
                    .font(.caption)
                    .foregroundStyle(KabuyomiTheme.inkSoft)
            }
            .foregroundStyle(KabuyomiTheme.inkSoft)

            Button(action: openSources) {
                HStack(spacing: 10) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .accessibilityHidden(true)
                    Text("資料と根拠")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text("\(company.sourceChunks.count)件")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("redesign.company.sources")

            if company.isStaleReady {
                Label(company.statusMessage ?? "保存済み資料を表示しています。最新状態を確認中です。", systemImage: "clock.arrow.circlepath")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if isOlderFiling {
                Button(action: openLatest) {
                    Label("前の資料に基づく会話です。最新資料へ戻る", systemImage: "clock.arrow.circlepath")
                        .font(.footnote.weight(.semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(KabuyomiTheme.accentDeep)
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .accessibilityElement(children: .contain)
    }
}

private struct RedesignResearchOverview: View {
    let company: CompanyPayload
    let openSource: (LocalMessageSourceRef) -> Void

    private var metrics: [MetricPayload] {
        orderedInvestorMetrics(for: company)
    }

    /// 指標タイルのスパークライン用に、同じ論理名の系列を古い順で取り出す。
    private func history(for metric: MetricPayload) -> [Double] {
        guard let series = company.historicalOverview?.series.first(where: { $0.logicalName == metric.logicalName }) else {
            return []
        }
        return series.points
            .sorted(by: { $0.periodEnd < $1.periodEnd })
            .suffix(4)
            .map(\.value)
    }

    /// 結論 → 数値 → なぜ → 確認点 → 詳細 の順に読ませる。
    /// 以前は同じ粒度の見出しが5つ縦に並び、長い「推移」が
    /// 「変化と確認論点」を画面外まで押し下げていた。
    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            // 「概要」というラベルは中身を説明していないので置かない。
            // 直上のヘッダに会社名・書類種別・提出日が出ており、文脈は足りている。
            Text(company.summary.verdict)
                .font(.title2.weight(.semibold))
                .foregroundStyle(KabuyomiTheme.ink)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("redesign.company.verdict")

            if !metrics.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("主要数値")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 142), spacing: 16)], alignment: .leading, spacing: 18) {
                        ForEach(metrics) { metric in
                            RedesignMetricView(metric: metric, history: history(for: metric))
                        }
                    }
                }
            }

            if !company.summary.highlights.isEmpty {
                RedesignEvidenceList(
                    title: "ポイント",
                    lines: company.summary.highlights,
                    company: company,
                    emphasis: .primary,
                    openSource: openSource
                )
            }

            if !company.summary.changes.isEmpty {
                RedesignEvidenceList(
                    title: "確認したい点",
                    lines: company.summary.changes,
                    company: company,
                    emphasis: .secondary,
                    openSource: openSource
                )
            }

            if let historicalOverview = company.historicalOverview,
               !historicalOverview.series.isEmpty {
                RedesignHistoricalOverview(overview: historicalOverview)
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 28)
        .padding(.bottom, 32)
    }
}

private struct RedesignEvidenceList: View {
    /// 「ポイント」と「確認したい点」は役割が違う。
    /// 同じ見出しの重さで並べると、どちらが本筋か読み手に伝わらない。
    enum Emphasis {
        case primary
        case secondary
    }

    let title: String
    let lines: [SummaryLinePayload]
    let company: CompanyPayload
    var emphasis: Emphasis = .primary
    let openSource: (LocalMessageSourceRef) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: emphasis == .primary ? 16 : 12) {
            Text(title)
                .font(emphasis == .primary ? .headline.weight(.bold) : .subheadline.weight(.bold))
                .foregroundStyle(emphasis == .primary ? KabuyomiTheme.ink : KabuyomiTheme.inkSoft)

            ForEach(lines) { line in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "text.quote")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .padding(.top, 3)
                            .accessibilityHidden(true)
                        Text(line.text)
                            .font(emphasis == .primary ? .body : .subheadline)
                            .foregroundStyle(emphasis == .primary ? KabuyomiTheme.ink : KabuyomiTheme.inkSoft)
                            .lineSpacing(5)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    let sources = line.sourceIds.compactMap { sourceID in
                        company.sourceChunks.first(where: { $0.sourceId == sourceID })
                    }
                    if !sources.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(sources) { chunk in
                                Button {
                                    openSource(sourceReference(from: chunk, in: company))
                                } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: "doc.text.magnifyingglass")
                                            .font(.caption.weight(.semibold))
                                        VStack(alignment: .leading, spacing: 1) {
                                            let label = investorFacingSourceLabel(for: chunk, in: company)
                                            Text(label)
                                                .font(.caption.weight(.bold))
                                            // 「売上高 / 売上高」の重複も、英語のままの節見出しも出さない。
                                            if let subtitle = japaneseFacingSubtitle(chunk.sectionTitle, matching: label) {
                                                Text(subtitle)
                                                    .font(.caption)
                                                    .foregroundStyle(KabuyomiTheme.inkSoft)
                                            }
                                        }
                                        Spacer(minLength: 4)
                                        Image(systemName: "chevron.right")
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(KabuyomiTheme.inkMuted)
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(KabuyomiTheme.accentDeep)
                            }
                        }
                        .padding(.leading, 30)
                    }
                }
                .padding(.bottom, 4)
                if line.id != lines.last?.id {
                    Rectangle()
                        .fill(KabuyomiTheme.separator)
                        .frame(height: 0.5)
                        .padding(.leading, 30)
                }
            }
        }
    }
}

private struct RedesignMetricView: View {
    let metric: MetricPayload
    /// 同じ指標の履歴があれば、点の値だけでなく向きも一目で分かるようにする。
    var history: [Double] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(MetricLabeler.title(for: metric.logicalName))
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkSoft)
            HStack(alignment: .bottom, spacing: 10) {
                Text(formattedMetricValue(metric))
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(KabuyomiTheme.ink)
                    // 「1,111.8 / 億ドル」と割れると桁が読み取りにくい。
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 4)
                if history.count >= 2 {
                    RedesignSparkline(
                        values: history,
                        isPositive: (metric.yoyPercent ?? 0) >= 0
                    )
                    .frame(width: 32, height: 16)
                }
            }
            if let display = metricYoYDisplay(for: metric) {
                Label(display.text, systemImage: display.direction == .positive ? "arrow.up.right" : display.direction == .negative ? "arrow.down.right" : "minus")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
            } else {
                // 前年同期比が無い指標だけ ISO 日付が生で出ており、他のタイルと揃っていなかった。
                // 何の日付か分かる形にして、表記もアプリ内の他の日付と合わせる。
                Text("期末 \(formattedFilingDate(metric.periodEnd))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 11)
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(KabuyomiTheme.separator)
                .frame(height: 0.5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        let title = MetricLabeler.title(for: metric.logicalName)
        let value = formattedMetricValue(metric)
        if let display = metricYoYDisplay(for: metric) {
            return "\(title)、\(value)、前年同期比 \(display.text)"
        }
        return "\(title)、\(value)、期末 \(formattedFilingDate(metric.periodEnd))"
    }
}

private struct RedesignHistoricalOverview: View {
    let overview: HistoricalOverviewPayload
    /// 4指標 × 4期を常に開いておくと、この1節だけで画面2〜3枚分を占める。
    /// 結論と数値を先に読ませるため、詳細は必要なときだけ開く。
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) { isExpanded.toggle() }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("推移")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("過去\(overview.years)期 ・ \(historicalBasisTitle(overview.comparisonBasis))")
                            .font(.subheadline)
                            .foregroundStyle(KabuyomiTheme.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("redesign.company.historical.toggle")
            .accessibilityLabel(isExpanded ? "推移を閉じる" : "推移を開く")

            if isExpanded {
                historicalSeries
            }
        }
    }

    @ViewBuilder
    private var historicalSeries: some View {
        VStack(alignment: .leading, spacing: 20) {
            ForEach(overview.series.prefix(4)) { series in
                RedesignTrendChart(series: series)
                if series.id != overview.series.prefix(4).last?.id {
                    Divider()
                }
            }
        }
        .accessibilityIdentifier("redesign.research.historical")
    }
}

private struct RedesignQuestionStarters: View {
    let company: CompanyPayload
    let select: (String) -> Void

    private var prompts: [String] {
        let generated = buildSuggestedQuestions(for: company)
        return generated.isEmpty
            ? ["今回の最大変化は？", "売上を伸ばした要因は？", "利益率は改善しましたか？"]
            : Array(generated.prefix(4))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("この資料を深掘りする")
                .font(.title3.weight(.bold))
            Text("質問は対象資料と会話の文脈に基づいて回答されます。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            ForEach(prompts, id: \.self) { prompt in
                Button {
                    select(prompt)
                } label: {
                    HStack {
                        Text(prompt)
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer()
                        Image(systemName: "arrow.up.left")
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 24)
    }
}

private struct RedesignComposer: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var question: String
    @Binding var isExpandedByUser: Bool
    var isFocused: FocusState<Bool>.Binding
    let creditText: String
    let disabledReason: String?
    let isSending: Bool
    let send: () -> Void
    let openCredits: () -> Void

    /// 読んでいる間まで入力欄とクレジット表示を出し続けると、
    /// 本文の上に常時110pt の板が乗り、しかも「クレジットが必要です」を
    /// ずっと突きつけることになる。触れるまでは1行の入り口に畳む。
    /// 折りたたみ中は TextField 自体が階層に無いため、FocusState を立てても
    /// 束ねる先が無く SwiftUI に戻される。開くかどうかは別の状態で持つ。
    private var isExpanded: Bool {
        isExpandedByUser
            || isFocused.wrappedValue
            || isSending
            || !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        Group {
            if isExpanded {
                expandedComposer
                    .task(id: isExpandedByUser) {
                        // 欄が現れてからでないとフォーカスを渡せない。
                        if isExpandedByUser { isFocused.wrappedValue = true }
                    }
                    // 一度開いたら畳み直さない。フォーカスが外れるたびに閉じると、
                    // キーボードを下げただけで入力欄が消えて書きかけを見失う。
            } else {
                collapsedEntry
            }
        }

        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 6)
        // 半透明だと本文が板の裏に透けて、読む面と聞く面の境目が消える。
        .background(KabuyomiTheme.paper)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(KabuyomiTheme.separator)
                .frame(height: 0.5)
        }
    }

    private var collapsedEntry: some View {
        Button {
            isExpandedByUser = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .accessibilityHidden(true)
                Text("この資料について質問する")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
            .background(KabuyomiTheme.elevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(KabuyomiTheme.separator, lineWidth: 0.75)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("redesign.composer.expand")
        .accessibilityLabel("この資料について質問する")
    }

    private var expandedComposer: some View {
        VStack(spacing: 7) {
            HStack(spacing: 8) {
                if disabledReason == "残高不足" {
                    Label(
                        dynamicTypeSize.isAccessibilitySize ? "残高不足" : "質問にはクレジットが必要です",
                        systemImage: "exclamationmark.circle.fill"
                    )
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                } else {
                    Text(isSending ? "回答を作成中" : (disabledReason ?? creditText))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                Spacer()
                if disabledReason == "残高不足" {
                    Button(action: openCredits) {
                        Text(dynamicTypeSize.isAccessibilitySize ? "確認" : "クレジットを確認")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                    .accessibilityLabel("クレジットを確認")
                }
            }

            HStack(alignment: .bottom, spacing: 10) {
                TextField("この資料について質問", text: $question, axis: .vertical)
                    .focused(isFocused)
                    .lineLimit(1...5)
                    .submitLabel(.send)
                    .onSubmit {
                        if disabledReason == nil { send() }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(KabuyomiTheme.elevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(KabuyomiTheme.separator, lineWidth: 0.75)
                    }
                    .accessibilityIdentifier("redesign.composer.field")

                Button(action: send) {
                    Group {
                        if isSending {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                        }
                    }
                    .frame(width: 46, height: 46)
                    .foregroundStyle(.white)
                    .background(disabledReason == nil && !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? KabuyomiTheme.accentDeep : Color(uiColor: .systemGray3), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(disabledReason != nil || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("質問を送信")
                .accessibilityIdentifier("redesign.composer.send")
            }
        }
    }
}

private struct RedesignResearchMessage: View {
    let message: LocalChatMessage
    let company: CompanyPayload
    let openSource: (LocalMessageSourceRef) -> Void

    private var displayedAnswer: String {
        localizedAssistantDisplayText(message.content)
    }

    private var structuredAnswer: AssistantMessageStructure {
        structureAssistantMessage(displayedAnswer)
    }

    private var sources: [LocalMessageSourceRef] {
        displayableMessageSources(message.sources, in: company)
    }

    /// 結論は1文とは限らない。列挙型の回答("1つ目は…2つ目は…")では
    /// `structureAssistantMessage` が複数文を意図的に結論へまとめる仕様のため、
    /// 常に .title3 で描くと見出しサイズの塊が数行続いて読みにくくなる。
    /// 長さで段階的に落とし、短い結論だけを見出しとして立てる。
    private var conclusionFont: Font {
        switch structuredAnswer.conclusion.count {
        case ..<65:
            return .title3.weight(.medium)
        case ..<141:
            return .body.weight(.semibold)
        default:
            return .body
        }
    }

    var body: some View {
        if message.role == "user" {
            VStack(alignment: .leading, spacing: 8) {
                Text("質問")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                Text(message.content)
                    .font(.body.weight(.medium))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .background(KabuyomiTheme.evidence, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("質問、\(message.content)")
        } else {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 8) {
                    Text("リサーチ回答")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    if message.modelName != "local", !message.modelName.isEmpty {
                        Label("AIによる要約", systemImage: "sparkles")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }

                Text(structuredAnswer.conclusion)
                    .font(conclusionFont)
                    .foregroundStyle(KabuyomiTheme.ink)
                    .lineSpacing(6)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)

                if !structuredAnswer.evidence.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("根拠となるポイント")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        ForEach(structuredAnswer.evidence, id: \.self) { sentence in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Circle()
                                    .fill(Color.secondary)
                                    .frame(width: 5, height: 5)
                                    .accessibilityHidden(true)
                                Text(sentence)
                                    .font(.body)
                                    .foregroundStyle(KabuyomiTheme.ink)
                                    .lineSpacing(6)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }

                if !structuredAnswer.limitations.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("留意点")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        ForEach(structuredAnswer.limitations, id: \.self) { sentence in
                            Text(sentence)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                if !sources.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("根拠")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        ForEach(sources) { source in
                            Button {
                                openSource(source)
                            } label: {
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    Image(systemName: source.sourceKind.systemImage)
                                        .foregroundStyle(KabuyomiTheme.accentDeep)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(source.sourceLabelSnapshot)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                            .lineLimit(2)
                                        Text(source.sourceKind.groundingCaption)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(minHeight: 44)
                                .padding(.horizontal, 12)
                                .background(KabuyomiTheme.evidence, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("redesign.citation.\(source.id.uuidString)")
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
        }
    }
}

private struct RedesignPendingResearch: View {
    let question: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("質問")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                Text(question)
                    .font(.body.weight(.medium))
            }
            HStack(spacing: 12) {
                ProgressView()
                VStack(alignment: .leading, spacing: 2) {
                    Text("提出資料を確認しています")
                        .font(.subheadline.weight(.semibold))
                    Text("根拠を照合して回答を作成中です。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("回答を作成中。提出資料の根拠を確認しています")
        .accessibilityIdentifier("redesign.answer.pending")
    }
}

private struct RedesignCompanyLoadState: View {
    let state: CompanyLoadStatePayload
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: icon)
        } description: {
            Text(state.displayMessage ?? defaultMessage)
        } actions: {
            if state.status == .failedRetryable {
                Button("再試行", action: retry)
            } else {
                ProgressView()
            }
        }
        .accessibilityIdentifier("redesign.company.loadState")
    }

    private var title: String {
        state.status == .failedRetryable ? "資料を準備できませんでした" : "SEC資料を準備しています"
    }

    private var icon: String {
        state.status == .failedRetryable ? "exclamationmark.triangle" : "doc.text.magnifyingglass"
    }

    private var defaultMessage: String {
        state.status == .failedRetryable ? "通信を確認して、もう一度お試しください。" : "準備ができ次第、この画面に表示します。"
    }
}

private struct RedesignSourceBrowser: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.openURL) private var openURL
    let company: CompanyPayload
    let selectFiling: (String) -> Void
    let openSource: (LocalMessageSourceRef) -> Void

    private var filingHistory: [LocalCompanyRecord] {
        appModel.conversationHistory(for: company.ticker)
    }

    var body: some View {
        List {
                Section("対象資料") {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(company.formType) ・ \(formattedFilingDate(company.filedAt))")
                            .font(.headline)
                        Text(company.companyName)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text("更新 \(formattedFilingDate(company.lastUpdatedAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)

                    if let url = resolvedExternalHTTPURL(from: company.primaryDocumentUrl, allowBareDomain: false) {
                        Button {
                            openURL(url)
                        } label: {
                            Label("SEC原文をブラウザで開く", systemImage: "safari")
                                .frame(minHeight: 44)
                        }
                    }
                }

                if filingHistory.count > 1 {
                    Section("会話のある資料") {
                        ForEach(filingHistory, id: \.company.filingKey) { record in
                            Button {
                                selectFiling(record.company.filingKey)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text("\(record.company.formType) ・ \(formattedFilingDate(record.company.filedAt))")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                        Text("会話 \(record.chatHistory.filter { $0.role == "assistant" }.count)件")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if record.company.filingKey == company.filingKey {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(KabuyomiTheme.accentDeep)
                                    }
                                }
                                .frame(minHeight: 44)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Section("根拠") {
                    if company.sourceChunks.isEmpty {
                        Text("この資料には表示できる根拠抜粋がありません。")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(company.sourceChunks.sorted(by: { $0.sortOrder < $1.sortOrder })) { chunk in
                            let preview = sourceListPreviewText(
                                text: chunk.text,
                                sectionTitle: chunk.sectionTitle,
                                fallback: investorFacingSourceLabel(for: chunk, in: company)
                            )
                            Button {
                                openSource(sourceReference(from: chunk, in: company))
                            } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: "doc.text")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(KabuyomiTheme.accentDeep)
                                        .padding(.top, 2)
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(preview)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(KabuyomiTheme.ink)
                                            .lineLimit(3)
                                        Text(sourceRowContext(for: chunk, in: company))
                                            .font(.caption)
                                            .foregroundStyle(KabuyomiTheme.inkSoft)
                                            .lineLimit(2)
                                    }
                                    Spacer(minLength: 8)
                                    Image(systemName: "chevron.right")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(KabuyomiTheme.inkMuted)
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(preview)、\(sourceRowContext(for: chunk, in: company))")
                            .accessibilityIdentifier("redesign.source.open.\(chunk.id)")
                        }
                    }
                }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(KabuyomiTheme.canvas)
        .navigationTitle("資料と根拠")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .accessibilityIdentifier("redesign.sources")
    }

    private func sourceRowContext(for chunk: SourceChunkPayload, in company: CompanyPayload) -> String {
        let sourceLabel = investorFacingSourceLabel(for: chunk, in: company)
        let section = chunk.sectionTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !section.isEmpty, section != sourceLabel else { return sourceLabel }
        return "\(sourceLabel) ・ \(section)"
    }
}

private struct RedesignSourceDetail: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.openURL) private var openURL
    let company: CompanyPayload
    let source: LocalMessageSourceRef
    @State private var translatedText: String?
    @State private var translationError: String?
    @State private var translationInFlight = false

    private var matchedChunk: SourceChunkPayload? {
        matchedSourceChunk(for: source, in: company)
    }

    private var sourceURL: URL? {
        resolvedSourceURL(for: source, in: company)
    }

    private var excerpt: String {
        let sourceExcerpt = source.excerpt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !sourceExcerpt.isEmpty { return sourceExcerpt }
        return matchedChunk?.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(source.sourceKind.groundingCaption, systemImage: source.sourceKind.systemImage)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                        Text(investorFacingSourceLabel(for: source, in: company))
                            .font(.title2.weight(.bold))
                            .fixedSize(horizontal: false, vertical: true)
                        Text("\(company.formType) ・ \(formattedFilingDate(company.filedAt))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let section = matchedChunk?.sectionTitle, !section.isEmpty {
                            Text(section)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }

                    sourceActions

                    if let translationError {
                        Label(translationError, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let translatedText {
                        excerptSection(title: "日本語訳", text: translatedText, isOriginal: false)
                    }

                    excerptSection(
                        title: "関連する原文",
                        text: excerpt.isEmpty ? "表示できる抜粋がありません。" : excerpt,
                        isOriginal: true
                    )
            }
            .padding(20)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(KabuyomiTheme.canvas)
        .navigationTitle("根拠")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .accessibilityIdentifier("redesign.source.detail")
    }

    @ViewBuilder
    private var sourceActions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                sourceLinkButton
                translationButton
            }
            VStack(spacing: 10) {
                sourceLinkButton
                translationButton
            }
        }
    }

    @ViewBuilder
    private var sourceLinkButton: some View {
        if let sourceURL {
            Button {
                openURL(sourceURL)
            } label: {
                Label(source.sourceKind == .webSupplement ? "ブラウザで開く" : "SEC原文を開く", systemImage: "safari")
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("redesign.source.openOriginal")
        }
    }

    @ViewBuilder
    private var translationButton: some View {
        if !excerpt.isEmpty, translatedText == nil {
            Button(action: translate) {
                HStack {
                    if translationInFlight { ProgressView() }
                    Text(translationInFlight ? "翻訳中…" : "日本語に翻訳（1クレジット）")
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
            }
            .buttonStyle(.bordered)
            .disabled(translationInFlight || !appModel.authenticatedCreditActionsAvailable || !appModel.hasChatCreditAvailable)
            .accessibilityIdentifier("redesign.source.translate")
        }
    }

    private func excerptSection(title: String, text: String, isOriginal: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.caption2.weight(.bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
            Text(text)
                .font(.body)
                .lineSpacing(7)
                .textSelection(.enabled)
                .foregroundStyle(isOriginal && excerpt.isEmpty ? KabuyomiTheme.inkSoft : KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(KabuyomiTheme.evidence, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(KabuyomiTheme.separator, lineWidth: 0.5)
        }
    }

    private func translate() {
        guard !translationInFlight, !excerpt.isEmpty else { return }
        translationInFlight = true
        translationError = nil
        let operationID = UUID().uuidString
        Task {
            do {
                let response = try await appModel.translateQuote(text: excerpt, operationId: operationID)
                translatedText = response.translatedText
            } catch {
                translationError = error.localizedDescription
                await appModel.refreshUsageAfterQuoteTranslationFailure()
            }
            translationInFlight = false
        }
    }
}

private struct RedesignHistoryView: View {
    @Environment(AppModel.self) private var appModel
    let openResearch: () -> Void
    let openCompany: (String, String?) -> Void

    private var history: [LocalCompanyRecord] {
        let recentCompanies = appModel.recentCompanyCards(limit: 10, includeSaved: false)
        let tickers = Array(
            Set((appModel.watchlist + recentCompanies).map { $0.ticker.uppercased() })
        )
        return tickers
            .flatMap { appModel.conversationHistory(for: $0) }
            .sorted(by: historySort)
    }

    var body: some View {
        List {
            if !appModel.watchlist.isEmpty || !history.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("保存と履歴")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                        Text("あとで読み返す")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("\(appModel.watchlist.count)社を保存 ・ \(history.count)件のリサーチ")
                            .font(.subheadline)
                            .foregroundStyle(KabuyomiTheme.inkSoft)
                    }
                    .padding(.vertical, 10)
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            if appModel.watchlist.isEmpty,
               history.isEmpty {
                ContentUnavailableView {
                    Label("保存・履歴はまだありません", systemImage: "clock.arrow.circlepath")
                } description: {
                    Text("会社を保存すると「保存した会社」に、質問すると「過去のリサーチ」に表示されます。")
                } actions: {
                    Button("リサーチを始める", action: openResearch)
                }
                .listRowBackground(Color.clear)
            }

            if !appModel.watchlist.isEmpty {
                Section("保存した会社") {
                    ForEach(appModel.watchlist) { company in
                        RedesignCompanyRow(
                            ticker: company.ticker,
                            companyName: company.companyName,
                            detail: filingDetail(company),
                            isSaved: true
                        ) {
                            openCompany(company.ticker, nil)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("削除", role: .destructive) {
                                Task { await appModel.removeFromWatchlist(company.ticker) }
                            }
                            .accessibilityIdentifier("redesign.history.remove.\(company.ticker)")
                        }
                    }
                }
            }

            if !history.isEmpty {
                Section("過去のリサーチ") {
                    ForEach(history, id: \.company.filingKey) { record in
                        let latestQuestion = record.chatHistory.last(where: { $0.role == "user" })
                        let answerCount = record.chatHistory.filter { $0.role == "assistant" }.count
                        let latestActivity = record.chatHistory.last?.createdAt
                        Button {
                            openCompany(record.company.ticker, record.company.filingKey)
                        } label: {
                            VStack(alignment: .leading, spacing: 7) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(record.company.ticker)
                                        .font(.headline)
                                    Text(record.company.formType)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(KabuyomiTheme.accentDeep)
                                    Text(formattedFilingDate(record.company.filedAt))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                                if let latestQuestion {
                                    Text("「\(latestQuestion.content)」")
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(.primary)
                                        .lineLimit(2)
                                } else {
                                    Text(record.company.companyName)
                                        .font(.subheadline)
                                        .foregroundStyle(.primary)
                                        .lineLimit(2)
                                }
                                Text(historyMetadata(answerCount: answerCount, latestActivity: latestActivity))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("redesign.history.item.\(record.company.filingKey)")
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(KabuyomiTheme.canvas)
        .navigationTitle("履歴")
        .refreshable {
            await appModel.refreshCreditUsage()
        }
        .accessibilityIdentifier("redesign.history")
    }

    private func filingDetail(_ company: WatchlistCard) -> String {
        if company.isPlaceholder { return "資料を準備中" }
        guard !company.formType.isEmpty else { return "資料を確認" }
        return "\(company.formType) ・ \(company.filedAt.formatted(date: .abbreviated, time: .omitted))"
    }

    private func historySort(_ lhs: LocalCompanyRecord, _ rhs: LocalCompanyRecord) -> Bool {
        switch (lhs.chatHistory.last?.createdAt, rhs.chatHistory.last?.createdAt) {
        case let (left?, right?):
            return left > right
        case (.some, .none):
            return true
        case (.none, .some):
            return false
        case (.none, .none):
            return lhs.company.filedAt > rhs.company.filedAt
        }
    }

    private func historyMetadata(answerCount: Int, latestActivity: Date?) -> String {
        let answerText = answerCount == 0 ? "回答なし" : "回答 \(answerCount)件"
        guard let latestActivity else { return answerText }
        return "\(answerText) ・ \(latestActivity.formatted(date: .abbreviated, time: .shortened))"
    }
}

private struct RedesignSettingsView: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 7) {
                    Text("アカウントとリサーチ")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text("利用環境を確認・管理")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.ink)
                }
                .padding(.vertical, 8)
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            Section("クレジット") {
                NavigationLink(value: RedesignSettingsRoute.credits) {
                    HStack(spacing: 14) {
                        Image(systemName: "bolt.fill")
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("残高と購入")
                                .font(.headline)
                                .foregroundStyle(.primary)
                            Text(creditSummary)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .frame(minHeight: 54)
                    .contentShape(Rectangle())
                }
                .accessibilityIdentifier("redesign.settings.credits")
            }

            Section("AI 利用") {
                Toggle(isOn: Binding(
                    get: { appModel.aiConsentGranted },
                    set: { appModel.setAIConsent($0) }
                )) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("AI 利用への同意")
                        Text("質問と対象資料の抜粋を外部AIモデルへ送信します。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("redesign.settings.aiConsent")
            }

            Section("表示") {
                Toggle(isOn: Binding(
                    get: { appModel.showStarterCompanies },
                    set: { appModel.setShowStarterCompanies($0) }
                )) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("スターター銘柄を表示")
                        Text("リサーチ画面に代表的な会社を表示します。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("redesign.settings.starters")
            }

            Section("サポートとデータ") {
                NavigationLink(value: RedesignSettingsRoute.details) {
                    SettingsDestinationRow(
                        title: "端末情報とサポート",
                        subtitle: deviceAndSupportSummary
                    )
                }
                .accessibilityIdentifier("redesign.settings.details")

                if let status = appModel.installationAuthenticationStatus,
                   let retryTitle = status.retryActionTitle {
                    Button {
                        Task { await appModel.retryInstallationAuthentication() }
                    } label: {
                        HStack(spacing: 10) {
                            if appModel.installationAuthenticationIsRetrying {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "arrow.clockwise")
                            }
                            Text(appModel.installationAuthenticationIsRetrying ? "端末認証を確認中" : retryTitle)
                        }
                    }
                    .disabled(appModel.installationAuthenticationIsRetrying)
                    .frame(minHeight: 44)
                }

                Button("ローカルデータをリセット", role: .destructive) {
                    appModel.requestResetLocalDataConfirmation()
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("redesign.settings.reset")
            }

            Section {
                Text("Kabuyomi は公開された SEC 10-K / 10-Q を読みやすくする資料リーダーです。投資助言や売買推奨ではありません。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(KabuyomiTheme.canvas)
        .navigationTitle("設定")
        .accessibilityIdentifier("redesign.settings")
    }

    private var creditSummary: String {
        if let credits = appModel.usage?.credits {
            return "残り \(credits.totalRemaining)クレジット ・ \(appModel.currentPlanBadgeTitle)"
        }
        switch appModel.usageLoadState {
        case .failed:
            return "残高を取得できませんでした"
        case .loading:
            return "残高を確認中"
        default:
            return appModel.currentPlanBadgeTitle
        }
    }

    private var deviceAndSupportSummary: String {
        if let status = appModel.installationAuthenticationStatus {
            return "\(status.failure.title) ・ 詳細を確認"
        }
        return "匿名サポートコード、アプリ情報、法務情報"
    }
}

private struct SettingsDestinationRow: View {
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.body)
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }
}

/// 会社ワークスペースの2つの面。資料は参照用で据え置き、会話は最新に貼りつく。
private enum CompanySurface: Hashable {
    case document
    case conversation
}
