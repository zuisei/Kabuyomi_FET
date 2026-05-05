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
    let selectTicker: (String, String) -> Void
    let saveSearchResult: (SearchItem) -> Void
    let openSearchResult: (SearchItem) -> Void
    let openSearch: () -> Void
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
            .mask(CompanyDrawerShellFadeMask(topFade: 28, bottomFade: 34))
    }

    private var drawerShellBackground: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)

            Rectangle()
                .fill(Color.white.opacity(0.28))

            Rectangle()
                .stroke(Color.white.opacity(0.55), lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(0.12), radius: 18, x: 8, y: 0)
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
                title: "Ask",
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
        .kabuyomiCard(.primary, radius: 18)
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
                    DrawerCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        subtitle: drawerSubtitle(for: company),
                        isCurrent: company.ticker == currentTicker,
                        prominence: .standard,
                        action: { selectTicker(company.ticker, company.companyName) }
                    )
                }
            }
        } else {
            DrawerEmptyWatchlistHint(openSearch: openSearch)
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
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 36, height: 36)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .kabuyomiGlass(radius: 18, interactive: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("一覧を閉じる")
        }
    }

    private var footerDock: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                DrawerDockButton(
                    title: "Credits",
                    subtitle: creditSubtitle,
                    systemImage: "creditcard",
                    action: openSettings
                )

                DrawerDockButton(
                    title: "Settings",
                    subtitle: "creditと設定",
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
            return "\(credits.totalRemaining) credits"
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
                    .frame(height: 34)
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
            .frame(maxWidth: .infinity)
            .frame(height: 52)
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
            .kabuyomiCard(isCurrent ? .primary : prominence.surface, radius: isCompact ? 15 : 18)
            .background(
                RoundedRectangle(cornerRadius: isCompact ? 15 : 18, style: .continuous)
                    .fill(isCurrent ? KabuyomiTheme.accentSoft.opacity(0.14) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: isCompact ? 15 : 18, style: .continuous)
                    .stroke(isCurrent ? KabuyomiTheme.accentDeep.opacity(0.26) : Color.clear, lineWidth: 1.2)
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
        .kabuyomiCard(.muted, radius: 18)
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
