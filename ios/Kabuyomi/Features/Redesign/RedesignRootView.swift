import SwiftUI

/// v2 IA Phase 5(docs/ui-redesign-v2/V2_IA_SPEC.md「Phase 5」節)。
///
/// 面は2枚。**ホーム**は Phase 4 のストリーム + アスクバーそのままで、
/// **サマリー**は Phase 3 の盤面を密度の家として復活させたもの。
/// 会社ドキュメント(Phase 1)は中身を変えないまま、どちらのタブからも push で開く。
/// 設定・クレジット・会社ピッカーは引き続きシート(3枚目のタブは作らない)。
private enum RedesignRoute: Hashable {
    case company(String)
    case sources(String)
    case source(String, LocalMessageSourceRef)
}

private enum RedesignSettingsRoute: Hashable {
    case credits
    case details
}

/// 根の上に出るシート。SwiftUI はシートの上にシートを重ねられないので、
/// 3つの行き先を1つの状態にまとめ、「今どれが出ているか」を1か所で持つ。
private enum RedesignSheet: Identifiable {
    /// 会社ピッカー(検索 + 盤面)。会社チップと検索アイコンの両方から開く。
    case companyPicker
    /// プロフィール。中身は既存の設定ルート(CreditView への導線ごと)。
    case settings
    case credits(CreditInitialSheet?)

    var id: String {
        switch self {
        case .companyPicker:
            return "companyPicker"
        case .settings:
            return "settings"
        case .credits:
            return "credits"
        }
    }
}

/// 根のタブ。7月ルール「タブは目的地、各タブが NavigationStack を持つ」に戻る。
private enum RedesignTab: Hashable {
    case home
    case summary
}

struct RedesignRootView: View {
    @Environment(AppModel.self) private var appModel
    @State private var selectedTab: RedesignTab = .home
    /// タブごとに1本ずつ。1本を共有すると、タブを切り替えたときに
    /// 片方で開いていたドキュメントがもう片方に出てきて、
    /// 戻ったときに元のタブへ帰れなくなる(7月ルール「タブは目的地」)。
    @State private var homePath: [RedesignRoute] = []
    @State private var summaryPath: [RedesignRoute] = []
    @State private var sheet: RedesignSheet?

    private var activePath: [RedesignRoute] {
        selectedTab == .home ? homePath : summaryPath
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack(path: $homePath) {
                RedesignStreamView(
                    openCompany: { openCompany($0, on: .home) },
                    openConversation: { ticker, filingKey in
                        openConversation(ticker, filingKey: filingKey, on: .home)
                    },
                    openSource: { ticker, source in push(.source(ticker, source), on: .home) },
                    present: { sheet = $0 },
                    openCredits: openCredits
                )
                .navigationDestination(for: RedesignRoute.self) { route in
                    destination(for: route, on: .home)
                }
            }
            .tabItem { Label("ホーム", systemImage: "bubble.left.and.text.bubble.right") }
            .tag(RedesignTab.home)

            NavigationStack(path: $summaryPath) {
                RedesignSummaryView(
                    openCompany: { ticker in
                        openConversation(ticker, filingKey: "", on: .summary)
                    },
                    present: { sheet = $0 }
                )
                .navigationDestination(for: RedesignRoute.self) { route in
                    destination(for: route, on: .summary)
                }
            }
            .tabItem { Label("サマリー", systemImage: "square.grid.2x2") }
            .tag(RedesignTab.summary)
        }
        .tint(KabuyomiTheme.accent)
        // 左端の戻りジェスチャは根から資料詳細まで同じように効く。
        // 見ているタブの経路だけを見る。もう一方のタブが深くても、
        // 今いる面が根なら戻すものは無い。
        .kabuyomiEdgeSwipeBack(enabled: !activePath.isEmpty) {
            popActiveTab()
        }
        // シートと残高まわりのコールバックは TabView に付ける。
        // どちらかのタブの中に入れると、もう一方を見ているあいだに起きた
        // 残高不足やリワード復帰が黙って消える。
        .sheet(item: $sheet) { presented in
            sheetContent(presented)
        }
        .onChange(of: appModel.insufficientCreditRecoveryRequestID) { _, requestID in
            guard requestID != nil else { return }
            let required = appModel.insufficientCreditRecovery?.requiredCredits ?? appModel.chatCreditCost
            openCredits(.insufficientCredits(requiredCredits: required))
        }
        .onChange(of: appModel.rewardedAdReturnRestorationRequestID) { _, _ in
            guard appModel.rewardedAdReturnDestination == .credits,
                  appModel.shouldRestoreRewardedAdReturnDestination else { return }
            openCredits(nil)
            appModel.confirmRewardedAdReturnDestinationRestored(visibleSurface: "redesign_credits")
        }
    }

    private func push(_ route: RedesignRoute, on tab: RedesignTab) {
        switch tab {
        case .home:
            homePath.append(route)
        case .summary:
            summaryPath.append(route)
        }
    }

    private func popActiveTab() {
        switch selectedTab {
        case .home:
            guard !homePath.isEmpty else { return }
            homePath.removeLast()
        case .summary:
            guard !summaryPath.isEmpty else { return }
            summaryPath.removeLast()
        }
    }

    @ViewBuilder
    private func sheetContent(_ presented: RedesignSheet) -> some View {
        switch presented {
        case .companyPicker:
            RedesignCompanyPickerSheet(
                selectCompany: { ticker in
                    // 宛先を選ぶだけ。開かずにストリームへ戻る。
                    // 「最後に開いた会社」がそのままアスクバーのチップなので、
                    // 選択は `openConversation` に一本化して別の状態を作らない。
                    appModel.openConversation(for: ticker)
                    sheet = nil
                },
                openCompany: { ticker in
                    sheet = nil
                    // ピッカーは今見ているタブの上に出ているので、
                    // ドキュメントもそのタブへ push する。閉じたら元のタブに戻る。
                    openConversation(ticker, filingKey: "", on: selectedTab)
                }
            )
        case .settings:
            RedesignSettingsSheet()
        case .credits(let initialSheet):
            CreditView(initialSheet: initialSheet)
                .interactiveDismissDisabled(true)
        }
    }

    @ViewBuilder
    private func destination(for route: RedesignRoute, on tab: RedesignTab) -> some View {
        Group {
            switch route {
            case .company(let ticker):
                RedesignCompanyWorkspace(
                    ticker: ticker,
                    openCredits: openCredits,
                    openSources: { push(.sources(ticker), on: tab) },
                    openSource: { push(.source(ticker, $0), on: tab) }
                )
                .id(ticker)
            case .sources(let ticker):
                if let company = appModel.companyPayload(for: ticker) {
                    RedesignSourceBrowser(
                        company: company,
                        selectFiling: { filingKey in
                            appModel.openConversation(for: ticker, filingKey: filingKey)
                            setPath([.company(ticker)], on: tab)
                        },
                        openSource: { push(.source(ticker, $0), on: tab) }
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
        // push した面ではタブバーを畳む。会社ドキュメントは底に自前のコンポーザを
        // 貼りつけているので、タブバーを残すと入力欄の下にもう1枚クロームが重なる。
        // Phase 5 で拒んだ「3層クローム」と同じ形になるため、深い面ではタブを譲る。
        .toolbar(.hidden, for: .tabBar)
    }

    private func setPath(_ routes: [RedesignRoute], on tab: RedesignTab) {
        switch tab {
        case .home:
            homePath = routes
        case .summary:
            summaryPath = routes
        }
    }

    /// 会社ドキュメントをそのタブの1階層目として開く。
    /// 呼ぶ側がすでに `appModel.openConversation` を済ませている経路
    /// (資料イベントカード・送信直後の `deliver`)のために、ここでは面だけを動かす。
    private func openCompany(_ ticker: String, on tab: RedesignTab) {
        let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else { return }
        setPath([.company(normalized)], on: tab)
    }

    /// カード・板行・ピッカーから、その会話(= その資料)を開く。
    /// `openConversation` が `activeConversationFilingKeys` を立ててから push する、
    /// という順序は Phase 3 の研究タブと同じ。
    private func openConversation(_ ticker: String, filingKey: String, on tab: RedesignTab) {
        let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else { return }
        appModel.openConversation(for: normalized, filingKey: filingKey.isEmpty ? nil : filingKey)
        setPath([.company(normalized)], on: tab)
    }

    /// クレジット画面を出す。
    ///
    /// 設定シートが出ている最中に残高不足が起きうる(設定 → 残高と購入 → 購入失敗)。
    /// SwiftUI はシートの上にシートを出せず、そのまま代入すると黙って何も起きないので、
    /// 先に今のシートを畳んでから出し直す。
    private func openCredits(_ initialSheet: CreditInitialSheet?) {
        if case .credits = sheet { return }
        guard sheet != nil else {
            sheet = .credits(initialSheet)
            return
        }
        sheet = nil
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(350))
            sheet = .credits(initialSheet)
        }
    }
}

/// プロフィールのシート。中身は Phase 2 の設定ルートをそのまま、
/// 自前の NavigationStack に載せ替えただけ(設定・クレジットの内部は不変)。
private struct RedesignSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
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
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("閉じる") { dismiss() }
                            .accessibilityIdentifier("redesign.settings.close")
                    }
                }
        }
        .tint(KabuyomiTheme.accent)
    }
}

// MARK: - ホーム(盤面 + 新着)

/// ミッション文の出し方。
/// 初めて開いた人には何のアプリかを言う必要があるが、
/// 保存や履歴を持っている人には、毎回同じ2段落が一等地を占めるだけになる。
/// v2 IA では盤面が空のときだけ出す = この関数が `.prominent` を返すときだけ出す。
enum RedesignMissionProminence: Equatable {
    case prominent
    case receded
}

func redesignMissionProminence(
    hasRecentCompanies: Bool,
    hasSavedCompanies: Bool
) -> RedesignMissionProminence {
    hasRecentCompanies || hasSavedCompanies ? .receded : .prominent
}

/// List の節見出し。既定の見出しは大文字化と余白が効いて密度を落とすので、
/// 会社ワークスペースと同じマイクロラベル + 細罫で描く。
private struct RedesignListSectionHeader: View {
    let title: String
    var trailing: String?

    var body: some View {
        RedesignSectionHeader(title: title, trailing: trailing)
            .textCase(nil)
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            // plain list の見出しはスクロール中に上端へ貼りつく。透明のままだと
            // 下を流れる行が見出しを突き抜けて、どちらも読めなくなる。
            // `listRowBackground` はヘッダ行には効かないので、面はビュー側で塗る。
            .background(KabuyomiTheme.canvas)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
    }
}

/// 「SEC資料から、会社を理解する」の節。
/// 盤面が空の人にしか出ないので、常に一等地の大きさで置く。
/// 文言は落とさない(法務上の断り書きを含むため)。
private struct RedesignDiscoveryMission: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("SEC資料から、会社を理解する")
                .font(.title3.weight(.bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("10-K / 10-Qを日本語で読み、根拠を確認しながら質問できます。投資助言や売買推奨は行いません。")
                .font(.subheadline)
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
    }
}

/// ホーム。検索が最上部、その下が盤面(保存済み + 最近)、さらに下が新着。
/// 盤面が空のときだけ、ミッション文とスターター企業に入れ替わる。
/// 同意の確認をはさんだために保留になった質問。
/// 同意ダイアログが閉じた時点で、押した本人の操作の続きとして送る。
private struct RedesignDeferredAsk: Equatable {
    let question: String
    let context: StreamAskContext
}

/// 根の面。質問と資料が1本に流れ、底にアスクバーが貼りつく。
private struct RedesignStreamView: View {
    @Environment(AppModel.self) private var appModel
    let openCompany: (String) -> Void
    let openConversation: (String, String) -> Void
    let openSource: (String, LocalMessageSourceRef) -> Void
    let present: (RedesignSheet) -> Void
    let openCredits: (CreditInitialSheet?) -> Void

    @State private var draft = ""
    @State private var isSubmitting = false
    @State private var deferredAsk: RedesignDeferredAsk?
    @FocusState private var askFocused: Bool

    // 検索の状態はここでは読まない。読むとピッカーの1打鍵ごとに
    // ストリーム全体(出典チップの組み立てを含む)が導出し直される。
    private var savedCards: [WatchlistCard] {
        appModel.watchlist
    }

    private var recentCards: [WatchlistCard] {
        appModel.recentCompanyCards(limit: 8, includeSaved: false)
    }

    private var missionProminence: RedesignMissionProminence {
        redesignMissionProminence(
            hasRecentCompanies: !recentCards.isEmpty,
            hasSavedCompanies: !savedCards.isEmpty
        )
    }

    private var askContext: StreamAskContext? {
        streamAskContext(
            lastOpenedTicker: appModel.lastOpenedCompanyTicker,
            saved: savedCards,
            recent: recentCards
        )
    }

    /// アスクバーの無効理由。会社ワークスペースのコンポーザと同じ関数・同じ順序。
    private var askDisabledReason: String? {
        redesignComposerDisabledReason(
            isSending: isSubmitting || appModel.pendingChat(for: askContext?.ticker ?? "") != nil,
            hasChatCreditAvailable: appModel.hasChatCreditAvailable,
            authenticatedCreditActionsAvailable: appModel.authenticatedCreditActionsAvailable,
            chatEnabled: appModel.usage?.capabilities?.chatEnabled
        )
    }

    var body: some View {
        let items = streamItems(
            archiveGroups: researchArchiveGroups(records: appModel.trackedConversationRecords()),
            filingEvents: streamFilingEvents(
                saved: savedCards,
                recent: recentCards,
                lastOpenedAt: appModel.lastOpenedAt
            )
        )

        List {
            if items.isEmpty {
                emptyStreamSections
            } else {
                streamSections(items)
            }
        }
        .listStyle(.plain)
        .listRowSeparatorTint(KabuyomiTheme.separator)
        .listSectionSpacing(10)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .background(KabuyomiTheme.canvas)
        .scrollDismissesKeyboard(.interactively)
        // ストリームの識別子はリスト自身に付ける。チェーンの末尾に置くと
        // safeAreaInset に入れたアスクバーの中まで降りていき、
        // 会社チップ・残高・入力欄・送信の識別子を全部この1つで上書きする
        // (シミュレータ実機確認 2026-08-22。UIテストが送信ボタンを見失った)。
        .accessibilityIdentifier("redesign.stream")
        // ワードマークは大タイトルに任せる。ツールバーの leading に Text を置くと
        // iOS 26 が操作系の丸いカプセルに詰め、「K…」に化ける
        // (シミュレータ実機確認 2026-08-22)。大タイトルなら左寄せのまま、
        // スクロールで1行のバーへ収束する。
        .navigationTitle("Kabuyomi")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    present(.companyPicker)
                } label: {
                    Image(systemName: "magnifyingglass")
                        .frame(minWidth: 32, minHeight: 44)
                }
                .accessibilityLabel("会社を検索")
                .accessibilityIdentifier("redesign.stream.search")
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    present(.settings)
                } label: {
                    Image(systemName: "person.crop.circle")
                        .frame(minWidth: 32, minHeight: 44)
                }
                .accessibilityLabel("アカウントと設定")
                .accessibilityIdentifier("redesign.stream.profile")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            RedesignAskBar(
                draft: $draft,
                isFocused: $askFocused,
                context: askContext,
                creditText: streamCreditBalanceText(totalRemaining: appModel.usage?.credits?.totalRemaining),
                disabledReason: askDisabledReason,
                isSending: isSubmitting,
                canSend: streamSendIntent(
                    draft: draft,
                    context: askContext,
                    disabledReason: askDisabledReason
                ) != nil,
                selectCompany: { present(.companyPicker) },
                openCredits: { openCredits(nil) },
                send: send
            )
        }
        .onChange(of: appModel.activeAlert?.id) { _, alertID in
            // 同意ダイアログが閉じたら、保留していた質問の続きを進める。
            // 会社ワークスペースのコンポーザと同じ扱い。
            guard alertID == nil, let deferredAsk else { return }
            self.deferredAsk = nil
            if appModel.aiConsentGranted {
                deliver(deferredAsk.question, to: deferredAsk.context)
            } else if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                draft = deferredAsk.question
            }
        }
    }

    // MARK: 面

    @ViewBuilder
    private func streamSections(_ items: [StreamItem]) -> some View {
        Section {
            ForEach(items) { item in
                switch item {
                case .answer(let entry):
                    RedesignStreamAnswerCard(
                        entry: entry,
                        open: { openConversation(entry.ticker, entry.filingKey) },
                        openSource: { openSource(entry.ticker, $0) }
                    )
                case .filingEvent(let event):
                    RedesignStreamFilingCard(
                        event: event,
                        open: {
                            appModel.openConversation(for: event.ticker)
                            openCompany(event.ticker)
                        },
                        prefill: { question in
                            apply(
                                streamSuggestedQuestionIntent(
                                    question: question,
                                    context: StreamAskContext(
                                        ticker: event.ticker,
                                        companyName: event.companyName
                                    )
                                )
                            )
                        }
                    )
                }
            }
        } header: {
            RedesignListSectionHeader(title: "ストリーム", trailing: "\(items.count)件")
        }
    }

    /// まだ何も無い面。ミッション文(既存文言のまま)+ スターター企業 + 例示の質問。
    @ViewBuilder
    private var emptyStreamSections: some View {
        if missionProminence == .prominent {
            Section {
                RedesignDiscoveryMission()
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }
        } else {
            Section {
                Text("まだ質問も新しい資料もありません。下のバーから聞くと、ここに残ります。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 10)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }
        }

        if appModel.showStarterCompanies, missionProminence == .prominent {
            Section {
                ForEach(appModel.starterCompanies) { company in
                    RedesignCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        detail: "10-K / 10-Qを確認",
                        isSaved: false
                    ) {
                        appModel.openConversation(for: company.ticker)
                        openCompany(company.ticker)
                    }
                }
            } header: {
                RedesignListSectionHeader(title: "はじめに見る会社")
            }
        }

        Section {
            ForEach(streamExampleQuestions, id: \.self) { question in
                ConversationPromptChip(text: question, systemImage: "sparkles") {
                    apply(streamSuggestedQuestionIntent(question: question, context: askContext))
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 3, leading: 16, bottom: 3, trailing: 16))
                .accessibilityIdentifier("redesign.stream.example.\(question)")
            }
        } header: {
            RedesignListSectionHeader(title: "こんなふうに聞けます")
        }
    }

    // MARK: アスクバーの動き

    private func send() {
        guard !isSubmitting,
              let intent = streamSendIntent(
                  draft: draft,
                  context: askContext,
                  disabledReason: askDisabledReason
              ) else {
            // 送れない理由が残高なら、その場でクレジットの導線を出す
            // (コンポーザの sendQuestion と同じ扱い)。
            if askDisabledReason == "残高不足" { appModel.requestCreditOptions() }
            return
        }
        apply(intent)
    }

    private func apply(_ intent: StreamAskBarIntent?) {
        guard let intent else { return }
        switch intent {
        case .prefill(let question, let context):
            if let context, context.ticker != askContext?.ticker {
                // 宛先を差し替える。ここでは送らない。
                appModel.openConversation(for: context.ticker)
            }
            draft = question
            askFocused = true
        case .submit(let question, let context):
            submit(question: question, context: context)
        }
    }

    private func submit(question: String, context: StreamAskContext) {
        switch redesignAskPreparation(
            rawQuestion: question,
            disabledReason: askDisabledReason,
            aiConsentGranted: appModel.aiConsentGranted
        ) {
        case .empty:
            return
        case .blocked:
            if !appModel.hasChatCreditAvailable { appModel.requestCreditOptions() }
        case .needsConsent(let prompt):
            deferredAsk = RedesignDeferredAsk(question: prompt, context: context)
            appModel.requestAIConsent()
        case .ready(let prompt):
            deliver(prompt, to: context)
        }
    }

    /// 送信。会社ドキュメントのコンポーザと同じ `appModel.sendChat` を呼ぶ。
    ///
    /// 送る前に資料を手元へ揃えるのは、`sendChat` が payload の無い会社を
    /// 「企業データを先に読み込んでください。」で弾くため。
    /// ワークスペースでは画面の `.task` がこの前提を満たしているので、
    /// ストリームでは押した側が同じ前提を満たしてから同じ道へ入る。
    private func deliver(_ prompt: String, to context: StreamAskContext) {
        askFocused = false
        draft = ""
        isSubmitting = true
        Task {
            appModel.openConversation(for: context.ticker)
            await appModel.loadCompany(ticker: context.ticker)
            // 回答が流れる面は会社ドキュメント。ストリームは終わったものを後から並べる。
            openCompany(context.ticker)
            let didSend = await appModel.sendChat(question: prompt, ticker: context.ticker)
            isSubmitting = false
            if !didSend, draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                draft = prompt
            }
        }
    }
}

// MARK: - アスクバー

/// 底に貼りつく質問バー。左=会社チップ、右上=残高、下段=入力欄と送信。
private struct RedesignAskBar: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var draft: String
    var isFocused: FocusState<Bool>.Binding
    let context: StreamAskContext?
    let creditText: String
    let disabledReason: String?
    let isSending: Bool
    let canSend: Bool
    let selectCompany: () -> Void
    let openCredits: () -> Void
    let send: () -> Void

    private var isOutOfCredit: Bool {
        disabledReason == "残高不足"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if dynamicTypeSize.isAccessibilitySize {
                // 拡大時は会社名も残高も1行に収まらない。縦へ逃がす。
                VStack(alignment: .leading, spacing: 6) {
                    companyChip
                    creditChip
                    if let disabledReason, !isOutOfCredit { statusText(disabledReason) }
                }
            } else {
                HStack(spacing: 8) {
                    companyChip
                    Spacer(minLength: 8)
                    if let disabledReason, !isOutOfCredit { statusText(disabledReason) }
                    creditChip
                }
            }

            HStack(alignment: .bottom, spacing: 10) {
                field
                sendButton
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 5)
        .background(KabuyomiTheme.paper)
        .overlay(alignment: .top) { KabuyomiHairline(color: KabuyomiTheme.separatorStrong) }
        // ここに識別子は付けない。素の VStack に付けると子孫まで降りていって
        // 会社チップ・残高・入力欄・送信の識別子を全部上書きする
        // (シミュレータ実機確認 2026-08-22)。バーの存在は送信ボタンで確かめる。
    }

    private var companyChip: some View {
        Button(action: selectCompany) {
            HStack(spacing: 6) {
                Image(systemName: "building.2")
                    .font(.caption2.weight(.bold))
                    .accessibilityHidden(true)
                Text(context?.displayName ?? "会社を選ぶ")
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(context == nil ? KabuyomiTheme.caution : KabuyomiTheme.accent)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(
                context == nil ? KabuyomiTheme.cautionSoft : KabuyomiTheme.accentMist,
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            context == nil
                ? "質問する会社を選ぶ"
                : "質問する会社: \(context?.displayName ?? "")。切り替える"
        )
        .accessibilityIdentifier("redesign.askbar.company")
    }

    private var creditChip: some View {
        Button(action: openCredits) {
            HStack(spacing: 4) {
                Image(systemName: isOutOfCredit ? "exclamationmark.circle.fill" : "bolt.fill")
                    .font(.system(size: 9, weight: .bold))
                    .accessibilityHidden(true)
                Text(isOutOfCredit ? "残高不足" : creditText)
                    .font(KabuyomiTheme.figure(.caption2, weight: .semibold))
            }
            .foregroundStyle(isOutOfCredit ? KabuyomiTheme.caution : KabuyomiTheme.inkSoft)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(
                isOutOfCredit ? KabuyomiTheme.cautionSoft : KabuyomiTheme.inputWell,
                in: RoundedRectangle(cornerRadius: 6, style: .continuous)
            )
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isOutOfCredit ? "残高不足。クレジットを確認" : "\(creditText)クレジット。クレジットを確認")
        .accessibilityIdentifier("redesign.askbar.credits")
    }

    private func statusText(_ reason: String) -> some View {
        Text(isSending ? "回答を作成中" : reason)
            .font(.caption2.weight(.medium))
            .foregroundStyle(KabuyomiTheme.caution)
            .lineLimit(1)
    }

    private var field: some View {
        TextField("この資料について質問", text: $draft, axis: .vertical)
            .focused(isFocused)
            .lineLimit(1...5)
            .submitLabel(.send)
            .onSubmit {
                if canSend { send() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(KabuyomiTheme.inputWell, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(
                        canSend ? KabuyomiTheme.accent.opacity(0.45) : KabuyomiTheme.separator,
                        lineWidth: KabuyomiTheme.hairlineWidth
                    )
            }
            .accessibilityIdentifier("redesign.askbar.field")
    }

    private var sendButton: some View {
        // 送信できる状態だけを accent で塗る。塗られていなければ押せない。
        Button(action: send) {
            Group {
                if isSending {
                    ProgressView()
                        .tint(KabuyomiTheme.accent)
                } else {
                    Image(systemName: "arrow.up")
                        .font(.subheadline.weight(.bold))
                }
            }
            .frame(width: 42, height: 42)
            .foregroundStyle(canSend ? KabuyomiTheme.onAccent : KabuyomiTheme.inkMuted)
            .background(
                canSend ? AnyShapeStyle(KabuyomiTheme.accent) : AnyShapeStyle(KabuyomiTheme.elevated),
                in: Circle()
            )
            .overlay {
                Circle()
                    .stroke(canSend ? Color.clear : KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
            }
        }
        .buttonStyle(.plain)
        // 送信中は資料を揃えている最中でもここを閉じる。2度押しで2件送らない。
        .disabled(!canSend || isSending)
        .accessibilityLabel("質問を送信")
        .accessibilityIdentifier("redesign.askbar.send")
    }
}

// MARK: - ストリームのカード

/// 回答カード。質問は小さく、回答は読み面、根拠はチップで下に。
private struct RedesignStreamAnswerCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let entry: ResearchArchiveEntry
    let open: () -> Void
    let openSource: (LocalMessageSourceRef) -> Void

    private var answerBody: String? {
        guard let text = entry.answerText else { return nil }
        let conclusion = structureAssistantMessage(text).conclusion.trimmingCharacters(in: .whitespacesAndNewlines)
        return conclusion.isEmpty ? nil : conclusion
    }

    private var trailingText: String {
        redesignHistoryTrailingText(
            answerCount: entry.answerCount,
            latestActivity: entry.latestActivity,
            formatted: redesignHistoryActivityText
        )
    }

    private var attributionText: String {
        var parts: [String] = []
        if !entry.formType.isEmpty { parts.append(entry.formType) }
        parts.append(formattedFilingDate(entry.filedAt))
        return parts.joined(separator: " ・ ")
    }

    private var accessibilityText: String {
        // 社名がまだ取れていない会社ではカードの社名に ticker が入っている。
        // 画面と同じ抑制をかけないと「AAPL、AAPL、…」と2度名乗る。
        let name = homeBoardCompanyName(companyName: entry.companyName, ticker: entry.ticker)
        var parts = [entry.ticker]
        if !name.isEmpty { parts.append(name) }
        parts.append(contentsOf: [attributionText, "質問、\(entry.question)"])
        if let answerBody { parts.append("回答、\(answerBody)") } else { parts.append("回答なし") }
        parts.append(trailingText)
        return parts.joined(separator: "、")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Button(action: open) {
                VStack(alignment: .leading, spacing: 7) {
                    companyHeader
                    questionBlock
                    if let answerBody {
                        // 行数は切らない。カードに出すのは
                        // `structureAssistantMessage` の結論だけで、
                        // 根拠と留意点はドキュメントの会話面に残っている。
                        // ここで途中まで見せると、読み面のはずのカードが
                        // 実際に文末を落とす(資料イベントの verdict と同じ理由。
                        // アクセシビリティ監査が Text clipped で拾う)。
                        Text(answerBody)
                            .font(.subheadline)
                            .foregroundStyle(KabuyomiTheme.ink)
                            .lineSpacing(3)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("回答なし")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("redesign.stream.answer.\(entry.id)")

            if !entry.sourceChips.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    RedesignSectionHeader(
                        title: "根拠",
                        trailing: "\(entry.sourceChips.count)件",
                        showsRule: false
                    )
                    ForEach(entry.sourceChips) { descriptor in
                        RedesignSourceChip(descriptor: descriptor) {
                            if let source = descriptor.source { openSource(source) }
                        }
                        .accessibilityIdentifier("redesign.citation.\(descriptor.id)")
                        if descriptor.id != entry.sourceChips.last?.id {
                            KabuyomiHairline()
                        }
                    }
                }
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(KabuyomiTheme.paper)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .accessibilityElement(children: .contain)
    }

    /// 会社ヘッダー行(Phase 5)。回答本文より先に「どの会社の話か」を出す。
    private var companyHeader: some View {
        RedesignStreamCompanyHeader(
            ticker: entry.ticker,
            companyName: homeBoardCompanyName(companyName: entry.companyName, ticker: entry.ticker),
            attribution: attributionText
        ) {
            Text(trailingText)
                .font(KabuyomiTheme.figure(.caption2, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var questionBlock: some View {
        // 質問も切らない。自分が書いた文が途中で消えるのは、
        // カードが「この質問への回答」だと分かる手がかりを削るだけ。
        Text(entry.question)
            .font(.footnote.weight(.medium))
            .foregroundStyle(KabuyomiTheme.ink)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(KabuyomiTheme.inputWell, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(KabuyomiTheme.accent.opacity(0.55))
                    .frame(width: 2)
                    .accessibilityHidden(true)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// 資料が出たカード。見出し + verdict + 提案質問チップ。
/// チップは入力欄に載せるだけで、送信は起きない。
private struct RedesignStreamFilingCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let event: StreamFilingEventCard
    let open: () -> Void
    let prefill: (String) -> Void

    private var filedText: String {
        event.filedAt.formatted(date: .abbreviated, time: .omitted)
    }

    private var accessibilityText: String {
        var parts: [String] = []
        if event.isUnread { parts.append("未読") }
        // 社名が取れていない会社では headline の主語が ticker になる。
        // そこで ticker を足すと「SOFI、SOFI の 10-K が出ました」と2度名乗る。
        if !homeBoardCompanyName(companyName: event.companyName, ticker: event.ticker).isEmpty {
            parts.append(event.ticker)
        }
        parts.append(event.headline)
        parts.append(filedText)
        // ピルは行の合成ラベルの内側にあり自前のラベルが届かないので、ここで読む。
        if let delta = event.revenueDelta {
            parts.append("売上高 前年同期比 \(delta.text)")
        }
        parts.append(event.verdictLine)
        return parts.joined(separator: "、")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Button(action: open) {
                VStack(alignment: .leading, spacing: 5) {
                    companyHeader
                    badgeRow
                    Text(event.headline)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    // 行数は切らない。verdict の書き出しは1文で、カードは行ではないので
                    // 2行で切ると実際に文末が消える(アクセシビリティ監査が
                    // 「Text clipped」で拾った。シミュレータ実機確認 2026-08-22)。
                    Text(event.verdictLine)
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("redesign.stream.filing.\(event.ticker)")

            if !event.suggestedQuestions.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(event.suggestedQuestions, id: \.self) { question in
                        ConversationPromptChip(text: question, systemImage: "sparkles") {
                            prefill(question)
                        }
                        .accessibilityIdentifier("redesign.stream.suggest.\(event.ticker).\(question)")
                    }
                }
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(KabuyomiTheme.paper)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .accessibilityElement(children: .contain)
    }

    /// 会社ヘッダー行(Phase 5)。売上 YoY のピルはこのカードにだけ添える。
    private var companyHeader: some View {
        RedesignStreamCompanyHeader(
            ticker: event.ticker,
            companyName: homeBoardCompanyName(companyName: event.companyName, ticker: event.ticker),
            // form と提出日は下の badgeRow が持つ。ヘッダーで二度言わない。
            attribution: "",
            delta: event.revenueDelta
        ) {
            EmptyView()
        }
    }

    @ViewBuilder
    private var badgeRow: some View {
        let leading = HStack(spacing: 7) {
            RedesignUnreadDot(isUnread: event.isUnread)
            Text(event.formType)
                .font(.caption2.weight(.bold))
                .tracking(0.5)
                .foregroundStyle(KabuyomiTheme.accent)
        }
        let filed = Text(filedText)
            .font(KabuyomiTheme.figure(.caption2))
            .foregroundStyle(KabuyomiTheme.inkMuted)
            .lineLimit(1)

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 2) {
                leading
                filed
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                leading
                Spacer(minLength: 8)
                filed
            }
        }
    }
}

// MARK: - サマリー(密度の家)

/// サマリータブ。Phase 3 の盤面を増強して戻したもの。
///
/// ストリームが「大胆だが薄い」ことへの答えがこの面で、役割はひとつ:
/// 追っている会社を**縦に読み下せる密度**で並べること。
/// 行タップは会社ドキュメントへ真っ直ぐ push する(質問はホームでする)。
/// 底には free プランのときだけバナー枠が1つ座る。
private struct RedesignSummaryView: View {
    @Environment(AppModel.self) private var appModel
    let openCompany: (String) -> Void
    let present: (RedesignSheet) -> Void

    private var savedCards: [WatchlistCard] {
        appModel.watchlist
    }

    private var recentCards: [WatchlistCard] {
        appModel.recentCompanyCards(limit: 8, includeSaved: false)
    }

    private var boardRows: [HomeBoardRow] {
        homeBoardRows(saved: savedCards, recent: recentCards, lastOpenedAt: appModel.lastOpenedAt)
    }

    /// バナー枠を出すか。判断そのものは `AdMobConfig` の純関数が持ち、
    /// ここは AppModel の課金状態を渡すだけ。ビューはサービスを作らない。
    private var showsBannerSlot: Bool {
        AdMobConfig.bannerSlotIsVisible(
            isFreePlan: appModel.shouldShowBannerAds,
            hasBannerAdUnit: AdMobConfig.hasBannerAdConfig
        )
    }

    var body: some View {
        List {
            if boardRows.isEmpty {
                emptyBoardSections
            } else {
                boardSection
            }
        }
        .listStyle(.plain)
        .listRowSeparatorTint(KabuyomiTheme.separator)
        .listSectionSpacing(10)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .background(KabuyomiTheme.canvas)
        // 識別子はリスト自身に付ける。チェーンの末尾に置くと safeAreaInset の
        // バナーまで降りていく(ストリームで踏んだのと同じ罠)。
        .accessibilityIdentifier("redesign.summary")
        .navigationTitle("サマリー")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    present(.companyPicker)
                } label: {
                    Image(systemName: "magnifyingglass")
                        .frame(minWidth: 32, minHeight: 44)
                }
                .accessibilityLabel("会社を検索")
                .accessibilityIdentifier("redesign.summary.search")
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    present(.settings)
                } label: {
                    Image(systemName: "person.crop.circle")
                        .frame(minWidth: 32, minHeight: 44)
                }
                .accessibilityLabel("アカウントと設定")
                .accessibilityIdentifier("redesign.summary.profile")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showsBannerSlot {
                AdMobBannerView(placement: .summary)
            }
        }
    }

    @ViewBuilder
    private var boardSection: some View {
        Section {
            ForEach(boardRows) { row in
                RedesignBoardRow(
                    row: row,
                    identifierPrefix: "redesign.summary",
                    showsAllDeltas: true,
                    action: { openCompany(row.ticker) }
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if row.isSaved {
                        Button("削除", role: .destructive) {
                            Task { await appModel.removeFromWatchlist(row.ticker) }
                        }
                        .accessibilityIdentifier("redesign.summary.remove.\(row.ticker)")
                    }
                }
            }
        } header: {
            RedesignListSectionHeader(title: "盤面", trailing: "\(boardRows.count)社")
        }
    }

    /// 盤面が空のときだけ、ミッション文とスターター企業に入れ替わる(Phase 3 のまま)。
    @ViewBuilder
    private var emptyBoardSections: some View {
        Section {
            RedesignDiscoveryMission()
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        }

        if appModel.showStarterCompanies {
            Section {
                ForEach(appModel.starterCompanies) { company in
                    RedesignCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        detail: "10-K / 10-Qを確認",
                        isSaved: false,
                        identifierPrefix: "redesign.summary"
                    ) {
                        openCompany(company.ticker)
                    }
                }
            } header: {
                RedesignListSectionHeader(title: "はじめに見る会社")
            }
        }
    }
}

// MARK: - 会社ピッカー(検索 + 盤面)

/// 会社チップと検索アイコンが開くシート。Phase 3 の盤面行と空状態をそのまま持つ。
/// 行のタップ = 質問の宛先にする、「開く」= 会社ドキュメントを開く。
private struct RedesignCompanyPickerSheet: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    let selectCompany: (String) -> Void
    let openCompany: (String) -> Void
    @State private var query = ""
    @State private var searchTask: Task<Void, Never>?

    private var savedCards: [WatchlistCard] {
        appModel.watchlist
    }

    private var recentCards: [WatchlistCard] {
        appModel.recentCompanyCards(limit: 8, includeSaved: false)
    }

    private var boardRows: [HomeBoardRow] {
        homeBoardRows(saved: savedCards, recent: recentCards, lastOpenedAt: appModel.lastOpenedAt)
    }

    var body: some View {
        NavigationStack {
            List {
                if appModel.searchIsLoading {
                    Section {
                        HStack(spacing: 10) {
                            ProgressView()
                                .controlSize(.small)
                                .tint(KabuyomiTheme.accent)
                            Text("銘柄を検索中…")
                                .font(.footnote)
                                .foregroundStyle(KabuyomiTheme.inkSoft)
                        }
                        .frame(minHeight: 40)
                        .listRowBackground(KabuyomiTheme.paper)
                    }
                } else if let message = appModel.searchErrorMessage {
                    Section {
                        ContentUnavailableView {
                            Label("検索できませんでした", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text(message)
                        } actions: {
                            Button("再検索") { searchNow() }
                        }
                        .listRowBackground(Color.clear)
                    }
                } else if !appModel.searchResults.isEmpty {
                    Section {
                        ForEach(appModel.searchResults) { item in
                            RedesignSearchResultRow(item: item, opened: openCompany)
                        }
                    } header: {
                        RedesignListSectionHeader(title: "検索結果", trailing: "\(appModel.searchResults.count)件")
                    }
                } else if boardRows.isEmpty {
                    emptyBoardSections
                } else {
                    boardSection
                }
            }
            .listStyle(.plain)
            .listRowSeparatorTint(KabuyomiTheme.separator)
            .listSectionSpacing(10)
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
            .background(KabuyomiTheme.canvas)
            .navigationTitle("会社を選ぶ")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "ティッカーまたは会社名"
            )
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
            .onDisappear { searchTask?.cancel() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") { dismiss() }
                        .accessibilityIdentifier("redesign.picker.close")
                }
            }
            .accessibilityIdentifier("redesign.picker")
        }
        .tint(KabuyomiTheme.accent)
    }

    @ViewBuilder
    private var boardSection: some View {
        Section {
            ForEach(boardRows) { row in
                RedesignBoardRow(
                    row: row,
                    action: { selectCompany(row.ticker) },
                    open: { openCompany(row.ticker) }
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if row.isSaved {
                        Button("削除", role: .destructive) {
                            Task { await appModel.removeFromWatchlist(row.ticker) }
                        }
                        .accessibilityIdentifier("redesign.board.remove.\(row.ticker)")
                    }
                }
            }
        } header: {
            RedesignListSectionHeader(title: "盤面", trailing: "\(boardRows.count)社")
        }
    }

    @ViewBuilder
    private var emptyBoardSections: some View {
        Section {
            RedesignDiscoveryMission()
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        }

        if appModel.showStarterCompanies {
            Section {
                ForEach(appModel.starterCompanies) { company in
                    RedesignCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        detail: "10-K / 10-Qを確認",
                        isSaved: false
                    ) {
                        openCompany(company.ticker)
                    }
                }
            } header: {
                RedesignListSectionHeader(title: "はじめに見る会社")
            }
        }
    }

    private func searchNow() {
        searchTask?.cancel()
        searchTask = Task {
            await appModel.search(query: query)
        }
    }
}

/// 未読ドット。色だけに意味を持たせないよう、VoiceOver ラベルには行側で「未読」を含める。
private struct RedesignUnreadDot: View {
    let isUnread: Bool

    var body: some View {
        Circle()
            .fill(isUnread ? KabuyomiTheme.accent : Color.clear)
            .frame(width: 7, height: 7)
            .accessibilityHidden(true)
    }
}

/// 増減ピル。株価アプリの塗りつぶしピルの形に、Phase 1 の増減バッジを入れる。
/// 矢印と符号は `RedesignDeltaBadge` 側が必ず併記する。
///
/// `label` を渡すとピルの頭に指標名が入る。3本並べる盤面では必須で、
/// 3本の区別を色や位置に頼らせない(色は上げ下げに使い切っている)。
private struct RedesignDeltaPill: View {
    let display: MetricYoYDisplay
    var label: String?

    private var fill: Color {
        switch display.tone {
        case .positive:
            return KabuyomiTheme.gainSoft
        case .negative:
            return KabuyomiTheme.lossSoft
        case .neutral:
            return KabuyomiTheme.separator
        }
    }

    var body: some View {
        HStack(spacing: 3) {
            if let label {
                Text(label)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineLimit(1)
                    .accessibilityHidden(true)
            }
            RedesignDeltaBadge(display: display, compact: true)
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 3)
        .background(fill, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

/// 盤面行の3本ピル。横に並べきれなければ縦へ落ちる。
///
/// `ViewThatFits` に任せているのは、ピルの幅が指標の書き分け
/// (「+16.6%」と「赤字縮小 84.8%」で倍近く違う)で決まり、
/// 収まるかどうかを事前に決められないため。
/// AX サイズでは測るまでもなく収まらないので、最初から縦積みにする。
private struct RedesignDeltaPillRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let deltas: [HomeBoardDelta]

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            stacked
        } else {
            // 候補に `Spacer` を入れない。`ViewThatFits` は候補の理想サイズで
            // 判定するので、Spacer が入ると常に「入らない」と判断して
            // 既定サイズでも縦積みになる(シミュレータ実機確認 2026-08-22)。
            // 左寄せは `ViewThatFits` の外で決める。
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) {
                    pills
                }
                stacked
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: 4) {
            pills
        }
    }

    @ViewBuilder
    private var pills: some View {
        ForEach(deltas) { delta in
            RedesignDeltaPill(display: delta.display, label: delta.label)
                .fixedSize()
        }
    }
}

/// 盤面の1行。ticker(tabular・行内で最大)/ 社名 / 最新 filing /
/// 売上・営業利益・純利益の YoY ピル / 未読ドット。
///
/// 2つの面が同じ行を使う:
/// - **サマリータブ**: 行タップ = ドキュメントを開く(`open` を渡さない)
/// - **会社ピッカー**: 行タップ = 質問の宛先にする、末尾の「開く」= ドキュメント
///
/// 面ごとに識別子がぶつからないよう `identifierPrefix` を分ける。
/// ピッカーはサマリーの上にシートとして出るので、両方が同時に木の中に居る。
private struct RedesignBoardRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let row: HomeBoardRow
    var identifierPrefix: String = "redesign.company"
    /// 3本ピル(売上・営業利益・純利益)を出すのは**サマリータブだけ**。
    /// ピッカーは会社を選ぶための一覧なので、1画面に入る行数を落とさない
    /// (3本並べると横に入りきらず縦積みへ落ち、行の高さがほぼ倍になる。
    /// シミュレータ実機確認 2026-08-22)。ピッカーは Phase 4 と同じ売上1本のまま。
    var showsAllDeltas: Bool = false
    let action: () -> Void
    /// 与えられたときだけ末尾に「開く」を出す。無ければ従来どおり行全体で開く。
    var open: (() -> Void)?

    private var visibleDeltas: [HomeBoardDelta] {
        showsAllDeltas ? row.deltas : row.deltas.filter { $0.logicalName == "revenue" }
    }

    private var filingDetail: String {
        if row.isPlaceholder { return "資料を準備中" }
        guard !row.formType.isEmpty else { return "資料を確認" }
        return "\(row.formType) ・ \(row.filedAt.formatted(date: .abbreviated, time: .omitted))"
    }

    private var accessibilityText: String {
        var parts: [String] = []
        if row.isUnread { parts.append("未読") }
        parts.append(row.ticker)
        if !row.companyName.isEmpty { parts.append(row.companyName) }
        parts.append(filingDetail)
        // ピルは行の合成ラベルの中でしか読まれない
        // (`accessibilityElement(children: .ignore)` の内側なので、
        // ピル自身が持つラベルは VoiceOver に届かない)。
        // どの指標かはここで名乗る。
        parts.append(contentsOf: visibleDeltas.map(\.accessibilityText))
        if row.isSaved { parts.append("保存済み") }
        return parts.joined(separator: "、")
    }

    var body: some View {
        HStack(spacing: 8) {
            Button(action: action) {
                HStack(alignment: .top, spacing: 9) {
                    RedesignUnreadDot(isUnread: row.isUnread)
                        .padding(.top, 7)
                    content
                    if open == nil {
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .padding(.top, 5)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.vertical, 6)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                open == nil ? accessibilityText : "\(accessibilityText)。質問の宛先にする"
            )
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier(
                open == nil
                    ? "\(identifierPrefix).open.\(row.ticker)"
                    : "\(identifierPrefix).select.\(row.ticker)"
            )

            if let open {
                Button(action: open) {
                    Text("開く")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.accent)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .fixedSize()
                .accessibilityLabel("\(row.ticker) を開く")
                .accessibilityIdentifier("\(identifierPrefix).open.\(row.ticker)")
            }
        }
        .listRowBackground(KabuyomiTheme.paper)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
    }

    @ViewBuilder
    private var content: some View {
        // ticker は行内で最大の文字(v2 IA 仕様 Phase 5)。
        // 密度の家では「どの会社か」がいちばん速く読めなければならない。
        let identity = HStack(spacing: 5) {
            Text(row.ticker)
                .font(KabuyomiTheme.figure(.title3, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if row.isSaved {
                Image(systemName: "bookmark.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accent)
                    .accessibilityHidden(true)
            }
        }
        let name = Text(row.companyName)
            .font(.footnote)
            .foregroundStyle(KabuyomiTheme.inkSoft)
            .multilineTextAlignment(.leading)
        let detail = Text(filingDetail)
            .font(KabuyomiTheme.figure(.caption2))
            .foregroundStyle(KabuyomiTheme.inkMuted)

        VStack(alignment: .leading, spacing: 3) {
            if dynamicTypeSize.isAccessibilitySize {
                // 拡大時は ticker と提出情報を同じ行へ押し込まない。どちらも省略記号に化ける。
                identity
                // 会社名がまだ取れていない行では ticker と同じ文字が入っている。
                // 同じ語を2段重ねない。
                if !row.companyName.isEmpty { name }
                detail.fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    identity
                    Spacer(minLength: 8)
                    detail.lineLimit(1).fixedSize()
                }
                if !row.companyName.isEmpty { name.lineLimit(1) }
            }

            // ピルは会社名の下に1段取る。ticker の右へ寄せると、
            // 3本のうち何本出るかが会社ごとに違うぶん行の右端が揃わない。
            if !visibleDeltas.isEmpty {
                RedesignDeltaPillRow(deltas: visibleDeltas)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}


private struct RedesignSearchResultRow: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let item: SearchItem
    let opened: (String) -> Void

    private var isSaved: Bool {
        appModel.isTickerInWatchlist(item.ticker, cik: item.cik)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                open()
            } label: {
                HStack(alignment: .top, spacing: 11) {
                    RedesignTickerMonogram(ticker: item.ticker)
                    VStack(alignment: .leading, spacing: 2) {
                        identityRow
                        Text(item.companyName)
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkSoft)
                            .multilineTextAlignment(.leading)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        Text(item.supportDisplayLabel)
                            .font(.caption2)
                            .foregroundStyle(item.canAttemptInV1 ? KabuyomiTheme.accent : KabuyomiTheme.inkMuted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .padding(.top, 4)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(item.ticker)、\(item.companyName)、\(item.supportDisplayLabel)")
            .accessibilityIdentifier("redesign.search.open.\(item.ticker)")

            if item.canAttemptInV1 {
                Button {
                    Task { await appModel.saveSearchResult(item) }
                } label: {
                    Label(
                        isSaved ? "保存済み" : "会社を保存",
                        systemImage: isSaved ? "checkmark" : "bookmark"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(isSaved ? KabuyomiTheme.inkMuted : KabuyomiTheme.accent)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(appModel.isAddingTicker(item.ticker) || isSaved)
                .accessibilityIdentifier("redesign.search.save.\(item.ticker)")
            } else {
                Text(item.availabilityNote)
                    .font(.caption2)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 3)
        .listRowBackground(KabuyomiTheme.paper)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var identityRow: some View {
        let ticker = Text(item.ticker)
            .font(KabuyomiTheme.figure(.subheadline, weight: .semibold))
            .foregroundStyle(KabuyomiTheme.ink)
        let exchange = Text(item.exchange)
            .font(.caption2.weight(.semibold))
            .tracking(0.4)
            .foregroundStyle(KabuyomiTheme.inkMuted)

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 1) {
                ticker
                exchange
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                ticker.lineLimit(1)
                exchange.lineLimit(1)
            }
        }
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

/// ticker の頭2文字を入れる小さな枠。
/// 根拠チップのバッジと同じ塗り・同じ角丸にして、画面をまたいでも同じ体系に読めるようにする。
private struct RedesignTickerMonogram: View {
    /// 枠も文字と一緒に伸ばす。文字だけを大きくすると枠から溢れる。
    /// 上限を付けているのは、装飾の枠が AX サイズで行の主役になってしまわないため。
    @ScaledMetric(relativeTo: .caption2) private var boxScale: CGFloat = 1

    let ticker: String
    /// 既定は一覧行の 28pt。ストリームのカードの会社ヘッダーだけ大きくする
    /// (本文より先に「どの会社の話か」を目に入れるため)。
    var size: CGFloat = 28

    private var box: CGFloat { min(size * boxScale, size * 1.5) }

    var body: some View {
        // フォントはテキストスタイル基準にする。`.system(size:)` の固定値だと
        // 「文字サイズを変えられない要素」としてアクセシビリティ監査が拾う
        // (`accessibilityHidden` を付けていても拾われる。
        //  シミュレータ実機確認 2026-08-22)。既定サイズでの見た目は
        // caption2 = 11pt / footnote = 13pt で従来と同じ。
        Text(String(ticker.prefix(2)))
            .font(size >= 32 ? .footnote.weight(.bold) : .caption2.weight(.bold))
            .tracking(0.4)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .foregroundStyle(KabuyomiTheme.accent)
            .frame(width: box, height: box)
            .background(KabuyomiTheme.accentMist, in: RoundedRectangle(cornerRadius: box * 0.21, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: box * 0.21, style: .continuous)
                    .stroke(KabuyomiTheme.accent.opacity(0.28), lineWidth: KabuyomiTheme.hairlineWidth)
            }
            .accessibilityHidden(true)
    }
}

/// ストリームのカードの頭に置く会社ヘッダー行(v2 IA 仕様 Phase 5)。
///
/// モノグラム + ticker(tabular・強め)+ 社名。本文より先に会社が目に入る。
/// 抑制的に保つ: ティッカーごとの色分けはしない。モノグラムは teal 系ひとつだけで、
/// 色は上げ下げのピルに残しておく。
private struct RedesignStreamCompanyHeader<Trailing: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let ticker: String
    let companyName: String
    let attribution: String
    /// 資料イベントカードだけが売上 YoY のピルを持つ。
    var delta: MetricYoYDisplay?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RedesignTickerMonogram(ticker: ticker, size: 34)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                if dynamicTypeSize.isAccessibilitySize {
                    tickerText
                    identityDetails
                    trailing()
                    deltaPill
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        tickerText
                        Spacer(minLength: 8)
                        trailing()
                    }
                    HStack(spacing: 7) {
                        identityDetails
                        Spacer(minLength: 4)
                        deltaPill
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var tickerText: some View {
        Text(ticker)
            .font(KabuyomiTheme.figure(.subheadline, weight: .semibold))
            .foregroundStyle(KabuyomiTheme.ink)
            .lineLimit(1)
    }

    @ViewBuilder
    private var identityDetails: some View {
        let name = Text(companyName)
            .font(.caption)
            .foregroundStyle(KabuyomiTheme.inkSoft)
        let attributed = Text(attribution)
            .font(KabuyomiTheme.figure(.caption2))
            .foregroundStyle(KabuyomiTheme.inkMuted)

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 1) {
                if !companyName.isEmpty { name.fixedSize(horizontal: false, vertical: true) }
                if !attribution.isEmpty { attributed.fixedSize(horizontal: false, vertical: true) }
            }
        } else {
            HStack(spacing: 7) {
                if !companyName.isEmpty { name.lineLimit(1) }
                if !attribution.isEmpty { attributed.lineLimit(1).fixedSize() }
            }
        }
    }

    @ViewBuilder
    private var deltaPill: some View {
        if let delta {
            RedesignDeltaPill(display: delta).fixedSize()
        }
    }
}

/// 発見画面と履歴で共有する会社行。
/// ロゴ枠を縮め、ticker を tabular で左に固定し、会社名と書類ヒントを1行ずつに畳んで、
/// 1画面あたりの行数を上げる。拡大時だけ縦積みへ逃がす。
private struct RedesignCompanyRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let ticker: String
    let companyName: String
    let detail: String
    let isSaved: Bool
    /// 同じスターター一覧がストリーム・ピッカー・サマリーの3か所に出るので、
    /// 面ごとに識別子を分ける(`RedesignBoardRow` と同じ理由)。
    var identifierPrefix: String = "redesign.company"
    let action: () -> Void

    private var accessibilityText: String {
        var parts = [ticker, companyName, detail]
        if isSaved { parts.append("保存済み") }
        return parts.joined(separator: "、")
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 11) {
                RedesignTickerMonogram(ticker: ticker)
                content
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(.top, 9)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(KabuyomiTheme.paper)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .accessibilityLabel(accessibilityText)
        .accessibilityIdentifier("\(identifierPrefix).open.\(ticker)")
    }

    @ViewBuilder
    private var content: some View {
        let tickerText = HStack(spacing: 5) {
            Text(ticker)
                .font(KabuyomiTheme.figure(.subheadline, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.ink)
                .lineLimit(1)
            if isSaved {
                Image(systemName: "bookmark.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accent)
                    .accessibilityHidden(true)
            }
        }
        let detailText = Text(detail)
            .font(KabuyomiTheme.figure(.caption2))
            .foregroundStyle(KabuyomiTheme.inkMuted)
        let nameText = Text(companyName)
            .font(.footnote)
            .foregroundStyle(KabuyomiTheme.inkSoft)
            .multilineTextAlignment(.leading)

        if dynamicTypeSize.isAccessibilitySize {
            // 拡大時に1行へ押し込むと、会社名も提出情報も省略記号に化ける。
            VStack(alignment: .leading, spacing: 2) {
                tickerText
                nameText
                detailText.fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    tickerText
                    Spacer(minLength: 8)
                    detailText.lineLimit(1)
                }
                nameText.lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
    /// 面ごとのスクロール位置。表示中の面の値だけを見てヘッダの収束を決める。
    @State private var scrollOffsets: [String: CGFloat] = [:]
    @State private var isHeaderCollapsed = false
    @FocusState private var composerFocused: Bool

    private static let documentSurfaceID = "document"
    private static let conversationSurfaceID = "conversation"
    private static let scrollSpace = "redesign.company.scroll"

    private var activeScrollOffset: CGFloat {
        scrollOffsets[surface == .conversation ? Self.conversationSurfaceID : Self.documentSurfaceID] ?? 0
    }

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
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 8)
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
                    KabuyomiHairline().padding(.horizontal, 18)
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
            .redesignScrollOffsetReader(id: Self.documentSurfaceID, in: Self.scrollSpace)
        }
        .coordinateSpace(name: Self.scrollSpace)
        // 本文より短い資料でも読み面が途中で切れないよう、面ごと paper で塗る。
        .background(KabuyomiTheme.paper)
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
                .redesignScrollOffsetReader(id: Self.conversationSurfaceID, in: Self.scrollSpace)
            }
            .coordinateSpace(name: Self.scrollSpace)
            .background(KabuyomiTheme.paper)
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
                    // 常駐で画面1/4を占めていたヘッダは、スクロールで1行のバーへ収束する。
                    // 状態行(保存済み資料表示中 / 前の資料に基づく会話)は畳まれる領域の外に置き、
                    // 収束しても消えないようにする。
                    RedesignCollapsingCompanyHeader(
                        companyName: company.companyName,
                        formType: company.formType,
                        filedAt: formattedFilingDate(company.filedAt),
                        sourceCount: company.sourceChunks.count,
                        isCollapsed: isHeaderCollapsed,
                        openSources: openSources,
                        expanded: {
                            RedesignWorkspaceContextHeader(
                                company: company,
                                openSources: openSources
                            )
                        },
                        pinned: {
                            RedesignWorkspaceStatusRows(
                                company: company,
                                isOlderFiling: appModel.isViewingOlderFilingConversation(ticker: normalizedTicker),
                                openLatest: { appModel.openLatestConversation(for: normalizedTicker) }
                            )
                        }
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
                    .onPreferenceChange(RedesignScrollOffsetKey.self) { offsets in
                        scrollOffsets = offsets
                    }
                }
                .onChange(of: activeScrollOffset) { _, offset in
                    let next = redesignHeaderCollapsed(current: isHeaderCollapsed, offset: offset)
                    if next != isHeaderCollapsed { isHeaderCollapsed = next }
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
                VStack(spacing: 12) {
                    ProgressView()
                        .tint(KabuyomiTheme.accent)
                    Text("\(normalizedTicker) のSEC資料を準備しています")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("保存済みデータがあれば先に表示し、最新資料を確認します。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkSoft)
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
        VStack(alignment: .leading, spacing: 16) {
            Text("リサーチノート")
                .font(.footnote.weight(.bold))
                .tracking(KabuyomiTheme.microLabelTracking)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .padding(.top, 16)

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
        .padding(.horizontal, 18)
        .padding(.bottom, 20)
    }

    /// ストリームのアスクバーと同じ関数。文言も優先順位もここでは決めない。
    private var composerDisabledReason: String? {
        redesignComposerDisabledReason(
            isSending: pendingChat != nil,
            hasChatCreditAvailable: appModel.hasChatCreditAvailable,
            authenticatedCreditActionsAvailable: appModel.authenticatedCreditActionsAvailable,
            chatEnabled: appModel.usage?.capabilities?.chatEnabled
        )
    }

    private func sendQuestion() {
        switch redesignAskPreparation(
            rawQuestion: question,
            disabledReason: composerDisabledReason,
            aiConsentGranted: appModel.aiConsentGranted
        ) {
        case .empty:
            return
        case .blocked:
            if !appModel.hasChatCreditAvailable {
                appModel.requestCreditOptions()
            }
        case .needsConsent(let prompt):
            deferredConsentQuestion = prompt
            appModel.requestAIConsent()
        case .ready(let prompt):
            submit(prompt)
        }
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let company: CompanyPayload
    let openSources: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(company.companyName)
                .font(.title3.weight(.bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            metaRow

            Button(action: openSources) {
                HStack(spacing: 8) {
                    Text("資料と根拠")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.accent)
                    Text("\(company.sourceChunks.count)件")
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("redesign.company.sources")
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var metaRow: some View {
        let identity = HStack(alignment: .firstTextBaseline, spacing: 7) {
            Text(company.formType)
                .font(.caption.weight(.bold))
                .tracking(0.5)
                .foregroundStyle(KabuyomiTheme.accent)
            Text(formattedFilingDate(company.filedAt))
                .font(KabuyomiTheme.figure(.caption, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkSoft)
        }
        let updated = Text("更新 \(formattedFilingDate(company.lastUpdatedAt))")
            .font(KabuyomiTheme.figure(.caption2))
            .foregroundStyle(KabuyomiTheme.inkMuted)

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 3) {
                identity
                updated
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                identity
                Spacer(minLength: 8)
                updated
            }
        }
    }
}

/// ヘッダが収束しても消してはいけない状態行。
/// 「保存済み資料を表示中」「前の資料に基づく会話」は、
/// 見えているかどうかで読み手の判断が変わるので常駐させる。
private struct RedesignWorkspaceStatusRows: View {
    let company: CompanyPayload
    let isOlderFiling: Bool
    let openLatest: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if company.isStaleReady {
                Label(
                    company.statusMessage ?? "保存済み資料を表示しています。最新状態を確認中です。",
                    systemImage: "clock.arrow.circlepath"
                )
                .font(.caption2)
                .foregroundStyle(KabuyomiTheme.caution)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if isOlderFiling {
                Button(action: openLatest) {
                    Label("前の資料に基づく会話です。最新資料へ戻る", systemImage: "clock.arrow.circlepath")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("redesign.company.openLatest")
            }
        }
        .padding(.horizontal, 18)
        .padding(.bottom, company.isStaleReady || isOlderFiling ? 8 : 0)
    }
}

private struct RedesignResearchOverview: View {
    let company: CompanyPayload
    let openSource: (LocalMessageSourceRef) -> Void
    /// セクションの開閉は画面内で保持する。読み返している最中に畳み直されないように。
    @State private var isMetricsExpanded = true
    @State private var areHighlightsExpanded = true
    @State private var areChangesExpanded = true

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
        VStack(alignment: .leading, spacing: 20) {
            // 「概要」というラベルは中身を説明していないので置かない。
            // 直上のヘッダに会社名・書類種別・提出日が出ており、文脈は足りている。
            Text(company.summary.verdict)
                .font(.title3.weight(.semibold))
                .foregroundStyle(KabuyomiTheme.ink)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("redesign.company.verdict")

            if !metrics.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    RedesignSectionHeader(
                        title: "主要数値",
                        trailing: "\(metrics.count)件",
                        isExpanded: $isMetricsExpanded,
                        identifier: "redesign.company.metrics.toggle"
                    )
                    if isMetricsExpanded {
                        RedesignMetricGrid {
                            ForEach(metrics) { metric in
                                RedesignMetricView(metric: metric, history: history(for: metric))
                            }
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
                    isExpanded: $areHighlightsExpanded,
                    identifier: "redesign.company.highlights.toggle",
                    openSource: openSource
                )
            }

            if !company.summary.changes.isEmpty {
                RedesignEvidenceList(
                    title: "確認したい点",
                    lines: company.summary.changes,
                    company: company,
                    emphasis: .secondary,
                    isExpanded: $areChangesExpanded,
                    identifier: "redesign.company.changes.toggle",
                    openSource: openSource
                )
            }

            if let historicalOverview = company.historicalOverview,
               !historicalOverview.series.isEmpty {
                RedesignHistoricalOverview(overview: historicalOverview)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 24)
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
    var isExpanded: Binding<Bool>?
    var identifier: String?
    let openSource: (LocalMessageSourceRef) -> Void

    private var showsBody: Bool {
        isExpanded?.wrappedValue ?? true
    }

    /// 同じ行の根拠は、ラベルが総称に畳まれても
    /// バッジと抜粋断片で1つずつ見分けられる形に組み立てる。
    private func chips(for line: SummaryLinePayload) -> [SourceChipDescriptor] {
        let chunks = line.sourceIds.compactMap { sourceID in
            company.sourceChunks.first(where: { $0.sourceId == sourceID })
        }
        return sourceChipDescriptors(for: chunks, in: company)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RedesignSectionHeader(
                title: title,
                trailing: "\(lines.count)件",
                isExpanded: isExpanded,
                identifier: identifier
            )

            if showsBody {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(lines) { line in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .top, spacing: 9) {
                                Image(systemName: "text.quote")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(KabuyomiTheme.accent)
                                    .padding(.top, 3)
                                    .accessibilityHidden(true)
                                Text(line.text)
                                    .font(emphasis == .primary ? .subheadline : .footnote)
                                    .foregroundStyle(emphasis == .primary ? KabuyomiTheme.ink : KabuyomiTheme.inkSoft)
                                    .lineSpacing(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(.top, 9)

                            let descriptors = chips(for: line)
                            if !descriptors.isEmpty {
                                VStack(alignment: .leading, spacing: 0) {
                                    ForEach(descriptors) { descriptor in
                                        RedesignSourceChip(descriptor: descriptor) {
                                            if let source = descriptor.source { openSource(source) }
                                        }
                                    }
                                }
                                .padding(.leading, 22)
                            }
                        }
                        .padding(.bottom, 6)
                        if line.id != lines.last?.id {
                            KabuyomiHairline()
                        }
                    }
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
        RedesignMetricCell(
            label: MetricLabeler.title(for: metric.logicalName),
            value: formattedMetricValue(metric),
            delta: metricYoYDisplay(for: metric),
            // 前年同期比が無い指標だけ ISO 日付が生で出ており、他のセルと揃っていなかった。
            // 何の日付か分かる形にして、表記もアプリ内の他の日付と合わせる。
            caption: "期末 \(formattedFilingDate(metric.periodEnd))",
            history: history,
            accessibilityText: accessibilitySummary
        )
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
        VStack(alignment: .leading, spacing: 0) {
            RedesignSectionHeader(
                title: "推移",
                subtitle: "過去\(overview.years)期 ・ \(historicalBasisTitle(overview.comparisonBasis))",
                trailing: "\(min(overview.series.count, 4))指標",
                isExpanded: $isExpanded,
                identifier: "redesign.company.historical.toggle"
            )

            if isExpanded {
                historicalSeries
            }
        }
    }

    @ViewBuilder
    private var historicalSeries: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(overview.series.prefix(4)) { series in
                RedesignTrendChart(series: series)
                    .padding(.vertical, 10)
                if series.id != overview.series.prefix(4).last?.id {
                    KabuyomiHairline()
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
        VStack(alignment: .leading, spacing: 8) {
            RedesignSectionHeader(
                title: "この資料を深掘りする",
                subtitle: "質問は対象資料と会話の文脈に基づいて回答されます。"
            )
            ForEach(prompts, id: \.self) { prompt in
                ConversationPromptChip(text: prompt, systemImage: "sparkles") {
                    select(prompt)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
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

    /// 送信可能な状態。塗り分けと disabled はここ1か所から決める。
    private var canSend: Bool {
        disabledReason == nil && !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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

        .padding(.horizontal, 12)
        .padding(.top, 7)
        .padding(.bottom, 5)
        // 半透明だと本文が板の裏に透けて、読む面と聞く面の境目が消える。
        .background(KabuyomiTheme.paper)
        .overlay(alignment: .top) { KabuyomiHairline(color: KabuyomiTheme.separatorStrong) }
    }

    private var collapsedEntry: some View {
        Button {
            isExpandedByUser = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.accent)
                    .accessibilityHidden(true)
                Text("この資料について質問する")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.accent)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(KabuyomiTheme.inputWell, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
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
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.caution)
                } else {
                    Text(isSending ? "回答を作成中" : (disabledReason ?? creditText))
                        .font(.caption2.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(disabledReason == nil ? KabuyomiTheme.inkMuted : KabuyomiTheme.caution)
                }
                Spacer()
                if disabledReason == "残高不足" {
                    Button(action: openCredits) {
                        Text(dynamicTypeSize.isAccessibilitySize ? "確認" : "クレジットを確認")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.accent)
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
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(KabuyomiTheme.inputWell, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(canSend ? KabuyomiTheme.accent.opacity(0.45) : KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
                    }
                    .accessibilityIdentifier("redesign.composer.field")

                // 送信できる状態だけを accent で塗る。塗られていなければ押せない。
                Button(action: send) {
                    Group {
                        if isSending {
                            // 送信中は canSend が false になり丸は elevated で塗られる。
                            // onAccent(ほぼ黒)を載せると暗い面に暗い渦で消える。
                            ProgressView()
                                .tint(KabuyomiTheme.accent)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.subheadline.weight(.bold))
                        }
                    }
                    .frame(width: 42, height: 42)
                    .foregroundStyle(canSend ? KabuyomiTheme.onAccent : KabuyomiTheme.inkMuted)
                    .background(canSend ? AnyShapeStyle(KabuyomiTheme.accent) : AnyShapeStyle(KabuyomiTheme.elevated), in: Circle())
                    .overlay {
                        Circle()
                            .stroke(canSend ? Color.clear : KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
                    }
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

    /// 同じラベルに畳まれた根拠も、バッジと抜粋断片で1つずつ見分けられるようにする。
    private var sourceChips: [SourceChipDescriptor] {
        sourceChipDescriptors(for: sources, in: company)
    }

    /// 結論は1文とは限らない。列挙型の回答("1つ目は…2つ目は…")では
    /// `structureAssistantMessage` が複数文を意図的に結論へまとめる仕様のため、
    /// 常に .title3 で描くと見出しサイズの塊が数行続いて読みにくくなる。
    /// 長さで段階的に落とし、短い結論だけを見出しとして立てる。
    private var conclusionFont: Font {
        switch structuredAnswer.conclusion.count {
        case ..<65:
            return .title3.weight(.regular)
        case ..<141:
            return .subheadline.weight(.semibold)
        default:
            return .subheadline
        }
    }

    var body: some View {
        if message.role == "user" {
            VStack(alignment: .leading, spacing: 4) {
                Text("質問")
                    .kabuyomiMicroLabel()
                Text(message.content)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(KabuyomiTheme.inputWell, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(KabuyomiTheme.accent.opacity(0.55))
                    .frame(width: 2)
                    .accessibilityHidden(true)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("質問、\(message.content)")
        } else {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("リサーチ回答")
                        .font(.caption2.weight(.bold))
                        .tracking(KabuyomiTheme.microLabelTracking)
                        .foregroundStyle(KabuyomiTheme.accent)
                    if message.modelName != "local", !message.modelName.isEmpty {
                        Label("AIによる要約", systemImage: "sparkles")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }

                Text(structuredAnswer.conclusion)
                    .font(conclusionFont)
                    .foregroundStyle(KabuyomiTheme.ink)
                    .lineSpacing(4)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)

                if !structuredAnswer.evidence.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        RedesignSectionHeader(title: "根拠となるポイント", showsRule: false)
                        ForEach(structuredAnswer.evidence, id: \.self) { sentence in
                            HStack(alignment: .firstTextBaseline, spacing: 9) {
                                Circle()
                                    .fill(KabuyomiTheme.inkMuted)
                                    .frame(width: 4, height: 4)
                                    .accessibilityHidden(true)
                                Text(sentence)
                                    .font(.footnote)
                                    .foregroundStyle(KabuyomiTheme.ink)
                                    .lineSpacing(4)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }

                if !structuredAnswer.limitations.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        RedesignSectionHeader(title: "留意点", showsRule: false)
                        ForEach(structuredAnswer.limitations, id: \.self) { sentence in
                            Text(sentence)
                                .font(.caption)
                                .foregroundStyle(KabuyomiTheme.inkSoft)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                if !sourceChips.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        RedesignSectionHeader(title: "根拠", trailing: "\(sourceChips.count)件", showsRule: false)
                        ForEach(sourceChips) { descriptor in
                            RedesignSourceChip(descriptor: descriptor) {
                                if let source = descriptor.source { openSource(source) }
                            }
                            .accessibilityIdentifier("redesign.citation.\(descriptor.id)")
                            if descriptor.id != sourceChips.last?.id {
                                KabuyomiHairline()
                            }
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
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text("質問")
                    .kabuyomiMicroLabel()
                Text(question)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(KabuyomiTheme.ink)
            }
            HStack(spacing: 10) {
                ProgressView()
                    .controlSize(.small)
                    .tint(KabuyomiTheme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("提出資料を確認しています")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("根拠を照合して回答を作成中です。")
                        .font(.caption2)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
            .padding(.vertical, 4)
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let company: CompanyPayload
    let selectFiling: (String) -> Void
    let openSource: (LocalMessageSourceRef) -> Void

    private var filingHistory: [LocalCompanyRecord] {
        appModel.conversationHistory(for: company.ticker)
    }

    private var sourceDescriptors: [SourceChipDescriptor] {
        sourceChipDescriptors(
            for: company.sourceChunks.sorted(by: { $0.sortOrder < $1.sortOrder }),
            in: company,
            fragmentLimit: 132
        )
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(company.formType)
                            .font(.caption.weight(.bold))
                            .tracking(0.5)
                            .foregroundStyle(KabuyomiTheme.accent)
                        Text(formattedFilingDate(company.filedAt))
                            .font(KabuyomiTheme.figure(.subheadline, weight: .medium))
                            .foregroundStyle(KabuyomiTheme.ink)
                    }
                    Text(company.companyName)
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("更新 \(formattedFilingDate(company.lastUpdatedAt))")
                        .font(KabuyomiTheme.figure(.caption2))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                .padding(.vertical, 7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                .listRowBackground(KabuyomiTheme.paper)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))

                if let url = resolvedExternalHTTPURL(from: company.primaryDocumentUrl, allowBareDomain: false) {
                    Button {
                        openURL(url)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "safari")
                                .font(.caption.weight(.semibold))
                                .accessibilityHidden(true)
                            Text("SEC原文をブラウザで開く")
                                .font(.footnote.weight(.semibold))
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.up.right")
                                .font(.caption2.weight(.bold))
                                .accessibilityHidden(true)
                        }
                        .foregroundStyle(KabuyomiTheme.accent)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(KabuyomiTheme.paper)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                }
            } header: {
                RedesignListSectionHeader(title: "対象資料")
            }

            if filingHistory.count > 1 {
                Section {
                    ForEach(filingHistory, id: \.company.filingKey) { record in
                        filingHistoryRow(record)
                    }
                } header: {
                    RedesignListSectionHeader(title: "会話のある資料", trailing: "\(filingHistory.count)件")
                }
            }

            Section {
                if company.sourceChunks.isEmpty {
                    Text("この資料には表示できる根拠抜粋がありません。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                        .frame(minHeight: 40, alignment: .leading)
                        .listRowBackground(KabuyomiTheme.paper)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                } else {
                    // ラベルが総称に畳まれても、バッジ + 抜粋断片で行を区別できるようにする。
                    ForEach(sourceDescriptors) { descriptor in
                        RedesignSourceChip(descriptor: descriptor) {
                            if let source = descriptor.source { openSource(source) }
                        }
                        .listRowBackground(KabuyomiTheme.paper)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                        .accessibilityIdentifier("redesign.source.open.\(descriptor.id)")
                    }
                }
            } header: {
                RedesignListSectionHeader(title: "根拠", trailing: "\(company.sourceChunks.count)件")
            }
        }
        .listStyle(.plain)
        .listRowSeparatorTint(KabuyomiTheme.separator)
        // 既定の節間は1画面あたりの行数を目に見えて削る。密度側へ寄せる。
        .listSectionSpacing(10)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .background(KabuyomiTheme.canvas)
        .navigationTitle("資料と根拠")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("redesign.sources")
    }

    @ViewBuilder
    private func filingHistoryRow(_ record: LocalCompanyRecord) -> some View {
        let isCurrent = record.company.filingKey == company.filingKey
        let answerCount = record.chatHistory.filter { $0.role == "assistant" }.count

        Button {
            selectFiling(record.company.filingKey)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(record.company.formType)
                    .font(.caption2.weight(.bold))
                    .tracking(0.5)
                    .foregroundStyle(KabuyomiTheme.accent)
                Text(formattedFilingDate(record.company.filedAt))
                    .font(KabuyomiTheme.figure(.footnote, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                Spacer(minLength: 8)
                Text("会話 \(answerCount)件")
                    .font(KabuyomiTheme.figure(.caption2, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .lineLimit(1)
                if isCurrent {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.accent)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(KabuyomiTheme.paper)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .accessibilityLabel(
            "\(record.company.formType)、\(formattedFilingDate(record.company.filedAt))、会話 \(answerCount)件"
                + (isCurrent ? "、表示中" : "")
        )
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

    /// 画面に出す抜粋。XBRL の抜粋は提出書類から切り出した文ではなく、
    /// Worker が指標から組み立てた合成文なので、一覧のチップと同じ体裁へ整える
    /// (チップが「826.3億ドル」で、開いた先が「82627000000 USD」では読み手が迷う)。
    /// 翻訳へ送るのは常に生の `excerpt` のままにする。
    private var displayedExcerpt: String {
        matchedChunk?.sectionType == "xbrl_metric" ? formattedXBRLExcerptText(excerpt) : excerpt
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 7) {
                            RedesignSourceBadge(text: sourceSectionBadge(for: source, in: company))
                            Label(source.sourceKind.groundingCaption, systemImage: source.sourceKind.systemImage)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(KabuyomiTheme.inkMuted)
                        }
                        Text(investorFacingSourceLabel(for: source, in: company))
                            .font(.title3.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("\(company.formType) ・ \(formattedFilingDate(company.filedAt))")
                            .font(KabuyomiTheme.figure(.footnote))
                            .foregroundStyle(KabuyomiTheme.inkSoft)
                        // 英語のままの節見出し("Revenue driver discussion")は
                        // ここでも出さない。区別は直下の抜粋が担う。
                        if let section = japaneseFacingSubtitle(
                            matchedChunk?.sectionTitle ?? "",
                            matching: investorFacingSourceLabel(for: source, in: company)
                        ) {
                            Text(section)
                                .font(.caption)
                                .foregroundStyle(KabuyomiTheme.inkMuted)
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
                        text: excerpt.isEmpty ? "表示できる抜粋がありません。" : displayedExcerpt,
                        isOriginal: true
                    )
            }
            .padding(18)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        // AccentColor アセットも v2 の teal に揃えたが、この画面は
        // NavigationStack の外から表示されることもあるので tint を明示しておく。
        .tint(KabuyomiTheme.accent)
        .background(KabuyomiTheme.canvas)
        .navigationTitle("根拠")
        .navigationBarTitleDisplayMode(.inline)
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

    // `.borderedProminent` は tint の上に白を敷くため、明るい teal だと文字が読めない。
    // 塗りと文字色を token から自分で決める。
    @ViewBuilder
    private var sourceLinkButton: some View {
        if let sourceURL {
            Button {
                openURL(sourceURL)
            } label: {
                Label(source.sourceKind == .webSupplement ? "ブラウザで開く" : "SEC原文を開く", systemImage: "safari")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.onAccent)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                    .background(KabuyomiTheme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("redesign.source.openOriginal")
        }
    }

    @ViewBuilder
    private var translationButton: some View {
        if !excerpt.isEmpty, translatedText == nil {
            let isDisabled = translationInFlight
                || !appModel.authenticatedCreditActionsAvailable
                || !appModel.hasChatCreditAvailable
            Button(action: translate) {
                HStack(spacing: 7) {
                    if translationInFlight {
                        ProgressView()
                            .controlSize(.small)
                            .tint(KabuyomiTheme.accent)
                    }
                    Text(translationInFlight ? "翻訳中…" : "日本語に翻訳（1クレジット）")
                        .font(.footnote.weight(.semibold))
                }
                .foregroundStyle(isDisabled ? KabuyomiTheme.inkMuted : KabuyomiTheme.accent)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
                .background(KabuyomiTheme.elevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isDisabled)
            .accessibilityIdentifier("redesign.source.translate")
        }
    }

    private func excerptSection(title: String, text: String, isOriginal: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .kabuyomiMicroLabel()
            Text(text)
                .font(.footnote)
                .lineSpacing(5)
                .textSelection(.enabled)
                .foregroundStyle(isOriginal && excerpt.isEmpty ? KabuyomiTheme.inkMuted : KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KabuyomiTheme.evidence, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
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

/// 履歴行の末尾に置くマイクロラベル。回答数と最終活動を1行に詰める。
/// 時刻の書式は呼び出し側から渡す(ロケール依存の処理を純ロジックへ持ち込まないため)。
func redesignHistoryTrailingText(
    answerCount: Int,
    latestActivity: Date?,
    formatted: (Date) -> String
) -> String {
    let answerText = answerCount == 0 ? "回答なし" : "回答 \(answerCount)件"
    guard let latestActivity else { return answerText }
    return "\(answerText) ・ \(formatted(latestActivity))"
}

/// 履歴の行に出す最終活動時刻。年月日をフルで出すと行が2段に割れるので、
/// 月日と時刻だけに詰める。
func redesignHistoryActivityText(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ja_JP")
    formatter.dateFormat = "M/d HH:mm"
    return formatter.string(from: date)
}

private struct RedesignSettingsView: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 3) {
                    Text("アカウントとリサーチ")
                        .kabuyomiMicroLabel()
                    Text("利用環境を確認・管理")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.ink)
                }
                .padding(.top, 8)
                .padding(.bottom, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }

            Section {
                NavigationLink(value: RedesignSettingsRoute.credits) {
                    HStack(spacing: 11) {
                        Image(systemName: "bolt.fill")
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.accent)
                            .frame(width: 22)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("残高と購入")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(KabuyomiTheme.ink)
                            Text(creditSummary)
                                .font(KabuyomiTheme.figure(.caption2))
                                .foregroundStyle(KabuyomiTheme.inkMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                    }
                    .padding(.vertical, 7)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .listRowBackground(KabuyomiTheme.paper)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                .accessibilityIdentifier("redesign.settings.credits")
            } header: {
                RedesignListSectionHeader(title: "クレジット")
            }

            Section {
                Toggle(isOn: Binding(
                    get: { appModel.aiConsentGranted },
                    set: { appModel.setAIConsent($0) }
                )) {
                    SettingsToggleLabel(
                        title: "AI 利用への同意",
                        subtitle: "質問と対象資料の抜粋を外部AIモデルへ送信します。"
                    )
                }
                .tint(KabuyomiTheme.accent)
                .listRowBackground(KabuyomiTheme.paper)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                .accessibilityIdentifier("redesign.settings.aiConsent")
            } header: {
                RedesignListSectionHeader(title: "AI 利用")
            }

            Section {
                Toggle(isOn: Binding(
                    get: { appModel.showStarterCompanies },
                    set: { appModel.setShowStarterCompanies($0) }
                )) {
                    SettingsToggleLabel(
                        title: "スターター銘柄を表示",
                        subtitle: "ホーム画面に代表的な会社を表示します。"
                    )
                }
                .tint(KabuyomiTheme.accent)
                .listRowBackground(KabuyomiTheme.paper)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                .accessibilityIdentifier("redesign.settings.starters")
            } header: {
                RedesignListSectionHeader(title: "表示")
            }

            Section {
                NavigationLink(value: RedesignSettingsRoute.details) {
                    SettingsDestinationRow(
                        title: "端末情報とサポート",
                        subtitle: deviceAndSupportSummary
                    )
                }
                .listRowBackground(KabuyomiTheme.paper)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                .accessibilityIdentifier("redesign.settings.details")

                if let status = appModel.installationAuthenticationStatus,
                   let retryTitle = status.retryActionTitle {
                    Button {
                        Task { await appModel.retryInstallationAuthentication() }
                    } label: {
                        HStack(spacing: 9) {
                            if appModel.installationAuthenticationIsRetrying {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(KabuyomiTheme.accent)
                            } else {
                                Image(systemName: "arrow.clockwise")
                                    .font(.caption.weight(.bold))
                            }
                            Text(appModel.installationAuthenticationIsRetrying ? "端末認証を確認中" : retryTitle)
                                .font(.footnote.weight(.semibold))
                            Spacer(minLength: 8)
                        }
                        // 端末認証の再試行はまだ結果が出ていない状態。保留の階調で出す。
                        .foregroundStyle(
                            appModel.installationAuthenticationIsRetrying
                                ? KabuyomiTheme.caution
                                : KabuyomiTheme.accent
                        )
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(appModel.installationAuthenticationIsRetrying)
                    .listRowBackground(KabuyomiTheme.paper)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                }

                Button(role: .destructive) {
                    appModel.requestResetLocalDataConfirmation()
                } label: {
                    Text("ローカルデータをリセット")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.negative)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(KabuyomiTheme.paper)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                .accessibilityIdentifier("redesign.settings.reset")
            } header: {
                RedesignListSectionHeader(title: "サポートとデータ")
            }

            Section {
                Text("Kabuyomi は公開された SEC 10-K / 10-Q を読みやすくする資料リーダーです。投資助言や売買推奨ではありません。")
                    .font(.caption2)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 12)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }
        }
        .listStyle(.plain)
        .listRowSeparatorTint(KabuyomiTheme.separator)
        // 既定の節間は1画面あたりの行数を目に見えて削る。密度側へ寄せる。
        .listSectionSpacing(10)
        .environment(\.defaultMinListRowHeight, 0)
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

/// トグルの見出し。説明文を副題に落として、行の高さを1行分に抑える。
private struct SettingsToggleLabel: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(KabuyomiTheme.ink)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 7)
    }
}

private struct SettingsDestinationRow: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(KabuyomiTheme.ink)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// 会社ワークスペースの2つの面。資料は参照用で据え置き、会話は最新に貼りつく。
private enum CompanySurface: Hashable {
    case document
    case conversation
}
