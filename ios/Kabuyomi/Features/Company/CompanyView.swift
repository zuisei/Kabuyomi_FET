import OSLog
import SwiftUI
import UIKit
import WebKit

private enum CompanySidePanel {
    case library
    case summary
}

private struct PendingDrawerTickerOpen: Equatable {
    let ticker: String
    let companyName: String
    let detail: String
}

private struct CompanyStatusNotice {
    let title: String
    let message: String
}

private struct OptimisticSavedState: Equatable {
    let ticker: String
    let isSaved: Bool
}

struct CompanyView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var currentTicker: String
    @State private var question = ""
    @State private var libraryQuery = ""
    @State private var activePanel: CompanySidePanel?
    @State private var librarySearchTask: Task<Void, Never>?
    @State private var settingsPresented = false
    @State private var selectedSource: LocalMessageSourceRef?
    @State private var libraryPanelID = UUID()
    @State private var summaryPanelID = UUID()
    @State private var pendingDrawerTickerOpen: PendingDrawerTickerOpen?
    @State private var pendingDrawerOpenTask: Task<Void, Never>?
    @State private var pendingConsentSubmission: String?
    @State private var optimisticSavedState: OptimisticSavedState?

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

    private var companyLoadState: CompanyLoadStatePayload? {
        appModel.companyLoadState(for: currentTicker)
    }

    private var isCurrentCompanyLoading: Bool {
        appModel.isCompanyLoading(currentTicker)
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
        if optimisticSavedState?.ticker == normalizedCurrentTicker {
            return optimisticSavedState?.isSaved == true
        }

        return appModel.isTickerInWatchlist(currentTicker, cik: company?.cik)
    }

    private var normalizedCurrentTicker: String {
        currentTicker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    private var companyWebsiteURL: URL? {
        resolvedExternalHTTPURL(from: company?.companyWebsiteUrl)
    }

    private var companyCanChat: Bool {
        guard let company else { return false }
        return !company.isStaleReady
    }

    private var companyStatusNotice: CompanyStatusNotice? {
        if company?.isStaleReady == true {
            return CompanyStatusNotice(
                title: "前回取得した決算を表示中",
                message: "最新データの取得に失敗したため、保存済みの資料を表示しています。右上の再読み込みで再試行できます。"
            )
        }

        if let companyLoadState, company != nil, companyLoadState.status == .failedRetryable {
            return CompanyStatusNotice(
                title: "最新データの取得に時間がかかっています",
                message: "表示中の資料はそのまま確認できます。右上の再読み込みで最新取得を再試行できます。"
            )
        }

        return nil
    }

    private var isAccessibilityLayout: Bool {
        dynamicTypeSize.isAccessibilitySize
    }

    private var libraryDrawerMaxWidth: CGFloat {
        isAccessibilityLayout ? .infinity : 356
    }

    private var summaryDrawerMaxWidth: CGFloat {
        isAccessibilityLayout ? .infinity : 372
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                KabuyomiTheme.background.ignoresSafeArea()

                mainContent
                    .blur(radius: activePanel == nil ? 0 : 10)
                    .disabled(activePanel != nil)
                    .accessibilityHidden(activePanel != nil)

                if activePanel != nil {
                    overlayBackdrop
                }

                if activePanel == .library {
                    ZStack(alignment: .leading) {
                        ConversationLibraryDrawer(
                            query: $libraryQuery,
                            currentTicker: currentTicker,
                            savedCompanies: filteredSavedCompanies,
                            recentCompanies: filteredRecentCompanies,
                            starterCompanies: filteredStarterCompanies,
                            searchResults: appModel.searchResults,
                            isSearchLoading: appModel.searchIsLoading,
                            searchErrorMessage: appModel.searchErrorMessage,
                            pendingTicker: pendingDrawerTickerOpen?.ticker,
                            pendingCompanyName: pendingDrawerTickerOpen?.companyName,
                            pendingDetail: pendingDrawerTickerOpen?.detail,
                            selectTicker: openDrawerTicker,
                            saveSearchResult: saveSearchResult,
                            openSearchResult: openSearchResult,
                            openSettings: openSettingsScreen,
                            close: closePanels,
                            cancelPendingOpen: cancelPendingDrawerOpen
                        )
                        .id(libraryPanelID)
                        .frame(maxWidth: libraryDrawerMaxWidth, maxHeight: .infinity)
                        .accessibilityElement(children: .contain)
                        .accessibilitySortPriority(2)

                        CompanyDrawerEdgeBlendLayer(style: .library)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .transition(.move(edge: .leading).combined(with: .opacity))
                }

                if activePanel == .summary, let company {
                    ZStack(alignment: .trailing) {
                        SummaryDrawer(
                            company: company,
                            positiveInsights: buildPositiveInsights(for: company),
                            negativeInsights: buildNegativeInsights(for: company),
                            focusInsights: buildFocusInsights(for: company),
                            openSource: openChatSource,
                            openOriginal: { openPrimaryDocument(urlString: company.primaryDocumentUrl) },
                            close: closePanels
                        )
                        .id(summaryPanelID)
                        .frame(maxWidth: summaryDrawerMaxWidth, maxHeight: .infinity)
                        .accessibilityElement(children: .contain)
                        .accessibilitySortPriority(2)

                        CompanyDrawerEdgeBlendLayer(style: .summary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .simultaneousGesture(panelSwipeGesture(screenWidth: proxy.size.width))
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
            pendingConsentSubmission = nil
            cancelPendingDrawerOpen()
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
            pendingDrawerOpenTask?.cancel()
            pendingConsentSubmission = nil
        }
        .onChange(of: appModel.activeAlert?.id) { _, newValue in
            guard newValue == nil, let pendingConsentSubmission else { return }

            self.pendingConsentSubmission = nil

            if appModel.aiConsentGranted {
                submitQuestion(pendingConsentSubmission)
            } else if let restoredDraft = restoreDraftAfterConsentDismissal(
                currentDraft: question,
                pendingSubmission: pendingConsentSubmission
            ) {
                question = restoredDraft
            }
        }
        .sheet(isPresented: $settingsPresented) {
            SettingsView()
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $selectedSource) { source in
            if let company {
                SourceEvidenceSheet(company: company, source: source)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    private var mainContent: some View {
        VStack(spacing: 0) {
            ChatTopBar(
                ticker: currentTicker,
                companyName: company?.companyName,
                formType: company?.formType,
                companyWebsiteURL: companyWebsiteURL,
                isSaved: isCurrentTickerSaved,
                isLoading: isCurrentCompanyLoading,
                canOpenSummary: company != nil,
                openLibrary: { openPanel(.library) },
                openCompanyWebsite: openCompanyWebsite,
                openSummary: {
                    if company != nil {
                        openPanel(.summary)
                    }
                },
                toggleSaved: toggleSavedState,
                refresh: refreshCurrentCompany
            )

            if let company {
                if let companyStatusNotice {
                    CompanyStatusNoticeBanner(notice: companyStatusNotice)
                        .padding(.horizontal, 16)
                        .padding(.top, 10)
                }

                ConversationTimeline(
                    company: company,
                    chatHistory: chatHistory,
                    pendingChat: pendingChat,
                    isSending: appModel.chatIsSending,
                    suggestions: buildSuggestedQuestions(for: company),
                    historicalSuggestions: buildHistoricalQuestions(for: company),
                    openSource: openChatSource,
                    draftQuestion: $question
                )
            } else {
                ConversationLoadingState(
                    ticker: currentTicker,
                    isLoading: isCurrentCompanyLoading,
                    loadState: companyLoadState,
                    openLibrary: { openPanel(.library) },
                    retry: refreshCurrentCompany
                )
            }
        }
        .safeAreaInset(edge: .bottom) {
            ComposerBar(
                question: $question,
                isSending: appModel.chatIsSending,
                isEnabled: companyCanChat,
                placeholder: composerPlaceholder,
                aiConsentGranted: appModel.aiConsentGranted,
                applyPrompt: { question = $0 },
                sendAction: sendCurrentQuestion
            )
        }
    }

    private var composerPlaceholder: String {
        guard company != nil else {
            if isCurrentCompanyLoading {
                return "\(currentTicker) を読み込み中..."
            }

            if companyLoadState?.status == .preparing {
                return "決算資料を準備中..."
            }

            return "\(currentTicker) を開けませんでした。左上から別の銘柄を選択してください"
        }

        if company?.isStaleReady == true {
            return "最新データ取得後に質問できます"
        }

        return "この決算で気になる点を聞く"
    }

    private var overlayBackdrop: some View {
        Color.black.opacity(0.22)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture {
                closePanels()
            }
    }

    private func openPanel(_ panel: CompanySidePanel) {
        dismissKeyboard()

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

    private func panelSwipeGesture(screenWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 14, coordinateSpace: .global)
            .onEnded { value in
                handlePanelSwipe(value, screenWidth: screenWidth)
            }
    }

    private func handlePanelSwipe(_ value: DragGesture.Value, screenWidth: CGFloat) {
        let translation = value.translation
        let predicted = value.predictedEndTranslation
        guard isHorizontalPanelSwipe(translation: translation, predicted: predicted) else { return }

        if let activePanel {
            switch activePanel {
            case .library where translation.width < -38 || predicted.width < -72:
                closePanels()
            case .summary where translation.width > 38 || predicted.width > 72:
                closePanels()
            default:
                break
            }
            return
        }

        let startX = value.startLocation.x
        let edgeWidth = min(max(screenWidth * 0.18, 64), 84)

        if startX <= edgeWidth,
           translation.width > 34 || predicted.width > 74 {
            openPanel(.library)
            return
        }

        if startX >= screenWidth - edgeWidth,
           company != nil,
           translation.width < -34 || predicted.width < -74 {
            openPanel(.summary)
        }
    }

    private func isHorizontalPanelSwipe(translation: CGSize, predicted: CGSize) -> Bool {
        let horizontal = max(abs(translation.width), abs(predicted.width) * 0.55)
        let vertical = max(abs(translation.height), abs(predicted.height) * 0.45)
        return horizontal >= 34 && horizontal > vertical * 1.25
    }

    private func closePanels() {
        cancelPendingDrawerOpen()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
            activePanel = nil
        }
    }

    private func openSettingsScreen() {
        dismissKeyboard()
        closePanels()
        Task {
            try? await Task.sleep(for: .milliseconds(180))
            settingsPresented = true
        }
    }

    private func toggleSavedState() {
        let normalized = normalizedCurrentTicker
        guard optimisticSavedState?.ticker != normalized else { return }

        let nextSavedState = !isCurrentTickerSaved
        optimisticSavedState = OptimisticSavedState(ticker: normalized, isSaved: nextSavedState)

        Task { @MainActor in
            if nextSavedState {
                await appModel.saveTicker(normalized)
            } else {
                await appModel.removeFromWatchlist(normalized)
            }

            if optimisticSavedState == OptimisticSavedState(ticker: normalized, isSaved: nextSavedState) {
                optimisticSavedState = nil
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
        guard appModel.aiConsentGranted else {
            pendingConsentSubmission = prompt
            appModel.requestAIConsent()
            return
        }
        submitQuestion(prompt)
    }

    private func submitQuestion(_ prompt: String) {
        guard company != nil else { return }

        dismissKeyboard()
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
        pendingDrawerTickerOpen = nil
        guard normalized != currentTicker else {
            closePanels()
            return
        }

        currentTicker = normalized
        closePanels()
    }

    private func openDrawerTicker(_ ticker: String, _ companyName: String) {
        let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard pendingDrawerTickerOpen == nil else { return }

        if normalized == currentTicker, appModel.companyPayload(for: normalized) != nil {
            closePanels()
            return
        }

        if appModel.companyPayload(for: normalized) != nil {
            selectTicker(normalized)
            return
        }

        pendingDrawerTickerOpen = PendingDrawerTickerOpen(
            ticker: normalized,
            companyName: companyName,
            detail: "読み込み後に移動します。"
        )

        pendingDrawerOpenTask?.cancel()
        pendingDrawerOpenTask = Task {
            await appModel.loadCompany(ticker: normalized)
            guard !Task.isCancelled else { return }
            if appModel.companyPayload(for: normalized) != nil {
                selectTicker(normalized)
            } else if pendingDrawerTickerOpen?.ticker == normalized {
                pendingDrawerTickerOpen = nil
            }
            pendingDrawerOpenTask = nil
        }
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
        openDrawerTicker(normalized, item.companyName)
    }

    private func saveSearchResult(_ item: SearchItem) {
        guard pendingDrawerTickerOpen == nil else { return }
        Task {
            await appModel.saveSearchResult(item)
        }
    }

    private func cancelPendingDrawerOpen() {
        pendingDrawerOpenTask?.cancel()
        pendingDrawerOpenTask = nil
        pendingDrawerTickerOpen = nil
    }

    private func openPrimaryDocument(urlString: String) {
        dismissKeyboard()
        guard let url = resolvedExternalHTTPURL(from: urlString, allowBareDomain: false) else { return }
        openURL(url)
    }

    private func openCompanyWebsite() {
        dismissKeyboard()
        guard let url = companyWebsiteURL else { return }
        openURL(url)
    }

    private func openChatSource(_ source: LocalMessageSourceRef) {
        dismissKeyboard()
        selectedSource = source
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

func restoreDraftAfterConsentDismissal(currentDraft: String, pendingSubmission: String?) -> String? {
    guard let pendingSubmission else { return nil }
    guard currentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }

    let trimmedPending = pendingSubmission.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedPending.isEmpty ? nil : trimmedPending
}

private struct CompanyStatusNoticeBanner: View {
    let notice: CompanyStatusNotice

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.accentDeep)

            VStack(alignment: .leading, spacing: 4) {
                Text(notice.title)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                Text(notice.message)
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(14)
        .kabuyomiCard(.secondary, radius: 18)
    }
}

private struct SourceEvidenceSheet: View {
    private static let logger = Logger(subsystem: "app.kabuyomi.ios", category: "quote_translation")

    let company: CompanyPayload
    let source: LocalMessageSourceRef

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var selectedDocumentRequest: SourceDocumentRequest?
    @State private var previewMode: SourcePreviewMode
    @State private var previewTranslationState: PreviewTranslationState

    init(company: CompanyPayload, source: LocalMessageSourceRef) {
        self.company = company
        self.source = source

        _previewMode = State(initialValue: .original)
        _previewTranslationState = State(initialValue: .idle)
    }

    private var matchedChunk: SourceChunkPayload? {
        matchedSourceChunk(for: source, in: company)
    }

    private var sourceURL: URL? {
        resolvedSourceURL(for: source, in: company)
    }

    private var searchTerms: [String] {
        sourceDocumentSearchTerms(for: source, in: company)
    }

    private var manualHint: String? {
        sourceDocumentManualHint(for: source, in: company)
    }

    private var title: String {
        investorFacingSourceLabel(for: source, in: company)
    }

    private var previewText: String {
        Self.resolvedPreviewText(for: source, in: company)
    }

    private var offersPreviewTranslation: Bool {
        shouldOfferPreviewTranslation(for: previewText)
    }

    private var displayedPreviewText: String {
        switch previewMode {
        case .original:
            return previewText
        case .translated:
            switch previewTranslationState {
            case .ready(let translated):
                return translated
            case .idle, .loading, .failed:
                return previewText
            }
        }
    }

    private var isPreviewTranslationPending: Bool {
        guard previewMode == .translated else { return false }

        switch previewTranslationState {
        case .idle, .loading:
            return true
        case .ready, .failed:
            return false
        }
    }

    private var previewTranslationStatusText: String? {
        guard previewMode == .translated else { return nil }

        switch previewTranslationState {
        case .idle, .loading:
            return nil
        case .failed(let message):
            return message
        case .ready:
            return nil
        }
    }

    private var previewTranslationTaskID: String {
        guard offersPreviewTranslation, previewMode == .translated else {
            return "\(source.id.uuidString)-off"
        }
        return "\(source.id.uuidString)-translated"
    }

    private var detailLabel: String {
        let raw = matchedChunk?.sectionTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if let raw, !raw.isEmpty {
            return raw
        }
        return source.sourceLabelSnapshot
    }

    private var openButtonTitle: String {
        switch source.sourceKind {
        case .webSupplement:
            return "外部サイトを開く"
        case .secFiling, .historicalFiling:
            return "該当箇所を原文で開く"
        }
    }

    private var previewModeLabel: String {
        previewMode == .translated ? "プレビュー翻訳" : "SEC原文"
    }

    var body: some View {
        navigationContent
            .task(id: previewTranslationTaskID) {
                await loadPreviewTranslationIfNeeded()
            }
    }

    private var navigationContent: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    sourceSummaryCard

                    quotePreviewSection

                    if let sourceURL {
                        if source.sourceKind == .webSupplement {
                            Button {
                                openURL(sourceURL)
                            } label: {
                                Label(openButtonTitle, systemImage: "safari")
                                    .font(.system(.body, design: .rounded, weight: .bold))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(KabuyomiTheme.accentDeep)
                        } else {
                            Button {
                                selectedDocumentRequest = SourceDocumentRequest(
                                    title: title,
                                    url: sourceURL,
                                    searchTerms: searchTerms,
                                    manualHint: manualHint,
                                    searchMode: sourceDocumentSearchMode(for: source, in: company)
                                )
                            } label: {
                                Label(openButtonTitle, systemImage: "doc.text.magnifyingglass")
                                    .font(.system(.body, design: .rounded, weight: .bold))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(KabuyomiTheme.accentDeep)
                        }
                    }
                }
                .padding(20)
            }
            .background(KabuyomiTheme.background.ignoresSafeArea())
            .navigationTitle("根拠")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $selectedDocumentRequest) { request in
                SourceDocumentViewerSheet(request: request)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .toolbar {
                if source.sourceKind != .webSupplement,
                   let sourceURL {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Safari") {
                            openURL(sourceURL)
                        }
                        .font(.system(.body, design: .rounded, weight: .semibold))
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") {
                        dismiss()
                    }
                    .font(.system(.body, design: .rounded, weight: .semibold))
                }
            }
        }
    }

    private var sourceSummaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: source.sourceKind.systemImage)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 36, height: 36)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(KabuyomiTheme.accentSoft.opacity(0.58))
                    )

                VStack(alignment: .leading, spacing: 4) {
                    Text(source.sourceKind.groundingCaption)
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)

                    Text(title)
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)
            }

            Text(detailLabel)
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiGlass(radius: 22, tint: Color.white.opacity(0.22), stroke: Color.white.opacity(0.55))
    }

    private var quotePreviewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                Label("引用", systemImage: "quote.opening")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)

                Text(previewModeLabel)
                    .font(.system(.caption2, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.58))
                    )

                Spacer(minLength: 0)

                if offersPreviewTranslation {
                    previewModeControl
                }
            }

            quotePreviewCard
        }
    }

    private var previewModeControl: some View {
        HStack(spacing: 2) {
            previewModeButton("原文", mode: .original)
            previewModeButton("訳", mode: .translated)
        }
        .padding(3)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.62))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.white.opacity(0.66), lineWidth: 1)
        )
    }

    private func previewModeButton(_ title: String, mode: SourcePreviewMode) -> some View {
        Button {
            if mode == .translated, case .failed = previewTranslationState {
                previewTranslationState = .idle
            }
            previewMode = mode
        } label: {
            Text(title)
                .font(.system(.caption2, design: .rounded, weight: .bold))
                .foregroundStyle(previewMode == mode ? Color.white : KabuyomiTheme.inkMuted)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(previewMode == mode ? KabuyomiTheme.accentDeep : Color.clear)
                )
        }
        .buttonStyle(.plain)
    }

    private var quotePreviewCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if isPreviewTranslationPending {
                previewTranslationLoadingBanner
            }

            if let status = previewTranslationStatusText {
                Text(status)
                    .font(.system(.caption2, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Text(displayedPreviewText)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(isPreviewTranslationPending ? KabuyomiTheme.inkSoft : KabuyomiTheme.ink)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .opacity(isPreviewTranslationPending ? 0.82 : 1)
        }
        .padding(14)
        .padding(.leading, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.white.opacity(0.72))
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(KabuyomiTheme.accentDeep.opacity(0.64))
                .frame(width: 3)
                .padding(.leading, 14)
                .padding(.vertical, 14)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.white.opacity(0.82), lineWidth: 1)
        )
        .animation(.easeInOut(duration: 0.2), value: isPreviewTranslationPending)
    }

    private var previewTranslationLoadingBanner: some View {
        HStack(spacing: 10) {
            ProgressView()
                .controlSize(.small)
                .tint(KabuyomiTheme.accentDeep)

            VStack(alignment: .leading, spacing: 2) {
                Text("翻訳中...")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)

                Text("いまは原文を先に表示しています。数秒かかることがあります。")
                    .font(.system(.caption2, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.45))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.55), lineWidth: 1)
        )
    }

    private static func resolvedPreviewText(for source: LocalMessageSourceRef, in company: CompanyPayload) -> String {
        let matchedChunk = matchedSourceChunk(for: source, in: company)
        let preferred = matchedChunk?.text ?? source.excerpt
        let trimmed = normalizedSourcePreviewText(preferred)
        return trimmed.isEmpty ? "この根拠の本文プレビューはまだありません。" : trimmed
    }

    @MainActor
    private func loadPreviewTranslationIfNeeded() async {
        guard offersPreviewTranslation, previewMode == .translated else { return }
        guard case .idle = previewTranslationState else { return }

        let trimmed = previewText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        previewTranslationState = .loading

        do {
            Self.logger.debug("request started length=\(trimmed.count, privacy: .public) source=\(source.sourceLabelSnapshot, privacy: .public)")
            let response = try await APIClient().translateQuote(text: trimmed, targetLanguage: "ja")
            let translated = response.translatedText.trimmingCharacters(in: .whitespacesAndNewlines)

            guard !translated.isEmpty, translated != trimmed else {
                throw APIError.server("Translation returned unchanged text")
            }

            Self.logger.debug("request succeeded model=\(response.modelName, privacy: .public) outputLength=\(translated.count, privacy: .public)")
            previewTranslationState = .ready(translated)
        } catch is CancellationError {
            Self.logger.debug("request cancelled")
            previewTranslationState = .idle
        } catch {
            Self.logger.error("request failed error=\(String(describing: error), privacy: .public)")
            if let fallback = fallbackPreviewTranslation(for: trimmed) {
                Self.logger.debug("fallback used outputLength=\(fallback.count, privacy: .public)")
                previewTranslationState = .ready(fallback)
            } else {
                previewTranslationState = .failed("翻訳を取得できなかったので、原文を表示しています。")
            }
        }
    }
}

private enum SourcePreviewMode {
    case original
    case translated
}

private enum PreviewTranslationState: Equatable {
    case idle
    case loading
    case ready(String)
    case failed(String)
}

func shouldOfferPreviewTranslation(for text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }
    return trimmed.range(of: #"[ぁ-んァ-ヶ一-龠]"#, options: .regularExpression) == nil
}

func fallbackPreviewTranslation(for text: String) -> String? {
    let localized = localizedAssistantDisplayText(text).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !localized.isEmpty else { return nil }
    guard localized != text.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
    guard localized.range(of: #"[ぁ-んァ-ヶ一-龠]"#, options: .regularExpression) != nil else { return nil }
    return localized
}

func normalizedSourcePreviewText(_ text: String, limit: Int = 520) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "" }

    var normalized = ""
    normalized.reserveCapacity(trimmed.count + 16)

    var previousVisibleScalar: UnicodeScalar?
    var scalarBeforePreviousVisible: UnicodeScalar?
    var consecutiveLowercaseCount = 0
    var lastWasWhitespace = false

    for scalar in trimmed.unicodeScalars {
        if CharacterSet.whitespacesAndNewlines.contains(scalar) {
            if !lastWasWhitespace, !normalized.isEmpty {
                normalized.append(" ")
            }
            consecutiveLowercaseCount = 0
            lastWasWhitespace = true
            continue
        }

        if let previousVisibleScalar,
           shouldInsertPreviewSeparator(
               after: previousVisibleScalar,
               before: scalar,
               priorVisible: scalarBeforePreviousVisible,
               consecutiveLowercaseCount: consecutiveLowercaseCount
           ),
           !normalized.hasSuffix(" ") {
            normalized.append(" ")
        }

        normalized.unicodeScalars.append(scalar)
        scalarBeforePreviousVisible = previousVisibleScalar
        previousVisibleScalar = scalar
        consecutiveLowercaseCount = isASCIILowercase(scalar) ? (consecutiveLowercaseCount + 1) : 0
        lastWasWhitespace = false
    }

    normalized = normalized.trimmingCharacters(in: .whitespacesAndNewlines)

    guard normalized.count > limit else { return normalized }

    let prefix = String(normalized.prefix(limit))
    let boundary =
        prefix.range(of: ". ", options: .backwards)
        ?? prefix.range(of: "; ", options: .backwards)
        ?? prefix.range(of: ", ", options: .backwards)
    let clipped = boundary.map { String(prefix[..<$0.lowerBound]) } ?? prefix
    return clipped.trimmingCharacters(in: .whitespacesAndNewlines) + "…"
}

private func shouldInsertPreviewSeparator(
    after previous: UnicodeScalar,
    before current: UnicodeScalar,
    priorVisible: UnicodeScalar?,
    consecutiveLowercaseCount: Int
) -> Bool {
    if isASCIILowercase(previous) && isASCIIUppercase(current) && consecutiveLowercaseCount >= 2 {
        return true
    }
    if isASCIIDigit(previous) && isASCIIUppercase(current) {
        return true
    }
    if isSentencePunctuation(previous),
       let priorVisible,
       (isASCIILowercase(priorVisible) || isASCIIDigit(priorVisible)),
       (isASCIIUppercase(current) || isASCIIDigit(current)) {
        return true
    }
    return false
}

private func isASCIILowercase(_ scalar: UnicodeScalar) -> Bool {
    (97...122).contains(scalar.value)
}

private func isASCIIUppercase(_ scalar: UnicodeScalar) -> Bool {
    (65...90).contains(scalar.value)
}

private func isASCIIDigit(_ scalar: UnicodeScalar) -> Bool {
    (48...57).contains(scalar.value)
}

private func isSentencePunctuation(_ scalar: UnicodeScalar) -> Bool {
    scalar == "." || scalar == "!" || scalar == "?"
}

private struct SourceDocumentRequest: Identifiable, Equatable {
    let title: String
    let url: URL
    let searchTerms: [String]
    let manualHint: String?
    let searchMode: SourceDocumentSearchMode

    var id: String {
        url.absoluteString + "::" + searchMode.rawValue + "::" + searchTerms.joined(separator: "|")
    }
}

private enum SourceDocumentSearchStatus: Equatable {
    case loading
    case matched(String)
    case failed(String?)
    case webError(String)

    var title: String {
        switch self {
        case .loading:
            return "該当箇所を探しています"
        case .matched:
            return "該当箇所の近くまで移動しました"
        case .failed:
            return "自動位置合わせができませんでした"
        case .webError:
            return "原文を開けませんでした"
        }
    }

    var detail: String {
        switch self {
        case .loading:
            return "見出しか引用文を手がかりに、原文の中で位置を合わせます。"
        case .matched(let term):
            return "「\(term)」を手がかりにスクロールしています。"
        case .failed(let hint):
            if let hint, !hint.isEmpty {
                return "ページ内検索を使うなら「\(hint)」を入れてください。"
            }
            return "引用プレビューを手がかりに、ページ内検索を使ってください。"
        case .webError(let message):
            return message
        }
    }
}

private struct SourceDocumentViewerSheet: View {
    let request: SourceDocumentRequest

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var searchStatus: SourceDocumentSearchStatus = .loading

    private var visibleHints: [String] {
        var hints: [String] = []

        if let manualHint = request.manualHint,
           !manualHint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            hints.append(manualHint)
        }

        for term in request.searchTerms where hints.count < 3 && !hints.contains(term) {
            hints.append(term)
        }

        return hints
    }

    private var statusDetailText: String {
        switch searchStatus {
        case .loading where request.searchMode == .tabular:
            return "指標名や表の行を手がかりに、原文の中で位置を合わせます。"
        case .failed(let hint) where request.searchMode == .tabular:
            if let hint, !hint.isEmpty {
                return "ページ内検索を使うなら「\(hint)」や financial statements の表見出しで探してください。"
            }
            return "financial statements の表見出しや指標名でページ内検索を使ってください。"
        default:
            return searchStatus.detail
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                statusCard
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                SourceDocumentWebView(
                    url: request.url,
                    searchTerms: request.searchTerms,
                    searchMode: request.searchMode,
                    searchStatus: $searchStatus
                )
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(Color.white.opacity(0.55), lineWidth: 1)
                )
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .background(KabuyomiTheme.background.ignoresSafeArea())
            .navigationTitle(request.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("閉じる") {
                        dismiss()
                    }
                    .font(.system(.body, design: .rounded, weight: .semibold))
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("Safari") {
                        openURL(request.url)
                    }
                    .font(.system(.body, design: .rounded, weight: .semibold))
                }
            }
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                if case .loading = searchStatus {
                    ProgressView()
                        .controlSize(.small)
                        .tint(KabuyomiTheme.accentDeep)
                }

                Text(searchStatus.title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
            }

            Text(statusDetailText)
                .font(.system(.footnote, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .fixedSize(horizontal: false, vertical: true)

            if !visibleHints.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(visibleHints, id: \.self) { hint in
                            Text(hint)
                                .font(.system(.caption, design: .rounded, weight: .semibold))
                                .foregroundStyle(KabuyomiTheme.accentDeep)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.62)))
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiGlass(radius: 22, tint: Color.white.opacity(0.22), stroke: Color.white.opacity(0.55))
    }
}

private struct SourceDocumentWebView: UIViewRepresentable {
    let url: URL
    let searchTerms: [String]
    let searchMode: SourceDocumentSearchMode
    @Binding var searchStatus: SourceDocumentSearchStatus

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor.clear
        webView.scrollView.backgroundColor = UIColor.clear
        context.coordinator.load(url: url, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.loadedURL != url {
            context.coordinator.load(url: url, in: webView)
        } else if context.coordinator.lastSearchTerms != searchTerms || context.coordinator.lastSearchMode != searchMode {
            context.coordinator.lastSearchTerms = searchTerms
            context.coordinator.lastSearchMode = searchMode
            context.coordinator.runSearch(in: webView)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: SourceDocumentWebView
        var loadedURL: URL?
        var lastSearchTerms: [String] = []
        var lastSearchMode: SourceDocumentSearchMode

        init(parent: SourceDocumentWebView) {
            self.parent = parent
            self.lastSearchMode = parent.searchMode
        }

        func load(url: URL, in webView: WKWebView) {
            loadedURL = url
            lastSearchTerms = parent.searchTerms
            lastSearchMode = parent.searchMode
            parent.searchStatus = .loading
            webView.load(URLRequest(url: url))
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            runSearch(in: webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.searchStatus = .webError(error.localizedDescription)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            parent.searchStatus = .webError(error.localizedDescription)
        }

        func runSearch(in webView: WKWebView) {
            let searchTerms = parent.searchTerms.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            guard !searchTerms.isEmpty else {
                parent.searchStatus = .failed(nil)
                return
            }

            let jsonData = (try? JSONSerialization.data(withJSONObject: searchTerms)) ?? Data("[]".utf8)
            let encodedTerms = String(decoding: jsonData, as: UTF8.self)
            let searchMode = parent.searchMode.rawValue
            let script = """
            (function() {
              const terms = \(encodedTerms);
              const searchMode = "\(searchMode)";
              const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
              const textFor = (element) => normalize(element.innerText || element.textContent || "");
              const selectors =
                searchMode === "tabular"
                  ? "table,tr,td,th,h1,h2,h3,h4,h5,h6,p,li"
                  : "h1,h2,h3,h4,h5,h6,p,li,div,td,th,strong,b";

              const hasTableOfContentsContext = (element) => {
                let node = element;
                let depth = 0;
                while (node && depth < 5) {
                  const label = normalize(
                    (node.getAttribute && (node.getAttribute("aria-label") || node.getAttribute("title"))) || ""
                  );
                  const text = textFor(node).slice(0, 800);
                  if (label.includes("table of contents") || text.includes("table of contents")) {
                    return true;
                  }
                  node = node.parentElement;
                  depth += 1;
                }
                return false;
              };

              const entries = Array.from(document.querySelectorAll(selectors)).map((element) => {
                const text = textFor(element);
                if (!text) return null;
                if (searchMode === "tabular") {
                  if (text.length < 3 || text.length > 2600) return null;
                } else if (text.length < 20 || text.length > 2200) {
                  return null;
                }
                const tag = (element.tagName || "").toUpperCase();
                if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(tag)) return null;

                const inTable = Boolean(element.closest("table"));
                const inNav = Boolean(element.closest("nav,[role='navigation']"));
                const tocContext = hasTableOfContentsContext(element);
                const linkDensity =
                  searchMode === "tabular"
                    ? 0
                    : Array.from(element.querySelectorAll("a")).reduce((sum, link) => sum + textFor(link).length, 0) / Math.max(text.length, 1);
                const headingLike = /^H[1-6]$/.test(tag) || ["STRONG", "B", "TH"].includes(tag);
                const rowLike = tag === "TR";
                const tableCellLike = tag === "TD" || tag === "TH";
                const proseLike = !headingLike && !inTable && !inNav && linkDensity < 0.18 && text.length >= 80;

                return {
                  element,
                  text,
                  tag,
                  linkDensity,
                  inTable,
                  inNav,
                  tocContext,
                  headingLike,
                  rowLike,
                  tableCellLike,
                  proseLike
                };
              }).filter(Boolean);

              const entryByElement = new Map(entries.map((entry) => [entry.element, entry]));
              const primaryEntries = [];
              const fallbackEntries = [];

              for (const entry of entries) {
                if (searchMode === "tabular") {
                  if (entry.rowLike || entry.tableCellLike || entry.inTable) {
                    primaryEntries.push(entry);
                  } else {
                    fallbackEntries.push(entry);
                  }
                } else {
                  primaryEntries.push(entry);
                }
              }

              const clearHighlight = () => {
                document.querySelectorAll("[data-kabuyomi-highlight='1']").forEach((element) => {
                  element.style.outline = "";
                  element.style.background = "";
                  element.style.borderRadius = "";
                  element.style.scrollMarginTop = "";
                  element.removeAttribute("data-kabuyomi-highlight");
                });
              };

              const findCompanionEntry = (entry) => {
                if (searchMode === "tabular" && (entry.rowLike || entry.tableCellLike || entry.inTable)) {
                  return entry;
                }
                if (!entry.headingLike) return entry;

                let sibling = entry.element.nextElementSibling;
                let steps = 0;

                while (sibling && steps < 5) {
                  const direct = entryByElement.get(sibling);
                  if (direct && direct.proseLike && !direct.tocContext) {
                    return direct;
                  }

                  const nested = entries.find((candidate) =>
                    sibling.contains(candidate.element) && candidate.proseLike && !candidate.tocContext
                  );
                  if (nested) {
                    return nested;
                  }

                  sibling = sibling.nextElementSibling;
                  steps += 1;
                }

                return entry;
              };

              const focusEntry = (entry, term) => {
                const target = findCompanionEntry(entry);
                const element = target.element;
                clearHighlight();
                element.setAttribute("data-kabuyomi-highlight", "1");
                element.style.outline = "3px solid rgba(176, 106, 42, 0.95)";
                element.style.background = "rgba(255, 226, 179, 0.55)";
                element.style.borderRadius = "8px";
                element.style.scrollMarginTop = "120px";
                element.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
                return {
                  matched: term,
                  preview: (element.innerText || element.textContent || "").trim().slice(0, 280)
                };
              };

              const scoreEntry = (entry, partial) => {
                if (searchMode === "tabular") {
                  let score = partial ? 520 : 1080;

                  if (entry.rowLike) score += 420;
                  if (entry.tableCellLike) score += 280;
                  if (entry.inTable) score += 220;
                  if (entry.tag === "TABLE" || entry.tag === "TBODY" || entry.tag === "THEAD") score -= 160;
                  if (entry.text.length >= 8 && entry.text.length <= 240) score += 120;
                  if (entry.text.length > 600) score -= 120;

                  if (entry.headingLike) score -= 100;
                  if (entry.inNav) score -= 260;
                  if (entry.tocContext) score -= 700;
                  if (entry.linkDensity > 0.20) score -= 420;
                  if (entry.text.length < 6) score -= 260;

                  return score;
                }

                let score = partial ? 420 : 1000;

                if (entry.proseLike) score += 320;
                if (entry.tag === "P") score += 180;
                if (entry.tag === "LI") score += 80;
                if (entry.tag === "DIV") score += 60;
                if (entry.text.length >= 80 && entry.text.length <= 1400) score += 60;

                if (entry.headingLike) score -= 220;
                if (entry.inTable) score -= 260;
                if (entry.inNav) score -= 260;
                if (entry.tocContext) score -= 700;
                if (entry.linkDensity > 0.20) score -= 420;
                if (entry.text.length < 60) score -= 200;

                return score;
              };

              for (const rawTerm of terms) {
                const term = normalize(rawTerm);
                if (!term) continue;

                const variants = [{ value: term, partial: false }];
                if (term.length > 48) {
                  variants.push({
                    value: term.slice(0, Math.min(96, Math.max(48, Math.floor(term.length * 0.7)))),
                    partial: true
                  });
                }

                let bestMatch = null;
                const entryGroups = searchMode === "tabular" ? [primaryEntries, fallbackEntries] : [primaryEntries];

                for (const variant of variants) {
                  for (const entryGroup of entryGroups) {
                    for (const entry of entryGroup) {
                      if (!entry.text.includes(variant.value)) continue;

                      const score = scoreEntry(entry, variant.partial);
                      if (!bestMatch || score > bestMatch.score) {
                        bestMatch = { entry, score };
                      }
                    }

                    if (bestMatch && bestMatch.score >= 700) {
                      break;
                    }
                  }

                  if (bestMatch && bestMatch.score >= 700) {
                    break;
                  }
                }

                if (bestMatch) {
                  return focusEntry(bestMatch.entry, rawTerm);
                }
              }

              return null;
            })();
            """

            webView.evaluateJavaScript(script) { [weak self] value, _ in
                guard let self else { return }

                if let result = value as? [String: Any],
                   let matched = result["matched"] as? String,
                   !matched.isEmpty {
                    DispatchQueue.main.async {
                        self.parent.searchStatus = .matched(matched)
                    }
                    return
                }

                DispatchQueue.main.async {
                    self.parent.searchStatus = .failed(searchTerms.first)
                }
            }
        }
    }
}

func buildSuggestedQuestions(for company: CompanyPayload) -> [String] {
    var suggestions: [String] = []

    suggestions.append("今回の最大変化は？")

    if let revenue = company.metrics.first(where: { $0.logicalName == "revenue" }),
       let yoy = revenue.yoyPercent {
        suggestions.append(yoy >= 0 ? "売上を伸ばした要因は？" : "売上が弱かった要因は？")
    } else if let featuredMetricQuestion = buildFeaturedMetricQuestion(for: company) {
        suggestions.append(featuredMetricQuestion)
    }

    if let operatingIncome = company.metrics.first(where: { $0.logicalName == "operatingIncome" }),
       let yoy = operatingIncome.yoyPercent {
        suggestions.append(yoy >= 0 ? "利益率は改善？" : "利益率が悪化した理由は？")
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
    let hasOperatingIncome = company.metrics.contains { $0.logicalName == "operatingIncome" && $0.yoyPercent != nil }

    if isQuarterly {
        let marginQuestion = hasOperatingIncome ? "営業利益率の3年推移は？" : "利益率の3年推移は？"
        return deduplicated([
            "前回四半期との差は？",
            marginQuestion,
            "売上要因の3年変化は？",
            "同四半期で見ると？"
        ]).prefix(4).map(\.self)
    }

    var suggestions = [
        "前回決算との違いは？",
        "この3年の利益率推移は？",
        "この3年で売上ドライバーはどう変わった？",
        "この3年の年次比較で見ると？"
    ]

    if hasOperatingIncome {
        suggestions.insert(
            "この3年の営業利益率推移は？",
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
        suggestions.append(yoy >= 0 ? "利益率は改善？" : "利益率が悪化した理由は？")
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
        suggestions.append(isQuarterly ? "3年でも改善傾向？" : "この3年でも改善している？")
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
