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
        .onChange(of: scenePhase) { _, newPhase in
            appModel.handleRewardedAdScenePhaseChanged(scenePhaseName(newPhase))
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let status = appModel.installationAuthenticationStatus {
                InstallationAuthenticationStatusView(
                    status: status,
                    isRetrying: appModel.installationAuthenticationIsRetrying,
                    retry: {
                        Task {
                            await appModel.retryInstallationAuthentication()
                        }
                    }
                )
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

private struct InstallationAuthenticationStatusView: View {
    let status: InstallationAuthenticationStatus
    let isRetrying: Bool
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lock.trianglebadge.exclamationmark")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(status.failure.title)
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                Text(status.failure.message)
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 4)

            if isRetrying {
                ProgressView()
                    .controlSize(.small)
                    .tint(KabuyomiTheme.accentDeep)
                    .accessibilityLabel("端末認証を再試行中")
            } else if let retryActionTitle = status.retryActionTitle {
                Button(retryActionTitle, action: retry)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityHint("この状態から回復できるか、端末認証をもう一度確認します")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Divider()
                .opacity(0.45)
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
