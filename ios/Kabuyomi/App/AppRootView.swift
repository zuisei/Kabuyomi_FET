import SwiftUI

struct AppRootView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.scenePhase) private var scenePhase

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
                RedesignRootView()
            } else {
                LaunchPlaceholderView()
            }
        }
        .task {
            if !appModel.isBootstrapped {
                await appModel.bootstrap()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            appModel.handleRewardedAdScenePhaseChanged(scenePhaseName(newPhase))
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
                if alert.kind == .resetConfirmation {
                    Button("リセットする", role: .destructive) {
                        appModel.confirmResetLocalData()
                    }
                }
                Button("閉じる", role: .cancel) {}
            },
            message: { alert in
                Text(alert.message)
            }
        )
    }

    private func scenePhaseName(_ phase: ScenePhase) -> String {
        switch phase {
        case .active:
            return "active"
        case .inactive:
            return "inactive"
        case .background:
            return "background"
        @unknown default:
            return "unknown"
        }
    }
}

private struct LaunchPlaceholderView: View {
    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            VStack(spacing: 12) {
                ProgressView()
                    .tint(KabuyomiTheme.accent)

                Text("Kabuyomi")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                Text("決算の要点を読み込んでいます")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .padding(22)
            .background(KabuyomiTheme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
            }
        }
    }
}
