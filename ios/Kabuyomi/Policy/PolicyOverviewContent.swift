import SwiftUI

struct PolicyOverviewContent: View {
    let event: PolicyEvent
    var translationStatus: TranslationRequestStatus?
    var translationIsSubmitting = false
    var translationErrorMessage: String?
    var requestTranslation: (() -> Void)?
    var refresh: (() async -> Void)?
    var goToReplay: (() -> Void)?
    var goToEvidence: (() -> Void)?
    @State private var detailsExpanded = false
    @State private var originalTitleExpanded = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var analysis: PolicyAnalysis { event.productAnalysis }
    private var accessibilityLayout: Bool { dynamicTypeSize.isAccessibilitySize }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                briefHeader
                if event.translation == nil,
                   let translationStatus,
                   translationStatus.state != .translated,
                   translationStatus.state != .unavailable {
                    TranslationRequestControl(
                        status: translationStatus,
                        isSubmitting: translationIsSubmitting,
                        errorMessage: translationErrorMessage,
                        request: requestTranslation
                    )
                }
                editorialBrief
                affectedTargets
                legalDates
                market
                DocumentRelationshipStrip(documents: event.relatedDocuments)
                evidenceLinks
                timePrecision
                DisclosureGroup("補足情報", isExpanded: $detailsExpanded) {
                    VStack(alignment: .leading, spacing: 16) {
                        importantClauses
                        confounders
                        legacyExposures
                        keyFacts
                    }.padding(.top, 8)
                }
                .font(.headline)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
        .refreshable { await refresh?() }
        .accessibilityIdentifier("policyOverview.content")
    }

    private var briefHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            briefMetadata
            Text(event.displayTitleJA).font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
            if event.titleEN.nonEmpty != nil {
                DisclosureGroup("原題を見る", isExpanded: $originalTitleExpanded) {
                    Text(event.titleEN)
                        .font(.subheadline)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                }
                .font(.subheadline.weight(.semibold))
                .tint(KabuyomiTheme.ink)
            }
            briefStatuses
        }
    }

    @ViewBuilder private var briefMetadata: some View {
        if accessibilityLayout {
            VStack(alignment: .leading, spacing: 3) {
                Text(event.displayAgencyCode).font(.headline)
                Text(event.policyDomain?.labelJA ?? event.category.displayNameJA).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                Text(analysis.presentationTier.labelJA).font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(event.displayAgencyCode).font(.headline)
                Text(event.policyDomain?.labelJA ?? event.category.displayNameJA).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                Spacer()
                Text(analysis.presentationTier.labelJA).font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
    }

    private var briefStatuses: some View {
        Group {
            if accessibilityLayout {
                VStack(alignment: .leading, spacing: 5) { briefStatusLabels }
            } else {
                HStack(spacing: 10) { briefStatusLabels }
            }
        }
    }

    @ViewBuilder private var briefStatusLabels: some View {
        if event.translation == nil,
           event.titleJA.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedCaseInsensitiveCompare(event.titleEN.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame {
            Label("原題・日本語未作成", systemImage: "doc.text")
                .font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
        } else if let translation = event.titleTranslationLabelJA {
            Label(translation, systemImage: "globe")
                .font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
        }
        Label(
            analysis.publicAnalysisLabelJA,
            systemImage: analysis.isAutomaticallySelectedSignal ? "line.3.horizontal.decrease.circle" : "pencil.and.list.clipboard"
        )
        .font(.caption.weight(.semibold))
        .foregroundStyle(KabuyomiTheme.inkMuted)
        if event.status == .corrected {
            EventMetadataLabel(text: "訂正文書あり", systemImage: "doc.badge.gearshape", tint: AppColors.revision)
        }
    }

    private var editorialBrief: some View {
        VStack(alignment: .leading, spacing: 16) {
            CompactPolicySection(title: "何が変わったか") {
                if let translation = event.summaryTranslationLabelJA {
                    Label(translation, systemImage: "doc.text.magnifyingglass")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                Text(event.displayChangeSummaryJA).font(.body).fixedSize(horizontal: false, vertical: true)
            }
            CompactPolicySection(title: "なぜ重要か") {
                Text(analysis.whyItMattersJA?.nonEmpty ?? "重要性を分析中です。")
                    .font(.body).foregroundStyle(analysis.whyItMattersJA?.nonEmpty == nil ? .secondary : .primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var affectedTargets: some View {
        CompactPolicySection(title: "対象") {
            targetRow("地域", analysis.affectedRegionCodes)
            targetRow("業界", analysis.affectedSectorCodes)
            targetRow("製品", analysis.affectedProductTerms)
            if analysis.companyRelations.isEmpty && event.exposures.isEmpty {
                summaryRow("企業", analysis.noCompanyReasonJA?.nonEmpty ?? "関連候補を確認中")
            } else {
                ForEach(analysis.companyRelations) { relation in
                    HStack(alignment: .firstTextBaseline) {
                        Text(relation.ticker ?? relation.issuerName).font(.subheadline.weight(.semibold))
                        if relation.ticker != nil { Text(relation.issuerName).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted) }
                        Spacer()
                        Text(relation.reviewStatus == .approved ? relation.relationType.labelJA : "関連候補")
                            .font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
                ForEach(event.exposures) { exposure in
                    HStack(alignment: .firstTextBaseline) {
                        Text(exposure.ticker).font(.subheadline.bold().monospaced())
                        Text(exposure.companyName).font(.subheadline)
                        Spacer()
                        Text(exposure.relationship.label).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
            }
        }
    }

    private var legalDates: some View {
        CompactPolicySection(title: "法的日付") {
            ForEach(event.relatedDocuments) { document in
                VStack(alignment: .leading, spacing: 4) {
                    Text(legalDocumentLabel(document)).font(.subheadline.weight(.semibold))
                    if let value = document.publishedOn { summaryRow("掲載", value) }
                    if let value = document.effectiveOn { summaryRow("発効", value) }
                    if let value = document.applicableOn { summaryRow("適用", value) }
                    if let value = document.commentsCloseOn { summaryRow("意見期限", value) }
                }
            }
        }
    }

    private var market: some View {
        CompactPolicySection(title: "市場データ") {
            switch analysis.marketAnalysisMode {
            case .intraday, .daily:
                if let summary = event.marketSummaries.first {
                    Label(analysis.marketAnalysisMode.labelJA, systemImage: analysis.marketAnalysisMode.systemImage)
                        .font(.subheadline.weight(.semibold))
                    if accessibilityLayout {
                        VStack(alignment: .leading, spacing: 7) {
                            summaryRow(summary.ticker, AppFormatters.percent(summary.securityReturn))
                            summaryRow("\(summary.benchmarkTicker)対比", AppFormatters.points(summary.abnormalReturn))
                            summaryRow("出来高", "通常比 \(String(format: "%.1f", summary.maxVolumeRatio))倍")
                        }
                    } else {
                        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 5) {
                            factsRow(summary.ticker, AppFormatters.percent(summary.securityReturn))
                            factsRow("\(summary.benchmarkTicker)対比", AppFormatters.points(summary.abnormalReturn))
                            factsRow("出来高", "通常比 \(String(format: "%.1f", summary.maxVolumeRatio))倍")
                        }
                    }
                    Text("公式公開後の値動きを記述します。因果関係は未確定です。").font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                    if let goToReplay { Button("リプレイで確認", action: goToReplay).buttonStyle(.borderless) }
                } else {
                    MarketDataStateMessage(
                        title: "市場データ未接続",
                        detail: analysis.marketAnalysisMode == .daily
                            ? "日足評価の候補ですが、表示可能な市場データがありません。数値やチャートは表示しません。"
                            : "分足評価の候補ですが、表示可能な市場データがありません。数値やチャートは表示しません。",
                        systemImage: analysis.marketAnalysisMode.systemImage
                    )
                }
            case .unmapped:
                MarketDataStateMessage(
                    title: "市場チャート未設定",
                    detail: "関連銘柄は確定していません。",
                    systemImage: "chart.xyaxis.line"
                )
            case .notApplicable:
                MarketDataStateMessage(
                    title: "市場評価対象外",
                    detail: analysis.noMarketDataReasonJA?.nonEmpty ?? "この政策イベントは市場評価の対象外です。",
                    systemImage: "minus.circle"
                )
            case .disabled:
                MarketDataStateMessage(
                    title: "市場データ未接続",
                    detail: "共通配信データは未接続です。",
                    systemImage: "chart.xyaxis.line"
                )
            }
            if !event.isSynthetic,
               event.marketSummaries.isEmpty,
               analysis.marketAnalysisMode != .notApplicable,
               let goToReplay {
                Button("リプレイで市場チャートを設定", action: goToReplay)
                    .buttonStyle(.borderless)
            }
        }
        .accessibilityIdentifier("overview.market.\(analysis.marketAnalysisMode.rawValue)")
    }

    private var timePrecision: some View {
        CompactPolicySection(title: "時刻精度") {
            Text(timePrecisionSummary).font(.subheadline)
            Text("日付しか確認できない資料へ架空の時刻は付与しません。").font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    private var evidenceLinks: some View {
        CompactPolicySection(title: "取得来歴と原文") {
            Text(event.translation == nil
                 ? "原文タイトル、公式URL、改訂番号、取得時刻、SHA-256は証拠画面に保持しています。"
                 : "自動翻訳と原文を分けて保持しています。原文タイトル、公式URL、改訂番号、取得時刻、SHA-256は証拠画面で確認できます。")
                .font(.subheadline).foregroundStyle(KabuyomiTheme.inkMuted)
            if let goToEvidence { Button("原文と証拠を見る", action: goToEvidence).buttonStyle(.borderless) }
        }
    }

    @ViewBuilder private var importantClauses: some View {
        if let clauses = event.importantClauses, !clauses.isEmpty {
            CompactPolicySection(title: "重要条項") {
                ForEach(clauses) { clause in Label(clause.textJA, systemImage: "text.quote").font(.subheadline) }
            }
        }
    }

    private var confounders: some View {
        CompactPolicySection(title: "交絡要因  \(event.confounders.count)件") {
            if event.confounders.isEmpty { Text(event.confounderReviewState?.labelJA ?? "未確認").foregroundStyle(KabuyomiTheme.inkMuted) }
            ForEach(event.confounders) { item in
                Label(item.titleJA, systemImage: "exclamationmark.triangle").font(.subheadline.weight(.semibold))
                Text(item.detailJA).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
    }

    @ViewBuilder private var legacyExposures: some View {
        if !event.exposures.isEmpty {
            CompactPolicySection(title: "関連企業の根拠") {
                ForEach(event.exposures) { exposure in
                    Text(exposure.ticker + "  " + exposure.evidenceJA).font(.subheadline)
                }
            }
        }
    }

    private var keyFacts: some View {
        CompactPolicySection(title: "資料の状態") {
            if accessibilityLayout {
                VStack(alignment: .leading, spacing: 7) {
                    summaryRow("関連文書", "\(event.relatedDocuments.count)件")
                    summaryRow("状態", event.status.listLabel)
                    summaryRow("市場モード", analysis.marketAnalysisMode.labelJA)
                    summaryRow("交絡要因", event.confounders.isEmpty ? (event.confounderReviewState?.labelJA ?? "未確認") : "\(event.confounders.count)件")
                }
            } else {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 7) {
                    factsRow("関連文書", "\(event.relatedDocuments.count)件")
                    factsRow("状態", event.status.listLabel)
                    factsRow("市場モード", analysis.marketAnalysisMode.labelJA)
                    factsRow("交絡要因", event.confounders.isEmpty ? (event.confounderReviewState?.labelJA ?? "未確認") : "\(event.confounders.count)件")
                }
            }
        }
    }

    @ViewBuilder private func targetRow(_ label: String, _ values: [String]) -> some View {
        if !values.isEmpty { summaryRow(label, values.map { PolicyTaxonomyDisplay.label(for: $0) }.joined(separator: " / ")) }
    }

    private func legalDocumentLabel(_ document: PolicyDocument) -> String {
        document.documentNumber.count > 48 ? document.typeLabel : document.typeLabel + "  " + document.documentNumber
    }

    private func factsRow(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted).gridColumnAlignment(.leading)
            Text(value).font(.subheadline.weight(.medium)).multilineTextAlignment(.trailing).gridColumnAlignment(.trailing)
        }
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        Group {
            if accessibilityLayout {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
                    Text(value).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
            } else {
                HStack(alignment: .top, spacing: 12) {
                    Text(label).font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted).frame(width: 54, alignment: .leading)
                    Text(value).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var timePrecisionSummary: String {
        let precisions = Set(event.relatedDocuments.map(\.timePrecision))
        if precisions == [.day] { return "公式資料は掲載日単位・時刻未確定" }
        if precisions.contains(.hour) { return "時間単位・分秒未確定の資料を含みます" }
        if precisions.contains(.minute) { return "公式の利用可能時刻を分単位で確認" }
        return "公式の利用可能時刻を秒単位で確認"
    }
}
