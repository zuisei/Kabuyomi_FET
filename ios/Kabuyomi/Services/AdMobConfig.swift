import Foundation

enum RewardedAdRuntimeMode: String {
    #if DEBUG
    case debugDemo = "debug_demo"
    case debugSmokeBlockedNoTestDevice = "debug_smoke_blocked_no_test_device"
    case debugSmokeProductionTestDevice = "debug_smoke_production_test_device"
    #endif
    case releaseProduction = "release_production"

    var adUnitID: String {
        switch self {
        #if DEBUG
        case .debugDemo,
             .debugSmokeBlockedNoTestDevice:
            return AdMobConfig.testRewardedCreditAdUnitID
        case .debugSmokeProductionTestDevice:
            return AdMobConfig.productionRewardedCreditAdUnitID
        #endif
        case .releaseProduction:
            return AdMobConfig.productionRewardedCreditAdUnitID
        }
    }

    var adUnitKind: String {
        switch self {
        #if DEBUG
        case .debugDemo,
             .debugSmokeBlockedNoTestDevice:
            return "demo"
        case .debugSmokeProductionTestDevice:
            return "prod_ssv_smoke"
        #endif
        case .releaseProduction:
            return "production"
        }
    }

    var ssvSmokeStatus: String {
        switch self {
        #if DEBUG
        case .debugDemo:
            return "off_demo_ad_unit"
        case .debugSmokeBlockedNoTestDevice:
            return "blocked_no_test_device_id"
        case .debugSmokeProductionTestDevice:
            return "on_test_device"
        #endif
        case .releaseProduction:
            return "unavailable"
        }
    }

    var allowsProductionRewardIntent: Bool {
        switch self {
        #if DEBUG
        case .debugDemo,
             .debugSmokeBlockedNoTestDevice:
            return false
        case .debugSmokeProductionTestDevice:
            return true
        #endif
        case .releaseProduction:
            return true
        }
    }
}

enum AdMobConfig {
    static let appID = "ca-app-pub-1248492954379402~7909080109"
    static let productionRewardedCreditAdUnitID = "ca-app-pub-1248492954379402/7202804414"
    #if DEBUG
    static let testRewardedCreditAdUnitID = "ca-app-pub-3940256099942544/1712485313"
    static let debugDemoAdUnitCannotVerifyProductionSSVReason = "debug_demo_ad_unit_cannot_verify_production_ssv"
    static let ssvSmokeModeUserDefaultsKey = "KabuyomiAdMobSSVSmokeModeEnabled"
    static let testDeviceIdentifiersUserDefaultsKey = "KabuyomiAdMobTestDeviceIdentifiers"
    private static let ssvSmokeModeEnvironmentKey = "KABUYOMI_ADMOB_SSV_SMOKE_MODE"
    private static let testDeviceIdentifiersEnvironmentKey = "KABUYOMI_ADMOB_TEST_DEVICE_IDS"
    #endif

    #if DEBUG
    static let watchlistBannerAdUnitID = "ca-app-pub-3940256099942544/2435281174"
    static var rewardedCreditAdUnitID: String {
        rewardedAdRuntimeMode.adUnitID
    }
    #else
    static let watchlistBannerAdUnitID = "ca-app-pub-1248492954379402/4700244637"
    static let rewardedCreditAdUnitID = RewardedAdRuntimeMode.releaseProduction.adUnitID
    #endif

    #if DEBUG
    static let buildConfiguration = "DEBUG"
    #else
    static let buildConfiguration = "RELEASE"
    #endif

    static var rewardedCreditAdUnitKind: String {
        rewardedAdRuntimeMode.adUnitKind
    }

    static var rewardedAdRuntimeMode: RewardedAdRuntimeMode {
        #if DEBUG
        guard isRewardedCreditSSVSmokeModeEnabled else {
            return .debugDemo
        }
        return isGoogleMobileAdsTestDeviceModeConfigured
            ? .debugSmokeProductionTestDevice
            : .debugSmokeBlockedNoTestDevice
        #else
        return .releaseProduction
        #endif
    }

    #if DEBUG
    static var isRewardedCreditSSVSmokeModeEnabled: Bool {
        if UserDefaults.standard.bool(forKey: ssvSmokeModeUserDefaultsKey) {
            return true
        }
        return truthyEnvironmentValue(ssvSmokeModeEnvironmentKey)
    }

    static func setRewardedCreditSSVSmokeModeEnabled(_ value: Bool) {
        UserDefaults.standard.set(value, forKey: ssvSmokeModeUserDefaultsKey)
    }

    static var testDeviceIdentifiers: [String] {
        var identifiers: [String] = []
        identifiers.append(contentsOf: UserDefaults.standard.stringArray(forKey: testDeviceIdentifiersUserDefaultsKey) ?? [])
        identifiers.append(contentsOf: commaSeparatedEnvironmentValues(testDeviceIdentifiersEnvironmentKey))
        var seen = Set<String>()
        return identifiers
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .filter { seen.insert($0).inserted }
    }

    static func setTestDeviceIdentifiers(_ identifiers: [String]) {
        UserDefaults.standard.set(identifiers, forKey: testDeviceIdentifiersUserDefaultsKey)
    }

    static var isGoogleMobileAdsTestDeviceModeConfigured: Bool {
        !testDeviceIdentifiers.isEmpty
    }

    static var rewardedCreditSSVSmokeModeStatus: String {
        rewardedAdRuntimeMode.ssvSmokeStatus
    }

    static var testDeviceModeDiagnostic: String {
        let count = testDeviceIdentifiers.count
        return count == 0 ? "missing" : "configured(\(count))"
    }

    static var blocksProductionRewardIntentWithCurrentDebugAdUnit: Bool {
        !rewardedAdRuntimeMode.allowsProductionRewardIntent
    }

    private static func truthyEnvironmentValue(_ key: String) -> Bool {
        guard let value = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() else {
            return false
        }
        return ["1", "true", "yes", "on"].contains(value)
    }

    private static func commaSeparatedEnvironmentValues(_ key: String) -> [String] {
        guard let value = ProcessInfo.processInfo.environment[key] else {
            return []
        }
        return value.split(separator: ",").map(String.init)
    }
    #else
    static let testDeviceIdentifiers: [String] = []
    static let isGoogleMobileAdsTestDeviceModeConfigured = false
    static let rewardedCreditSSVSmokeModeStatus = RewardedAdRuntimeMode.releaseProduction.ssvSmokeStatus
    static let testDeviceModeDiagnostic = "ignored"
    static let blocksProductionRewardIntentWithCurrentDebugAdUnit = false
    #endif
}
