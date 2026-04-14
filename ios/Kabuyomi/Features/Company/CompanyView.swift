import SwiftUI

private enum CompanyTab: String, CaseIterable, Identifiable {
    case summary = "決算サマリー"
    case chat = "AI チャット"

    var id: String { rawValue }
}

struct CompanyView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.openURL) private var openURL

    let ticker: String

    @State private var selectedTab: CompanyTab = .summary
    @State private var question = ""

    private var company: CompanyPayload? {
        appModel.companyPayload(for: ticker)
    }

    private var chatHistory: [LocalChatMessage] {
        appModel.chatHistory(for: ticker)
    }

    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            if let company {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        headerCard(company: company)
                        metricStrip(company: company)
                        tabPicker
                        tabBody(company: company)
                    }
                    .padding(20)
                }
                .refreshable {
                    await appModel.loadCompany(ticker: ticker, forceRefresh: true)
                }
            } else {
                ProgressView("企業データを読み込み中...")
            }
        }
        .navigationTitle(ticker)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: ticker) {
            await appModel.loadCompany(ticker: ticker)
        }
    }

    private func headerCard(company: CompanyPayload) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(company.companyName)
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.heroText)
                    Text("\(company.ticker) ・ \(company.formType)")
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.heroSubtext)
                }
                Spacer()
                Button("原文を開く") {
                    if let url = URL(string: company.primaryDocumentUrl) {
                        openURL(url)
                    }
                }
                .buttonStyle(.bordered)
                .tint(KabuyomiTheme.accentSoft)
            }

            Text(company.summary.verdict)
                .font(.system(.body, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.heroText)

            HStack(spacing: 12) {
                metaPill(title: "Filed", value: company.filedAt)
                metaPill(title: "Period", value: company.periodOfReport)
            }
        }
        .padding(20)
        .kabuyomiCard(.hero, radius: 28)
    }

    private func metricStrip(company: CompanyPayload) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(company.metrics.filter { ["revenue", "netIncome", "epsBasic"].contains($0.logicalName) }) { metric in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(MetricLabeler.title(for: metric.logicalName))
                            .font(.caption)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                        Text(formatMetric(metric))
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        if let yoy = metric.yoyPercent {
                            Text(formatYoY(yoy))
                                .foregroundStyle(yoy >= 0 ? KabuyomiTheme.positive : KabuyomiTheme.negative)
                                .font(.caption)
                        }
                    }
                    .frame(width: 132, alignment: .leading)
                    .padding(16)
                    .kabuyomiCard(.secondary, radius: 22)
                }
            }
        }
    }

    private var tabPicker: some View {
        Picker("タブ", selection: $selectedTab) {
            ForEach(CompanyTab.allCases) { tab in
                Text(tab.rawValue).tag(tab)
            }
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder
    private func tabBody(company: CompanyPayload) -> some View {
        switch selectedTab {
        case .summary:
            SummaryPanel(company: company)
        case .chat:
            ChatPanel(
                company: company,
                chatHistory: chatHistory,
                question: $question,
                isSending: appModel.chatIsSending,
                aiConsentGranted: appModel.aiConsentGranted,
                sendAction: {
                    Task {
                        let prompt = question
                        let didSend = await appModel.sendChat(question: prompt, ticker: ticker)
                        if didSend {
                            question = ""
                        }
                    }
                }
            )
        }
    }

    private func metaPill(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(KabuyomiTheme.heroSubtext)
            Text(value)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.heroText)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(Color.white.opacity(0.12))
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
        )
    }

    private func formatMetric(_ metric: MetricPayload) -> String {
        if metric.logicalName == "epsBasic" {
            return metric.value.formatted(.number.precision(.fractionLength(2)))
        }
        return metric.value.formatted(.number.notation(.compactName))
    }

    private func formatYoY(_ yoyPercent: Double) -> String {
        "\(yoyPercent.formatted(.number.precision(.fractionLength(1))))%"
    }
}

private struct SummaryPanel: View {
    let company: CompanyPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("一言結論")
                .font(.system(.headline, design: .rounded, weight: .bold))
            Text(company.summary.verdict)
                .font(.system(.body, design: .rounded))

            summarySection(title: "ハイライト", items: company.summary.highlights)
            summarySection(title: "前期比の変化", items: company.summary.changes)
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 26)
    }

    private func summarySection(title: String, items: [SummaryLinePayload]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(.headline, design: .rounded, weight: .bold))

            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.text)
                        .font(.system(.body, design: .rounded))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(item.sourceIds, id: \.self) { sourceId in
                                Text(sourceId)
                                    .font(.caption2)
                                    .foregroundStyle(KabuyomiTheme.accentDeep)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 6)
                                    .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
                            }
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .kabuyomiCard(.secondary, radius: 18)
            }
        }
    }
}

private struct ChatPanel: View {
    let company: CompanyPayload
    let chatHistory: [LocalChatMessage]
    @Binding var question: String
    let isSending: Bool
    let aiConsentGranted: Bool
    let sendAction: () -> Void

    private let suggestions = [
        "今期の利益率悪化の主因は？",
        "経営陣は需要環境をどう説明している？",
        "コスト構造の変化はどこに出ている？",
        "営業CFの動きはどう説明されている？",
        "今四半期のリスク要因は何？"
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("AI チャット")
                .font(.system(.headline, design: .rounded, weight: .bold))

            Text("回答は最新 filing の MD&A と主要 XBRL 指標に限定されます。株価見通しや売買推奨は返しません。")
                .font(.footnote)
                .foregroundStyle(KabuyomiTheme.inkMuted)

            if !aiConsentGranted {
                Text("送信時に同意確認が表示されます。内容を確認してから利用してください。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.negative)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button(suggestion) {
                            question = suggestion
                        }
                        .buttonStyle(.bordered)
                        .tint(KabuyomiTheme.accentDeep)
                    }
                }
            }

            VStack(spacing: 12) {
                ForEach(chatHistory) { message in
                    VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 6) {
                        Text(message.content)
                            .font(.system(.body, design: .rounded))
                            .padding(14)
                            .foregroundStyle(message.role == "user" ? Color.white : KabuyomiTheme.ink)
                            .background(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(message.role == "user" ? AnyShapeStyle(KabuyomiTheme.accentDeep) : KabuyomiTheme.fill(for: .secondary))
                            )
                            .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)

                        if !message.sources.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(message.sources) { source in
                                        Text(source.sourceLabelSnapshot)
                                            .font(.caption2)
                                            .foregroundStyle(KabuyomiTheme.accentDeep)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 6)
                                            .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
                                    }
                                }
                            }
                        }
                    }
                }
            }

            HStack(spacing: 10) {
                TextField("質問を入力", text: $question, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(14)
                    .kabuyomiCard(.input, radius: 18)

                Button {
                    sendAction()
                } label: {
                    if isSending {
                        ProgressView()
                            .tint(.white)
                            .frame(width: 48, height: 48)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                    }
                }
                .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
            }
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 26)
    }
}
