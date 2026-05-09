import SwiftUI

private enum RewardedCreditReviewUI {
    static let rewardedAdsVisibleInV1Review = false

    static var isVisible: Bool {
        #if DEBUG
        true
        #else
        rewardedAdsVisibleInV1Review
        #endif
    }
}

struct CreditView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var activeSheet: CreditSheet?

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
                        currentPlanCard
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
                Text("Credits")
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text("残高と追加 credit")
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Spacer()

            Button("閉じる") {
                dismiss()
            }
            .font(.system(.body, design: .rounded, weight: .semibold))
            .foregroundStyle(KabuyomiTheme.accentDeep)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .kabuyomiCard(.secondary, radius: 22)
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 14)
    }

    private var balanceCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Credit balance")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("Plan, renewal, and server balance")
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
                    .accessibilityLabel("credit残高を更新")
                }

                if let credits = appModel.usage?.credits {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(credits.totalRemaining)")
                            .font(.system(size: 46, weight: .bold, design: .rounded))
                            .foregroundStyle(KabuyomiTheme.ink)
                            .monospacedDigit()
                            .accessibilityLabel("合計 \(credits.totalRemaining) credits")

                        HStack(spacing: 8) {
                            BadgeText(appModel.currentPlanBadgeTitle)
                            if let renewal = nextRenewalText {
                                Text(renewal)
                                    .font(.system(.caption, design: .rounded, weight: .semibold))
                                    .foregroundStyle(KabuyomiTheme.inkMuted)
                            }
                        }
                    }
                } else if appModel.isUsageSynchronizing {
                    Text("credit残高を同期中です。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                } else {
                    Text("credit残高は次回の利用状況同期で表示されます。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }
        }
    }

    private var currentPlanCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Current plan")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text(activeSubscriptionSummary ?? "Free plan / 50 initial credits")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer()

                    Button {
                        activeSheet = .plans
                    } label: {
                        Text("View / change")
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
                VStack(spacing: 10) {
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
            .navigationTitle("Monthly plans")
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
                        Text("Add credits")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("Paid credits are separate from monthly credits.")
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
                            Text("More packs")
                            Spacer()
                            Image(systemName: "chevron.right")
                        }
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(KabuyomiTheme.fill(for: .secondary))
                        )
                    }
                    .buttonStyle(.plain)
                }

                if visibleCreditPackProducts.allSatisfy({ !$0.isAvailable }),
                   let message = appModel.creditPackProductLoadErrorMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.negative)
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
            .navigationTitle("More packs")
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
                ManagementButton(title: "Restore purchases", systemImage: "arrow.triangle.2.circlepath", isLoading: appModel.billingActionInFlight) {
                    Task {
                        await appModel.restorePurchases()
                    }
                }
                ManagementButton(title: "Account status", systemImage: "person.text.rectangle", isLoading: false) {
                    activeSheet = .accountStatus
                }
                ManagementButton(title: "Credit rules / legal info", systemImage: "info.circle", isLoading: false) {
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
                Text("広告を最後まで見るとfree/ad creditを2 credits獲得できます。1日3回まで、獲得から30日間有効です。広告を見なくても購入creditはそのまま使えます。")
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

    private var activeSubscriptionSummary: String? {
        guard let subscription = appModel.usage?.activeSubscription else {
            return nil
        }

        let planTitle = BillingCatalog.tier(for: subscription.plan).title
        let credits = subscription.monthlyCredits ?? BillingCatalog.tier(for: subscription.plan).monthlyCredits
        let dateText = formattedOptionalDate(subscription.periodEnd ?? subscription.expiresAt)
        if let dateText {
            return "現在: \(planTitle) / \(credits) credits月額 / 次回更新または期限: \(dateText)"
        }
        return "現在: \(planTitle) / \(credits) credits月額"
    }

    private var monthlyCreditLabel: String {
        appModel.usage?.activeSubscription == nil ? "Free付与" : "月額プラン分"
    }

    private var nextRenewalText: String? {
        if let subscription = appModel.usage?.activeSubscription,
           let date = formattedOptionalDate(subscription.periodEnd ?? subscription.expiresAt) {
            return "Next: \(date)"
        }
        if let resetsAt = appModel.usage?.credits?.resetsAt {
            return "Reset: \(formattedResetDate(resetsAt))"
        }
        return nil
    }

    private func isCurrentSubscription(_ product: SubscriptionProduct) -> Bool {
        guard let productID = product.tier.productID else { return false }
        return appModel.usage?.activeSubscription?.productId == productID
            || appModel.usage?.activePlan == product.tier.plan
    }

    private func creditSummaryText(for credits: CreditUsagePayload) -> String {
        if let subscription = appModel.usage?.activeSubscription {
            let planTitle = BillingCatalog.tier(for: subscription.plan).title
            return "\(planTitle)の月額creditは \(formattedResetDate(credits.resetsAt)) にリセットされます。通常chatは1回あたり \(appModel.chatCreditCost) creditsです。購入分creditは別枠で保持され、サーバー表示上は失効しません。"
        }
        return "Free初回付与は50 creditsです。通常chatは1回あたり \(appModel.chatCreditCost) creditsで、25 chat分使えます。Free付与分は \(formattedResetDate(credits.resetsAt)) にリセットされます。"
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
                    ForEach(viewModel.rows) { row in
                        CreditMetricRow(title: row.title, value: row.value)
                    }

                    if let health = appModel.billingAPIHealthReport {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Billing API health")
                                .font(.system(.headline, design: .rounded, weight: .bold))
                                .foregroundStyle(KabuyomiTheme.ink)
                            ForEach(health.entries) { entry in
                                CreditMetricRow(title: "\(entry.method) \(entry.path)", value: entry.statusSummary)
                            }
                        }
                    }

                    Button {
                        Task {
                            await appModel.restorePurchases()
                        }
                    } label: {
                        Text("Restore / sync purchases")
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
                            Text("Check billing API routes")
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
            .navigationTitle("Account status")
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
                    RuleText(title: "Monthly credits", body: "Lite / Pro / Max plans renew monthly through the App Store and grant the server-confirmed monthly credit amount.")
                    RuleText(title: "Paid credits", body: "Paid consumable credits are granted only after Apple verification and do not expire in the current server accounting.")
                    if shouldShowRewardedCreditUI {
                        RuleText(title: "Ad credits", body: "Rewarded/ad credits are optional, limited by the server, and expire when the server provides an expiration.")
                    }
                    RuleText(title: "Restore", body: "Restore/sync reads StoreKit entitlements and asks the server to refresh account status. The app does not grant credits locally.")
                }
                .padding(20)
            }
            .background(KabuyomiTheme.background.ignoresSafeArea())
            .navigationTitle("Credit rules")
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
            .padding(18)
            .kabuyomiGlass(radius: 26, tint: Color.white.opacity(0.20), stroke: Color.white.opacity(0.58))
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
}

private struct SubscriptionPlanRow: View {
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
            HStack(alignment: .center, spacing: 12) {
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
                    Text("\(product.tier.monthlyCredits) credits / 月・自動更新")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 5) {
                    Text(displayPrice)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text(product.isAvailable ? "App Storeで購読" : "App Store確認中")
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(product.isAvailable ? KabuyomiTheme.inkMuted : KabuyomiTheme.negative)
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(KabuyomiTheme.fill(for: isCurrent ? .secondary : .muted))
            )
        }
        .buttonStyle(.plain)
        .disabled(isPurchasing || !product.isAvailable || isCurrent)
        .opacity(product.isAvailable ? 1 : 0.72)
    }
}

private struct CreditPackRow: View {
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
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(product.credits == 50 ? "Mini" : "\(product.credits) credit")
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

                Spacer()

                VStack(alignment: .trailing, spacing: 5) {
                    Text(displayPrice)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text(product.isAvailable ? "App Storeで購入" : "App Store確認中")
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(product.isAvailable ? KabuyomiTheme.inkMuted : KabuyomiTheme.negative)
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(KabuyomiTheme.fill(for: .muted))
            )
        }
        .buttonStyle(.plain)
        .disabled(isPurchasing || !product.isAvailable)
        .opacity(product.isAvailable ? 1 : 0.72)
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
            "広告を見て2クレジット獲得"
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

    let rows: [Row]

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
        let renewal = activeSubscription?.periodEnd ?? activeSubscription?.expiresAt ?? credits?.resetsAt

        var rows = [
            Row(title: "API", value: "\(apiEnvironment) / \(apiBaseURL)"),
            Row(title: "App", value: appVersion),
            Row(title: "Device", value: "…\(deviceKeySuffix)"),
            Row(title: "Plan", value: BillingCatalog.displayLabel(for: activePlan)),
            Row(title: "Total credits", value: credits.map { "\($0.totalRemaining)" } ?? "unknown"),
            Row(title: "Monthly/subscription", value: credits.map { "\($0.monthlyRemaining) / \($0.monthlyLimit)" } ?? "unknown"),
            Row(title: "Ad/free credits", value: credits?.rewardedAdRemaining.map(String.init) ?? "not provided"),
            Row(title: "Paid credits", value: credits.map { "\($0.purchasedRemaining)" } ?? "unknown"),
            Row(title: "Next renewal/reset", value: renewal ?? "not provided"),
            Row(title: "Last usage refresh", value: Self.format(date: lastUsageRefreshAt)),
            Row(title: "Last billing sync", value: Self.billingStatus(status: lastBillingSyncStatus, at: lastBillingSyncAt))
        ]

        if let healthReport {
            rows.append(Row(title: "Route health", value: healthReport.hasRouteMissing ? "route missing detected" : "no 404 detected"))
        }

        self.rows = rows
    }

    private static func billingStatus(status: String, at date: Date?) -> String {
        if let date {
            return "\(status) / \(format(date: date))"
        }
        return status
    }

    private static func format(date: Date?) -> String {
        guard let date else { return "not yet" }
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
