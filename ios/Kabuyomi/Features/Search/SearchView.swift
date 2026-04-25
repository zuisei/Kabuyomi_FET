import SwiftUI

struct SearchView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var isSearchFieldFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                KabuyomiTheme.background.ignoresSafeArea()
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        isSearchFieldFocused = false
                    }

                VStack(spacing: 16) {
                    searchBar

                    if appModel.searchIsLoading {
                        ProgressView("検索中...")
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    } else if let searchErrorMessage = appModel.searchErrorMessage {
                        SearchErrorState(message: searchErrorMessage) {
                            searchNow(query)
                        }
                        .frame(maxHeight: .infinity)
                    } else if appModel.searchResults.isEmpty {
                        SearchEmptyState()
                            .frame(maxHeight: .infinity)
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 12) {
                                ForEach(appModel.searchResults) { item in
                                    SearchResultCard(
                                        item: item,
                                        isAdding: appModel.isAddingTicker(item.ticker),
                                        isAdded: appModel.isTickerInWatchlist(item.ticker, cik: item.cik),
                                        saveAction: { saveSearchResult(item) },
                                        openAction: { openSearchResult(item) }
                                    )
                                }
                            }
                            .padding(.bottom, 20)
                        }
                        .scrollDismissesKeyboard(.interactively)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .navigationTitle("銘柄を検索")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("閉じる") {
                        dismiss()
                    }
                }

                if isSearchFieldFocused {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            isSearchFieldFocused = false
                        } label: {
                            Image(systemName: "keyboard.chevron.compact.down")
                                .font(.system(size: 18, weight: .semibold))
                        }
                        .accessibilityLabel("キーボードを閉じる")
                    }
                }
            }
        }
        .onDisappear {
            searchTask?.cancel()
            isSearchFieldFocused = false
        }
    }

    private func saveSearchResult(_ item: SearchItem) {
        isSearchFieldFocused = false
        Task {
            await appModel.saveSearchResult(item)
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

        appModel.openConversation(for: item.ticker)
        dismiss()
    }

    private func searchNow(_ query: String) {
        searchTask?.cancel()
        searchTask = Task {
            await appModel.search(query: query)
        }
    }

    private var searchBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("質問したい銘柄を検索")
                .font(.system(.headline, design: .rounded, weight: .bold))

            Text("保存しなくても開けます。保存はあとで戻るためのブックマークです。v1 は 10-K / 10-Q に対応しています。")
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .lineSpacing(2)

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                TextField("ティッカー / 企業名で検索", text: $query)
                    .focused($isSearchFieldFocused)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .foregroundStyle(KabuyomiTheme.ink)
                    .submitLabel(.search)
                    .onSubmit {
                        isSearchFieldFocused = false
                    }
                    .onChange(of: query) { _, newValue in
                        searchTask?.cancel()
                        searchTask = Task {
                            try? await Task.sleep(for: .milliseconds(280))
                            if !Task.isCancelled {
                                await appModel.search(query: newValue)
                            }
                        }
                    }

                if !query.isEmpty {
                    Button {
                        query = ""
                        searchNow("")
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
            }
            .padding(14)
            .kabuyomiGlass(radius: 22, tint: Color.white.opacity(0.20), stroke: Color.white.opacity(0.58))
        }
    }
}

private struct SearchErrorState: View {
    let message: String
    let retryAction: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(KabuyomiTheme.negative.opacity(0.72))

            Text("検索できませんでした")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text(message)
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: retryAction) {
                Label("再検索", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderedProminent)
            .tint(KabuyomiTheme.accentDeep)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 18)
        .padding(.vertical, 44)
        .kabuyomiGlass(radius: 28, tint: Color.white.opacity(0.18), stroke: Color.white.opacity(0.58))
    }
}

private struct SearchEmptyState: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 42, weight: .light))
                .foregroundStyle(KabuyomiTheme.accent.opacity(0.45))

            Text("ティッカーまたは企業名を検索")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text("例: AAPL, Apple, Microsoft")
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 18)
        .padding(.vertical, 56)
        .kabuyomiGlass(radius: 28, tint: Color.white.opacity(0.18), stroke: Color.white.opacity(0.58))
    }
}

private struct SearchResultCard: View {
    let item: SearchItem
    let isAdding: Bool
    let isAdded: Bool
    let saveAction: () -> Void
    let openAction: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(item.ticker)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                Text(item.companyName)
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                HStack(spacing: 8) {
                    searchMetaPill(
                        title: item.supportDisplayLabel,
                        tint: item.isSupportedInV1 ? KabuyomiTheme.accent : KabuyomiTheme.inkMuted
                    )
                    searchMetaPill(title: item.exchange, tint: KabuyomiTheme.inkMuted)
                }
                if !item.isSupportedInV1 {
                    Text(item.availabilityNote)
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer()

            if item.isSupportedInV1 {
                VStack(alignment: .trailing, spacing: 8) {
                    Button(action: saveAction) {
                        SearchResultActionLabel(
                            title: saveButtonTitle,
                            systemImage: saveButtonIcon,
                            isLoading: isAdding
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isAdding || isAdded)
                    .accessibilityLabel(isAdded ? "保存済み" : "\(item.ticker) を保存")

                    Button(action: openAction) {
                        SearchResultActionLabel(
                            title: openButtonTitle,
                            systemImage: openButtonIcon,
                            isLoading: false
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(item.ticker) を開く")
                    .accessibilityHint(openAccessibilityHint)
                }
            } else {
                VStack(alignment: .trailing, spacing: 8) {
                    Text(item.availabilityBadgeTitle)
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))

                    Text(item.filingSupportStatus == .unknown ? "保存不可" : "v1 対象外")
                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
        }
        .padding(16)
        .kabuyomiCard(.primary, radius: 24)
    }

    private var saveButtonTitle: String {
        if isAdding {
            return "保存中"
        }

        if isAdded {
            return "保存済み"
        }

        return "保存"
    }

    private var saveButtonIcon: String {
        if isAdded {
            return "checkmark"
        }

        return "bookmark"
    }

    private var openButtonTitle: String {
        "開く"
    }

    private var openButtonIcon: String {
        "arrow.up.right"
    }

    private var openAccessibilityHint: String {
        "保存せずにこの銘柄の会話を開きます"
    }

    private func searchMetaPill(title: String, tint: Color) -> some View {
        Text(title)
            .font(.system(.caption, design: .rounded, weight: .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule()
                    .fill(tint.opacity(0.08))
            )
    }
}

private struct SearchResultActionLabel: View {
    let title: String
    let systemImage: String
    let isLoading: Bool

    var body: some View {
        HStack(spacing: 6) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
                    .tint(KabuyomiTheme.accentDeep)
            } else {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .bold))
            }

            Text(title)
        }
        .font(.system(.caption, design: .rounded, weight: .bold))
        .foregroundStyle(KabuyomiTheme.accentDeep)
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .frame(minWidth: 92)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(KabuyomiTheme.accentSoft.opacity(0.62))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.72), lineWidth: 1)
                )
        )
    }
}

struct TickerOpenTransitionOverlay: View {
    let ticker: String
    let companyName: String
    let detail: String
    let cancelTitle: String?
    let cancelAction: (() -> Void)?

    init(
        ticker: String,
        companyName: String,
        detail: String,
        cancelTitle: String? = nil,
        cancelAction: (() -> Void)? = nil
    ) {
        self.ticker = ticker
        self.companyName = companyName
        self.detail = detail
        self.cancelTitle = cancelTitle
        self.cancelAction = cancelAction
    }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ProgressView()
                .controlSize(.regular)
                .tint(KabuyomiTheme.accentDeep)

            VStack(alignment: .leading, spacing: 4) {
                Text("会話を準備中")
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                Text(companyName)
                    .font(.system(.caption, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .lineLimit(1)

                Text(detail)
                    .font(.system(.caption2, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            if let cancelAction {
                Button(cancelTitle ?? "キャンセル", action: cancelAction)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .buttonStyle(.bordered)
                    .tint(KabuyomiTheme.inkMuted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .kabuyomiGlass(radius: 22, tint: Color.white.opacity(0.22), stroke: Color.white.opacity(0.56))
    }
}
