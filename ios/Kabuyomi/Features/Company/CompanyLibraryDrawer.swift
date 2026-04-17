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
    let selectTicker: (String) -> Void
    let openSearchResult: (SearchItem) -> Void
    let openSettings: () -> Void
    let close: () -> Void

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            searchField

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    contentSections
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
            }

            settingsButton
        }
        .padding(18)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Rectangle().fill(Color.white.opacity(0.28)))
                .overlay(Rectangle().stroke(Color.white.opacity(0.55), lineWidth: 1))
                .shadow(color: Color.black.opacity(0.12), radius: 18, x: 8, y: 0)
        )
    }

    @ViewBuilder
    private var contentSections: some View {
        if isSearching {
            searchSection
        } else {
            recentSection
            savedSection
            starterSection
        }
    }

    @ViewBuilder
    private var recentSection: some View {
        if !recentCompanies.isEmpty {
            DrawerSection(
                title: "最近の会話",
                subtitle: "いま見ている流れに戻る",
                priority: .primary
            ) {
                ForEach(recentCompanies) { company in
                    DrawerCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        subtitle: drawerSubtitle(for: company),
                        isCurrent: company.ticker == currentTicker,
                        prominence: .primary,
                        action: { selectTicker(company.ticker) }
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var savedSection: some View {
        if !savedCompanies.isEmpty {
            DrawerSection(
                title: "保存した銘柄",
                subtitle: "いつでも開ける保存銘柄",
                priority: .standard
            ) {
                ForEach(savedCompanies) { company in
                    DrawerCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        subtitle: drawerSubtitle(for: company),
                        isCurrent: company.ticker == currentTicker,
                        prominence: .standard,
                        action: { selectTicker(company.ticker) }
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var starterSection: some View {
        if !starterCompanies.isEmpty {
            DrawerSection(
                title: "スターター銘柄",
                subtitle: "まず試すときの候補",
                priority: .subdued
            ) {
                ForEach(starterCompanies) { company in
                    DrawerCompanyRow(
                        ticker: company.ticker,
                        companyName: company.companyName,
                        subtitle: "まず質問してみる",
                        isCurrent: company.ticker == currentTicker,
                        prominence: .subdued,
                        action: { selectTicker(company.ticker) }
                    )
                }
            }
        }
    }

    private func drawerSubtitle(for company: WatchlistCard) -> String {
        "\(company.formType) ・ \(company.filedAt.formatted(date: .abbreviated, time: .omitted))"
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("会話を切り替える")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text("左から引き出すか、この一覧から銘柄を切り替えます。")
                    .font(.system(.footnote, design: .rounded))
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
            .accessibilityLabel("一覧を閉じる")
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(KabuyomiTheme.inkMuted)
            TextField("ティッカー / 企業名で検索", text: $query)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            if !query.isEmpty {
                Button {
                    query = ""
                    Task { await appModel.search(query: "") }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
        }
        .padding(14)
        .kabuyomiCard(.input, radius: 18)
    }

    private var settingsButton: some View {
        Button(action: openSettings) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("設定")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("表示・AI・利用状況・法務")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Label("開く", systemImage: "chevron.right")
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .labelStyle(.titleAndIcon)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kabuyomiCard(.secondary, radius: 22)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var searchSection: some View {
        DrawerSection(title: "検索結果", priority: .standard) {
            if isSearchLoading {
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                    Text("検索中...")
                        .font(.system(.footnote, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .kabuyomiCard(.muted, radius: 18)
            } else if searchResults.isEmpty {
                Text("一致する銘柄がありません。")
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .kabuyomiCard(.muted, radius: 18)
            } else {
                ForEach(searchResults) { item in
                    DrawerSearchRow(item: item, action: { openSearchResult(item) })
                }
            }
        }
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

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Capsule()
                    .fill(isCurrent ? KabuyomiTheme.accentDeep : prominence.accent.opacity(prominence == .subdued ? 0.18 : 0.28))
                    .frame(width: isCurrent ? 6 : 3)
                    .frame(maxHeight: .infinity)

                VStack(alignment: .leading, spacing: 4) {
                    Text(ticker)
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(companyName)
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                    Text(subtitle)
                        .font(.system(.caption, design: .rounded))
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
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kabuyomiCard(isCurrent ? .primary : prominence.surface, radius: 18)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(isCurrent ? KabuyomiTheme.accentSoft.opacity(0.14) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(isCurrent ? KabuyomiTheme.accentDeep.opacity(0.26) : Color.clear, lineWidth: 1.2)
            )
            .opacity(prominence == .subdued && !isCurrent ? 0.9 : 1)
        }
        .buttonStyle(.plain)
    }
}

private struct DrawerSearchRow: View {
    let item: SearchItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
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
                    if !item.isSupportedInV1 {
                        Text(item.availabilityNote)
                            .font(.system(.caption2, design: .rounded, weight: .medium))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer()

                Text(item.isSupportedInV1 ? "開く" : item.availabilityBadgeTitle)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(item.isSupportedInV1 ? KabuyomiTheme.accentDeep : KabuyomiTheme.inkMuted)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(
                        Capsule().fill(
                            item.isSupportedInV1
                                ? AnyShapeStyle(KabuyomiTheme.accentSoft.opacity(0.58))
                                : KabuyomiTheme.fill(for: .secondary)
                        )
                    )
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kabuyomiCard(.muted, radius: 18)
        }
        .buttonStyle(.plain)
        .disabled(!item.isSupportedInV1)
    }
}
