import Foundation

enum MarketEvaluationPlan: Equatable {
    case regularSessionMinute
    case conservativeHourly
    case nextRegularSessionOpen
    case dailyBecauseTimeUnknown
}

enum MarketChartResolution: String, Equatable {
    case minute
    case hour
    case day

    var labelJA: String {
        switch self {
        case .minute: "1分足"
        case .hour: "1時間足"
        case .day: "日足"
        }
    }
}

struct OnDeviceMarketStudy {
    let points: [MarketPoint]
    let summary: MarketSummary?
    let provenance: MarketDataProvenance
    let resolution: MarketChartResolution
    let ticker: String
    let benchmarkTicker: String
    let volumeBaselineLabel: String
}

struct OnDeviceMarketStudyLoader {
    let provider: any MarketDataProvider

    func load(event: PolicyEvent, ticker: String, benchmarkTicker: String) async throws -> OnDeviceMarketStudy {
        let ticker = normalizedSymbol(ticker)
        let benchmarkTicker = normalizedSymbol(benchmarkTicker)
        guard !ticker.isEmpty, !benchmarkTicker.isEmpty, ticker != benchmarkTicker else {
            throw MarketProviderError.provider("対象銘柄と比較対象を別々に指定してください。")
        }

        let anchor = event.publishedAt ?? event.detectedAt ?? event.anchorDate
        let precision = event.relatedDocuments
            .first(where: { $0.relationship == .primary })?
            .timePrecision
            ?? (event.publishedAt == nil ? .day : .minute)
        let request = requestPlan(
            for: MarketStudyCalculator.plan(timePrecision: precision, publication: anchor),
            anchor: anchor
        )
        let now = Date()
        let fetchEnd = min(request.fetchEnd, now)
        guard request.fetchStart < fetchEnd else {
            throw MarketProviderError.provider("この資料の評価窓はまだ始まっていません。")
        }

        async let securityResponse = provider.bars(
            request: MarketBarsRequest(
                symbol: ticker,
                interval: request.interval,
                outputSize: request.outputSize,
                startDate: request.fetchStart,
                endDate: fetchEnd
            )
        )
        async let benchmarkResponse = provider.bars(
            request: MarketBarsRequest(
                symbol: benchmarkTicker,
                interval: request.interval,
                outputSize: request.outputSize,
                startDate: request.fetchStart,
                endDate: fetchEnd
            )
        )
        let (security, benchmark) = try await (securityResponse, benchmarkResponse)
        guard security.providerID == benchmark.providerID else {
            throw MarketProviderError.invalidResponse
        }

        let preEventVolumes = security.bars
            .filter { $0.timestamp < anchor && $0.volume > 0 }
            .map(\.volume)
        let baselineVolume = preEventVolumes.isEmpty
            ? security.bars.filter { $0.volume > 0 }.map(\.volume).average
            : preEventVolumes.average
        let points = MarketStudyCalculator.points(
            security: security.bars,
            benchmark: benchmark.bars,
            baselineVolume: baselineVolume
        )
        guard points.count >= 2 else {
            throw MarketProviderError.provider("対象銘柄と比較対象で時刻が一致するデータを取得できませんでした。")
        }

        let summary: MarketSummary? = if now >= request.summaryEnd {
            MarketStudyCalculator.summary(
                points: points,
                ticker: ticker,
                benchmark: benchmarkTicker,
                window: request.window,
                availableAt: request.summaryEnd,
                start: request.summaryStart,
                end: request.summaryEnd
            )
        } else {
            nil
        }
        return OnDeviceMarketStudy(
            points: points,
            summary: summary,
            provenance: MarketDataProvenance(
                provider: security.providerID,
                licenseMode: MarketDataLicenseMode.bringYourOwnKey.rawValue,
                attribution: security.attribution,
                delayStatus: security.isDelayed || benchmark.isDelayed ? "遅延条件はデータ提供元契約に従います" : nil
            ),
            resolution: request.resolution,
            ticker: ticker,
            benchmarkTicker: benchmarkTicker,
            volumeBaselineLabel: "出来高比は取得範囲内の発表前平均を1.0とします。"
        )
    }

    private func normalizedSymbol(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
            .filter { $0.isLetter || $0.isNumber || ".:-/".contains($0) }
    }

    private func requestPlan(for plan: MarketEvaluationPlan, anchor: Date) -> RequestPlan {
        switch plan {
        case .regularSessionMinute:
            RequestPlan(
                interval: "1min",
                outputSize: 120,
                fetchStart: anchor.addingTimeInterval(-30 * 60),
                fetchEnd: anchor.addingTimeInterval(60 * 60),
                summaryStart: anchor,
                summaryEnd: anchor.addingTimeInterval(30 * 60),
                resolution: .minute,
                window: .thirtyMinutes
            )
        case .conservativeHourly:
            RequestPlan(
                interval: "1h",
                outputSize: 16,
                fetchStart: anchor.addingTimeInterval(-4 * 60 * 60),
                fetchEnd: anchor.addingTimeInterval(6 * 60 * 60),
                summaryStart: anchor,
                summaryEnd: anchor.addingTimeInterval(2 * 60 * 60),
                resolution: .hour,
                window: .twoHours
            )
        case .nextRegularSessionOpen:
            RequestPlan(
                interval: "1h",
                outputSize: 32,
                fetchStart: anchor.addingTimeInterval(-24 * 60 * 60),
                fetchEnd: anchor.addingTimeInterval(3 * 24 * 60 * 60),
                summaryStart: anchor.addingTimeInterval(-4 * 60 * 60),
                summaryEnd: anchor.addingTimeInterval(24 * 60 * 60),
                resolution: .hour,
                window: .previousCloseToOpen
            )
        case .dailyBecauseTimeUnknown:
            RequestPlan(
                interval: "1day",
                outputSize: 30,
                fetchStart: anchor.addingTimeInterval(-10 * 24 * 60 * 60),
                fetchEnd: anchor.addingTimeInterval(10 * 24 * 60 * 60),
                summaryStart: anchor.addingTimeInterval(-4 * 24 * 60 * 60),
                summaryEnd: anchor.addingTimeInterval(24 * 60 * 60),
                resolution: .day,
                window: .previousCloseToClose
            )
        }
    }

    private struct RequestPlan {
        let interval: String
        let outputSize: Int
        let fetchStart, fetchEnd, summaryStart, summaryEnd: Date
        let resolution: MarketChartResolution
        let window: ReactionWindow
    }
}

enum MarketStudyCalculator {
    static func plan(timePrecision: TimePrecision, publication: Date) -> MarketEvaluationPlan {
        guard timePrecision != .day else { return .dailyBecauseTimeUnknown }
        guard timePrecision != .hour else { return .conservativeHourly }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        let components = calendar.dateComponents([.weekday, .hour, .minute], from: publication)
        guard let weekday = components.weekday, (2...6).contains(weekday) else {
            return .nextRegularSessionOpen
        }

        let minuteOfDay = (components.hour ?? 0) * 60 + (components.minute ?? 0)
        return (9 * 60 + 30..<16 * 60).contains(minuteOfDay)
            ? .regularSessionMinute
            : .nextRegularSessionOpen
    }

    static func points(
        security: [ProviderMarketBar],
        benchmark: [ProviderMarketBar],
        baselineVolume: Double
    ) -> [MarketPoint] {
        let benchmarkByTime = Dictionary(uniqueKeysWithValues: benchmark.map { ($0.timestamp, $0) })
        let aligned = security
            .compactMap { securityBar -> (ProviderMarketBar, ProviderMarketBar)? in
                guard let benchmarkBar = benchmarkByTime[securityBar.timestamp] else { return nil }
                return (securityBar, benchmarkBar)
            }
            .sorted { $0.0.timestamp < $1.0.timestamp }

        guard let first = aligned.first, first.0.close != 0, first.1.close != 0 else { return [] }
        let effectiveBaselineVolume = baselineVolume > 0 ? baselineVolume : first.0.volume

        return aligned.map { securityBar, benchmarkBar in
            let normalizedSecurity = securityBar.close / first.0.close * 100
            let normalizedBenchmark = benchmarkBar.close / first.1.close * 100
            return MarketPoint(
                timestamp: securityBar.timestamp,
                normalizedSecurityPrice: normalizedSecurity,
                normalizedBenchmarkPrice: normalizedBenchmark,
                abnormalReturnPoints: normalizedSecurity - normalizedBenchmark,
                volumeRatio: effectiveBaselineVolume > 0 ? securityBar.volume / effectiveBaselineVolume : 0
            )
        }
    }

    static func summary(
        points: [MarketPoint],
        ticker: String,
        benchmark: String,
        window: ReactionWindow,
        availableAt: Date
    ) -> MarketSummary? {
        guard let first = points.first, let last = points.last, points.count > 1,
              first.normalizedSecurityPrice != 0, first.normalizedBenchmarkPrice != 0 else { return nil }

        let securityReturn = last.normalizedSecurityPrice / first.normalizedSecurityPrice - 1
        let benchmarkReturn = last.normalizedBenchmarkPrice / first.normalizedBenchmarkPrice - 1
        let abnormalReturn = securityReturn - benchmarkReturn
        return MarketSummary(
            window: window,
            availableAt: availableAt,
            ticker: ticker,
            benchmarkTicker: benchmark,
            securityReturn: securityReturn,
            benchmarkReturn: benchmarkReturn,
            abnormalReturn: abnormalReturn,
            maxVolumeRatio: points.map(\.volumeRatio).max() ?? 0,
            abnormalReactionDetected: abs(abnormalReturn) >= 0.03
        )
    }

    static func summary(
        points: [MarketPoint],
        ticker: String,
        benchmark: String,
        window: ReactionWindow,
        availableAt: Date,
        start: Date,
        end: Date
    ) -> MarketSummary? {
        guard points.count > 1, start < end,
              let first = points.min(by: {
                  abs($0.timestamp.timeIntervalSince(start)) < abs($1.timestamp.timeIntervalSince(start))
              }),
              let last = points.min(by: {
                  abs($0.timestamp.timeIntervalSince(end)) < abs($1.timestamp.timeIntervalSince(end))
              }),
              first.timestamp < last.timestamp,
              first.normalizedSecurityPrice != 0,
              first.normalizedBenchmarkPrice != 0 else {
            return nil
        }
        let securityReturn = last.normalizedSecurityPrice / first.normalizedSecurityPrice - 1
        let benchmarkReturn = last.normalizedBenchmarkPrice / first.normalizedBenchmarkPrice - 1
        let abnormalReturn = securityReturn - benchmarkReturn
        let volumeRange = points.filter { $0.timestamp >= first.timestamp && $0.timestamp <= last.timestamp }
        return MarketSummary(
            window: window,
            availableAt: max(availableAt, last.timestamp),
            ticker: ticker,
            benchmarkTicker: benchmark,
            securityReturn: securityReturn,
            benchmarkReturn: benchmarkReturn,
            abnormalReturn: abnormalReturn,
            maxVolumeRatio: volumeRange.map(\.volumeRatio).max() ?? 0,
            abnormalReactionDetected: abs(abnormalReturn) >= 0.03
        )
    }

    static func visible(points: [MarketPoint], asOf: Date) -> [MarketPoint] {
        points.filter { $0.timestamp <= asOf }
    }
}

private extension Array where Element == Double {
    var average: Double {
        guard !isEmpty else { return 0 }
        return reduce(0, +) / Double(count)
    }
}
