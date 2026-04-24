import SwiftUI

struct HistoricalBoardCopy: Equatable {
    let eyebrow: String
    let title: String
    let subtitle: String
    let note: String
}

func historicalMetricSummaryText(for series: [HistoricalMetricSeriesPayload]) -> String? {
    guard !series.isEmpty else { return nil }

    let labels = series.prefix(2).map(\.label).joined(separator: " / ")
    if series.count > 2 {
        return "表示指標: \(labels) ほか \(series.count - 2) 件"
    }

    return "表示指標: \(labels)"
}

func historicalBoardCopy(
    comparisonBasis: String,
    requestedYears: Int,
    availablePeriodCount: Int,
    singleSeriesLabel: String?
) -> HistoricalBoardCopy {
    let isQuarterly = comparisonBasis == "quarterly"
    let basisTitle = isQuarterly ? "同四半期" : "年次"
    let basisNote = isQuarterly ? "同四半期ベース" : "年次ベース"
    let safeAvailableCount = max(availablePeriodCount, 0)
    let safeRequestedYears = max(requestedYears, safeAvailableCount)
    let isComplete = safeRequestedYears > 0 && safeAvailableCount >= safeRequestedYears
    let subject = singleSeriesLabel.map { "\($0)の" } ?? ""

    if isComplete {
        return HistoricalBoardCopy(
            eyebrow: "\(safeRequestedYears)年",
            title: "\(subject)\(safeRequestedYears)年の\(basisTitle)比較",
            subtitle: "\(basisTitle)で \(safeRequestedYears) 年分の推移を比較",
            note: "履歴比較は\(basisNote)です。"
        )
    }

    return HistoricalBoardCopy(
        eyebrow: "\(safeAvailableCount)期",
        title: "\(subject)取得済み\(safeAvailableCount)期比較",
        subtitle: "\(basisTitle)。\(safeRequestedYears)年分のうち取得済み\(safeAvailableCount)期の推移を表示",
        note: "履歴比較は\(basisNote)です。\(safeRequestedYears)年分が揃うまでは取得済み期間だけ表示します。"
    )
}

struct HistoricalChartScale: Equatable {
    let minValue: Double
    let maxValue: Double

    var range: Double {
        max(maxValue - minValue, 1)
    }
}

func historicalChartScale(values: [Double]) -> HistoricalChartScale {
    let observedMin = values.min() ?? 0
    let observedMax = values.max() ?? 0
    let minValue = min(observedMin, 0)
    let maxValue = max(observedMax, 0)

    if minValue == maxValue {
        return HistoricalChartScale(minValue: minValue - 1, maxValue: maxValue + 1)
    }

    return HistoricalChartScale(minValue: minValue, maxValue: maxValue)
}

func historicalChartY(value: Double, scale: HistoricalChartScale, height: CGFloat) -> CGFloat {
    let clampedValue = min(max(value, scale.minValue), scale.maxValue)
    let normalized = (scale.maxValue - clampedValue) / scale.range
    return min(max(CGFloat(normalized) * height, 0), height)
}

func summarySignalSegmentWidths(
    totalWidth: CGFloat,
    counts: [Int],
    spacing: CGFloat = 6,
    minimumVisibleWidth: CGFloat = 10
) -> [CGFloat] {
    guard !counts.isEmpty else { return [] }

    let spacingTotal = spacing * CGFloat(max(counts.count - 1, 0))
    let availableWidth = max(totalWidth - spacingTotal, 0)
    guard availableWidth > 0 else { return Array(repeating: 0, count: counts.count) }

    let baselineWidth = min(minimumVisibleWidth, availableWidth / CGFloat(counts.count))
    let totalCount = counts.reduce(0, +)

    guard totalCount > 0 else {
        return Array(repeating: baselineWidth, count: counts.count)
    }

    let remainingWidth = max(availableWidth - baselineWidth * CGFloat(counts.count), 0)
    return counts.map { count in
        guard count > 0 else { return baselineWidth }
        return baselineWidth + remainingWidth * CGFloat(count) / CGFloat(totalCount)
    }
}

struct SummaryDrawer: View {
    let company: CompanyPayload
    let positiveInsights: [FilingInsight]
    let negativeInsights: [FilingInsight]
    let focusInsights: [FilingInsight]
    let openSource: (LocalMessageSourceRef) -> Void
    let openOriginal: () -> Void
    let close: () -> Void

    private var headlineMetrics: [MetricPayload] {
        Array(orderedInvestorMetrics(for: company).prefix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SummaryDrawerHeader(
                ticker: company.ticker,
                formType: company.formType,
                close: close
            )

            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 18) {
                    SummaryLeadCard(
                        company: company,
                        tone: investorTone(for: company, positiveInsights: positiveInsights, negativeInsights: negativeInsights),
                        positiveCount: positiveInsights.count,
                        negativeCount: negativeInsights.count,
                        focusCount: focusInsights.count
                    )

                    InvestorMetricMapCard(metrics: headlineMetrics)

                    InvestorDriverBoard(
                        company: company,
                        positiveInsights: Array(positiveInsights.prefix(3)),
                        negativeInsights: Array(negativeInsights.prefix(3)),
                        openSource: openSource
                    )

                    InvestorFocusBoard(
                        company: company,
                        focusInsights: Array(focusInsights.prefix(3)),
                        openSource: openSource
                    )

                    InvestorChangeBoard(
                        metrics: headlineMetrics
                    )

                    if let historicalOverview = company.historicalOverview,
                       !historicalOverview.series.isEmpty {
                        InvestorHistoricalTrendBoard(overview: historicalOverview)
                    }

                    InvestorOriginalDocumentCard(openOriginal: openOriginal)
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(drawerShell)
    }

    private var drawerShell: some View {
        drawerShellBackground
            .compositingGroup()
            .mask(CompanyDrawerShellFadeMask(topFade: 28, bottomFade: 34))
    }

    private var drawerShellBackground: some View {
        ZStack(alignment: .leading) {
            LinearGradient(
                colors: [
                    Color(red: 0.99, green: 0.98, blue: 0.96),
                    Color(red: 0.95, green: 0.92, blue: 0.88)
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(0.74)

            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            KabuyomiTheme.accentDeep.opacity(0.34),
                            KabuyomiTheme.accent.opacity(0.08),
                            .clear
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: 6)

            Rectangle()
                .stroke(Color.white.opacity(0.55), lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(0.12), radius: 18, x: -8, y: 0)
    }
}

private struct SummaryDrawerHeader: View {
    let ticker: String
    let formType: String
    let close: () -> Void

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                Text("要点")
                    .font(.system(.caption, design: .rounded, weight: .heavy))
                    .kerning(1.2)
                    .foregroundStyle(KabuyomiTheme.accentDeep)

                Text(ticker)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                Text("\(formType) を会話前にざっと掴む")
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Spacer()

            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 38, height: 38)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .kabuyomiGlass(radius: 19, tint: Color.white.opacity(0.24), stroke: Color.white.opacity(0.56))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("要点を閉じる")
        }
    }
}

private struct SummaryLeadCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let company: CompanyPayload
    let tone: InvestorOverviewTone
    let positiveCount: Int
    let negativeCount: Int
    let focusCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header

            VStack(alignment: .leading, spacing: 10) {
                Text(summarySentence ?? "この決算資料の要点を短く押さえ、そのまま会話で深掘りできます。")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)

                Text(tone.supportingCopy)
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            SummarySignalMeter(
                positiveCount: positiveCount,
                negativeCount: negativeCount,
                focusCount: focusCount
            )

            SummaryLeadMetaGrid(
                filedAt: company.filedAt,
                periodOfReport: company.periodOfReport,
                formType: company.formType
            )
        }
        .padding(18)
        .background(background)
    }

    @ViewBuilder
    private var header: some View {
        let titleBlock = VStack(alignment: .leading, spacing: 7) {
            Text("まずここ")
                .font(.system(.caption, design: .rounded, weight: .heavy))
                .kerning(1.1)
                .foregroundStyle(tone.tint.opacity(0.92))
            Text(company.companyName)
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(company.ticker) ・ \(company.formType)")
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 10) {
                titleBlock
                InvestorToneBadge(tone: tone)
            }
        } else {
            HStack(alignment: .top, spacing: 12) {
                titleBlock
                Spacer()
                InvestorToneBadge(tone: tone)
            }
        }
    }

    private var summarySentence: String? {
        guard let sentence = leadSentence(from: company.summary.verdict) else { return nil }
        let normalizedSentence = sentence.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedCompanyName = company.companyName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalizedSentence == normalizedCompanyName ? nil : sentence
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: 28, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.96),
                        tone.tint.opacity(0.08),
                        KabuyomiTheme.paper
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(Color.white.opacity(0.92), lineWidth: 1)
            )
            .overlay(alignment: .topTrailing) {
                Circle()
                    .fill(tone.tint.opacity(0.12))
                    .frame(width: 138, height: 138)
                    .blur(radius: 12)
                    .offset(x: 18, y: -24)
            }
            .shadow(color: tone.tint.opacity(0.12), radius: 18, x: 0, y: 10)
    }
}

private struct SummarySignalMeter: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let positiveCount: Int
    let negativeCount: Int
    let focusCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            countBadges

            GeometryReader { geometry in
                let segmentWidths = summarySignalSegmentWidths(
                    totalWidth: geometry.size.width,
                    counts: [positiveCount, negativeCount, focusCount]
                )

                HStack(spacing: 6) {
                    SummarySignalSegment(
                        width: segmentWidths[0],
                        tint: KabuyomiTheme.positive,
                        isActive: positiveCount > 0
                    )
                    SummarySignalSegment(
                        width: segmentWidths[1],
                        tint: KabuyomiTheme.negative,
                        isActive: negativeCount > 0
                    )
                    SummarySignalSegment(
                        width: segmentWidths[2],
                        tint: KabuyomiTheme.accentDeep,
                        isActive: focusCount > 0
                    )
                }
            }
            .frame(height: 8)
        }
    }

    @ViewBuilder
    private var countBadges: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                OverviewCountBadge(title: "良い", count: positiveCount, tint: KabuyomiTheme.positive)
                OverviewCountBadge(title: "注意", count: negativeCount, tint: KabuyomiTheme.negative)
                OverviewCountBadge(title: "論点", count: focusCount, tint: KabuyomiTheme.accentDeep)
            }
        } else {
            HStack(spacing: 8) {
                OverviewCountBadge(title: "良い", count: positiveCount, tint: KabuyomiTheme.positive)
                OverviewCountBadge(title: "注意", count: negativeCount, tint: KabuyomiTheme.negative)
                OverviewCountBadge(title: "論点", count: focusCount, tint: KabuyomiTheme.accentDeep)
            }
        }
    }
}

private struct SummarySignalSegment: View {
    let width: CGFloat
    let tint: Color
    let isActive: Bool

    var body: some View {
        Capsule()
            .fill(tint.opacity(isActive ? 0.9 : 0.16))
            .frame(width: width)
    }
}

private struct SummaryLeadMetaGrid: View {
    let filedAt: String
    let periodOfReport: String
    let formType: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                SummaryMetaPill(title: "提出日", value: shortDate(filedAt))
                SummaryMetaPill(title: "対象期末", value: shortDate(periodOfReport))
                SummaryMetaPill(title: "フォーム", value: formType)
            }

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    SummaryMetaPill(title: "提出日", value: shortDate(filedAt))
                    SummaryMetaPill(title: "対象期末", value: shortDate(periodOfReport))
                }

                SummaryMetaPill(title: "フォーム", value: formType)
            }
        }
    }

    private func shortDate(_ rawValue: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"

        guard let date = formatter.date(from: rawValue) else { return rawValue }
        formatter.dateFormat = "yyyy/MM/dd"
        return formatter.string(from: date)
    }
}

private struct SummaryMetaLabel: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(.caption2, design: .rounded, weight: .heavy))
            .kerning(0.5)
            .foregroundStyle(KabuyomiTheme.inkMuted)
            .lineLimit(1)
            .minimumScaleFactor(0.9)
            .textCase(.uppercase)
    }
}

private struct SummaryMetaValue: View {
    let value: String

    var body: some View {
        Text(value)
            .font(.system(.subheadline, design: .rounded, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(KabuyomiTheme.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct SummaryMetaCardBackground: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color.white.opacity(0.72))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.94), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.03), radius: 10, x: 0, y: 4)
    }
}

private struct InvestorChangeBoard: View {
    let metrics: [MetricPayload]

    private var comparableMetrics: [MetricPayload] {
        metrics.filter { $0.comparisonValue != nil }
    }

    var body: some View {
        SummaryBoardCard(
            eyebrow: "比較",
            title: "前回からの変化",
            subtitle: "今回・前年同期・増減率を表で比較",
            systemImage: "clock.arrow.circlepath"
        ) {
            if comparableMetrics.isEmpty {
                Text("前回比で比較できる主要指標はまだ抽出されていません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(comparableMetrics.enumerated()), id: \.element.id) { index, metric in
                        InvestorChangeTableRow(metric: metric, isLast: index == comparableMetrics.count - 1)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(Color.white.opacity(0.72))
                        .overlay(
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .stroke(Color.white.opacity(0.88), lineWidth: 1)
                        )
                )
            }
        }
    }
}

private struct InvestorChangeTableRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let metric: MetricPayload
    let isLast: Bool

    private var currentValueText: String {
        formattedMetricValue(metric)
    }

    private var comparisonValueText: String {
        metric.comparisonValue.map {
            formattedMetricValue($0, logicalName: metric.logicalName, unit: metric.unit)
        } ?? "—"
    }

    private var yoyDisplay: MetricYoYDisplay? {
        metricYoYDisplay(for: metric)
    }

    private var yoyText: String {
        yoyDisplay?.text ?? "—"
    }

    private var yoyTint: Color {
        yoyDisplay?.tint ?? KabuyomiTheme.inkMuted
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                header
                valueBlocks
            }
            .padding(.vertical, 12)

            if !isLast {
                Divider()
                    .overlay(Color.white.opacity(0.7))
            }
        }
    }

    @ViewBuilder
    private var header: some View {
        let title = Text(MetricLabeler.title(for: metric.logicalName))
            .font(.system(.subheadline, design: .rounded, weight: .bold))
            .foregroundStyle(KabuyomiTheme.ink)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            .fixedSize(horizontal: false, vertical: true)

        let yoyBadge = Text(yoyText)
            .font(.system(.footnote, design: .rounded, weight: .bold))
            .foregroundStyle(yoyTint)
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(yoyTint.opacity(0.14)))

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                title
                yoyBadge
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                title
                Spacer(minLength: 8)
                yoyBadge
            }
        }
    }

    @ViewBuilder
    private var valueBlocks: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 10) {
                InvestorChangeValueBlock(title: "今回", value: currentValueText, tint: KabuyomiTheme.ink)
                InvestorChangeValueBlock(title: "前年", value: comparisonValueText, tint: KabuyomiTheme.inkSoft)
            }
        } else {
            HStack(alignment: .top, spacing: 10) {
                InvestorChangeValueBlock(title: "今回", value: currentValueText, tint: KabuyomiTheme.ink)
                InvestorChangeValueBlock(title: "前年", value: comparisonValueText, tint: KabuyomiTheme.inkSoft)
            }
        }
    }
}

private struct InvestorChangeValueBlock: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(.caption2, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.inkMuted)
            Text(value)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(tint)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                .minimumScaleFactor(0.78)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct InvestorHistoricalTrendBoard: View {
    let overview: HistoricalOverviewPayload

    private var orderedPeriods: [String] {
        let allPeriods = overview.series
            .flatMap(\.points)
            .map(\.periodEnd)

        return Array(Set(allPeriods)).sorted()
    }

    private var copy: HistoricalBoardCopy {
        historicalBoardCopy(
            comparisonBasis: overview.comparisonBasis,
            requestedYears: overview.years,
            availablePeriodCount: orderedPeriods.count,
            singleSeriesLabel: overview.series.count == 1 ? overview.series.first?.label : nil
        )
    }

    private var metricSummaryText: String? {
        historicalMetricSummaryText(for: overview.series)
    }

    var body: some View {
        SummaryBoardCard(
            eyebrow: copy.eyebrow,
            title: copy.title,
            subtitle: copy.subtitle,
            systemImage: "chart.bar.xaxis"
        ) {
            if let metricSummaryText {
                Text(metricSummaryText)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
            }

            historicalContent

            Text(copy.note)
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    @ViewBuilder
    private var historicalContent: some View {
        VStack(spacing: 10) {
            ForEach(overview.series) { series in
                InvestorHistoricalSeriesChartCard(series: series, periods: orderedPeriods)
            }
        }
    }
}

private struct InvestorHistoricalSeriesChartCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let series: HistoricalMetricSeriesPayload
    let periods: [String]

    private var pointsByPeriod: [String: HistoricalMetricPointPayload] {
        Dictionary(uniqueKeysWithValues: series.points.map { ($0.periodEnd, $0) })
    }

    private var orderedPoints: [HistoricalMetricPointPayload] {
        periods.compactMap { pointsByPeriod[$0] }
    }

    private var latestYoYDisplay: MetricYoYDisplay? {
        guard let latest = orderedPoints.max(by: { $0.periodEnd < $1.periodEnd }) else {
            return nil
        }
        return metricYoYDisplay(
            logicalName: series.logicalName,
            value: latest.value,
            comparisonValue: nil,
            yoyPercent: latest.yoyPercent
        )
    }

    private var latestYoYText: String {
        latestYoYDisplay?.text ?? "YoY なし"
    }

    private var latestYoYTint: Color {
        latestYoYDisplay?.tint ?? KabuyomiTheme.inkMuted
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header

            InvestorHistoricalBarChart(points: orderedPoints)

            VStack(spacing: 0) {
                ForEach(Array(orderedPoints.enumerated()), id: \.element.id) { index, point in
                    InvestorHistoricalValueRow(
                        point: point,
                        logicalName: series.logicalName,
                        isLast: index == orderedPoints.count - 1
                    )
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground)
    }

    @ViewBuilder
    private var header: some View {
        let title = Text(series.label)
            .font(.system(.subheadline, design: .rounded, weight: .bold))
            .foregroundStyle(KabuyomiTheme.ink)
            .fixedSize(horizontal: false, vertical: true)

        let yoyBadge = Text(latestYoYText)
            .font(.system(.footnote, design: .rounded, weight: .bold))
            .foregroundStyle(latestYoYTint)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(latestYoYTint.opacity(0.14)))

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                title
                yoyBadge
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                title
                Spacer(minLength: 8)
                yoyBadge
            }
        }
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(Color.white.opacity(0.72))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.88), lineWidth: 1)
            )
    }
}

private struct InvestorHistoricalBarChart: View {
    let points: [HistoricalMetricPointPayload]

    private var scale: HistoricalChartScale {
        historicalChartScale(values: points.map(\.value))
    }

    var body: some View {
        Canvas { context, size in
            let baselineY = historicalChartY(value: 0, scale: scale, height: size.height)
            var baselinePath = Path()
            baselinePath.move(to: CGPoint(x: 0, y: baselineY))
            baselinePath.addLine(to: CGPoint(x: size.width, y: baselineY))
            context.stroke(baselinePath, with: .color(KabuyomiTheme.inkMuted.opacity(0.2)), lineWidth: 1)

            guard !points.isEmpty else { return }

            let gap: CGFloat = 8
            let totalGap = gap * CGFloat(max(points.count - 1, 0))
            let barWidth = max(12, (size.width - totalGap) / CGFloat(points.count))

            for (index, point) in points.enumerated() {
                let x = CGFloat(index) * (barWidth + gap)
                let valueY = historicalChartY(value: point.value, scale: scale, height: size.height)
                let y = min(valueY, baselineY)
                let height = max(abs(valueY - baselineY), 4)
                let rect = CGRect(x: x, y: y, width: barWidth, height: height)
                let tint = point.value < 0 ? KabuyomiTheme.negative : KabuyomiTheme.accentDeep
                context.fill(Path(roundedRect: rect, cornerRadius: 4), with: .color(tint.opacity(0.72)))
            }
        }
        .frame(height: 86)
        .padding(.vertical, 6)
        .accessibilityHidden(true)
    }
}

private struct InvestorHistoricalValueRow: View {
    let point: HistoricalMetricPointPayload
    let logicalName: String
    let isLast: Bool

    private var valueText: String {
        if logicalName == "epsBasic" {
            return point.value.formatted(.number.precision(.fractionLength(2)))
        }

        return formattedMetricValue(point.value, logicalName: logicalName, unit: point.unit)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(shortHistoricalPeriod(point.periodEnd))
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)

                Spacer(minLength: 8)

                Text(valueText)
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }
            .padding(.vertical, 9)

            if !isLast {
                Divider()
                    .overlay(Color.white.opacity(0.7))
            }
        }
    }
}

private func shortHistoricalPeriod(_ rawValue: String) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"

    guard let date = formatter.date(from: rawValue) else { return rawValue }
    formatter.dateFormat = "yyyy/MM"
    return formatter.string(from: date)
}

private struct InvestorOriginalDocumentCard: View {
    let openOriginal: () -> Void

    var body: some View {
        Button(action: openOriginal) {
            HStack(spacing: 12) {
                Image(systemName: "arrow.up.right.square")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(KabuyomiTheme.accentDeep))

                VStack(alignment: .leading, spacing: 4) {
                    Text("原文に戻る")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(Color.white)
                    Text("最後は提出資料で裏取りする")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.8))
                }

                Spacer()

                Text("SEC")
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.92))
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [KabuyomiTheme.accentDeep, KabuyomiTheme.accent],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .stroke(Color.white.opacity(0.24), lineWidth: 1)
                    )
                    .shadow(color: KabuyomiTheme.accentDeep.opacity(0.18), radius: 14, x: 0, y: 8)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct SummaryMetaPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            SummaryMetaLabel(title: title)
            SummaryMetaValue(value: value)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SummaryMetaCardBackground())
    }
}

private struct InvestorToneBadge: View {
    let tone: InvestorOverviewTone

    var body: some View {
        Text(tone.title)
            .font(.system(.footnote, design: .rounded, weight: .bold))
            .foregroundStyle(tone.tint)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(tone.tint.opacity(0.14)))
    }
}

private struct OverviewCountBadge: View {
    let title: String
    let count: Int
    let tint: Color

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .bold))

            Rectangle()
                .fill(tint.opacity(0.26))
                .frame(width: 1, height: 16)

            Text("\(count)")
                .font(.system(.caption, design: .rounded, weight: .bold))
                .monospacedDigit()
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Color.white.opacity(0.78))
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(tint.opacity(0.18), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
    }
}

private struct InvestorMetricMapCard: View {
    let metrics: [MetricPayload]

    private var maxMagnitude: Double {
        max(metrics.compactMap(\.yoyPercent).map(abs).max() ?? 0, 10)
    }

    var body: some View {
        SummaryBoardCard(
            eyebrow: "数字",
            title: "主要指標",
            subtitle: "いまの値と前年同期をひと目で確認",
            systemImage: "chart.bar.xaxis"
        ) {
            if metrics.isEmpty {
                Text("比較できる主要指標はまだ抽出されていません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(metrics) { metric in
                    InvestorMetricMapRow(metric: metric, maxMagnitude: maxMagnitude)
                }
            }
        }
    }
}

private struct InvestorMetricMapRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let metric: MetricPayload
    let maxMagnitude: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header

            InvestorDeltaBar(display: yoyDisplay, maxMagnitude: maxMagnitude)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.secondary, radius: 20)
    }

    private var yoyDisplay: MetricYoYDisplay? {
        metricYoYDisplay(for: metric)
    }

    private var metricTint: Color {
        yoyDisplay?.tint ?? KabuyomiTheme.inkMuted
    }

    @ViewBuilder
    private var header: some View {
        let valueBlock = VStack(alignment: .leading, spacing: 4) {
            Text(MetricLabeler.title(for: metric.logicalName))
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(formattedMetricValue(metric))
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                .minimumScaleFactor(0.82)
                .monospacedDigit()
            if let comparisonValue = metric.comparisonValue {
                Text("前年 \(formattedMetricValue(comparisonValue, logicalName: metric.logicalName, unit: metric.unit))")
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .minimumScaleFactor(0.82)
            }
        }

        let yoyBadge = Text(yoyDisplay?.text ?? "YoY なし")
            .font(.system(.footnote, design: .rounded, weight: .bold))
            .foregroundStyle(metricTint)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(metricTint.opacity(0.14)))

        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                valueBlock
                yoyBadge
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                valueBlock
                Spacer(minLength: 0)
                yoyBadge
            }
        }
    }
}

private struct InvestorDeltaBar: View {
    let display: MetricYoYDisplay?
    let maxMagnitude: Double

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let filledWidth = max(4, (width / 2) * normalizedMagnitude)

            ZStack {
                Capsule()
                    .fill(KabuyomiTheme.mist.opacity(0.58))

                Rectangle()
                    .fill(Color.white.opacity(0.9))
                    .frame(width: 1)

                if display != nil {
                    Capsule()
                        .fill(fillColor)
                        .frame(width: filledWidth)
                        .offset(x: horizontalOffset(for: filledWidth))
                }
            }
        }
        .frame(height: 10)
        .accessibilityLabel(accessibilityLabel)
    }

    private var normalizedMagnitude: Double {
        guard let display else { return 0 }
        return min(display.magnitudePercent / maxMagnitude, 1)
    }

    private var fillColor: Color {
        display?.tint ?? KabuyomiTheme.inkMuted
    }

    private var accessibilityLabel: String {
        display?.text ?? "前年比データなし"
    }

    private func horizontalOffset(for filledWidth: CGFloat) -> CGFloat {
        switch display?.direction {
        case .positive:
            return filledWidth / 2
        case .negative:
            return -filledWidth / 2
        case .some(.none), nil:
            return 0
        }
    }
}

private struct InvestorDriverBoard: View {
    let company: CompanyPayload
    let positiveInsights: [FilingInsight]
    let negativeInsights: [FilingInsight]
    let openSource: (LocalMessageSourceRef) -> Void

    var body: some View {
        SummaryBoardCard(
            eyebrow: "整理",
            title: "良かった点と気になる点",
            subtitle: "まず強さ、その次に注意点を見る",
            systemImage: "arrow.left.arrow.right"
        ) {
            InvestorInsightLane(
                company: company,
                title: "良かった点",
                subtitle: "数字や本文で確認できる追い風",
                tint: KabuyomiTheme.positive,
                systemImage: "arrow.up.right.circle.fill",
                insights: positiveInsights,
                emptyMessage: "明確な良い材料はまだ切り出されていません。",
                openSource: openSource
            )

            InvestorInsightLane(
                company: company,
                title: "気になる点",
                subtitle: "弱さや注意点として見たい論点",
                tint: KabuyomiTheme.negative,
                systemImage: "arrow.down.right.circle.fill",
                insights: negativeInsights,
                emptyMessage: "明確に気をつけたい材料はまだ切り出されていません。",
                openSource: openSource
            )
        }
    }
}

private struct InvestorInsightLane: View {
    let company: CompanyPayload
    let title: String
    let subtitle: String
    let tint: Color
    let systemImage: String
    let insights: [FilingInsight]
    let emptyMessage: String
    let openSource: (LocalMessageSourceRef) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(tint.opacity(0.14)))

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(subtitle)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            if insights.isEmpty {
                Text(emptyMessage)
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(Array(insights.enumerated()), id: \.element.id) { index, insight in
                    InvestorInsightRow(
                        company: company,
                        index: index + 1,
                        insight: insight,
                        tint: tint,
                        openSource: openSource
                    )
                }
            }
        }
    }
}

private struct InvestorInsightRow: View {
    let company: CompanyPayload
    let index: Int
    let insight: FilingInsight
    let tint: Color
    let openSource: (LocalMessageSourceRef) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(index)")
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(Circle().fill(tint.opacity(0.14)))

            VStack(alignment: .leading, spacing: 10) {
                Text(insight.text)
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)

                InsightSourceChips(
                    company: company,
                    sourceIds: insight.sourceIds,
                    openSource: openSource
                )
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.secondary, radius: 20)
    }
}

private struct InvestorFocusBoard: View {
    let company: CompanyPayload
    let focusInsights: [FilingInsight]
    let openSource: (LocalMessageSourceRef) -> Void

    var body: some View {
        SummaryBoardCard(
            eyebrow: "次",
            title: "次に詰める論点",
            subtitle: "会話で深掘りする順番まで見える形に",
            systemImage: "bubble.left.and.bubble.right.fill"
        ) {
            if focusInsights.isEmpty {
                Text("質問で深掘りしやすい論点はまだ抽出されていません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(Array(focusInsights.enumerated()), id: \.element.id) { index, insight in
                    let primarySource = primarySourceReference(sourceIds: insight.sourceIds, in: company)

                    InvestorFocusInsightCard(
                        company: company,
                        index: index + 1,
                        insight: insight,
                        primarySource: primarySource,
                        openSource: openSource
                    )
                }
            }
        }
    }
}

private struct InvestorFocusInsightCard: View {
    let company: CompanyPayload
    let index: Int
    let insight: FilingInsight
    let primarySource: LocalMessageSourceRef?
    let openSource: (LocalMessageSourceRef) -> Void

    private var isInteractive: Bool {
        primarySource != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            focusHeader

            InsightSourceChips(
                company: company,
                sourceIds: insight.sourceIds,
                openSource: openSource
            )
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.secondary, radius: 20)
    }

    @ViewBuilder
    private var focusHeader: some View {
        if let primarySource {
            Button(action: { openSource(primarySource) }) {
                focusHeaderContent
            }
            .buttonStyle(.plain)
            .accessibilityLabel("論点の根拠を開く: \(insight.text)")
        } else {
            focusHeaderContent
        }
    }

    private var focusHeaderContent: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("Q\(index)")
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

            Text(insight.text)
                .font(.system(.body, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)

            if isInteractive {
                Spacer(minLength: 8)

                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(8)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.45)))
            }
        }
    }
}

private struct SummaryBoardCard<Content: View>: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    let systemImage: String
    let content: Content

    init(
        eyebrow: String,
        title: String,
        subtitle: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) {
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 32, height: 32)
                    .background(
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .fill(KabuyomiTheme.accentSoft.opacity(0.58))
                    )

                VStack(alignment: .leading, spacing: 3) {
                    Text(eyebrow)
                        .font(.system(.caption2, design: .rounded, weight: .heavy))
                        .kerning(0.8)
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text(title)
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(subtitle)
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            content
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
    }
}

struct InsightSourceChip: Identifiable, Hashable {
    let label: String
    let source: LocalMessageSourceRef?

    var id: String {
        "\(label):\(source?.sourceIdSnapshot ?? "none")"
    }
}

func insightSourceChips(sourceIds: [String], in company: CompanyPayload) -> [InsightSourceChip] {
    var seen = Set<String>()

    return sourceIds.compactMap { sourceId in
        guard let chunk = company.sourceChunks.first(where: { $0.sourceId == sourceId }) else {
            let fallback = "提出資料"
            guard seen.insert(fallback).inserted else { return nil }
            return InsightSourceChip(label: fallback, source: nil)
        }

        let label = investorFacingSourceLabel(for: chunk, in: company)
        guard seen.insert(label).inserted else { return nil }
        return InsightSourceChip(
            label: label,
            source: sourceReference(from: chunk, in: company)
        )
    }
}

private struct InsightSourceChips: View {
    let company: CompanyPayload
    let sourceIds: [String]
    let openSource: ((LocalMessageSourceRef) -> Void)?

    private var chips: [InsightSourceChip] {
        insightSourceChips(sourceIds: sourceIds, in: company)
    }

    var body: some View {
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(chips.prefix(2))) { chip in
                        if let source = chip.source, let openSource {
                            Button(action: { openSource(source) }) {
                                sourceChipLabel(chip.label, isInteractive: true)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("根拠を開く: \(chip.label)")
                        } else {
                            sourceChipLabel(chip.label, isInteractive: false)
                        }
                    }

                    if chips.count > 2 {
                        Text("+\(chips.count - 2)")
                            .font(.system(.caption2, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
                    }
                }
                .padding(.trailing, 20)
            }
        }
    }

    private func sourceChipLabel(_ label: String, isInteractive: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "bookmark")
                .font(.system(size: 11, weight: .semibold))

            Text(label)

            if isInteractive {
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep.opacity(0.58))
            }
        }
            .font(.system(.caption2, design: .rounded, weight: .semibold))
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
    }
}
