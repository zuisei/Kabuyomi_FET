import SwiftUI

struct EventDetailView: View {
    let event: PolicyEvent
    let translationStatus: TranslationRequestStatus?
    let translationIsSubmitting: Bool
    let translationErrorMessage: String?
    let requestTranslation: (() -> Void)?
    let refresh: (() async -> Void)?
    @EnvironmentObject private var store: SavedEventStore
    /// 証拠は**タブではなく1段下**。上の3分割は消した(2026-08-26 オーナー)。
    /// ただし公式URLと原文はここにしか無いので、面ごと消しはしない。
    @State private var showsEvidence = false

    init(
        event: PolicyEvent,
        translationStatus: TranslationRequestStatus? = nil,
        translationIsSubmitting: Bool = false,
        translationErrorMessage: String? = nil,
        requestTranslation: (() -> Void)? = nil,
        refresh: (() async -> Void)? = nil
    ) {
        self.event = event
        self.translationStatus = translationStatus
        self.translationIsSubmitting = translationIsSubmitting
        self.translationErrorMessage = translationErrorMessage
        self.requestTranslation = requestTranslation
        self.refresh = refresh
        let mode = ProcessInfo.processInfo.arguments.value(after: "-screenshotMode")
        _showsEvidence = State(initialValue: mode?.hasPrefix("evidence") == true)
    }

    var body: some View {
        EventOverviewView(
            event: event,
            translationStatus: translationStatus,
            translationIsSubmitting: translationIsSubmitting,
            translationErrorMessage: translationErrorMessage,
            requestTranslation: requestTranslation,
            refresh: refresh,
            // `goToReplay` は既定の nil のまま。リプレイの面は消した —
            // 市場データが全件ゼロで、再生するものが無い(2026-08-26)。
            goToEvidence: { showsEvidence = true }
        )
        .navigationDestination(isPresented: $showsEvidence) {
            EventEvidenceView(event: event)
                .background(KabuyomiTheme.canvas)
                .navigationTitle("原文と証拠")
                .navigationBarTitleDisplayMode(.inline)
        }
        .background(KabuyomiTheme.canvas)
        .navigationTitle(event.displayAgencyCode).navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ShareLink(item: PolicyEvidenceBriefBuilder.text(for: event)) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("根拠付き要約を共有")
                .accessibilityIdentifier("event.shareButton")
                Button { store.toggle(event.id) } label: {
                    Image(systemName: store.contains(event.id) ? "bookmark.fill" : "bookmark")
                }
                .accessibilityLabel(store.contains(event.id) ? "保存を解除" : "イベントを保存")
                .accessibilityIdentifier("event.saveButton")
            }
        }
        .onAppear { store.markRead(event); store.recordViewed(event.id) }
    }
}

struct EventHeader: View {
    let event: PolicyEvent
    @EnvironmentObject private var eventStore: EventDataStore
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if event.isSynthetic {
                    if eventStore.environment == .syntheticLocal { DemoBadge() }
                    else { Label("プレビュー環境・デモデータ", systemImage: "testtube.2").font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted) }
                }
                else {
                    Label(event.coverageState?.labelJA ?? "確認済み公開データ", systemImage: event.coverageState?.systemImage ?? "checkmark.seal")
                        .font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
                }
                Spacer()
                Text(event.agency.displayNameJA).font(.caption).foregroundStyle(KabuyomiTheme.inkMuted)
            }
            Text(event.displayTitleJA).font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
            if let translation = event.titleTranslationLabelJA {
                Label(translation, systemImage: "globe")
                    .font(.caption.weight(.semibold)).foregroundStyle(KabuyomiTheme.inkMuted)
            }
            if let primary = event.relatedDocuments.first(where: { $0.relationship == .primary }), primary.timePrecision == .day {
                Label("\(primary.publishedOn ?? "日付不明") 掲載日", systemImage: "calendar")
                    .font(.subheadline.monospacedDigit())
            } else {
                HStack(spacing: 18) {
                    Label("\(AppFormatters.et.string(from: event.anchorDate)) ET", systemImage: "globe.americas")
                    Label("\(AppFormatters.jst.string(from: event.anchorDate)) JST", systemImage: "globe.asia.australia")
                }.font(.subheadline.monospacedDigit())
            }
            HStack(spacing: 10) {
                StatusBadge(text: event.timestampState == .officialExact ? "公式時刻あり" : "正確な公式時刻未確認", systemImage: event.timestampState == .officialExact ? "checkmark.seal" : "clock.badge.questionmark", tint: event.timestampState == .officialExact ? AppColors.official : .secondary)
                if event.status == .corrected { StatusBadge(text: "訂正文書あり", systemImage: "doc.badge.gearshape", tint: AppColors.revision) }
                else if event.status == .revised { StatusBadge(text: "同一文書の改訂あり", systemImage: "pencil.line", tint: AppColors.revision) }
            }
        }
    }
}
