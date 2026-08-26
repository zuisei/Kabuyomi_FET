import SwiftUI

struct TimelineView: View {
    let events: [PolicyEventSummary]
    let loadError: Bool
    let isLoading: Bool
    /// まだ取っていないページが残っているか。
    var hasMore: Bool = false
    let refresh: () async -> Void
    /// 続きを1ページ取る。末尾が見えたときと、1日ぶんより広い絞り込みに移ったときに呼ぶ。
    var loadMore: () async -> Void = {}
    @EnvironmentObject private var store: SavedEventStore
    @EnvironmentObject private var eventStore: EventDataStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showSearch = false
    @State private var requestedSearchQuery: String?
    @State private var filter: TimelineFilter
    @State private var path: [PolicyEventSummary] = []
    @State private var agencyFilters: Set<String>
    @State private var showAgencyFilter = false
    @State private var showAdvancedFilters = false
    @State private var showFilterCriteria = false
    @State private var advancedFilters: TimelineAdvancedFilters
    @State private var didResolveInitialFilter = false

    init(
        events: [PolicyEventSummary],
        loadError: Bool,
        isLoading: Bool,
        hasMore: Bool = false,
        refresh: @escaping () async -> Void,
        loadMore: @escaping () async -> Void = {}
    ) {
        self.events = events
        self.loadError = loadError
        self.isLoading = isLoading
        self.hasMore = hasMore
        self.refresh = refresh
        self.loadMore = loadMore
        let mode = ProcessInfo.processInfo.arguments.value(after: "-screenshotMode")
        _filter = State(initialValue:
            ["timelineMonitor", "timelineBundles"].contains(mode) ? .monitor
            : mode == "timelineArchive" || mode == "timelineAll" ? .all
            : mode == "timelineDeadlines" ? .deadlines
            : mode == "timelineMarket" ? .market
            : mode == "timelineRevised" ? .corrected
            : mode == "timelineSignal" ? .signal
            : .recent
        )
        let screenshotAgencies = Set(
            ProcessInfo.processInfo.arguments.value(after: "-screenshotAgencyFilters")?
                .split(separator: ",")
                .map(String.init) ?? []
        )
        _agencyFilters = State(initialValue: screenshotAgencies)
        _advancedFilters = State(initialValue: TimelineAdvancedFilters(tier: mode == "timelineArchive" ? .archive : nil))
    }

    /// データの中で一番新しい活動時刻。「新着」の基準日になる。
    private var latestActivityAt: Date? {
        events.map(\.lastActivityAt).max()
    }

    /// 最新の公示日ぶんを、まだ取り切れていないかもしれない状態。
    ///
    /// 絞り込みを新着だけにしたので(2026-08-26 オーナー「もう新着だけにしていいかも」)、
    /// 2,447件を全部取る意味は無くなった。**手元の一番古いものがまだ最新日なら**、
    /// その日の続きが次のページにいる可能性がある — そこまでは取る。
    /// 前日まで届いていれば、その先はどれも新着に出ないので取らない。
    private var mayHaveMoreOfLatestDay: Bool {
        guard hasMore, let latestActivityAt else { return false }
        guard let oldestLoaded = events.map(\.lastActivityAt).min() else { return false }
        return TimelineFilter.isRecent(oldestLoaded, latestActivityAt: latestActivityAt)
    }

    private var filtered: [PolicyEventSummary] {
        events.filter { event in
            filter.includes(event, store: store, latestActivityAt: latestActivityAt)
                && (agencyFilters.isEmpty || agencyFilters.contains(event.agency.code))
                && (advancedFilters.tier == nil || event.productAnalysis.presentationTier == advancedFilters.tier)
                && (advancedFilters.domain == nil || event.domain?.slug == advancedFilters.domain)
                && (advancedFilters.instrument == nil || event.instrumentType == advancedFilters.instrument)
                && (advancedFilters.verification == nil || event.verificationState == advancedFilters.verification)
                && (advancedFilters.ticker == nil || event.tickers.contains(advancedFilters.ticker!))
                && (!advancedFilters.unreadOnly || store.unreadCount(for: event) > 0)
                && (!advancedFilters.newOnly || event.status == .published)
                && dateMatches(event)
        }.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    private var accessibilityLayout: Bool { dynamicTypeSize.isAccessibilitySize }
    private var deadlineItems: [PolicyDeadlineItem] {
        PolicyDeadlinePresentation.items(from: filtered)
    }

    private var emptyStateTitle: String {
        if filter == .recent && !events.isEmpty { return "新着はありません" }
        if filter == .deadlines && !events.isEmpty { return "表示できる期限はありません" }
        if filter == .signal && !events.isEmpty { return "自動選定された注目政策はまだありません" }
        if filter == .market && !events.isEmpty { return "市場データ付きの政策はまだありません" }
        return "該当するイベントはありません"
    }

    private var emptyStateDescription: String {
        if filter == .recent && !events.isEmpty {
            return "新しい公式資料を取得するとここへ表示します。過去の資料は「全資料」から確認できます。"
        }
        if filter == .deadlines && !events.isEmpty {
            return "公式資料に明記された意見期限、発効日、適用開始日だけを表示します。推定日は追加しません。"
        }
        if filter == .signal && !events.isEmpty {
            return "公式資料は取得済みです。自動分析の必要項目が揃った資料だけを注目欄に表示します。"
        }
        if filter == .market && !events.isEmpty {
            return "表示権利を確認し、実データを接続した政策だけを表示します。未接続・候補状態は含めません。"
        }
        return "別のフィルターを選択してください。"
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if loadError && events.isEmpty {
                    ScrollView {
                        errorState
                            .frame(maxWidth: .infinity)
                            .padding(.top, 96)
                    }
                    .refreshable { await refresh() }
                    .accessibilityIdentifier("timeline.main")
                }
                else if isLoading && events.isEmpty { ProgressView("政策イベントを取得中") }
                else {
                    List {
                        if loadError {
                            Label("最新データを取得できませんでした。前回取得したデータを表示しています。", systemImage: "wifi.exclamationmark")
                                .font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                                .listRowSeparator(.hidden)
                                .listRowBackground(KabuyomiTheme.canvas)
                        }
                        header
                            .listRowSeparator(.hidden)
                            .listRowInsets(.init(top: 4, leading: 16, bottom: 10, trailing: 16))
                            // 行の地は既定だと白。見出し帯だけ浮くので地に合わせる。
                            .listRowBackground(KabuyomiTheme.canvas)
                        if filtered.isEmpty {
                            ContentUnavailableView {
                                Label(emptyStateTitle, systemImage: "line.3.horizontal.decrease.circle")
                            } description: {
                                Text(emptyStateDescription)
                            } actions: {
                                if [.recent, .deadlines].contains(filter) && !events.isEmpty {
                                    Button("全資料を見る") { filter = .all }
                                } else if filter == .signal && !events.isEmpty {
                                    Button(hasMonitorEvents ? "確認中を見る" : "全資料を見る") {
                                        filter = hasMonitorEvents ? .monitor : .all
                                    }
                                } else if filter == .market && !events.isEmpty {
                                    Button("全資料を見る") { filter = .all }
                                }
                            }
                            .listRowSeparator(.hidden).accessibilityIdentifier("timeline.empty")
                        } else if filter == .deadlines {
                            ForEach(PolicyDeadlineWindow.allCases) { window in
                                let items = deadlineItems(in: window)
                                if !items.isEmpty {
                                    Section {
                                        ForEach(items) { item in
                                            HStack(spacing: 6) {
                                                NavigationLink(value: item.event) {
                                                    PolicyDeadlineRow(item: item)
                                                }
                                                .buttonStyle(.plain)
                                                if let url = item.legalDate.officialURL {
                                                    Link(destination: url) {
                                                        Image(systemName: "arrow.up.right.square")
                                                            .frame(width: 44, height: 44)
                                                    }
                                                    .accessibilityLabel("公式資料を開く")
                                                }
                                            }
                                            .accessibilityIdentifier("deadline.\(item.legalDate.id)")
                                        }
                                    } header: {
                                        Text("\(window.titleJA)  \(items.count)件")
                                    }
                                }
                            }
                        } else {
                            ForEach(TimelinePublicationGrouper.items(from: filtered)) { item in
                                switch item {
                                case .event(let event):
                                    NavigationLink(value: event) { PolicyEventRow(event: event) }
                                        .listRowInsets(.init(top: 0, leading: 16, bottom: 8, trailing: 16))
                                        .listRowSeparator(.hidden)
                                        .listRowBackground(TimelineRowBoundaryBackground())
                                        .accessibilityIdentifier("eventRow.\(event.agency.code == "BIS" ? "bisDemo" : event.agency.code)")
                                        .accessibilityValue(store.watches(event) ? "ウォッチ対象" : "")
                                case .batch(let batch):
                                    NavigationLink {
                                        TimelinePublicationBatchView(batch: batch)
                                    } label: {
                                        TimelinePublicationBatchRow(batch: batch)
                                    }
                                    .listRowInsets(.init(top: 0, leading: 16, bottom: 8, trailing: 16))
                                    .listRowSeparator(.hidden)
                                    .listRowBackground(TimelineRowBoundaryBackground())
                                    .accessibilityIdentifier("publicationBatch.row")
                                }
                            }

                            // 末尾が見えたら続きを1ページ。開いた直後に25往復して
                            // 35秒かける代わりに、要る分だけ足していく(2026-08-26)。
                            if mayHaveMoreOfLatestDay {
                                HStack(spacing: 8) {
                                    ProgressView().controlSize(.small)
                                    Text("続きを読み込み中")
                                        .font(.caption)
                                        .foregroundStyle(KabuyomiTheme.inkMuted)
                                }
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, 12)
                                .listRowSeparator(.hidden)
                                .listRowBackground(KabuyomiTheme.canvas)
                                .task { await loadMore() }
                            }
                        }
                    }
                    .listStyle(.plain)
                    // 地は Kabuyomi と同じ紙色。既定の白のままだと、
                    // このタブだけ別のアプリを埋め込んだように見える(2026-08-26)。
                    .scrollContentBackground(.hidden)
                    .background(KabuyomiTheme.canvas)
                    .refreshable { await refresh() }
                    // 絞り込みを広げた瞬間にも続きを取る。末尾まで送らないと
                    // 出てこない、という形にはしない。
                    .accessibilityIdentifier("timeline.main")
                }
            }
            .navigationTitle("政策ウォッチ").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    // 検索は MarketDocket ではタブの1枚だった。Kabuyomi ではタブを
                    // 増やさず、ホームと同じくツールバーから開く(2026-08-26)。
                    Button {
                        showSearch = true
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    .accessibilityLabel("政策を検索")
                    .accessibilityIdentifier("policy.search.open")

                    agencyFilterButton
                    advancedFilterMenu
                }
            }
            .navigationDestination(for: PolicyEventSummary.self) { EventDetailLoader(summary: $0) }
        }
        .sheet(isPresented: $showSearch) {
            NavigationStack {
                SearchView(events: events, requestedQuery: $requestedSearchQuery)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("閉じる") { showSearch = false }
                                .accessibilityIdentifier("policy.search.close")
                        }
                    }
            }
            .tint(KabuyomiTheme.accent)
        }
        .sheet(isPresented: $showAgencyFilter) {
            AgencyFilterSheet(
                agencies: AgencyFilterOption.options(from: events),
                initialSelection: agencyFilters
            ) { agencyFilters = $0 }
        }
        .sheet(isPresented: $showAdvancedFilters) {
            TimelineAdvancedFilterSheet(events: events, initialSelection: advancedFilters) {
                advancedFilters = $0
            }
        }
        .sheet(isPresented: $showFilterCriteria) {
            TimelineFilterCriteriaSheet(selectedFilter: filter) { selected in
                filter = selected
            }
        }
        .task(id: events.count) {
            let mode = ProcessInfo.processInfo.arguments.value(after: "-screenshotMode")
            if mode == nil, !didResolveInitialFilter, !events.isEmpty {
                if eventStore.dataMode == .live {
                    filter = latestActivityAt == nil ? .all : .recent
                } else {
                    filter = .signal
                }
                didResolveInitialFilter = true
            }
            if mode == "timelineEmpty" { events.forEach(store.markRead) }
            if mode == "agencyFilterSheet", !events.isEmpty { showAgencyFilter = true }
            if mode == "timelineCriteria", !events.isEmpty { showFilterCriteria = true }
            let listModes = ["timelineSignal", "timelineAll", "timelineMonitor", "timelineBundles", "timelineArchive", "timelineDeadlines", "timelineMarket", "timelineRevised", "timelineEmpty", "timelineCriteria", "agencyFilterSheet", "agencyFilterApplied", "watch", "watchMatches", "searchResults", "searchArchive", "searchEmpty", "library", "settings", "userError", "developerDiagnostics"]
            guard let mode, !listModes.contains(mode) else { return }
            let targetID = ProcessInfo.processInfo.arguments.value(after: "-screenshotEventID").flatMap(UUID.init(uuidString:))
            let idTarget = targetID.flatMap { id in events.first { $0.id == id } }
            let targetAgency = ProcessInfo.processInfo.arguments.value(after: "-screenshotAgency")
            let requestedTarget = targetAgency.flatMap { agency in events.first { $0.agency.code == agency } }
            if let target = idTarget ?? requestedTarget ?? events.first(where: { $0.agency.code == "BIS" }) ?? events.first {
                path = [target]
            }
        }
    }

    private var hasMonitorEvents: Bool {
        events.contains { TimelineFilter.monitor.includes($0, store: store) }
    }

    private func deadlineItems(in window: PolicyDeadlineWindow) -> [PolicyDeadlineItem] {
        deadlineItems.filter { $0.window == window }.sorted { left, right in
            if left.legalDate.date != right.legalDate.date {
                return window == .overdue
                    ? left.legalDate.date > right.legalDate.date
                    : left.legalDate.date < right.legalDate.date
            }
            return left.event.lastActivityAt > right.event.lastActivityAt
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            if accessibilityLayout {
                VStack(alignment: .leading, spacing: 10) {
                    headerTitleBlock
                    timezoneMenu
                    Button { showFilterCriteria = true } label: {
                        Label("表示の基準", systemImage: "info.circle")
                    }
                }
            } else {
                HStack(alignment: .top) {
                    headerTitleBlock
                    Spacer()
                    HStack(spacing: 2) {
                        timezoneMenu
                        Button { showFilterCriteria = true } label: {
                            Image(systemName: "info.circle")
                                .frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("表示の基準")
                        .accessibilityIdentifier("timeline.filterCriteria")
                    }
                }
            }
        }
    }

    private var headerTitleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            if eventStore.dataMode == .synthetic || eventStore.dataMode == .mixed {
                Text("7月16日（デモ）")
                    .font(.headline)
            }
            HStack(spacing: 7) {
                if eventStore.totalSummaryCount > 0 {
                    Text(headerCountLabel)
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                sourceLabel
            }
            if let latest = events.map(\.lastActivityAt).max() {
                Text(events.allSatisfy { $0.publishedAt == nil } ? "最終データ 掲載日単位" : "最終データ \(AppFormatters.displayTime(latest, preference: .both))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
    }

    private var headerCountLabel: String {
        let loaded = eventStore.loadedSummaryCount
        let total = eventStore.totalSummaryCount
        if isLoading && loaded < total {
            return "\(loaded)/\(total)件"
        }

        let isNarrowed = filter != .all || !agencyFilters.isEmpty || advancedFilters.isActive
        guard isNarrowed else { return "\(loaded)件" }

        let visibleCount = filter == .deadlines ? deadlineItems.count : filtered.count
        let scope = switch filter {
        case .recent: "新着"
        case .deadlines: "期限"
        default: filter.compactTitle
        }
        return "\(scope) \(visibleCount)件 / 全\(loaded)件"
    }

    private var timezoneMenu: some View {
        Menu {
            Picker("時刻表示", selection: $store.timezone) { ForEach(TimezonePreference.allCases) { Text($0.rawValue).tag($0) } }
        } label: {
            Label("時刻: \(store.timezone.rawValue)", systemImage: "globe")
                .font(accessibilityLayout ? .caption : .subheadline)
        }
        .accessibilityIdentifier("timeline.timezoneMenu")
    }

    private var filterMenu: some View {
        Menu {
            Picker("絞り込み", selection: $filter) {
                ForEach(TimelineFilter.allCases) { Text($0.rawValue).tag($0) }
            }
        } label: {
            Label("絞り込み: \(filter.rawValue)", systemImage: "line.3.horizontal.decrease.circle")
                .font(.caption.weight(.semibold))
        }
        .accessibilityIdentifier("timeline.filterMenu")
    }

    private var filterRail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(TimelineFilter.allCases) { item in
                    Button(item.compactTitle) { filter = item }
                        .font(.subheadline.weight(filter == item ? .semibold : .regular))
                        .padding(.horizontal, 10).frame(minHeight: 44)
                        .background(filter == item ? KabuyomiTheme.accent.opacity(0.14) : KabuyomiTheme.inkMuted.opacity(0.08), in: Capsule())
                        .foregroundStyle(filter == item ? KabuyomiTheme.accent : KabuyomiTheme.ink)
                        .accessibilityIdentifier("timeline.filter.\(item.id)")
                }
            }
        }
    }

    private var agencyFilterButton: some View {
        Button { showAgencyFilter = true } label: {
            HStack(spacing: 4) {
                Image(systemName: "building.2")
                Text(AgencyFilterSummary.title(for: agencyFilters))
            }
        }
        .accessibilityLabel("機関フィルター、\(AgencyFilterSummary.title(for: agencyFilters))")
        .accessibilityIdentifier("timeline.agencyFilterButton")
    }

    private var advancedFilterMenu: some View {
        Button { showAdvancedFilters = true } label: {
            Label(
                advancedFilters.activeCount == 0 ? "詳細フィルター" : "詳細フィルター、\(advancedFilters.activeCount)件適用中",
                systemImage: advancedFilters.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
            )
        }
        .accessibilityIdentifier("timeline.advancedFilters")
    }

    private func dateMatches(_ event: PolicyEventSummary) -> Bool {
        guard let recentDays = advancedFilters.recentDays,
              let boundary = Calendar.current.date(byAdding: .day, value: -recentDays, to: .now) else { return true }
        return event.lastActivityAt >= boundary
    }

    @ViewBuilder private var sourceLabel: some View {
        if eventStore.origin == .offlineCache {
            Label("前回取得", systemImage: "wifi.slash").font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
        } else if eventStore.dataMode == .synthetic || eventStore.dataMode == .mixed {
            Label(eventStore.environment == .syntheticLocal ? "デモ・ローカル" : "プレビュー・デモ", systemImage: "testtube.2")
                .font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
        } else {
            Label("公式ソース", systemImage: "doc.badge.checkmark").font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    @ViewBuilder private var errorState: some View {
        Group {
            if eventStore.environment == .productionAPI && eventStore.environment.baseURL == nil {
                ContentUnavailableView {
                    Label("サービス設定が完了していません", systemImage: "wrench.and.screwdriver")
                } description: {
                    Text("このビルドには接続先が設定されていません。配布元に確認してください。")
                }
            } else {
                ContentUnavailableView {
                    Label("最新データを取得できませんでした", systemImage: "exclamationmark.triangle")
                } description: {
                    Text("通信状態を確認して再読み込みしてください。前回取得したデータがある場合は自動的に表示します。")
                } actions: {
                    Button("再読み込み") { Task { await refresh() } }
                }
            }
        }
        .accessibilityIdentifier("timeline.userError")
    }
}

private struct PolicyDeadlineRow: View {
    let item: PolicyDeadlineItem

    private var tint: Color {
        item.window == .overdue ? AppColors.revision : .accentColor
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label(item.legalDate.kind.labelJA, systemImage: item.legalDate.kind.systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(tint)
                Spacer()
                Text(PolicyDeadlinePresentation.shortDate(item.legalDate.date))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
            }
            HStack(spacing: 7) {
                Text(item.event.displayAgencyCode).font(.caption.weight(.bold))
                if let number = item.legalDate.documentNumber?.nonEmpty {
                    Text(number).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted).lineLimit(1)
                }
            }
            Text(item.event.displayTitleJA)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(KabuyomiTheme.ink)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(item.legalDate.kind.labelJA)、\(item.legalDate.date)、\(item.event.displayAgencyCode)、\(item.event.displayTitleJA)"
        )
    }
}

/// 行の地と、行のあいだの区切り。系統色は Kabuyomi のものを使う
/// (`systemBackground` のままだと、この面だけ白くて浮く — 2026-08-26)。
private struct TimelineRowBoundaryBackground: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            KabuyomiTheme.paper
            VStack(spacing: 0) {
                Rectangle()
                    .fill(KabuyomiTheme.separatorStrong)
                    .frame(height: KabuyomiTheme.hairlineWidth)
                KabuyomiTheme.canvas
                Rectangle()
                    .fill(KabuyomiTheme.separatorStrong)
                    .frame(height: KabuyomiTheme.hairlineWidth)
            }
            .frame(height: 8)
        }
        .accessibilityHidden(true)
    }
}
