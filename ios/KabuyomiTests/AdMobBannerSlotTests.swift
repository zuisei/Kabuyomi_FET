import XCTest
@testable import Kabuyomi

/// サマリータブ最下部のバナー枠(docs/ui-redesign-v2/V2_IA_SPEC.md「Phase 5」節)。
///
/// 表示条件は画面ではなく純関数が持つので、シミュレータを起こさずにここで固定できる。
/// 固定したいのは2つ: 課金している人には出ないこと、
/// ユニット ID が空の Release ビルドでは枠そのものが生まれないこと。
final class AdMobBannerSlotTests: XCTestCase {
    // MARK: - 表示条件

    func testBannerSlotIsVisibleOnlyForAFreePlanWithAConfiguredAdUnit() {
        XCTAssertTrue(AdMobConfig.bannerSlotIsVisible(isFreePlan: true, hasBannerAdUnit: true))
    }

    /// 有料購読者には出さない。ユニット ID が設定されていても出さない。
    func testBannerSlotIsHiddenForSubscribers() {
        XCTAssertFalse(AdMobConfig.bannerSlotIsVisible(isFreePlan: false, hasBannerAdUnit: true))
        XCTAssertFalse(AdMobConfig.bannerSlotIsVisible(isFreePlan: false, hasBannerAdUnit: false))
    }

    /// ユニット ID が無いときは free プランでも出さない。
    /// 空 ID のロードは必ず失敗するので、枠を作れば必ず「畳む」経路に入る。
    /// 最初から作らない。
    func testBannerSlotIsHiddenWhenNoAdUnitIsConfigured() {
        XCTAssertFalse(AdMobConfig.bannerSlotIsVisible(isFreePlan: true, hasBannerAdUnit: false))
    }

    // MARK: - ユニット ID の配線

    /// Release の production 定数は現状 **空**。
    /// AdMob コンソールでの発行はリリースオーナーの作業で、
    /// 空のあいだはサマリータブに枠が出ない、というのがこのフェーズの合意。
    func testProductionBannerAdUnitIsUnissuedSoTheReleaseSlotNeverRenders() {
        XCTAssertTrue(
            AdMobConfig.productionBannerAdUnitID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "production のバナーユニットが埋まったなら、この期待もリリースノートも更新すること"
        )
    }

    /// Debug は Google 公式のテストバナー(固定 320x50)。
    /// 画面が使う `AdSizeBanner` と寸法が一致するユニットでなければ、
    /// 実機確認でスロットの高さが合わない。
    func testDebugUsesGooglesOfficialFixedSizeTestBannerUnit() {
        #if DEBUG
        XCTAssertEqual(AdMobConfig.testBannerAdUnitID, "ca-app-pub-3940256099942544/2934735716")
        XCTAssertEqual(AdMobConfig.bannerAdUnitID, AdMobConfig.testBannerAdUnitID)
        XCTAssertTrue(AdMobConfig.hasBannerAdConfig)
        #endif
    }

    /// 空白だけの ID を「設定済み」と数えない(報酬型の `hasRewardedCreditAdConfig` と同じ扱い)。
    func testHasBannerAdConfigMatchesTheTrimmedUnitID() {
        XCTAssertEqual(
            AdMobConfig.hasBannerAdConfig,
            !AdMobConfig.bannerAdUnitID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )
    }
}
