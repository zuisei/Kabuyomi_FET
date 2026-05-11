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

        func adSize(availableWidth: CGFloat) -> AdSize {
            switch self {
            case .watchlist:
                return AdSizeBanner
            }
        }
    }

    var body: some View {
        GeometryReader { proxy in
            let availableWidth = max(1, proxy.size.width - horizontalPadding * 2)
            let adSize = placement.adSize(availableWidth: availableWidth)

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

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UIView {
        let container = UIView(frame: CGRect(origin: .zero, size: adSize.size))
        container.clipsToBounds = true
        container.backgroundColor = .clear

        let banner = BannerView(adSize: adSize)
        banner.frame = CGRect(origin: .zero, size: adSize.size)
        banner.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        banner.adUnitID = adUnitID
        banner.rootViewController = UIApplication.shared.kabuyomiRootViewController
        banner.load(Request())
        container.addSubview(banner)
        context.coordinator.banner = banner
        context.coordinator.loadedAdSize = adSize.size
        context.coordinator.loadedAdUnitID = adUnitID

        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
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

    final class Coordinator {
        var banner: BannerView?
        var loadedAdSize: CGSize = .zero
        var loadedAdUnitID: String?
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
