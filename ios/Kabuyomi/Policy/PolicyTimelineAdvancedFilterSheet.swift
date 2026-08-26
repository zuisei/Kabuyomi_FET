import SwiftUI

struct TimelineAdvancedFilters: Equatable {
    var tier: PresentationTier?
    var domain: String?
    var instrument: PolicyInstrumentType?
    var verification: EventVerificationState?
    var ticker: String?
    var recentDays: Int?
    var unreadOnly = false
    var newOnly = false

    var isActive: Bool {
        tier != nil || domain != nil || instrument != nil || verification != nil
            || ticker != nil || recentDays != nil || unreadOnly || newOnly
    }

    var activeCount: Int {
        [tier != nil, domain != nil, instrument != nil, verification != nil,
         ticker != nil, recentDays != nil, unreadOnly, newOnly]
            .filter { $0 }.count
    }
}

struct TimelineAdvancedFilterSheet: View {
    let events: [PolicyEventSummary]
    let initialSelection: TimelineAdvancedFilters
    let onApply: (TimelineAdvancedFilters) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: TimelineAdvancedFilters

    init(
        events: [PolicyEventSummary],
        initialSelection: TimelineAdvancedFilters,
        onApply: @escaping (TimelineAdvancedFilters) -> Void
    ) {
        self.events = events
        self.initialSelection = initialSelection
        self.onApply = onApply
        _draft = State(initialValue: initialSelection)
    }

    private var domains: [PolicyDomainReference] {
        Array(Set(events.compactMap(\.domain))).sorted { $0.labelJA < $1.labelJA }
    }

    private var instruments: [PolicyInstrumentType] {
        PolicyInstrumentType.allCases.sorted { $0.labelJA < $1.labelJA }
    }

    private var tickers: [String] {
        Array(Set(events.flatMap(\.tickers))).sorted()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("分類") {
                    Picker("表示区分", selection: $draft.tier) {
                        Text("すべて").tag(PresentationTier?.none)
                        ForEach(PresentationTier.allCases, id: \.self) { tier in
                            Text(tier.labelJA).tag(Optional(tier))
                        }
                    }
                    Picker("政策分野", selection: $draft.domain) {
                        Text("すべて").tag(String?.none)
                        ForEach(domains, id: \.slug) { domain in
                            Text(domain.labelJA).tag(Optional(domain.slug))
                        }
                    }
                    NavigationLink {
                        PolicyInstrumentSelectionView(options: instruments, selection: $draft.instrument)
                    } label: {
                        LabeledContent("政策手段", value: draft.instrument?.labelJA ?? "すべて")
                    }
                    .accessibilityIdentifier("timelineFilters.instrument")
                    Picker("銘柄", selection: $draft.ticker) {
                        Text("すべて").tag(String?.none)
                        ForEach(tickers, id: \.self) { ticker in
                            Text(ticker).tag(Optional(ticker))
                        }
                    }
                }

                Section("確認状態") {
                    Picker("検証状態", selection: $draft.verification) {
                        Text("すべて").tag(EventVerificationState?.none)
                        Text("公式ソース確認済み").tag(Optional(EventVerificationState.sourceVerified))
                        Text("分析検証済み").tag(Optional(EventVerificationState.analystVerified))
                    }
                    Toggle("未読のみ", isOn: $draft.unreadOnly)
                    Toggle("新規のみ", isOn: $draft.newOnly)
                }

                Section("期間") {
                    Picker("対象期間", selection: $draft.recentDays) {
                        Text("全期間").tag(Int?.none)
                        Text("直近7日").tag(Optional(7))
                        Text("直近30日").tag(Optional(30))
                    }
                }
            }
            .navigationTitle("詳細フィルター")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
        }
        .onAppear { draft = initialSelection }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("timelineFilters.sheet")
    }

    private var actionBar: some View {
        VStack(spacing: 0) {
            KabuyomiHairline(color: KabuyomiTheme.separatorStrong)
            HStack(spacing: 12) {
                Button { draft = TimelineAdvancedFilters() } label: {
                    Text("すべて解除").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("timelineFilters.clear")
                Button {
                    onApply(draft)
                    dismiss()
                } label: {
                    Text("適用").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("timelineFilters.apply")
            }
            .controlSize(.large)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(.bar)
    }
}

private struct PolicyInstrumentSelectionView: View {
    let options: [PolicyInstrumentType]
    @Binding var selection: PolicyInstrumentType?
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var visibleOptions: [PolicyInstrumentType] {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return options }
        return options.filter { $0.labelJA.localizedCaseInsensitiveContains(value) }
    }

    var body: some View {
        List {
            Button {
                selection = nil
                dismiss()
            } label: {
                optionRow(title: "すべての政策手段", selected: selection == nil)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("instrumentFilter.all")

            ForEach(visibleOptions, id: \.self) { option in
                Button {
                    selection = option
                    dismiss()
                } label: {
                    optionRow(title: option.labelJA, selected: selection == option)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("instrumentFilter.\(option.rawValue)")
            }
        }
        .listStyle(.plain)
        .searchable(text: $query, prompt: "政策手段を検索")
        .navigationTitle("政策手段")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("instrumentFilter.list")
    }

    private func optionRow(title: String, selected: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(selected ? KabuyomiTheme.accent : KabuyomiTheme.inkMuted)
                .font(.title3)
            Text(title)
                .foregroundStyle(KabuyomiTheme.ink)
            Spacer()
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}
