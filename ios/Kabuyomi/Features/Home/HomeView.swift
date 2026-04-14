import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        NavigationStack {
            ZStack {
                KabuyomiTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        heroCard
                        watchlistSection
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Kabuyomi")
            .toolbarTitleDisplayMode(.large)
            .refreshable {
                await appModel.refreshHome()
            }
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SEC 提出書類だけを日本語で読む")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.heroText)

            Text("10-K / 10-Q の要点と出典付きチャットを、一次資料ベースで確認できます。")
                .font(.system(.body, design: .rounded))
                .foregroundStyle(KabuyomiTheme.heroSubtext)

            if let usage = appModel.usage {
                HStack(spacing: 12) {
                    labelPill(title: usage.displayPlanLabel, systemImage: "sparkles")
                    labelPill(title: "Chat \(usage.chatsUsed)/\(usage.displayChatLimit)", systemImage: "bubble.left.and.bubble.right")
                    labelPill(title: "銘柄 \(usage.stocksUsed)/\(usage.displayStockLimit)", systemImage: "bookmark")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .kabuyomiCard(.hero, radius: 28)
    }

    private var watchlistSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("ウォッチリスト")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Spacer()
                if appModel.homeIsLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            if appModel.watchlist.isEmpty {
                EmptyWatchlistCard()
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(appModel.watchlist) { card in
                        NavigationLink {
                            CompanyView(ticker: card.ticker)
                        } label: {
                            WatchlistCardView(card: card)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func labelPill(title: String, systemImage: String) -> some View {
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

private struct EmptyWatchlistCard: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "text.badge.plus")
                .font(.system(size: 38, weight: .regular))
                .foregroundStyle(KabuyomiTheme.accent.opacity(0.5))

            Text("まだ銘柄がありません")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text("検索タブからティッカーを追加してください。")
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .kabuyomiCard(.secondary, radius: 28)
    }
}

private struct WatchlistCardView: View {
    let card: WatchlistCard

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
                Text(card.formType)
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

            Text(card.filedAt, style: .date)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.primary, radius: 28)
    }
}
