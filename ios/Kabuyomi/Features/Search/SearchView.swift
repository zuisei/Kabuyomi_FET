import SwiftUI

struct SearchView: View {
    @Environment(AppModel.self) private var appModel
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
                                        isAdded: appModel.isTickerInWatchlist(item.ticker)
                                    ) {
                                        isSearchFieldFocused = false
                                        Task { await appModel.addToWatchlist(item) }
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
            }
            .navigationTitle("検索")
            .toolbar {
                if isSearchFieldFocused {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("閉じる") {
                            isSearchFieldFocused = false
                        }
                    }
                }
            }
        }
        .onDisappear {
            searchTask?.cancel()
            isSearchFieldFocused = false
        }
    }

    private var searchBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("質問したい銘柄を保存")
                .font(.system(.headline, design: .rounded, weight: .bold))

            Text("v1 は 10-K / 10-Q に対応しています。20-F / 6-K 企業はまだ保存できません。")
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                TextField("AAPL / Apple Inc.", text: $query)
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
            .kabuyomiCard(.input, radius: 22)
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
        .kabuyomiCard(.muted, radius: 28)
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
                        title: item.latestFormType.map { "最新 \($0)" } ?? "10-K / 10-Q 対応",
                        tint: KabuyomiTheme.accent
                    )
                    searchMetaPill(title: item.exchange, tint: KabuyomiTheme.inkMuted)
                }
            }

            Spacer()

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
                .frame(minWidth: 82)
            }
            .buttonStyle(.borderedProminent)
            .tint(isAdded ? KabuyomiTheme.inkMuted : KabuyomiTheme.accent)
            .disabled(isAdding || isAdded)
        }
        .padding(16)
        .kabuyomiCard(.primary, radius: 24)
    }

    private var buttonTitle: String {
        if isAdding {
            return "保存中"
        }

        if isAdded {
            return "保存済み"
        }

        return "保存"
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
