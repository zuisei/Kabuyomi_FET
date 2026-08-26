import SwiftUI
import Charts
import UIKit

enum MarketChartMode: String, CaseIterable, Identifiable { case price = "価格", relative = "ベンチマーク対比", volume = "出来高"; var id: Self { self } }

struct MinuteReactionChart: View {
    let event: PolicyEvent
    let cutoff: Date?
    let selectedDate: Date?
    let seriesOverride: [MarketPoint]?
    let summariesOverride: [MarketSummary]?
    let provenanceOverride: MarketDataProvenance?
    let resolution: MarketChartResolution
    let volumeBaselineLabel: String?
    let tickerOverride: String?
    let benchmarkTickerOverride: String?
    @EnvironmentObject private var store: SavedEventStore
    @State private var mode: MarketChartMode = .price
    @State private var cursorDate: Date?

    init(
        event: PolicyEvent,
        cutoff: Date?,
        selectedDate: Date?,
        seriesOverride: [MarketPoint]? = nil,
        summariesOverride: [MarketSummary]? = nil,
        provenanceOverride: MarketDataProvenance? = nil,
        resolution: MarketChartResolution? = nil,
        volumeBaselineLabel: String? = nil,
        tickerOverride: String? = nil,
        benchmarkTickerOverride: String? = nil
    ) {
        self.event = event
        self.cutoff = cutoff
        self.selectedDate = selectedDate
        self.seriesOverride = seriesOverride
        self.summariesOverride = summariesOverride
        self.provenanceOverride = provenanceOverride
        self.resolution = resolution ?? (event.productAnalysis.marketAnalysisMode == .daily ? .day : .minute)
        self.volumeBaselineLabel = volumeBaselineLabel
        self.tickerOverride = tickerOverride
        self.benchmarkTickerOverride = benchmarkTickerOverride
    }

    private var allPoints: [MarketPoint] {
        (seriesOverride ?? event.marketSeries).sorted { $0.timestamp < $1.timestamp }
    }
    private var allSummaries: [MarketSummary] { summariesOverride ?? event.marketSummaries }
    private var filteredPoints: [MarketPoint] {
        allPoints.filter { point in cutoff.map { point.timestamp <= $0 } ?? true }
    }
    private var cursorPoint: MarketPoint? { guard let cursorDate else { return nil }; return filteredPoints.min { abs($0.timestamp.timeIntervalSince(cursorDate)) < abs($1.timestamp.timeIntervalSince(cursorDate)) } }
    private var reportDate: Date? { event.timelineItems.first { $0.kind == .mediaReport }?.occurredAt }
    private var summary: MarketSummary? {
        allSummaries
            .filter { item in cutoff.map { item.availableAt <= $0 } ?? true }
            .max { $0.availableAt < $1.availableAt }
    }
    private var securityTicker: String { summary?.ticker ?? tickerOverride ?? event.tickers.first ?? "Security" }
    private var benchmarkTicker: String { summary?.benchmarkTicker ?? benchmarkTickerOverride ?? "基準指数" }
    private var xDomain: ClosedRange<Date> {
        let padding: TimeInterval = switch resolution {
        case .minute: 5 * 60
        case .hour: 60 * 60
        case .day: 24 * 60 * 60
        }
        let visiblePoints = filteredPoints.isEmpty ? allPoints : filteredPoints
        let start = (visiblePoints.first?.timestamp ?? event.anchorDate).addingTimeInterval(-padding)
        let end = (visiblePoints.last?.timestamp ?? event.lastActivityAt).addingTimeInterval(padding)
        return start...max(end, start.addingTimeInterval(padding))
    }
    private var axisDates: [Date] {
        let visiblePoints = filteredPoints.isEmpty ? allPoints : filteredPoints
        guard !visiblePoints.isEmpty else { return [] }
        let last = visiblePoints.count - 1
        // Keep the final label inside the plot area. Swift Charts otherwise
        // truncates a centered label at the trailing edge on compact iPhones.
        let indexes = [0, last / 2, (last * 4) / 5]
        return Array(Set(indexes)).sorted().map { visiblePoints[$0].timestamp }
    }
    private var priceDomain: ClosedRange<Double> {
        paddedDomain(filteredPoints.flatMap { [$0.normalizedSecurityPrice, $0.normalizedBenchmarkPrice] }, minimumPadding: 0.35)
    }
    private var relativeDomain: ClosedRange<Double> {
        paddedDomain(filteredPoints.map(\.abnormalReturnPoints) + [0], minimumPadding: 0.2)
    }
    private var volumeDomain: ClosedRange<Double> {
        let maximum = max(filteredPoints.map(\.volumeRatio).max() ?? 1, 1)
        return 0...max(1.25, maximum * 1.15)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let summary {
                HStack { Text(summary.ticker).font(.headline.monospaced()); Spacer(); Text(AppFormatters.percent(summary.securityReturn)).font(.title3.bold().monospacedDigit()).foregroundStyle(AppColors.market) }
                MetricRow(label: "\(summary.benchmarkTicker)対比", value: AppFormatters.points(summary.abnormalReturn))
                MetricRow(label: "評価窓", value: windowLabel(summary.window))
            } else {
                Text(resolution == .minute ? "30分後評価はまだ未確定" : "評価値はまだ未確定")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Picker("チャート指標", selection: $mode) { ForEach(MarketChartMode.allCases) { Text(modeLabel($0)).tag($0) } }.pickerStyle(.segmented)
            Text(chartDescription)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let p = cursorPoint { Text("\(AppFormatters.displayTime(p.timestamp, preference: store.timezone))  \(securityTicker) \(p.normalizedSecurityPrice, specifier: "%.2f")  \(benchmarkTicker) \(p.normalizedBenchmarkPrice, specifier: "%.2f")  対比 \(p.abnormalReturnPoints, specifier: "%+.2f")pt  出来高 \(p.volumeRatio, specifier: "%.1f")x").font(.caption.monospacedDigit()).accessibilityIdentifier("marketChart.cursorValue") }
            chart.frame(height: mode == .volume ? 170 : 220)
            HStack(spacing: 10) { legend("公式公開", AppColors.official); legend("最初の報道", AppColors.report); legend(event.status == .corrected ? "訂正文書" : "文書改訂", AppColors.revision); legend("選択時点", .primary) }.font(.caption2).foregroundStyle(.secondary)
            Text(sessionLabel).font(.caption).foregroundStyle(.secondary)
            Text(provenanceLabel).font(.caption).foregroundStyle(.secondary)
            if let volumeBaselineLabel {
                Text(volumeBaselineLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text("交絡要因: \(confounderLabel)").font(.caption).foregroundStyle(.secondary)
            Text(summary == nil ? "選択時点までの市場データを記述しています。政策との因果関係は未確定です。" : "公式公開後の市場データを記述しています。政策との因果関係は未確定です。").font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("marketChart.minute")
    }

    @ViewBuilder private var chart: some View {
        switch mode {
        case .price:
            Chart { ForEach(filteredPoints) { p in LineMark(x: .value("時刻", p.timestamp), y: .value("指数", p.normalizedSecurityPrice), series: .value("系列", securityTicker)).foregroundStyle(by: .value("系列", securityTicker)); LineMark(x: .value("時刻", p.timestamp), y: .value("指数", p.normalizedBenchmarkPrice), series: .value("系列", benchmarkTicker)).foregroundStyle(by: .value("系列", benchmarkTicker)) }; markers; cursorMarker }.chartXSelection(value: $cursorDate).chartXScale(domain: xDomain).chartYScale(domain: priceDomain).chartXAxis { timeAxis }
        case .relative:
            Chart { RuleMark(y: .value("0基準", 0)).foregroundStyle(.secondary.opacity(0.5)); ForEach(filteredPoints) { p in AreaMark(x: .value("時刻", p.timestamp), y: .value("pt", p.abnormalReturnPoints)).foregroundStyle(AppColors.market.opacity(0.12)); LineMark(x: .value("時刻", p.timestamp), y: .value("pt", p.abnormalReturnPoints)).foregroundStyle(AppColors.market) }; markers; cursorMarker }.chartXSelection(value: $cursorDate).chartXScale(domain: xDomain).chartYScale(domain: relativeDomain).chartXAxis { timeAxis }
        case .volume:
            Chart { RuleMark(y: .value("通常比", 1.0)).foregroundStyle(.secondary).lineStyle(StrokeStyle(dash: [4, 3])); ForEach(filteredPoints) { p in BarMark(x: .value("時刻", p.timestamp), y: .value("倍", p.volumeRatio)).foregroundStyle(AppColors.market.opacity(0.7)) }; markers; cursorMarker }.chartXSelection(value: $cursorDate).chartXScale(domain: xDomain).chartYScale(domain: volumeDomain).chartXAxis { timeAxis }
        }
    }

    @AxisContentBuilder private var timeAxis: some AxisContent {
        AxisMarks(values: axisDates) { value in
            AxisGridLine(); AxisTick()
            if let date = value.as(Date.self) { AxisValueLabel { Text(axisLabel(date)).font(.caption2.monospacedDigit()) } }
        }
    }

    @ChartContentBuilder private var markers: some ChartContent {
        if let date = event.publishedAt, visible(date) { RuleMark(x: .value("公式公開", date)).foregroundStyle(AppColors.official).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3])) }
        if let date = reportDate, visible(date) { RuleMark(x: .value("最初の報道", date)).foregroundStyle(AppColors.report).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3])) }
        if let date = event.revisedAt, visible(date) { RuleMark(x: .value(event.status == .corrected ? "訂正文書" : "文書改訂", date)).foregroundStyle(AppColors.revision).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3])) }
        if let selectedDate { RuleMark(x: .value("選択時点", selectedDate)).foregroundStyle(Color(uiColor: .label)).lineStyle(StrokeStyle(lineWidth: 2)) }
    }
    @ChartContentBuilder private var cursorMarker: some ChartContent {
        if let cursorPoint { RuleMark(x: .value("カーソル", cursorPoint.timestamp)).foregroundStyle(.secondary).lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 2])) }
    }
    private func visible(_ date: Date) -> Bool { cutoff.map { date <= $0 } ?? true }
    private func legend(_ text: String, _ color: Color) -> some View { HStack(spacing: 3) { Rectangle().fill(color).frame(width: 10, height: 2); Text(text) } }
    private func modeLabel(_ item: MarketChartMode) -> String { item == .relative ? "\(benchmarkTicker)対比" : item.rawValue }
    private func axisLabel(_ date: Date) -> String {
        if resolution == .day {
            return store.timezone == .jst
                ? AppFormatters.jstMonthDay.string(from: date)
                : AppFormatters.etMonthDay.string(from: date)
        }
        return switch store.timezone {
        case .et: AppFormatters.et.string(from: date)
        case .jst: AppFormatters.jst.string(from: date)
        // Two time zones on every tick are too wide on iPhone. The cursor keeps
        // the complete ET/JST value while the axis stays legible in the primary
        // policy-publication time zone.
        case .both: AppFormatters.et.string(from: date)
        }
    }
    private func windowLabel(_ window: ReactionWindow) -> String {
        switch window {
        case .fiveMinutes: "公式公開後5分"
        case .thirtyMinutes: "公式公開後30分"
        case .twoHours: "公式公開後2時間"
        case .sameDayClose: "公式公開から当日終値"
        case .nextDayClose: "公式公開から翌日終値"
        case .fiveTradingDays: "公式公開から5営業日"
        case .nextRegularSessionOpen: "次回通常取引寄付"
        case .fiveMinutesAfterOpen: "寄付後5分"
        case .thirtyMinutesAfterOpen: "寄付後30分"
        case .twoHoursAfterOpen: "寄付後2時間"
        case .previousCloseToOpen: "前営業日終値から当日始値"
        case .previousCloseToClose: "前営業日終値から当日終値"
        case .closeToNextClose: "当日終値から翌日終値"
        case .fiveTradingDayReturn: "5営業日リターン"
        case .thirtyMinutesFromDetection: "システム検知後30分"
        }
    }
    private var sessionLabel: String {
        if seriesOverride != nil {
            return "表示粒度: \(resolution.labelJA)・端末から取得"
        }
        guard let publication = event.publishedAt ?? event.detectedAt else { return "取引時間区分: 時刻不明" }
        let precision = event.relatedDocuments.first(where: { $0.relationship == .primary })?.timePrecision ?? .minute
        switch MarketStudyCalculator.plan(timePrecision: precision, publication: publication) {
        case .regularSessionMinute: return "取引時間区分: 通常取引時間・分足評価"
        case .conservativeHourly: return "取引時間区分: 時間単位・保守的評価"
        case .nextRegularSessionOpen: return "取引時間区分: 通常取引時間外・次回寄付基準"
        case .dailyBecauseTimeUnknown: return "取引時間区分: 時刻不明のため日次評価"
        }
    }
    private var provenanceLabel: String {
        if event.isSynthetic && provenanceOverride == nil { return "提供元: デモデータ・合成値・実市場データではありません" }
        guard let provenance = provenanceOverride ?? event.marketProvenance else { return "提供元情報未確認" }
        let delay = provenance.delayStatus.map { "・遅延: \($0)" } ?? ""
        return "提供元: \(provenance.provider)・\(provenance.attribution)\(delay)"
    }
    private var confounderLabel: String {
        if event.confounders.isEmpty { return event.confounderReviewState?.labelJA ?? "未確認" }
        return "\(event.confounders.count)件・\(event.confounderReviewState?.labelJA ?? "未確認")"
    }

    private var chartDescription: String {
        switch mode {
        case .price:
            "価格指数（取得範囲の開始=100）・\(resolution.labelJA)・横軸\(axisTimezoneLabel)"
        case .relative:
            "\(securityTicker)騰落率 − \(benchmarkTicker)騰落率（pt）・横軸\(axisTimezoneLabel)"
        case .volume:
            "発表前の取得範囲平均比（倍）・横軸\(axisTimezoneLabel)"
        }
    }

    private var axisTimezoneLabel: String {
        store.timezone == .jst ? "JST" : "ET"
    }

    private func paddedDomain(_ values: [Double], minimumPadding: Double) -> ClosedRange<Double> {
        guard let minimum = values.min(), let maximum = values.max() else {
            return (100 - minimumPadding)...(100 + minimumPadding)
        }
        let padding = max((maximum - minimum) * 0.15, minimumPadding)
        return (minimum - padding)...(maximum + padding)
    }
}
