import SwiftUI
import UIKit

struct PolicyEvidenceContent: View {
    let event: PolicyEvent
    @State private var selectedDocumentID: UUID?
    @State private var language: EvidenceLanguage = .japanese
    @State private var copiedMessage: String?
    @State private var historyExpanded = false
    @State private var provenanceExpanded = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var selectedDocument: PolicyDocument? {
        event.relatedDocuments.first { $0.id == selectedDocumentID } ?? event.relatedDocuments.first
    }
    private var showsVersionComparisonFirst: Bool {
        ProcessInfo.processInfo.arguments.value(after: "-screenshotMode") == "evidenceVersion"
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                documentIndex
                Picker("文書言語", selection: $language) {
                    ForEach(EvidenceLanguage.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("evidence.languagePicker")
                if let document = selectedDocument {
                    documentHeader(document)
                    if showsVersionComparisonFirst { versionComparison(document) }
                    content(document)
                    if !showsVersionComparisonFirst { versionComparison(document) }
                    legalDates(document)
                    relation(document)
                    actions(document)
                    provenance(document)
                    eventLevelEvidence
                } else {
                    ContentUnavailableView("公式文書はありません", systemImage: "doc")
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
        .overlay(alignment: .bottom) {
            if let copiedMessage { Text(copiedMessage).font(.caption.weight(.semibold)).padding(10).background(.regularMaterial, in: Capsule()).padding(.bottom, 12) }
        }
        .onAppear { if selectedDocumentID == nil { selectedDocumentID = event.relatedDocuments.first?.id } }
        .accessibilityIdentifier("policyEvidence.content")
    }

    private var documentIndex: some View {
        CompactPolicySection(title: "関連文書  \(event.relatedDocuments.count)件") {
            ForEach(event.relatedDocuments) { document in
                Button { selectedDocumentID = document.id } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selectedDocument?.id == document.id ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selectedDocument?.id == document.id ? (document.documentType == .correctingAmendment ? AppColors.revision : AppColors.official) : .secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(document.typeLabel).font(.subheadline.weight(.semibold))
                            Text(document.documentNumber).font(.caption.monospaced()).foregroundStyle(KabuyomiTheme.inkMuted)
                            Text((document.publishedOn.map { "\($0) 掲載・" } ?? "") + (document.relationship == .corrects ? "原規則を訂正" : "主文書"))
                                .font(.caption2).foregroundStyle(KabuyomiTheme.inkMuted)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.6))
                    }
                    .contentShape(Rectangle())
                    .frame(minHeight: 44)
                }.buttonStyle(.plain)
                    .accessibilityIdentifier("evidence.document.\(document.documentType.rawValue)")
            }
        }
    }

    private func documentHeader(_ document: PolicyDocument) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) {
                    Text(document.typeLabel).font(.title3.bold())
                    Text("改訂 \(document.currentRevision)").font(.caption.monospacedDigit()).foregroundStyle(KabuyomiTheme.inkMuted)
                }
            } else {
                HStack {
                    Text(document.typeLabel).font(.title3.bold())
                    Spacer()
                    Text("改訂 \(document.currentRevision)").font(.caption.monospacedDigit()).foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
            Text(PolicyEvidenceDisplay.title(event: event, document: document, showsOriginal: language == .original))
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("evidence.documentTitle")
            if language == .japanese, let translationLabel = event.titleTranslationLabelJA {
                Label(translationLabel, systemImage: "globe")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            } else if language == .original {
                Label("公式資料の原文", systemImage: "doc.text")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            Text(document.documentNumber + "・" + document.publisherJA).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    private func legalDates(_ document: PolicyDocument) -> some View {
        CompactPolicySection(title: "法的日付") {
            metadataRow("掲載日", document.publishedOn ?? "未確認")
            metadataRow("発効日", document.effectiveOn ?? "未確認")
            if let applicableOn = document.applicableOn { metadataRow("適用開始", applicableOn) }
            if let commentsCloseOn = document.commentsCloseOn { metadataRow("意見期限", commentsCloseOn) }
        }
    }

    private func timeProvenance(_ document: PolicyDocument) -> some View {
        CompactPolicySection(title: "時刻と取得来歴") {
            metadataRow("資料記載", document.sourceStatedAt ?? "記載なし")
            metadataRow("記載時刻帯", document.sourceStatedTimezone ?? "未確定")
            metadataRow("初回発見", AppFormatters.auditTime(document.firstObservedAt))
            metadataRow("MD取得", AppFormatters.auditTime(document.ingestedAt))
            metadataRow("Replay根拠", availabilityLabel(document.availabilityBasis))
            Text("初回発見・MD取得は政策Replay時刻には使用しません。")
                .font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    private func integrity(_ document: PolicyDocument) -> some View {
        CompactPolicySection(title: "完全性") {
            Button { copy(document.contentHash.value, message: "SHA-256をコピーしました") } label: {
                HStack {
                    Text(document.contentHash.scope == "official_metadata" ? "メタデータSHA-256" : "全文SHA-256").foregroundStyle(KabuyomiTheme.inkMuted)
                    Spacer()
                    Text(String(document.contentHash.value.prefix(18)) + "…").monospaced().lineLimit(1)
                    Image(systemName: "doc.on.doc")
                }.font(.subheadline)
            }.buttonStyle(.plain)
        }
    }

    private func actions(_ document: PolicyDocument) -> some View {
        CompactPolicySection(title: "操作") {
            if let url = document.officialURL { Link("公式文書を開く", destination: url) }
            if let url = document.govInfoPDFURL { Link("GovInfo公式PDFを開く", destination: url) }
            if let url = document.publicInspectionPDFURL { Link("Public Inspection版を開く", destination: url) }
            Button("URLをコピー") { copy(document.officialURL?.absoluteString ?? "URL未登録", message: "URLをコピーしました") }
            Button("引用情報をコピー") { copy("\(document.publisherEN). \(document.titleEN). \(document.documentNumber).", message: "引用情報をコピーしました") }
            Button("変更履歴を見る") { withAnimation { historyExpanded = true } }
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("evidence.actions")
    }

    private func provenance(_ document: PolicyDocument) -> some View {
        DisclosureGroup(isExpanded: $provenanceExpanded) {
            VStack(alignment: .leading, spacing: 14) {
                timeProvenance(document)
                integrity(document)
            }
            .padding(.top, 8)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text("取得来歴と完全性").font(.headline)
                Text("取得時刻、Replay根拠、SHA-256")
                    .font(.caption)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
        .tint(KabuyomiTheme.ink)
        .accessibilityIdentifier("evidence.provenance")
    }

    @ViewBuilder private func relation(_ document: PolicyDocument) -> some View {
        if document.relationship == .corrects, let targetID = document.correctsDocumentID, let target = event.relatedDocuments.first(where: { $0.id == targetID }) {
            CompactPolicySection(title: "文書の関係") {
                Label("\(document.documentNumber) が \(target.documentNumber) を訂正", systemImage: "arrow.triangle.branch")
                    .font(.subheadline)
                Text("別々の公式Documentです。同一文書のVersion 2ではありません。")
                    .font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
    }

    private func content(_ document: PolicyDocument) -> some View {
        CompactPolicySection(title: PolicyEvidenceDisplay.sectionTitle(event: event, showsOriginal: language == .original)) {
            Text(PolicyEvidenceDisplay.body(event: event, document: document, showsOriginal: language == .original))
                .font(.subheadline)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("evidence.documentBody")
            if language == .japanese, event.translation != nil {
                Text("原文の事実要約を日本語表示しています。公式文書の全文翻訳ではありません。")
                    .font(.caption)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            StatusBadge(text: "公式資料・改訂 \(document.currentRevision)", systemImage: "doc.text.magnifyingglass", tint: AppColors.official)
        }
    }

    @ViewBuilder private func versionComparison(_ document: PolicyDocument) -> some View {
        if document.currentRevision > 1 {
            CompactPolicySection(title: "版の比較") {
                let versions = event.documentVersions.sorted { $0.version < $1.version }
                if versions.count >= 2 {
                    let previous = versions[versions.count - 2]
                    let current = versions[versions.count - 1]
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("改訂 \(previous.version)")
                        Image(systemName: "arrow.right")
                        Text("改訂 \(current.version)")
                        Spacer()
                        Text("\(AppFormatters.etMonthDay.string(from: current.publishedAt)) \(AppFormatters.et.string(from: current.publishedAt)) ET")
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                    .font(.caption.weight(.semibold).monospacedDigit())
                }

                if let diff = event.documentDiff {
                    let deleted = language == .japanese ? diff.deletedJA : diff.deletedEN
                    let added = language == .japanese ? diff.addedJA : diff.addedEN
                    changeList(
                        title: "削除 \(deleted.count)件",
                        systemImage: "minus.circle",
                        tint: AppColors.revision,
                        prefix: "−",
                        values: deleted
                    )
                    changeList(
                        title: "追加 \(added.count)件",
                        systemImage: "plus.circle",
                        tint: .accentColor,
                        prefix: "＋",
                        values: added
                    )
                } else {
                    Text("改訂版は確認済みですが、表示できる行単位差分はありません。公式文書で変更箇所を確認してください。")
                        .font(.subheadline)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
            .accessibilityIdentifier("evidence.versionComparison")
        }
    }

    private func changeList(
        title: String,
        systemImage: String,
        tint: Color,
        prefix: String,
        values: [String]
    ) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
            if values.isEmpty {
                Text("変更なし").font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
            } else {
                ForEach(Array(values.prefix(6).enumerated()), id: \.offset) { _, value in
                    Text("\(prefix) \(value)")
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if values.count > 6 {
                    Text("ほか \(values.count - 6)件")
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var eventLevelEvidence: some View {
        VStack(alignment: .leading, spacing: 14) {
            DisclosureGroup(isExpanded: $historyExpanded) {
                VStack(alignment: .leading, spacing: 9) {
                    documentChangeEvidence
                    if event.correctionNotes.isEmpty { Text("追加の訂正履歴はありません").foregroundStyle(KabuyomiTheme.inkMuted) }
                    ForEach(event.correctionNotes) { note in
                        Text(note.detailJA).font(.subheadline)
                    }
                }.padding(.top, 7)
            } label: { Text("変更履歴").font(.headline) }
            .tint(KabuyomiTheme.ink)

            DisclosureGroup("文書の関連候補") {
                VStack(alignment: .leading, spacing: 12) {
                    if event.relationshipCandidates?.isEmpty != false {
                        Text("関連候補はありません").foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                    ForEach(event.relationshipCandidates ?? []) { candidate in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(candidate.relationshipLabelJA).font(.subheadline.weight(.semibold))
                            Text("\(candidate.fromDocumentNumber ?? "文書ID") → \(candidate.toDocumentNumber ?? "文書ID")")
                                .font(.caption.monospaced()).foregroundStyle(KabuyomiTheme.inkMuted)
                            HStack(spacing: 6) {
                                StatusBadge(text: candidate.reviewState == "approved" ? "検証済み" : candidate.reviewState == "rejected" ? "却下" : "自動生成・未検証", systemImage: candidate.reviewState == "approved" ? "checkmark.seal" : "questionmark.diamond", tint: candidate.reviewState == "approved" ? AppColors.official : .orange)
                            }
                            if candidate.reviewState == "candidate" {
                                Text("自動抽出した候補です。文書関係は確定していません。")
                                    .font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                            }
                        }
                    }
                }.padding(.top, 7)
            }.font(.headline).tint(KabuyomiTheme.ink)

            DisclosureGroup("関連企業の根拠") {
                VStack(alignment: .leading, spacing: 12) {
                    if event.exposures.isEmpty && event.productAnalysis.companyRelations.isEmpty {
                        Text(event.productAnalysis.noCompanyReasonJA?.nonEmpty ?? "関連候補はありません").foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                    ForEach(event.productAnalysis.companyRelations) { relation in
                        VStack(alignment: .leading, spacing: 4) {
                            Text((relation.ticker.map { $0 + "  " } ?? "") + relation.issuerName).font(.subheadline.weight(.semibold))
                            Text(relation.relationType.labelJA + "・" + (relation.reviewStatus == .approved ? "検証済み" : "自動生成・未検証"))
                                .font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                            Text(relation.evidenceSummaryJA).font(.subheadline)
                            metadataRow("根拠", relation.evidenceReference)
                        }
                    }
                    ForEach(event.exposures) { exposure in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(exposure.ticker + "  " + exposure.companyName).font(.subheadline.weight(.semibold))
                            Text(exposure.relationship.label + "・" + exposure.verificationState.label).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                            Text(exposure.evidenceJA).font(.subheadline)
                            ForEach(exposure.references, id: \.self) { reference in metadataRow(reference.labelJA, reference.valueJA) }
                        }
                    }
                }.padding(.top, 7)
            }.font(.headline).tint(KabuyomiTheme.ink)

            DisclosureGroup("交絡要因台帳") {
                VStack(alignment: .leading, spacing: 9) {
                    if event.confounders.isEmpty { Text(event.confounderReviewState?.labelJA ?? "未確認").foregroundStyle(KabuyomiTheme.inkMuted) }
                    ForEach(event.confounders) { item in
                        Text(item.titleJA).font(.subheadline.weight(.semibold))
                        Text(item.detailJA).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }.padding(.top, 7)
            }.font(.headline).tint(KabuyomiTheme.ink)

            if let clauses = event.importantClauses, !clauses.isEmpty {
                DisclosureGroup("重要条項") {
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(clauses) { clause in
                            Text(clause.textJA).font(.subheadline)
                            if let url = clause.sourceURL { Text(url.absoluteString).font(.caption.monospaced()).foregroundStyle(KabuyomiTheme.inkMuted) }
                        }
                    }.padding(.top, 7)
                }.font(.headline).tint(KabuyomiTheme.ink)
            }

            DisclosureGroup("計算方法") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("ベンチマーク対比 = 銘柄リターン − ベンチマークリターン")
                    Text("出来高比 = 当該時間帯の出来高 / 通常同時間帯平均")
                    Text("市場変動は記述情報です。因果関係は未確定で、投資助言ではありません。").foregroundStyle(KabuyomiTheme.inkMuted)
                }.font(.subheadline).padding(.top, 7)
            }.font(.headline).tint(KabuyomiTheme.ink)
        }
    }

    @ViewBuilder private var documentChangeEvidence: some View {
        if event.status == .corrected, let correction = event.relatedDocuments.first(where: { $0.documentType == .correctingAmendment }) {
            Label(correction.documentNumber + " は原規則とは別の公式文書", systemImage: "doc.badge.gearshape")
        } else if let diff = event.documentDiff {
            Text("同一文書の版間差分 \(diff.deletedJA.count + diff.addedJA.count)件は、上部の「版の比較」に表示しています。")
                .foregroundStyle(KabuyomiTheme.inkMuted)
        } else {
            Text("文書差分はありません").foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    private func metadataRow(_ label: String, _ value: String) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                    Text(value).font(.subheadline.weight(.medium).monospacedDigit())
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                HStack(alignment: .firstTextBaseline) {
                    Text(label).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
                    Spacer(minLength: 10)
                    Text(value).font(.subheadline.weight(.medium).monospacedDigit()).multilineTextAlignment(.trailing)
                }
            }
        }
    }

    private func availabilityLabel(_ basis: AvailabilityBasis) -> String {
        switch basis { case .sourceStated: "資料記載時刻"; case .firstObserved: "初回発見時刻"; case .publicationDateOnly: "掲載日のみ判明"; case .manualEstimate: "手動推定" }
    }

    private func copy(_ value: String, message: String) {
        UIPasteboard.general.string = value
        withAnimation { copiedMessage = message }
        Task { try? await Task.sleep(for: .seconds(1.2)); await MainActor.run { withAnimation { copiedMessage = nil } } }
    }
}
