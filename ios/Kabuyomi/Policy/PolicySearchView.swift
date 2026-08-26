import SwiftUI

// MarketDocket では `RootScreens.swift` に Watch / 検索 / ライブラリの3画面が
// 同居していた。移植時にファイルごと外したので**検索も一緒に消えていた**
// (2026-08-26 オーナー「検索とかできなくなっちゃった」)。検索だけ切り出して戻す。

private enum SearchDateRange: String, CaseIterable, Identifiable { case all, sevenDays, thirtyDays; var id: Self { self }; var label: String { switch self { case .all: "すべて"; case .sevenDays: "直近7日"; case .thirtyDays: "直近30日" } } }

private struct SearchFilters: Equatable {
    var agencies: Set<String> = []
    var status: EventStatus?
    var requiresMarket = false
    var topic: String?
    var ticker: String?
    var domain: String?
    var instrument: PolicyInstrumentType?
    var verification: EventVerificationState?
    var tier: PresentationTier?
    var region: String?
    var marketMode: MarketAnalysisMode?
    var correctionOnly = false
    var timePrecision: TimePrecision?
    var dateRange: SearchDateRange = .all
    var isActive: Bool { !agencies.isEmpty || status != nil || requiresMarket || topic != nil || ticker != nil || domain != nil || instrument != nil || verification != nil || tier != nil || region != nil || marketMode != nil || correctionOnly || timePrecision != nil || dateRange != .all }
}

struct SearchView: View {
    let events: [PolicyEventSummary]
    @Binding var requestedQuery: String?
    @EnvironmentObject private var store: SavedEventStore
    @EnvironmentObject private var eventStore: EventDataStore
    @State private var query = ""
    @State private var filters = SearchFilters()
    @State private var showFilters = false
    @State private var remoteResults: [PolicyEventSummary] = []
    @State private var isSearching = false
    @State private var searchError: String?
    private var localResults: [PolicyEventSummary] { events.filter { event in PolicyEventSearch.matches(event, query: query) && filtersMatch(event) } }
    private var results: [PolicyEventSummary] {
        let remoteOrFallback = eventStore.environment == .syntheticLocal || remoteResults.isEmpty ? localResults : remoteResults
        let candidates = remoteOrFallback.filter { filters.agencies.isEmpty || filters.agencies.contains($0.agency.code) }
        return candidates.sorted {
            let left = PolicyEventSearch.score($0, query: query)
            let right = PolicyEventSearch.score($1, query: query)
            return left == right ? $0.lastActivityAt > $1.lastActivityAt : left > right
        }
    }
    private var requestKey: String { [query, filters.agencies.sorted().joined(separator: ","), filters.status?.rawValue, filters.topic, filters.ticker, filters.domain, filters.instrument?.rawValue, filters.verification?.rawValue, filters.tier?.rawValue, filters.region, filters.marketMode?.rawValue, filters.timePrecision?.rawValue, filters.dateRange.rawValue, filters.requiresMarket.description, filters.correctionOnly.description].compactMap { $0 }.joined(separator: "|") }
    private var filterLabels: [String] {
        var values: [String] = []
        if !filters.agencies.isEmpty { values.append(AgencyFilterSummary.title(for: filters.agencies)) }
        if let status = filters.status { values.append(status.listLabel) }
        if filters.requiresMarket { values.append("市場データあり") }
        if let topic = filters.topic { values.append("テーマ: \(topic)") }
        if let ticker = filters.ticker { values.append("銘柄: \(ticker)") }
        if let domain = filters.domain { values.append(PolicyTaxonomyDisplay.label(for: domain)) }
        if let instrument = filters.instrument { values.append(instrument.labelJA) }
        if let verification = filters.verification {
            values.append(verification == .analystVerified ? "分析検証済み" : "公式ソース確認済み")
        }
        if let tier = filters.tier { values.append(tier.labelJA) }
        if let region = filters.region { values.append(PolicyTaxonomyDisplay.label(for: region)) }
        if let marketMode = filters.marketMode { values.append(marketMode.labelJA) }
        if filters.correctionOnly { values.append("訂正文書あり") }
        if let precision = filters.timePrecision { values.append(precision == .day ? "掲載日単位" : "時刻あり") }
        if filters.dateRange != .all { values.append(filters.dateRange.label) }
        return values
    }
    private var recoverySuggestions: [String] {
        let normalized = PolicyEventSearch.normalize(query)
        let mapped: [String]
        if ["btc", "bitcoin", "ビットコイン"].contains(normalized) { mapped = ["Bitcoin", "ビットコイン"] }
        else if ["semiconductor", "semiconductors", "chip", "chips", "半導体"].contains(normalized) { mapped = ["半導体", "chip"] }
        else if ["sec", "securities and exchange commission", "証券取引委員会"].contains(normalized) { mapped = ["SEC", "証券取引委員会"] }
        else { mapped = ["BTC", "半導体", "SEC"] }
        return mapped.filter { PolicyEventSearch.normalize($0) != normalized }
    }
    var body: some View {
        NavigationStack {
            List {
                if filters.isActive {
                    Section {
                        HStack(alignment: .top, spacing: 10) {
                            Label("適用中: " + filterLabels.joined(separator: "、"), systemImage: "line.3.horizontal.decrease.circle.fill")
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 4)
                            Button("解除") { filters = SearchFilters() }
                                .font(.subheadline.weight(.semibold))
                        }
                    }
                }
                if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Section {
                        Button {
                            store.toggleSavedSearch(query)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Label(
                                    store.isSearchSaved(query) ? "保存した検索から解除" : "検索語「\(query)」を保存",
                                    systemImage: store.isSearchSaved(query) ? "bookmark.fill" : "bookmark"
                                )
                                Text("ライブラリの「検索」から開けます")
                                    .font(.caption)
                                    .foregroundStyle(KabuyomiTheme.inkMuted)
                            }
                        }
                        .accessibilityIdentifier("search.saveQueryButton")

                        Button {
                            store.toggleWatchedQuery(query)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Label(
                                    store.isQueryWatched(query) ? "新着ウォッチを解除" : "このキーワードの新着をウォッチ",
                                    systemImage: store.isQueryWatched(query) ? "eye.slash" : "eye"
                                )
                                Text("今後一致した公式資料を「ウォッチ」の受信箱へ表示します")
                                    .font(.caption)
                                    .foregroundStyle(KabuyomiTheme.inkMuted)
                            }
                        }
                        .accessibilityIdentifier("search.watchQueryButton")
                    }
                }
                if query.isEmpty && !filters.isActive {
                    if !store.recentSearches.isEmpty { Section("最近の検索") { ForEach(store.recentSearches, id: \.self) { value in Button(value) { query = value } }; Button("履歴を消去", role: .destructive) { store.clearSearches() } } }
                    Section("候補") {
                        Button("BTC / Bitcoin") { query = "BTC" }
                        Button("半導体") { query = "半導体" }
                        Button("文書改訂") { filters.status = .revised }
                        Button("市場データあり") { filters.requiresMarket = true }
                    }
                } else if isSearching {
                    ProgressView("サーバーを検索中").frame(maxWidth: .infinity)
                } else if results.isEmpty {
                    ContentUnavailableView {
                        Label("該当する政策イベントはありません", systemImage: "magnifyingglass")
                    } description: {
                        Text(filters.isActive ? "検索語だけで探すか、条件を変更してください。" : "別名・機関名・文書番号でも検索できます。")
                    } actions: {
                        if filters.isActive {
                            Button("フィルターを解除して再検索") { filters = SearchFilters() }
                        }
                        if !query.isEmpty {
                            Button("検索語を消去") { query = "" }
                        }
                        ForEach(recoverySuggestions, id: \.self) { suggestion in
                            Button("「\(suggestion)」で検索") { query = suggestion }
                        }
                    }
                        .accessibilityIdentifier("search.empty")
                } else {
                    Section("検索結果 \(results.count)件") {
                        ForEach(results) { event in
                            NavigationLink { EventDetailLoader(summary: event) } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    CompactPolicyRow(event: event, highlightQuery: query)
                                    if let reason = PolicyEventSearch.matchReason(event, query: query) {
                                        Label(reason, systemImage: "text.magnifyingglass")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(KabuyomiTheme.accent)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("検索")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "政策、機関、銘柄、文書番号")
            .onSubmit(of: .search) { store.addSearch(query) }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showFilters = true } label: {
                        Label("フィルター", systemImage: filters.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    }
                    .accessibilityIdentifier("search.filtersButton")
                }
            }
            .sheet(isPresented: $showFilters) { SearchFilterSheet(events: events, filters: $filters) }
            .listStyle(.plain)
            // 一覧と同じ地。既定の白のままだと検索だけ浮く(2026-08-26)。
            .scrollContentBackground(.hidden)
            .background(KabuyomiTheme.canvas)
            .accessibilityIdentifier("search.main")
            .overlay(alignment: .bottom) { if let searchError { Text(searchError).font(.caption).padding(8).background(.thinMaterial, in: Capsule()) } }
        }
        .task {
            switch ProcessInfo.processInfo.arguments.value(after: "-screenshotMode") {
            case "searchResults": query = "NVDA"
            case "searchAllPolicy": query = "Trade"
            case "searchArchive": filters.tier = .archive
            case "searchEmpty": query = "該当なしXYZ"
            default: break
            }
        }
        .task(id: requestKey) { await runServerSearch() }
        .onChange(of: requestedQuery) { _, value in
            guard let value else { return }
            query = value
            requestedQuery = nil
        }
    }
    private func filtersMatch(_ event: PolicyEventSummary) -> Bool {
        (filters.agencies.isEmpty || filters.agencies.contains(event.agency.code))
            && (filters.status == nil || event.status == filters.status)
            && (!filters.requiresMarket || event.hasMarketData)
            && (filters.topic == nil || event.topics.contains(filters.topic!))
            && (filters.ticker == nil || event.tickers.contains(filters.ticker!))
            && (filters.domain == nil || event.domain?.slug == filters.domain)
            && (filters.instrument == nil || event.instrumentType == filters.instrument)
            && (filters.verification == nil || event.verificationState == filters.verification)
            && (filters.tier == nil || event.productAnalysis.presentationTier == filters.tier)
            && (filters.region == nil || event.productAnalysis.affectedRegionCodes.contains(filters.region!))
            && (filters.marketMode == nil || event.productAnalysis.marketAnalysisMode == filters.marketMode)
            && (!filters.correctionOnly || event.hasCorrectionDocument)
            && (filters.timePrecision == nil || (filters.timePrecision == .day ? event.publishedAt == nil : event.publishedAt != nil))
            && dateMatches(event)
    }

    private func dateMatches(_ event: PolicyEventSummary) -> Bool {
        guard filters.dateRange != .all else { return true }
        let days = filters.dateRange == .sevenDays ? 7 : 30
        return event.lastActivityAt >= Calendar.current.date(byAdding: .day, value: -days, to: .now)!
    }

    private func queryItems(agencyOverride: String? = nil) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { items.append(URLQueryItem(name: "q", value: trimmed)) }
        func add(_ name: String, _ value: String?) { if let value { items.append(URLQueryItem(name: "filter[\(name)]", value: value)) } }
        if let agencyOverride { add("agency", agencyOverride) }
        else if filters.agencies.count == 1 { add("agency", filters.agencies.first) }
        add("status", filters.status?.rawValue); add("topic", filters.topic); add("ticker", filters.ticker)
        add("domain", filters.domain); add("instrument", filters.instrument?.rawValue); add("verification", filters.verification?.rawValue)
        add("tier", filters.tier?.rawValue); add("region", filters.region); add("market_mode", filters.marketMode?.rawValue); add("time_precision", filters.timePrecision?.rawValue)
        if filters.correctionOnly { add("correction", "true") }
        if filters.requiresMarket { add("market", "available") }
        if filters.dateRange != .all {
            let days = filters.dateRange == .sevenDays ? 7 : 30
            let date = Calendar(identifier: .gregorian).date(byAdding: .day, value: -days, to: .now)!
            add("date_from", date.formatted(.iso8601.year().month().day()))
        }
        return items
    }

    @MainActor private func runServerSearch() async {
        guard eventStore.environment != .syntheticLocal else { return }
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || filters.isActive else { remoteResults = []; searchError = nil; return }
        isSearching = true
        defer { isSearching = false }
        do {
            try await Task.sleep(for: .milliseconds(250))
            if filters.agencies.count > 1 {
                var resultsByID: [UUID: PolicyEventSummary] = [:]
                var usedOfflineCache = false
                for agency in filters.agencies.sorted() {
                    try Task.checkCancellation()
                    let result = try await eventStore.searchSummaries(queryItems: queryItems(agencyOverride: agency))
                    result.value.forEach { resultsByID[$0.id] = $0 }
                    usedOfflineCache = usedOfflineCache || result.origin == .offlineCache
                }
                remoteResults = resultsByID.values.sorted { $0.lastActivityAt > $1.lastActivityAt }
                searchError = usedOfflineCache ? "オフライン・前回取得結果" : nil
            } else {
                let result = try await eventStore.searchSummaries(queryItems: queryItems())
                remoteResults = result.value
                searchError = result.origin == .offlineCache ? "オフライン・前回取得結果" : nil
            }
        } catch is CancellationError {
            return
        } catch {
            remoteResults = []
            searchError = "検索結果を取得できませんでした。再度お試しください。"
        }
    }
}

private struct SearchFilterSheet: View {
    let events: [PolicyEventSummary]
    @Binding var filters: SearchFilters
    @Environment(\.dismiss) private var dismiss
    @State private var showAgencyFilter = false
    var body: some View {
        NavigationStack { Form {
            Button { showAgencyFilter = true } label: {
                LabeledContent("機関") {
                    HStack(spacing: 6) {
                        Text(AgencyFilterSummary.title(for: filters.agencies))
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.6))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("機関フィルター、\(AgencyFilterSummary.title(for: filters.agencies))")
            .accessibilityIdentifier("search.agencyFilterButton")
            Picker("政策分野", selection: $filters.domain) { Text("すべて").tag(String?.none); ForEach(Array(Set(events.compactMap(\.domain))).sorted { $0.labelJA < $1.labelJA }, id: \.slug) { Text($0.labelJA).tag(Optional($0.slug)) } }
            Picker("政策手段", selection: $filters.instrument) { Text("すべて").tag(PolicyInstrumentType?.none); ForEach(Array(Set(events.compactMap(\.instrumentType))).sorted { $0.labelJA < $1.labelJA }, id: \.self) { Text($0.labelJA).tag(Optional($0)) } }
            Picker("検証状態", selection: $filters.verification) { Text("すべて").tag(EventVerificationState?.none); Text("公式ソース確認済み").tag(Optional(EventVerificationState.sourceVerified)); Text("分析検証済み").tag(Optional(EventVerificationState.analystVerified)) }
            Picker("表示区分", selection: $filters.tier) { Text("すべて").tag(PresentationTier?.none); ForEach(PresentationTier.allCases, id: \.self) { Text($0.labelJA).tag(Optional($0)) } }
            Picker("地域", selection: $filters.region) { Text("すべて").tag(String?.none); ForEach(Array(Set(events.flatMap { $0.productAnalysis.affectedRegionCodes })).sorted(), id: \.self) { Text(PolicyTaxonomyDisplay.label(for: $0)).tag(Optional($0)) } }
            Picker("市場モード", selection: $filters.marketMode) { Text("すべて").tag(MarketAnalysisMode?.none); ForEach(MarketAnalysisMode.allCases, id: \.self) { Text($0.labelJA).tag(Optional($0)) } }
            Picker("時刻精度", selection: $filters.timePrecision) { Text("すべて").tag(TimePrecision?.none); Text("正確な時刻").tag(Optional(TimePrecision.exact)); Text("分単位").tag(Optional(TimePrecision.minute)); Text("掲載日単位").tag(Optional(TimePrecision.day)) }
            Picker("状態", selection: $filters.status) { Text("すべて").tag(EventStatus?.none); Text("新規").tag(Optional(EventStatus.published)); Text("改訂").tag(Optional(EventStatus.revised)) }
            Picker("期間", selection: $filters.dateRange) { ForEach(SearchDateRange.allCases) { Text($0.label).tag($0) } }
            Toggle("市場データあり", isOn: $filters.requiresMarket)
            Toggle("訂正文書あり", isOn: $filters.correctionOnly)
            Picker("テーマ", selection: $filters.topic) { Text("すべて").tag(String?.none); ForEach(Array(Set(events.flatMap(\.topics))).sorted(), id: \.self) { Text($0).tag(Optional($0)) } }
            Picker("銘柄", selection: $filters.ticker) { Text("すべて").tag(String?.none); ForEach(Array(Set(events.flatMap(\.tickers))).sorted(), id: \.self) { Text($0).tag(Optional($0)) } }
        }.navigationTitle("検索フィルター").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .cancellationAction) { Button("リセット") { filters = SearchFilters() } }; ToolbarItem(placement: .confirmationAction) { Button("完了") { dismiss() } } } }
        .sheet(isPresented: $showAgencyFilter) {
            AgencyFilterSheet(
                agencies: AgencyFilterOption.options(from: events),
                initialSelection: filters.agencies
            ) { filters.agencies = $0 }
        }
    }
}

private enum LibrarySection: String, CaseIterable, Identifiable {
    case documents = "資料"
    case searches = "検索"
    case history = "履歴"

    var id: Self { self }
}

