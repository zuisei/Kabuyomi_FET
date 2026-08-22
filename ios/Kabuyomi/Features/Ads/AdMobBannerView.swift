import SwiftUI
import GoogleMobileAds
import UIKit

/// バナー枠の読み込み状態。
///
/// Phase 5 でこの型が要るようになった理由: それまでのバナーは
/// `AdSizeBanner.size.height` を無条件で確保していたので、
/// no-fill や読み込み失敗のときに 320x50 の空枠がそのまま残っていた
/// (v2 IA 仕様 Phase 5「読み込み失敗・未フィル時はスロットごと畳む」に反する)。
enum AdMobBannerLoadState: Equatable {
    case loading
    case loaded
    case failed
}

/// バナー広告の枠。
///
/// 載せるかどうか(free プランか / ユニット ID があるか)はこのビューでは決めない。
/// 判断は `AdMobConfig.bannerSlotIsVisible(isFreePlan:hasBannerAdUnit:)` にあり、
/// 親が true のときだけこのビューを置く。ここが決めるのは
/// 「ロードできたときだけ場所を取る」ことだけ。
struct AdMobBannerView: View {
    let placement: Placement
    var horizontalPadding: CGFloat = 16
    var verticalPadding: CGFloat = 6

    @State private var loadState: AdMobBannerLoadState = .loading

    enum Placement {
        /// サマリータブ最下部の固定スロット(v2 IA 仕様 Phase 5)。
        case summary

        var adUnitID: String {
            switch self {
            case .summary:
                AdMobConfig.bannerAdUnitID
            }
        }

        var adSize: AdSize {
            switch self {
            case .summary:
                AdSizeBanner
            }
        }
    }

    var body: some View {
        // 失敗したら枠ごと消す。`frame(height: 0)` で潰すのではなく
        // ビューツリーから外すので、再ロードも起きない。
        if loadState != .failed {
            slot
        }
    }

    private var slot: some View {
        let adSize = placement.adSize
        let isVisible = loadState == .loaded

        return BannerViewContainer(
            adUnitID: placement.adUnitID,
            adSize: adSize,
            stateChanged: handleStateChange
        )
        .frame(width: adSize.size.width, height: adSize.size.height)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .frame(maxWidth: .infinity)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, isVisible ? verticalPadding : 0)
        // ロードが返るまでは高さ 0。空の枠を先に見せない。
        // 中身は生かしたまま潰すので、ロードは進む。
        .frame(height: isVisible ? adSize.size.height + verticalPadding * 2 : 0)
        .clipped()
        .background(KabuyomiTheme.paper)
        .overlay(alignment: .top) {
            if isVisible { KabuyomiHairline(color: KabuyomiTheme.separatorStrong) }
        }
        .allowsHitTesting(isVisible)
        // 読めていないあいだは VoiceOver からも消す。
        // 高さ 0 の枠に「広告」だけが残るのを避ける。
        .accessibilityElement(children: .contain)
        .accessibilityLabel("広告")
        .accessibilityHidden(!isVisible)
    }

    private func handleStateChange(_ state: AdMobBannerLoadState) {
        guard loadState != state else { return }
        loadState = state
    }
}

private struct BannerViewContainer: UIViewRepresentable {
    let adUnitID: String
    let adSize: AdSize
    let stateChanged: (AdMobBannerLoadState) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(stateChanged: stateChanged)
    }

    func makeUIView(context: Context) -> UIView {
        let container = UIView(frame: CGRect(origin: .zero, size: adSize.size))
        container.clipsToBounds = true
        container.backgroundColor = .clear

        let banner = BannerView(adSize: adSize)
        banner.frame = CGRect(origin: .zero, size: adSize.size)
        banner.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        banner.adUnitID = adUnitID
        banner.delegate = context.coordinator
        banner.rootViewController = UIApplication.shared.kabuyomiRootViewController
        container.addSubview(banner)
        context.coordinator.banner = banner
        context.coordinator.loadedAdSize = adSize.size
        context.coordinator.loadedAdUnitID = adUnitID
        // SDK の初期化は `KabuyomiApp.init` の `MobileAds.shared.start` 1か所だけ。
        // 報酬型と同じ道を使うので、ここでは start を呼ばない。
        banner.load(Request())

        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        context.coordinator.stateChanged = stateChanged
        guard let banner = context.coordinator.banner else { return }
        let sizeChanged = context.coordinator.loadedAdSize != adSize.size
        let unitChanged = context.coordinator.loadedAdUnitID != adUnitID

        container.frame.size = adSize.size
        banner.frame = CGRect(origin: .zero, size: adSize.size)
        banner.adSize = adSize
        if unitChanged {
            banner.adUnitID = adUnitID
        }
        if sizeChanged || unitChanged {
            banner.load(Request())
            context.coordinator.loadedAdSize = adSize.size
            context.coordinator.loadedAdUnitID = adUnitID
        }
        banner.rootViewController = UIApplication.shared.kabuyomiRootViewController
    }

    @MainActor
    final class Coordinator: NSObject, BannerViewDelegate {
        var banner: BannerView?
        var loadedAdSize: CGSize = .zero
        var loadedAdUnitID: String?
        var stateChanged: (AdMobBannerLoadState) -> Void

        init(stateChanged: @escaping (AdMobBannerLoadState) -> Void) {
            self.stateChanged = stateChanged
        }

        func bannerViewDidReceiveAd(_ bannerView: BannerView) {
            report(.loaded)
        }

        func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: Error) {
            RewardedAdDiagnostics.log(
                "banner_ad_failed",
                fields: [
                    "adUnit": RewardedAdDiagnostics.redact(bannerView.adUnitID ?? ""),
                    "error": error.localizedDescription
                ]
            )
            report(.failed)
        }

        /// `load(Request())` は `makeUIView` の中、つまり SwiftUI の更新中に呼ばれる。
        /// 空の ID や即時の no-fill ではデリゲートがその場で返ってくるので、
        /// そのまま `@State` を書くと "Modifying state during view update" になる。
        /// 1ターン遅らせてから渡す。
        private func report(_ state: AdMobBannerLoadState) {
            Task { @MainActor [stateChanged] in
                stateChanged(state)
            }
        }
    }
}

private extension UIApplication {
    var kabuyomiRootViewController: UIViewController? {
        connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
    }
}
