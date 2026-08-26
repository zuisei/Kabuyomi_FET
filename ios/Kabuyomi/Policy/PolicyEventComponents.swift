import SwiftUI

extension PolicyCategory {
    var displayNameJA: String {
        switch self {
        case .semiconductorExportControls: "輸出管理"
        case .semiconductorIndustrialPolicy: "産業政策"
        case .tariffPolicy: "関税政策"
        case .semiconductorGrantPolicy: "補助金"
        case .foreignSecurity: "外交・安全保障"
        case .defenseProcurement: "防衛・政府調達"
        case .tradeTariffs: "貿易・関税"
        case .exportControlsSanctions: "輸出管理・制裁"
        case .financialRegulation: "金融規制"
        case .monetaryPolicy: "金融政策"
        case .taxBudget: "税制・財政"
        case .antitrust: "競争政策"
        case .technologyAI: "テクノロジー・AI"
        case .telecommunications: "通信・電波"
        case .energyNuclear: "エネルギー・原子力"
        case .environmentClimate: "環境・気候"
        case .healthMedicine: "医薬品・医療"
        case .laborEmployment: "労働・雇用"
        case .immigrationBorder: "移民・国境"
        case .agricultureFood: "農業・食品"
        case .transportation: "運輸・航空・自動車"
        case .housingRealEstate: "住宅・不動産"
        case .education: "教育"
        case .consumerProtection: "消費者保護"
        case .industrialPolicy: "産業政策・補助金"
        }
    }
}

struct EventMetadataLabel: View {
    let text: String
    let systemImage: String
    var tint: Color = .secondary

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption.weight(.medium))
            .foregroundStyle(tint)
    }
}

struct PolicyEventRow: View {
    let event: PolicyEventSummary
    var body: some View {
        PolicyRowContent(event: event, compact: false)
            .frame(minHeight: TimelineRowMetrics.standardMinimumHeight, alignment: .topLeading)
    }
}

struct CompactPolicyRow: View {
    let event: PolicyEventSummary
    var highlightQuery: String? = nil
    var body: some View { PolicyRowContent(event: event, compact: true, highlightQuery: highlightQuery) }
}

enum TimelineRowMetrics {
    static let standardMinimumHeight: CGFloat = 180
}

enum PolicyEventDateLabel {
    static func text(for date: Date, relativeTo now: Date = .now, calendar: Calendar = .current) -> String {
        let dateParts = calendar.dateComponents([.year, .month, .day], from: date)
        let nowYear = calendar.component(.year, from: now)
        guard let year = dateParts.year, let month = dateParts.month, let day = dateParts.day else {
            return date.formatted(.dateTime.month(.twoDigits).day(.twoDigits))
        }
        if year == nowYear {
            return String(format: "%02d/%02d", month, day)
        }
        return String(format: "%04d/%02d/%02d", year, month, day)
    }
}

private struct PolicyRowContent: View {
    let event: PolicyEventSummary
    let compact: Bool
    var highlightQuery: String? = nil
    @EnvironmentObject private var store: SavedEventStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var analysis: PolicyAnalysis { event.productAnalysis }
    private var accessibilityLayout: Bool { dynamicTypeSize.isAccessibilitySize }
    private var showsOriginalTitle: Bool {
        event.translation == nil
            && event.titleJA.trimmingCharacters(in: .whitespacesAndNewlines)
                .localizedCaseInsensitiveCompare(event.titleEN.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame
    }
    private var targetText: String {
        let taxonomy = (analysis.affectedRegionCodes + analysis.affectedSectorCodes + analysis.affectedProductTerms).map { PolicyTaxonomyDisplay.label(for: $0) }
        let values = taxonomy + analysis.companyRelations.compactMap { $0.ticker ?? $0.issuerName }
        let fallback = (event.topics + event.tickers).filter { !$0.lowercased().hasSuffix(" null") && $0.lowercased() != "null" }
        return values.isEmpty ? fallback.joined(separator: " / ") : values.prefix(compact ? 3 : 5).joined(separator: " / ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 5 : 7) {
            topLine
            if let provenanceState {
                Label(provenanceState.text, systemImage: provenanceState.systemImage)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            }
            highlightedText(event.displayTitleJA)
                .font(compact ? .subheadline.weight(.semibold) : .headline)
                .lineLimit(accessibilityLayout ? nil : 2)
                .fixedSize(horizontal: false, vertical: true)
            highlightedText(event.displayChangeSummaryJA)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(accessibilityLayout ? nil : compact ? 1 : 2)
            if !compact, let why = analysis.whyItMattersJA?.nonEmpty {
                Text(why).font(.caption).foregroundStyle(.primary).lineLimit(accessibilityLayout ? nil : 2)
            }
            if !targetText.isEmpty {
                Text("対象  " + targetText).font(.caption2).foregroundStyle(.secondary).lineLimit(accessibilityLayout ? nil : 1)
            }
            footer
        }
        .padding(.vertical, compact ? 5 : 9)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var provenanceState: (text: String, systemImage: String)? {
        if showsOriginalTitle {
            return ("原文表示・日本語未作成", "doc.text")
        }
        if let translation = event.titleTranslationLabelJA {
            return (translation, "globe")
        }
        if analysis.analysisStatus != .unreviewed {
            return (
                analysis.publicAnalysisLabelJA,
                analysis.isAutomaticallySelectedSignal
                    ? "line.3.horizontal.decrease.circle"
                    : "pencil.and.list.clipboard"
            )
        }
        return nil
    }

    @ViewBuilder private var topLine: some View {
        if accessibilityLayout {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(dateLabel).font(.caption.weight(.semibold).monospacedDigit())
                    Text(event.displayAgencyCode).font(.caption.weight(.bold))
                    Spacer(minLength: 4)
                    statusLabel
                }
                Text(event.domain?.labelJA ?? event.topics.first ?? "政策")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(dateLabel).font(.caption.weight(.semibold).monospacedDigit())
                Text(event.displayAgencyCode).font(.caption.weight(.bold))
                Text(event.domain?.labelJA ?? event.topics.first ?? "政策").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 4)
                statusLabel
            }
        }
    }

    private var statusLabel: some View {
        Text(event.status.listLabel)
            .font(.caption.weight(.semibold))
            .foregroundStyle(event.status.isFollowUp ? AppColors.revision : .secondary)
    }

    @ViewBuilder private var footer: some View {
        if accessibilityLayout {
            VStack(alignment: .leading, spacing: 3) { documentState; marketState; localState }
        } else {
            HStack(spacing: 8) { documentState; marketState; Spacer(minLength: 2); localState }
        }
    }

    private var documentState: some View {
        Text("資料 \(event.relatedDocumentCount)件・" + (event.publishedAt == nil ? "掲載日精度" : "時刻あり"))
            .font(.caption2).foregroundStyle(.secondary)
    }

    private var marketState: some View {
        Label(marketStateLabel, systemImage: marketStateSymbol)
            .font(.caption2.weight(.medium))
            .foregroundStyle(event.hasMarketData ? AppColors.market : .secondary)
    }

    private var marketStateLabel: String {
        guard event.hasMarketData else {
            if analysis.marketAnalysisMode == .notApplicable { return "市場評価対象外" }
            if analysis.marketAnalysisMode == .unmapped { return "市場データなし" }
            return "市場データ未接続"
        }
        return analysis.marketAnalysisMode.labelJA
    }

    private var marketStateSymbol: String {
        event.hasMarketData ? analysis.marketAnalysisMode.systemImage : "chart.xyaxis.line"
    }

    @ViewBuilder private var localState: some View {
        if store.unreadCount(for: event) > 0 { Image(systemName: "circle.fill").font(.system(size: 7)).foregroundStyle(.blue).accessibilityLabel("未読") }
        if store.contains(event.id) { Image(systemName: "bookmark.fill").font(.caption2).foregroundStyle(.blue).accessibilityLabel("保存済み") }
        if store.watches(event) { Image(systemName: "eye.fill").font(.caption2).foregroundStyle(.blue).accessibilityLabel("ウォッチ対象") }
    }

    private var dateLabel: String {
        if event.publishedAt != nil, Calendar.current.isDateInToday(event.anchorDate) {
            return AppFormatters.displayTime(event.anchorDate, preference: store.timezone)
        }
        return PolicyEventDateLabel.text(for: event.lastActivityAt)
    }

    private var accessibilitySummary: String {
        var values = [dateLabel, event.displayAgencyCode, event.status.listLabel, event.displayTitleJA, event.displayChangeSummaryJA]
        if let translation = event.titleTranslationLabelJA { values.append(translation) }
        if showsOriginalTitle { values.append("原題、日本語未作成") }
        values.append(marketStateLabel)
        if store.unreadCount(for: event) > 0 { values.append("未読") }
        if store.contains(event.id) { values.append("保存済み") }
        if store.watches(event) { values.append("ウォッチ対象") }
        return values.joined(separator: "、")
    }

    private func highlightedText(_ value: String) -> Text {
        guard let highlightQuery,
              !highlightQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return Text(value)
        }
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive, .widthInsensitive]
        guard let range = PolicyEventSearch.highlightTerms(for: highlightQuery)
            .compactMap({ value.range(of: $0, options: options) })
            .min(by: { $0.lowerBound < $1.lowerBound }) else {
            return Text(value)
        }
        return Text(String(value[..<range.lowerBound]))
            + Text(String(value[range])).bold().foregroundColor(.accentColor)
            + Text(String(value[range.upperBound...]))
    }
}

extension CoverageState {
    var labelJA: String {
        switch self {
        case .metadataOnly: "公式ソース確認済み・未分析"
        case .contentFetched: "原文取得済み"
        case .sourceVerified: "公式資料確認済み"
        case .analystEnriched: "検証済み"
        case .marketMapped: "市場対応・検証済み"
        }
    }
    var systemImage: String {
        switch self { case .metadataOnly: "doc.badge.ellipsis"; case .contentFetched: "doc.text"; case .sourceVerified: "checkmark.seal"; case .analystEnriched: "person.crop.circle.badge.checkmark"; case .marketMapped: "chart.xyaxis.line" }
    }
}

struct DocumentRelationshipStrip: View {
    let documents: [PolicyDocument]

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("文書の関係").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(Array(documents.enumerated()), id: \.element.id) { index, document in
                HStack(alignment: .top, spacing: 9) {
                    VStack(spacing: 0) {
                        Circle().fill(document.documentType == .correctingAmendment ? AppColors.revision : AppColors.official).frame(width: 9, height: 9)
                        if index < documents.count - 1 { Rectangle().fill(Color.secondary.opacity(0.3)).frame(width: 1, height: 22) }
                    }.padding(.top, 4)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(document.typeLabel + "  " + document.documentNumber).font(.subheadline.weight(.semibold))
                        Text(documentSubtitle(document)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func documentSubtitle(_ document: PolicyDocument) -> String {
        var values: [String] = []
        if let publishedOn = document.publishedOn { values.append("\(publishedOn) 掲載") }
        if document.relationship == .corrects { values.append("原規則を訂正") }
        switch document.timePrecision {
        case .day: values.append("日単位")
        case .hour: values.append("時間単位")
        case .minute: values.append("分単位")
        case .exact: values.append("時刻あり")
        }
        return values.joined(separator: "・")
    }
}

struct CompactPolicySection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content()
        }
        .padding(.vertical, 2)
    }
}

struct MarketDataStateMessage: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

struct MarketDataStatusFooter: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            MarketDataStateMessage(title: title, detail: detail, systemImage: systemImage)
        }
        .padding(.top, 2)
    }
}
