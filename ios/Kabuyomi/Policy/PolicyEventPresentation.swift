import Foundation

enum PolicyTaxonomyDisplay {
    private static let labels: [String: String] = [
        "US": "米国", "Brazil": "ブラジル", "China": "中国", "Macau": "マカオ", "Vietnam": "ベトナム", "allied-countries": "同盟国",
        "defense": "防衛", "critical-materials": "重要資材", "manufacturing": "製造業", "imports": "輸入", "digital-payments": "電子決済", "agriculture": "農業",
        "exchanges": "取引所", "derivatives": "デリバティブ", "clearing": "清算", "securities": "証券", "asset-management": "資産運用", "brokerage": "証券仲介",
        "health-insurance": "医療保険", "insurance-exchanges": "保険取引所", "building-materials": "建材", "wood-products": "木材製品",
        "nuclear": "原子力", "isotopes": "同位体", "medical-supply": "医療供給", "wireless": "無線", "satellite": "衛星", "broadband": "ブロードバンド",
        "military-education": "軍事教育", "exporters": "輸出企業", "advanced-manufacturing": "先端製造", "security futures": "証券先物"
    ]

    static func label(for value: String) -> String { labels[value] ?? value }
}

enum PolicyTitlePresentation {
    private static let sourceCorrectionPattern = #"(?:;\s*)?(?:Correction|Correcting Amendment)\s*$"#
    private static let translatedCorrectionPattern = #"[\s　]*[；;][\s　]*(?:訂正|修正)[\s　]*$"#

    static func safeTitleJA(
        _ titleJA: String,
        titleEN: String,
        instrumentType: PolicyInstrumentType?
    ) -> String {
        let sourceIsCorrection = instrumentType == .correctingAmendment
            || titleEN.range(of: sourceCorrectionPattern, options: [.regularExpression, .caseInsensitive]) != nil
        guard !sourceIsCorrection else { return titleJA }
        return titleJA.replacingOccurrences(
            of: translatedCorrectionPattern,
            with: "",
            options: .regularExpression
        ).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum TimelineFilter: String, CaseIterable, Identifiable {
    case recent = "新着"
    case deadlines = "期限"
    case signal = "注目"
    case market = "市場データ"
    case corrected = "訂正"
    case monitor = "確認中"
    case all = "全資料"

    static var allCases: [TimelineFilter] { [.recent, .deadlines, .signal, .corrected, .market, .all] }
    var id: Self { self }
    var compactTitle: String {
        switch self {
        case .market: "市場あり"
        default: rawValue
        }
    }
    var explanationJA: String {
        switch self {
        case .recent: "直近24時間に新規公開または更新された公式資料を表示します。"
        case .deadlines: "公式資料に明記された意見募集期限、発効日、適用開始日を期限順に表示します。推定日は含めません。"
        case .signal: "公式資料に基づく自動分析が必要項目を満たし、重要政策として自動選定された資料を表示します。"
        case .market: "表示可能な市場データが実際にある政策だけを表示します。評価候補や未接続状態は含めません。"
        case .corrected: "訂正文書、または公式な訂正状態を確認した政策を表示します。"
        case .monitor: "公式資料は取得済みですが、自動選定の必要項目が不足している資料、または確認対象として分類された資料を表示します。"
        case .all: "取得済みの公式資料を、アーカイブを含めてすべて表示します。"
        }
    }
    var systemImage: String {
        switch self {
        case .recent: "clock.badge"
        case .deadlines: "calendar.badge.clock"
        case .signal: "checkmark.seal"
        case .market: "chart.xyaxis.line"
        case .corrected: "doc.badge.gearshape"
        case .monitor: "clock.badge.questionmark"
        case .all: "tray.full"
        }
    }
    @MainActor func includes(_ event: PolicyEvent, store: SavedEventStore) -> Bool {
        switch self {
        case .recent:
            Self.isRecent(event.lastActivityAt)
        case .deadlines:
            PolicyDeadlinePresentation.hasRelevantDate(
                event.relatedDocuments.flatMap(PolicyLegalDateSummary.dates(for:)),
                relativeTo: .now
            )
        case .signal:
            event.productAnalysis.isAutomaticallySelectedSignal
        case .market:
            [.intraday, .daily].contains(event.productAnalysis.marketAnalysisMode)
                && (!event.marketSeries.isEmpty || !event.marketSummaries.isEmpty)
        case .corrected: event.status == .corrected || event.relatedDocuments.contains { $0.documentType == .correctingAmendment }
        case .monitor:
            event.productAnalysis.presentationTier == .monitor
                || (event.productAnalysis.presentationTier == .signal
                    && !event.productAnalysis.isAutomaticallySelectedSignal)
        case .all: true
        }
    }
    @MainActor func includes(_ event: PolicyEventSummary, store: SavedEventStore) -> Bool {
        switch self {
        case .recent:
            Self.isRecent(event.lastActivityAt)
        case .deadlines:
            PolicyDeadlinePresentation.hasRelevantDate(event.legalDates ?? [], relativeTo: .now)
        case .signal:
            event.productAnalysis.isAutomaticallySelectedSignal
        case .market:
            [.intraday, .daily].contains(event.productAnalysis.marketAnalysisMode) && event.hasMarketData
        case .corrected: event.status == .corrected || event.hasCorrectionDocument
        case .monitor:
            event.productAnalysis.presentationTier == .monitor
                || (event.productAnalysis.presentationTier == .signal
                    && !event.productAnalysis.isAutomaticallySelectedSignal)
        case .all: true
        }
    }

    static func isRecent(_ lastActivityAt: Date, relativeTo referenceDate: Date = .now) -> Bool {
        lastActivityAt >= referenceDate.addingTimeInterval(-24 * 60 * 60)
            && lastActivityAt <= referenceDate.addingTimeInterval(5 * 60)
    }
}

extension PolicyLegalDateSummary {
    init?(document: PolicyDocument, kind: PolicyLegalDateKind, date: String?) {
        guard let date else { return nil }
        self.init(
            kind: kind,
            date: date,
            documentID: document.id,
            documentNumber: document.documentNumber,
            officialURL: document.officialURL
        )
    }

    static func dates(for document: PolicyDocument) -> [PolicyLegalDateSummary] {
        [
            PolicyLegalDateSummary(document: document, kind: .commentsClose, date: document.commentsCloseOn),
            PolicyLegalDateSummary(document: document, kind: .effective, date: document.effectiveOn),
            PolicyLegalDateSummary(document: document, kind: .applicable, date: document.applicableOn)
        ].compactMap { $0 }
    }
}

extension PolicyLegalDateKind {
    var labelJA: String {
        switch self {
        case .commentsClose: "意見期限"
        case .effective: "発効日"
        case .applicable: "適用開始"
        }
    }

    var systemImage: String {
        switch self {
        case .commentsClose: "text.bubble"
        case .effective: "checkmark.circle"
        case .applicable: "calendar.badge.checkmark"
        }
    }
}

enum PolicyDeadlineWindow: Int, CaseIterable, Identifiable {
    case overdue
    case nextSevenDays
    case nextThirtyDays
    case later

    var id: Self { self }
    var titleJA: String {
        switch self {
        case .overdue: "期限超過"
        case .nextSevenDays: "7日以内"
        case .nextThirtyDays: "30日以内"
        case .later: "今後"
        }
    }
}

struct PolicyDeadlineItem: Identifiable, Hashable {
    let event: PolicyEventSummary
    let legalDate: PolicyLegalDateSummary
    let window: PolicyDeadlineWindow

    var id: String { "\(event.id.uuidString):\(legalDate.id)" }
}

enum PolicyDeadlinePresentation {
    static func items(
        from events: [PolicyEventSummary],
        relativeTo referenceDate: Date = .now,
        calendar: Calendar = .current
    ) -> [PolicyDeadlineItem] {
        events.flatMap { event in
            (event.legalDates ?? []).compactMap { legalDate in
                window(for: legalDate, relativeTo: referenceDate, calendar: calendar).map {
                    PolicyDeadlineItem(event: event, legalDate: legalDate, window: $0)
                }
            }
        }
    }

    static func hasRelevantDate(
        _ dates: [PolicyLegalDateSummary],
        relativeTo referenceDate: Date = .now,
        calendar: Calendar = .current
    ) -> Bool {
        dates.contains { window(for: $0, relativeTo: referenceDate, calendar: calendar) != nil }
    }

    static func window(
        for legalDate: PolicyLegalDateSummary,
        relativeTo referenceDate: Date = .now,
        calendar: Calendar = .current
    ) -> PolicyDeadlineWindow? {
        guard legalDate.date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
            return nil
        }
        let today = dayString(referenceDate)
        let sevenDays = dayString(calendar.date(byAdding: .day, value: 7, to: referenceDate) ?? referenceDate)
        let thirtyDays = dayString(calendar.date(byAdding: .day, value: 30, to: referenceDate) ?? referenceDate)
        let thirtyDaysAgo = dayString(calendar.date(byAdding: .day, value: -30, to: referenceDate) ?? referenceDate)

        if legalDate.date < today {
            return legalDate.kind == .commentsClose && legalDate.date >= thirtyDaysAgo ? .overdue : nil
        }
        if legalDate.date <= sevenDays { return .nextSevenDays }
        if legalDate.date <= thirtyDays { return .nextThirtyDays }
        return .later
    }

    static func shortDate(_ value: String) -> String {
        let components = value.split(separator: "-")
        guard components.count == 3 else { return value }
        return "\(components[1])/\(components[2])"
    }

    private static func dayString(_ date: Date) -> String {
        date.formatted(.iso8601.year().month().day())
    }
}

enum PolicyEvidenceBriefBuilder {
    static func text(for event: PolicyEvent) -> String {
        var lines = [
            "政策ウォッチ",
            event.displayTitleJA,
            "機関: \(event.agency.displayNameJA) (\(event.displayAgencyCode))",
            "何が変わったか: \(event.displayChangeSummaryJA)"
        ]

        if let translation = event.titleTranslationLabelJA {
            lines.append("日本語表示: \(translation)")
        } else if event.translation == nil {
            lines.append("日本語表示: 原文表示・日本語未作成")
        }

        for document in event.relatedDocuments {
            lines.append("")
            lines.append("\(document.typeLabel): \(document.documentNumber)")
            if let published = document.publishedOn { lines.append("掲載日: \(published)") }
            if let effective = document.effectiveOn { lines.append("発効日: \(effective)") }
            if let applicable = document.applicableOn { lines.append("適用開始: \(applicable)") }
            if let commentsClose = document.commentsCloseOn { lines.append("意見期限: \(commentsClose)") }
            if let url = document.officialURL { lines.append("公式資料: \(url.absoluteString)") }
        }

        lines.append("")
        if event.timestampState == .officialExact {
            lines.append("Replay基準: 公式資料に記載された公開時刻")
        } else {
            lines.append("Replay基準: 正確な公式時刻がないため、資料の掲載日または初回確認時点")
        }
        lines.append("市場変動は公式公開後の記述情報です。因果関係は未確定で、投資助言ではありません。")
        return lines.joined(separator: "\n")
    }
}

struct EventProgressStage: Identifiable, Hashable {
    var id: TimelineItemKind { kind }
    let kind: TimelineItemKind
    let shortLabel: String
    let date: Date?
}

extension PolicyEvent {
    var displayAgencyCode: String { agency.code == "WH" ? "White House" : agency.code == "DOC" ? "Commerce" : agency.code }
    var progressStages: [EventProgressStage] {
        [(.officialPublication, "公開"), (.systemDetection, "検知"), (.mediaReport, "報道"), (status == .corrected ? .correction : .documentRevision, status == .corrected ? "訂正" : "改訂"), (.marketReaction, "市場")].map { kind, label in
            EventProgressStage(kind: kind, shortLabel: label, date: timelineItems.first { $0.kind == kind }?.occurredAt)
        }
    }
    var latestKnownDate: Date { lastActivityAt }
    var elapsedFromAnchorText: String {
        let minutes = max(0, Int(lastActivityAt.timeIntervalSince(anchorDate) / 60))
        return timestampState == .systemDetectedOnly ? "検知から\(minutes)分で最終更新" : "公式公開\(minutes)分後に最終更新"
    }
    var categoryLabel: String { topics.joined(separator: " / ") }
    var hasAbnormalReaction: Bool { marketSummaries.contains(where: \.abnormalReactionDetected) }
    var displayTitleJA: String {
        PolicyTitlePresentation.safeTitleJA(
            productAnalysis.reviewedCanonicalTitleJA ?? titleJA,
            titleEN: titleEN,
            instrumentType: instrumentType
        )
    }
    var displayChangeSummaryJA: String { productAnalysis.reviewedChangeSummaryJA ?? summaryJA }
    var analysisPending: Bool { [.unreviewed, .automatedDraft].contains(productAnalysis.analysisStatus) }
    var titleTranslationLabelJA: String? { translation?.titleStatus.titleLabelJA }
    var summaryTranslationLabelJA: String? { translation?.factualSummaryStatus.summaryLabelJA }
}

extension EventStatus {
    var isFollowUp: Bool { self == .revised || self == .corrected }
    var listLabel: String { switch self { case .published: "新規"; case .revised: "文書改訂"; case .corrected: "訂正文書あり" } }
}

extension PolicyEventSummary {
    var displayAgencyCode: String { agency.code == "WH" ? "White House" : agency.code == "DOC" ? "Commerce" : agency.code }
    var elapsedFromAnchorText: String {
        if publishedAt == nil { return "掲載日単位で記録" }
        let minutes = max(0, Int(lastActivityAt.timeIntervalSince(anchorDate) / 60))
        return "公式公開\(minutes)分後に最終更新"
    }
    var displayTitleJA: String {
        PolicyTitlePresentation.safeTitleJA(
            productAnalysis.reviewedCanonicalTitleJA ?? titleJA,
            titleEN: titleEN,
            instrumentType: instrumentType
        )
    }
    var displayChangeSummaryJA: String { productAnalysis.reviewedChangeSummaryJA ?? summaryJA }
    var analysisPending: Bool { [.unreviewed, .automatedDraft].contains(productAnalysis.analysisStatus) }
    var titleTranslationLabelJA: String? { translation?.titleStatus.titleLabelJA }
    var summaryTranslationLabelJA: String? { translation?.factualSummaryStatus.summaryLabelJA }
}

extension PolicyAnalysis {
    var isAutomaticallySelectedSignal: Bool {
        guard presentationTier == .signal,
              analysisStatus != .unreviewed,
              analysisStatus != .rejected,
              canonicalTitleJA?.nonEmpty != nil,
              changeSummaryJA?.nonEmpty != nil,
              whyItMattersJA?.nonEmpty != nil,
              policyType?.nonEmpty != nil else { return false }
        return !policyDomainCodes.isEmpty || !affectedRegionCodes.isEmpty
    }

    var publicAnalysisLabelJA: String {
        if isAutomaticallySelectedSignal {
            return analysisStatus == .automatedDraft ? "自動選定・未検証" : "自動選定"
        }
        switch analysisStatus {
        case .automatedDraft: return "自動分析・未検証"
        case .editorialReviewed, .published: return "分析情報あり"
        case .unreviewed: return "分析中"
        case .rejected: return "分析対象外"
        }
    }

    var isEditoriallyApproved: Bool { analysisStatus == .editorialReviewed || analysisStatus == .published }
    var reviewedCanonicalTitleJA: String? { isEditoriallyApproved ? canonicalTitleJA?.nonEmpty : nil }
    var reviewedChangeSummaryJA: String? { isEditoriallyApproved ? changeSummaryJA?.nonEmpty : nil }
}

extension String {
    var nonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        return value
    }
}

extension PresentationTier {
    var labelJA: String { switch self { case .signal: "注目"; case .monitor: "確認中"; case .archive: "アーカイブ" } }
}

extension PolicyInstrumentType {
    var labelJA: String {
        switch self {
        case .finalRule: "最終規則"
        case .proposedRule: "規則案"
        case .interimFinalRule: "暫定最終規則"
        case .notice: "告示"
        case .correctingAmendment: "訂正・修正"
        case .withdrawal: "撤回"
        case .guidance: "指針・ガイダンス"
        case .executiveOrder: "大統領令"
        case .presidentialMemorandum: "大統領覚書"
        case .proclamation: "大統領布告"
        case .factSheet: "ファクトシート"
        case .agencyPressRelease: "政府機関の発表"
        case .sanctionsDesignation: "制裁指定"
        case .exportControlAction: "輸出管理措置"
        case .tariffAction: "関税措置"
        case .legislativeBillResolution: "法案・決議"
        case .committeeActionHearing: "委員会審議・公聴会"
        case .monetaryPolicyDecision: "金融政策決定"
        case .enforcementAction: "執行措置"
        case .grantSubsidyProgram: "補助金・助成制度"
        case .governmentContractAward: "政府契約"
        }
    }
}

extension PolicyAnalysisStatus {
    var labelJA: String {
        switch self {
        case .unreviewed: "分析中"
        case .automatedDraft: "自動分析・未検証"
        case .editorialReviewed, .published: "分析情報あり"
        case .rejected: "分析対象外"
        }
    }
}

extension PolicyTranslationFieldStatus {
    var titleLabelJA: String {
        switch self {
        case .machineTranslated: "自動翻訳・未確認"
        case .editorialReviewed: "翻訳確認済み"
        case .rejected: "翻訳非表示"
        }
    }

    var summaryLabelJA: String {
        switch self {
        case .machineTranslated: "自動生成・未検証"
        case .editorialReviewed: "要約確認済み"
        case .rejected: "要約非表示"
        }
    }
}

extension MarketAnalysisMode {
    var labelJA: String {
        switch self {
        case .intraday: "分足評価"
        case .daily: "日足評価"
        case .unmapped: "市場データなし"
        case .notApplicable: "市場評価対象外"
        case .disabled: "市場データ未接続"
        }
    }
    var systemImage: String {
        switch self {
        case .intraday: "chart.xyaxis.line"
        case .daily: "chart.line.uptrend.xyaxis"
        case .unmapped: "chart.xyaxis.line"
        case .notApplicable: "minus.circle"
        case .disabled: "lock.circle"
        }
    }
}

enum PolicyEvidenceDisplay {
    static func title(event: PolicyEvent, document: PolicyDocument, showsOriginal: Bool) -> String {
        if showsOriginal { return document.titleEN }
        if event.translation != nil { return event.displayTitleJA }
        if event.isSynthetic { return document.titleJA }
        return "日本語要点は未作成です"
    }

    static func body(event: PolicyEvent, document: PolicyDocument, showsOriginal: Bool) -> String {
        if showsOriginal { return document.bodyEN }
        if event.translation != nil { return event.displayChangeSummaryJA }
        if event.isSynthetic { return document.bodyJA }
        return "この資料の日本語要点はまだ作成されていません。「原文」で公式資料の内容を確認できます。"
    }

    static func sectionTitle(event: PolicyEvent, showsOriginal: Bool) -> String {
        if showsOriginal { return "原文抜粋" }
        if event.translation == nil && !event.isSynthetic { return "日本語要点（未作成）" }
        return event.translation == nil ? "日本語要点（デモ）" : "日本語の事実要約"
    }
}

extension CompanyRelationType {
    var labelJA: String {
        switch self {
        case .direct: "直接関連"
        case .indirect: "間接関連"
        case .supplyChain: "供給網"
        case .competitor: "競合"
        case .customer: "顧客"
        case .geographicExposure: "地域エクスポージャー"
        case .policyBeneficiary: "政策受益候補"
        case .policyRisk: "政策リスク候補"
        }
    }
}

extension TimelineItemKind {
    var label: String {
        switch self { case .officialPublication: "公式公開"; case .systemDetection: "システム検知"; case .officialStatement: "公式声明"; case .mediaReport: "最初の報道"; case .documentRevision: "文書改訂"; case .marketReaction: "市場データ"; case .correction: "訂正" }
    }
}

extension ExposureRelationship {
    var label: String {
        switch self {
        case .direct: "直接関連"
        case .indirect: "間接関連"
        case .supplier: "供給関係"
        case .supplyChain: "供給網"
        case .customer: "顧客関係"
        case .competitor: "競合関係"
        case .sectorProxy: "セクター代理"
        case .benchmark: "ベンチマーク"
        case .candidate: "関連候補"
        case .geographicExposure: "地域エクスポージャー"
        case .policyBeneficiary: "政策受益候補"
        case .policyRisk: "政策リスク候補"
        }
    }
}
extension VerificationState {
    var label: String { switch self { case .humanVerified: "検証済み"; case .systemObserved: "システム検知"; case .automaticUnverified: "自動抽出・未検証"; case .calculated: "計算値" } }
}

extension ConfounderReviewState {
    var labelJA: String {
        switch self {
        case .unreviewed: "未確認"
        case .verifiedNone: "検証済み 0件"
        case .candidate: "候補あり・未確認"
        case .verified: "検証済み"
        }
    }
}
