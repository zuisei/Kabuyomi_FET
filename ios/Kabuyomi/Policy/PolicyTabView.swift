import SwiftData
import SwiftUI

/// 政策タブの入口。MarketDocket 側では App 本体(`MarketDocketApp`)が
/// SwiftData のコンテナと2つのストアを作って全画面に配っていた。
/// Kabuyomi の App 本体は Core Data を持っていて別物なので、
/// **政策まわりの持ち物はこのタブの中だけで完結させる**(2026-08-26 の移植)。
/// 中身が要らなくなったら、このファイルとタブの1行を消せば全部消える。
struct PolicyTabView: View {
    @StateObject private var eventStore = EventDataStore()
    @StateObject private var savedStore: SavedEventStore
    private let modelContainer: ModelContainer?

    init() {
        let container = try? ModelContainer(for: EventLocalState.self, WatchSubscription.self)
        modelContainer = container
        // コンテナを作れないときはメモリ上だけの箱で立ち上げる。
        // 保存や既読は残らないが、**一覧が読めなくなるよりはいい**。
        let context = container?.mainContext
            ?? ModelContext(
                try! ModelContainer(
                    for: EventLocalState.self, WatchSubscription.self,
                    configurations: ModelConfiguration(isStoredInMemoryOnly: true)
                )
            )
        _savedStore = StateObject(wrappedValue: SavedEventStore(modelContext: context))
    }

    var body: some View {
        TimelineView(
            events: eventStore.summaries,
            loadError: eventStore.errorMessage != nil,
            isLoading: eventStore.isLoading,
            refresh: { await eventStore.loadSummaries() }
        )
        .environmentObject(eventStore)
        .environmentObject(savedStore)
        .modelContainer(for: [EventLocalState.self, WatchSubscription.self])
        .task {
            if eventStore.summaries.isEmpty { await eventStore.loadSummaries() }
        }
        .accessibilityIdentifier("policy.tab")
    }
}
