import SwiftUI

enum AppColors {
    static let official = KabuyomiTheme.accent
    static let detection = Color.teal
    static let report = Color.purple
    static let revision = Color.orange
    static let market = KabuyomiTheme.negative
    static let selected = KabuyomiTheme.ink
    static let unreached = KabuyomiTheme.inkMuted.opacity(0.25)
    static func color(for kind: TimelineItemKind) -> Color {
        switch kind { case .officialPublication, .officialStatement: official; case .systemDetection: detection; case .mediaReport: report; case .documentRevision: revision; case .marketReaction: market; case .correction: .secondary }
    }
}

struct DemoBadge: View {
    var body: some View {
        Label("デモ環境・ローカルデータ", systemImage: "testtube.2")
            .font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
            .accessibilityLabel("架空のデモ環境、ローカルデータ")
    }
}
struct SectionHeading: View { let title: String; var body: some View { Text(title).font(.headline).frame(maxWidth: .infinity, alignment: .leading) } }
struct StatusBadge: View {
    let text, systemImage: String; let tint: Color
    var body: some View { Label(text, systemImage: systemImage).font(.caption.weight(.semibold)).foregroundStyle(tint) }
}
struct MetricRow: View {
    let label, value: String
    var body: some View {
        HStack(alignment: .firstTextBaseline) { Text(label).foregroundStyle(KabuyomiTheme.inkMuted); Spacer(minLength: 12); Text(value).fontWeight(.medium).multilineTextAlignment(.trailing).monospacedDigit() }
            .font(.subheadline).accessibilityElement(children: .combine)
    }
}

struct CompactEventRow: View {
    let event: PolicyEventSummary
    var body: some View { CompactPolicyRow(event: event) }
}
