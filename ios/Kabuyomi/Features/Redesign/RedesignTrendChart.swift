import SwiftUI

/// 推移は本質的に視覚的な情報だが、これまで日付と数値の表として描かれていた。
///
/// 棒で描くのは、四半期・年次の離散した提出データを線で結ぶと
/// 期間の間を補間しているように見えてしまうため。
///
/// 高さはゼロ基線ではなく絶対値の比で決める(`TrendBarGeometry`)。
/// ゼロ基線だと全期間が赤字の系列で上下が反転するため。


/// ゼロ基線からの高さで描くと、全期間が赤字の系列で上下が反転する。
/// 例: -10億と-50億なら、scale は min=-50億 / max=0 になり、
/// 「0 に近い -10億」のほうが高い棒になって「大きいほど良い」と読めてしまう。
/// 棒の高さは絶対値の比で決め、符号は色で示す。
struct TrendBarGeometry {
    let magnitudeRatio: Double
    let isNegative: Bool

    init(value: Double, values: [Double]) {
        let peak = values.map(abs).max() ?? 0
        self.magnitudeRatio = peak > 0 ? abs(value) / peak : 0
        self.isNegative = value < 0
    }

    func height(in available: CGFloat, minimum: CGFloat) -> CGFloat {
        max(CGFloat(magnitudeRatio) * available, minimum)
    }
}

/// 指標タイルに添える極小の推移。値の大小ではなく「向き」を伝えるためのもの。
struct RedesignSparkline: View {
    let values: [Double]
    let isPositive: Bool

    private func barTint(isLatest: Bool, isNegative: Bool) -> Color {
        if isNegative {
            return isLatest ? KabuyomiTheme.ink.opacity(0.75) : KabuyomiTheme.ink.opacity(0.22)
        }
        return isLatest
            ? (isPositive ? KabuyomiTheme.accentDeep : KabuyomiTheme.ink).opacity(0.85)
            : KabuyomiTheme.inkMuted.opacity(0.28)
    }

    var body: some View {
        GeometryReader { proxy in
            let count = values.count
            let spacing: CGFloat = 3
            let barWidth = max((proxy.size.width - spacing * CGFloat(max(count - 1, 0))) / CGFloat(max(count, 1)), 1)
            HStack(alignment: .bottom, spacing: spacing) {
                ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                    let bar = TrendBarGeometry(value: value, values: values)
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                        .fill(barTint(isLatest: index == count - 1, isNegative: bar.isNegative))
                        .frame(width: barWidth, height: bar.height(in: proxy.size.height, minimum: 1.5))
                }
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .accessibilityHidden(true)
    }
}

/// 「推移」セクション本体。系列ごとに棒グラフと、最新値・前年同期比を並べる。
struct RedesignTrendChart: View {
    let series: HistoricalMetricSeriesPayload

    /// 古い順に並べる。左から右へ時間が進むほうが読み取りやすい。
    private var orderedPoints: [HistoricalMetricPointPayload] {
        Array(series.points.sorted(by: { $0.periodEnd < $1.periodEnd }).suffix(4))
    }

    private var values: [Double] { orderedPoints.map(\.value) }

    private var latest: HistoricalMetricPointPayload? { orderedPoints.last }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(series.label.isEmpty ? MetricLabeler.title(for: series.logicalName) : series.label)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Spacer(minLength: 8)
                if let latest {
                    Text(formattedMetricValue(latest.value, logicalName: series.logicalName, unit: latest.unit))
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(KabuyomiTheme.ink)
                    if let yoy = latest.yoyPercent {
                        Text(formattedSignedYoY(yoy))
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(yoy >= 0 ? KabuyomiTheme.accentDeep : KabuyomiTheme.ink)
                    }
                }
            }

            GeometryReader { proxy in
                let count = orderedPoints.count
                let spacing: CGFloat = 10
                let barWidth = max((proxy.size.width - spacing * CGFloat(max(count - 1, 0))) / CGFloat(max(count, 1)), 1)
                HStack(alignment: .bottom, spacing: spacing) {
                    ForEach(Array(orderedPoints.enumerated()), id: \.element.id) { index, point in
                        let bar = TrendBarGeometry(value: point.value, values: values)
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(barTint(isLatest: index == count - 1, isNegative: bar.isNegative))
                            .frame(width: barWidth, height: bar.height(in: proxy.size.height, minimum: 2))
                    }
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
            .frame(height: 56)

            HStack(spacing: 10) {
                ForEach(orderedPoints) { point in
                    Text(shortPeriodLabel(point.periodEnd))
                        .font(.caption2)
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    /// 赤字の期は色で区別する。高さは絶対値なので、色が無いと符号が読めない。
    private func barTint(isLatest: Bool, isNegative: Bool) -> Color {
        if isNegative {
            return isLatest ? KabuyomiTheme.ink.opacity(0.75) : KabuyomiTheme.ink.opacity(0.22)
        }
        return isLatest ? KabuyomiTheme.accentDeep.opacity(0.85) : KabuyomiTheme.inkMuted.opacity(0.25)
    }

    private var accessibilitySummary: String {
        let title = series.label.isEmpty ? MetricLabeler.title(for: series.logicalName) : series.label
        let readings = orderedPoints.map { point in
            "\(shortPeriodLabel(point.periodEnd)) \(formattedMetricValue(point.value, logicalName: series.logicalName, unit: point.unit))"
        }
        return "\(title)の推移。\(readings.joined(separator: "、"))"
    }
}

/// 軸ラベルに 2026/03/28 をそのまま並べると読み取れないので年月まで縮める。
func shortPeriodLabel(_ periodEnd: String) -> String {
    let parts = periodEnd.split(separator: "-")
    guard parts.count >= 2 else { return periodEnd }
    return "\(parts[0].suffix(2))/\(parts[1])"
}
