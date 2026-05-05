import SwiftUI
import GoogleMobileAds

@main
struct KabuyomiApp: App {
    @State private var appModel = AppModel.live()

    init() {
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
            AppRootView()
                .environment(appModel)
                .environment(\.managedObjectContext, appModel.persistence.viewContext)
                .preferredColorScheme(.light)
        }
    }
}
