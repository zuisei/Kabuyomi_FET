import SwiftUI

struct AppRootView: View {
    @Environment(AppModel.self) private var appModel

    private var alertIsPresented: Binding<Bool> {
        Binding(
            get: { appModel.activeAlert != nil },
            set: { newValue in
                if !newValue {
                    appModel.dismissAlert()
                }
            }
        )
    }

    var body: some View {
        Group {
            if appModel.isBootstrapped {
                if appModel.shouldShowConversationEntry {
                    ConversationEntryView()
                } else {
                    NavigationStack {
                        CompanyView(ticker: appModel.rootConversationTicker)
                            .id(appModel.rootConversationTicker)
                    }
                }
            } else {
                LaunchPlaceholderView()
            }
        }
        .task {
            if !appModel.isBootstrapped {
                await appModel.bootstrap()
            }
        }
        .alert(
            "Kabuyomi",
            isPresented: alertIsPresented,
            presenting: appModel.activeAlert,
            actions: { alert in
                if alert.kind == .aiConsent {
                    Button("同意して続ける") {
                        appModel.confirmAIConsent()
                    }
                }
                Button("閉じる", role: .cancel) {}
            },
            message: { alert in
                Text(alert.message)
            }
        )
    }
}

private struct LaunchPlaceholderView: View {
    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            VStack(spacing: 14) {
                ProgressView()
                    .tint(KabuyomiTheme.accentDeep)

                Text("Kabuyomi")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                Text("決算の要点を読み込んでいます")
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .padding(24)
            .kabuyomiCard(.primary, radius: 28)
        }
    }
}
