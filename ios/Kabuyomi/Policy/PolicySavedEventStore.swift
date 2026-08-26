import Foundation
import SwiftData

@Model
final class EventLocalState {
    @Attribute(.unique) var eventID: String
    var isSaved: Bool
    var lastSeenAt: Date?
    var lastDismissedActivityAt: Date?

    init(
        eventID: String,
        isSaved: Bool = false,
        lastSeenAt: Date? = nil,
        lastDismissedActivityAt: Date? = nil
    ) {
        self.eventID = eventID
        self.isSaved = isSaved
        self.lastSeenAt = lastSeenAt
        self.lastDismissedActivityAt = lastDismissedActivityAt
    }
}

@Model
final class WatchSubscription {
    @Attribute(.unique) var key: String
    init(key: String) { self.key = key }
}

@MainActor
final class SavedEventStore: ObservableObject {
    @Published private(set) var savedIDs: Set<UUID> = []
    @Published private(set) var lastSeenAt: [UUID: Date] = [:]
    @Published private(set) var dismissedAt: [UUID: Date] = [:]
    @Published private(set) var watchKeys: Set<String> = []
    @Published private(set) var recentIDs: [UUID]
    @Published private(set) var recentSearches: [String]
    @Published private(set) var savedSearches: [String]
    @Published private(set) var lastWatchCheckedAt: Date?
    @Published var timezone: TimezonePreference { didSet { defaults.set(timezone.rawValue, forKey: key("timezone")) } }

    private let context: ModelContext
    private let defaults: UserDefaults
    private let prefix: String
    private func key(_ suffix: String) -> String { "\(prefix).\(suffix)" }

    init(modelContext: ModelContext, defaults: UserDefaults = .standard, key: String = "marketDocket") {
        self.context = modelContext
        self.defaults = defaults
        self.prefix = key
        recentIDs = (defaults.stringArray(forKey: "\(key).recent") ?? []).compactMap(UUID.init(uuidString:))
        recentSearches = defaults.stringArray(forKey: "\(key).searches") ?? []
        savedSearches = defaults.stringArray(forKey: "\(key).savedSearches") ?? []
        if let timestamp = defaults.object(forKey: "\(key).watchCheckedAt") as? Double {
            lastWatchCheckedAt = Date(timeIntervalSince1970: timestamp)
        } else {
            lastWatchCheckedAt = nil
        }
        timezone = TimezonePreference(rawValue: defaults.string(forKey: "\(key).timezone") ?? "") ?? .et

        if ProcessInfo.processInfo.arguments.contains("-resetDemoState") { resetPersistentState() }
        migrateLegacyStateIfNeeded()
        refresh()
    }

    func contains(_ id: UUID) -> Bool { savedIDs.contains(id) }
    func toggle(_ id: UUID) {
        let state = state(for: id, create: true)!
        state.isSaved.toggle()
        saveAndRefresh()
    }

    func unreadCount(for event: PolicyEvent) -> Int { unreadCount(id: event.id, lastActivityAt: event.lastActivityAt) }
    func unreadCount(for event: PolicyEventSummary) -> Int { unreadCount(id: event.id, lastActivityAt: event.lastActivityAt) }
    func markRead(_ event: PolicyEvent) { markRead(id: event.id, lastActivityAt: event.lastActivityAt) }
    func markRead(_ event: PolicyEventSummary) { markRead(id: event.id, lastActivityAt: event.lastActivityAt) }
    func markAllRead(_ events: [PolicyEventSummary]) {
        for event in events {
            let state = state(for: event.id, create: true)!
            state.lastSeenAt = max(state.lastSeenAt ?? .distantPast, event.lastActivityAt)
        }
        saveAndRefresh()
    }
    func isDismissed(_ event: PolicyEvent) -> Bool {
        isDismissed(id: event.id, lastActivityAt: event.lastActivityAt)
    }
    func isDismissed(_ event: PolicyEventSummary) -> Bool {
        isDismissed(id: event.id, lastActivityAt: event.lastActivityAt)
    }
    func dismiss(_ event: PolicyEventSummary) {
        let state = state(for: event.id, create: true)!
        state.lastDismissedActivityAt = event.lastActivityAt
        state.lastSeenAt = max(state.lastSeenAt ?? .distantPast, event.lastActivityAt)
        saveAndRefresh()
    }
    func restore(_ event: PolicyEventSummary) {
        state(for: event.id, create: false)?.lastDismissedActivityAt = nil
        saveAndRefresh()
    }

    func recordViewed(_ id: UUID) {
        recentIDs.removeAll { $0 == id }
        recentIDs.insert(id, at: 0)
        recentIDs = Array(recentIDs.prefix(10))
        defaults.set(recentIDs.map(\.uuidString), forKey: key("recent"))
    }
    func clearHistory() { recentIDs = []; defaults.removeObject(forKey: key("recent")) }

    func isWatching(_ key: String) -> Bool { watchKeys.contains(key) }
    func toggleWatch(_ key: String) { setWatch(key, enabled: !watchKeys.contains(key)) }
    func setWatch(_ key: String, enabled: Bool) {
        if enabled, !watchKeys.contains(key) { context.insert(WatchSubscription(key: key)) }
        if !enabled { fetchWatches().filter { $0.key == key }.forEach(context.delete) }
        saveAndRefresh()
    }
    func clearWatch() { fetchWatches().forEach(context.delete); saveAndRefresh() }
    func recordWatchChecked(at date: Date = .now) {
        lastWatchCheckedAt = date
        defaults.set(date.timeIntervalSince1970, forKey: key("watchCheckedAt"))
    }
    func replaceWatchKeys(with keys: Set<String>) {
        let existing = Dictionary(uniqueKeysWithValues: fetchWatches().map { ($0.key, $0) })
        for (key, subscription) in existing where !keys.contains(key) {
            context.delete(subscription)
        }
        for key in keys where existing[key] == nil {
            context.insert(WatchSubscription(key: key))
        }
        saveAndRefresh()
    }
    func watches(_ event: PolicyEvent) -> Bool {
        watches(
            agency: event.agency.code,
            topics: event.topics,
            tickers: event.tickers,
            domain: event.policyDomain?.slug,
            instrument: event.instrumentType?.rawValue,
            regions: event.productAnalysis.affectedRegionCodes,
            tier: event.productAnalysis.presentationTier
        ) || watchedQueries.contains { PolicyEventSearch.matches(event, query: $0) }
    }
    func watches(_ event: PolicyEventSummary) -> Bool {
        watches(
            agency: event.agency.code,
            topics: event.topics,
            tickers: event.tickers,
            domain: event.domain?.slug,
            instrument: event.instrumentType?.rawValue,
            regions: event.productAnalysis.affectedRegionCodes,
            tier: event.productAnalysis.presentationTier
        ) || watchedQueries.contains { PolicyEventSearch.matches(event, query: $0) }
    }
    var watchedQueries: [String] {
        watchKeys.compactMap { key in
            guard key.hasPrefix("query:") else { return nil }
            return String(key.dropFirst("query:".count))
        }.sorted()
    }
    func isQueryWatched(_ query: String) -> Bool {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return !value.isEmpty && watchedQueryKey(matching: value) != nil
    }
    func toggleWatchedQuery(_ query: String) {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        if let existing = watchedQueryKey(matching: value) {
            setWatch(existing, enabled: false)
        } else {
            setWatch("query:\(value)", enabled: true)
        }
    }

    func addSearch(_ query: String) {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        recentSearches.removeAll { $0.localizedCaseInsensitiveCompare(value) == .orderedSame }
        recentSearches.insert(value, at: 0)
        recentSearches = Array(recentSearches.prefix(5))
        defaults.set(recentSearches, forKey: key("searches"))
    }
    func clearSearches() { recentSearches = []; defaults.removeObject(forKey: key("searches")) }

    func isSearchSaved(_ query: String) -> Bool {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return savedSearches.contains { $0.localizedCaseInsensitiveCompare(value) == .orderedSame }
    }

    func toggleSavedSearch(_ query: String) {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        if let index = savedSearches.firstIndex(where: { $0.localizedCaseInsensitiveCompare(value) == .orderedSame }) {
            savedSearches.remove(at: index)
        } else {
            savedSearches.insert(value, at: 0)
            savedSearches = Array(savedSearches.prefix(20))
        }
        defaults.set(savedSearches, forKey: key("savedSearches"))
    }

    func clearSavedSearches() {
        savedSearches = []
        defaults.removeObject(forKey: key("savedSearches"))
    }

    private func unreadCount(id: UUID, lastActivityAt: Date) -> Int {
        guard let seen = self.lastSeenAt[id] else { return 1 }
        return lastActivityAt > seen ? 1 : 0
    }

    private func watchedQueryKey(matching query: String) -> String? {
        watchKeys.first { key in
            guard key.hasPrefix("query:") else { return false }
            let value = String(key.dropFirst("query:".count))
            return value.localizedCaseInsensitiveCompare(query) == .orderedSame
        }
    }

    private func isDismissed(id: UUID, lastActivityAt: Date) -> Bool {
        guard let dismissedActivity = dismissedAt[id] else { return false }
        return dismissedActivity >= lastActivityAt
    }

    private func markRead(id: UUID, lastActivityAt: Date) {
        let state = state(for: id, create: true)!
        state.lastSeenAt = max(state.lastSeenAt ?? .distantPast, lastActivityAt)
        saveAndRefresh()
    }

    private func watches(agency: String, topics: [String], tickers: [String], domain: String?, instrument: String?, regions: [String], tier: PresentationTier) -> Bool {
        watchKeys.contains("agency:\(agency)")
            || topics.contains { watchKeys.contains("topic:\($0)") }
            || tickers.contains { watchKeys.contains("ticker:\($0)") }
            || domain.map { watchKeys.contains("domain:\($0)") } == true
            || instrument.map { watchKeys.contains("instrument:\($0)") } == true
            || regions.contains { watchKeys.contains("region:\($0)") }
            || watchKeys.contains("tier:\(tier.rawValue)")
    }

    private func state(for id: UUID, create: Bool) -> EventLocalState? {
        let value = id.uuidString
        let descriptor = FetchDescriptor<EventLocalState>(predicate: #Predicate { $0.eventID == value })
        if let existing = try? context.fetch(descriptor).first { return existing }
        guard create else { return nil }
        let state = EventLocalState(eventID: value)
        context.insert(state)
        return state
    }

    private func fetchStates() -> [EventLocalState] { (try? context.fetch(FetchDescriptor<EventLocalState>())) ?? [] }
    private func fetchWatches() -> [WatchSubscription] { (try? context.fetch(FetchDescriptor<WatchSubscription>())) ?? [] }

    private func refresh() {
        let states = fetchStates()
        savedIDs = Set(states.filter(\.isSaved).compactMap { UUID(uuidString: $0.eventID) })
        lastSeenAt = Dictionary(uniqueKeysWithValues: states.compactMap { state in
            guard let id = UUID(uuidString: state.eventID), let date = state.lastSeenAt else { return nil }
            return (id, date)
        })
        dismissedAt = Dictionary(uniqueKeysWithValues: states.compactMap { state in
            guard let id = UUID(uuidString: state.eventID),
                  let date = state.lastDismissedActivityAt else { return nil }
            return (id, date)
        })
        watchKeys = Set(fetchWatches().map(\.key))
    }

    private func saveAndRefresh() { try? context.save(); refresh() }

    private func migrateLegacyStateIfNeeded() {
        guard fetchStates().isEmpty, fetchWatches().isEmpty else { return }
        for value in defaults.stringArray(forKey: key("saved")) ?? [] {
            if let id = UUID(uuidString: value) { state(for: id, create: true)?.isSaved = true }
        }
        for value in defaults.stringArray(forKey: key("read")) ?? [] {
            if let id = UUID(uuidString: value) { state(for: id, create: true)?.lastSeenAt = .now }
        }
        for value in defaults.stringArray(forKey: key("watch")) ?? [] { context.insert(WatchSubscription(key: value)) }
        try? context.save()
    }

    private func resetPersistentState() {
        fetchStates().forEach(context.delete)
        fetchWatches().forEach(context.delete)
        ["saved", "read", "watch", "recent", "searches", "savedSearches", "timezone", "watchCheckedAt"].forEach { defaults.removeObject(forKey: key($0)) }
        try? context.save()
        recentIDs = []
        recentSearches = []
        savedSearches = []
        lastWatchCheckedAt = nil
    }
}
