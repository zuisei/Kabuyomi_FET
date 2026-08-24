import SwiftUI

// v2「terminal-grade dark editorial」の共通プリミティブ。
// 編集的な読み順(要約→数値→根拠→対話)はそのままに、
// 金融端末の密度と数字の格を与えるための部品をここに集める。

// MARK: - 上げ下げバッジ

/// 増減の表示。色だけに意味を持たせないため、必ず矢印と符号を併記する。
struct RedesignDeltaBadge: View {
    let display: MetricYoYDisplay
    var compact: Bool = false

    private var symbolName: String {
        switch display.direction {
        case .positive:
            return "arrow.up.right"
        case .negative:
            return "arrow.down.right"
        case .none:
            return "minus"
        }
    }

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: symbolName)
                .font(.caption2.weight(.bold))
                .accessibilityHidden(true)
            Text(display.text)
                .font(compact ? .caption2.weight(.semibold) : .caption.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .foregroundStyle(display.tint)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("前年同期比 \(display.text)")
    }
}

// MARK: - 密な数値セル

/// 主要数値グリッドの1マス。
/// マイクロラベル / 大きく細い tabular な値 / 矢印付きの増減 の3段を詰め、
/// ミニ推移バーはセル右に置く。Dynamic Type 拡大時は縦積みへ逃がし、
/// 数字を縮小して潰すことはしない。
struct RedesignMetricCell: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let label: String
    let value: String
    var delta: MetricYoYDisplay?
    var caption: String?
    var history: [Double] = []
    let accessibilityText: String

    private var isAccessibilitySize: Bool { dynamicTypeSize.isAccessibilitySize }

    private var showsSparkline: Bool {
        history.count >= 2 && !isAccessibilitySize
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .kabuyomiMicroLabel()
                .lineLimit(isAccessibilitySize ? nil : 1)

            if isAccessibilitySize {
                // 拡大時は値と推移バーを横に並べない。桁を縮めるより縦に伸ばす。
                // ミニ推移バーは装飾(VoiceOver からも隠している)なので、
                // 場所を数字に譲って出さない。
                valueText
            } else {
                HStack(alignment: .bottom, spacing: 8) {
                    valueText
                    Spacer(minLength: 4)
                    if showsSparkline {
                        RedesignSparkline(values: history, isPositive: (delta?.direction ?? .none) != .negative)
                            .frame(width: 34, height: 16)
                    }
                }
            }

            if let delta {
                RedesignDeltaBadge(display: delta)
            } else if let caption {
                Text(caption)
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .lineLimit(isAccessibilitySize ? nil : 1)
            }
        }
        .padding(.top, 9)
        .padding(.bottom, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { KabuyomiHairline() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var valueText: some View {
        Text(value)
            .font(KabuyomiTheme.figure(.title2, weight: .regular))
            .foregroundStyle(KabuyomiTheme.ink)
            // 拡大時に 75% へ縮める逃げ方は「数字を潰さない」に反する。
            // 折り返して縦に伸ばす。
            .lineLimit(isAccessibilitySize ? nil : 1)
            .minimumScaleFactor(isAccessibilitySize ? 1 : 0.7)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// 罫線区切りの密な数値グリッド。拡大時は1列へ落とす。
struct RedesignMetricGrid<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ViewBuilder var content: () -> Content

    private var columns: [GridItem] {
        dynamicTypeSize.isAccessibilitySize
            ? [GridItem(.flexible(), spacing: 0)]
            : [GridItem(.adaptive(minimum: 138), spacing: 18)]
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 0, content: content)
    }
}

// MARK: - セクション見出し

/// 折りたたみ可能なセクション見出し。
/// `isExpanded` を渡さない場合は開閉しない見出しとして描く。
/// Reduce Motion では開閉アニメーションを即時切替にする。
struct RedesignSectionHeader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let title: String
    var subtitle: String?
    var trailing: String?
    var isExpanded: Binding<Bool>?
    var identifier: String?
    /// 回答本文の中で使うときは罫線を引かない。
    /// 読み物の途中に全幅の罫が入ると、回答が設問フォームのように区切られて見える。
    var showsRule: Bool

    init(
        title: String,
        subtitle: String? = nil,
        trailing: String? = nil,
        isExpanded: Binding<Bool>? = nil,
        identifier: String? = nil,
        showsRule: Bool = true
    ) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing
        self.isExpanded = isExpanded
        self.identifier = identifier
        self.showsRule = showsRule
    }

    var body: some View {
        Group {
            if let isExpanded {
                Button {
                    if reduceMotion {
                        isExpanded.wrappedValue.toggle()
                    } else {
                        withAnimation(.easeInOut(duration: 0.18)) { isExpanded.wrappedValue.toggle() }
                    }
                } label: {
                    labelContent(chevron: isExpanded.wrappedValue ? "chevron.up" : "chevron.down")
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(identifier ?? "redesign.section.\(title)")
                .accessibilityLabel(isExpanded.wrappedValue ? "\(title)を閉じる" : "\(title)を開く")
            } else {
                labelContent(chevron: nil)
                    .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private func labelContent(chevron: String?) -> some View {
        let titleStack = VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.footnote.weight(.bold))
                .tracking(KabuyomiTheme.microLabelTracking)
                .foregroundStyle(KabuyomiTheme.ink)
            if let subtitle {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        VStack(alignment: .leading, spacing: 6) {
            if dynamicTypeSize.isAccessibilitySize {
                titleStack
                HStack(spacing: 8) {
                    if let trailing {
                        Text(trailing)
                            .font(.caption2.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                    if let chevron {
                        Image(systemName: chevron)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.accent)
                    }
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    titleStack
                    Spacer(minLength: 8)
                    if let trailing {
                        Text(trailing)
                            .font(.caption2.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                    if let chevron {
                        Image(systemName: chevron)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(KabuyomiTheme.accent)
                    }
                }
            }
            if showsRule {
                KabuyomiHairline(color: KabuyomiTheme.separatorStrong)
            }
        }
        .frame(maxWidth: .infinity, minHeight: showsRule ? 34 : 22, alignment: .leading)
        .contentShape(Rectangle())
    }
}

// MARK: - 根拠チップ

/// ラベル + セクション種別バッジ + 決定論的な抜粋断片で1行ずつ区別できる根拠チップ。
struct RedesignSourceChip: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let descriptor: SourceChipDescriptor
    var showsChevron: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 9) {
                badge
                VStack(alignment: .leading, spacing: 2) {
                    Text(descriptor.label)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .multilineTextAlignment(.leading)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    if let fragment = descriptor.fragment {
                        Text(fragment)
                            .font(.caption2)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .multilineTextAlignment(.leading)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    }
                }
                Spacer(minLength: 4)
                if showsChevron {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .padding(.top, 2)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(descriptor.accessibilityText)
    }

    private var badge: some View {
        RedesignSourceBadge(text: descriptor.badge, ordinal: descriptor.ordinal)
            .padding(.top, 1)
    }
}

/// 根拠チップの横並び版。回答ごとに全文断片つきの縦積みが繰り返されると、
/// どのカードも下半分が同じ灰色の帯になる(2026-08-24 オーナー指摘)。
/// 一覧ではバッジ+ラベルの1行に畳み、断片は開いた先(引用詳細)に任せる。
struct RedesignCompactSourceChips: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let descriptors: [SourceChipDescriptor]
    let open: (SourceChipDescriptor) -> Void

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(descriptors) { descriptor in chip(descriptor) }
            }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(descriptors) { descriptor in chip(descriptor) }
                }
            }
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        }
    }

    private func chip(_ descriptor: SourceChipDescriptor) -> some View {
        Button {
            open(descriptor)
        } label: {
            HStack(spacing: 6) {
                Text(descriptor.badge + (descriptor.ordinal.map { " \($0)" } ?? ""))
                    .font(.system(size: 10, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(KabuyomiTheme.accent)
                Text(descriptor.label)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineLimit(1)
            }
            .padding(.horizontal, 9)
            .frame(minHeight: 30)
            .background(KabuyomiTheme.inputWell, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(descriptor.accessibilityText)
        .accessibilityIdentifier("redesign.citation.\(descriptor.id)")
    }
}

/// セクション種別バッジ。根拠チップと引用詳細の見出しで同じ形を使い、
/// 一覧で見た行と開いた画面が同じものだと分かるようにする。
struct RedesignSourceBadge: View {
    let text: String
    var ordinal: Int?

    var body: some View {
        VStack(spacing: 1) {
            Text(text)
                .font(.system(size: 10, weight: .bold))
                .tracking(0.6)
            if let ordinal {
                Text("\(ordinal)")
                    .font(.system(size: 9, weight: .bold))
                    .monospacedDigit()
            }
        }
        .foregroundStyle(KabuyomiTheme.accent)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(KabuyomiTheme.accentMist, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .stroke(KabuyomiTheme.accent.opacity(0.28), lineWidth: KabuyomiTheme.hairlineWidth)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - 折りたたみ会社ヘッダ

/// スクロール位置を親へ返すための報告口。
/// 会社ワークスペースは「資料」と「会話」の2面が横に並ぶので、
/// どちらの面の位置かを id で分けて返す。親は表示中の面の値だけを見る。
struct RedesignScrollOffsetKey: PreferenceKey {
    static let defaultValue: [String: CGFloat] = [:]

    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue()) { _, latest in latest }
    }
}

extension View {
    /// `.coordinateSpace(name: space)` を付けたスクロールビューの中身に付ける。
    func redesignScrollOffsetReader(id: String, in space: String) -> some View {
        background(
            GeometryReader { proxy in
                Color.clear
                    .preference(
                        key: RedesignScrollOffsetKey.self,
                        value: [id: -proxy.frame(in: .named(space)).minY]
                    )
            }
            .accessibilityHidden(true)
        )
    }
}

/// ヘッダを畳むかどうか。境目でちらつかないよう、畳む閾値と戻す閾値をずらす。
func redesignHeaderCollapsed(
    current: Bool,
    offset: CGFloat,
    collapseAt: CGFloat = 28,
    expandAt: CGFloat = 8
) -> Bool {
    current ? offset > expandAt : offset > collapseAt
}

/// 会社ヘッダの容れ物。
/// 展開時は会社名・書類種別・日付・資料への導線をそのまま出し、
/// 収束時は1行のコンパクトバー(会社名 / 書類種別 / 提出日 + 資料件数)に畳む。
/// 状態行(保存済み資料表示中・前の資料に基づく会話)は畳まれる領域の外に置き、
/// 収束しても消えないようにする。
struct RedesignCollapsingCompanyHeader<Expanded: View, Pinned: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let companyName: String
    let formType: String
    let filedAt: String
    let sourceCount: Int
    let isCollapsed: Bool
    let openSources: () -> Void
    @ViewBuilder var expanded: () -> Expanded
    @ViewBuilder var pinned: () -> Pinned

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if isCollapsed {
                    compactBar
                } else {
                    expanded()
                }
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: isCollapsed)

            pinned()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { KabuyomiHairline() }
        .accessibilityElement(children: .contain)
    }

    private var compactBar: some View {
        Button(action: openSources) {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 3) {
                        compactIdentity
                        compactSourceCount
                    }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        compactIdentity
                        Spacer(minLength: 8)
                        compactSourceCount
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(companyName)、\(formType)、\(filedAt)。資料と根拠 \(sourceCount)件を開く")
        .accessibilityIdentifier("redesign.company.compactHeader")
    }

    @ViewBuilder
    private var compactIdentity: some View {
        let name = Text(companyName)
            .font(.footnote.weight(.bold))
            .foregroundStyle(KabuyomiTheme.ink)
        let form = Text(formType)
            .font(.caption2.weight(.bold))
            .tracking(0.5)
            .foregroundStyle(KabuyomiTheme.accent)
        let filed = Text(filedAt)
            .font(.caption2)
            .monospacedDigit()
            .foregroundStyle(KabuyomiTheme.inkMuted)

        if dynamicTypeSize.isAccessibilitySize {
            // 1行に押し込むと提出日が省略記号に化ける。畳んだバーでも日付は落とさない。
            VStack(alignment: .leading, spacing: 2) {
                name.fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 7) {
                    form
                    filed
                }
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                name.lineLimit(1)
                form
                filed.lineLimit(1)
            }
        }
    }

    private var compactSourceCount: some View {
        HStack(spacing: 3) {
            Text("根拠 \(sourceCount)")
                .font(.caption2.weight(.semibold))
                .monospacedDigit()
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .bold))
        }
        .foregroundStyle(KabuyomiTheme.accent)
        .accessibilityHidden(true)
    }
}

#if DEBUG

private let previewDescriptors: [SourceChipDescriptor] = [
    SourceChipDescriptor(
        key: "a",
        label: "利益率",
        badge: "MD&A",
        fragment: "Gross margin increased to 46.6% driven by a favorable mix",
        ordinal: nil,
        source: nil
    ),
    SourceChipDescriptor(
        key: "b",
        label: "利益率",
        badge: "XBRL",
        fragment: "Operating income 28,300 vs 24,100",
        ordinal: nil,
        source: nil
    ),
    SourceChipDescriptor(
        key: "c",
        label: "利益率",
        badge: "履歴",
        fragment: nil,
        ordinal: 1,
        source: nil
    )
]

private struct PrimitivePreviewBoard: View {
    @State private var isExpanded = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                RedesignSectionHeader(
                    title: "主要数値",
                    subtitle: "10-Q ・ 2026年3月28日",
                    trailing: "4件",
                    isExpanded: $isExpanded
                )

                if isExpanded {
                    RedesignMetricGrid {
                        RedesignMetricCell(
                            label: "売上高",
                            value: "1,437.6億ドル",
                            delta: MetricYoYDisplay(
                                text: "+15.7%",
                                tone: .positive,
                                direction: .positive,
                                magnitudePercent: 15.7
                            ),
                            history: [98, 112, 124, 143],
                            accessibilityText: "売上高、1,437.6億ドル、前年同期比 +15.7%"
                        )
                        RedesignMetricCell(
                            label: "営業利益",
                            value: "-4.1億ドル",
                            delta: MetricYoYDisplay(
                                text: "赤字縮小 84.8%",
                                tone: .positive,
                                direction: .positive,
                                magnitudePercent: 84.8
                            ),
                            history: [-27, -18, -9, -4],
                            accessibilityText: "営業利益、-4.1億ドル、前年同期比 赤字縮小 84.8%"
                        )
                        RedesignMetricCell(
                            label: "純利益",
                            value: "236.4億ドル",
                            delta: MetricYoYDisplay(
                                text: "-4.2%",
                                tone: .negative,
                                direction: .negative,
                                magnitudePercent: 4.2
                            ),
                            history: [246, 244, 240, 236],
                            accessibilityText: "純利益、236.4億ドル、前年同期比 -4.2%"
                        )
                        RedesignMetricCell(
                            label: "EPS",
                            value: "1.53",
                            caption: "期末 2026年3月28日",
                            accessibilityText: "EPS、1.53、期末 2026年3月28日"
                        )
                    }
                }

                RedesignSectionHeader(title: "根拠")
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(previewDescriptors) { descriptor in
                        RedesignSourceChip(descriptor: descriptor) {}
                        if descriptor.id != previewDescriptors.last?.id {
                            KabuyomiHairline()
                        }
                    }
                }
            }
            .padding(18)
        }
        .background(KabuyomiTheme.paper)
    }
}

#Preview("primitives / dark") {
    PrimitivePreviewBoard()
        .preferredColorScheme(.dark)
}

#Preview("primitives / light") {
    PrimitivePreviewBoard()
        .preferredColorScheme(.light)
}

#Preview("primitives / accessibility3") {
    PrimitivePreviewBoard()
        .preferredColorScheme(.dark)
        .environment(\.dynamicTypeSize, .accessibility3)
}

#Preview("compact header") {
    VStack(spacing: 0) {
        RedesignCollapsingCompanyHeader(
            companyName: "Apple Inc.",
            formType: "10-Q",
            filedAt: "2026年5月2日",
            sourceCount: 12,
            isCollapsed: true,
            openSources: {},
            expanded: { EmptyView() },
            pinned: {
                Text("前の資料に基づく会話です。")
                    .font(.caption2)
                    .foregroundStyle(KabuyomiTheme.caution)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 6)
            }
        )
        Spacer()
    }
    .background(KabuyomiTheme.paper)
    .preferredColorScheme(.dark)
}

#endif
