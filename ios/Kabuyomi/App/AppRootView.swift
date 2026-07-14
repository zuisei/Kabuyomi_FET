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
            .kabuyomiGlass(radius: 28, tint: Color.white.opacity(0.28), stroke: Color.white.opacity(0.62))
        }
    }
}
