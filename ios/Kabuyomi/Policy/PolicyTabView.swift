import SwiftData
import SwiftUI

/// 政策タブの持ち物。MarketDocket 側では App 本体(`MarketDocketApp`)が
/// SwiftData のコンテナを**1回だけ**作って全画面に配っていた。
/// Kabuyomi の App 本体は Core Data を持っていて別物なので、
/// 政策まわりはこのタブの中だけで完結させる(2026-08-26 の移植)。
///
/// **コンテナは View の init で作らない。** SwiftUI は View の struct を
/// 何度でも作り直すので、init で作ると毎回別のコンテナができ、
/// `@StateObject` が掴んでいる最初の1つだけが生き残る。捨てられたコンテナの
/// context へ書き込んだ瞬間に SwiftData がトラップする — 実際、政策の1件を
/// 開くと `SavedEventStore.markRead` で落ちていた(2026-08-26 実機報告)。
/// プロセスに1つだけ持つ。
@MainActor
enum PolicyStorage {
    static let container: ModelContainer = {
        if let container = try? ModelContainer(for: EventLocalState.self, WatchSubscription.self) {
            return container
        }
        // ディスク上に置けないときはメモリ上の箱で立ち上げる。保存や既読は
        // 残らないが、**一覧が読めなくなるよりはいい**。ここも失敗したら、
        // 政策タブは持ち物を持てないので落ちるより前に諦める。
        return try! ModelContainer(
            for: EventLocalState.self, WatchSubscription.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
    }()

    static let savedStore = SavedEventStore(modelContext: container.mainContext)
}

struct PolicyTabView: View {
    @StateObject private var eventStore = EventDataStore()

    var body: some View {
        TimelineView(
            events: eventStore.summaries,
            loadError: eventStore.errorMessage != nil,
            isLoading: eventStore.isLoading,
            hasMore: eventStore.hasMoreSummaries,
            refresh: { await eventStore.loadSummaries() },
            loadMore: { await eventStore.loadMoreSummaries() }
        )
        .environmentObject(eventStore)
        .environmentObject(PolicyStorage.savedStore)
        // 配るのは `PolicyStorage` の1つだけ。`modelContainer(for:)` を足すと
        // SwiftUI がもう1つ作り、ストアの context と食い違う。
        .modelContainer(PolicyStorage.container)
        .task {
            if eventStore.summaries.isEmpty { await eventStore.loadSummaries() }
        }
        .accessibilityIdentifier("policy.tab")
    }
}
