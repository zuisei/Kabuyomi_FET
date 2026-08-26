import SwiftUI

struct TimelineFilterCriteriaSheet: View {
    let selectedFilter: TimelineFilter
    let onSelect: (TimelineFilter) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("最初に表示する「新着」は、直近24時間に公開または更新された公式資料です。")
                        .font(.subheadline)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                    Text("「注目」は公式資料と自動分析の必要項目を基準に自動選定し、閲覧数や株価の上昇・下落は選定に使いません。")
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Section("注目の自動選定条件") {
                    Label("公式資料を取得済み", systemImage: "doc.badge.checkmark")
                    Label("自動分析で「注目」に分類", systemImage: "line.3.horizontal.decrease.circle")
                    Label("日本語タイトル・変更要点・重要性・政策種別が揃っている", systemImage: "checklist")
                    Label("政策分野または対象地域が設定済み", systemImage: "scope")
                    Text("自動生成した分析は「未検証」と明記します。因果関係や投資判断は示しません。")
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Section("表示の基準") {
                    ForEach(TimelineFilter.allCases) { filter in
                        Button {
                            onSelect(filter)
                            dismiss()
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: filter.systemImage)
                                    .foregroundStyle(filter == selectedFilter ? KabuyomiTheme.accent : KabuyomiTheme.inkMuted)
                                    .frame(width: 24, height: 24)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(filter.rawValue)
                                        .font(.headline)
                                        .foregroundStyle(KabuyomiTheme.ink)
                                    Text(filter.explanationJA)
                                        .font(.subheadline)
                                        .foregroundStyle(KabuyomiTheme.inkMuted)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 8)
                                if filter == selectedFilter {
                                    Image(systemName: "checkmark")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(KabuyomiTheme.accent)
                                }
                            }
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("timeline.criteria.\(filter.id)")
                    }
                }

                Section("ウォッチとの違い") {
                    LabeledContent("タイムライン", value: "製品側の分類")
                    LabeledContent("ウォッチ", value: "自分で登録した追跡条件")
                    Text("ウォッチは、機関・政策分野・企業などのいずれかに一致する資料を自分用にまとめる機能です。")
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
            .navigationTitle("表示の基準")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("timeline.criteriaSheet")
    }
}
