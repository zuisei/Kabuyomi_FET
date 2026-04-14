import SwiftUI
import UIKit

struct AppRootView: View {
    @Environment(AppModel.self) private var appModel

    init() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(KabuyomiTheme.tabBarBackground)
        appearance.shadowColor = UIColor(KabuyomiTheme.tabBarStroke)

        let selectedColor = UIColor(KabuyomiTheme.accent)
        let normalColor = UIColor(KabuyomiTheme.inkMuted)
        appearance.stackedLayoutAppearance.selected.iconColor = selectedColor
        appearance.stackedLayoutAppearance.selected.titleTextAttributes = [.foregroundColor: selectedColor]
        appearance.stackedLayoutAppearance.normal.iconColor = normalColor
        appearance.stackedLayoutAppearance.normal.titleTextAttributes = [.foregroundColor: normalColor]

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

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
        TabView {
            HomeView()
                .tabItem {
                    Label("ホーム", systemImage: "text.book.closed")
                }

            SearchView()
                .tabItem {
                    Label("検索", systemImage: "magnifyingglass")
                }

            SettingsView()
                .tabItem {
                    Label("設定", systemImage: "slider.horizontal.3")
                }
        }
        .tint(KabuyomiTheme.accent)
        .toolbarColorScheme(.light, for: .tabBar)
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
