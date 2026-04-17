import SwiftUI

struct SummaryDrawer: View {
    let company: CompanyPayload
    let positiveInsights: [FilingInsight]
    let negativeInsights: [FilingInsight]
    let focusInsights: [FilingInsight]
    let openOriginal: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("要点")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("\(company.ticker) ・ \(company.formType)")
                        .font(.system(.footnote, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 36, height: 36)
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .kabuyomiCard(.secondary, radius: 18)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("要点を閉じる")
            }

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    SummaryLeadCard(
                        company: company,
                        tone: investorTone(for: company, positiveInsights: positiveInsights, negativeInsights: negativeInsights),
                        positiveCount: positiveInsights.count,
                        negativeCount: negativeInsights.count,
                        focusCount: focusInsights.count
                    )

                    InvestorDriverBoard(
                        company: company,
                        positiveInsights: Array(positiveInsights.prefix(3)),
                        negativeInsights: Array(negativeInsights.prefix(3))
                    )

                    InvestorFocusBoard(
                        company: company,
                        focusInsights: Array(focusInsights.prefix(3))
                    )

                    InvestorChangeBoard(
                        company: company,
                        changeInsights: Array(buildChangeInsights(for: company).prefix(3))
                    )

                    InvestorMetricMapCard(metrics: Array(orderedInvestorMetrics(for: company).prefix(5)))

                    InvestorOriginalDocumentCard(openOriginal: openOriginal)
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Rectangle().fill(Color.white.opacity(0.28)))
                .overlay(Rectangle().stroke(Color.white.opacity(0.55), lineWidth: 1))
                .shadow(color: Color.black.opacity(0.12), radius: 18, x: -8, y: 0)
        )
    }
}

private struct SummaryLeadCard: View {
    let company: CompanyPayload
    let tone: InvestorOverviewTone
    let positiveCount: Int
    let negativeCount: Int
    let focusCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("一言結論")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text(company.companyName)
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("\(company.ticker) ・ \(company.formType)")
                        .font(.system(.footnote, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                InvestorToneBadge(tone: tone)
            }

            if let sentence = summarySentence {
                Text(sentence)
                    .font(.system(.body, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("この filing の要点を短く押さえ、そのまま会話で深掘りできます。")
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            HStack(spacing: 8) {
                OverviewCountBadge(title: "良かった点", count: positiveCount, tint: KabuyomiTheme.positive)
                OverviewCountBadge(title: "気になる点", count: negativeCount, tint: KabuyomiTheme.negative)
                OverviewCountBadge(title: "論点", count: focusCount, tint: KabuyomiTheme.accentDeep)
            }

            HStack(spacing: 10) {
                SummaryMetaPill(title: "提出日", value: company.filedAt)
                SummaryMetaPill(title: "対象期末", value: company.periodOfReport)
            }
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 26)
    }

    private var summarySentence: String? {
        guard let sentence = leadSentence(from: company.summary.verdict) else { return nil }
        let normalizedSentence = sentence.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedCompanyName = company.companyName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalizedSentence == normalizedCompanyName ? nil : sentence
    }
}

private struct InvestorChangeBoard: View {
    let company: CompanyPayload
    let changeInsights: [FilingInsight]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 2) {
                    Text("前回からの変化")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("数字と本文で押さえる今回の差分")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            if changeInsights.isEmpty {
                Text("前回比で目立つ変化はまだ抽出されていません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(Array(changeInsights.enumerated()), id: \.element.id) { index, insight in
                    InvestorChangeRow(company: company, index: index + 1, insight: insight)
                }
            }
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
    }
}

private struct InvestorChangeRow: View {
    let company: CompanyPayload
    let index: Int
    let insight: FilingInsight

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(index)")
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
                .frame(width: 28, height: 28)
                .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.72)))

            VStack(alignment: .leading, spacing: 10) {
                Text(insight.text)
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)

                InsightSourceChips(company: company, sourceIds: insight.sourceIds)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.secondary, radius: 20)
    }
}

private struct InvestorOriginalDocumentCard: View {
    let openOriginal: () -> Void

    var body: some View {
        Button(action: openOriginal) {
            HStack(spacing: 12) {
                Image(systemName: "arrow.up.right.square")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 4) {
                    Text("原文を開く")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("最後に提出資料へ戻って確認する")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Text("開く")
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kabuyomiCard(.primary, radius: 24)
        }
        .buttonStyle(.plain)
    }
}

private struct SummaryMetaPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(KabuyomiTheme.inkMuted)
            Text(value)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.ink)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(KabuyomiTheme.fill(for: .secondary))
                .overlay(Capsule().stroke(KabuyomiTheme.stroke(for: .secondary), lineWidth: 1))
        )
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
        HStack(spacing: 6) {
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .bold))
            Text("\(count)")
                .font(.system(.caption, design: .rounded, weight: .bold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Capsule().fill(tint.opacity(0.12)))
    }
}

private struct InvestorMetricMapCard: View {
    let metrics: [MetricPayload]

    private var maxMagnitude: Double {
        max(metrics.compactMap(\.yoyPercent).map(abs).max() ?? 0, 10)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "chart.bar.xaxis")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 2) {
                    Text("主要指標")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("いまの値と前年同期をひと目で確認")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

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
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
    }
}

private struct InvestorMetricMapRow: View {
    let metric: MetricPayload
    let maxMagnitude: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(MetricLabeler.title(for: metric.logicalName))
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(formattedMetricValue(metric))
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    if let comparisonValue = metric.comparisonValue {
                        Text("前年 \(formattedMetricValue(comparisonValue, logicalName: metric.logicalName))")
                            .font(.system(.caption, design: .rounded, weight: .medium))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }

                Spacer(minLength: 0)

                Text(metric.yoyPercent.map { formattedSignedYoY($0) } ?? "YoY なし")
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(metricTint)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(metricTint.opacity(0.14)))
            }

            InvestorDeltaBar(yoyPercent: metric.yoyPercent, maxMagnitude: maxMagnitude)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.secondary, radius: 20)
    }

    private var metricTint: Color {
        guard let yoy = metric.yoyPercent else { return KabuyomiTheme.inkMuted }
        return yoy >= 0 ? KabuyomiTheme.positive : KabuyomiTheme.negative
    }
}

private struct InvestorDeltaBar: View {
    let yoyPercent: Double?
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

                if yoyPercent != nil {
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
        guard let yoyPercent else { return 0 }
        return min(abs(yoyPercent) / maxMagnitude, 1)
    }

    private var fillColor: Color {
        guard let yoyPercent else { return KabuyomiTheme.inkMuted }
        return yoyPercent >= 0 ? KabuyomiTheme.positive : KabuyomiTheme.negative
    }

    private var accessibilityLabel: String {
        guard let yoyPercent else { return "前年比データなし" }
        return yoyPercent >= 0 ? "前年比プラス" : "前年比マイナス"
    }

    private func horizontalOffset(for filledWidth: CGFloat) -> CGFloat {
        guard let yoyPercent else { return 0 }
        let direction: CGFloat = yoyPercent >= 0 ? 1 : -1
        return direction * (filledWidth / 2)
    }
}

private struct InvestorDriverBoard: View {
    let company: CompanyPayload
    let positiveInsights: [FilingInsight]
    let negativeInsights: [FilingInsight]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.left.arrow.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 2) {
                    Text("良かった点と気になる点")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("まず強さ、その次に注意点を見る")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            InvestorInsightLane(
                company: company,
                title: "良かった点",
                subtitle: "数字や本文で確認できる追い風",
                tint: KabuyomiTheme.positive,
                systemImage: "arrow.up.right.circle.fill",
                insights: positiveInsights,
                emptyMessage: "明確な良い材料はまだ切り出されていません。"
            )

            InvestorInsightLane(
                company: company,
                title: "気になる点",
                subtitle: "弱さや注意点として見たい論点",
                tint: KabuyomiTheme.negative,
                systemImage: "arrow.down.right.circle.fill",
                insights: negativeInsights,
                emptyMessage: "明確に気をつけたい材料はまだ切り出されていません。"
            )
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
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
                        tint: tint
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

                InsightSourceChips(company: company, sourceIds: insight.sourceIds)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 2) {
                    Text("次に詰める論点")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("会話で深掘りする順番まで見える形に")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            if focusInsights.isEmpty {
                Text("質問で深掘りしやすい論点はまだ抽出されていません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(Array(focusInsights.enumerated()), id: \.element.id) { index, insight in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 10) {
                            Text("Q\(index + 1)")
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
                        }

                        InsightSourceChips(company: company, sourceIds: insight.sourceIds)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.secondary, radius: 20)
                }
            }
        }
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
    }
}

private struct InsightSourceChips: View {
    let company: CompanyPayload
    let sourceIds: [String]

    private var chips: [String] {
        var seen = Set<String>()
        return sourceIds.compactMap { sourceId in
            guard let chunk = company.sourceChunks.first(where: { $0.sourceId == sourceId }) else {
                let fallback = "提出資料"
                return seen.insert(fallback).inserted ? fallback : nil
            }

            let label = investorFacingSourceLabel(for: chunk, in: company)
            return seen.insert(label).inserted ? label : nil
        }
    }

    var body: some View {
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(chips.prefix(2)), id: \.self) { chip in
                        Label(chip, systemImage: "bookmark")
                            .font(.system(.caption2, design: .rounded, weight: .semibold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))
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
            }
        }
    }
}
