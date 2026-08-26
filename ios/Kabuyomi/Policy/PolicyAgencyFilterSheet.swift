import SwiftUI

struct AgencyFilterOption: Identifiable, Hashable {
    let code: String
    let nameJA: String

    var id: String { code }

    init(agency: Agency) {
        code = agency.code
        nameJA = AgencyJapaneseName.resolve(agency)
    }

    static func options(from events: [PolicyEventSummary]) -> [AgencyFilterOption] {
        var agenciesByCode: [String: Agency] = [:]
        for agency in events.map(\.agency) {
            agenciesByCode[agency.code] = agenciesByCode[agency.code] ?? agency
        }
        return agenciesByCode.values.map(AgencyFilterOption.init).sorted {
            $0.code.localizedCaseInsensitiveCompare($1.code) == .orderedAscending
        }
    }

    func matches(_ query: String) -> Bool {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return true }
        return code.localizedCaseInsensitiveContains(value) || nameJA.localizedCaseInsensitiveContains(value)
    }

    var alphabeticalKey: String {
        let first = String(code.uppercased().prefix(1))
        return first.rangeOfCharacter(from: .letters) == nil ? "#" : first
    }
}

enum AgencyFilterSummary {
    static func title(for selectedCodes: Set<String>) -> String {
        switch selectedCodes.count {
        case 0: "機関"
        case 1: selectedCodes.first ?? "機関"
        default: "\(selectedCodes.count)機関"
        }
    }
}

enum AgencyJapaneseName {
    private static let names: [String: String] = [
        "BIS": "米国商務省産業安全保障局",
        "CFTC": "米国商品先物取引委員会",
        "CNCS": "米国国家・地域社会奉仕公社",
        "COCR": "米国公民権委員会",
        "CPSC": "米国消費者製品安全委員会",
        "DHS": "米国国土安全保障省",
        "DHUD": "米国住宅都市開発省",
        "DI": "米国内務省",
        "DOC": "米国商務省",
        "DOD": "米国国防総省",
        "DOE": "米国エネルギー省",
        "DOJ": "米国司法省",
        "DOT": "米国運輸省",
        "DRBC": "デラウェア川流域委員会",
        "DS": "米国国務省",
        "DVA": "米国退役軍人省",
        "EEOC": "米国雇用機会均等委員会",
        "EOP": "米国大統領府",
        "EPA": "米国環境保護庁",
        "FCC": "米国連邦通信委員会",
        "FDIC": "米国連邦預金保険公社",
        "FMC": "米国連邦海事委員会",
        "FRS": "米国連邦準備制度理事会",
        "FTC": "米国連邦取引委員会",
        "HHS": "米国保健福祉省",
        "ITC": "米国国際貿易委員会",
        "NASA": "米国航空宇宙局",
        "NCOD": "米国障害者評議会",
        "NCOFN": "米国海軍の将来に関する国家委員会",
        "NRC": "米国原子力規制委員会",
        "NSF": "米国国立科学財団",
        "PBGC": "米国年金給付保証公社",
        "PRC": "米国郵便規制委員会",
        "PS": "米国郵便公社",
        "RRB": "米国鉄道退職委員会",
        "SBA": "米国中小企業庁",
        "SEC": "米国証券取引委員会",
        "STB": "米国陸上運輸委員会",
        "TREAS": "米国財務省",
        "TVA": "テネシー川流域開発公社",
        "UCRP": "統一運送業者登録制度計画",
        "USDA": "米国農務省",
        "USTR": "米国通商代表部",
        "WH": "ホワイトハウス"
    ]

    static func resolve(_ agency: Agency) -> String {
        if let name = names[agency.code] { return name }
        let candidate = agency.displayNameJA.trimmingCharacters(in: .whitespacesAndNewlines)
        return candidate.isEmpty || candidate == agency.code ? agency.displayNameEN : candidate
    }
}

struct AgencyFilterSheet: View {
    let agencies: [AgencyFilterOption]
    let initialSelection: Set<String>
    let onApply: (Set<String>) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var draftSelection: Set<String>

    private static let frequentCodes = ["WH", "EOP", "USTR", "SEC", "CFTC", "BIS"]

    init(agencies: [AgencyFilterOption], initialSelection: Set<String>, onApply: @escaping (Set<String>) -> Void) {
        self.agencies = agencies
        self.initialSelection = initialSelection
        self.onApply = onApply
        _draftSelection = State(initialValue: initialSelection)
    }

    private var selectedAgencies: [AgencyFilterOption] {
        agencies.filter { draftSelection.contains($0.code) }
    }

    private var frequentAgencies: [AgencyFilterOption] {
        Self.frequentCodes.compactMap { code in agencies.first { $0.code == code } }
            .filter { !draftSelection.contains($0.code) }
    }

    private var searchResults: [AgencyFilterOption] {
        agencies.filter { $0.matches(query) }
    }

    private var alphabeticalGroups: [(key: String, values: [AgencyFilterOption])] {
        Dictionary(grouping: agencies, by: \.alphabeticalKey)
            .map { (key: $0.key, values: $0.value.sorted { $0.code < $1.code }) }
            .sorted { $0.key < $1.key }
    }

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            List {
                selectedSection
                if isSearching {
                    searchSection
                } else {
                    if !frequentAgencies.isEmpty {
                        Section("よく使う機関") {
                            ForEach(frequentAgencies) { agencyRow($0, context: "frequent") }
                        }
                    }
                    ForEach(alphabeticalGroups, id: \.key) { group in
                        Section(group.key) {
                            ForEach(group.values) { agencyRow($0, context: "all") }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "略称または日本語正式名")
            .navigationTitle("機関を選択")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
        }
        .onAppear {
            draftSelection = initialSelection
            query = ""
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("agencyFilter.sheet")
    }

    @ViewBuilder private var selectedSection: some View {
        Section("選択済み") {
            if selectedAgencies.isEmpty {
                Text("選択されていません")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(selectedAgencies) { agencyRow($0, context: "selected") }
            }
        }
    }

    @ViewBuilder private var searchSection: some View {
        Section("検索結果") {
            if searchResults.isEmpty {
                Text("該当する機関はありません")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(searchResults) { agencyRow($0, context: "search") }
            }
        }
    }

    private func agencyRow(_ option: AgencyFilterOption, context: String) -> some View {
        Button {
            if draftSelection.contains(option.code) {
                draftSelection.remove(option.code)
            } else {
                draftSelection.insert(option.code)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: draftSelection.contains(option.code) ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(draftSelection.contains(option.code) ? Color.accentColor : Color.secondary)
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.code)
                        .font(.headline.monospaced())
                        .foregroundStyle(.primary)
                    Text(option.nameJA)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("agencyFilter.\(context).\(option.code)")
        .accessibilityLabel("\(option.code)、\(option.nameJA)")
        .accessibilityValue(draftSelection.contains(option.code) ? "選択済み" : "未選択")
    }

    private var actionBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 12) {
                Button { draftSelection.removeAll() } label: {
                    Text("すべて解除").frame(maxWidth: .infinity)
                }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("agencyFilter.clear")
                Button {
                    onApply(draftSelection)
                    dismiss()
                } label: {
                    Text("適用").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("agencyFilter.apply")
            }
            .controlSize(.large)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(.bar)
    }
}
