import SwiftUI
import GoogleMobileAds

@main
struct KabuyomiApp: App {
    @State private var appModel: AppModel

    init() {
        // AppModel は UserDefaults をプロパティ初期化子で読む。
        // 初回インストール相当まで戻すなら、生成より**前**に消しておかないと
        // 消える前の値を抱えたモデルが出来上がる。
        #if DEBUG
        AppModel.eraseLocalStateForFreshInstallUITestIfRequested()
        #endif
        _appModel = State(initialValue: AppModel.live())

        guard !AppModel.isRunningTests else { return }
        let testDeviceIdentifiers = AdMobConfig.testDeviceIdentifiers
        if !testDeviceIdentifiers.isEmpty {
            MobileAds.shared.requestConfiguration.testDeviceIdentifiers = testDeviceIdentifiers
            RewardedAdDiagnostics.log(
                "mobile_ads_test_device_mode_configured",
                fields: ["testDeviceCount": String(testDeviceIdentifiers.count)]
            )
        } else if AdMobConfig.rewardedCreditSSVSmokeModeStatus == "blocked_no_test_device_id" {
            RewardedAdDiagnostics.log("mobile_ads_ssv_smoke_mode_blocked_no_test_device_id")
        }
        MobileAds.shared.start { _ in
            Task { @MainActor in
                AdMobRuntimeState.markMobileAdsInitialized()
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if StoreKitCancellationHarnessView.isEnabled {
                StoreKitCancellationHarnessView()
            } else if AppModel.isRunningTests {
                Color.clear
            } else {
                AppRootView()
                    .environment(appModel)
                    .environment(\.managedObjectContext, appModel.persistence.viewContext)
            }
            #else
            if AppModel.isRunningTests {
                Color.clear
            } else {
                AppRootView()
                    .environment(appModel)
                    .environment(\.managedObjectContext, appModel.persistence.viewContext)
            }
            #endif
        }
    }
}
