import AuthenticationServices
import SwiftUI

private enum RewardedCreditReviewUI {
    static func isVisible(capability: RewardedCreditCapabilityPayload?) -> Bool {
        guard AdMobConfig.hasRewardedCreditAdConfig else { return false }

        #if DEBUG
        // Keep the released feature discoverable in test builds even while
        // identity/usage bootstrap is recovering. The action itself still
        // enforces SSV and server capability checks before granting credits.
        guard let capability else { return true }
        return capability.enabled
            && capability.rewardedCreditEnabled
            && !capability.emergencyDisabled
        #else
        guard let capability else { return false }
        return capability.enabled
            && capability.rewardedCreditEnabled
            && capability.ssvReady
            && !capability.emergencyDisabled
            && capability.environment == "production"
            && AdMobConfig.rewardedAdRuntimeMode.allowsProductionRewardIntent
        #endif
    }
}

enum ConsumableCreditReviewUI {
    static func canPurchase(
        creditBillingEnabled: Bool?,
        consumablePurchasesEnabled: Bool?,
        accountRecoveryReady: Bool?,
        isAccountSignedIn: Bool,
        authenticatedCreditActionsAvailable: Bool
    ) -> Bool {
        creditBillingEnabled == true
            && consumablePurchasesEnabled == true
            && authenticatedCreditActionsAvailable
            && (accountRecoveryReady != true || isAccountSignedIn)
    }
}

enum CreditInitialSheet {
    case plans
    case insufficientCredits(requiredCredits: Int)
}

struct CreditView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var activeSheet: CreditSheet?
    @State private var recoveryRequiredCredits: Int?
    @State private var requestsPlanSheetAfterUsageRefresh: Bool
    let showsDismissButton: Bool

    init(initialSheet: CreditInitialSheet? = nil, showsDismissButton: Bool = true) {
        self.showsDismissButton = showsDismissButton
        _activeSheet = State(initialValue: {
            switch initialSheet {
            case .plans:
                return nil
            case .insufficientCredits:
                return nil
            case nil:
                return nil
            }
        }())
        _recoveryRequiredCredits = State(initialValue: {
            switch initialSheet {
            case .insufficientCredits(let requiredCredits):
                return requiredCredits
            case .plans, nil:
                return nil
            }
        }())
        _requestsPlanSheetAfterUsageRefresh = State(initialValue: {
            if case .plans = initialSheet { return true }
            return false
        }())
    }

    var body: some View {
        ZStack {
            KabuyomiTheme.background
                .ignoresSafeArea()
                .allowsHitTesting(false)

            VStack(spacing: 0) {
                header

                ScrollView {
                    VStack(spacing: 16) {
                        if let recoveryRequiredCredits {
                            insufficientCreditRecoveryCard(requiredCredits: recoveryRequiredCredits)
                        }
                        balanceCard
                        if let billingAvailabilityMessage {
                            billingAvailabilityCard(message: billingAvailabilityMessage)
                        }
                        if shouldShowPaidCreditAccountRecovery {
                            paidCreditAccountCard
                        }
                        addCreditsCard
                        purchaseManagementCard
                        if shouldShowRewardedCreditUI {
                            rewardCard
                        }
                    }
                    .padding(20)
                    .padding(.top, 2)
                    .padding(.bottom, 28)
                }
                .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            }
        }
        .onAppear {
            if shouldShowRewardedCreditUI {
                appModel.logRewardedAdSettingsViewed()
            }
        }
        .task {
            if requestsPlanSheetAfterUsageRefresh {
                activeSheet = .plans
                requestsPlanSheetAfterUsageRefresh = false
            }
            await appModel.refreshCreditUsage()
            async let subscriptionProducts: Void = appModel.loadSubscriptionProducts(showErrors: false)
            async let creditPackProducts: Void = appModel.loadCreditPackProducts(showErrors: false)
            _ = await (subscriptionProducts, creditPackProducts)
        }
        .onChange(of: appModel.isCreditBillingEnabled) { _, isEnabled in
            if isEnabled {
                Task {
                    await appModel.loadSubscriptionProducts(showErrors: false)
                }
            }
        }
        .onChange(of: appModel.isConsumableCreditPurchasingEnabled) { _, isEnabled in
            if isEnabled {
                Task {
                    await appModel.loadCreditPackProducts(showErrors: false)
                }
            }
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .plans:
                planComparisonSheet
            case .morePacks:
                morePacksSheet
            case .accountStatus:
                accountStatusSheet
            case .creditRules:
                creditRulesSheet
            }
        }
        .navigationTitle(showsDismissButton ? "" : "クレジット")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
    }

    @ViewBuilder
    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                if showsDismissButton {
                    Text("クレジット")
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                } else {
                    Text("残高と購入")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                }

                Spacer(minLength: 8)

                if showsDismissButton {
                    Button {
                        closeCredits()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.accentDeep)
                            .frame(width: 44, height: 44)
                            .kabuyomiCard(.secondary, radius: 16)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("クレジット画面を閉じる")
                }
            }

            Text("残高、月額プラン、追加購入をひとつの画面で確認")
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 20)
        .padding(.top, showsDismissButton ? 20 : 12)
        .padding(.bottom, 14)
    }

    private func closeCredits() {
        appModel.markRewardedAdCreditsClosedByUser()
        appModel.dismissInsufficientCreditRecovery()
        dismiss()
    }

    private var balanceCard: some View {
        card {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("残高")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("サーバーで確認した利用可能残高")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }

                    Spacer()

                    Button {
                        Task {
                            await appModel.refreshCreditUsage()
                        }
                    } label: {
                        if appModel.isUsageRefreshing {
                            ProgressView()
                                .controlSize(.small)
                                .frame(width: 16, height: 16)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 15, weight: .bold))
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(9)
                    .background(Circle().fill(KabuyomiTheme.fill(for: .secondary)))
                    .disabled(appModel.isUsageRefreshing)
                    .accessibilityLabel("クレジット残高を更新")
                }

                if let credits = appModel.usage?.credits {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(credits.totalRemaining)")
                            .font(.system(size: 46, weight: .bold, design: .rounded))
                            .foregroundStyle(KabuyomiTheme.ink)
                            .monospacedDigit()
                            .accessibilityLabel("合計 \(credits.totalRemaining) クレジット")

                        HStack(spacing: 8) {
                            BadgeText(currentPlanDisplayTitle)
                            if let renewal = nextRenewalText {
                                Text(renewal)
                                    .font(.system(.caption, design: .rounded, weight: .semibold))
                                    .foregroundStyle(KabuyomiTheme.inkMuted)
                            }
                        }

                        if let lastSync = lastUsageRefreshText {
                            Text(lastSync)
                                .font(.system(.caption, design: .rounded, weight: .semibold))
                                .foregroundStyle(KabuyomiTheme.inkMuted)
                        }

                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 112), spacing: 8)],
                            alignment: .leading,
                            spacing: 8
                        ) {
                            CreditBreakdownTile(title: "月額分", value: "\(credits.monthlyRemaining) / \(credits.monthlyLimit)")
                            CreditBreakdownTile(title: "ウェルカム", value: credits.welcomeRemaining.map(String.init) ?? "—")
                            CreditBreakdownTile(title: "広告分", value: credits.rewardedAdRemaining.map(String.init) ?? "—")
                            CreditBreakdownTile(title: "購入分", value: "\(credits.purchasedRemaining)")
                        }
                        .padding(.top, 4)
                    }
                } else if appModel.isUsageSynchronizing {
                    Text("クレジット残高を同期中です。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                } else {
                    Text("クレジット残高は次回の利用状況同期で表示されます。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Divider()
                    .overlay(KabuyomiTheme.inkMuted.opacity(0.18))

                HStack(alignment: .center, spacing: 12) {
                    currentPlanSummary
                    Spacer()
                    planComparisonButton
                }
            }
        }
    }

    private var currentPlanSummary: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("現在のプラン")
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
            Text(activeSubscriptionSummary ?? "Free / 月次0 / 認証済み初回50クレジット")
                .font(.footnote)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var planComparisonButton: some View {
        Button {
            activeSheet = .plans
        } label: {
            HStack(spacing: 8) {
                Text("月額プランを比較")
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
            }
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(KabuyomiTheme.fill(for: .secondary)))
        }
        .buttonStyle(.plain)
    }

    private var planComparisonSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    PlanSheetHeader()

                    ForEach(appModel.subscriptionProducts) { product in
                        SubscriptionPlanRow(
                            product: product,
                            loadState: appModel.subscriptionProductLoadState,
                            isCurrent: isCurrentSubscription(product),
                            isPurchasing: appModel.billingActionInFlight,
                            isPurchaseEnabled: billingActionsCanRun,
                            disabledActionTitle: subscriptionDisabledActionTitle,
                            purchase: { productId in
                                Task {
                                    await appModel.purchaseSubscription(productId: productId)
                                }
                            }
                        )
                    }

                    SubscriptionLegalLinks()

                    Button {
                        Task {
                            await appModel.restorePurchases()
                        }
                    } label: {
                        Label("購入を復元 / 同期", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AccountStatusActionButtonStyle())
                    .disabled(appModel.billingActionInFlight || !billingActionsCanRun)
                    .opacity(billingActionsCanRun ? 1 : 0.62)
                }
                .padding(20)
                .padding(.bottom, 28)

                if appModel.subscriptionProductLoadState == .loading {
                    Label("プラン情報を確認中です。", systemImage: "arrow.triangle.2.circlepath")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                } else if let message = appModel.subscriptionProductLoadErrorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.negative)
                        Button("再読み込み") {
                            Task {
                                await appModel.loadSubscriptionProducts(showErrors: true)
                            }
                        }
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    }
                }
            }
            .background(KabuyomiTheme.background.ignoresSafeArea())
            .navigationTitle("月額プラン")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") {
                        activeSheet = nil
                    }
                }
            }
        }
    }

    private var addCreditsCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("追加クレジット")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("月額分とは別に、必要な時だけ買い切りで追加できます。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                    Spacer()
                }

                if let primaryCreditPackProduct {
                    CreditPackRow(
                        product: primaryCreditPackProduct,
                        loadState: appModel.creditPackProductLoadState,
                        chatCreditCost: appModel.chatCreditCost,
                        isPrimary: true,
                        isPurchasing: appModel.billingActionInFlight,
                        isPurchaseEnabled: consumablePurchaseActionsCanRun,
                        disabledActionTitle: consumableDisabledActionTitle,
                        purchase: { productId in
                            Task {
                                await appModel.purchaseCreditPack(productId: productId)
                            }
                        }
                    )
                }

                if !secondaryCreditPackProducts.isEmpty {
                    Button {
                        activeSheet = .morePacks
                    } label: {
                        HStack {
                            Text("その他のパック")
                            Spacer()
                            Image(systemName: "chevron.right")
                        }
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(KabuyomiTheme.fill(for: .muted).opacity(0.72))
                        )
                    }
                    .buttonStyle(.plain)
                }

                if visibleCreditPackProducts.allSatisfy({ !$0.isAvailable }),
                   let message = appModel.creditPackProductLoadErrorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.negative)
                        Button("再読み込み") {
                            Task {
                                await appModel.loadCreditPackProducts(showErrors: true)
                            }
                        }
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    }
                }
            }
        }
    }

    private var paidCreditAccountCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    Label("購入クレジットの復元", systemImage: "person.crop.circle.badge.checkmark")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("Sign in with Appleは購入クレジットの復元と新規購入にだけ使います。SEC資料の閲覧や質問にアカウント作成は不要です。接続すると、端末を変更・紛失した場合も購入済みクレジットを復元できます。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if appModel.isPaidCreditAccountSignedIn {
                    Label("復元用アカウントに接続済み", systemImage: "checkmark.seal.fill")
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.positive)

                    Button("この端末でサインアウト") {
                        Task {
                            await appModel.signOutPaidCreditAccount()
                        }
                    }
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .disabled(appModel.billingActionInFlight)
                } else {
                    SignInWithAppleButton(.continue) { request in
                        request.requestedScopes = []
                    } onCompletion: { result in
                        switch result {
                        case .success(let authorization):
                            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                                  let tokenData = credential.identityToken,
                                  let identityToken = String(data: tokenData, encoding: .utf8) else {
                                appModel.activeAlert = AppAlertState(
                                    message: "Appleの本人確認情報を取得できませんでした。もう一度お試しください。",
                                    kind: .dismissOnly
                                )
                                return
                            }
                            Task {
                                await appModel.completeAppleAccountSignIn(identityToken: identityToken)
                            }
                        case .failure(let error):
                            if (error as? ASAuthorizationError)?.code != .canceled {
                                appModel.activeAlert = AppAlertState(
                                    message: "Appleアカウントで続行できませんでした。時間をおいてもう一度お試しください。",
                                    kind: .dismissOnly
                                )
                            }
                        }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 50)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    Text("追加クレジットの購入は、復元用アカウントへの接続後に利用できます。")
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
        }
    }

    private func insufficientCreditRecoveryCard(requiredCredits: Int) -> some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("クレジットが不足しています")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(recoveryBodyText(requiredCredits: requiredCredits))
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if appModel.hasRecoveredEnoughCreditsForPendingRecovery {
                    Label("送信できます。元の画面で質問をもう一度送信してください。", systemImage: "checkmark.circle.fill")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.positive)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(KabuyomiTheme.positive.opacity(0.1))
                        )
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("続ける方法")
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)

                    if shouldShowRewardedCreditUI {
                        VStack(alignment: .leading, spacing: 6) {
                            RewardedAdCreditButton(
                                state: appModel.rewardedAdCreditState,
                                message: appModel.rewardedAdStatusMessage,
                                earn: {
                                    appModel.prepareRewardedAdReturnDestination(
                                        .credits,
                                        visibleSurface: "insufficient_credit_recovery"
                                    )
                                    appModel.logRewardedAdButtonTapped()
                                    Task {
                                        await appModel.earnRewardedAdCredits()
                                    }
                                }
                            )
                            Text("任意の広告を見て、無料クレジットを2つ獲得")
                                .font(.caption)
                                .foregroundStyle(KabuyomiTheme.inkMuted)
                        }
                    }

                    if let primaryCreditPackProduct {
                        recoveryActionButton(
                            title: "50 creditsを購入",
                            systemImage: "plus.circle.fill",
                            isLoading: appModel.billingActionInFlight || appModel.creditPackProductLoadInFlight,
                            isDisabled: appModel.billingActionInFlight
                                || !consumablePurchaseActionsCanRun
                                || !primaryCreditPackProduct.isAvailable
                        ) {
                            Task {
                                await appModel.purchaseCreditPack(productId: primaryCreditPackProduct.id)
                            }
                        }
                    }

                    recoveryActionButton(
                        title: "サブスクを見る",
                        systemImage: "crown.fill",
                        isLoading: appModel.subscriptionProductLoadState == .loading,
                        isDisabled: false
                    ) {
                        activeSheet = .plans
                    }

                    recoveryActionButton(
                        title: "購入を復元",
                        systemImage: "arrow.triangle.2.circlepath",
                        isLoading: appModel.billingActionInFlight,
                        isDisabled: appModel.billingActionInFlight || !billingActionsCanRun
                    ) {
                        Task {
                            await appModel.restorePurchases()
                        }
                    }
                }
            }
        }
    }

    private var morePacksSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(secondaryCreditPackProducts) { product in
                        CreditPackRow(
                            product: product,
                            loadState: appModel.creditPackProductLoadState,
                            chatCreditCost: appModel.chatCreditCost,
                            isPrimary: product.id == SubscriptionStore.primaryCreditProductID,
                            isPurchasing: appModel.billingActionInFlight,
                            isPurchaseEnabled: consumablePurchaseActionsCanRun,
                            disabledActionTitle: consumableDisabledActionTitle,
                            purchase: { productId in
                                Task {
                                    await appModel.purchaseCreditPack(productId: productId)
                                }
                            }
                        )
                    }
                }
                .padding(20)
                .padding(.bottom, 28)
            }
            .background(KabuyomiTheme.background.ignoresSafeArea())
            .navigationTitle("その他のパック")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") {
                        activeSheet = nil
                    }
                }
            }
        }
    }

    private var purchaseManagementCard: some View {
        card {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("管理")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("購入同期、利用状況、クレジットの扱いを確認できます。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                ManagementButton(
                    title: "購入を復元 / 同期",
                    subtitle: "App Storeの権利情報をサーバーへ同期",
                    systemImage: "arrow.triangle.2.circlepath",
                    isLoading: appModel.billingActionInFlight,
                    isEnabled: billingActionsCanRun
                ) {
                    Task {
                        await appModel.restorePurchases()
                    }
                }
                ManagementButton(title: "利用状況", subtitle: "残高、次回更新、同期状態を表示", systemImage: "person.text.rectangle", isLoading: false) {
                    activeSheet = .accountStatus
                }
                ManagementButton(title: "クレジットのルール", subtitle: "月額分、ウェルカム、広告分、購入分の違い", systemImage: "info.circle", isLoading: false) {
                    activeSheet = .creditRules
                }
            }
        }
    }

    private var rewardCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("広告報酬（任意）")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text("任意で広告を最後まで見ると、サーバー確認後に無料/ad creditを2クレジット獲得できます。1日3回まで、獲得から30日間有効です。広告を見なくてもpaid creditはそのまま使えます。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                RewardedAdCreditButton(
                    state: appModel.rewardedAdCreditState,
                    message: appModel.rewardedAdStatusMessage,
                    earn: {
                        appModel.prepareRewardedAdReturnDestination(.credits, visibleSurface: "credits")
                        appModel.logRewardedAdButtonTapped()
                        Task {
                            await appModel.earnRewardedAdCredits()
                        }
                    }
                )
            }
        }
    }

    private var visibleCreditPackProducts: [CreditPackProduct] {
        CreditPackPresentation.visibleProducts(from: appModel.creditPackProducts)
    }

    private var primaryCreditPackProduct: CreditPackProduct? {
        CreditPackPresentation.primaryProduct(from: visibleCreditPackProducts)
    }

    private var secondaryCreditPackProducts: [CreditPackProduct] {
        CreditPackPresentation.secondaryProducts(from: visibleCreditPackProducts)
    }

    private var currentPlanDisplayTitle: String {
        let label = appModel.currentPlanBadgeTitle
        return label == "FREE" ? "無料" : label
    }

    private var activeSubscriptionSummary: String? {
        guard let subscription = appModel.usage?.activeSubscription else {
            return nil
        }

        let planTitle = BillingCatalog.tier(for: subscription.plan).title
        let credits = subscription.monthlyCredits ?? BillingCatalog.tier(for: subscription.plan).monthlyCredits
        let dateText = formattedOptionalDate(subscription.periodEnd ?? subscription.expiresAt)
        if let dateText {
            return "\(planTitle) / \(credits)クレジット / 月 / 次回: \(dateText)"
        }
        return "\(planTitle) / \(credits)クレジット / 月"
    }

    private var nextRenewalText: String? {
        if let subscription = appModel.usage?.activeSubscription,
           let date = formattedOptionalDate(subscription.periodEnd ?? subscription.expiresAt) {
            return "次回更新/期限: \(date)"
        }
        return nil
    }

    private var lastUsageRefreshText: String? {
        guard let date = appModel.lastUsageRefreshAt else { return nil }
        return "最終同期: \(formattedShortDateTime(date))"
    }

    private func isCurrentSubscription(_ product: SubscriptionProduct) -> Bool {
        guard let productID = product.tier.productID else { return false }
        return appModel.usage?.activeSubscription?.productId == productID
            || appModel.usage?.activePlan == product.tier.plan
    }

    private var accountStatusSheet: some View {
        let viewModel = AccountStatusDisplayModel(
            apiEnvironment: appModel.currentAPIBaseURLKindDisplay,
            apiBaseURL: appModel.currentAPIBaseURLDisplay,
            appVersion: appModel.currentAppVersionDisplay,
            deviceKeySuffix: appModel.currentDeviceKeySuffixDisplay,
            usage: appModel.usage,
            lastUsageRefreshAt: appModel.lastUsageRefreshAt,
            lastBillingSyncStatus: appModel.lastBillingSyncStatus,
            lastBillingSyncAt: appModel.lastBillingSyncAt,
            healthReport: appModel.billingAPIHealthReport
        )

        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("利用状況")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        ForEach(viewModel.normalRows) { row in
                            CreditMetricRow(title: row.title, value: row.value)
                        }
                    }

                    #if DEBUG
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(viewModel.debugRows) { row in
                                CreditMetricRow(title: row.title, value: row.value)
                            }

                            if let health = appModel.billingAPIHealthReport {
                                Text("接続診断")
                                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                                    .foregroundStyle(KabuyomiTheme.ink)
                                    .padding(.top, 4)
                                ForEach(health.entries) { entry in
                                    CreditMetricRow(title: entry.label, value: AccountStatusDisplayModel.connectionStatus(for: entry))
                                }
                            }
                        }
                    } label: {
                        Text("開発用診断")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                    }
                    #endif

                    Button {
                        Task {
                            await appModel.restorePurchases()
                        }
                    } label: {
                        Text("購入を復元 / 同期")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AccountStatusActionButtonStyle())
                    .disabled(appModel.billingActionInFlight || !billingActionsCanRun)
                    .opacity(billingActionsCanRun ? 1 : 0.62)

                    #if DEBUG
                    Button {
                        Task {
                            await appModel.checkBillingAPIHealth()
                        }
                    } label: {
                        if appModel.billingAPIHealthCheckInFlight {
                            ProgressView()
                                .controlSize(.small)
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("接続状態を確認")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(AccountStatusActionButtonStyle())
                    .disabled(appModel.billingAPIHealthCheckInFlight)
                    #endif
                }
                .padding(20)
                .padding(.bottom, 28)
            }
            .background(KabuyomiTheme.background.ignoresSafeArea())
            .navigationTitle("利用状況")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") {
                        activeSheet = nil
                    }
                }
            }
        }
    }

    private var creditRulesSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    RuleText(title: "月額プラン分クレジット", body: "Freeの月次付与は0です。Lite / Pro / Max はApp Storeの月額自動更新プランで、サーバー同期後にプランごとの月額クレジットが反映されます。")
                    RuleText(title: "ウェルカムクレジット", body: "App Attestで確認できたinstallationには、50クレジットを一度だけ付与します。月ごとに繰り返す無料付与ではありません。")
                    RuleText(title: "購入分クレジット", body: "買い切りのクレジットはApple検証とサーバー確認後にだけ付与されます。現在のサーバー会計では失効しません。")
                    if shouldShowRewardedCreditUI {
                        RuleText(title: "広告クレジット", body: "広告報酬クレジットは任意の無料/ad creditです。アプリ内の広告完了だけでは付与せず、サーバー側でGoogle AdMobの確認が完了した場合だけ反映されます。1日3回まで、獲得から30日間有効です。")
                    }
                    RuleText(title: "復元", body: "購入の復元はStoreKitの権利情報を読み取り、サーバーに同期します。アプリ内ではクレジットを直接付与しません。")
                }
                .padding(20)
                .padding(.bottom, 28)
            }
            .background(KabuyomiTheme.background.ignoresSafeArea())
            .navigationTitle("クレジットのルール")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") {
                        activeSheet = nil
                    }
                }
            }
        }
    }

    private var shouldShowRewardedCreditUI: Bool {
        RewardedCreditReviewUI.isVisible(capability: appModel.usage?.capabilities?.rewardedCredit)
    }

    private var billingActionsCanRun: Bool {
        appModel.isCreditBillingEnabled
            && appModel.authenticatedCreditActionsAvailable
    }

    private var consumablePurchaseActionsCanRun: Bool {
        ConsumableCreditReviewUI.canPurchase(
            creditBillingEnabled: appModel.usage?.creditBillingEnabled,
            consumablePurchasesEnabled: appModel.usage?.capabilities?.consumablePurchasesEnabled,
            accountRecoveryReady: appModel.usage?.capabilities?.accountRecoveryReady,
            isAccountSignedIn: appModel.isPaidCreditAccountSignedIn,
            authenticatedCreditActionsAvailable: appModel.authenticatedCreditActionsAvailable
        )
    }

    private var shouldShowPaidCreditAccountRecovery: Bool {
        appModel.usage?.capabilities?.accountRecoveryReady == true
    }

    private var billingAvailabilityMessage: String? {
        guard appModel.usage != nil else {
            return "購入機能の接続状態を確認中です。月額プランと追加購入は、この画面に表示したまま同期します。"
        }
        guard appModel.isCreditBillingEnabled else {
            return "価格とプランは確認できますが、購入サーバーが現在利用できないため、月額プラン・追加購入・購入復元の操作を停止しています。"
        }
        guard appModel.authenticatedCreditActionsAvailable else {
            return "端末認証を確認できないため購入操作を停止しています。購入メニューと価格はそのまま確認できます。"
        }
        guard appModel.isConsumableCreditPurchasingEnabled else {
            return "追加クレジットの購入は現在利用できません。月額プランと購入復元は利用できます。"
        }
        if appModel.requiresPaidCreditAccount && !appModel.isPaidCreditAccountSignedIn {
            return "追加クレジットを端末変更後も復元できるよう、先にAppleアカウントで続けてください。月額プランはそのまま利用できます。"
        }
        return nil
    }

    private var billingAvailabilityTitle: String {
        guard appModel.usage != nil else { return "購入機能を確認中" }
        guard appModel.isCreditBillingEnabled else { return "現在購入できません" }
        guard appModel.authenticatedCreditActionsAvailable else { return "端末認証が必要です" }
        guard appModel.isConsumableCreditPurchasingEnabled else { return "追加購入は現在利用できません" }
        return "Appleアカウントが必要です"
    }

    private var billingAvailabilityIcon: String {
        appModel.usage == nil
            ? "arrow.triangle.2.circlepath.circle.fill"
            : "exclamationmark.circle.fill"
    }

    private var subscriptionDisabledActionTitle: String {
        guard appModel.usage != nil else { return "接続確認中" }
        guard appModel.isCreditBillingEnabled else { return "現在購入できません" }
        guard appModel.authenticatedCreditActionsAvailable else { return "端末認証が必要" }
        return "現在購入できません"
    }

    private var consumableDisabledActionTitle: String {
        guard appModel.usage != nil else { return "接続確認中" }
        guard appModel.isCreditBillingEnabled else { return "現在購入できません" }
        guard appModel.authenticatedCreditActionsAvailable else { return "端末認証が必要" }
        guard appModel.isConsumableCreditPurchasingEnabled else { return "現在購入できません" }
        if appModel.requiresPaidCreditAccount && !appModel.isPaidCreditAccountSignedIn {
            return "Appleで続けてください"
        }
        return "現在購入できません"
    }

    private func billingAvailabilityCard(message: String) -> some View {
        card {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: billingAvailabilityIcon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 5) {
                    Text(billingAvailabilityTitle)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .kabuyomiCard(.primary, radius: 16)
    }

    private func recoveryBodyText(requiredCredits: Int) -> String {
        let currentCredits = appModel.creditUsage?.totalRemaining ?? appModel.insufficientCreditRecovery?.remainingCredits ?? 0
        if appModel.hasRecoveredEnoughCreditsForPendingRecovery {
            return "現在の残高は \(currentCredits)クレジットです。この質問には \(requiredCredits)クレジットが必要です。"
        }
        return "この質問には\(requiredCredits)クレジットが必要です。追加購入または月額プランで続けられます。"
    }

    private func recoveryActionButton(
        title: String,
        systemImage: String,
        isLoading: Bool,
        isDisabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 16, height: 16)
                } else {
                    Image(systemName: systemImage)
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 18)
                }
                Text(title)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .foregroundStyle(isDisabled ? KabuyomiTheme.inkMuted : KabuyomiTheme.ink)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(KabuyomiTheme.fill(for: .muted))
            )
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.72 : 1)
    }

    private func formattedResetDate(_ rawValue: String) -> String {
        formattedOptionalDate(rawValue) ?? rawValue
    }

    private func formattedOptionalDate(_ rawValue: String?) -> String? {
        guard let rawValue else { return nil }
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]

        guard let date = isoFormatter.date(from: rawValue) else {
            return rawValue
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = TimeZone(identifier: "Asia/Tokyo")
        formatter.setLocalizedDateFormatFromTemplate("M月d日")
        return formatter.string(from: date)
    }

    private func formattedShortDateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = TimeZone(identifier: "Asia/Tokyo")
        formatter.dateFormat = "MM/dd HH:mm"
        return formatter.string(from: date)
    }
}

private struct PlanSheetHeader: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("月額プランを選ぶ")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text("月額プランは自動更新です。購入後の管理・解約は App Store のアカウント設定から行えます。クレジットはサーバー同期後に反映されます。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    CreditFeaturePill(text: "毎月自動補充")
                    CreditFeaturePill(text: "いつでも解約")
                    CreditFeaturePill(text: "復元対応")
                }

                VStack(spacing: 8) {
                    CreditFeaturePill(text: "毎月自動補充")
                    CreditFeaturePill(text: "いつでも解約")
                    CreditFeaturePill(text: "復元対応")
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(KabuyomiTheme.fill(for: .secondary))
        )
    }
}

private struct SubscriptionPlanRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let product: SubscriptionProduct
    let loadState: SubscriptionProductLoadState
    let isCurrent: Bool
    let isPurchasing: Bool
    let isPurchaseEnabled: Bool
    let disabledActionTitle: String
    let purchase: (String) -> Void

    private var displayPrice: String {
        StoreProductPresentation.priceText(
            displayPrice: product.displayPrice,
            loadState: loadState
        )
    }

    private var isRecommended: Bool {
        product.tier.plan == BillingCatalog.pro.plan
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    planSummary
                    purchaseButton
                }
            } else {
                HStack(alignment: .center, spacing: 12) {
                    planSummary
                    Spacer()
                    purchaseButton
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(KabuyomiTheme.fill(for: isCurrent ? .secondary : .muted))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke((isCurrent || isRecommended) ? KabuyomiTheme.accentDeep.opacity(0.26) : KabuyomiTheme.stroke(for: .muted), lineWidth: 1)
        )
    }

    private var planSummary: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(product.tier.title)
                    .font(.system(.body, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                if isCurrent {
                    PlanBadge(text: "利用中")
                } else if isRecommended {
                    PlanBadge(text: "おすすめ")
                }
            }
            Text("\(product.tier.monthlyCredits)クレジット / 月")
                .font(.footnote)
                .foregroundStyle(KabuyomiTheme.inkMuted)
            Text(limitSummary)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
            Text(useCaseText)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var purchaseButton: some View {
        Button {
            purchase(product.id)
        } label: {
            VStack(alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing, spacing: 5) {
                Text(displayPrice)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                Text(planActionTitle)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(product.isAvailable && isPurchaseEnabled ? KabuyomiTheme.inkMuted : KabuyomiTheme.negative)
            }
            .frame(minWidth: 96, minHeight: 44, alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
        }
        .buttonStyle(.plain)
        .disabled(isPurchasing || !product.isAvailable || !isPurchaseEnabled || isCurrent)
    }

    private var planActionTitle: String {
        if isCurrent { return "現在のプラン" }
        if !product.isAvailable {
            return StoreProductPresentation.unavailableActionTitle(loadState: loadState)
        }
        if !isPurchaseEnabled { return disabledActionTitle }
        return "変更 / 購読"
    }

    private var limitSummary: String {
        let approximateQuestions = product.tier.monthlyCredits / 2
        return "通常質問 約\(approximateQuestions)回/月 / 保存 \(product.tier.stockLimit)銘柄 / 1日上限 \(product.tier.chatLimit)回"
    }

    private var useCaseText: String {
        switch product.tier.plan {
        case BillingCatalog.lite.plan:
            return "少数銘柄を定期的に読む人向け"
        case BillingCatalog.pro.plan:
            return "複数銘柄を日常的に質問する人向け"
        case BillingCatalog.proMax.plan:
            return "深掘り質問や比較を多めに使う人向け"
        default:
            return "月額クレジットを追加できます"
        }
    }
}

private struct SubscriptionLegalLinks: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                Text("購入前に確認")
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
            }

            Text("価格、更新条件、請求、返金、解約は App Store の購入画面とアカウント設定に従います。")
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 8) {
                if let privacyURL = LegalSiteConfig.privacyURL {
                    LegalLink(title: "Privacy Policy", subtitle: "データの扱い", url: privacyURL)
                }
                if let termsURL = LegalSiteConfig.termsURL {
                    LegalLink(title: "Terms of Use", subtitle: "利用条件", url: termsURL)
                }
                LegalLink(title: "Apple Standard EULA", subtitle: "標準使用許諾契約", url: LegalSiteConfig.appleStandardEULAURL)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(KabuyomiTheme.fill(for: .muted))
        )
    }
}

private struct LegalLink: View {
    let title: String
    let subtitle: String
    let url: URL

    var body: some View {
        Link(destination: url) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.up.right.square")
                    .font(.caption)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(.footnote, design: .rounded, weight: .semibold))
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(KabuyomiTheme.paper.opacity(0.55))
            )
            .contentShape(Rectangle())
        }
    }
}

private struct CreditPackRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let product: CreditPackProduct
    let loadState: SubscriptionProductLoadState
    let chatCreditCost: Int
    let isPrimary: Bool
    let isPurchasing: Bool
    let isPurchaseEnabled: Bool
    let disabledActionTitle: String
    let purchase: (String) -> Void

    private var displayPrice: String {
        StoreProductPresentation.priceText(
            displayPrice: product.displayPrice,
            loadState: loadState
        )
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    packSummary
                    purchaseButton
                }
            } else {
                HStack(alignment: .center, spacing: 12) {
                    packSummary
                    Spacer()
                    purchaseButton
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(KabuyomiTheme.fill(for: .muted))
        )
    }

    private var packSummary: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(product.credits == 50 ? "ミニパック" : "\(product.credits)クレジット")
                    .font(.system(.body, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                if isPrimary {
                    Text("主要")
                        .font(.system(.caption2, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
                }
            }
            Text("\(product.credits)クレジット / 通常質問 約\(product.credits / chatCreditCost)回分")
                .font(.footnote)
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    private var purchaseButton: some View {
        Button {
            purchase(product.id)
        } label: {
            VStack(alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing, spacing: 5) {
                Text(displayPrice)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                Text(packActionTitle)
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(product.isAvailable && isPurchaseEnabled ? KabuyomiTheme.paper : KabuyomiTheme.negative)
                    .padding(.horizontal, product.isAvailable && isPurchaseEnabled ? 10 : 0)
                    .padding(.vertical, product.isAvailable && isPurchaseEnabled ? 6 : 0)
                    .background {
                        if product.isAvailable && isPurchaseEnabled {
                            Capsule().fill(KabuyomiTheme.accentDeep)
                        }
                    }
            }
            .frame(minWidth: 96, minHeight: 44, alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
        }
        .buttonStyle(.plain)
        .disabled(isPurchasing || !product.isAvailable || !isPurchaseEnabled)
    }

    private var packActionTitle: String {
        if !product.isAvailable {
            return StoreProductPresentation.unavailableActionTitle(loadState: loadState)
        }
        if !isPurchaseEnabled { return disabledActionTitle }
        return "購入する"
    }
}

enum StoreProductPresentation {
    static func priceText(
        displayPrice: String?,
        loadState: SubscriptionProductLoadState
    ) -> String {
        if let displayPrice, !displayPrice.isEmpty {
            return displayPrice
        }

        switch loadState {
        case .idle, .loading:
            return "価格を確認中"
        case .loaded, .unavailable, .failed:
            return "価格を取得できません"
        }
    }

    static func unavailableActionTitle(loadState: SubscriptionProductLoadState) -> String {
        switch loadState {
        case .idle, .loading:
            return "App Storeに接続中"
        case .loaded, .unavailable, .failed:
            return "再読み込みできます"
        }
    }
}

private struct RewardedAdCreditButton: View {
    let state: RewardedAdCreditState
    let message: String?
    let earn: () -> Void

    private var isDisabled: Bool {
        switch state {
        case .idle:
            false
        case .loading, .presenting, .pendingGrant, .dailyCapReached:
            true
        }
    }

    private var title: String {
        switch state {
        case .idle:
            "任意の広告で2無料/ad credit"
        case .loading:
            "広告を読み込み中…"
        case .presenting:
            "広告を表示しています…"
        case .pendingGrant:
            "報酬を確認中…"
        case .dailyCapReached:
            "本日の広告報酬上限に達しました"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: earn) {
                HStack(spacing: 10) {
                    if state == .loading || state == .pendingGrant {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "play.rectangle.fill")
                            .font(.system(size: 16, weight: .bold))
                    }
                    Text(title)
                        .font(.system(.body, design: .rounded, weight: .bold))
                    Spacer()
                }
                .foregroundStyle(isDisabled ? KabuyomiTheme.inkMuted : KabuyomiTheme.paper)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(isDisabled ? KabuyomiTheme.fill(for: .muted) : AnyShapeStyle(KabuyomiTheme.accentDeep))
                )
            }
            .buttonStyle(.plain)
            .disabled(isDisabled)

            if let message, !message.isEmpty {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(state == .dailyCapReached ? KabuyomiTheme.negative : KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct CreditMetricRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.inkMuted)
            Spacer()
            Text(value)
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .multilineTextAlignment(.trailing)
                .lineLimit(3)
                .minimumScaleFactor(0.82)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(KabuyomiTheme.fill(for: .muted))
        )
    }
}

private enum CreditSheet: String, Identifiable {
    case plans
    case morePacks
    case accountStatus
    case creditRules

    var id: String { rawValue }
}

private struct BadgeText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(.caption, design: .rounded, weight: .bold))
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
    }
}

private struct PlanBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(.caption2, design: .rounded, weight: .bold))
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
    }
}

private struct CreditFeaturePill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(.caption, design: .rounded, weight: .bold))
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
    }
}

private struct CreditBreakdownTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(.caption2, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .lineLimit(1)

            Text(value)
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.78)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(KabuyomiTheme.fill(for: .muted))
        )
    }
}

private struct ManagementButton: View {
    let title: String
    let subtitle: String?
    let systemImage: String
    let isLoading: Bool
    let isEnabled: Bool
    let action: () -> Void

    init(
        title: String,
        subtitle: String? = nil,
        systemImage: String,
        isLoading: Bool,
        isEnabled: Bool = true,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.isLoading = isLoading
        self.isEnabled = isEnabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 16, height: 16)
                } else {
                    Image(systemName: systemImage)
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 18)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
            .foregroundStyle(KabuyomiTheme.ink)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(KabuyomiTheme.fill(for: .muted))
            )
        }
        .buttonStyle(.plain)
        .disabled(isLoading || !isEnabled)
        .opacity(isEnabled ? 1 : 0.62)
    }
}

private struct RuleText: View {
    let title: String
    let text: String

    init(title: String, body: String) {
        self.title = title
        self.text = body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.ink)
            Text(text)
                .font(.footnote)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(KabuyomiTheme.fill(for: .muted))
        )
    }
}

private struct AccountStatusActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .rounded, weight: .bold))
            .foregroundStyle(KabuyomiTheme.paper)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(configuration.isPressed ? KabuyomiTheme.accentDeep.opacity(0.82) : KabuyomiTheme.accentDeep)
            )
    }
}

struct AccountStatusDisplayModel: Equatable {
    struct Row: Identifiable, Equatable {
        let title: String
        let value: String

        var id: String { title }
    }

    let normalRows: [Row]
    let debugRows: [Row]

    var rows: [Row] {
        normalRows + debugRows
    }

    init(
        apiEnvironment: String,
        apiBaseURL: String,
        appVersion: String,
        deviceKeySuffix: String,
        usage: UsagePayload?,
        lastUsageRefreshAt: Date?,
        lastBillingSyncStatus: String,
        lastBillingSyncAt: Date?,
        healthReport: BillingAPIHealthReport?
    ) {
        let credits = usage?.credits
        let activePlan = usage?.activePlan ?? usage?.activeSubscription?.plan ?? usage?.plan ?? "unknown"
        let activeSubscription = usage?.activeSubscription
        let renewal = activeSubscription?.periodEnd ?? activeSubscription?.expiresAt

        self.normalRows = [
            Row(title: "接続状態", value: Self.connectionStatus(for: healthReport, lastBillingSyncStatus: lastBillingSyncStatus)),
            Row(title: "環境", value: Self.environmentName(from: apiEnvironment)),
            Row(title: "現在のプラン", value: BillingCatalog.displayLabel(for: activePlan)),
            Row(title: "合計クレジット", value: credits.map { "\($0.totalRemaining)" } ?? "不明"),
            Row(title: "月額分", value: credits.map { "\($0.monthlyRemaining) / \($0.monthlyLimit)" } ?? "不明"),
            Row(title: "ウェルカム", value: credits?.welcomeRemaining.map(String.init) ?? "未提供"),
            Row(title: "購入分", value: credits.map { "\($0.purchasedRemaining)" } ?? "不明"),
            Row(title: "広告分", value: credits?.rewardedAdRemaining.map(String.init) ?? "未提供"),
            Row(title: "次回更新", value: renewal ?? "未提供"),
            Row(title: "最終利用同期", value: Self.format(date: lastUsageRefreshAt)),
            Row(title: "最終購入同期", value: Self.billingStatus(status: lastBillingSyncStatus, at: lastBillingSyncAt)),
            Row(title: "端末情報", value: deviceKeySuffix == "unknown" ? "準備中" : "…\(deviceKeySuffix.suffix(6))"),
            Row(title: "App", value: appVersion)
        ]

        #if DEBUG
        var debugRows = [
            Row(title: "購入同期", value: Self.billingStatus(status: lastBillingSyncStatus, at: lastBillingSyncAt))
        ]

        if let healthReport {
            debugRows.append(Row(title: "接続診断", value: Self.connectionStatus(for: healthReport, lastBillingSyncStatus: lastBillingSyncStatus)))
        }

        self.debugRows = debugRows
        #else
        self.debugRows = []
        #endif
    }

    static func connectionStatus(for entry: BillingAPIHealthEntry) -> String {
        guard let statusCode = entry.statusCode else { return "エラー" }
        if statusCode == 404 { return "エラー" }
        if statusCode >= 200 && statusCode < 500 { return "正常" }
        return "エラー"
    }

    private static func connectionStatus(for healthReport: BillingAPIHealthReport?, lastBillingSyncStatus: String) -> String {
        if lastBillingSyncStatus.contains("route_missing") {
            return "エラー"
        }

        guard let healthReport else {
            return "未確認"
        }

        if healthReport.entries.contains(where: { connectionStatus(for: $0) == "エラー" }) {
            return "エラー"
        }

        return "正常"
    }

    private static func environmentName(from value: String) -> String {
        switch value.lowercased() {
        case "prod", "production":
            return "本番"
        case "test":
            return "テスト"
        default:
            return "カスタム"
        }
    }

    private static func billingStatus(status: String, at date: Date?) -> String {
        let displayStatus: String
        if status == "not_started" {
            displayStatus = "未同期"
        } else if status.contains("route_missing") || status.contains("failed") {
            displayStatus = "同期エラー"
        } else if status.contains("syncing") || status.contains("granting") {
            displayStatus = "同期中"
        } else if status.contains("succeeded") || status.contains("recovered") {
            displayStatus = "同期済み"
        } else {
            displayStatus = status
        }

        if let date {
            return "\(displayStatus) / \(format(date: date))"
        }
        return displayStatus
    }

    private static func format(date: Date?) -> String {
        guard let date else { return "まだ" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = TimeZone(identifier: "Asia/Tokyo")
        formatter.dateFormat = "MM/dd HH:mm:ss"
        return formatter.string(from: date)
    }

}

@MainActor
enum CreditPackPresentation {
    static func visibleProducts(from products: [CreditPackProduct]) -> [CreditPackProduct] {
        let resolvedProducts = products.isEmpty
            ? [
                CreditPackProduct(id: SubscriptionStore.primaryCreditProductID, credits: 50, displayPrice: nil, isAvailable: false),
                CreditPackProduct(id: SubscriptionStore.legacyCreditProductID, credits: 100, displayPrice: nil, isAvailable: false)
            ]
            : products

        return resolvedProducts.sorted { left, right in
            if left.id == SubscriptionStore.primaryCreditProductID { return true }
            if right.id == SubscriptionStore.primaryCreditProductID { return false }
            return left.credits < right.credits
        }
    }

    static func primaryProduct(from products: [CreditPackProduct]) -> CreditPackProduct? {
        products.first { $0.id == SubscriptionStore.primaryCreditProductID } ?? products.first
    }

    static func secondaryProducts(from products: [CreditPackProduct]) -> [CreditPackProduct] {
        guard let primary = primaryProduct(from: products) else { return [] }
        return products.filter { $0.id != primary.id }
    }
}
