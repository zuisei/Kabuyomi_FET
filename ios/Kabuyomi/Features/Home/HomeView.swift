import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var appModel

    private var savedCompanies: [WatchlistCard] {
        appModel.watchlist
    }

    private var latestFilingCards: [WatchlistCard] {
        let newFilings = savedCompanies.filter { appModel.hasNewFiling(for: $0) }
        if !newFilings.isEmpty {
            return newFilings.sorted { $0.filedAt > $1.filedAt }
        }
        return appModel.latestSavedFilings(limit: 3)
    }

    private var recentCompanies: [WatchlistCard] {
        appModel.recentCompanyCards(limit: 3, includeSaved: false)
    }

    private var lastViewedCard: WatchlistCard? {
        guard let lastViewedTicker = appModel.lastViewedTicker else { return nil }
        return appModel.companyCard(for: lastViewedTicker)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                KabuyomiTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        heroCard
                        starterSection

                        if let lastViewedCard {
                            continueSection(card: lastViewedCard)
                        }

                        savedSection

                        if !latestFilingCards.isEmpty {
                            filingSection
                        }

                        if !recentCompanies.isEmpty {
                            recentSection
                        }
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Kabuyomi")
            .toolbarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            await appModel.refreshHome()
                        }
                    } label: {
                        if appModel.homeIsLoading {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(appModel.homeIsLoading)
                    .accessibilityLabel("ホームを更新")
                }
            }
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("米国株の決算書に、日本語で質問する")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.heroText)

            Text("10-Q / 10-K の要点、変化、リスクを日本語で確認し、そのまま出典付きで深掘りできます。")
                .font(.system(.body, design: .rounded))
                .foregroundStyle(KabuyomiTheme.heroSubtext)

            HStack(spacing: 10) {
                NavigationLink {
                    CompanyView(ticker: "AAPL")
                } label: {
                    Text("まず AAPL に質問する")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(KabuyomiTheme.accentDeep)

                Button {
                    appModel.selectedTab = .search
                } label: {
                    Text("検索から始める")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(KabuyomiTheme.accentSoft)
            }

            HStack(spacing: 10) {
                heroPill(title: "一次資料ベース", systemImage: "doc.text")
                heroPill(title: "出典付き", systemImage: "bookmark")
                heroPill(title: "10-K / 10-Q", systemImage: "bubble.left.and.bubble.right")
            }

            if let usage = appModel.usage {
                HStack(spacing: 10) {
                    heroPill(title: appModel.displayPlanLabel(for: usage), systemImage: "sparkles")
                    heroPill(title: "Chat \(usage.chatsUsed)/\(appModel.displayChatLimit(for: usage))", systemImage: "ellipsis.message")
                    heroPill(title: "保存 \(usage.stocksUsed)/\(appModel.displayStockLimit(for: usage))", systemImage: "bookmark")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .kabuyomiCard(.hero, radius: 28)
    }

    private var starterSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(
                title: "スターター銘柄",
                subtitle: "まずは代表的な銘柄で、決算書に質問する体験から始めます。"
            )

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(appModel.starterCompanies) { starter in
                        NavigationLink {
                            CompanyView(ticker: starter.ticker)
                        } label: {
                            StarterCompanyCard(
                                company: starter,
                                isSaved: appModel.isTickerInWatchlist(starter.ticker)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func continueSection(card: WatchlistCard) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(
                title: "続きから聞く",
                subtitle: "最後に開いた銘柄へすぐ戻れます。"
            )

            NavigationLink {
                CompanyView(ticker: card.ticker)
            } label: {
                PrimaryCompanyCard(card: card, badgeText: "最近見た", showsMetrics: false)
            }
            .buttonStyle(.plain)
        }
    }

    private var savedSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(
                title: "保存した銘柄",
                subtitle: "よく聞く銘柄を保存しておく場所です。"
            )

            if savedCompanies.isEmpty {
                EmptyBookmarkCard()
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(savedCompanies) { card in
                        SavedCompanyRow(card: card, hasNewFiling: appModel.hasNewFiling(for: card)) {
                            appModel.removeFromWatchlist(card.ticker)
                        }
                    }
                }
            }
        }
    }

    private var filingSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(
                title: savedCompanies.contains(where: { appModel.hasNewFiling(for: $0) }) ? "新しい filing" : "最近の filing",
                subtitle: "更新のあった銘柄や、直近の filing から優先して見返せます。"
            )

            LazyVStack(spacing: 14) {
                ForEach(latestFilingCards.prefix(3)) { card in
                    NavigationLink {
                        CompanyView(ticker: card.ticker)
                    } label: {
                        PrimaryCompanyCard(
                            card: card,
                            badgeText: appModel.hasNewFiling(for: card) ? "NEW filing" : card.formType,
                            showsMetrics: true
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(
                title: "最近見た銘柄",
                subtitle: "保存していない銘柄も、最近の会話から再開できます。"
            )

            LazyVStack(spacing: 14) {
                ForEach(recentCompanies) { card in
                    NavigationLink {
                        CompanyView(ticker: card.ticker)
                    } label: {
                        PrimaryCompanyCard(card: card, badgeText: "Recent", showsMetrics: false)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func sectionHeader(title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
            Text(subtitle)
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    private func heroPill(title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.system(.footnote, design: .rounded, weight: .semibold))
            .foregroundStyle(KabuyomiTheme.heroText)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule()
                    .fill(Color.white.opacity(0.12))
                    .overlay(
                        Capsule()
                            .stroke(Color.white.opacity(0.14), lineWidth: 1)
                    )
            )
    }
}

private struct StarterCompanyCard: View {
    let company: StarterCompany
    let isSaved: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(company.ticker)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Spacer()
                if isSaved {
                    Image(systemName: "bookmark.fill")
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                }
            }

            Text(company.companyName)
                .font(.system(.body, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .lineLimit(2)

            Text("まず質問する")
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
        }
        .frame(width: 190, alignment: .leading)
        .padding(18)
        .kabuyomiCard(.primary, radius: 24)
    }
}

private struct EmptyBookmarkCard: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "bookmark")
                .font(.system(size: 36, weight: .regular))
                .foregroundStyle(KabuyomiTheme.accent.opacity(0.5))

            Text("まだ保存した銘柄がありません")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text("検索タブから保存するか、スターター銘柄から質問を始めてください。")
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 18)
        .padding(.vertical, 44)
        .kabuyomiCard(.secondary, radius: 28)
    }
}

private struct SavedCompanyRow: View {
    let card: WatchlistCard
    let hasNewFiling: Bool
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            NavigationLink {
                CompanyView(ticker: card.ticker)
            } label: {
                PrimaryCompanyCard(
                    card: card,
                    badgeText: hasNewFiling ? "NEW filing" : "保存済み",
                    showsMetrics: true
                )
            }
            .buttonStyle(.plain)

            Button(role: .destructive, action: onRemove) {
                Image(systemName: "bookmark.slash")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.negative)
                    .padding(10)
                    .background(
                        Circle()
                            .fill(KabuyomiTheme.fill(for: .primary))
                            .shadow(color: Color.black.opacity(0.08), radius: 10, x: 0, y: 4)
                    )
            }
            .buttonStyle(.plain)
            .padding(12)
        }
    }
}

private struct PrimaryCompanyCard: View {
    let card: WatchlistCard
    let badgeText: String
    let showsMetrics: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(card.companyName)
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(card.ticker)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                Spacer()
                Text(badgeText)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.55)))
            }

            Text(card.verdict)
                .font(.system(.body, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .lineLimit(3)

            if showsMetrics {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(card.metrics.prefix(3)) { metric in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(MetricLabeler.title(for: metric.logicalName))
                                    .font(.caption)
                                    .foregroundStyle(KabuyomiTheme.inkMuted)
                                Text(metric.value, format: .number.precision(.fractionLength(metric.logicalName == "epsBasic" ? 2 : 0)))
                                    .font(.system(.callout, design: .rounded, weight: .semibold))
                                    .foregroundStyle(KabuyomiTheme.ink)
                            }
                            .padding(12)
                            .kabuyomiCard(.secondary, radius: 18)
                        }
                    }
                }
            }

            Text(card.filedAt, style: .date)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.primary, radius: 28)
    }
}
