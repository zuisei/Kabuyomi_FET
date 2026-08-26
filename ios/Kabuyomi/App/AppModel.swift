import CryptoKit
import Foundation
import Observation
import Security

struct PendingChatState: Equatable {
    let id: UUID
    let operationId: String
    let ticker: String
    let question: String
    let submittedAt: Date

    init(
        id: UUID = UUID(),
        operationId: String = UUID().uuidString,
        ticker: String,
        question: String,
        submittedAt: Date = .now
    ) {
        self.id = id
        self.operationId = operationId
        self.ticker = ticker
        self.question = question
        self.submittedAt = submittedAt
    }

    var optimisticUserMessage: LocalChatMessage {
        LocalChatMessage(
            id: id,
            role: "user",
            content: question,
            createdAt: submittedAt,
            modelName: "local",
            sources: []
        )
    }
}

private struct RetryableChatOperation: Equatable {
    let filingKey: String
    let question: String
    let conversationContext: [ChatContextMessage]
    let operationId: String

    func matches(
        filingKey: String,
        question: String,
        conversationContext: [ChatContextMessage]
    ) -> Bool {
        self.filingKey == filingKey
            && self.question == question
            && self.conversationContext == conversationContext
    }
}

enum UsageLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed
}

enum InstallationIdentityFailureKind: Equatable {
    case networkUnavailable
    case appAttestTemporarilyUnavailable
    case appAttestUnsupported
    case serverMaintenance
    case invalidCredentials
    case identityConflict
    case secureStorageTemporarilyUnavailable
    case invalidStoredCredential
    case invalidAppSignature
    case permanentAuthenticationFailure
    case unknown
}

struct InstallationIdentityFailure: Equatable {
    let kind: InstallationIdentityFailureKind

    var isRetryable: Bool {
        switch kind {
        case .networkUnavailable, .appAttestTemporarilyUnavailable, .serverMaintenance,
             .secureStorageTemporarilyUnavailable, .unknown:
            return true
        case .appAttestUnsupported, .invalidCredentials, .identityConflict, .invalidStoredCredential,
             .invalidAppSignature, .permanentAuthenticationFailure:
            return false
        }
    }

    var title: String {
        switch kind {
        case .networkUnavailable:
            return "オフラインで閲覧中"
        case .appAttestTemporarilyUnavailable:
            return "安全確認を再試行します"
        case .appAttestUnsupported:
            return "閲覧専用で利用中"
        case .serverMaintenance:
            return "認証サービスを確認中"
        case .invalidCredentials:
            return "端末認証を確認できません"
        case .identityConflict:
            return "端末認証を更新できません"
        case .secureStorageTemporarilyUnavailable:
            return "安全な保存領域を一時的に確認できません"
        case .invalidStoredCredential:
            return "端末認証データを確認できません"
        case .invalidAppSignature:
            return "このアプリの署名を確認できません"
        case .permanentAuthenticationFailure:
            return "この端末の認証を利用できません"
        case .unknown:
            return "一部機能を一時停止しています"
        }
    }

    var message: String {
        switch kind {
        case .networkUnavailable:
            return "通信を確認できません。保存済みの企業・決算資料は閲覧できます。チャット、保存、購入などは再接続後に利用できます。"
        case .appAttestTemporarilyUnavailable:
            return "Apple の安全確認を一時的に完了できません。保存済みデータは閲覧できますが、クレジットを変更する操作は停止しています。"
        case .appAttestUnsupported:
            return "この端末では App Attest を利用できないため、保存済みデータの閲覧と公開検索のみ利用できます。クレジットを変更する操作は利用できません。"
        case .serverMaintenance:
            return "認証サービスが一時的に利用できません。保存済みデータは閲覧できます。メンテナンス終了後に再試行してください。"
        case .invalidCredentials:
            return "保存済みデータは閲覧できますが、端末の認証情報が無効なため認証が必要な操作を停止しています。"
        case .identityConflict:
            return "端末の認証情報が以前の登録と一致しません。保存済みデータは閲覧できますが、認証が必要な操作は利用できません。"
        case .secureStorageTemporarilyUnavailable:
            return "端末のロックを解除した状態で、もう一度確認してください。保存済みデータはそのまま閲覧できます。"
        case .invalidStoredCredential:
            return "保存済みの端末認証データと現在のアプリ形式が一致しません。保存済みデータはそのまま閲覧できます。"
        case .invalidAppSignature:
            return "Keychain を利用できないビルドです。正しく署名されたKabuyomiを再インストールしてください。保存済みデータはそのまま閲覧できます。"
        case .permanentAuthenticationFailure:
            return "保存済みデータは閲覧できますが、このインストールでは認証が必要な操作を利用できません。"
        case .unknown:
            return "端末認証を完了できません。保存済みデータは閲覧できますが、認証が必要な操作は一時停止しています。"
        }
    }

    static func classify(_ error: Error) -> InstallationIdentityFailure {
        if let identityError = error as? InstallationIdentityError {
            switch identityError {
            case .appAttestUnavailable:
                return InstallationIdentityFailure(kind: .appAttestUnsupported)
            case .appAttestTemporarilyUnavailable, .appAttestKeyInvalid, .expiredChallenge:
                return InstallationIdentityFailure(kind: .appAttestTemporarilyUnavailable)
            case .keychainFailure(let status):
                if status == errSecMissingEntitlement {
                    return InstallationIdentityFailure(kind: .invalidAppSignature)
                }
                return InstallationIdentityFailure(kind: .secureStorageTemporarilyUnavailable)
            case .invalidStoredCredential:
                return InstallationIdentityFailure(kind: .invalidStoredCredential)
            case .attestationNotVerified, .replayedChallenge:
                return InstallationIdentityFailure(kind: .permanentAuthenticationFailure)
            case .identityUnavailable:
                return InstallationIdentityFailure(kind: .unknown)
            }
        }

        if let apiError = error as? APIError {
            switch apiError {
            case .serverStatus(let statusCode, _):
                if statusCode == 401 {
                    return InstallationIdentityFailure(kind: .invalidCredentials)
                }
                if statusCode == 409 {
                    return InstallationIdentityFailure(kind: .identityConflict)
                }
                if statusCode == 403 || statusCode == 410 || statusCode == 451 {
                    return InstallationIdentityFailure(kind: .permanentAuthenticationFailure)
                }
                if statusCode == 429 || (500...599).contains(statusCode) {
                    return InstallationIdentityFailure(kind: .serverMaintenance)
                }
            case .routeMissing, .invalidResponse:
                return InstallationIdentityFailure(kind: .serverMaintenance)
            default:
                break
            }
        }

        let nsError = error as NSError
        if error is URLError || nsError.domain == NSURLErrorDomain {
            return InstallationIdentityFailure(kind: .networkUnavailable)
        }
        return InstallationIdentityFailure(kind: .unknown)
    }
}

struct InstallationIdentityRetryPolicy: Equatable {
    let automaticRetryDelaysNanoseconds: [UInt64]

    // Initial attempt, then 1s, 2s, and 4s. The finite list prevents an
    // unattended startup loop from retrying forever.
    static let production = InstallationIdentityRetryPolicy(
        automaticRetryDelaysNanoseconds: [1_000_000_000, 2_000_000_000, 4_000_000_000]
    )

    static let immediateForTests = InstallationIdentityRetryPolicy(
        automaticRetryDelaysNanoseconds: [0, 0, 0]
    )
}

enum InstallationIdentityLoadState: Equatable {
    case idle
    case loading(attempt: Int)
    case ready(attestationStatus: InstallationAttestationStatus, creditMode: InstallationCreditMode)
    case degraded(failure: InstallationIdentityFailure, attemptCount: Int)
}

struct InstallationAuthenticationStatus: Equatable {
    let failure: InstallationIdentityFailure

    var canRetry: Bool {
        retryActionTitle != nil
    }

    var retryActionTitle: String? {
        guard failure.isRetryable else { return nil }
        switch failure.kind {
        case .networkUnavailable:
            return "再接続"
        case .appAttestTemporarilyUnavailable:
            return "安全確認"
        case .serverMaintenance:
            return "再確認"
        case .secureStorageTemporarilyUnavailable:
            return "もう一度確認"
        case .unknown:
            return "再試行"
        case .appAttestUnsupported, .invalidCredentials, .identityConflict, .invalidStoredCredential,
             .invalidAppSignature, .permanentAuthenticationFailure:
            return nil
        }
    }
}

enum SubscriptionProductLoadState {
    case idle
    case loading
    case loaded
    case unavailable
    case failed
}

enum RewardedAdCreditState: Equatable {
    case idle
    case loading
    case presenting
    case pendingGrant
    case dailyCapReached

    var debugName: String {
        switch self {
        case .idle:
            return "idle"
        case .loading:
            return "loading"
        case .presenting:
            return "presenting"
        case .pendingGrant:
            return "pending_grant"
        case .dailyCapReached:
            return "daily_cap_reached"
        }
    }
}

enum RewardedAdReturnDestination: String, Equatable {
    case credits
}

enum InsufficientCreditRecoverySource: String, Equatable {
    case chatComposer
    case localChatPreflight
    case serverChatResponse
}

struct InsufficientCreditRecoveryState: Equatable {
    let requiredCredits: Int
    let remainingCredits: Int
    let source: InsufficientCreditRecoverySource
}

enum CompanyRefreshResult: Equatable {
    case unchanged
    case needsConfirmation(CompanyPayload)
    case retryable
}

private enum UsageUpdateSource {
    case refresh
    case chat
    case quoteTranslation
    case watchlistAdd
    case watchlistRemove
}

@MainActor
@Observable
final class AppModel {
    private let minimumPendingChatDuration: TimeInterval = 1.0
    static var isRunningTests: Bool {
        ProcessInfo.processInfo.environment["XCTestBundlePath"]?.hasSuffix("KabuyomiTests.xctest") == true
            || NSClassFromString("XCTestCase") != nil
            || NSClassFromString("XCTest.XCTestCase") != nil
    }

    static let aiConsentKey = "kabuyomi.aiConsentGranted"
    static let aiConsentAlertMessage = """
AI 利用前に、質問内容と対象の決算資料の抜粋を外部 AI モデルへ送信することへの同意が必要です。
個人情報や口座情報は入力しないでください。
"""
    static let savedTickersKey = "kabuyomi.savedTickers"
    static let recentTickersKey = "kabuyomi.recentTickers"
    static let lastViewedTickerKey = "kabuyomi.lastViewedTicker"
    static let activeConversationTickerKey = "kabuyomi.activeConversationTicker"
    static let showStarterCompaniesKey = "kabuyomi.showStarterCompanies"
    static let hasCompletedInitialEntryKey = "kabuyomi.hasCompletedInitialEntry"
    static let hasSeenEntryIntroKey = "kabuyomi.hasSeenEntryIntro"
    static let pendingConversationTickerKey = "kabuyomi.pendingConversationTicker"
    static let pendingConversationQuestionKey = "kabuyomi.pendingConversationQuestion"
    static let appLaunchCountKey = "kabuyomi.appLaunchCount"
    static let starterCompaniesAutoHiddenKey = "kabuyomi.starterCompaniesAutoHidden"
    static let starterCompaniesAutoHideLaunchThreshold = 5
    /// 会社ごとの最終閲覧時刻。`kabuyomi.lastSeenFiling.<TICKER>` と同じ
    /// 「接頭辞 + ticker」のフラットキーで、値は 1970 起点の秒(Double)。
    static let lastOpenedAtKeyPrefix = "kabuyomi.lastOpenedAt."
    #if DEBUG
    static let devModeEnabledKey = "kabuyomi.detachedAccess.devModeEnabled"
    #endif

    private(set) var apiClient: APIClient
    let persistence: PersistenceController
    let deviceIdentity: DeviceIdentityStore
    private let subscriptionStore: SubscriptionStore
    private let rewardedAdService: RewardedAdServing
    private let accountCredentialStore: (any AccountCredentialStoring)?
    private let installationIdentityRetryPolicy: InstallationIdentityRetryPolicy

    var watchlist: [WatchlistCard] = []
    var recentCompanies: [WatchlistCard] = []
    var searchResults: [SearchItem] = []
    var searchErrorMessage: String?
    var usage: UsagePayload?
    var usageLoadState: UsageLoadState = .idle
    var installationIdentityLoadState: InstallationIdentityLoadState = .idle
    private(set) var installationAuthenticationIsRetrying = false
    var companyCache: [String: CompanyPayload] = [:]
    var companyLoadStates: [String: CompanyLoadStatePayload] = [:]
    var chatHistoryCache: [String: [LocalChatMessage]] = [:]
    var pendingChats: [String: PendingChatState] = [:]
    /// 会社ごとの最終閲覧時刻。盤面の未読ドットの基準。
    /// UserDefaults の読み書きを毎描画で行うと SwiftUI は変化を観測できないので、
    /// 起動時に一度だけ読み出して観測可能な状態として保持し、書き込み時に両方を更新する。
    private(set) var lastOpenedAt: [String: Date] = AppModel.loadPersistedLastOpenedAt()
    var lastViewedTicker = UserDefaults.standard.string(forKey: "kabuyomi.lastViewedTicker")
    var activeConversationTicker = UserDefaults.standard.string(forKey: "kabuyomi.activeConversationTicker")

    var isBootstrapped = false
    var searchIsLoading = false
    var companyIsLoading = false
    var chatIsSending = false
    var billingActionInFlight = false
    var rewardedAdCreditState: RewardedAdCreditState = .idle
    var rewardedAdStatusMessage: String?
    var rewardedAdLastDebugReason: String = "none"
    private(set) var rewardedAdReturnDestination: RewardedAdReturnDestination?
    private(set) var rewardedAdReturnRestorationRequestID: UUID?
    private var rewardedAdReturnFlowID: UUID?
    private var rewardedAdReturnUserNavigatedAway = false
    private(set) var insufficientCreditRecovery: InsufficientCreditRecoveryState?
    private(set) var insufficientCreditRecoveryRequestID: UUID?
    var subscriptionProductLoadState: SubscriptionProductLoadState = .idle
    var subscriptionProductLoadErrorMessage: String?
    var subscriptionProducts: [SubscriptionProduct] = BillingCatalog.subscriptionTiers.map {
        SubscriptionProduct(tier: $0, displayPrice: nil, isAvailable: false)
    }
    var creditPackProducts: [CreditPackProduct] = []
    var creditPackProductLoadState: SubscriptionProductLoadState = .idle
    var creditPackProductLoadErrorMessage: String?
    var creditPackProductLoadInFlight = false
    var storeKitDiagnostics = StoreKitDiagnosticsSnapshot.initial(requestedProductIds: SubscriptionStore.creditPackProductIDs)
    var lastUsageRefreshAt: Date?
    var lastBillingSyncStatus: String = "not_started"
    var lastBillingSyncAt: Date?
    var billingAPIHealthReport: BillingAPIHealthReport?
    var billingAPIHealthCheckInFlight = false
    var activeAlert: AppAlertState?
    /// レビュー依頼を出したい瞬間だけ true になる。実際に依頼を出すのは
    /// SwiftUI の `requestReview` を持つ view 側(モデルは UI を呼ばない)。
    var pendingReviewRequest = false
    private(set) var accountCredential: AccountCredential?
    @ObservationIgnored private let reviewPromptGate = ReviewPromptGate()
    var aiConsentGranted = UserDefaults.standard.bool(forKey: "kabuyomi.aiConsentGranted")
    var showStarterCompanies = UserDefaults.standard.object(forKey: "kabuyomi.showStarterCompanies") as? Bool ?? true
    var hasCompletedInitialEntry = UserDefaults.standard.bool(forKey: "kabuyomi.hasCompletedInitialEntry")
    var appLaunchCount = UserDefaults.standard.integer(forKey: "kabuyomi.appLaunchCount")
    #if DEBUG
    var devModeEnabled = UserDefaults.standard.bool(forKey: "kabuyomi.detachedAccess.devModeEnabled")
    var usesTestAPI = APIBaseURLResolver.selectedDebugEnvironment == .test
    var rewardedAdSSVSmokeModeEnabled = AdMobConfig.isRewardedCreditSSVSmokeModeEnabled
    #endif

    private var searchGeneration = 0
    private var stateGeneration = 0
    private var addingTickers: Set<String> = []
    private var loadingTickers: Set<String> = []
    private var accessRevokedTickers: Set<String> = []
    private var refreshedTickersThisSession: Set<String> = []
    private var companyRetryTasks: [String: Task<Void, Never>] = [:]
    private var activeConversationFilingKeys: [String: String] = [:]
    private var retryableChatOperations: [String: RetryableChatOperation] = [:]
    private var authenticationDeferredCompanyTickers: Set<String> = []
    private var installationIdentityAuthenticationTask: Task<Void, Never>?
    private var installationIdentityAuthenticationTaskID: UUID?
    private var watchlistMutationInFlight = false
    private var watchlistMutationWaiters: [CheckedContinuation<Void, Never>] = []
    private var usageMutationGeneration = 0
    private var creditGrantRecoveryInFlight = false
    private var subscriptionStateObserver: NSObjectProtocol?
    private var savedTickers = AppModel.normalizedTickers(UserDefaults.standard.stringArray(forKey: "kabuyomi.savedTickers") ?? [])
    private var recentTickers = AppModel.normalizedTickers(UserDefaults.standard.stringArray(forKey: "kabuyomi.recentTickers") ?? [])
    /// 初回訪問時は payload が通信中で recordCompanyVisit が guard で帰るため、
    /// 最近リスト(recentTickers / recentCompanies)への記帳が丸ごと落ちていた。
    /// 症状: 開いただけの会社がそのセッション中は盤面にもストリームにも出ない
    /// (保存すれば watchlist 経由で即出る、再起動すれば復元経路の再訪問で出る)。
    /// 訪問だけ予約しておき、handleLoadedCompany が清算する。
    /// 予約は最後の1件だけ持つ — 訪問中にユーザーが別の会社へ移った場合、
    /// 古い方を最近の先頭に押し込むのは嘘になるため。
    private var pendingVisitTicker: String?
    private var pendingConversationTicker = UserDefaults.standard.string(forKey: "kabuyomi.pendingConversationTicker")
    private var pendingConversationQuestion = UserDefaults.standard.string(forKey: "kabuyomi.pendingConversationQuestion")
    private var starterCompaniesAutoHidden = UserDefaults.standard.bool(forKey: "kabuyomi.starterCompaniesAutoHidden")

    init(
        apiClient: APIClient,
        persistence: PersistenceController,
        deviceIdentity: DeviceIdentityStore,
        subscriptionStore: SubscriptionStore = .shared,
        rewardedAdService: RewardedAdServing = GoogleRewardedAdService.shared,
        accountCredentialStore: (any AccountCredentialStoring)? = nil,
        installationIdentityRetryPolicy: InstallationIdentityRetryPolicy = .production
    ) {
        self.apiClient = apiClient
        self.persistence = persistence
        self.deviceIdentity = deviceIdentity
        self.subscriptionStore = subscriptionStore
        self.rewardedAdService = rewardedAdService
        self.accountCredentialStore = accountCredentialStore
        self.installationIdentityRetryPolicy = installationIdentityRetryPolicy
        self.accountCredential = try? accountCredentialStore?.load()
        self.subscriptionStateObserver = NotificationCenter.default.addObserver(
            forName: .kabuyomiSubscriptionStateDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                _ = await self.syncBillingState(showErrors: false)
                await self.recoverUnfinishedCreditPurchases(showErrors: false)
                await self.refreshUsage()
            }
        }
    }

    #if DEBUG
    /// UI テスト専用の起動引数。**これが渡されたときだけ**、
    /// ローカルの痕跡(UserDefaults 側)を初回インストール相当まで消す。
    static let freshInstallUITestArgument = "-KabuyomiUITestFreshInstall"

    /// 初回動線(v2 IA 仕様 Phase 6)は「本当の初回」でしか出ないので、
    /// UI テストからは通常たどり着けない — `XCUIApplication` は
    /// terminate/launch しかできず、アプリを消してくれない。
    /// シミュレータを erase してからの1本目に賭けると、実行順しだいで
    /// 通ったり通らなかったりするテストになる。
    ///
    /// 消すのは UserDefaults だけで十分。盤面もストリームも
    /// `savedTickers` / `recentTickers` から導出されるので、
    /// Core Data に会社が残っていても面には出てこない。
    /// `PersistenceController` には触らない(消す範囲を最小に保つ)。
    static func eraseLocalStateForFreshInstallUITestIfRequested() {
        guard ProcessInfo.processInfo.arguments.contains(freshInstallUITestArgument) else { return }

        let defaults = UserDefaults.standard
        let keys = [
            savedTickersKey,
            recentTickersKey,
            lastViewedTickerKey,
            activeConversationTickerKey,
            hasCompletedInitialEntryKey,
            hasSeenEntryIntroKey,
            pendingConversationTickerKey,
            pendingConversationQuestionKey,
            appLaunchCountKey,
            starterCompaniesAutoHiddenKey,
            showStarterCompaniesKey,
            aiConsentKey,
            ReviewPromptGate.successfulAnswerCountKey,
            ReviewPromptGate.lastPromptedVersionKey
        ]
        for key in keys {
            defaults.removeObject(forKey: key)
        }
        for key in defaults.dictionaryRepresentation().keys
        where key.hasPrefix(lastOpenedAtKeyPrefix) || key.hasPrefix("kabuyomi.lastSeenFiling.") {
            defaults.removeObject(forKey: key)
        }
    }
    #endif

    static func live() -> AppModel {
        let deviceIdentity = DeviceIdentityStore.shared
        #if DEBUG
        let installationIdentityStore: InstallationTokenStore =
            APIBaseURLResolver.selectedDebugEnvironment == .test ? .testWorker : .shared
        #else
        let installationIdentityStore = InstallationTokenStore.shared
        #endif
        return AppModel(
            apiClient: APIClient(
                deviceIdentity: deviceIdentity,
                installationIdentityStore: installationIdentityStore
            ),
            persistence: PersistenceController.shared,
            deviceIdentity: deviceIdentity,
            subscriptionStore: .shared,
            rewardedAdService: GoogleRewardedAdService.shared,
            accountCredentialStore: AccountCredentialStore.shared
        )
    }

    var starterCompanies: [StarterCompany] {
        StarterCompany.defaults
    }

    /// 初回動線の可視条件(v2 IA 仕様 Phase 6)。
    /// 「ようこそ」を出すかどうかもこの1つの述語が決める。並行フラグは作らない。
    /// 保存も最近も無く、開いた会社も無く、初回入口をまだ抜けていない = 真の初回。
    /// `resetLocalData` が `hasCompletedInitialEntry` ごと消すので、
    /// ローカルデータを消した人にはもう一度ここから始まる。
    ///
    /// かつてここには `rootConversationTicker`(最終的に `?? "AAPL"` へ落ちる)が
    /// 並んでいたが、Phase 6 で削除した。view の消費者はゼロで、
    /// 残っていると「ユーザーが触っていない会社」を名指しできる口が開いたままになる。
    var shouldShowConversationEntry: Bool {
        !hasCompletedInitialEntry
        && savedTickers.isEmpty
        && recentTickers.isEmpty
        && lastViewedTicker == nil
        && activeConversationTicker == nil
    }

    var currentBillingTier: BillingTier {
        let resolvedPlan = usage?.plan ?? subscriptionStore.plan
        return BillingCatalog.tier(for: resolvedPlan)
    }

    var isProPlanActive: Bool {
        currentBillingTier.plan != BillingCatalog.free.plan
    }

    var shouldShowBannerAds: Bool {
        #if DEBUG
        // Dev クォータは Worker 上 plan=pro を名乗るため、素通しにすると
        // 開発機だけバナーが消えて広告の確認ができない(2026-08-24 オーナー
        // 「広告表示はどこへ？」の正体)。DEBUG の dev モード中は free 扱いで出す。
        if isDetachedDevAccessActive { return true }
        #endif
        return currentBillingTier.plan == BillingCatalog.free.plan
    }

    var currentPlanBadgeTitle: String {
        usage?.displayPlanLabel ?? currentBillingTier.badgeTitle
    }

    var isDetachedDevAccessActive: Bool {
        usage?.detachedAccessMode == .devUnlimited
    }

    var currentPlanBadgeSystemImage: String {
        if isDetachedDevAccessActive {
            return "hammer.fill"
        }
        return isProPlanActive ? "crown.fill" : "bolt.badge.a"
    }

    var currentPlanBadgeUsesAccent: Bool {
        isProPlanActive || isDetachedDevAccessActive
    }

    var currentAPIBaseURLDisplay: String {
        apiClient.baseURLDisplayString
    }

    var currentAPIBaseURLKindDisplay: String {
        apiClient.baseURLKindDisplayString
    }

    var rewardedAdDeveloperDiagnosticLine: String {
        "API: \(apiClient.baseURLKindDisplayString) / AdUnit: \(AdMobConfig.rewardedCreditAdUnitKind) / SSV smoke: \(AdMobConfig.rewardedCreditSSVSmokeModeStatus) / TestDevice: \(AdMobConfig.testDeviceModeDiagnostic) / Last rewarded error: \(rewardedAdLastDebugReason)"
    }

    #if DEBUG
    /// 実際に解決された baseURL から導出する。
    /// `APIBaseURLResolver.resolve` はビルド設定の `configuredBaseURL()` を
    /// UserDefaults のトグル(`usesTestAPI`)より優先するため、トグルの値から
    /// 表示名を作ると実際の接続先と食い違う(2026-08-21 に実機で確認: ラベルが
    /// "Production API" のまま URL は kabuyomi-api-test を指していた)。
    var currentAPIEnvironmentDisplayName: String {
        switch apiClient.baseURLKindDisplayString {
        case "prod":
            return APIEnvironment.production.displayName
        case "test":
            return APIEnvironment.test.displayName
        default:
            return "カスタム API"
        }
    }

    var rewardedAdTestDeviceModeConfigured: Bool {
        AdMobConfig.isGoogleMobileAdsTestDeviceModeConfigured
    }
    #endif

    var chatCreditCost: Int {
        // 上位モデルで答える相手(有料プラン)は単価が上がる。値はサーバーが決め、
        // 端末は表示と残高判定に使うだけ。旧 Worker 相手は従来の 2。
        usage?.chatCreditCost ?? 2
    }

    var creditUsage: CreditUsagePayload? {
        usage?.credits
    }

    /// 残高の言い方。**人が数えたいのは質問の回数**で、クレジットはその単位でしかない。
    /// 「2クレジット / 残り 0」では、あと何回聞けるのかが読み手の暗算になっていた
    /// (2026-08-26 オーナー「クレジットの残りが全体的にわかりにくい」)。
    ///
    /// 3 つの状態を混ぜないこと。0回・不明・無制限は別のことを意味する。
    enum ChatQuota: Equatable {
        /// 1問あたり 0 クレジット。回数で数える相手ではない。
        case unlimited
        /// 残高をまだサーバーから受け取っていない。
        case unknown
        case questions(Int)
    }

    var chatQuota: ChatQuota {
        // 単価 0 は「無料で聞ける相手」。ここで割ると 0 除算になる。
        guard chatCreditCost > 0 else { return .unlimited }
        guard let credits = usage?.credits else { return .unknown }
        return .questions(max(0, credits.totalRemaining / chatCreditCost))
    }

    /// 残りを1行で言う。コンポーザにも設定にも同じ文を出す。
    var chatQuotaText: String {
        switch chatQuota {
        case .unlimited:
            return "回数の上限なし"
        case .unknown:
            return "残りを確認中"
        case .questions(let count):
            return "あと\(count)回質問できます"
        }
    }

    var chatCreditStatusText: String {
        chatQuotaText
    }

    var hasChatCreditAvailable: Bool {
        // `creditBillingEnabled` describes whether StoreKit-backed billing is
        // currently exposed. Server-side model metering remains authoritative
        // even while purchase/subscription capabilities are disabled.
        guard let credits = usage?.credits else {
            return true
        }
        return credits.totalRemaining >= chatCreditCost
    }

    var isCreditBillingEnabled: Bool {
        usage?.creditBillingEnabled == true
    }

    var isConsumableCreditPurchasingEnabled: Bool {
        isCreditBillingEnabled
            && usage?.capabilities?.consumablePurchasesEnabled == true
    }

    var isPaidCreditAccountSignedIn: Bool {
        accountCredential?.appAccountTokenUUID != nil && accountCredential?.isExpired == false
    }

    var requiresPaidCreditAccount: Bool {
        usage?.capabilities?.consumablePurchasesEnabled == true
            && usage?.capabilities?.accountRecoveryReady == true
    }

    var authenticatedCreditActionsAvailable: Bool {
        authenticationStateAllowsMutation
            && apiClient.authenticatedCreditActionsAvailable
    }

    var fraudSensitiveCreditActionsAvailable: Bool {
        authenticationStateAllowsMutation
            && apiClient.fraudSensitiveCreditActionsAvailable
    }

    var installationAuthenticationStatus: InstallationAuthenticationStatus? {
        switch installationIdentityLoadState {
        case .degraded(let failure, _):
            return InstallationAuthenticationStatus(failure: failure)
        case .ready(let attestationStatus, _)
            where attestationStatus == .pending:
            return InstallationAuthenticationStatus(
                failure: InstallationIdentityFailure(kind: .appAttestTemporarilyUnavailable)
            )
        case .ready(let attestationStatus, _)
            where attestationStatus == .unavailable && apiClient.canRetryFraudSensitiveAuthentication:
            return InstallationAuthenticationStatus(
                failure: InstallationIdentityFailure(kind: .appAttestTemporarilyUnavailable)
            )
        case .ready(let attestationStatus, let creditMode)
            where attestationStatus == .verified && creditMode != .full:
            return InstallationAuthenticationStatus(
                failure: InstallationIdentityFailure(kind: .permanentAuthenticationFailure)
            )
        case .idle, .loading, .ready:
            return nil
        }
    }

    var hasRecoveredEnoughCreditsForPendingRecovery: Bool {
        guard let recovery = insufficientCreditRecovery,
              let credits = usage?.credits else {
            return false
        }
        return credits.totalRemaining >= recovery.requiredCredits
    }

    var currentDeviceKeyDisplay: String {
        apiClient.installationPrincipalDisplayString ?? "not_bootstrapped"
    }

    /// allowlist 照合に使われるのは installation principal ではなくこちら。
    var currentLegacyDeviceKeyDisplay: String {
        apiClient.legacyDeviceKeyDisplayString ?? "not_available"
    }

    var currentDeviceKeySuffixDisplay: String {
        Self.deviceKeySuffixDisplay(from: currentDeviceKeyDisplay)
    }

    static func deviceKeySuffixDisplay(from value: String?) -> String {
        let key = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !key.isEmpty, key != "not_bootstrapped" else { return "unknown" }
        return String(key.suffix(6))
    }

    var currentAppVersionDisplay: String {
        appVersionDisplay
    }

    var billingEndpointDiagnosticLine: String {
        "subscription=\(apiClient.subscriptionSyncEndpointDisplayString) / credit=\(apiClient.creditPurchaseEndpointDisplayString)"
    }

    func logRewardedAdSettingsViewed() {
        logRewardedAdDiagnostic("settings_view_appeared")
    }

    func logRewardedAdButtonTapped() {
        let disabledReason = rewardedAdButtonDisabledReason()
        logRewardedAdDiagnostic(
            "rewarded_button_tapped",
            fields: ["disabledReason": disabledReason ?? "none"]
        )
        if let disabledReason {
            rewardedAdLastDebugReason = disabledReason
        }
    }

    func requestInsufficientCreditRecovery(
        requiredCredits: Int? = nil,
        remainingCredits: Int? = nil,
        source: InsufficientCreditRecoverySource
    ) {
        let required = max(1, requiredCredits ?? chatCreditCost)
        let remaining = max(0, remainingCredits ?? usage?.credits?.totalRemaining ?? 0)
        insufficientCreditRecovery = InsufficientCreditRecoveryState(
            requiredCredits: required,
            remainingCredits: remaining,
            source: source
        )
        insufficientCreditRecoveryRequestID = UUID()
    }

    func dismissInsufficientCreditRecovery() {
        insufficientCreditRecovery = nil
        insufficientCreditRecoveryRequestID = nil
    }

    var shouldRestoreRewardedAdReturnDestination: Bool {
        guard rewardedAdReturnDestination != nil else { return false }
        return !rewardedAdReturnUserNavigatedAway
    }

    func prepareRewardedAdReturnDestination(_ destination: RewardedAdReturnDestination, visibleSurface: String) {
        rewardedAdReturnDestination = destination
        rewardedAdReturnFlowID = UUID()
        rewardedAdReturnUserNavigatedAway = false
        logRewardedAdDiagnostic(
            "rewarded_ad_return_destination_set",
            fields: [
                "destination": destination.rawValue,
                "visibleSurface": visibleSurface,
                "flow": redactedRewardedAdReturnFlowID
            ]
        )
        logRewardedAdDiagnostic(
            "selected_tab_before_rewarded_ad",
            fields: [
                "selectedTab": "company_root",
                "visibleSurface": visibleSurface,
                "flow": redactedRewardedAdReturnFlowID
            ]
        )
    }

    func markRewardedAdCreditsClosedByUser() {
        guard rewardedAdReturnDestination != nil else { return }
        rewardedAdReturnUserNavigatedAway = true
        logRewardedAdDiagnostic(
            "rewarded_ad_return_destination_skipped_user_navigated",
            fields: [
                "reason": "credits_closed_by_user",
                "flow": redactedRewardedAdReturnFlowID
            ]
        )
        clearRewardedAdReturnDestination()
    }

    func handleRewardedAdScenePhaseChanged(_ phase: String) {
        logRewardedAdDiagnostic(
            "rewarded_ad_scene_phase_changed",
            fields: [
                "phase": phase,
                "returnDestination": rewardedAdReturnDestination?.rawValue ?? "none",
                "flow": redactedRewardedAdReturnFlowID
            ]
        )
        if phase == "active" {
            requestRewardedAdReturnDestinationRestore(reason: "scene_active")
        }
    }

    func confirmRewardedAdReturnDestinationRestored(visibleSurface: String) {
        guard let destination = rewardedAdReturnDestination else { return }
        logRewardedAdDiagnostic(
            "rewarded_ad_return_destination_restored",
            fields: [
                "destination": destination.rawValue,
                "visibleSurface": visibleSurface,
                "flow": redactedRewardedAdReturnFlowID
            ]
        )
        logRewardedAdDiagnostic(
            "selected_tab_after_rewarded_ad",
            fields: [
                "selectedTab": "credits",
                "visibleSurface": visibleSurface,
                "flow": redactedRewardedAdReturnFlowID
            ]
        )
    }

    func bootstrap() async {
        isBootstrapped = false
        let startupUsageGeneration = usageMutationGeneration

        sanitizeRestoredConversationState()
        recordAppLaunch()
        loadHomeFromPersistence()
        isBootstrapped = true
        usageLoadState = .loading

        Task { [weak self] in
            await self?.retryInstallationAuthentication(
                expectedUsageGeneration: startupUsageGeneration
            )
        }
    }

    func retryInstallationAuthentication() async {
        await retryInstallationAuthentication(
            expectedUsageGeneration: usageMutationGeneration
        )
    }

    private func retryInstallationAuthentication(expectedUsageGeneration: Int) async {
        if let existingTask = installationIdentityAuthenticationTask {
            let existingTaskID = installationIdentityAuthenticationTaskID
            await existingTask.value
            if installationIdentityAuthenticationTaskID == existingTaskID {
                installationIdentityAuthenticationTask = nil
                installationIdentityAuthenticationTaskID = nil
                installationAuthenticationIsRetrying = false
            }
            return
        }

        let taskID = UUID()
        installationIdentityAuthenticationTaskID = taskID
        installationAuthenticationIsRetrying = true
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.runInstallationAuthenticationCycle(
                expectedUsageGeneration: expectedUsageGeneration
            )
        }
        installationIdentityAuthenticationTask = task
        await task.value

        guard installationIdentityAuthenticationTaskID == taskID else { return }
        installationIdentityAuthenticationTask = nil
        installationIdentityAuthenticationTaskID = nil
        installationAuthenticationIsRetrying = false
    }

    private func runInstallationAuthenticationCycle(expectedUsageGeneration: Int) async {
        let preservesVisibleStatus = installationAuthenticationStatus != nil
        let preservesAuthenticatedCredential = apiClient.authenticatedCreditActionsAvailable
        let delays = [UInt64(0)] + installationIdentityRetryPolicy.automaticRetryDelaysNanoseconds
        var lastFailure = InstallationIdentityFailure(kind: .unknown)
        var completedAttempts = 0
        var recoveredRejectedCredential = false

        for (index, delay) in delays.enumerated() {
            if delay > 0 {
                do {
                    try await Task.sleep(nanoseconds: delay)
                } catch {
                    return
                }
            }
            guard !Task.isCancelled else { return }

            completedAttempts = index + 1
            if !preservesVisibleStatus, !preservesAuthenticatedCredential {
                installationIdentityLoadState = .loading(attempt: completedAttempts)
            }

            do {
                var credential = try await apiClient.bootstrapInstallationIdentity()
                let startupUsage: UsagePayload
                do {
                    startupUsage = try await apiClient.fetchUsage()
                } catch {
                    guard !recoveredRejectedCredential,
                          Self.isInstallationCredentialRejection(error),
                          try apiClient.invalidateInstallationCredentialForRebootstrap() else {
                        throw error
                    }
                    recoveredRejectedCredential = true
                    credential = try await apiClient.bootstrapInstallationIdentity()
                    startupUsage = try await apiClient.fetchUsage()
                }
                guard !Task.isCancelled else { return }

                installationIdentityLoadState = .ready(
                    attestationStatus: credential.attestationStatus,
                    creditMode: credential.creditMode
                )
                if expectedUsageGeneration == usageMutationGeneration {
                    storeUsage(startupUsage, source: .refresh)
                    lastUsageRefreshAt = Date()
                }
                usageLoadState = .loaded
                await completeAuthenticatedStartup()
                return
            } catch {
                guard !shouldIgnore(error) else { return }
                lastFailure = InstallationIdentityFailure.classify(error)
                if !lastFailure.isRetryable {
                    break
                }
            }
        }

        installationIdentityLoadState = .degraded(
            failure: lastFailure,
            attemptCount: completedAttempts
        )
        if usage == nil {
            usageLoadState = .failed
        }
    }

    private static func isInstallationCredentialRejection(_ error: Error) -> Bool {
        guard let apiError = error as? APIError,
              case .serverStatus(let statusCode, _) = apiError else { return false }
        return statusCode == 401
    }

    private func completeAuthenticatedStartup() async {
        if !Self.isRunningTests, isCreditBillingEnabled {
            await subscriptionStore.refreshEntitlements(reason: "bootstrap")
            if authenticatedCreditActionsAvailable {
                _ = await syncBillingState(showErrors: false)
                if isConsumableCreditPurchasingEnabled {
                    await recoverUnfinishedCreditPurchases(showErrors: false)
                }
            }
            await loadSubscriptionProducts(showErrors: false)
            if isConsumableCreditPurchasingEnabled {
                await loadCreditPackProducts(showErrors: false)
            }
        }

        let deferredTickers = authenticationDeferredCompanyTickers
        authenticationDeferredCompanyTickers = []
        for ticker in deferredTickers {
            await loadCompany(ticker: ticker)
        }
    }

    func purchaseSubscription(productId: String) async {
        guard !billingActionInFlight else { return }
        guard isCreditBillingEnabled else {
            activeAlert = AppAlertState(
                message: "月額プランは現在利用できません。時間をおいてからもう一度お試しください。",
                kind: .dismissOnly
            )
            return
        }
        guard requireAuthenticatedMutation() else { return }
        billingActionInFlight = true
        let stateGeneration = self.stateGeneration
        let usageGeneration = usageMutationGeneration
        defer { billingActionInFlight = false }

        do {
            guard let purchase = try await subscriptionStore.purchaseSubscription(productId: productId) else {
                activeAlert = AppAlertState(
                    message: "購入はキャンセルされました。",
                    kind: .dismissOnly
                )
                return
            }
            lastBillingSyncStatus = "syncing \(apiClient.subscriptionSyncEndpointDisplayString)"
            let response = try await apiClient.syncBilling(purchase.syncRequest)
            let isCurrentGeneration = stateGeneration == self.stateGeneration && usageGeneration == usageMutationGeneration
            if isCurrentGeneration {
                subscriptionStore.apply(response)
                lastBillingSyncStatus = "succeeded \(apiClient.subscriptionSyncEndpointDisplayString)"
                lastBillingSyncAt = Date()
            }
            if isCurrentGeneration, let usage = response.usage {
                storeUsage(usage, source: .refresh)
            }
            await purchase.finish()
            if isCurrentGeneration {
                await refreshUsage()
                activeAlert = AppAlertState(
                    message: "\(currentBillingTier.title)プランを同期しました。",
                    kind: .dismissOnly
                )
            }
        } catch {
            recordBillingFailure(error, endpoint: apiClient.subscriptionSyncEndpointDisplayString)
            handle(error)
        }
    }

    func purchasePro() async {
        guard let productID = BillingCatalog.pro.productID else { return }
        await purchaseSubscription(productId: productID)
    }

    func restorePurchases() async {
        guard !billingActionInFlight else { return }
        guard isCreditBillingEnabled else {
            activeAlert = AppAlertState(
                message: "購入の復元は現在利用できません。時間をおいてからもう一度お試しください。",
                kind: .dismissOnly
            )
            return
        }
        guard requireAuthenticatedMutation() else { return }
        billingActionInFlight = true
        defer { billingActionInFlight = false }

        do {
            try await subscriptionStore.restorePurchases()
            let response = await syncBillingState(showErrors: true)
            await refreshUsage()

            if !subscriptionStore.isSubscriptionActive {
                activeAlert = AppAlertState(
                    message: "復元できる購読は見つかりませんでした。",
                    kind: .dismissOnly
                )
            } else if response != nil {
                activeAlert = AppAlertState(
                    message: "\(currentBillingTier.title)プランを同期しました。",
                    kind: .dismissOnly
                )
            }
        } catch {
            handle(error)
        }
    }

    func applyQuoteTranslationUsage(_ response: QuoteTranslationResponse) {
        guard let usage = response.usage else { return }
        storeUsage(usage, source: .quoteTranslation)
    }

    func translateQuote(
        text: String,
        sourceLanguage: String? = nil,
        targetLanguage: String = "ja",
        operationId: String
    ) async throws -> QuoteTranslationResponse {
        guard authenticatedCreditActionsAvailable else {
            throw apiClient.authenticatedActionUnavailableError
        }
        let response = try await apiClient.translateQuote(
            text: text,
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage,
            operationId: operationId
        )
        applyQuoteTranslationUsage(response)
        return response
    }

    func refreshUsageAfterQuoteTranslationFailure() async {
        await refreshUsage(showErrors: false)
    }

    func loadSubscriptionProducts(showErrors: Bool = true) async {
        guard subscriptionProductLoadState != .loading else { return }

        subscriptionProductLoadState = .loading
        subscriptionProductLoadErrorMessage = nil

        do {
            let products = try await subscriptionStore.subscriptionProducts()
            subscriptionProducts = products

            if products.contains(where: \.isAvailable) {
                subscriptionProductLoadState = .loaded
                return
            }

            subscriptionProductLoadState = .unavailable
            subscriptionProductLoadErrorMessage = "App Storeから月額プランの価格を取得できませんでした。再読み込みしてください。"
        } catch {
            subscriptionProductLoadState = .failed
            subscriptionProductLoadErrorMessage = error.localizedDescription
            if showErrors {
                handle(error)
            }
        }
    }

    func loadCreditPackProducts(showErrors: Bool = true) async {
        guard !creditPackProductLoadInFlight else { return }

        creditPackProductLoadInFlight = true
        creditPackProductLoadState = .loading
        creditPackProductLoadErrorMessage = nil
        defer { creditPackProductLoadInFlight = false }

        do {
            let products = try await subscriptionStore.creditPackProducts()
            creditPackProducts = products
            if products.contains(where: \.isAvailable) {
                creditPackProductLoadState = .loaded
                creditPackProductLoadErrorMessage = nil
            } else {
                creditPackProductLoadState = .unavailable
                creditPackProductLoadErrorMessage = "App Storeから追加クレジットの価格を取得できませんでした。再読み込みしてください。"
            }
            refreshStoreKitDiagnostics()
        } catch {
            creditPackProductLoadState = .failed
            creditPackProductLoadErrorMessage = error.localizedDescription
            refreshStoreKitDiagnostics()
            if showErrors {
                handle(error)
            }
        }
    }

    func purchaseCreditPack(productId: String) async {
        guard !billingActionInFlight else { return }
        guard isConsumableCreditPurchasingEnabled else {
            activeAlert = AppAlertState(
                message: "追加クレジット購入は現在利用できません。時間をおいてからもう一度お試しください。",
                kind: .dismissOnly
            )
            return
        }
        guard requireAuthenticatedMutation() else { return }
        if requiresPaidCreditAccount && !isPaidCreditAccountSignedIn {
            activeAlert = AppAlertState(
                message: "追加クレジットを端末変更後も復元できるよう、先にAppleアカウントで続けてください。",
                kind: .dismissOnly
            )
            return
        }

        billingActionInFlight = true
        defer { billingActionInFlight = false }

        do {
            guard let purchase = try await subscriptionStore.purchaseCreditPack(
                productId: productId,
                appAccountToken: requiresPaidCreditAccount ? accountCredential?.appAccountTokenUUID : nil
            ) else {
                refreshStoreKitDiagnostics()
                activeAlert = AppAlertState(
                    message: "購入はキャンセルされました。",
                    kind: .dismissOnly
                )
                return
            }
            subscriptionStore.recordBackendGrantStarted()
            refreshStoreKitDiagnostics()
            lastBillingSyncStatus = "granting \(apiClient.creditPurchaseEndpointDisplayString)"
            let response = try await apiClient.grantCreditPurchase(purchase.grantRequest)
            subscriptionStore.recordBackendGrantSucceeded(didMutate: response.didMutate)
            lastBillingSyncStatus = "succeeded \(apiClient.creditPurchaseEndpointDisplayString)"
            lastBillingSyncAt = Date()
            storeUsage(response.usage, source: .refresh)
            await purchase.finish()
            subscriptionStore.recordTransactionFinished()
            refreshStoreKitDiagnostics()
            activeAlert = AppAlertState(
                message: response.didMutate
                    ? "\(response.creditsGranted)クレジットを追加しました。"
                    : "この購入はすでに反映済みです。",
                kind: .dismissOnly
            )
        } catch {
            if subscriptionStore.storeKitDiagnostics.backendGrantStatus == "started" {
                subscriptionStore.recordBackendGrantFailed(error)
            }
            recordBillingFailure(error, endpoint: apiClient.creditPurchaseEndpointDisplayString)
            refreshStoreKitDiagnostics()
            handle(error)
        }
    }

    func completeAppleAccountSignIn(identityToken: String) async {
        guard !billingActionInFlight else { return }
        guard requireFraudSensitiveMutation() else { return }
        guard usage?.capabilities?.accountRecoveryReady == true else {
            activeAlert = AppAlertState(
                message: "アカウント復元は現在利用できません。",
                kind: .dismissOnly
            )
            return
        }

        billingActionInFlight = true
        defer { billingActionInFlight = false }

        do {
            let credential = try await apiClient.createAppleAccountSession(identityToken: identityToken)
            accountCredential = credential
            let migrationId = paidCreditMigrationId(for: credential)
            _ = try await apiClient.migratePaidCreditsToAccount(mode: "preview", migrationId: migrationId)
            let migration = try await apiClient.migratePaidCreditsToAccount(mode: "apply", migrationId: migrationId)
            await refreshUsage()
            activeAlert = AppAlertState(
                message: migration.status == "applied"
                    ? "Appleアカウントで続行しました。購入済みクレジットもこのアカウントへ移行しました。"
                    : "Appleアカウントで続行しました。購入済みクレジットはこのアカウントで復元できます。",
                kind: .dismissOnly
            )
        } catch {
            accountCredential = try? accountCredentialStore?.load()
            handle(error)
        }
    }

    func signOutPaidCreditAccount() async {
        do {
            try accountCredentialStore?.clear()
            accountCredential = nil
            await refreshUsage()
        } catch {
            handle(error)
        }
    }

    private func paidCreditMigrationId(for credential: AccountCredential) -> String {
        let source = "\(credential.appAccountToken)\u{0}\(apiClient.installationPrincipalDisplayString ?? "missing-installation")"
        let digest = SHA256.hash(data: Data(source.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return "paid-credit-account-v1-\(digest)"
    }

    func recoverUnfinishedCreditPurchases(showErrors: Bool = true) async {
        guard isConsumableCreditPurchasingEnabled else { return }
        guard !creditGrantRecoveryInFlight else { return }
        guard requireAuthenticatedMutation(showAlert: showErrors) else { return }
        creditGrantRecoveryInFlight = true
        defer { creditGrantRecoveryInFlight = false }

        let purchases = await subscriptionStore.unfinishedCreditPurchases()
        guard !purchases.isEmpty else { return }

        for purchase in purchases {
            do {
                subscriptionStore.recordBackendGrantStarted()
                refreshStoreKitDiagnostics()
                let response = try await apiClient.grantCreditPurchase(purchase.grantRequest)
                subscriptionStore.recordBackendGrantSucceeded(didMutate: response.didMutate)
                lastBillingSyncStatus = "recovered \(apiClient.creditPurchaseEndpointDisplayString)"
                lastBillingSyncAt = Date()
                storeUsage(response.usage, source: .refresh)
                await purchase.finish()
                subscriptionStore.recordTransactionFinished()
                refreshStoreKitDiagnostics()
            } catch {
                if subscriptionStore.storeKitDiagnostics.backendGrantStatus == "started" {
                    subscriptionStore.recordBackendGrantFailed(error)
                }
                recordBillingFailure(error, endpoint: apiClient.creditPurchaseEndpointDisplayString)
                refreshStoreKitDiagnostics()
                if showErrors {
                    handle(error)
                }
            }
        }
    }

    func earnRewardedAdCredits() async {
        logRewardedAdDiagnostic("earn_rewarded_ad_credits_entered")
        guard rewardedAdCreditState == .idle else {
            setRewardedAdDebugReason("early_return_state_\(rewardedAdCreditState.debugName)")
            logRewardedAdDiagnostic(
                "earn_rewarded_ad_credits_early_return",
                fields: ["reason": rewardedAdLastDebugReason]
            )
            return
        }
        guard await ensureFraudSensitiveAuthentication() else {
            setRewardedAdDebugReason("installation_authentication_unavailable")
            requestRewardedAdReturnDestinationRestore(reason: "installation_authentication_unavailable")
            return
        }
        guard isCreditBillingEnabled else {
            setRewardedAdDebugReason("credit_billing_disabled")
            logRewardedAdDiagnostic(
                "earn_rewarded_ad_credits_early_return",
                fields: ["reason": rewardedAdLastDebugReason]
            )
            activeAlert = AppAlertState(
                message: "広告報酬creditは現在利用できません。時間をおいてからもう一度お試しください。",
                kind: .dismissOnly
            )
            requestRewardedAdReturnDestinationRestore(reason: "credit_billing_disabled")
            return
        }
        #if DEBUG
        if shouldBlockDebugProductionRewardIntentForDemoAdUnit() {
            setRewardedAdDebugReason(AdMobConfig.debugDemoAdUnitCannotVerifyProductionSSVReason)
            logRewardedAdDiagnostic(
                "rewarded_flow_blocked",
                fields: ["reason": rewardedAdLastDebugReason]
            )
            rewardedAdCreditState = .idle
            rewardedAdStatusMessage = debugDemoAdUnitCannotVerifyProductionSSVMessage
            requestRewardedAdReturnDestinationRestore(reason: "debug_demo_ad_unit_blocked")
            return
        }
        #endif

        rewardedAdStatusMessage = nil
        rewardedAdCreditState = .loading
        do {
            logRewardedAdDiagnostic(
                "create_reward_intent_started",
                fields: ["requestPath": "/v1/admob/reward-intents"]
            )
            let intent = try await apiClient.createAdMobRewardIntent()
            logRewardedAdDiagnostic(
                "create_reward_intent_succeeded",
                fields: [
                    "rewardIntentId": RewardedAdDiagnostics.redact(intent.rewardIntentId),
                    "customDataPresent": String(!intent.customData.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
                    "rewardCredits": String(intent.rewardCredits),
                    "dailyRemaining": String(intent.dailyRemaining)
                ]
            )
            guard intent.dailyRemaining > 0 else {
                setRewardedAdDebugReason("daily_cap_reached")
                logRewardedAdDiagnostic("reward_intent_daily_cap_reached")
                rewardedAdCreditState = .dailyCapReached
                rewardedAdStatusMessage = "本日の広告報酬上限に達しました。"
                requestRewardedAdReturnDestinationRestore(reason: "daily_cap_reached")
                return
            }

            rewardedAdCreditState = .presenting
            let didEarnReward = try await rewardedAdService.presentRewardedAd(customData: intent.customData)
            guard didEarnReward else {
                setRewardedAdDebugReason("ad_dismissed_without_reward")
                logRewardedAdDiagnostic("rewarded_ad_dismissed_without_reward")
                rewardedAdCreditState = .idle
                rewardedAdStatusMessage = RewardedAdServiceError.dismissedWithoutReward.localizedDescription
                requestRewardedAdReturnDestinationRestore(reason: "dismissed_without_reward")
                return
            }

            rewardedAdCreditState = .pendingGrant
            requestRewardedAdReturnDestinationRestore(reason: "pending_grant")
            logRewardedAdDiagnostic(
                "reward_status_polling_started",
                fields: [
                    "rewardIntentId": RewardedAdDiagnostics.redact(intent.rewardIntentId),
                    "requestPath": "/v1/admob/reward-status"
                ]
            )
            let status = try await pollRewardStatus(rewardIntentId: intent.rewardIntentId)
            storeUsage(status.usage, source: .refresh)
            rewardedAdCreditState = status.dailyRemaining <= 0 ? .dailyCapReached : .idle
            rewardedAdStatusMessage = "\(status.rewardCredits)無料/ad creditを獲得しました。"
            setRewardedAdDebugReason("granted")
            requestRewardedAdReturnDestinationRestore(reason: "granted")
            logRewardedAdDiagnostic(
                "reward_status_granted",
                fields: [
                    "creditsRemaining": String(status.creditsRemaining),
                    "dailyRemaining": String(status.dailyRemaining)
                ]
            )
        } catch {
            if rawMessage(for: error).contains("daily_cap_reached") {
                setRewardedAdDebugReason("daily_cap_reached")
                logRewardedAdDiagnostic(
                    "rewarded_flow_failed",
                    fields: ["reason": rewardedAdLastDebugReason, "error": sanitizedErrorMessage(error)]
                )
                rewardedAdCreditState = .dailyCapReached
                rewardedAdStatusMessage = "本日の広告報酬上限に達しました。"
                requestRewardedAdReturnDestinationRestore(reason: "daily_cap_reached_error")
                return
            }
            setRewardedAdDebugReason(debugReason(forRewardedAdError: error))
            logRewardedAdDiagnostic(
                "rewarded_flow_failed",
                fields: ["reason": rewardedAdLastDebugReason, "error": sanitizedErrorMessage(error)]
            )
            rewardedAdCreditState = .idle
            rewardedAdStatusMessage = presentableRewardedAdMessage(for: error)
            requestRewardedAdReturnDestinationRestore(reason: "failed")
        }
    }

    private func pollRewardStatus(rewardIntentId: String) async throws -> AdMobRewardStatusResponse {
        for attempt in 0..<6 {
            if attempt > 0 {
                try await Task.sleep(nanoseconds: 1_000_000_000)
            }
            logRewardedAdDiagnostic(
                "reward_status_poll_attempt",
                fields: [
                    "attempt": String(attempt + 1),
                    "requestPath": "/v1/admob/reward-status",
                    "rewardIntentId": RewardedAdDiagnostics.redact(rewardIntentId)
                ]
            )
            let status = try await apiClient.fetchAdMobRewardStatus(rewardIntentId: rewardIntentId)
            logRewardedAdDiagnostic(
                "reward_status_poll_result",
                fields: [
                    "attempt": String(attempt + 1),
                    "status": status.status,
                    "dailyRemaining": String(status.dailyRemaining)
                ]
            )
            if status.status == "granted" {
                return status
            }
        }
        setRewardedAdDebugReason(rewardStatusPendingDebugReason())
        logRewardedAdDiagnostic(
            "reward_status_poll_timeout",
            fields: ["reason": rewardedAdLastDebugReason]
        )
        throw RewardedAdServiceError.ssvNotReceivedOrRewardStatusPending
    }

    private func presentableRewardedAdMessage(for error: Error) -> String {
        if let rewardedError = error as? RewardedAdServiceError {
            if rewardedError == .ssvNotReceivedOrRewardStatusPending {
                #if DEBUG
                if AdMobConfig.rewardedCreditAdUnitID == AdMobConfig.testRewardedCreditAdUnitID {
                    return debugDemoAdUnitCannotVerifyProductionSSVMessage
                }
                #endif
            }
            return rewardedError.localizedDescription
        }
        let raw = rawMessage(for: error)
        if raw.contains("daily_cap_reached") || raw.contains("Rewarded ad daily cap reached") {
            return "本日の広告報酬上限に達しました。"
        }
        if raw.localizedCaseInsensitiveContains("no ad") {
            return "現在広告を利用できません。少し時間をおいて再試行してください。"
        }
        return "広告報酬を付与できませんでした。通信状況を確認して再試行してください。"
    }

    private func setRewardedAdDebugReason(_ reason: String) {
        rewardedAdLastDebugReason = reason
    }

    private var redactedRewardedAdReturnFlowID: String {
        guard let flow = rewardedAdReturnFlowID?.uuidString else { return "none" }
        return RewardedAdDiagnostics.redact(flow)
    }

    private func requestRewardedAdReturnDestinationRestore(reason: String) {
        guard let destination = rewardedAdReturnDestination else { return }
        guard !rewardedAdReturnUserNavigatedAway else {
            logRewardedAdDiagnostic(
                "rewarded_ad_return_destination_skipped_user_navigated",
                fields: [
                    "destination": destination.rawValue,
                    "reason": reason,
                    "flow": redactedRewardedAdReturnFlowID
                ]
            )
            return
        }
        guard shouldRestoreRewardedAdReturnDestination else { return }

        rewardedAdReturnRestorationRequestID = UUID()
        logRewardedAdDiagnostic(
            "rewarded_ad_return_destination_restore_requested",
            fields: [
                "destination": destination.rawValue,
                "reason": reason,
                "flow": redactedRewardedAdReturnFlowID
            ]
        )
    }

    private func clearRewardedAdReturnDestination() {
        rewardedAdReturnDestination = nil
        rewardedAdReturnFlowID = nil
        rewardedAdReturnRestorationRequestID = nil
    }

    private func rewardedAdButtonDisabledReason() -> String? {
        switch rewardedAdCreditState {
        case .idle:
            return nil
        case .loading:
            return "state_loading"
        case .presenting:
            return "state_presenting"
        case .pendingGrant:
            return "state_pending_grant"
        case .dailyCapReached:
            return "daily_cap_reached"
        }
    }

    private func debugReason(forRewardedAdError error: Error) -> String {
        if let rewardedError = error as? RewardedAdServiceError {
            switch rewardedError {
            case .noAdAvailable:
                return "no_ad_available"
            case .presentationUnavailable:
                return "presentation_or_polling_unavailable"
            case .presenterUnavailable:
                return "rewarded_ad_presenter_unavailable"
            case .presentFailedAlreadyPresenting:
                return "rewarded_ad_present_failed_already_presenting"
            case .ssvNotReceivedOrRewardStatusPending:
                return rewardStatusPendingDebugReason()
            case .dismissedWithoutReward:
                return "dismissed_without_reward"
            }
        }

        let raw = rawMessage(for: error)
        if raw.contains("daily_cap_reached") || raw.contains("Rewarded ad daily cap reached") {
            return "daily_cap_reached"
        }
        if raw.localizedCaseInsensitiveContains("no ad") {
            return "no_ad_available"
        }
        if raw.localizedCaseInsensitiveContains("cancelled") {
            return "cancelled"
        }
        if raw.localizedCaseInsensitiveContains("notConnectedToInternet") || raw.localizedCaseInsensitiveContains("offline") {
            return "network_unavailable"
        }
        if raw.localizedCaseInsensitiveContains("timed out") {
            return "network_timeout"
        }
        if raw.localizedCaseInsensitiveContains("HTTP 401") || raw.localizedCaseInsensitiveContains("unauthorized") {
            return "auth_failed"
        }
        if raw.localizedCaseInsensitiveContains("HTTP 404") || raw.localizedCaseInsensitiveContains("not_found") {
            return "reward_route_not_found"
        }
        return "unknown_error"
    }

    private func rewardStatusPendingDebugReason() -> String {
        #if DEBUG
        if AdMobConfig.rewardedCreditAdUnitID == AdMobConfig.testRewardedCreditAdUnitID {
            return "ssv_not_received_or_reward_status_pending_google_demo_ad_unit_does_not_verify_production_ssv"
        }
        #endif
        return "ssv_not_received_or_reward_status_pending"
    }

    #if DEBUG
    private var debugDemoAdUnitCannotVerifyProductionSSVMessage: String {
        "DEBUGのGoogleデモ広告では本番SSVが届かないため、クレジット付与確認はできません。Xcode scheme に KABUYOMI_ADMOB_TEST_DEVICE_IDS を設定し、SSV smoke mode をONにしてください。"
    }

    private func shouldBlockDebugProductionRewardIntentForDemoAdUnit() -> Bool {
        apiClient.baseURLKindDisplayString == "prod" && AdMobConfig.blocksProductionRewardIntentWithCurrentDebugAdUnit
    }
    #endif

    private func sanitizedErrorMessage(_ error: Error) -> String {
        String(rawMessage(for: error).prefix(220))
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
    }

    private func logRewardedAdDiagnostic(_ event: String, fields: [String: String] = [:]) {
        let credits = usage?.credits
        let installationPrincipal = apiClient.installationPrincipalDisplayString ?? ""
        var mergedFields: [String: String] = [
            "build": AdMobConfig.buildConfiguration,
            "appVersion": appVersionDisplay,
            "apiKind": apiClient.baseURLKindDisplayString,
            "apiBaseURL": apiClient.baseURLDisplayString,
            "adUnitKind": AdMobConfig.rewardedCreditAdUnitKind,
            "adUnit": RewardedAdDiagnostics.redact(AdMobConfig.rewardedCreditAdUnitID),
            "runtimeMode": AdMobConfig.rewardedAdRuntimeMode.rawValue,
            "ssvSmokeMode": AdMobConfig.rewardedCreditSSVSmokeModeStatus,
            "googleMobileAdsTestDeviceMode": String(AdMobConfig.isGoogleMobileAdsTestDeviceModeConfigured),
            "googleMobileAdsTestDeviceIDs": AdMobConfig.testDeviceModeDiagnostic,
            "state": rewardedAdCreditState.debugName,
            "creditBillingEnabled": String(isCreditBillingEnabled),
            "installationPrincipalExists": String(!installationPrincipal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
            "installationPrincipal": RewardedAdDiagnostics.redact(installationPrincipal),
            "mobileAdsInitialized": String(AdMobRuntimeState.mobileAdsInitialized),
            "totalRemaining": credits.map { String($0.totalRemaining) } ?? "nil",
            "monthlyRemaining": credits.map { String($0.monthlyRemaining) } ?? "nil",
            "rewardedAdRemaining": credits?.rewardedAdRemaining.map(String.init) ?? "nil",
            "dailyCapState": rewardedAdCreditState == .dailyCapReached ? "reached" : "not_reached"
        ]
        fields.forEach { mergedFields[$0.key] = $0.value }
        RewardedAdDiagnostics.log(event, fields: mergedFields)
    }

    private var appVersionDisplay: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
        return "\(version)(\(build))"
    }

    func refreshCreditUsage() async {
        await refreshUsage()
    }

    func checkBillingAPIHealth() async {
        guard !billingAPIHealthCheckInFlight else { return }
        billingAPIHealthCheckInFlight = true
        defer { billingAPIHealthCheckInFlight = false }
        billingAPIHealthReport = await apiClient.checkBillingAPIHealth()
    }

    #if DEBUG
    func setDevModeEnabled(_ value: Bool) {
        let store = DetachedAccessStore.shared
        store.setDevModeEnabled(value)
        devModeEnabled = value
        Task { [weak self] in
            await self?.refreshUsage()
        }
    }

    func setUsesTestAPI(_ value: Bool) {
        let environment: APIEnvironment = value ? .test : .production
        APIBaseURLResolver.setSelectedDebugEnvironment(environment)
        usesTestAPI = value
        installationIdentityAuthenticationTask?.cancel()
        installationIdentityAuthenticationTask = nil
        installationIdentityAuthenticationTaskID = nil
        installationAuthenticationIsRetrying = false
        apiClient = APIClient(
            deviceIdentity: deviceIdentity,
            subscriptionStore: subscriptionStore,
            installationIdentityStore: value ? InstallationTokenStore.testWorker : InstallationTokenStore.shared
        )
        retryableChatOperations = [:]
        usage = nil
        usageLoadState = .loading
        installationIdentityLoadState = .idle
        Task { [weak self] in
            await self?.retryInstallationAuthentication()
        }
    }

    func setRewardedAdSSVSmokeModeEnabled(_ value: Bool) {
        AdMobConfig.setRewardedCreditSSVSmokeModeEnabled(value)
        rewardedAdSSVSmokeModeEnabled = value
        setRewardedAdDebugReason(value ? "ssv_smoke_mode_enabled" : "ssv_smoke_mode_disabled")
        logRewardedAdDiagnostic(
            "ssv_smoke_mode_toggled",
            fields: ["enabled": String(value)]
        )
    }
    #endif

    func search(query: String) async {
        let stateGeneration = self.stateGeneration
        searchGeneration += 1
        let generation = searchGeneration
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            if stateGeneration == self.stateGeneration, generation == searchGeneration {
                searchResults = []
                searchErrorMessage = nil
                searchIsLoading = false
            }
            return
        }

        searchIsLoading = true
        searchErrorMessage = nil

        do {
            let results = try await apiClient.search(query: trimmed)
                .sorted(by: { left, right in
                    let leftScore = searchScore(for: left, query: trimmed)
                    let rightScore = searchScore(for: right, query: trimmed)

                    if leftScore != rightScore {
                        return leftScore < rightScore
                    }

                    if left.ticker.count != right.ticker.count {
                        return left.ticker.count < right.ticker.count
                    }

                    return left.ticker.localizedCaseInsensitiveCompare(right.ticker) == .orderedAscending
                })
            guard stateGeneration == self.stateGeneration, generation == searchGeneration else { return }
            searchResults = results
            searchErrorMessage = nil
        } catch {
            guard stateGeneration == self.stateGeneration, generation == searchGeneration else { return }
            searchResults = []
            searchErrorMessage = shouldIgnore(error) ? nil : presentableMessage(for: error, context: .search)
        }

        if stateGeneration == self.stateGeneration, generation == searchGeneration {
            searchIsLoading = false
        }
    }

    func addToWatchlist(_ item: SearchItem) async {
        guard item.canAttemptInV1 else {
            activeAlert = AppAlertState(
                message: item.unsupportedAlertMessage,
                kind: .dismissOnly
            )
            return
        }
        await saveTicker(item.ticker, searchItem: item, redirectToConversation: true)
    }

    func saveSearchResult(_ item: SearchItem) async {
        guard item.canAttemptInV1 else {
            activeAlert = AppAlertState(
                message: item.unsupportedAlertMessage,
                kind: .dismissOnly
            )
            return
        }
        await saveTicker(item.ticker, searchItem: item, redirectToConversation: false)
    }

    func saveTicker(_ ticker: String) async {
        await saveTicker(ticker, searchItem: nil, redirectToConversation: false)
    }

    func prefetchCompany(ticker: String) {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return }
        guard companyCache[normalized] == nil, !loadingTickers.contains(normalized) else { return }

        Task {
            await loadCompany(ticker: normalized)
        }
    }

    func loadCompany(ticker: String, forceRefresh: Bool = false) async {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return }

        if !forceRefresh, companyCache[normalized] != nil {
            return
        }

        if let local = persistence.loadCompany(ticker: normalized, filingKey: activeConversationFilingKeys[normalized]) {
            companyCache[normalized] = local.company
            chatHistoryCache[normalized] = local.chatHistory

            if !forceRefresh {
                refreshCompanyInBackgroundIfNeeded(ticker: normalized)
                return
            }
        }

        if !forceRefresh,
           let state = companyLoadStates[normalized],
           shouldRetryCompanyLoadState(state.status) {
            scheduleCompanyLoadRetry(ticker: normalized, state: state)
            return
        }

        if forceRefresh {
            guard requireAuthenticatedMutation() else { return }
        } else if !installationReadRequestsAvailable {
            deferCompanyLoadUntilAuthentication(ticker: normalized)
            return
        }

        await fetchCompanyRemote(ticker: normalized, forceRefresh: forceRefresh)
    }

    /// 回答が成功した直後にだけ呼ぶ。失敗直後や起動直後に依頼すると
    /// 低い評価を集めにいくことになるので、成功体験以外からは呼ばない。
    private func noteSuccessfulAnswerForReviewPrompt() {
        guard !AppModel.isRunningTests else { return }
        guard reviewPromptGate.recordSuccessfulAnswer(
            appVersion: ReviewPromptGate.currentAppVersion()
        ) else { return }
        pendingReviewRequest = true
    }

    func sendChat(question: String, ticker: String) async -> Bool {
        await sendChat(question: question, ticker: ticker, recoverMissingFilingOnce: true)
    }

    private func sendChat(
        question: String,
        ticker: String,
        recoverMissingFilingOnce: Bool
    ) async -> Bool {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let normalized = normalizedTicker(ticker)
        let stateGeneration = self.stateGeneration
        guard aiConsentGranted else {
            requestAIConsent()
            return false
        }
        guard requireAuthenticatedMutation() else { return false }
        guard let company = companyPayload(for: normalized) else {
            activeAlert = AppAlertState(message: "企業データを先に読み込んでください。", kind: .dismissOnly)
            return false
        }
        guard hasChatCreditAvailable else {
            requestInsufficientCreditRecovery(
                requiredCredits: chatCreditCost,
                remainingCredits: usage?.credits?.totalRemaining,
                source: .localChatPreflight
            )
            return false
        }

        let conversationContext = recentChatContext(for: normalized)
        let existingOperation = retryableChatOperations[normalized]
        let operationId: String
        if let existingOperation,
           existingOperation.matches(
               filingKey: company.filingKey,
               question: trimmed,
               conversationContext: conversationContext
           ) {
            operationId = existingOperation.operationId
        } else {
            operationId = UUID().uuidString
        }

        let pendingChat = PendingChatState(
            operationId: operationId,
            ticker: normalized,
            question: trimmed
        )
        retryableChatOperations[normalized] = RetryableChatOperation(
            filingKey: company.filingKey,
            question: trimmed,
            conversationContext: conversationContext,
            operationId: operationId
        )
        pendingChats[normalized] = pendingChat
        chatIsSending = true
        let pendingStartedAt = pendingChat.submittedAt
        defer {
            finishPendingChat(
                ticker: normalized,
                operationId: operationId,
                stateGeneration: stateGeneration
            )
        }

        do {
            let response = try await apiClient.sendChat(
                filingKey: company.filingKey,
                question: trimmed,
                conversationContext: conversationContext,
                operationId: operationId
            )
            guard stateGeneration == self.stateGeneration else {
                await ensureMinimumPendingChatDuration(since: pendingStartedAt)
                return false
            }
            try persistence.saveChat(question: trimmed, response: response, for: company)
            storeUsage(response.usage, source: .chat)
            chatHistoryCache[normalized] = persistence.loadCompany(ticker: normalized, filingKey: company.filingKey)?.chatHistory ?? []
            clearRetryableChatOperation(ticker: normalized, operationId: operationId)
            noteSuccessfulAnswerForReviewPrompt()
            await ensureMinimumPendingChatDuration(since: pendingStartedAt)
            return true
        } catch {
            guard stateGeneration == self.stateGeneration else {
                await ensureMinimumPendingChatDuration(since: pendingStartedAt)
                return false
            }
            if case let APIError.insufficientCredits(required, remaining) = error {
                requestInsufficientCreditRecovery(
                    requiredCredits: required,
                    remainingCredits: remaining,
                    source: .serverChatResponse
                )
                await ensureMinimumPendingChatDuration(since: pendingStartedAt)
                return false
            }
            if recoverMissingFilingOnce,
               isFilingCacheMiss(error),
               await recoverCompanyAfterFilingCacheMiss(
                   ticker: normalized,
                   expectedStateGeneration: stateGeneration
               ) {
                clearRetryableChatOperation(ticker: normalized, operationId: operationId)
                activeAlert = nil
                return await sendChat(
                    question: trimmed,
                    ticker: normalized,
                    recoverMissingFilingOnce: false
                )
            }
            handle(error)
            await ensureMinimumPendingChatDuration(since: pendingStartedAt)
            return false
        }
    }

    private func isFilingCacheMiss(_ error: Error) -> Bool {
        guard case let APIError.routeMissing(_, path, _, message) = error else { return false }
        let normalizedMessage = message.lowercased()
        return path.lowercased() == "/v1/chat"
            && (normalizedMessage.contains("filing cache not found")
                || normalizedMessage.contains("filing_cache_not_found"))
    }

    private func recoverCompanyAfterFilingCacheMiss(
        ticker: String,
        expectedStateGeneration: Int
    ) async -> Bool {
        let normalized = normalizedTicker(ticker)

        for attempt in 0..<3 {
            guard expectedStateGeneration == stateGeneration else { return false }
            do {
                let response = try await (
                    attempt == 0
                        ? apiClient.refreshCompany(ticker: normalized)
                        : apiClient.fetchCompany(ticker: normalized)
                )
                guard expectedStateGeneration == stateGeneration else { return false }

                switch response {
                case .company(let company):
                    let canonicalTicker = normalizedTicker(company.ticker)
                    activeConversationFilingKeys.removeValue(forKey: normalized)
                    activeConversationFilingKeys.removeValue(forKey: canonicalTicker)
                    try handleLoadedCompany(company, requestedTicker: normalized)
                    return true

                case .retryable(let state):
                    guard attempt < 2 else { return false }
                    let delaySeconds = min(max(state.retryAfterSeconds ?? 1, 1), 5)
                    try await Task.sleep(for: .seconds(delaySeconds))
                }
            } catch {
                return false
            }
        }

        return false
    }

    private func recentChatContext(for ticker: String) -> [ChatContextMessage] {
        chatHistory(for: ticker)
            .suffix(10)
            .compactMap { message in
                guard ["user", "assistant"].contains(message.role) else { return nil }
                let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !content.isEmpty else { return nil }
                return ChatContextMessage(role: message.role, content: String(content.prefix(700)))
            }
    }

    func setAIConsent(_ value: Bool) {
        aiConsentGranted = value
        UserDefaults.standard.set(value, forKey: Self.aiConsentKey)
    }

    func setShowStarterCompanies(_ value: Bool) {
        showStarterCompanies = value
        UserDefaults.standard.set(value, forKey: Self.showStarterCompaniesKey)
    }

    func confirmAIConsent() {
        setAIConsent(true)
        dismissAlert()
    }

    func companyPayload(for ticker: String) -> CompanyPayload? {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return nil }
        return companyCache[normalized] ?? persistence.loadCompany(ticker: normalized, filingKey: activeConversationFilingKeys[normalized])?.company
    }

    func companyLoadState(for ticker: String) -> CompanyLoadStatePayload? {
        companyLoadStates[normalizedTicker(ticker)]
    }

    func isCompanyLoading(_ ticker: String) -> Bool {
        loadingTickers.contains(normalizedTicker(ticker))
    }

    func openConversation(for ticker: String, draftQuestion: String? = nil, filingKey: String? = nil) {
        let normalized = normalizedTicker(ticker)
        let trimmedDraft = draftQuestion?.trimmingCharacters(in: .whitespacesAndNewlines)
        completeInitialEntry()
        if let filingKey {
            activeConversationFilingKeys[normalized] = filingKey
        } else {
            activeConversationFilingKeys.removeValue(forKey: normalized)
        }
        if let local = persistence.loadCompany(ticker: normalized, filingKey: filingKey) {
            companyCache[normalized] = local.company
            chatHistoryCache[normalized] = local.chatHistory
        }
        activeConversationTicker = normalized
        pendingConversationTicker = trimmedDraft == nil ? nil : normalized
        pendingConversationQuestion = trimmedDraft
        if shouldPersistConversationSelection(ticker: normalized, draftQuestion: trimmedDraft) {
            UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
        }
        UserDefaults.standard.set(pendingConversationTicker, forKey: Self.pendingConversationTickerKey)
        UserDefaults.standard.set(pendingConversationQuestion, forKey: Self.pendingConversationQuestionKey)
        prefetchCompany(ticker: normalized)
    }

    func consumePendingDraftQuestion(for ticker: String) -> String? {
        let normalized = normalizedTicker(ticker)
        guard pendingConversationTicker == normalized else { return nil }

        let question = pendingConversationQuestion?.trimmingCharacters(in: .whitespacesAndNewlines)
        pendingConversationTicker = nil
        pendingConversationQuestion = nil
        UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
        UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
        return question?.isEmpty == false ? question : nil
    }

    func isTickerInWatchlist(_ ticker: String, cik: String? = nil) -> Bool {
        savedTicker(for: ticker, cik: cik) != nil
    }

    func isAddingTicker(_ ticker: String) -> Bool {
        addingTickers.contains(normalizedTicker(ticker))
    }

    func chatHistory(for ticker: String) -> [LocalChatMessage] {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return [] }
        if let cached = chatHistoryCache[normalized] {
            return cached
        }
        return persistence.loadCompany(ticker: normalized, filingKey: activeConversationFilingKeys[normalized])?.chatHistory ?? []
    }

    func conversationHistory(for ticker: String) -> [LocalCompanyRecord] {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return [] }
        return persistence.loadConversationRecords(ticker: normalized)
    }

    func isViewingOlderFilingConversation(ticker: String) -> Bool {
        let normalized = normalizedTicker(ticker)
        guard let active = companyPayload(for: normalized),
              let latest = persistence.loadCompany(ticker: normalized)?.company else {
            return false
        }
        return active.filingKey != latest.filingKey
    }

    func openLatestConversation(for ticker: String) {
        openConversation(for: ticker)
    }

    func pendingChat(for ticker: String) -> PendingChatState? {
        pendingChats[normalizedTicker(ticker)]
    }

    func recordCompanyVisit(ticker: String) {
        // 未読ドットは「開いたかどうか」だけで消す。
        // 資料の取得に失敗した会社でもワークスペースは開いているので、
        // 記録を payload の有無より前に置き、ドットが取り残されないようにする。
        markCompanyOpened(ticker: ticker)

        guard let company = companyPayload(for: ticker) else {
            pendingVisitTicker = normalizedTicker(ticker)
            return
        }

        pendingVisitTicker = nil
        let normalized = normalizedTicker(ticker)
        completeInitialEntry()
        lastViewedTicker = normalized
        UserDefaults.standard.set(normalized, forKey: Self.lastViewedTickerKey)
        activeConversationTicker = normalized
        UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
        if activeConversationFilingKeys[normalized] == nil {
            setLastSeenFilingKey(company.filingKey, for: normalized)
        }

        recentTickers.removeAll(where: { $0 == normalized })
        recentTickers.insert(normalized, at: 0)
        recentTickers = Array(recentTickers.prefix(10))
        UserDefaults.standard.set(recentTickers, forKey: Self.recentTickersKey)

        loadHomeFromPersistence()
    }

    private func ensureMinimumPendingChatDuration(since startedAt: Date) async {
        let elapsed = Date().timeIntervalSince(startedAt)
        guard elapsed < minimumPendingChatDuration else { return }

        let remainingNanoseconds = UInt64((minimumPendingChatDuration - elapsed) * 1_000_000_000)
        try? await Task.sleep(nanoseconds: remainingNanoseconds)
    }

    func hasNewFiling(for card: WatchlistCard) -> Bool {
        guard let lastSeen = UserDefaults.standard.string(forKey: lastSeenFilingKeyKey(for: card.ticker)) else {
            return false
        }
        return lastSeen != card.filingKey
    }

    func recentCompanyCards(limit: Int, includeSaved: Bool = false) -> [WatchlistCard] {
        let filteredTickers = includeSaved ? recentTickers : recentTickers.filter { !isTickerInWatchlist($0) }
        return Array(orderedCards(for: filteredTickers).prefix(limit))
    }

    /// 最後に開いた会社。アスクバーの会社チップの既定値に使う
    /// (`streamAskContext`)。該当が無いときは nil のまま返し、
    /// スターター企業へは落とさない — 本人が選んでいない会社を
    /// 質問の宛先に据えないため(v2 IA 仕様 Phase 6「AAPL の自然さ監査」)。
    var lastOpenedCompanyTicker: String? {
        activeConversationTicker ?? lastViewedTicker
    }

    /// ストリームの回答カードの素。追っている会社(保存済み + 最近)の会話記録を
    /// まとめて読み出す。並べ替えと組み立ては `researchArchiveGroups` / `streamItems`
    /// (純ロジック)側の仕事で、ここは永続化に触れる部分だけを引き受ける。
    ///
    /// 上限は**最近開いた会社にだけ**かける。保存済みを切り詰めると、
    /// 20社保存している人の過去の質問が黙って消える面が出る
    /// (ストリームは Phase 3 の研究アーカイブを置き換えた面なので、
    /// あちらが見せていた範囲を狭めない)。`savedTickers` 自体が25社で頭打ちなので、
    /// 読み出す会社数は最悪でも25 + recentLimit に収まる。
    func trackedConversationRecords(recentLimit: Int = 10) -> [LocalCompanyRecord] {
        let recent = recentCompanyCards(limit: recentLimit, includeSaved: false)
        var seen = Set<String>()
        let tickers = (watchlist + recent)
            .map { normalizedTicker($0.ticker) }
            .filter { seen.insert($0).inserted }
        return tickers.flatMap { conversationHistory(for: $0) }
    }

    func dismissAlert() {
        activeAlert = nil
    }

    func requestAIConsent() {
        activeAlert = AppAlertState(
            message: Self.aiConsentAlertMessage,
            kind: .aiConsent
        )
    }

    func requestResetLocalDataConfirmation() {
        activeAlert = AppAlertState(
            message: """
保存済みデータと会話履歴をこの端末から削除します。
取得済みの決算資料も消え、画面の状態は最初からやり直す状態に戻ります。
credit残高に使う端末識別情報は維持されます。
""",
            kind: .resetConfirmation
        )
    }

    func requestCreditOptions() {
        let currentCredits = usage?.credits?.totalRemaining ?? 0
        requestInsufficientCreditRecovery(
            requiredCredits: chatCreditCost,
            remainingCredits: currentCredits,
            source: .chatComposer
        )
    }

    func confirmResetLocalData() {
        dismissAlert()
        resetLocalData()
    }

    func resetLocalData() {
        do {
            stateGeneration += 1
            searchGeneration += 1
            try persistence.reset()
            watchlist = []
            recentCompanies = []
            searchResults = []
            searchErrorMessage = nil
            usage = nil
            usageLoadState = .loading
            companyCache = [:]
            companyLoadStates = [:]
            chatHistoryCache = [:]
            pendingChats = [:]
            retryableChatOperations = [:]
            authenticationDeferredCompanyTickers = []
            addingTickers = []
            loadingTickers = []
            cancelAllCompanyLoadRetries()
            accessRevokedTickers = []
            refreshedTickersThisSession = []
            savedTickers = []
            recentTickers = []
            lastViewedTicker = nil
            activeConversationTicker = nil
            searchIsLoading = false
            companyIsLoading = false
            chatIsSending = false
            UserDefaults.standard.removeObject(forKey: Self.savedTickersKey)
            UserDefaults.standard.removeObject(forKey: Self.recentTickersKey)
            UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.hasCompletedInitialEntryKey)
            UserDefaults.standard.removeObject(forKey: Self.hasSeenEntryIntroKey)
            UserDefaults.standard.removeObject(forKey: Self.appLaunchCountKey)
            UserDefaults.standard.removeObject(forKey: Self.starterCompaniesAutoHiddenKey)
            UserDefaults.standard.removeObject(forKey: Self.aiConsentKey)
            UserDefaults.standard.set(true, forKey: Self.showStarterCompaniesKey)
            hasCompletedInitialEntry = false
            appLaunchCount = 0
            showStarterCompanies = true
            aiConsentGranted = false
            pendingConversationTicker = nil
            pendingConversationQuestion = nil
            starterCompaniesAutoHidden = false
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
            clearCompanyNavigationState()
            loadHomeFromPersistence()

            Task {
                await refreshUsage()
            }
        } catch {
            usageLoadState = .failed
            activeAlert = AppAlertState(message: error.localizedDescription, kind: .dismissOnly)
        }
    }

    func removeFromWatchlist(_ ticker: String) async {
        let normalized = normalizedTicker(ticker)
        guard requireAuthenticatedMutation() else { return }
        await acquireWatchlistMutationLock()
        defer { releaseWatchlistMutationLock() }
        guard !addingTickers.contains(normalized) else { return }
        let stateGeneration = self.stateGeneration

        addingTickers.insert(normalized)
        defer { finishTickerMutation(ticker: normalized, stateGeneration: stateGeneration) }

        do {
            let result = try await apiClient.removeFromWatchlist(
                ticker: normalized
            )
            guard stateGeneration == self.stateGeneration else { return }
            storeUsage(result.usage, source: .watchlistRemove)
            if result.usage.savedTickers == nil {
                applyLocalWatchlistRemovalFallback(for: normalized)
                loadHomeFromPersistence()
            }
        } catch {
            guard stateGeneration == self.stateGeneration else { return }
            handle(error)
        }
    }

    func displayPlanLabel(for usage: UsagePayload) -> String {
        usage.displayPlanLabel
    }

    func displayChatLimit(for usage: UsagePayload) -> String {
        usage.displayChatLimit
    }

    func displayStockLimit(for usage: UsagePayload) -> String {
        usage.displayStockLimit
    }

    private func saveTicker(_ ticker: String, searchItem: SearchItem?, redirectToConversation: Bool) async {
        let normalized = normalizedTicker(ticker)
        guard requireAuthenticatedMutation() else { return }
        await acquireWatchlistMutationLock()
        defer { releaseWatchlistMutationLock() }
        guard !addingTickers.contains(normalized) else { return }
        let stateGeneration = self.stateGeneration

        if isTickerInWatchlist(normalized, cik: searchItem?.cik) {
            if redirectToConversation {
                openConversation(for: normalized)
            }
            activeAlert = AppAlertState(
                message: "\(normalized) はすでに保存済みです。",
                kind: .dismissOnly
            )
            return
        }

        addingTickers.insert(normalized)
        defer { finishTickerMutation(ticker: normalized, stateGeneration: stateGeneration) }

        do {
            let result = try await apiClient.addToWatchlist(
                ticker: normalized
            )
            guard stateGeneration == self.stateGeneration else { return }

            if let company = result.company {
                try handleReadyWatchlistAdd(
                    company: company,
                    requestedTicker: normalized,
                    searchItem: searchItem,
                    usage: result.usage,
                    redirectToConversation: redirectToConversation
                )
            } else if let loadState = result.loadState {
                handlePendingWatchlistAdd(
                    loadState: loadState,
                    requestedTicker: normalized,
                    searchItem: searchItem,
                    usage: result.usage,
                    redirectToConversation: redirectToConversation
                )
            } else {
                throw APIError.invalidResponse
            }
        } catch {
            guard stateGeneration == self.stateGeneration else { return }
            handle(error)
        }
    }

    private func handleReadyWatchlistAdd(
        company: CompanyPayload,
        requestedTicker: String,
        searchItem: SearchItem?,
        usage: UsagePayload,
        redirectToConversation: Bool
    ) throws {
        let savedTicker = normalizedTicker(company.ticker)
        try persistence.saveCompany(company, searchItem: searchItem)
        companyCache.removeValue(forKey: requestedTicker)
        companyLoadStates.removeValue(forKey: requestedTicker)
        chatHistoryCache.removeValue(forKey: requestedTicker)
        companyCache[savedTicker] = company
        companyLoadStates.removeValue(forKey: savedTicker)
        chatHistoryCache[savedTicker] = persistence.loadCompany(ticker: savedTicker)?.chatHistory ?? []
        accessRevokedTickers.remove(requestedTicker)
        accessRevokedTickers.remove(savedTicker)
        completeInitialEntry()
        storeUsage(usage, source: .watchlistAdd)
        if usage.savedTickers == nil {
            applyLocalWatchlistAddFallback(savedTicker: savedTicker, cik: company.cik)
        }
        setLastSeenFilingKey(company.filingKey, for: savedTicker)
        loadHomeFromPersistence()

        if redirectToConversation {
            activeConversationTicker = savedTicker
            UserDefaults.standard.set(savedTicker, forKey: Self.activeConversationTickerKey)
            openConversation(for: savedTicker)
        }
    }

    private func handlePendingWatchlistAdd(
        loadState: CompanyLoadStatePayload,
        requestedTicker: String,
        searchItem: SearchItem?,
        usage: UsagePayload,
        redirectToConversation: Bool
    ) {
        let savedTicker = normalizedTicker(loadState.ticker)
        accessRevokedTickers.remove(requestedTicker)
        accessRevokedTickers.remove(savedTicker)
        companyLoadStates[requestedTicker] = loadState
        companyLoadStates[savedTicker] = loadState
        scheduleCompanyLoadRetry(ticker: savedTicker, state: loadState)
        completeInitialEntry()
        storeUsage(usage, source: .watchlistAdd)
        if usage.savedTickers == nil {
            applyLocalWatchlistAddFallback(savedTicker: savedTicker, cik: loadState.cik ?? searchItem?.cik)
        }
        loadHomeFromPersistence()

        if redirectToConversation {
            activeConversationTicker = savedTicker
            UserDefaults.standard.set(savedTicker, forKey: Self.activeConversationTickerKey)
            openConversation(for: savedTicker)
        }
    }

    func refreshConversationCompany(ticker: String) async -> CompanyRefreshResult {
        let normalized = normalizedTicker(ticker)
        guard requireAuthenticatedMutation() else { return .retryable }
        guard !loadingTickers.contains(normalized), !isLocalAccessRevoked(for: normalized) else {
            return .retryable
        }

        let stateGeneration = self.stateGeneration
        let activeCompany = companyPayload(for: normalized)

        loadingTickers.insert(normalized)
        companyIsLoading = true
        defer {
            finishCompanyLoad(ticker: normalized, stateGeneration: stateGeneration)
        }

        do {
            let response = try await apiClient.refreshCompany(ticker: normalized)
            guard stateGeneration == self.stateGeneration else { return .retryable }
            guard !isLocalAccessRevoked(for: normalized) else { return .retryable }

            switch response {
            case .company(let company):
                let refreshedTicker = normalizedTicker(company.ticker)
                if let activeCompany,
                   activeCompany.filingKey != company.filingKey {
                    return .needsConfirmation(company)
                }

                try handleLoadedCompany(company, requestedTicker: normalized)
                if refreshedTicker != normalized {
                    try handleLoadedCompany(company, requestedTicker: refreshedTicker)
                }
                return .unchanged

            case .retryable(let state):
                companyLoadStates[normalized] = state
                scheduleCompanyLoadRetry(ticker: normalized, state: state)
                return .retryable
            }
        } catch {
            guard stateGeneration == self.stateGeneration else { return .retryable }
            guard !shouldIgnore(error) else { return .retryable }
            let recoveredSelection = clearUnavailableEphemeralSelectionIfNeeded(for: normalized)
            if companyCache[normalized] == nil, !recoveredSelection {
                presentAlert(for: error)
            }
            return .retryable
        }
    }

    func startNewConversation(with company: CompanyPayload) {
        let normalized = normalizedTicker(company.ticker)
        do {
            try persistence.saveCompany(company, searchItem: nil)
            activeConversationFilingKeys.removeValue(forKey: normalized)
            companyCache[normalized] = company
            chatHistoryCache[normalized] = persistence.loadCompany(ticker: normalized, filingKey: company.filingKey)?.chatHistory ?? []
            companyLoadStates.removeValue(forKey: normalized)
            cancelCompanyLoadRetry(for: normalized)
            refreshedTickersThisSession.insert(normalized)
            accessRevokedTickers.remove(normalized)
            activeConversationTicker = normalized
            UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
            setLastSeenFilingKey(company.filingKey, for: normalized)
            loadHomeFromPersistence()
        } catch {
            activeAlert = AppAlertState(message: error.localizedDescription, kind: .dismissOnly)
        }
    }

    private func refreshUsage(showErrors: Bool = true) async {
        let stateGeneration = self.stateGeneration
        let usageGeneration = usageMutationGeneration
        usageLoadState = .loading
        do {
            let usage = try await apiClient.fetchUsage()
            guard stateGeneration == self.stateGeneration else { return }
            guard usageGeneration == usageMutationGeneration else { return }
            storeUsage(usage, source: .refresh)
            lastUsageRefreshAt = Date()
            usageLoadState = .loaded
        } catch {
            guard stateGeneration == self.stateGeneration else { return }
            guard !shouldIgnore(error) else { return }
            usageLoadState = .failed
            if showErrors, usage == nil {
                presentAlert(for: error)
            } else {
                scheduleInstallationCredentialRecoveryIfNeeded(error)
            }
        }
    }

    private func refreshCompanyInBackgroundIfNeeded(ticker: String) {
        guard !loadingTickers.contains(ticker), !refreshedTickersThisSession.contains(ticker) else { return }
        guard !isLocalAccessRevoked(for: ticker) else { return }

        Task {
            await fetchCompanyRemote(ticker: ticker, forceRefresh: false)
        }
    }

    private func fetchCompanyRemote(ticker: String, forceRefresh: Bool) async {
        guard !loadingTickers.contains(ticker), !isLocalAccessRevoked(for: ticker) else { return }
        if forceRefresh {
            guard authenticatedCreditActionsAvailable else { return }
        } else if !installationReadRequestsAvailable {
            deferCompanyLoadUntilAuthentication(ticker: ticker)
            return
        }
        let stateGeneration = self.stateGeneration

        loadingTickers.insert(ticker)
        companyIsLoading = true
        defer {
            finishCompanyLoad(ticker: ticker, stateGeneration: stateGeneration)
        }

        do {
            let response = try await (
                forceRefresh
                    ? apiClient.refreshCompany(
                        ticker: ticker
                    )
                    : apiClient.fetchCompany(
                        ticker: ticker
                    )
            )
            guard stateGeneration == self.stateGeneration else { return }
            guard !isLocalAccessRevoked(for: ticker) else { return }
            switch response {
            case .company(let company):
                try handleLoadedCompany(company, requestedTicker: ticker)
            case .retryable(let state):
                companyLoadStates[ticker] = state
                scheduleCompanyLoadRetry(ticker: ticker, state: state)
            }
        } catch {
            guard stateGeneration == self.stateGeneration else { return }
            guard !shouldIgnore(error) else { return }
            let recoveredSelection = clearUnavailableEphemeralSelectionIfNeeded(for: ticker)
            if companyCache[ticker] == nil, !recoveredSelection {
                presentAlert(for: error)
            }
        }
    }

    private func handleLoadedCompany(_ company: CompanyPayload, requestedTicker: String) throws {
        let normalizedCompanyTicker = normalizedTicker(company.ticker)
        let shouldPersist = !company.isStaleReady

        if shouldPersist {
            try persistence.saveCompany(company, searchItem: nil)
            companyLoadStates.removeValue(forKey: requestedTicker)
            companyLoadStates.removeValue(forKey: normalizedCompanyTicker)
            cancelCompanyLoadRetry(for: requestedTicker)
            cancelCompanyLoadRetry(for: normalizedCompanyTicker)
        } else {
            companyLoadStates[requestedTicker] = CompanyLoadStatePayload(
                status: .staleReady,
                ticker: company.ticker,
                companyName: company.companyName,
                cik: company.cik,
                message: nil,
                statusMessage: company.statusMessage,
                retryAfterSeconds: company.retryAfterSeconds
            )
        }

        let requestedActiveFilingKey = activeConversationFilingKeys[requestedTicker]
        if requestedActiveFilingKey == nil || requestedActiveFilingKey == company.filingKey {
            companyCache[requestedTicker] = company
            chatHistoryCache[requestedTicker] = persistence.loadCompany(ticker: requestedTicker, filingKey: company.filingKey)?.chatHistory ?? []
        }

        let normalizedActiveFilingKey = activeConversationFilingKeys[normalizedCompanyTicker]
        if normalizedActiveFilingKey == nil || normalizedActiveFilingKey == company.filingKey {
            companyCache[normalizedCompanyTicker] = company
            chatHistoryCache[normalizedCompanyTicker] = persistence.loadCompany(ticker: normalizedCompanyTicker, filingKey: company.filingKey)?.chatHistory ?? []
        }
        accessRevokedTickers.remove(requestedTicker)
        accessRevokedTickers.remove(normalizedCompanyTicker)
        if shouldPersist {
            refreshedTickersThisSession.insert(requestedTicker)
            refreshedTickersThisSession.insert(normalizedCompanyTicker)
        }
        loadHomeFromPersistence()

        // 訪問の予約(上の pendingVisitTicker 参照)は、その会社の payload が
        // 揃ったこの時点で清算する。関係ない会社の読み込み(先読み・一括更新)では
        // 発火しないよう、予約と一致する場合に限る。
        if pendingVisitTicker == normalizedCompanyTicker || pendingVisitTicker == requestedTicker {
            pendingVisitTicker = nil
            recordCompanyVisit(ticker: normalizedCompanyTicker)
        }
    }

    private func scheduleCompanyLoadRetry(ticker: String, state: CompanyLoadStatePayload) {
        let normalized = normalizedTicker(ticker)
        guard shouldRetryCompanyLoadState(state.status) else { return }
        guard companyCache[normalized] == nil, !loadingTickers.contains(normalized), !isLocalAccessRevoked(for: normalized) else { return }

        companyRetryTasks[normalized]?.cancel()
        let delay = companyRetryDelay(for: state)
        companyRetryTasks[normalized] = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.retryCompanyLoadIfStillPending(ticker: normalized)
        }
    }

    private func retryCompanyLoadIfStillPending(ticker: String) async {
        let normalized = normalizedTicker(ticker)
        companyRetryTasks[normalized] = nil
        guard companyCache[normalized] == nil else { return }
        guard !loadingTickers.contains(normalized), !isLocalAccessRevoked(for: normalized) else { return }
        guard let state = companyLoadStates[normalized], shouldRetryCompanyLoadState(state.status) else { return }

        await fetchCompanyRemote(ticker: normalized, forceRefresh: false)
    }

    private func shouldRetryCompanyLoadState(_ status: CompanyLoadStatus) -> Bool {
        status == .preparing || status == .failedRetryable
    }

    private func companyRetryDelay(for state: CompanyLoadStatePayload) -> Duration {
        let seconds = state.retryAfterSeconds ?? (state.status == .preparing ? 2 : 30)
        if seconds <= 0 {
            return .milliseconds(50)
        }

        switch state.status {
        case .preparing:
            return .seconds(min(seconds, 5))
        case .failedRetryable:
            return .seconds(min(max(seconds, 10), 60))
        case .ready, .staleReady:
            return .seconds(seconds)
        }
    }

    private func cancelCompanyLoadRetry(for ticker: String) {
        let normalized = normalizedTicker(ticker)
        companyRetryTasks[normalized]?.cancel()
        companyRetryTasks.removeValue(forKey: normalized)
    }

    private func cancelAllCompanyLoadRetries() {
        for task in companyRetryTasks.values {
            task.cancel()
        }
        companyRetryTasks = [:]
    }

    private func handle(_ error: Error) {
        guard !shouldIgnore(error) else { return }
        presentAlert(for: error)
    }

    private var installationReadRequestsAvailable: Bool {
        guard apiClient.hasInstallationCredential else { return false }
        switch installationIdentityLoadState {
        case .loading, .degraded:
            return false
        case .idle, .ready:
            return true
        }
    }

    private var authenticationStateAllowsMutation: Bool {
        switch installationIdentityLoadState {
        case .loading, .degraded:
            return false
        case .idle, .ready:
            return true
        }
    }

    @discardableResult
    func ensureFraudSensitiveAuthentication() async -> Bool {
        if !fraudSensitiveCreditActionsAvailable,
           apiClient.canRetryFraudSensitiveAuthentication {
            setRewardedAdDebugReason("installation_authentication_retry_started")
            await retryInstallationAuthentication()
        }
        return requireFraudSensitiveMutation()
    }

    private func deferCompanyLoadUntilAuthentication(ticker: String) {
        let normalized = normalizedTicker(ticker)
        guard companyCache[normalized] == nil else { return }
        authenticationDeferredCompanyTickers.insert(normalized)
    }

    @discardableResult
    private func requireAuthenticatedMutation(showAlert: Bool = true) -> Bool {
        requireMutationAvailability(
            authenticatedCreditActionsAvailable,
            showAlert: showAlert
        )
    }

    @discardableResult
    private func requireFraudSensitiveMutation(showAlert: Bool = true) -> Bool {
        requireMutationAvailability(
            fraudSensitiveCreditActionsAvailable,
            showAlert: showAlert
        )
    }

    private func requireMutationAvailability(_ isAvailable: Bool, showAlert: Bool) -> Bool {
        guard isAvailable else {
            if showAlert, activeAlert == nil {
                // The persistent authentication banner already explains degraded
                // identity state and provides Retry. A second blocking alert adds no
                // recovery path and interrupts access to cached content.
                if installationAuthenticationStatus != nil {
                    return false
                }

                let message: String
                if installationAuthenticationIsRetrying {
                    message = "端末認証を確認しています。完了後にもう一度お試しください。"
                } else {
                    message = apiClient.authenticatedActionUnavailableError.localizedDescription
                }
                activeAlert = AppAlertState(message: message, kind: .dismissOnly)
            }
            return false
        }
        return true
    }

    private func finishPendingChat(ticker: String, operationId: String, stateGeneration: Int) {
        guard stateGeneration == self.stateGeneration else { return }
        if pendingChats[ticker]?.operationId == operationId {
            pendingChats.removeValue(forKey: ticker)
        }
        chatIsSending = !pendingChats.isEmpty
    }

    private func clearRetryableChatOperation(ticker: String, operationId: String) {
        guard retryableChatOperations[ticker]?.operationId == operationId else { return }
        retryableChatOperations.removeValue(forKey: ticker)
    }

    private func finishTickerMutation(ticker: String, stateGeneration: Int) {
        guard stateGeneration == self.stateGeneration else { return }
        addingTickers.remove(ticker)
    }

    private func finishCompanyLoad(ticker: String, stateGeneration: Int) {
        guard stateGeneration == self.stateGeneration else { return }
        loadingTickers.remove(ticker)
        companyIsLoading = !loadingTickers.isEmpty
    }

    private func acquireWatchlistMutationLock() async {
        if !watchlistMutationInFlight {
            watchlistMutationInFlight = true
            return
        }

        await withCheckedContinuation { continuation in
            watchlistMutationWaiters.append(continuation)
        }
    }

    private func releaseWatchlistMutationLock() {
        if let next = watchlistMutationWaiters.first {
            watchlistMutationWaiters.removeFirst()
            next.resume()
            return
        }

        watchlistMutationInFlight = false
    }

    private func presentAlert(for error: Error) {
        scheduleInstallationCredentialRecoveryIfNeeded(error)
        activeAlert = AppAlertState(
            message: presentableMessage(for: error),
            kind: .dismissOnly
        )
    }

    private func scheduleInstallationCredentialRecoveryIfNeeded(_ error: Error) {
        guard Self.isInstallationCredentialRejection(error) else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                guard try self.apiClient.invalidateInstallationCredentialForRebootstrap() else { return }
                self.installationIdentityLoadState = .degraded(
                    failure: InstallationIdentityFailure(kind: .invalidCredentials),
                    attemptCount: 1
                )
                if self.usage == nil {
                    self.usageLoadState = .failed
                }
                await self.retryInstallationAuthentication()
            } catch {
                self.installationIdentityLoadState = .degraded(
                    failure: InstallationIdentityFailure.classify(error),
                    attemptCount: 1
                )
            }
        }
    }

    func refreshStoreKitDiagnostics() {
        subscriptionStore.recordPurchaseButtonVisibilityReason(storeKitPurchaseButtonVisibilityReason)
        storeKitDiagnostics = subscriptionStore.storeKitDiagnostics
    }

    private var storeKitPurchaseButtonVisibilityReason: String {
        guard isCreditBillingEnabled else {
            return "hidden_or_disabled:credit_billing_disabled"
        }
        if creditPackProductLoadInFlight {
            return "visible:product_load_in_flight"
        }
        if creditPackProducts.contains(where: { $0.id == SubscriptionStore.miniCreditProductID && $0.isAvailable }) {
            return "visible:mini_credit_product_available"
        }
        if creditPackProducts.contains(where: { $0.id == SubscriptionStore.miniCreditProductID }) {
            return "visible:mini_credit_product_unavailable"
        }
        return "visible:product_not_loaded"
    }

    private func shouldIgnore(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }

        if let urlError = error as? URLError, urlError.code == .cancelled {
            return true
        }

        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == URLError.cancelled.rawValue
    }

    /// エラー文の宛先。同じ 503 でも、会話の失敗と検索の失敗では言うことが違う。
    enum PresentableMessageContext {
        case general
        /// 検索。**会話の文言を出さない** — 「チャット応答を生成できません」が
        /// 銘柄検索の失敗として出ていた(2026-08-26 実機)。
        case search
    }

    private func presentableMessage(
        for error: Error,
        context: PresentableMessageContext = .general
    ) -> String {
        let nsError = error as NSError
        if let urlError = error as? URLError, urlError.code == .timedOut {
            return "通信に時間がかかりすぎています。少し待ってから、もう一度試してください。"
        }

        if nsError.domain == NSURLErrorDomain && nsError.code == URLError.timedOut.rawValue {
            return "通信に時間がかかりすぎています。少し待ってから、もう一度試してください。"
        }

        if case let APIError.routeMissing(_, path, _, message) = error {
            let normalizedPath = path.lowercased()
            let normalizedRouteMessage = message.lowercased()

            if normalizedPath == "/v1/chat",
               normalizedRouteMessage.contains("filing cache not found")
                || normalizedRouteMessage.contains("filing_cache_not_found") {
                return "表示中の決算データが古くなりました。右上の更新ボタンで企業データを再読み込みしてから、もう一度お試しください。"
            }

            let purchaseRoutes = [
                "/v1/billing/sync",
                "/v1/ios/subscriptions/sync",
                "/v1/ios/purchases/credits/complete",
                "/v1/credits/purchase-grant"
            ]
            if purchaseRoutes.contains(normalizedPath) {
                return "購入の同期先が見つかりません。しばらくしてからもう一度お試しください。"
            }

            return "この機能を現在利用できません。少し待ってから、もう一度お試しください。"
        }

        let rawMessage = rawMessage(for: error)
        let normalizedMessage = rawMessage.lowercased()

        if normalizedMessage.contains("timed out") {
            return "通信に時間がかかりすぎています。少し待ってから、もう一度試してください。"
        }

        if rawMessage.contains("Daily chat quota exceeded") {
            return "本日のチャット上限に達しました。日付が変わってから再度お試しください。"
        }

        if rawMessage.contains("insufficient_credits") || rawMessage.contains("creditが不足") {
            let currentCredits = usage?.credits?.totalRemaining ?? 0
            return "クレジットが不足しています\nこの操作には \(chatCreditCost)クレジットが必要です。\n現在の残高: \(currentCredits)クレジット"
        }

        if rawMessage.contains("クレジット商品を読み込めません")
            || rawMessage.contains("購入を確認できません")
            || rawMessage.contains("購入は保留中")
            || rawMessage.contains("購入はキャンセルされました")
            || rawMessage.contains("購入は完了しましたが") {
            return rawMessage
        }

        if rawMessage.contains("Apple transaction verification") || rawMessage.contains("Apple transaction could not be verified") {
            return "購入を確認できませんでした。購入を復元してください。"
        }

        if rawMessage.contains("Purchase transaction") {
            return "購入は完了しましたが、クレジット付与確認がまだ完了していません。少し時間をおいて再試行してください。"
        }

        if rawMessage.contains("Invalid billing sync payload")
            || rawMessage.contains("Invalid credit purchase payload")
            || rawMessage.contains("Invalid transaction")
            || (rawMessage.contains("product") && rawMessage.contains("mismatch")) {
            return "購入を確認できませんでした。購入を復元してください。"
        }

        if nsError.domain == NSURLErrorDomain || error is URLError {
            return "通信に失敗しました。接続を確認して、購入を復元してください。"
        }

        if rawMessage.contains("Watchlist limit exceeded") {
            return "現在の保存銘柄上限に達しました。"
        }

        if rawMessage.contains("Ticker access requires watchlist add") {
            return "この銘柄を開けませんでした。もう一度検索して開いてください。"
        }

        if rawMessage.contains("No supported filing found") {
            return "この銘柄の最新開示は対応範囲外です。\(SupportedFilingForms.listed) に対応しています(ETF・投資信託などは対象外です)。"
        }

        if rawMessage.contains("Ticker not found") {
            return "ティッカーが見つかりませんでした。"
        }

        if rawMessage.contains("SEC data is temporarily unavailable") {
            return "SEC データを現在取得できません。しばらくしてから再度お試しください。"
        }

        if rawMessage.contains("Failed to extract MD&A section") {
            return "本文抽出に失敗しました。時間を置いて再試行するか、原文を直接確認してください。"
        }

        // メンテナンスは「落ちている」ではなく「止めている」。理由を名指しする。
        if rawMessage.contains("under maintenance") {
            return "ただいまメンテナンス中です。しばらくしてから再度お試しください。"
        }

        if rawMessage.contains("Chat response is temporarily unavailable")
            || rawMessage.contains("Internal server error")
            || rawMessage.contains("HTTP 503") {
            return context == .search
                ? "サーバーが応答しませんでした。しばらくしてから再度お試しください。"
                : "チャット応答を現在生成できません。少し待ってから、もう一度お試しください。"
        }

        if rawMessage.contains("Chat is temporarily disabled") {
            return "現在チャット機能を一時停止しています。しばらくしてから再度お試しください。"
        }

        if normalizedMessage.contains("filing cache not found")
            || normalizedMessage.contains("filing_cache_not_found") {
            return "表示中の決算データが古くなりました。右上の更新ボタンで企業データを再読み込みしてから、もう一度お試しください。"
        }

        if rawMessage.contains("Device key is required") || rawMessage.contains("Client identity is unavailable") {
            return "端末識別情報の初期化に失敗しました。アプリを再起動してから、もう一度お試しください。"
        }

        if rawMessage.contains("Quota request failed") {
            return "利用状況の確認に失敗しました。少し待ってから、もう一度お試しください。"
        }

        if rawMessage.contains("under maintenance") {
            return "現在メンテナンス中です。しばらくしてから再度お試しください。"
        }

        if rawMessage.contains("execution_pending") {
            return "処理を続行しています。少し待ってから、もう一度お試しください。"
        }

        if rawMessage.contains("operation_result_expired") {
            return "処理結果の再取得期限が切れています。新しい質問として内容を変更して送信してください。"
        }

        if rawMessage.contains("operation_id_payload_mismatch") {
            return "同じ操作IDに異なる内容が指定されたため、安全に送信できませんでした。"
        }

        return rawMessage
    }

    private func rawMessage(for error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .invalidResponse:
                return "レスポンスを解釈できませんでした。"
            case .server(let message):
                return message
            case .serverStatus(let statusCode, let message):
                return "HTTP \(statusCode): \(message)"
            case .routeMissing(let statusCode, let path, let url, let message):
                return "HTTP \(statusCode): route_missing path=\(path) url=\(url) message=\(message)"
            case .insufficientCredits(let required, let remaining):
                return "insufficient_credits required=\(required) remaining=\(remaining)"
            case .executionPending(let retryAfterSeconds):
                return "execution_pending retryAfterSeconds=\(retryAfterSeconds)"
            case .operationResultExpired:
                return "operation_result_expired"
            case .operationIdPayloadMismatch:
                return "operation_id_payload_mismatch"
            }
        }

        return error.localizedDescription
    }

    private func storeUsage(_ usage: UsagePayload, source: UsageUpdateSource) {
        if source != .refresh {
            usageMutationGeneration += 1
        }
        let effectiveUsage = normalizeV1FreeCreditUsage(mergeUsageSavedTickersIfNeeded(usage, source: source))
        self.usage = effectiveUsage
        guard let serverTickers = effectiveUsage.savedTickers else { return }
        reconcileSavedTickers(with: serverTickers)
    }

    private func normalizeV1FreeCreditUsage(_ usage: UsagePayload) -> UsagePayload {
        guard BillingCatalog.tier(for: usage.plan).plan == BillingCatalog.free.plan else {
            return usage
        }

        let normalizedChatLimit = max(usage.chatLimit, BillingCatalog.free.chatLimit)
        guard let credits = usage.credits else {
            guard normalizedChatLimit != usage.chatLimit else { return usage }
            return UsagePayload(
                plan: usage.plan,
                activePlan: usage.activePlan,
                activeSubscription: usage.activeSubscription,
                chatsUsed: usage.chatsUsed,
                chatLimit: normalizedChatLimit,
                stocksUsed: usage.stocksUsed,
                stockLimit: usage.stockLimit,
                dateJST: usage.dateJST,
                savedTickers: usage.savedTickers,
                accessMode: usage.accessMode,
                credits: nil,
                creditBillingEnabled: usage.creditBillingEnabled,
                chatCreditCost: usage.chatCreditCost,
                capabilities: usage.capabilities
            )
        }

        let normalizedCredits = CreditUsagePayload(
            monthlyRemaining: max(0, min(credits.monthlyLimit, credits.monthlyRemaining)),
            monthlyLimit: max(0, credits.monthlyLimit),
            welcomeRemaining: credits.welcomeRemaining,
            rewardedAdRemaining: credits.rewardedAdRemaining,
            rewardedAdExpiresAt: credits.rewardedAdExpiresAt,
            purchasedRemaining: credits.purchasedRemaining,
            totalRemaining: max(0, min(credits.monthlyLimit, credits.monthlyRemaining))
                + (credits.rewardedAdRemaining ?? 0)
                + (credits.welcomeRemaining ?? 0)
                + credits.purchasedRemaining,
            resetsAt: credits.resetsAt
        )

        guard normalizedChatLimit != usage.chatLimit || normalizedCredits != credits else {
            return usage
        }

        return UsagePayload(
            plan: usage.plan,
            activePlan: usage.activePlan,
            activeSubscription: usage.activeSubscription,
            chatsUsed: usage.chatsUsed,
            chatLimit: normalizedChatLimit,
            stocksUsed: usage.stocksUsed,
            stockLimit: usage.stockLimit,
            dateJST: usage.dateJST,
            savedTickers: usage.savedTickers,
            accessMode: usage.accessMode,
            credits: normalizedCredits,
            creditBillingEnabled: usage.creditBillingEnabled,
            chatCreditCost: usage.chatCreditCost,
            capabilities: usage.capabilities
        )
    }

    private func mergeUsageSavedTickersIfNeeded(_ usage: UsagePayload, source: UsageUpdateSource) -> UsagePayload {
        guard let serverTickers = usage.savedTickers else { return usage }
        guard source == .watchlistAdd || shouldPreserveSavedTickersForBillingRefresh(usage, serverTickers: serverTickers) else {
            return usage
        }

        let mergedTickers = mergedSavedTickersPreservingServerOrder(
            serverTickers: serverTickers,
            existingTickers: savedTickers
        )
        guard mergedTickers != Self.normalizedTickers(serverTickers) || usage.stocksUsed != mergedTickers.count else {
            return usage
        }

        return UsagePayload(
            plan: usage.plan,
            activePlan: usage.activePlan,
            activeSubscription: usage.activeSubscription,
            chatsUsed: usage.chatsUsed,
            chatLimit: usage.chatLimit,
            stocksUsed: mergedTickers.count,
            stockLimit: usage.stockLimit,
            dateJST: usage.dateJST,
            savedTickers: mergedTickers,
            accessMode: usage.accessMode,
            credits: usage.credits,
            creditBillingEnabled: usage.creditBillingEnabled,
            chatCreditCost: usage.chatCreditCost,
            capabilities: usage.capabilities
        )
    }

    private func shouldPreserveSavedTickersForBillingRefresh(_ usage: UsagePayload, serverTickers: [String]) -> Bool {
        guard !savedTickers.isEmpty else { return false }
        guard BillingCatalog.tier(for: usage.plan).plan != BillingCatalog.free.plan else { return false }

        let currentPlan = self.usage?.plan ?? subscriptionStore.plan
        return currentPlan != usage.plan || Self.normalizedTickers(serverTickers).isEmpty
    }

    private func mergedSavedTickersPreservingServerOrder(serverTickers: [String], existingTickers: [String]) -> [String] {
        var mergedTickers = Self.normalizedTickers(serverTickers)
        var seenIssuerKeys = savedIssuerKeys(for: mergedTickers)

        for ticker in Self.normalizedTickers(existingTickers) {
            let issuerKey = issuerGroupKey(for: ticker)
            guard seenIssuerKeys.insert(issuerKey).inserted else { continue }
            mergedTickers.append(ticker)
        }

        return mergedTickers
    }

    private func reconcileSavedTickers(with serverTickers: [String]) {
        let normalizedServerTickers = Self.normalizedTickers(serverTickers)
        let previousSavedTickers = savedTickers
        let removedIssuerKeys = savedIssuerKeys(for: previousSavedTickers)
            .subtracting(savedIssuerKeys(for: normalizedServerTickers))

        savedTickers = normalizedServerTickers
        UserDefaults.standard.set(savedTickers, forKey: Self.savedTickersKey)

        for issuerKey in savedIssuerKeys(for: normalizedServerTickers) {
            for ticker in relatedTickers(forIssuerGroupKey: issuerKey, additionalTickers: normalizedServerTickers) {
                accessRevokedTickers.remove(ticker)
            }
        }

        for issuerKey in removedIssuerKeys {
            for ticker in relatedTickers(forIssuerGroupKey: issuerKey, additionalTickers: previousSavedTickers) {
                guard shouldRevokeLocalAccessWithoutWatchlist(for: ticker) else {
                    accessRevokedTickers.remove(ticker)
                    continue
                }
                revokeLocalAccess(for: ticker)
            }
        }

        loadHomeFromPersistence()
        hydrateMissingWatchlistCompanies(for: normalizedServerTickers)
    }

    private func hydrateMissingWatchlistCompanies(for tickers: [String]) {
        for ticker in tickers {
            guard companyCache[ticker] == nil else { continue }
            guard persistence.loadCompanyCard(ticker: ticker) == nil else { continue }
            guard !loadingTickers.contains(ticker) else { continue }

            Task { [weak self] in
                await self?.fetchCompanyRemote(ticker: ticker, forceRefresh: false)
            }
        }
    }

    private func shouldRevokeLocalAccessWithoutWatchlist(for _: String) -> Bool {
        false
    }

    @discardableResult
    private func clearUnavailableEphemeralSelectionIfNeeded(for ticker: String) -> Bool {
        let normalized = normalizedTicker(ticker)
        guard !isTickerInWatchlist(normalized) else { return false }
        guard !hasLocallyAvailableConversation(ticker: normalized) else { return false }

        var cleared = false

        if activeConversationTicker == normalized {
            activeConversationTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
            cleared = true
        }

        if lastViewedTicker == normalized {
            lastViewedTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
            cleared = true
        }

        if pendingConversationTicker == normalized {
            pendingConversationTicker = nil
            pendingConversationQuestion = nil
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
            cleared = true
        }

        if recentTickers.contains(normalized) {
            recentTickers.removeAll(where: { $0 == normalized })
            UserDefaults.standard.set(recentTickers, forKey: Self.recentTickersKey)
            cleared = true
        }

        if cleared {
            loadHomeFromPersistence()
        }

        return cleared
    }

    private func revokeLocalAccess(for ticker: String) {
        let normalized = normalizedTicker(ticker)
        accessRevokedTickers.insert(normalized)
        companyCache.removeValue(forKey: normalized)
        companyLoadStates.removeValue(forKey: normalized)
        chatHistoryCache.removeValue(forKey: normalized)
        pendingChats.removeValue(forKey: normalized)
        retryableChatOperations.removeValue(forKey: normalized)
        cancelCompanyLoadRetry(for: normalized)
        addingTickers.remove(normalized)
        loadingTickers.remove(normalized)
        refreshedTickersThisSession.remove(normalized)
        recentTickers.removeAll(where: { $0 == normalized })
        UserDefaults.standard.set(recentTickers, forKey: Self.recentTickersKey)
        if lastViewedTicker == normalized {
            lastViewedTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
        }
        if activeConversationTicker == normalized {
            activeConversationTicker = nil
            UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
        }
        if pendingConversationTicker == normalized {
            pendingConversationTicker = nil
            pendingConversationQuestion = nil
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationTickerKey)
            UserDefaults.standard.removeObject(forKey: Self.pendingConversationQuestionKey)
        }
        clearLastSeenFilingKey(for: normalized)
        clearLastOpenedAt(for: normalized)
        try? persistence.removeStock(ticker: normalized)
        companyIsLoading = !loadingTickers.isEmpty
        chatIsSending = !pendingChats.isEmpty
    }

    private func searchScore(for item: SearchItem, query: String) -> Int {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let ticker = item.ticker.lowercased()
        let companyName = item.companyName.lowercased()
        let queryAlias = normalizedClassTickerAlias(query)
        let tickerAlias = normalizedClassTickerAlias(item.ticker)

        if ticker == normalizedQuery {
            return 0
        }

        if let queryAlias, tickerAlias == queryAlias {
            return 1
        }

        if ticker.hasPrefix(normalizedQuery) {
            return 2
        }

        if let queryAlias, let tickerAlias, tickerAlias.hasPrefix(queryAlias) {
            return 3
        }

        if companyName == normalizedQuery {
            return 4
        }

        if companyName.hasPrefix(normalizedQuery) {
            return 5
        }

        if ticker.contains(normalizedQuery) {
            return 6
        }

        if let queryAlias, let tickerAlias, tickerAlias.contains(queryAlias) {
            return 7
        }

        if companyName.contains(normalizedQuery) {
            return 8
        }

        return 9
    }

    private func normalizedClassTickerAlias(_ value: String) -> String? {
        let normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let components = normalized
            .components(separatedBy: CharacterSet(charactersIn: ".- "))
            .filter { !$0.isEmpty }
        guard components.count == 2 else {
            return nil
        }
        guard normalized.rangeOfCharacter(from: CharacterSet(charactersIn: ".- ")) != nil else {
            return nil
        }

        return "\(components[0]).\(components[1])"
    }

    private func loadHomeFromPersistence() {
        watchlist = persistence.loadWatchlistCards(savedTickers: savedTickers)
        recentCompanies = orderedCards(for: recentTickers.filter { !isTickerInWatchlist($0) })
    }

    private func sanitizeRestoredConversationState() {
        if let pendingConversationTicker {
            self.pendingConversationTicker = normalizedTicker(pendingConversationTicker)
        }

        if let lastViewedTicker {
            let normalized = normalizedTicker(lastViewedTicker)
            if shouldRestoreNavigationTicker(ticker: normalized) {
                self.lastViewedTicker = normalized
                UserDefaults.standard.set(normalized, forKey: Self.lastViewedTickerKey)
            } else {
                self.lastViewedTicker = nil
                UserDefaults.standard.removeObject(forKey: Self.lastViewedTickerKey)
            }
        }

        if let activeConversationTicker {
            let normalized = normalizedTicker(activeConversationTicker)
            if shouldRestoreConversationSelection(ticker: normalized) {
                self.activeConversationTicker = normalized
                UserDefaults.standard.set(normalized, forKey: Self.activeConversationTickerKey)
            } else {
                self.activeConversationTicker = nil
                UserDefaults.standard.removeObject(forKey: Self.activeConversationTickerKey)
            }
        }
    }

    private func shouldRestoreConversationSelection(ticker: String) -> Bool {
        shouldPersistConversationSelection(ticker: ticker, draftQuestion: pendingDraftQuestion(for: ticker))
    }

    private func shouldPersistConversationSelection(ticker: String, draftQuestion: String?) -> Bool {
        if shouldRestoreNavigationTicker(ticker: ticker) {
            return true
        }

        return !(draftQuestion?.isEmpty ?? true)
    }

    private func shouldRestoreNavigationTicker(ticker: String) -> Bool {
        hasLocallyAvailableConversation(ticker: ticker)
    }

    private func pendingDraftQuestion(for ticker: String) -> String? {
        guard pendingConversationTicker == ticker else { return nil }
        let trimmed = pendingConversationQuestion?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private func hasLocallyAvailableConversation(ticker: String) -> Bool {
        let normalized = normalizedTicker(ticker)
        guard !isLocalAccessRevoked(for: normalized) else { return false }
        return companyCache[normalized] != nil || persistence.loadCompany(ticker: normalized) != nil
    }

    private func orderedCards(for tickers: [String]) -> [WatchlistCard] {
        let cards = persistence.loadCompanyCards(tickers: tickers)
        let byTicker = Dictionary(uniqueKeysWithValues: cards.map { ($0.ticker, $0) })
        return tickers.compactMap { byTicker[$0] }
    }

    private func lastSeenFilingKeyKey(for ticker: String) -> String {
        "kabuyomi.lastSeenFiling.\(normalizedTicker(ticker))"
    }

    private static func lastOpenedAtKey(for ticker: String) -> String {
        "\(lastOpenedAtKeyPrefix)\(ticker)"
    }

    /// 保存済みの最終閲覧時刻をまとめて読み出す。
    /// 値が無い会社はここに現れず、未読判定側で「既読」として扱われる
    /// (`homeBoardIsUnread`。導入前から保存されている会社にドットを一斉に付けない)。
    private static func loadPersistedLastOpenedAt() -> [String: Date] {
        var result: [String: Date] = [:]
        for (key, value) in UserDefaults.standard.dictionaryRepresentation()
        where key.hasPrefix(lastOpenedAtKeyPrefix) {
            let ticker = String(key.dropFirst(lastOpenedAtKeyPrefix.count))
            guard !ticker.isEmpty,
                  let seconds = (value as? NSNumber)?.doubleValue,
                  seconds > 0 else { continue }
            result[ticker] = Date(timeIntervalSince1970: seconds)
        }
        return result
    }

    /// 会社を開いたことを記録する。未読ドットはこの時刻を基準に消える。
    func markCompanyOpened(ticker: String, at date: Date = Date()) {
        let normalized = normalizedTicker(ticker)
        guard !normalized.isEmpty else { return }
        lastOpenedAt[normalized] = date
        UserDefaults.standard.set(date.timeIntervalSince1970, forKey: Self.lastOpenedAtKey(for: normalized))
    }

    private func clearLastOpenedAt(for ticker: String) {
        let normalized = normalizedTicker(ticker)
        lastOpenedAt.removeValue(forKey: normalized)
        UserDefaults.standard.removeObject(forKey: Self.lastOpenedAtKey(for: normalized))
    }

    private func setLastSeenFilingKey(_ filingKey: String, for ticker: String) {
        UserDefaults.standard.set(filingKey, forKey: lastSeenFilingKeyKey(for: ticker))
    }

    private func clearCompanyNavigationState() {
        let defaults = UserDefaults.standard
        for key in defaults.dictionaryRepresentation().keys {
            if key.hasPrefix("kabuyomi.lastSeenFiling.") || key.hasPrefix(Self.lastOpenedAtKeyPrefix) {
                defaults.removeObject(forKey: key)
            }
        }
        lastOpenedAt = [:]
    }

    private func clearLastSeenFilingKey(for ticker: String) {
        UserDefaults.standard.removeObject(forKey: lastSeenFilingKeyKey(for: ticker))
    }

    private func applyLocalWatchlistAddFallback(savedTicker: String, cik: String?) {
        let normalizedSavedTicker = normalizedTicker(savedTicker)
        let issuerKey = issuerGroupKey(for: normalizedSavedTicker, cikHint: cik)
        savedTickers.removeAll { issuerGroupKey(for: $0) == issuerKey }
        savedTickers.insert(normalizedSavedTicker, at: 0)
        savedTickers = Array(savedTickers.prefix(25))
        UserDefaults.standard.set(savedTickers, forKey: Self.savedTickersKey)

        for ticker in relatedTickers(forIssuerGroupKey: issuerKey, additionalTickers: [normalizedSavedTicker]) {
            accessRevokedTickers.remove(ticker)
        }
    }

    private func applyLocalWatchlistRemovalFallback(for ticker: String) {
        let normalized = normalizedTicker(ticker)
        let issuerKey = issuerGroupKey(for: normalized)
        let previousSavedTickers = savedTickers

        savedTickers.removeAll { issuerGroupKey(for: $0) == issuerKey }
        UserDefaults.standard.set(savedTickers, forKey: Self.savedTickersKey)

        for relatedTicker in relatedTickers(forIssuerGroupKey: issuerKey, additionalTickers: previousSavedTickers + [normalized]) {
            guard shouldRevokeLocalAccessWithoutWatchlist(for: relatedTicker) else {
                accessRevokedTickers.remove(relatedTicker)
                continue
            }
            revokeLocalAccess(for: relatedTicker)
        }
    }

    private func savedIssuerKeys(for tickers: [String]) -> Set<String> {
        Set(tickers.map { issuerGroupKey(for: $0) })
    }

    private func issuerGroupKey(for ticker: String, cikHint: String? = nil) -> String {
        if let cik = resolvedCIK(for: ticker, cikHint: cikHint) {
            return "cik:\(cik)"
        }
        return "ticker:\(normalizedTicker(ticker))"
    }

    private func savedTicker(for ticker: String, cik: String? = nil) -> String? {
        let issuerKey = issuerGroupKey(for: ticker, cikHint: cik)
        return savedTickers.first(where: { issuerGroupKey(for: $0) == issuerKey })
    }

    private func resolvedCIK(for ticker: String, cikHint: String? = nil) -> String? {
        if let cik = normalizedCIK(cikHint) {
            return cik
        }

        let normalized = normalizedTicker(ticker)
        let tickerCIKMap = knownTickerCIKMap()

        if let cik = tickerCIKMap[normalized] {
            return cik
        }

        guard let familyKey = aliasFamilyKey(for: normalized) else { return nil }
        let familyCIKs = Set(
            tickerCIKMap.compactMap { pair in
                aliasFamilyKey(for: pair.key) == familyKey ? pair.value : nil
            }
        )
        guard familyCIKs.count == 1 else { return nil }
        return familyCIKs.first
    }

    private func knownTickerCIKMap() -> [String: String] {
        var result = persistence.loadTickerCIKMap().reduce(into: [String: String]()) { map, pair in
            if let cik = normalizedCIK(pair.value) {
                map[normalizedTicker(pair.key)] = cik
            }
        }

        for company in companyCache.values {
            guard let cik = normalizedCIK(company.cik) else { continue }
            result[normalizedTicker(company.ticker)] = cik
        }

        for state in companyLoadStates.values {
            guard let cik = normalizedCIK(state.cik) else { continue }
            result[normalizedTicker(state.ticker)] = cik
        }

        for item in searchResults {
            guard let cik = normalizedCIK(item.cik) else { continue }
            result[normalizedTicker(item.ticker)] = cik
        }

        return result
    }

    private func relatedTickers(forIssuerGroupKey issuerKey: String, additionalTickers: [String] = []) -> Set<String> {
        var related = Set<String>()

        if issuerKey.hasPrefix("cik:") {
            let cik = String(issuerKey.dropFirst(4))
            related.formUnion(persistence.loadTickers(cik: cik).map(normalizedTicker))

            for company in companyCache.values where normalizedCIK(company.cik) == cik {
                related.insert(normalizedTicker(company.ticker))
            }

            for item in searchResults where normalizedCIK(item.cik) == cik {
                related.insert(normalizedTicker(item.ticker))
            }
        }

        for ticker in additionalTickers where issuerGroupKey(for: ticker) == issuerKey {
            related.insert(normalizedTicker(ticker))
        }

        if issuerKey.hasPrefix("ticker:") {
            related.insert(String(issuerKey.dropFirst(7)))
        }

        return related
    }

    private func aliasFamilyKey(for ticker: String) -> String? {
        let normalized = normalizedTicker(ticker)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let components = normalized
            .components(separatedBy: CharacterSet(charactersIn: ".- "))
            .filter { !$0.isEmpty }

        guard components.count >= 2 else { return nil }
        guard normalized.rangeOfCharacter(from: CharacterSet(charactersIn: ".- ")) != nil else {
            return nil
        }

        return components[0]
    }

    private func isLocalAccessRevoked(for ticker: String) -> Bool {
        let normalized = normalizedTicker(ticker)
        return accessRevokedTickers.contains(normalized)
            && !isTickerInWatchlist(normalized)
            && shouldRevokeLocalAccessWithoutWatchlist(for: normalized)
    }

    /// 初回入口を抜けたことを記録する。`shouldShowConversationEntry` が偽になり、
    /// 次の起動から「ようこそ」は出ない。
    ///
    /// 会社を開いた・保存したときに内部から呼ばれるほか、Phase 6 では
    /// 「ようこそ」を閉じた時点でも呼ぶ(「あとで」でスキップした人にも
    /// 二度と出さない)。並行フラグを足さないための唯一の入口。
    func completeInitialEntry() {
        guard !hasCompletedInitialEntry else { return }
        hasCompletedInitialEntry = true
        UserDefaults.standard.set(true, forKey: Self.hasCompletedInitialEntryKey)
    }

    private func recordAppLaunch() {
        appLaunchCount += 1
        UserDefaults.standard.set(appLaunchCount, forKey: Self.appLaunchCountKey)

        guard hasCompletedInitialEntry,
              !starterCompaniesAutoHidden,
              showStarterCompanies,
              appLaunchCount >= Self.starterCompaniesAutoHideLaunchThreshold else { return }

        starterCompaniesAutoHidden = true
        UserDefaults.standard.set(true, forKey: Self.starterCompaniesAutoHiddenKey)
        setShowStarterCompanies(false)
    }

    private func normalizedTicker(_ ticker: String) -> String {
        ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    private func normalizedCIK(_ cik: String?) -> String? {
        guard let cik else { return nil }
        let normalized = cik.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }

    private static func normalizedTickers(_ tickers: [String]) -> [String] {
        var seen = Set<String>()
        return tickers.compactMap { ticker in
            let normalized = ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard !normalized.isEmpty, seen.insert(normalized).inserted else { return nil }
            return normalized
        }
    }

    private func syncBillingState(showErrors: Bool) async -> BillingSyncResponse? {
        guard isCreditBillingEnabled else { return nil }
        guard requireAuthenticatedMutation(showAlert: showErrors) else { return nil }
        let stateGeneration = self.stateGeneration
        let usageGeneration = usageMutationGeneration

        do {
            guard let request = try await subscriptionStore.syncRequestIfAvailable() else {
                return nil
            }
            lastBillingSyncStatus = "syncing \(apiClient.subscriptionSyncEndpointDisplayString)"
            let response = try await apiClient.syncBilling(request)
            guard stateGeneration == self.stateGeneration else {
                return nil
            }
            subscriptionStore.apply(response)
            lastBillingSyncStatus = "succeeded \(apiClient.subscriptionSyncEndpointDisplayString)"
            lastBillingSyncAt = Date()
            if usageGeneration == usageMutationGeneration, let usage = response.usage {
                storeUsage(usage, source: .refresh)
                lastUsageRefreshAt = Date()
            }
            return response
        } catch {
            recordBillingFailure(error, endpoint: apiClient.subscriptionSyncEndpointDisplayString)
            if showErrors {
                handle(error)
            }
            return nil
        }
    }

    private func recordBillingFailure(_ error: Error, endpoint: String) {
        if let apiError = error as? APIError {
            switch apiError {
            case .routeMissing(let statusCode, let path, _, _):
                lastBillingSyncStatus = "route_missing HTTP \(statusCode) \(path)"
            case .serverStatus(let statusCode, let message):
                lastBillingSyncStatus = "failed HTTP \(statusCode) \(endpoint): \(message)"
            default:
                lastBillingSyncStatus = "failed \(endpoint): \(rawMessage(for: error))"
            }
        } else {
            lastBillingSyncStatus = "failed \(endpoint): \(rawMessage(for: error))"
        }
        lastBillingSyncAt = Date()
    }

    var isUsageSynchronizing: Bool {
        usage == nil && usageLoadState == .loading
    }

    var isUsageRefreshing: Bool {
        usageLoadState == .loading
    }
}
