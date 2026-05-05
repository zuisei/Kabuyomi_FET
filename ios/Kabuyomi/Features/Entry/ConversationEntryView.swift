import SwiftUI

struct ConversationEntryView: View {
    @Environment(AppModel.self) private var appModel
    @AppStorage(AppModel.hasSeenEntryIntroKey) private var hasSeenEntryIntro = false
    @State private var selectedTicker = StarterCompany.defaults.first?.ticker ?? "AAPL"
    @State private var searchPresented = false
    private let tickerColumns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)

    private var starterCompanies: [StarterCompany] {
        Array(appModel.starterCompanies.prefix(5))
    }

    private var selectedCompany: StarterCompany {
        starterCompanies.first(where: { $0.ticker == selectedTicker }) ?? starterCompanies.first ?? StarterCompany(ticker: "AAPL", companyName: "Apple Inc.")
    }

    private var openingQuestions: [String] {
        [
            "今回の最大変化は？",
            "前回決算との違いは？",
            "利益率の推移は？"
        ]
    }

    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            if hasSeenEntryIntro {
                selectionContent
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                introContent
                    .transition(.opacity)
            }
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

    private var selectionContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                entryHeader
                tickerSelector
                actionCard
                searchButton
            }
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 24)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var introContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Kabuyomi")
                        .font(.system(size: 48, weight: .bold, design: .rounded))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.84)

                    Text("米国株のSEC資料を日本語で質問")
                        .font(.system(.headline, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    Text("公開提出資料の内容確認を助けるアプリです。投資助言や売買推奨は行いません。")
                        .font(.system(.footnote, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 18)

                VStack(spacing: 0) {
                    introRow(
                        title: "決算を読む",
                        subtitle: "10-K / 10-Q の要点を確認",
                        systemImage: "doc.text.magnifyingglass"
                    )
                    introDivider
                    introRow(
                        title: "そのまま聞く",
                        subtitle: "根拠資料つきで質問",
                        systemImage: "bubble.left.and.text.bubble.right"
                    )
                    introDivider
                    introRow(
                        title: "銘柄を保存",
                        subtitle: "保存リストからすぐ戻れる",
                        systemImage: "bookmark"
                    )
                }
                .padding(.vertical, 8)
                .kabuyomiCard(.primary, radius: 22)

                VStack(spacing: 12) {
                    Button {
                        withAnimation(.easeOut(duration: 0.22)) {
                            hasSeenEntryIntro = true
                        }
                    } label: {
                        Label("銘柄を選んで質問する", systemImage: "arrow.right")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 54)
                            .background(
                                Capsule()
                                    .fill(
                                        LinearGradient(
                                            colors: [KabuyomiTheme.accentDeep, KabuyomiTheme.accent],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                            )
                            .shadow(color: KabuyomiTheme.accentDeep.opacity(0.22), radius: 14, x: 0, y: 9)
                    }
                    .buttonStyle(.plain)

                    Button {
                        hasSeenEntryIntro = true
                        searchPresented = true
                    } label: {
                        Text("ティッカーや会社名で検索")
                            .font(.system(.footnote, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 46)
                            .kabuyomiGlass(radius: 23, tint: Color.white.opacity(0.26), stroke: Color.white.opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 30)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .scrollBounceBehavior(.basedOnSize)
    }

    private func introRow(title: String, subtitle: String, systemImage: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
                .frame(width: 36, height: 36)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(KabuyomiTheme.accentMist.opacity(0.88))
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(.system(.caption, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 58)
    }

    private var introDivider: some View {
        Divider()
            .overlay(KabuyomiTheme.accentSoft.opacity(0.34))
            .padding(.leading, 62)
            .padding(.trailing, 14)
    }

    private var entryHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("銘柄を選ぶ")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)

            Text("まずはサンプル銘柄から。開いたあと、そのまま会話で深掘りできます。")
                .font(.system(.footnote, design: .rounded, weight: .medium))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 2)
    }

    private var tickerSelector: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 9) {
                Image(systemName: "building.2.crop.circle")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 1) {
                    Text("サンプルから始める")
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("あとから自分の銘柄も追加できます")
                        .font(.system(.caption2, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer(minLength: 0)
            }

            LazyVGrid(columns: tickerColumns, spacing: 8) {
                ForEach(starterCompanies) { company in
                    tickerPill(for: company)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .kabuyomiGlass(radius: 24, tint: Color.white.opacity(0.24), stroke: Color.white.opacity(0.62))
    }

    private func tickerPill(for company: StarterCompany) -> some View {
        let isSelected = selectedTicker == company.ticker
        return Button {
            selectedTicker = company.ticker
        } label: {
            HStack(spacing: 6) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .black))
                }

                Text(company.ticker)
                    .font(.system(.callout, design: .rounded, weight: .bold))
            }
            .foregroundStyle(isSelected ? Color.white : KabuyomiTheme.inkSoft)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(
                Capsule()
                    .fill(isSelected ? KabuyomiTheme.accentDeep : Color.white.opacity(0.48))
                    .overlay(
                        Capsule()
                            .stroke(
                                isSelected ? Color.white.opacity(0.26) : Color.white.opacity(0.72),
                                lineWidth: 1
                            )
                    )
                    .shadow(
                        color: isSelected ? KabuyomiTheme.accentDeep.opacity(0.22) : Color.clear,
                        radius: 8,
                        x: 0,
                        y: 4
                    )
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.12), value: isSelected)
    }

    private var actionCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(selectedCompany.ticker)
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(selectedCompany.companyName)
                        .font(.system(.subheadline, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.86)
                }

                Spacer(minLength: 0)

                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 38, height: 38)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(KabuyomiTheme.accentSoft.opacity(0.64))
                    )
            }

            Button {
                appModel.openConversation(for: selectedCompany.ticker)
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("決算を開く")
                            .font(.system(.body, design: .rounded, weight: .bold))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(selectedCompany.ticker)
                            .font(.system(.caption, design: .rounded, weight: .bold))
                            .opacity(0.72)
                    }

                    Spacer()

                    Image(systemName: "arrow.right")
                        .font(.system(size: 18, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 58)
                .background(
                    RoundedRectangle(cornerRadius: 19, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [KabuyomiTheme.accentDeep, KabuyomiTheme.accent],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 19, style: .continuous)
                                .stroke(Color.white.opacity(0.18), lineWidth: 1)
                        )
                )
                .shadow(color: KabuyomiTheme.accentDeep.opacity(0.18), radius: 12, x: 0, y: 8)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 7) {
                    Image(systemName: "bubble.left.and.text.bubble.right")
                        .font(.system(size: 12, weight: .bold))
                    Text("すぐ聞ける質問")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                }
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .padding(.bottom, 8)

                VStack(spacing: 0) {
                    ForEach(Array(openingQuestions.enumerated()), id: \.element) { index, question in
                        openingQuestionRow(question)
                        if index < openingQuestions.count - 1 {
                            Divider()
                                .overlay(KabuyomiTheme.accentSoft.opacity(0.42))
                                .padding(.leading, 34)
                        }
                    }
                }
                .padding(.vertical, 3)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(KabuyomiTheme.accentMist.opacity(0.32))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(KabuyomiTheme.accentSoft.opacity(0.24), lineWidth: 1)
                        )
                )
            }
        }
        .padding(16)
        .kabuyomiCard(.primary, radius: 24)
    }

    private func openingQuestionRow(_ question: String) -> some View {
        Button {
            appModel.openConversation(for: selectedCompany.ticker, draftQuestion: question)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "arrow.turn.down.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 24, height: 24)

                Text(question)
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)

                Spacer(minLength: 6)

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.72))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
    }

    private var searchButton: some View {
        Button {
            searchPresented = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                VStack(alignment: .leading, spacing: 2) {
                    Text("自分の銘柄で始める")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                    Text("検索してそのまま開けます")
                        .font(.system(.caption2, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                Text("検索")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Color.white.opacity(0.48)))
            }
            .foregroundStyle(KabuyomiTheme.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .kabuyomiGlass(radius: 22, tint: Color.white.opacity(0.22), stroke: Color.white.opacity(0.58))
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("自分の銘柄で始める")
        .accessibilityHint("検索画面を開きます")
        .accessibilityIdentifier("entry.searchButton")
    }
}
