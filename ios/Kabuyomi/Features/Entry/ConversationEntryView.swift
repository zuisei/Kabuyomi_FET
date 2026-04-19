import SwiftUI

struct ConversationEntryView: View {
    @Environment(AppModel.self) private var appModel
    @State private var selectedTicker = StarterCompany.defaults.first?.ticker ?? "AAPL"
    @State private var searchPresented = false

    private var starterCompanies: [StarterCompany] {
        Array(appModel.starterCompanies.prefix(5))
    }

    private var selectedCompany: StarterCompany {
        starterCompanies.first(where: { $0.ticker == selectedTicker }) ?? starterCompanies.first ?? StarterCompany(ticker: "AAPL", companyName: "Apple Inc.")
    }

    private var openingQuestions: [String] {
        [
            "今回の一番大きい変化は？",
            "前回決算との違いは？",
            "利益率の推移は？"
        ]
    }

    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    tickerCard
                    actionCard
                    searchButton
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .sheet(isPresented: $searchPresented) {
            SearchView()
                .presentationDragIndicator(.visible)
        }
        .onAppear {
            if !starterCompanies.contains(where: { $0.ticker == selectedTicker }) {
                selectedTicker = starterCompanies.first?.ticker ?? "AAPL"
            }
            appModel.prefetchCompany(ticker: selectedTicker)
        }
        .onChange(of: selectedTicker) { _, newValue in
            appModel.prefetchCompany(ticker: newValue)
        }
    }

    private var tickerCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("まず 1 社を選ぶ")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.heroText)

            Text("Kabuyomi は会話から入り、今回の変化だけでなく前回比や推移もそのまま聞けます。")
                .font(.system(.footnote, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.heroSubtext)
                .lineSpacing(2)

            HStack(spacing: 8) {
                heroFeaturePill(title: "会話", systemImage: "bubble.left.and.bubble.right.fill")
                heroFeaturePill(title: "前回比", systemImage: "arrow.left.arrow.right")
                heroFeaturePill(title: "推移", systemImage: "chart.line.uptrend.xyaxis")
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(starterCompanies) { company in
                        tickerPill(for: company)
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiCard(.hero, radius: 26)
    }

    private func heroFeaturePill(title: String, systemImage: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .bold))
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .bold))
        }
        .foregroundStyle(KabuyomiTheme.heroText)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            Capsule()
                .fill(Color.white.opacity(0.10))
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(0.16), lineWidth: 1)
                )
        )
    }

    private func tickerPill(for company: StarterCompany) -> some View {
        let isSelected = selectedTicker == company.ticker
        return Button {
            selectedTicker = company.ticker
        } label: {
            Text(company.ticker)
                .font(.system(.callout, design: .rounded, weight: .bold))
                .foregroundStyle(isSelected ? KabuyomiTheme.accentDeep : KabuyomiTheme.heroText)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    Capsule()
                        .fill(isSelected ? KabuyomiTheme.accentSoft : Color.white.opacity(0.08))
                        .overlay(
                            Capsule()
                                .stroke(
                                    isSelected ? Color.white.opacity(0.35) : Color.white.opacity(0.14),
                                    lineWidth: isSelected ? 1.5 : 1
                                )
                        )
                        .shadow(
                            color: isSelected ? Color.black.opacity(0.18) : .clear,
                            radius: 6,
                            x: 0,
                            y: 2
                        )
                )
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.12), value: isSelected)
    }

    private var actionCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(selectedCompany.ticker)
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text(selectedCompany.companyName)
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Button {
                appModel.openConversation(for: selectedCompany.ticker)
            } label: {
                HStack {
                    Text("\(selectedCompany.ticker) を開く")
                    Spacer()
                    Image(systemName: "arrow.right")
                }
                .font(.system(.body, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [KabuyomiTheme.accentDeep, KabuyomiTheme.accent],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(Color.white.opacity(0.18), lineWidth: 1)
                        )
                )
                .shadow(color: KabuyomiTheme.accentDeep.opacity(0.18), radius: 12, x: 0, y: 8)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 8) {
                Text("そのまま聞く")
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)

                VStack(spacing: 6) {
                    ForEach(openingQuestions, id: \.self) { question in
                        Button {
                            appModel.openConversation(for: selectedCompany.ticker, draftQuestion: question)
                        } label: {
                            HStack(spacing: 10) {
                                Text(question)
                                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                                    .foregroundStyle(KabuyomiTheme.ink)
                                    .multilineTextAlignment(.leading)

                                Spacer()

                                Image(systemName: "arrow.right")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(KabuyomiTheme.accentDeep)
                            }
                            .padding(.horizontal, 13)
                            .padding(.vertical, 11)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .kabuyomiCard(.secondary, radius: 16)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(16)
        .kabuyomiCard(.primary, radius: 24)
    }

    private var searchButton: some View {
        Button {
            searchPresented = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)

                VStack(alignment: .leading, spacing: 2) {
                    Text("自分の銘柄で始める")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                    Text("検索して保存済みの一覧に追加")
                        .font(.system(.caption2, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .foregroundStyle(KabuyomiTheme.ink)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .kabuyomiGlass(radius: 22, tint: Color.white.opacity(0.22), stroke: Color.white.opacity(0.56))
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("自分の銘柄で始める")
        .accessibilityHint("検索画面を開きます")
        .accessibilityIdentifier("entry.searchButton")
    }
}
