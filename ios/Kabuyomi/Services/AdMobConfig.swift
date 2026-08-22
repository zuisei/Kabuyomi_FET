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

    /// Release ビルドのバナー枠のユニット ID。
    ///
    /// **現状は空**。空文字は `hasBannerAdConfig` が false になり、
    /// サマリータブのバナー枠はそもそも描かれない(v2 IA 仕様 Phase 5)。
    /// 実ユニットの発行は AdMob コンソール側の作業で、リリースオーナーの管轄。
    ///
    /// 2026-04-26 の休眠実装(commit 50711ec)はここに
    /// `"ca-app-pub-1248492954379402/4700244637"` を持っていた。
    /// 一度も画面に載っていない値で、コンソールで発行済みかどうかの裏が取れていないため、
    /// Phase 5 では採用せずここに記録だけ残す。有効だと確認できたらこの定数に入れる。
    static let productionBannerAdUnitID = ""
    #if DEBUG
    static let testRewardedCreditAdUnitID = "ca-app-pub-3940256099942544/1712485313"
    static let debugDemoAdUnitCannotVerifyProductionSSVReason = "debug_demo_ad_unit_cannot_verify_production_ssv"
    static let ssvSmokeModeUserDefaultsKey = "KabuyomiAdMobSSVSmokeModeEnabled"
    static let testDeviceIdentifiersUserDefaultsKey = "KabuyomiAdMobTestDeviceIdentifiers"
    private static let ssvSmokeModeEnvironmentKey = "KABUYOMI_ADMOB_SSV_SMOKE_MODE"
    private static let testDeviceIdentifiersEnvironmentKey = "KABUYOMI_ADMOB_TEST_DEVICE_IDS"
    #endif

    #if DEBUG
    /// Google 公式のテストバナーユニット(固定サイズ 320x50)。
    /// 画面が使う `AdSizeBanner` と寸法が一致するものを選ぶ。
    static let testBannerAdUnitID = "ca-app-pub-3940256099942544/2934735716"
    static let bannerAdUnitID = testBannerAdUnitID
    static var rewardedCreditAdUnitID: String {
        rewardedAdRuntimeMode.adUnitID
    }
    #else
    static let bannerAdUnitID = productionBannerAdUnitID
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

    static var hasRewardedCreditAdConfig: Bool {
        !rewardedCreditAdUnitID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// バナーユニットが設定されているか。Release で `productionBannerAdUnitID` が空のあいだは false。
    static var hasBannerAdConfig: Bool {
        !bannerAdUnitID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// サマリータブ最下部のバナー枠を描くかどうか。
    ///
    /// 条件は2つだけで、どちらも欠けたら描かない:
    /// 1. free プランであること(課金している人に広告を出さない)
    /// 2. バナーユニット ID が設定されていること(空 ID でのロードは必ず失敗する)
    ///
    /// 画面を起動せずに固定できるよう純関数にしてある。
    /// 呼ぶ側(サマリータブ)が true のときだけ `AdMobBannerView` を載せ、
    /// バナー側はこの判断を一切持たない。
    static func bannerSlotIsVisible(isFreePlan: Bool, hasBannerAdUnit: Bool) -> Bool {
        isFreePlan && hasBannerAdUnit
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
