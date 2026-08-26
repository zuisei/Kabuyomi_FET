import SwiftUI

enum DayReplayStateLabel {
    static func title(
        documentType: DocumentType,
        relationship: DocumentRelationship,
        position: Int
    ) -> String {
        if documentType == .correctingAmendment || relationship == .corrects {
            return "訂正後"
        }
        if relationship == .primary || position == 0 {
            return "掲載後"
        }
        return "追加掲載後"
    }
}

struct PolicyReplayContent: View {
    let event: PolicyEvent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var milestone: ReplayMilestone
    @State private var showFuture = false

    init(event: PolicyEvent, requestedMilestone: ReplayMilestone? = nil) {
        self.event = event
        let mode = ProcessInfo.processInfo.arguments.value(after: "-screenshotMode")
        _milestone = State(initialValue: requestedMilestone ?? (mode == "replayRevision" ? .revision : mode == "replayMarket" ? .marketReaction : mode == "replayReport" ? .firstReport : .officialPublication))
    }

    private var milestones: [ReplayMilestone] { ReplayEngine.availableMilestones(for: event) }
    private var index: Int { milestones.firstIndex(of: milestone) ?? 0 }
    private var selectedDate: Date { ReplayEngine.date(for: milestone, event: event) }
    private var snapshot: ReplaySnapshot { ReplayEngine.snapshot(event: event, asOf: selectedDate) }
    private var futureItems: [TimelineItem] { event.timelineItems.filter { $0.occurredAt > selectedDate }.sorted { $0.occurredAt < $1.occurredAt } }
    private var screenshotMode: String? { ProcessInfo.processInfo.arguments.value(after: "-screenshotMode") }
    private var usesDayChronology: Bool {
        event.relatedDocuments.first(where: { $0.relationship == .primary })?.timePrecision == .day
    }

    var body: some View {
        Group {
            if usesDayChronology {
                DayPrecisionChronologyView(event: event)
            } else {
                exactReplay
            }
        }
    }

    private var exactReplay: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    replayMomentControl
                    snapshotPanel
                    market.id("replay.market")
                }
                .padding(.horizontal, 16)
                .padding(.bottom, screenshotMode == "replayMarket" ? 228 : 28)
                .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: milestone)
            }
            .task {
                guard screenshotMode == "replayMarket" else { return }
                try? await Task.sleep(for: .milliseconds(300))
                proxy.scrollTo("replay.market", anchor: .top)
            }
            .contentShape(Rectangle())
            .simultaneousGesture(DragGesture(minimumDistance: 45).onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.25 else { return }
                if value.translation.width < -45 { move(1) }
                if value.translation.width > 45 { move(-1) }
            })
            .accessibilityIdentifier("policyReplay.content")
        }
    }

    private var replayMomentControl: some View {
        ReplayMomentControl(
            title: milestoneTitle(milestone),
            date: selectedLabel,
            precision: precisionLabel,
            items: milestones.map {
                ReplayTrackItem(
                    id: $0.rawValue,
                    title: shortTitle($0),
                    detail: milestoneDateLabel($0)
                )
            },
            selectedID: milestone.rawValue,
            accessibilityPrefix: "replay.milestone"
        ) { id in
            guard let selected = ReplayMilestone(rawValue: id) else { return }
            milestone = selected
        }
    }

    private var snapshotPanel: some View {
        ReplaySnapshotPanel(
            title: "この時点で見えていたこと",
            availableText: availableLines.joined(separator: "・"),
            unavailableText: unavailableLines.joined(separator: "・")
        ) {
            eventStory
            futureIndex
        }
        .accessibilityIdentifier("replay.snapshot")
    }

    private var availableLines: [String] {
        var values = event.documents == nil
            ? []
            : snapshot.visibleDocuments.map { $0.typeLabel }
        if let version = snapshot.activeDocumentVersion?.version {
            values.append("文書版 \(version)")
        }
        values.append("イベント \(snapshot.visibleTimelineItems.count)件")
        if !snapshot.visibleMarketPoints.isEmpty { values.append("市場時系列") }
        if !snapshot.availableMarketSummaries.isEmpty { values.append("30分市場評価 確定") }
        return values.isEmpty ? ["公開情報なし"] : values
    }

    private var unavailableLines: [String] {
        var values: [String] = []
        let hiddenDocuments = event.documents == nil
            ? max(0, event.documentVersions.count - (snapshot.activeDocumentVersion?.version ?? 0))
            : event.relatedDocuments.count - snapshot.visibleDocuments.count
        if hiddenDocuments > 0 { values.append("文書 \(hiddenDocuments)件") }
        if !futureItems.isEmpty { values.append("イベント \(futureItems.count)件") }
        if snapshot.availableMarketSummaries.isEmpty && !event.marketSummaries.isEmpty { values.append("30分市場評価") }
        return values.isEmpty ? ["未公開情報なし"] : values
    }

    @ViewBuilder private var eventStory: some View {
        if snapshot.visibleTimelineItems.isEmpty {
            ReplayEmptySnapshot(
                title: "まだ公開されていません",
                detail: "選択した時点で確認できる政策情報はありません。"
            )
        } else {
            ForEach(Array(snapshot.visibleTimelineItems.enumerated()), id: \.element.id) { position, item in
                HStack(alignment: .top, spacing: 11) {
                    VStack(spacing: 0) {
                        Circle()
                            .fill(AppColors.color(for: item.kind))
                            .frame(width: 10, height: 10)
                        if position < snapshot.visibleTimelineItems.count - 1 {
                            Rectangle()
                                .fill(KabuyomiTheme.inkMuted.opacity(0.22))
                                .frame(width: 1, height: 38)
                        }
                    }
                    .padding(.top, 5)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(storyTime(item) + "  " + item.kind.label)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                        Text(item.titleJA)
                            .font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    @ViewBuilder private var futureIndex: some View {
        if !futureItems.isEmpty {
            Divider()
            DisclosureGroup(isExpanded: $showFuture) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(futureItems) { item in
                        Text(storyTime(item) + "  " + item.titleJA)
                            .font(.caption)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
                .padding(.top, 8)
            } label: {
                Label("この時点では未公開  \(futureItems.count)件", systemImage: "lock")
                    .font(.subheadline.weight(.semibold))
            }
            .tint(KabuyomiTheme.ink)
        }
    }

    private var market: some View {
        Group {
            switch event.productAnalysis.marketAnalysisMode {
            case .intraday where !event.marketSeries.isEmpty:
                CompactPolicySection(title: "この時点の市場") {
                    MinuteReactionChart(event: event, cutoff: selectedDate, selectedDate: selectedDate)
                }
            case .intraday:
                productionMarketSetup(
                    fallbackTitle: "市場データ未接続",
                    fallbackDetail: "対象銘柄は設定済みですが、表示可能な分足データがありません。"
                )
            case .daily where !event.marketSeries.isEmpty:
                CompactPolicySection(title: "この時点の市場") {
                    MinuteReactionChart(
                        event: event,
                        cutoff: selectedDate,
                        selectedDate: selectedDate,
                        resolution: .day
                    )
                }
            case .daily where !event.marketSummaries.isEmpty:
                ReplayDailyMarketSummary(
                    summary: snapshot.availableMarketSummaries.first,
                    pendingDetail: "この時点では、日足の評価結果はまだ確定していません。"
                )
            case .daily:
                productionMarketSetup(
                    fallbackTitle: "市場データ未接続",
                    fallbackDetail: "対象銘柄は設定済みですが、表示可能な日足データがありません。"
                )
            case .unmapped:
                productionMarketSetup(
                    fallbackTitle: "市場データなし",
                    fallbackDetail: "関連銘柄と評価方法が設定されていないため、政策情報の変化だけを再現します。"
                )
            case .notApplicable:
                ReplayMarketStatus(
                    title: "市場評価対象外",
                    detail: event.productAnalysis.noMarketDataReasonJA?.nonEmpty ?? "この資料は市場評価の対象外です。",
                    systemImage: "minus.circle"
                )
            case .disabled:
                productionMarketSetup(
                    fallbackTitle: "市場データ未接続",
                    fallbackDetail: "表示許諾済みの市場データ提供元が接続されていません。"
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("replay.intradayMarket")
    }

    private var selectedDocument: PolicyDocument? { event.relatedDocuments.first { $0.availableAt == selectedDate } }
    private var selectedLabel: String {
        if selectedDocument?.timePrecision == .day { return (selectedDocument?.publishedOn ?? "日付不明") + " 掲載日" }
        if selectedDocument?.timePrecision == .hour { return AppFormatters.etHour.string(from: selectedDate) + " ET" }
        return AppFormatters.etWithSeconds.string(from: selectedDate) + " ET"
    }
    private var precisionLabel: String {
        switch selectedDocument?.timePrecision {
        case .day: "日単位・公式時刻未確定"
        case .hour: "時間単位・分秒未確定"
        case .minute: "時刻精度：分"
        case .exact, nil: "時刻精度：秒"
        }
    }
    private func storyTime(_ item: TimelineItem) -> String {
        if let document = event.relatedDocuments.first(where: { $0.id == item.documentID }) {
            if document.timePrecision == .day { return (document.publishedOn ?? "日付不明") + " 掲載" }
            if document.timePrecision == .hour { return AppFormatters.etHour.string(from: item.occurredAt) + " ET" }
        }
        return AppFormatters.etWithSeconds.string(from: item.occurredAt) + " ET"
    }
    private func milestoneDateLabel(_ item: ReplayMilestone) -> String {
        let date = ReplayEngine.date(for: item, event: event)
        if event.relatedDocuments.first(where: { $0.availableAt == date })?.timePrecision == .day {
            return event.relatedDocuments.first(where: { $0.availableAt == date })?.publishedOn ?? "日付不明"
        }
        return AppFormatters.et.string(from: date) + " ET"
    }
    private func move(_ offset: Int) { milestone = milestones[min(max(index + offset, 0), milestones.count - 1)] }
    private func shortTitle(_ item: ReplayMilestone) -> String { item == .revision && event.status == .corrected ? "訂正文書" : item == .officialPublication && event.relatedDocuments.first?.timePrecision == .day ? "掲載" : item == .firstReport ? "報道" : item.title }
    private func milestoneTitle(_ item: ReplayMilestone) -> String { shortTitle(item) }

    @ViewBuilder
    private func productionMarketSetup(fallbackTitle: String, fallbackDetail: String) -> some View {
        if event.isSynthetic {
            ReplayMarketStatus(
                title: fallbackTitle,
                detail: fallbackDetail,
                systemImage: "chart.xyaxis.line"
            )
        } else {
            OnDeviceMarketChart(event: event, cutoff: selectedDate, selectedDate: selectedDate)
        }
    }
}

private struct DayPrecisionChronologyView: View {
    let event: PolicyEvent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedKey: String
    private var analysis: PolicyAnalysis { event.productAnalysis }

    private struct DayMilestone: Identifiable {
        let id: String
        let title: String
        let dateLabel: String
        let asOf: Date
    }

    init(event: PolicyEvent) {
        self.event = event
        _selectedKey = State(initialValue: event.relatedDocuments.sorted { $0.availableAt < $1.availableAt }.last?.id.uuidString ?? "before")
    }

    private var milestones: [DayMilestone] {
        let documents = event.relatedDocuments.sorted { $0.availableAt < $1.availableAt }
        guard let first = documents.first else { return [] }
        let before = DayMilestone(
            id: "before",
            title: "掲載前",
            dateLabel: "前日まで",
            asOf: first.availableAt.addingTimeInterval(-1)
        )
        return [before] + documents.enumerated().map { position, document in
            DayMilestone(
                id: document.id.uuidString,
                title: DayReplayStateLabel.title(
                    documentType: document.documentType,
                    relationship: document.relationship,
                    position: position
                ),
                dateLabel: document.publishedOn ?? document.availableAt.formatted(.dateTime.year().month(.twoDigits).day(.twoDigits)),
                asOf: document.availableAt
            )
        }
    }

    private var selectedMilestone: DayMilestone? {
        milestones.first { $0.id == selectedKey } ?? milestones.last
    }
    private var visibleDocuments: [PolicyDocument] {
        guard let selectedMilestone else { return [] }
        return ReplayEngine.visibleDocuments(event.relatedDocuments, asOf: selectedMilestone.asOf)
    }
    private var futureDocuments: [PolicyDocument] {
        event.relatedDocuments.filter { document in !visibleDocuments.contains { $0.id == document.id } }
    }
    private var selectedMarketSummary: MarketSummary? {
        guard let asOf = selectedMilestone?.asOf else { return nil }
        return event.marketSummaries
            .filter { $0.availableAt <= asOf }
            .max { $0.availableAt < $1.availableAt }
    }
    private var selectedIndex: Int {
        milestones.firstIndex { $0.id == selectedKey } ?? 0
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    replayMomentControl
                    daySnapshotPanel
                    dailyMarket.id("replay.dailyMarket")
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
                .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: selectedKey)
            }
            .task {
                let mode = ProcessInfo.processInfo.arguments.value(after: "-screenshotMode")
                guard mode == "marketDaily" || mode == "marketNotApplicable" else { return }
                try? await Task.sleep(for: .milliseconds(300))
                proxy.scrollTo("replay.dailyMarket", anchor: .top)
            }
            .contentShape(Rectangle())
            .simultaneousGesture(DragGesture(minimumDistance: 45).onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.25 else { return }
                if value.translation.width < -45 { move(1) }
                if value.translation.width > 45 { move(-1) }
            })
        }
        .accessibilityIdentifier("replay.dayChronology")
    }

    private var replayMomentControl: some View {
        ReplayMomentControl(
            title: selectedMilestone?.title ?? "掲載情報なし",
            date: selectedMilestone?.dateLabel ?? "日付不明",
            precision: "公式時刻なし・日単位",
            items: milestones.map {
                ReplayTrackItem(id: $0.id, title: $0.title, detail: $0.dateLabel)
            },
            selectedID: selectedKey,
            accessibilityPrefix: "replay.dayMilestone"
        ) { selectedKey = $0 }
    }

    private var daySnapshotPanel: some View {
        ReplaySnapshotPanel(
            title: "この時点で見えていたこと",
            availableText: visibleDocuments.isEmpty
                ? "公開情報なし"
                : "この日までに公開  公式文書 \(visibleDocuments.count)件",
            unavailableText: futureDocuments.isEmpty
                ? "後続文書なし"
                : "後続文書 \(futureDocuments.count)件"
        ) {
            if visibleDocuments.isEmpty {
                ReplayEmptySnapshot(
                    title: "まだ掲載されていません",
                    detail: "選択した日より前に確認できる公式文書はありません。"
                )
            } else {
                ForEach(Array(visibleDocuments.enumerated()), id: \.element.id) { index, document in
                    ReplayDocumentRow(
                        event: event,
                        document: document,
                        showsDivider: index < visibleDocuments.count - 1
                    )
                }
            }

            if !futureDocuments.isEmpty {
                Divider()
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(futureDocuments) { document in
                            Text("\(document.publishedOn ?? "日付不明")  \(document.typeLabel)")
                                .font(.caption)
                                .foregroundStyle(KabuyomiTheme.inkMuted)
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Label("この時点では未公開  \(futureDocuments.count)件", systemImage: "lock")
                        .font(.subheadline.weight(.semibold))
                }
            }
        }
        .accessibilityIdentifier("replay.snapshot")
    }

    private var dailyMarket: some View {
        Group {
            if analysis.marketAnalysisMode == .daily, !event.marketSeries.isEmpty {
                CompactPolicySection(title: "この時点の市場") {
                    MinuteReactionChart(
                        event: event,
                        cutoff: selectedMilestone?.asOf,
                        selectedDate: selectedMilestone?.asOf,
                        resolution: .day
                    )
                }
            } else if analysis.marketAnalysisMode == .daily, !event.marketSummaries.isEmpty {
                ReplayDailyMarketSummary(
                    summary: selectedMarketSummary,
                    pendingDetail: "選択した掲載日時点では、日足の評価結果はまだ確定していません。"
                )
            } else if analysis.marketAnalysisMode == .daily {
                dayProductionMarketSetup(
                    fallbackTitle: "市場データ未接続",
                    fallbackDetail: "対象銘柄は設定済みですが、表示可能な日足データがありません。"
                )
            } else if analysis.marketAnalysisMode == .notApplicable {
                ReplayMarketStatus(
                    title: "市場評価対象外",
                    detail: analysis.noMarketDataReasonJA?.nonEmpty ?? "この資料は市場評価の対象外です。",
                    systemImage: "minus.circle"
                )
            } else if analysis.marketAnalysisMode == .unmapped {
                dayProductionMarketSetup(
                    fallbackTitle: "市場データなし",
                    fallbackDetail: "関連銘柄と評価方法が設定されていないため、政策情報の変化だけを再現します。"
                )
            } else if analysis.marketAnalysisMode == .disabled {
                dayProductionMarketSetup(
                    fallbackTitle: "市場データ未接続",
                    fallbackDetail: "表示許諾済みの市場データ提供元が接続されていません。"
                )
            } else {
                dayProductionMarketSetup(
                    fallbackTitle: "日付精度のため分足表示なし",
                    fallbackDetail: "正確な公式時刻がないため、この資料を分足データへ接続しません。"
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("replay.dailyMarket")
    }

    private func move(_ offset: Int) {
        let target = min(max(selectedIndex + offset, 0), milestones.count - 1)
        guard milestones.indices.contains(target) else { return }
        selectedKey = milestones[target].id
    }

    @ViewBuilder
    private func dayProductionMarketSetup(fallbackTitle: String, fallbackDetail: String) -> some View {
        if event.isSynthetic {
            ReplayMarketStatus(
                title: fallbackTitle,
                detail: fallbackDetail,
                systemImage: "chart.xyaxis.line"
            )
        } else {
            OnDeviceMarketChart(
                event: event,
                cutoff: selectedMilestone?.asOf,
                selectedDate: selectedMilestone?.asOf
            )
        }
    }
}

private struct ReplayTrackItem: Identifiable {
    let id: String
    let title: String
    let detail: String
}

private struct ReplayMomentControl: View {
    let title: String
    let date: String
    let precision: String
    let items: [ReplayTrackItem]
    let selectedID: String
    let accessibilityPrefix: String
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(alignment: .center, spacing: 10) {
                Label("時点リプレイ", systemImage: "clock.arrow.circlepath")
                    .font(.headline)
                Spacer(minLength: 8)
                Text(precision)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 24)
                    .background(KabuyomiTheme.inkMuted.opacity(0.1), in: Capsule())
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.title2.bold())
                    .contentTransition(.numericText())
                Text(date)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .contentTransition(.numericText())
            }
            .accessibilityIdentifier("replay.currentTime")

            Divider()

            ReplayStageTrack(
                items: items,
                selectedID: selectedID,
                accessibilityPrefix: accessibilityPrefix,
                onSelect: onSelect
            )

            Label("選択中の地点までに公開された情報だけを表示", systemImage: "eye")
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
        .padding(16)
        .background(
            KabuyomiTheme.inkMuted.opacity(0.065),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(KabuyomiTheme.inkMuted.opacity(0.12), lineWidth: 0.5)
        }
        .sensoryFeedback(.selection, trigger: selectedID)
    }
}

private struct ReplayStageTrack: View {
    let items: [ReplayTrackItem]
    let selectedID: String
    let accessibilityPrefix: String
    let onSelect: (String) -> Void

    private var selectedIndex: Int {
        items.firstIndex { $0.id == selectedID } ?? 0
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        ReplayStageButton(
                            item: item,
                            index: index,
                            count: items.count,
                            selectedIndex: selectedIndex,
                            accessibilityPrefix: accessibilityPrefix,
                            onSelect: onSelect
                        )
                        .id(item.id)
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
            }
            .onAppear {
                proxy.scrollTo(selectedID, anchor: .center)
            }
            .onChange(of: selectedID) { _, newValue in
                withAnimation(.snappy(duration: 0.2)) {
                    proxy.scrollTo(newValue, anchor: .center)
                }
            }
        }
    }
}

private struct ReplayStageButton: View {
    let item: ReplayTrackItem
    let index: Int
    let count: Int
    let selectedIndex: Int
    let accessibilityPrefix: String
    let onSelect: (String) -> Void

    private var isSelected: Bool { index == selectedIndex }
    private var isReached: Bool { index <= selectedIndex }
    private var leadingConnector: Color {
        index == 0 ? .clear : connectorColor(reached: isReached)
    }
    private var trailingConnector: Color {
        index == count - 1 ? .clear : connectorColor(reached: index < selectedIndex)
    }

    var body: some View {
        Button {
            onSelect(item.id)
        } label: {
            ReplayStageLabel(
                item: item,
                index: index,
                selectedIndex: selectedIndex,
                leadingConnector: leadingConnector,
                trailingConnector: trailingConnector
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title + "、" + item.detail + (isSelected ? "、選択中" : ""))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("\(accessibilityPrefix).\(item.id)")
    }

    private func connectorColor(reached: Bool) -> Color {
        reached ? KabuyomiTheme.accent.opacity(0.7) : KabuyomiTheme.inkMuted.opacity(0.22)
    }
}

private struct ReplayStageLabel: View {
    let item: ReplayTrackItem
    let index: Int
    let selectedIndex: Int
    let leadingConnector: Color
    let trailingConnector: Color

    private var isSelected: Bool { index == selectedIndex }
    private var isReached: Bool { index <= selectedIndex }
    private var markerSymbol: String {
        if index < selectedIndex { return "checkmark.circle.fill" }
        if isSelected { return "circle.inset.filled" }
        return "circle"
    }
    private var markerColor: Color {
        isReached ? .accentColor : .secondary.opacity(0.45)
    }
    private var titleWeight: Font.Weight { isSelected ? .bold : .semibold }
    private var titleColor: Color { isReached ? .primary : .secondary }
    private var detailColor: Color { isSelected ? .accentColor : .secondary }

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 0) {
                Rectangle()
                    .fill(leadingConnector)
                    .frame(height: 2)
                Image(systemName: markerSymbol)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(markerColor)
                    .frame(width: 28, height: 28)
                Rectangle()
                    .fill(trailingConnector)
                    .frame(height: 2)
            }
            .frame(height: 28)

            Text(item.title)
                .font(.caption)
                .fontWeight(titleWeight)
                .foregroundStyle(titleColor)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(height: 30, alignment: .top)

            Text(item.detail)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(detailColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(width: 104)
        .frame(minHeight: 76)
        .contentShape(Rectangle())
    }
}

private struct ReplaySnapshotPanel<Content: View>: View {
    let title: String
    let availableText: String
    let unavailableText: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.title3.bold())
                Spacer(minLength: 8)
                Label("再現中", systemImage: "scope")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppColors.official)
            }

            VStack(alignment: .leading, spacing: 7) {
                Label(availableText, systemImage: "checkmark.circle.fill")
                    .foregroundStyle(AppColors.official)
                    .accessibilityIdentifier("replay.available")
                Label(unavailableText, systemImage: "lock")
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .accessibilityIdentifier("replay.unavailable")
            }
            .font(.caption.weight(.semibold))

            Divider()
            content()
        }
        .padding(16)
        .background(
            KabuyomiTheme.inkMuted.opacity(0.045),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(KabuyomiTheme.inkMuted.opacity(0.1), lineWidth: 0.5)
        }
        .accessibilityElement(children: .contain)
    }
}

private struct ReplayEmptySnapshot: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "clock.badge.questionmark")
                .font(.title3)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .frame(width: 32, height: 32)
                .background(KabuyomiTheme.inkMuted.opacity(0.08), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct ReplayDocumentRow: View {
    let event: PolicyEvent
    let document: PolicyDocument
    let showsDivider: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: document.documentType == .correctingAmendment ? "doc.badge.gearshape" : "doc.text")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(
                        document.documentType == .correctingAmendment
                            ? AppColors.revision
                            : AppColors.official
                    )
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 3) {
                    Text(document.typeLabel + "  " + document.documentNumber)
                        .font(.subheadline.weight(.semibold))
                    Text(PolicyEvidenceDisplay.title(event: event, document: document, showsOriginal: false))
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if showsDivider {
                Divider()
                    .padding(.leading, 35)
            }
        }
    }
}

private struct ReplayMarketStatus: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            Text("この時点の市場")
                .font(.headline)
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: systemImage)
                    .font(.headline)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .frame(width: 34, height: 34)
                    .background(KabuyomiTheme.inkMuted.opacity(0.08), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ReplayDailyMarketSummary: View {
    let summary: MarketSummary?
    let pendingDetail: String

    var body: some View {
        if let summary {
            VStack(alignment: .leading, spacing: 10) {
                Divider()
                HStack {
                    Text("この時点の市場")
                        .font(.headline)
                    Spacer()
                    Label("日足評価", systemImage: "chart.line.uptrend.xyaxis")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                MetricRow(label: "対象", value: summary.ticker)
                MetricRow(label: "掲載日後", value: AppFormatters.percent(summary.securityReturn))
                MetricRow(
                    label: "\(summary.benchmarkTicker)対比",
                    value: AppFormatters.points(summary.abnormalReturn)
                )
                Text("公式掲載後の値動きを記述しています。政策との因果関係は未確定です。")
                    .font(.caption)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
        } else {
            ReplayMarketStatus(
                title: "市場評価はまだ未確定",
                detail: pendingDetail,
                systemImage: "clock"
            )
        }
    }
}
