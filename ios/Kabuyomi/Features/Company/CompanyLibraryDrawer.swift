import SwiftUI

struct ConversationLibraryDrawer: View {
    @Environment(AppModel.self) private var appModel

    @Binding var query: String
    let currentTicker: String
    let savedCompanies: [WatchlistCard]
    let recentCompanies: [WatchlistCard]
    let starterCompanies: [StarterCompany]
    let searchResults: [SearchItem]
    let isSearchLoading: Bool
    let searchErrorMessage: String?
    let pendingTicker: String?
    let pendingCompanyName: String?
    let pendingDetail: String?
    let conversationHistory: [LocalCompanyRecord]
    let selectTicker: (String, String) -> Void
    let selectFiling: (String, String) -> Void
    let saveSearchResult: (SearchItem) -> Void
    let openSearchResult: (SearchItem) -> Void
    let openSearch: () -> Void
    let openCredits: () -> Void
    let openSettings: () -> Void
    let close: () -> Void
    let cancelPendingOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            pendingOpenBanner

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    contentSections
                }
                .padding(.top, 2)
                .padding(.bottom, 16)
            }

            freePlanBanner
            footerDock
        }
        .padding(18)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(drawerShell)
    }

    @ViewBuilder
    private var pendingOpenBanner: some View {
        if let pendingTicker, let pendingCompanyName, let pendingDetail {
            TickerOpenTransitionOverlay(
                ticker: pendingTicker,
                companyName: pendingCompanyName,
                detail: pendingDetail,
                cancelTitle: "中止",
                cancelAction: cancelPendingOpen
            )
        }
    }

    private var drawerShell: some View {
        drawerShellBackground
            .compositingGroup()
    }

    private var drawerShellBackground: some View {
        ZStack {
            Rectangle()
                .fill(KabuyomiTheme.paper)
                .ignoresSafeArea()

            Rectangle()
                .stroke(KabuyomiTheme.accentDeep.opacity(0.10), lineWidth: 1)
        }
        .shadow(color: KabuyomiTheme.accentDeep.opacity(0.05), radius: 10, x: 5, y: 0)
    }

    @ViewBuilder
    private var contentSections: some View {
        quickActionSection
        savedSection
        starterSection
    }

    private var quickActionSection: some View {
        VStack(spacing: 0) {
            DrawerQuickActionRow(
                title: "質問",
                subtitle: "いまの資料に戻る",
                systemImage: "bubble.left",
                action: { selectTicker(currentTicker, currentTicker) }
            )

            DrawerDivider()

            DrawerQuickActionRow(
                title: "銘柄検索",
                subtitle: "検索画面を開く",
                systemImage: "magnifyingglass",
                action: openSearch
            )
        }
        .padding(.vertical, 8)
        .background(DrawerCellBackground(radius: 16, isCurrent: false, opacity: 0.30))
    }

    private var activeFilingKey: String? {
        appModel.companyPayload(for: currentTicker)?.filingKey
    }

    private var visibleConversationHistory: [LocalCompanyRecord] {
        let savedFilingKey = savedCompanies.first(where: { $0.ticker == currentTicker })?.filingKey

        return conversationHistory.filter { record in
            guard record.company.ticker == currentTicker else { return false }
            guard record.company.filingKey != savedFilingKey else { return false }
            return true
        }
    }

    private func visibleConversationHistory(for ticker: String, excluding filingKey: String) -> [LocalCompanyRecord] {
        conversationHistory.filter { record in
            record.company.ticker == ticker && record.company.filingKey != filingKey
        }
    }

    @ViewBuilder
    private var savedSection: some View {
        if !savedCompanies.isEmpty {
            DrawerSection(
                title: "保存リスト",
                subtitle: "保存した銘柄",
                priority: .standard
            ) {
                ForEach(savedCompanies) { company in
                    VStack(alignment: .leading, spacing: 7) {
                        DrawerCompanyRow(
                            ticker: company.ticker,
                            companyName: company.companyName,
                            subtitle: drawerSubtitle(for: company),
                            isCurrent: false,
                            prominence: .standard,
                            action: { selectTicker(company.ticker, company.companyName) }
                        )

                        if company.ticker == currentTicker {
                            filingRows(for: company)
                                .padding(.leading, 18)
                        }
                    }
                }
            }
        } else {
            DrawerEmptyWatchlistHint(openSearch: openSearch)
        }
    }

    @ViewBuilder
    private func filingRows(for company: WatchlistCard) -> some View {
        let records = visibleConversationHistory(for: company.ticker, excluding: company.filingKey)
        VStack(alignment: .leading, spacing: 6) {
            Text("資料")
                .font(.system(.caption2, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.86))
                .padding(.leading, 2)

            DrawerFilingConversationRow(
                formType: company.formType,
                filedAt: company.filedAt.formatted(date: .abbreviated, time: .omitted),
                messageCount: nil,
                isCurrent: company.filingKey == activeFilingKey,
                currentLabel: "最新を閲覧中",
                leadingLabel: "最新",
                action: { selectTicker(company.ticker, company.companyName) }
            )

            ForEach(records, id: \.company.filingKey) { record in
                DrawerFilingConversationRow(
                    formType: record.company.formType,
                    filedAt: record.company.filedAt,
                    messageCount: record.chatHistory.count,
                    isCurrent: record.company.filingKey == activeFilingKey,
                    currentLabel: "前の資料を閲覧中",
                    leadingLabel: "過去",
                    action: { selectFiling(record.company.ticker, record.company.filingKey) }
                )
            }
        }
    }

    @ViewBuilder
    private var starterSection: some View {
        if !starterCompanies.isEmpty {
            DrawerSection(
                title: "まず試す",
                subtitle: "保存前に開けるサンプル銘柄",
                priority: .subdued
            ) {
                ForEach(Array(starterCompanies.prefix(3))) { company in
                    DrawerCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        subtitle: "まず質問してみる",
                        isCurrent: company.ticker == currentTicker,
                        prominence: .subdued,
                        action: { selectTicker(company.ticker, company.companyName) }
                    )
                }
            }
        }
    }

    private func drawerSubtitle(for company: WatchlistCard) -> String {
        if company.isPlaceholder {
            return "ローカル同期中"
        }
        return "\(company.formType) ・ \(company.filedAt.formatted(date: .abbreviated, time: .omitted))"
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Kabuyomi")
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text("米国株リサーチと会話する")
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Spacer()

            Button(action: close) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .bold))
                    .frame(width: 44, height: 44)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .background(DrawerCellBackground(radius: 14, isCurrent: false, opacity: 0.32))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("一覧を閉じる")
        }
    }

    private var footerDock: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                DrawerDockButton(
                    title: "クレジット",
                    subtitle: creditSubtitle,
                    systemImage: "creditcard",
                    action: openCredits
                )

                DrawerDockButton(
                    title: "設定",
                    subtitle: "アプリ設定",
                    systemImage: "gearshape",
                    action: openSettings
                )
            }
        }
    }

    @ViewBuilder
    private var freePlanBanner: some View {
        if appModel.shouldShowBannerAds {
            AdMobBannerView(placement: .watchlist, horizontalPadding: 0)
                .padding(.vertical, 2)
        }
    }

    private var creditSubtitle: String {
        if let credits = appModel.creditUsage {
            return "\(credits.totalRemaining)クレジット"
        }
        return "確認中"
    }

    @ViewBuilder
    private var searchSection: some View {
        DrawerSection(title: "検索結果", priority: .standard) {
            if isSearchLoading {
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                    Text("検索中…")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .kabuyomiCard(.muted, radius: 18)
            } else if let searchErrorMessage {
                DrawerSearchErrorState(message: searchErrorMessage)
            } else if searchResults.isEmpty {
                Text("一致する銘柄がありません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(searchResults) { item in
                    DrawerSearchRow(
                        item: item,
                        saveAction: { saveSearchResult(item) },
                        openAction: { openSearchResult(item) }
                    )
                }
            }
        }
    }
}

private struct DrawerSearchErrorState: View {
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("検索できませんでした", systemImage: "wifi.exclamationmark")
                .font(.system(.footnote, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.negative)

            Text(message)
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.muted, radius: 18)
    }
}

private struct DrawerCellBackground: View {
    let radius: CGFloat
    let isCurrent: Bool
    let opacity: Double

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Color.white.opacity(opacity))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(
                        isCurrent
                            ? KabuyomiTheme.accentDeep.opacity(0.20)
                            : KabuyomiTheme.accentDeep.opacity(0.09),
                        lineWidth: isCurrent ? 1 : 0.8
                    )
            )
    }
}

private struct DrawerQuickActionRow: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 34, height: 34)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(KabuyomiTheme.accentMist.opacity(0.88))
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(subtitle)
                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.72))
            }
            .padding(.horizontal, 12)
            .frame(height: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct DrawerDivider: View {
    var body: some View {
        Divider()
            .overlay(KabuyomiTheme.accentSoft.opacity(0.34))
            .padding(.leading, 58)
            .padding(.trailing, 12)
    }
}

private struct DrawerEmptyWatchlistHint: View {
    let openSearch: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: "bookmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(KabuyomiTheme.accentMist.opacity(0.9)))

                VStack(alignment: .leading, spacing: 4) {
                    Text("保存リストはまだ空です")
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("保存した銘柄がここに並びます。")
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            Button(action: openSearch) {
                Label("銘柄を探す", systemImage: "magnifyingglass")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.72)))
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.muted, radius: 18)
    }
}

private struct DrawerDockButton: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentMist.opacity(0.9)))

                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(subtitle)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                }

                Spacer(minLength: 2)

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.66))
            }
            .padding(.horizontal, 11)
            .frame(maxWidth: .infinity, minHeight: 52)
            .kabuyomiCard(.primary, radius: 17)
        }
        .buttonStyle(.plain)
    }
}

private enum DrawerSectionPriority {
    case primary
    case standard
    case subdued

    var titleColor: Color {
        switch self {
        case .primary:
            return KabuyomiTheme.accentDeep
        case .standard:
            return KabuyomiTheme.ink
        case .subdued:
            return KabuyomiTheme.inkSoft
        }
    }

    var subtitleColor: Color {
        switch self {
        case .primary:
            return KabuyomiTheme.accentDeep
        case .standard:
            return KabuyomiTheme.inkMuted
        case .subdued:
            return KabuyomiTheme.inkMuted.opacity(0.88)
        }
    }
}

private struct DrawerSection<Content: View>: View {
    let title: String
    let subtitle: String?
    let priority: DrawerSectionPriority
    let content: Content

    init(
        title: String,
        subtitle: String? = nil,
        priority: DrawerSectionPriority = .standard,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.priority = priority
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(priority.titleColor)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(priority.subtitleColor)
                }
            }
            content
        }
    }
}

private enum DrawerRowProminence {
    case primary
    case standard
    case subdued

    var surface: KabuyomiSurface {
        switch self {
        case .primary:
            return .primary
        case .standard:
            return .muted
        case .subdued:
            return .muted
        }
    }

    var accent: Color {
        switch self {
        case .primary:
            return KabuyomiTheme.accentDeep
        case .standard:
            return KabuyomiTheme.inkMuted
        case .subdued:
            return KabuyomiTheme.inkMuted.opacity(0.7)
        }
    }
}

private struct DrawerFilingConversationRow: View {
    let formType: String
    let filedAt: String
    let messageCount: Int?
    let isCurrent: Bool
    let currentLabel: String
    let leadingLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(leadingLabel)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(isCurrent ? KabuyomiTheme.accentDeep : KabuyomiTheme.inkMuted.opacity(0.76))
                    .frame(width: 28, alignment: .leading)

                Text("\(formType) ・ \(filedAt) 提出")
                    .font(.system(.caption, design: .rounded, weight: isCurrent ? .semibold : .medium))
                    .foregroundStyle(isCurrent ? KabuyomiTheme.ink : KabuyomiTheme.inkSoft)
                    .lineLimit(1)
                    .minimumScaleFactor(0.86)

                Spacer(minLength: 8)

                if isCurrent {
                    Text(currentLabel)
                        .font(.system(.caption2, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.66)))
                } else if let messageCount {
                    Text("\(messageCount)件")
                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.88))
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.48))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(DrawerCellBackground(radius: 11, isCurrent: isCurrent, opacity: isCurrent ? 0.30 : 0.18))
        }
        .buttonStyle(.plain)
    }
}

private struct DrawerCompanyRow: View {
    let ticker: String
    let companyName: String
    let subtitle: String
    let isCurrent: Bool
    let prominence: DrawerRowProminence
    let action: () -> Void

    private var isCompact: Bool {
        prominence == .subdued && !isCurrent
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: isCompact ? .center : .top, spacing: isCompact ? 10 : 12) {
                Capsule()
                    .fill(isCurrent ? KabuyomiTheme.accentDeep : prominence.accent.opacity(prominence == .subdued ? 0.18 : 0.28))
                    .frame(width: isCurrent ? 6 : 3, height: isCompact ? 38 : nil)
                    .frame(maxHeight: isCompact ? nil : .infinity)

                VStack(alignment: .leading, spacing: isCompact ? 2 : 4) {
                    Text(ticker)
                        .font(.system(isCompact ? .subheadline : .headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(companyName)
                        .font(.system(isCompact ? .footnote : .subheadline, design: .rounded, weight: isCompact ? .medium : .regular))
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                        .lineLimit(1)
                        .minimumScaleFactor(0.86)
                    Text(subtitle)
                        .font(.system(isCompact ? .caption2 : .caption, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                if isCurrent {
                    VStack(alignment: .trailing, spacing: 8) {
                        Text("閲覧中")
                            .font(.system(.caption, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.92)))

                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                    }
                }
            }
            .padding(.horizontal, isCompact ? 12 : 14)
            .padding(.vertical, isCompact ? 9 : 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                DrawerCellBackground(
                    radius: isCompact ? 14 : 16,
                    isCurrent: isCurrent,
                    opacity: isCurrent ? 0.46 : prominence == .subdued ? 0.22 : 0.30
                )
            )
            .opacity(prominence == .subdued && !isCurrent ? 0.9 : 1)
        }
        .buttonStyle(.plain)
    }
}

private struct DrawerSearchRow: View {
    @Environment(AppModel.self) private var appModel

    let item: SearchItem
    let saveAction: () -> Void
    let openAction: () -> Void

    private var isSaved: Bool {
        appModel.isTickerInWatchlist(item.ticker, cik: item.cik)
    }

    private var isAdding: Bool {
        appModel.isAddingTicker(item.ticker)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.ticker)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text(item.companyName)
                    .font(.system(.subheadline, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkSoft)
                Text("\(item.supportDisplayLabel) ・ \(item.exchange)")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                if item.requiresFilingVerification || !item.canAttemptInV1 {
                    Text(item.availabilityNote)
                        .font(.system(.caption2, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer()

            if item.canAttemptInV1 {
                VStack(alignment: .trailing, spacing: 7) {
                    Button(action: saveAction) {
                        DrawerSearchActionLabel(
                            title: saveTitle,
                            systemImage: saveIcon,
                            isLoading: isAdding
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isSaved || isAdding)
                    .accessibilityLabel(isSaved ? "保存済み" : "\(item.ticker) を保存")

                    Button(action: openAction) {
                        DrawerSearchActionLabel(
                            title: openTitle,
                            systemImage: openIcon,
                            isLoading: false
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(item.ticker) を開く")
                    .accessibilityHint(openAccessibilityHint)
                }
            } else {
                Text(item.availabilityBadgeTitle)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(
                        Capsule().fill(KabuyomiTheme.fill(for: .secondary))
                    )
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DrawerCellBackground(radius: 16, isCurrent: false, opacity: 0.26))
    }

    private var saveTitle: String {
        if isAdding {
            return "保存中"
        }

        if isSaved {
            return "保存済み"
        }

        if item.requiresFilingVerification {
            return "確認して保存"
        }

        return "保存"
    }

    private var saveIcon: String {
        isSaved ? "checkmark" : "bookmark"
    }

    private var openTitle: String {
        "開く"
    }

    private var openIcon: String {
        "arrow.up.right"
    }

    private var openAccessibilityHint: String {
        "保存せずにこの銘柄の会話を開きます"
    }
}

private struct DrawerSearchActionLabel: View {
    let title: String
    let systemImage: String
    let isLoading: Bool

    var body: some View {
        HStack(spacing: 5) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
                    .tint(KabuyomiTheme.accentDeep)
            } else {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .bold))
            }

            Text(title)
        }
        .font(.system(.caption, design: .rounded, weight: .bold))
        .foregroundStyle(KabuyomiTheme.accentDeep)
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .frame(minWidth: 74)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(KabuyomiTheme.accentSoft.opacity(0.58))
        )
    }
}
