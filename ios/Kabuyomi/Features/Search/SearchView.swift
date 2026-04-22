import SwiftUI

struct SearchView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var searchTask: Task<Void, Never>?
    @State private var pendingOpenItem: SearchItem?
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
                                        isAdded: appModel.isTickerInWatchlist(item.ticker, cik: item.cik)
                                    ) {
                                        addSearchResult(item)
                                    }
                                }
                            }
                            .padding(.bottom, 20)
                        }
                        .scrollDismissesKeyboard(.interactively)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .allowsHitTesting(pendingOpenItem == nil)

                if let pendingOpenItem {
                    Color.black.opacity(0.14)
                        .ignoresSafeArea()

                    TickerOpenTransitionOverlay(
                        ticker: pendingOpenItem.ticker,
                        companyName: pendingOpenItem.companyName,
                        detail: "初回は決算資料の取得があるため、数秒かかることがあります。"
                    )
                    .padding(20)
                }
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
            pendingOpenItem = nil
        }
    }

    private func addSearchResult(_ item: SearchItem) {
        guard pendingOpenItem == nil else { return }
        isSearchFieldFocused = false
        pendingOpenItem = item
        Task {
            await appModel.addToWatchlist(item)
            if appModel.isTickerInWatchlist(item.ticker, cik: item.cik) {
                dismiss()
            } else if pendingOpenItem?.id == item.id {
                pendingOpenItem = nil
            }
        }
    }

    private var searchBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("質問したい銘柄を保存")
                .font(.system(.headline, design: .rounded, weight: .bold))

            Text("保存すると、そのまま会話画面を開きます。v1 は 10-K / 10-Q に対応しています。20-F / 6-K 企業はまだ保存できません。")
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
                        appModel.searchResults = []
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
    let addAction: () -> Void

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
                Button(action: addAction) {
                    HStack(spacing: 6) {
                        if isAdding {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        } else if isAdded {
                            Image(systemName: "checkmark")
                        }

                        Text(buttonTitle)
                    }
                    .frame(minWidth: 112)
                }
                .buttonStyle(.borderedProminent)
                .tint(isAdded ? KabuyomiTheme.inkMuted : KabuyomiTheme.accent)
                .disabled(isAdding || isAdded)
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

    private var buttonTitle: String {
        if isAdding {
            return "開いています"
        }

        if isAdded {
            return "保存済み"
        }

        return "保存して開く"
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

struct TickerOpenTransitionOverlay: View {
    let ticker: String
    let companyName: String
    let detail: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
                .tint(KabuyomiTheme.accentDeep)

            VStack(spacing: 6) {
                Text("\(ticker) を保存して開いています...")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .multilineTextAlignment(.center)

                Text(companyName)
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .multilineTextAlignment(.center)

                Text(detail)
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity)
        .kabuyomiGlass(radius: 28, tint: Color.white.opacity(0.3), stroke: Color.white.opacity(0.58))
    }
}
