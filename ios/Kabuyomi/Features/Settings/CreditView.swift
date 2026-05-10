import SwiftUI

private enum RewardedCreditReviewUI {
    static let rewardedAdsVisibleInV102Review = true

    static var isVisible: Bool {
        #if DEBUG
        true
        #else
        rewardedAdsVisibleInV102Review && AdMobConfig.hasRewardedCreditAdConfig
        #endif
    }
}

enum CreditInitialSheet {
    case plans
}

struct CreditView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var activeSheet: CreditSheet?

    init(initialSheet: CreditInitialSheet? = nil) {
        _activeSheet = State(initialValue: {
            switch initialSheet {
            case .plans:
                return .plans
            case nil:
                return nil
            }
        }())
    }

    var body: some View {
        ZStack {
            Rectangle()
                .fill(KabuyomiTheme.paper.opacity(0.001))
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {}

            KabuyomiTheme.background
                .ignoresSafeArea()
                .allowsHitTesting(false)

            VStack(spacing: 0) {
                header

                ScrollView {
                    VStack(spacing: 16) {
                        balanceCard
                        addCreditsCard
                        purchaseManagementCard
                        if shouldShowRewardedCreditUI {
                            rewardCard
                        }
                    }
                    .padding(20)
                    .padding(.top, 2)
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
            await appModel.refreshCreditUsage()
            await appModel.loadSubscriptionProducts(showErrors: false)
            await appModel.loadCreditPackProducts(showErrors: false)
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
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text("クレジット")
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text("残高、現在のプラン、追加購入を確認")
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Spacer()

            Button("閉じる") {
                dismiss()
            }
            .font(.system(.body, design: .rounded, weight: .semibold))
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .kabuyomiCard(.secondary, radius: 12)
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 14)
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
                    VStack(alignment: .leading, spacing: 4) {
                        Text("現在のプラン")
                            .font(.system(.subheadline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text(activeSubscriptionSummary ?? "無料 / 初回 50クレジット")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer()

                    Button {
                        activeSheet = .plans
                    } label: {
                        Text("プランを見る")
                    }
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
                }
            }
        }
    }

    private var currentPlanCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("現在のプラン")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text(activeSubscriptionSummary ?? "無料 / 初回 50クレジット")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer()

                    Button {
                        activeSheet = .plans
                    } label: {
                        Text("プランを見る")
                    }
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
                }
            }
        }
    }

    private var planComparisonSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("月額プランは自動更新されます")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("App Storeのアカウント設定から管理・解約できます。クレジットはサーバー同期後に反映されます。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    ForEach(appModel.subscriptionProducts) { product in
                        SubscriptionPlanRow(
                            product: product,
                            isCurrent: isCurrentSubscription(product),
                            isPurchasing: appModel.billingActionInFlight,
                            purchase: { productId in
                                Task {
                                    await appModel.purchaseSubscription(productId: productId)
                                }
                            }
                        )
                    }

                    Button {
                        Task {
                            await appModel.restorePurchases()
                        }
                    } label: {
                        Label("購入を復元 / 同期", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(AccountStatusActionButtonStyle())
                    .disabled(appModel.billingActionInFlight)
                }
                .padding(20)

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
                        Text("50クレジットを主要パックとして追加できます。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                    Spacer()
                }

                if let primaryCreditPackProduct {
                    CreditPackRow(
                        product: primaryCreditPackProduct,
                        chatCreditCost: appModel.chatCreditCost,
                        isPrimary: true,
                        isPurchasing: appModel.billingActionInFlight,
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

    private var morePacksSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(secondaryCreditPackProducts) { product in
                        CreditPackRow(
                            product: product,
                            chatCreditCost: appModel.chatCreditCost,
                            isPrimary: product.id == SubscriptionStore.primaryCreditProductID,
                            isPurchasing: appModel.billingActionInFlight,
                            purchase: { productId in
                                Task {
                                    await appModel.purchaseCreditPack(productId: productId)
                                }
                            }
                        )
                    }
                }
                .padding(20)
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
            VStack(spacing: 10) {
                ManagementButton(title: "購入を復元", systemImage: "arrow.triangle.2.circlepath", isLoading: appModel.billingActionInFlight) {
                    Task {
                        await appModel.restorePurchases()
                    }
                }
                ManagementButton(title: "利用状況", systemImage: "person.text.rectangle", isLoading: false) {
                    activeSheet = .accountStatus
                }
                ManagementButton(title: "クレジットのルール", systemImage: "info.circle", isLoading: false) {
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

    private var monthlyCreditLabel: String {
        appModel.usage?.activeSubscription == nil ? "初回付与" : "月額プラン分"
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

    private func creditSummaryText(for credits: CreditUsagePayload) -> String {
        if let subscription = appModel.usage?.activeSubscription {
            let planTitle = BillingCatalog.tier(for: subscription.plan).title
            return "\(planTitle)の月額クレジットは \(formattedResetDate(credits.resetsAt)) にリセットされます。通常の質問は1回あたり \(appModel.chatCreditCost) クレジットです。購入分クレジットは別枠で保持され、サーバー表示上は失効しません。"
        }
        return "初回付与は50クレジットです。通常の質問は1回あたり \(appModel.chatCreditCost) クレジットです。購入分クレジットは別枠で保持されます。"
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
                    .disabled(appModel.billingActionInFlight)

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
                    RuleText(title: "月額プラン分クレジット", body: "Lite / Pro / Max はApp Storeの月額自動更新プランです。サーバー同期後に、プランごとの月額クレジットが反映されます。")
                    RuleText(title: "購入分クレジット", body: "買い切りのクレジットはApple検証とサーバー確認後にだけ付与されます。現在のサーバー会計では失効しません。")
                    if shouldShowRewardedCreditUI {
                        RuleText(title: "広告クレジット", body: "広告報酬クレジットは任意の無料/ad creditです。アプリ内の広告完了だけでは付与せず、サーバー側でGoogle AdMobの確認が完了した場合だけ反映されます。1日3回まで、獲得から30日間有効です。")
                    }
                    RuleText(title: "復元", body: "購入の復元はStoreKitの権利情報を読み取り、サーバーに同期します。アプリ内ではクレジットを直接付与しません。")
                }
                .padding(20)
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
        RewardedCreditReviewUI.isVisible
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .kabuyomiCard(.primary, radius: 16)
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

private struct SubscriptionPlanRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let product: SubscriptionProduct
    let isCurrent: Bool
    let isPurchasing: Bool
    let purchase: (String) -> Void

    private var displayPrice: String {
        product.displayPrice ?? "価格確認中"
    }

    var body: some View {
        Button {
            purchase(product.id)
        } label: {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    planSummary
                    planAction
                }
            } else {
                HStack(alignment: .center, spacing: 12) {
                    planSummary
                    Spacer()
                    planAction
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(KabuyomiTheme.fill(for: isCurrent ? .secondary : .muted))
        )
        .buttonStyle(.plain)
        .disabled(isPurchasing || !product.isAvailable || isCurrent)
        .opacity(product.isAvailable ? 1 : 0.72)
    }

    private var planSummary: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(product.tier.title)
                    .font(.system(.body, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                if isCurrent {
                    Text("利用中")
                        .font(.system(.caption2, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
                }
            }
            Text("\(product.tier.monthlyCredits)クレジット / 月")
                .font(.footnote)
                .foregroundStyle(KabuyomiTheme.inkMuted)
            Text("月額プランは自動更新されます")
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    private var planAction: some View {
        VStack(alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing, spacing: 5) {
            Text(displayPrice)
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
            Text(isCurrent ? "現在のプラン" : (product.isAvailable ? "変更 / 購読" : "App Store確認中"))
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(product.isAvailable ? KabuyomiTheme.inkMuted : KabuyomiTheme.negative)
        }
    }
}

private struct CreditPackRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let product: CreditPackProduct
    let chatCreditCost: Int
    let isPrimary: Bool
    let isPurchasing: Bool
    let purchase: (String) -> Void

    private var displayPrice: String {
        product.displayPrice ?? "価格確認中"
    }

    var body: some View {
        Button {
            purchase(product.id)
        } label: {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    packSummary
                    packAction
                }
            } else {
                HStack(alignment: .center, spacing: 12) {
                    packSummary
                    Spacer()
                    packAction
                }
            }
        }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(KabuyomiTheme.fill(for: .muted))
            )
        .buttonStyle(.plain)
        .disabled(isPurchasing || !product.isAvailable)
        .opacity(product.isAvailable ? 1 : 0.72)
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
            Text("\(product.credits)クレジット / 約\(product.credits / chatCreditCost)回分の質問")
                .font(.footnote)
                .foregroundStyle(KabuyomiTheme.inkMuted)
        }
    }

    private var packAction: some View {
        VStack(alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing, spacing: 5) {
            Text(displayPrice)
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
            Text(product.isAvailable ? "購入する" : "App Store確認中")
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(product.isAvailable ? KabuyomiTheme.paper : KabuyomiTheme.negative)
                .padding(.horizontal, product.isAvailable ? 10 : 0)
                .padding(.vertical, product.isAvailable ? 6 : 0)
                .background {
                    if product.isAvailable {
                        Capsule().fill(KabuyomiTheme.accentDeep)
                    }
                }
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

private struct ManagementButton: View {
    let title: String
    let systemImage: String
    let isLoading: Bool
    let action: () -> Void

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
                Text(title)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
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
        .disabled(isLoading)
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
            Row(title: "月額/初回分", value: credits.map { "\($0.monthlyRemaining) / \($0.monthlyLimit)" } ?? "不明"),
            Row(title: "購入分", value: credits.map { "\($0.purchasedRemaining)" } ?? "不明"),
            Row(title: "広告/無料分", value: credits?.rewardedAdRemaining.map(String.init) ?? "未提供"),
            Row(title: "次回更新", value: renewal ?? "未提供"),
            Row(title: "最終利用同期", value: Self.format(date: lastUsageRefreshAt)),
            Row(title: "最終購入同期", value: Self.billingStatus(status: lastBillingSyncStatus, at: lastBillingSyncAt)),
            Row(title: "App", value: appVersion)
        ]

        #if DEBUG
        var debugRows = [
            Row(title: "端末ID末尾", value: "…\(deviceKeySuffix)"),
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
