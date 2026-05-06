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
                        purchaseCard
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
            await appModel.loadCreditPackProducts(showErrors: false)
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
                        Text("残高")
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text("chat と翻訳に使う credit")
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
                    VStack(spacing: 10) {
                        CreditMetricRow(title: "合計", value: "\(credits.totalRemaining) credits")
                        CreditMetricRow(title: "Free付与", value: "\(credits.monthlyRemaining) / \(credits.monthlyLimit)")
                        if shouldShowRewardedCreditUI,
                           let rewardedAdRemaining = credits.rewardedAdRemaining,
                           rewardedAdRemaining > 0 {
                            CreditMetricRow(title: "広告報酬", value: "\(rewardedAdRemaining)")
                        }
                        if credits.purchasedRemaining > 0 {
                            CreditMetricRow(title: "購入分", value: "\(credits.purchasedRemaining)")
                        }
                    }

                    Text("Free初回付与は50 creditsです。通常chatは1回あたり \(appModel.chatCreditCost) creditsで、25 chat分使えます。Free付与分は \(formattedResetDate(credits.resetsAt)) にリセットされます。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
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

    private var purchaseCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("追加 credit")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                MiniCreditPackRow(
                    product: miniCreditPackProduct,
                    isPurchasing: appModel.billingActionInFlight,
                    purchase: { productId in
                        Task {
                            await appModel.purchaseCreditPack(productId: productId)
                        }
                    }
                )
                if !miniCreditPackProduct.isAvailable,
                   let message = appModel.creditPackProductLoadErrorMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.negative)
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

    private var miniCreditPackProduct: CreditPackProduct {
        appModel.creditPackProducts.first { $0.id == SubscriptionStore.miniCreditProductID }
            ?? CreditPackProduct(id: SubscriptionStore.miniCreditProductID, credits: 100, displayPrice: nil, isAvailable: false)
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

private struct MiniCreditPackRow: View {
    let product: CreditPackProduct
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
                    Text("Mini")
                        .font(.system(.body, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("100クレジット / 約50回分の質問")
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
