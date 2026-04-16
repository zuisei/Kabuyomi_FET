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
        ConversationRootView()
            .task {
                await appModel.bootstrap()
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

private struct ConversationRootView: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        NavigationStack {
            CompanyView(ticker: appModel.rootConversationTicker)
                .id(appModel.rootConversationTicker)
        }
    }
}
