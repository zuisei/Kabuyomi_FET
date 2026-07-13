import Foundation
import os
@preconcurrency import GoogleMobileAds
import UIKit

extension RewardedAd: @unchecked @retroactive Sendable {}

enum RewardedAdDiagnostics {
    private static let logger = Logger(subsystem: "app.kabuyomi.ios", category: "rewarded_ad")

    static func log(_ event: String, fields: [String: String] = [:]) {
        let details = fields
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: " ")
        let line = details.isEmpty ? event : "\(event) \(details)"
        logger.info("\(line, privacy: .public)")
        print("[rewarded_ad] \(line)")
    }

    static func redact(_ value: String, visibleCount: Int = 4) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "empty" }
        guard trimmed.count > visibleCount * 2 else { return "***" }
        return "\(trimmed.prefix(visibleCount))...\(trimmed.suffix(visibleCount))"
    }
}

@MainActor
enum AdMobRuntimeState {
    private(set) static var mobileAdsInitialized = false

    static func markMobileAdsInitialized() {
        mobileAdsInitialized = true
        RewardedAdDiagnostics.log("mobile_ads_initialized")
    }
}

enum RewardedAdServiceError: LocalizedError, Equatable {
    case noAdAvailable
    case presentationUnavailable
    case presenterUnavailable
    case presentFailedAlreadyPresenting
    case ssvNotReceivedOrRewardStatusPending
    case dismissedWithoutReward

    var errorDescription: String? {
        switch self {
        case .noAdAvailable:
            "現在広告を利用できません。少し時間をおいて再試行してください。"
        case .presentationUnavailable,
             .presenterUnavailable,
             .presentFailedAlreadyPresenting:
            "広告を表示できませんでした。少し時間をおいて再試行してください。"
        case .ssvNotReceivedOrRewardStatusPending:
            "広告視聴は完了しましたが、サーバー確認がまだ完了していません。少し時間をおいて残高を更新してください。"
        case .dismissedWithoutReward:
            "広告の視聴が完了していないため、無料/ad creditは付与されませんでした。"
        }
    }
}

@MainActor
protocol RewardedAdServing {
    func presentRewardedAd(customData: String) async throws -> Bool
}

@MainActor
final class GoogleRewardedAdService: NSObject, RewardedAdServing {
    static let shared = GoogleRewardedAdService()

    private var rewardedAd: RewardedAd?
    private var didEarnReward = false
    private var presentationContinuation: CheckedContinuation<Bool, Error>?

    func presentRewardedAd(customData: String) async throws -> Bool {
        RewardedAdDiagnostics.log(
            "present_rewarded_ad_entered",
            fields: [
                "adUnitKind": AdMobConfig.rewardedCreditAdUnitKind,
                "adUnit": RewardedAdDiagnostics.redact(AdMobConfig.rewardedCreditAdUnitID),
                "customDataPresent": String(!customData.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
                "mobileAdsInitialized": String(AdMobRuntimeState.mobileAdsInitialized)
            ]
        )
        try await loadRewardedAd(customData: customData)
        guard let ad = rewardedAd else {
            RewardedAdDiagnostics.log("present_rewarded_ad_no_loaded_ad")
            throw RewardedAdServiceError.noAdAvailable
        }
        guard let presenter = await resolvedPresenterForRewardedAd() else {
            RewardedAdDiagnostics.log("rewarded_ad_presenter_unavailable")
            throw RewardedAdServiceError.presenterUnavailable
        }

        return try await withCheckedThrowingContinuation { continuation in
            self.didEarnReward = false
            self.presentationContinuation = continuation
            ad.fullScreenContentDelegate = self
            RewardedAdDiagnostics.log(
                "rewarded_ad_present_started",
                fields: [
                    "presenter": String(describing: type(of: presenter)),
                    "ssvCustomDataSet": String(ad.serverSideVerificationOptions?.customRewardText?.isEmpty == false)
                ]
            )
            ad.present(from: presenter) {
                RewardedAdDiagnostics.log("rewarded_ad_user_did_earn_reward")
                self.didEarnReward = true
            }
        }
    }

    private func resolvedPresenterForRewardedAd() async -> UIViewController? {
        let first = UIApplication.shared.kabuyomiRewardedAdPresenter()
        RewardedAdDiagnostics.log(
            "rewarded_ad_presenter_resolved",
            fields: first.diagnostics
        )

        guard first.presenter?.presentedViewController != nil else {
            return first.presenter
        }

        await Task.yield()
        let retry = UIApplication.shared.kabuyomiRewardedAdPresenter()
        RewardedAdDiagnostics.log(
            "rewarded_ad_presenter_retry_resolved",
            fields: retry.diagnostics
        )
        return retry.presenter
    }

    private func loadRewardedAd(customData: String) async throws {
        RewardedAdDiagnostics.log(
            "rewarded_ad_load_started",
            fields: [
                "adUnitKind": AdMobConfig.rewardedCreditAdUnitKind,
                "adUnit": RewardedAdDiagnostics.redact(AdMobConfig.rewardedCreditAdUnitID)
            ]
        )
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            RewardedAd.load(with: AdMobConfig.rewardedCreditAdUnitID, request: Request()) { ad, error in
                MainActor.assumeIsolated {
                    if let error {
                        RewardedAdDiagnostics.log(
                            "rewarded_ad_load_failed",
                            fields: ["error": error.localizedDescription]
                        )
                        continuation.resume(throwing: error)
                        return
                    }
                    guard let ad else {
                        RewardedAdDiagnostics.log("rewarded_ad_load_empty")
                        continuation.resume(throwing: RewardedAdServiceError.noAdAvailable)
                        return
                    }
                    let options = ServerSideVerificationOptions()
                    options.customRewardText = customData
                    ad.serverSideVerificationOptions = options
                    self.rewardedAd = ad
                    RewardedAdDiagnostics.log(
                        "rewarded_ad_load_succeeded",
                        fields: [
                            "ssvCustomDataSet": String(options.customRewardText?.isEmpty == false)
                        ]
                    )
                    continuation.resume()
                }
            }
        }
    }
}

extension GoogleRewardedAdService: FullScreenContentDelegate {
    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        RewardedAdDiagnostics.log(
            "rewarded_ad_dismissed",
            fields: ["didEarnReward": String(didEarnReward)]
        )
        presentationContinuation?.resume(returning: didEarnReward)
        presentationContinuation = nil
        didEarnReward = false
        rewardedAd = nil
    }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        let mappedError: Error = error.localizedDescription.localizedCaseInsensitiveContains("already presenting")
            ? RewardedAdServiceError.presentFailedAlreadyPresenting
            : error
        RewardedAdDiagnostics.log(
            "rewarded_ad_present_failed",
            fields: [
                "error": error.localizedDescription,
                "mappedReason": mappedError is RewardedAdServiceError ? "rewarded_ad_present_failed_already_presenting" : "provider_present_failed"
            ]
        )
        presentationContinuation?.resume(throwing: mappedError)
        presentationContinuation = nil
        didEarnReward = false
        rewardedAd = nil
    }
}

private extension UIApplication {
    func kabuyomiRewardedAdPresenter() -> (presenter: UIViewController?, diagnostics: [String: String]) {
        let root = connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController

        let presenter = root?.kabuyomiTopMostVisibleViewController()
        return (
            presenter,
            [
                "root": root.map { String(describing: type(of: $0)) } ?? "nil",
                "rootHadPresentedViewController": String(root?.presentedViewController != nil),
                "finalPresenter": presenter.map { String(describing: type(of: $0)) } ?? "nil",
                "finalPresenterHasPresentedViewController": String(presenter?.presentedViewController != nil)
            ]
        )
    }
}

private extension UIViewController {
    func kabuyomiTopMostVisibleViewController() -> UIViewController {
        if let presentedViewController {
            return presentedViewController.kabuyomiTopMostVisibleViewController()
        }

        if let navigationController = self as? UINavigationController,
           let visibleViewController = navigationController.visibleViewController {
            return visibleViewController.kabuyomiTopMostVisibleViewController()
        }

        if let tabBarController = self as? UITabBarController,
           let selectedViewController = tabBarController.selectedViewController {
            return selectedViewController.kabuyomiTopMostVisibleViewController()
        }

        if let splitViewController = self as? UISplitViewController,
           let visibleViewController = splitViewController.viewControllers.last {
            return visibleViewController.kabuyomiTopMostVisibleViewController()
        }

        return self
    }
}
