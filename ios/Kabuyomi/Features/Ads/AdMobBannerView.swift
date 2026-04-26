import SwiftUI
import GoogleMobileAds
import UIKit

struct AdMobBannerView: View {
    let placement: Placement
    var horizontalPadding: CGFloat = 20

    enum Placement {
        case watchlist

        var adUnitID: String {
            switch self {
            case .watchlist:
                AdMobConfig.watchlistBannerAdUnitID
            }
        }
    }

    var body: some View {
        GeometryReader { proxy in
            let adSize = AdSizeBanner

            HStack {
                Spacer(minLength: 0)
                BannerViewContainer(adUnitID: placement.adUnitID, adSize: adSize)
                    .frame(width: adSize.size.width, height: adSize.size.height)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel("広告")
                Spacer(minLength: 0)
            }
            .frame(width: proxy.size.width, height: adSize.size.height)
        }
        .frame(height: 50)
    }
}

private struct BannerViewContainer: UIViewRepresentable {
    let adUnitID: String
    let adSize: AdSize

    func makeUIView(context: Context) -> BannerView {
        let banner = BannerView(adSize: adSize)
        banner.adUnitID = adUnitID
        banner.rootViewController = UIApplication.shared.kabuyomiRootViewController
        banner.load(Request())
        return banner
    }

    func updateUIView(_ banner: BannerView, context: Context) {
        banner.adSize = adSize
        if banner.adUnitID != adUnitID {
            banner.adUnitID = adUnitID
            banner.load(Request())
        }
        banner.rootViewController = UIApplication.shared.kabuyomiRootViewController
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
