import SwiftUI
import GoogleMobileAds
import UIKit

struct AdMobBannerView: View {
    let placement: Placement
    var horizontalPadding: CGFloat = 20
    @State private var bannerHeight = AdSizeBanner.size.height

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
            let availableWidth = max(1, proxy.size.width - horizontalPadding * 2)
            let adSize = largeAnchoredAdaptiveBanner(width: availableWidth)

            HStack {
                Spacer(minLength: 0)
                BannerViewContainer(adUnitID: placement.adUnitID, adSize: adSize)
                    .frame(width: adSize.size.width, height: adSize.size.height)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel("広告")
                Spacer(minLength: 0)
            }
            .padding(.horizontal, horizontalPadding)
            .frame(width: proxy.size.width, height: adSize.size.height)
            .onAppear {
                bannerHeight = adSize.size.height
            }
            .onChange(of: adSize.size.height) { _, height in
                bannerHeight = height
            }
        }
        .frame(height: bannerHeight)
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
