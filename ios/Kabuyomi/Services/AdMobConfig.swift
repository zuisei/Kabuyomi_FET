import Foundation

enum AdMobConfig {
    static let appID = "ca-app-pub-1248492954379402~7909080109"

    #if DEBUG
    static let watchlistBannerAdUnitID = "ca-app-pub-3940256099942544/2435281174"
    static let rewardedCreditAdUnitID = "ca-app-pub-3940256099942544/1712485313"
    #else
    static let watchlistBannerAdUnitID = "ca-app-pub-1248492954379402/4700244637"
    static let rewardedCreditAdUnitID = "ca-app-pub-1248492954379402/7202804414"
    #endif
}
