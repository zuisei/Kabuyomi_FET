import SwiftUI

private enum OnDeviceMarketChartScope: String, CaseIterable, Identifiable {
    case asOf = "選択時点まで"
    case evaluation = "評価窓まで"

    var id: Self { self }
}

struct OnDeviceMarketChart: View {
    let event: PolicyEvent
    let cutoff: Date?
    let selectedDate: Date?

    @State private var ticker: String
    @State private var benchmarkTicker = "SPY"
    @State private var hasProviderKey = MarketDataKeychain.read() != nil
    @State private var study: OnDeviceMarketStudy?
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var showsConnection = false
    @State private var chartScope = OnDeviceMarketChartScope.asOf

    init(event: PolicyEvent, cutoff: Date?, selectedDate: Date?) {
        self.event = event
        self.cutoff = cutoff
        self.selectedDate = selectedDate
        _ticker = State(initialValue: Self.suggestedTickers(for: event).first ?? "")
    }

    private var suggestedTickers: [String] {
        Self.suggestedTickers(for: event)
    }

    private var selectedRelation: PolicyCompanyRelation? {
        event.productAnalysis.companyRelations.first {
            $0.ticker?.localizedCaseInsensitiveCompare(ticker) == .orderedSame
        }
    }

    private var canLoad: Bool {
        let normalizedTicker = normalizedSymbol(ticker)
        let normalizedBenchmark = normalizedSymbol(benchmarkTicker)
        return hasProviderKey
            && !normalizedTicker.isEmpty
            && !normalizedBenchmark.isEmpty
            && normalizedTicker != normalizedBenchmark
            && !isLoading
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Divider()
            HStack {
                Text("この時点の市場")
                    .font(.headline)
                Spacer()
                Label("端末から取得", systemImage: "iphone.and.arrow.forward")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            if hasProviderKey {
                configuration
            } else {
                connectionRequired
            }

            if isLoading {
                ProgressView("市場データを取得中")
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("marketChart.onDevice.error")
            }

            if let study {
                Picker("チャート表示範囲", selection: $chartScope) {
                    ForEach(OnDeviceMarketChartScope.allCases) { scope in
                        Text(scope.rawValue).tag(scope)
                    }
                }
                .pickerStyle(.segmented)

                if chartScope == .evaluation {
                    Label(
                        "選択時点より後の値動きを含みます。政策情報のスナップショットには混ぜません。",
                        systemImage: "clock.arrow.2.circlepath"
                    )
                    .font(.caption)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                MinuteReactionChart(
                    event: event,
                    cutoff: chartScope == .asOf
                        ? cutoff
                        : study.summary?.availableAt ?? study.points.last?.timestamp,
                    selectedDate: selectedDate,
                    seriesOverride: study.points,
                    summariesOverride: study.summary.map { [$0] } ?? [],
                    provenanceOverride: study.provenance,
                    resolution: study.resolution,
                    volumeBaselineLabel: study.volumeBaselineLabel,
                    tickerOverride: study.ticker,
                    benchmarkTickerOverride: study.benchmarkTicker
                )
            }
        }
        .sheet(isPresented: $showsConnection, onDismiss: {
            hasProviderKey = MarketDataKeychain.read() != nil
        }) {
            NavigationStack {
                MarketDataConnectionView(showsDoneButton: true) {
                    hasProviderKey = true
                }
            }
        }
        .onAppear {
            hasProviderKey = MarketDataKeychain.read() != nil
        }
        .onChange(of: cutoff) {
            chartScope = .asOf
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("marketChart.onDevice")
    }

    private var connectionRequired: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("実市場データは未接続です", systemImage: "chart.xyaxis.line")
                .font(.subheadline.weight(.semibold))
            Text("自分のTwelve Data APIキーを端末へ保存すると、この本番資料に対象銘柄と比較対象を指定してチャートを読み込めます。")
                .font(.subheadline)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button("市場データを接続") {
                showsConnection = true
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("marketChart.connect")
        }
    }

    private var configuration: some View {
        VStack(alignment: .leading, spacing: 12) {
            if suggestedTickers.isEmpty {
                Text("この資料には関連銘柄が確定していません。表示したい銘柄を指定してください。")
                    .font(.caption)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            } else {
                Picker("資料内の関連候補", selection: $ticker) {
                    ForEach(suggestedTickers, id: \.self) { value in
                        Text(value).tag(value)
                    }
                }
                .pickerStyle(.menu)
            }

            LabeledContent("対象銘柄") {
                TextField("例: GM", text: $ticker)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .frame(maxWidth: 140)
            }
            LabeledContent("比較対象") {
                TextField("例: SPY", text: $benchmarkTicker)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .frame(maxWidth: 140)
            }

            if let selectedRelation {
                Text(
                    selectedRelation.reviewStatus == .approved
                        ? "\(selectedRelation.issuerName)との関連が確認済みです。"
                        : "\(selectedRelation.issuerName)は資料から抽出した関連候補・未検証です。"
                )
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Button {
                load()
            } label: {
                Label(study == nil ? "実データを読み込む" : "チャートを更新", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!canLoad)
            .accessibilityIdentifier("marketChart.load")

            Text("APIキーと価格データはMarket Docketのサーバーへ送信しません。データ提供元の表示条件に従い、政策との因果関係は示しません。")
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func load() {
        isLoading = true
        errorMessage = nil
        study = nil
        chartScope = .asOf
        let ticker = normalizedSymbol(ticker)
        let benchmark = normalizedSymbol(benchmarkTicker)
        self.ticker = ticker
        benchmarkTicker = benchmark

        Task {
            do {
                let provider = try TwelveDataBYOKProvider()
                let value = try await OnDeviceMarketStudyLoader(provider: provider).load(
                    event: event,
                    ticker: ticker,
                    benchmarkTicker: benchmark
                )
                await MainActor.run {
                    study = value
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }

    private func normalizedSymbol(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
            .filter { $0.isLetter || $0.isNumber || ".:-/".contains($0) }
    }

    private static func suggestedTickers(for event: PolicyEvent) -> [String] {
        let relations = event.productAnalysis.companyRelations.compactMap(\.ticker)
        let values = relations + event.tickers + event.exposures.map(\.ticker)
        var seen = Set<String>()
        return values.compactMap { value in
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard !normalized.isEmpty, seen.insert(normalized).inserted else { return nil }
            return normalized
        }
    }
}
