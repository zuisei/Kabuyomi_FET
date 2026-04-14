import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        NavigationStack {
            ZStack {
                KabuyomiTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        planCard
                        aiCard
                        linksCard
                        resetCard
                    }
                    .padding(20)
                }
            }
            .navigationTitle("設定")
        }
    }

    private var planCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("プラン")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                HStack {
                    Label("BETA", systemImage: "testtube.2")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.55)))
                    Spacer()
                }

                if let usage = appModel.usage {
                    Text("今日のチャット: \(usage.chatsUsed) / \(usage.displayChatLimit)")
                    Text("ウォッチ銘柄: \(usage.stocksUsed) / \(usage.displayStockLimit)")
                } else {
                    Text("利用状況を読み込み中です。")
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Text("課金導線は現在の beta では公開していません。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
    }

    private var aiCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("AI 利用")
                    .font(.system(.headline, design: .rounded, weight: .bold))

                Toggle(isOn: Binding(
                    get: { appModel.aiConsentGranted },
                    set: { appModel.setAIConsent($0) }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Gemini 送信への同意")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                        Text("質問内容と SEC filing コンテキストが Google Gemini に送信されます。個人情報は入力しないでください。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
            }
        }
    }

    private var linksCard: some View {
        card {
            VStack(alignment: .leading, spacing: 10) {
                Text("リンク")
                    .font(.system(.headline, design: .rounded, weight: .bold))

                Text("Privacy Policy / Terms は公開前に設置予定です。beta 中は Support から問い合わせてください。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)

                Text("Support は公開前に設定予定です。")
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }
        }
    }

    private var resetCard: some View {
        card {
            VStack(alignment: .leading, spacing: 12) {
                Text("ローカルデータ")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                Button("データをリセット", role: .destructive) {
                    appModel.resetLocalData()
                }
            }
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .kabuyomiCard(.primary, radius: 26)
    }
}
