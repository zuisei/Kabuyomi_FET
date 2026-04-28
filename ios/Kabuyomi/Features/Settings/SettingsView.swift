import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var presentedLegalDocument: LegalDocumentKind?

    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                HStack(alignment: .center) {
                    Text("設定")
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)

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

                ScrollView {
                    VStack(spacing: 16) {
                        planCard
                        creditCard
                        #if DEBUG
                        devCard
                        #endif
                        aiCard
                        linksCard
                        displayCard
                        resetCard
                    }
                    .padding(20)
                    .padding(.top, 2)
                }
                .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            }
        }
    }

    private var creditCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Image(systemName: "creditcard.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text("クレジット")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Spacer()
                }

                if let credits = appModel.usage?.credits {
                    VStack(spacing: 10) {
                        CreditMetricRow(title: "残高", value: "\(credits.totalRemaining) credits")
                        CreditMetricRow(title: "月間プラン", value: "\(credits.monthlyRemaining) / \(credits.monthlyLimit)")
                        if credits.purchasedRemaining > 0 {
                            CreditMetricRow(title: "購入分", value: "\(credits.purchasedRemaining)")
                        }
                    }

                    Text("AIチャットは1回あたり \(appModel.chatCreditCost) creditsです。月間creditは \(formattedResetDate(credits.resetsAt)) にリセットされます。")
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

                Label("月額プランのcreditでAIチャットを利用できます", systemImage: "checkmark.seal.fill")
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }
        }
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

    private var planCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("プラン")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                HStack {
                    Label(appModel.currentPlanBadgeTitle, systemImage: appModel.currentPlanBadgeSystemImage)
                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                        .foregroundStyle(appModel.currentPlanBadgeUsesAccent ? KabuyomiTheme.accentDeep : KabuyomiTheme.inkMuted)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
                    Spacer()
                }

                Text("月間credit付きプランに登録すると、AIチャットで使えるcreditが毎月付与されます。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)

                if subscriptionsAreUnavailable {
                    SubscriptionUnavailableNotice(
                        message: appModel.subscriptionProductLoadErrorMessage,
                        retry: {
                            Task {
                                await appModel.loadSubscriptionProducts(showErrors: true)
                            }
                        }
                    )
                } else if appModel.subscriptionProductLoadState == .loading {
                    Text("月額プランをApp Storeから確認中です。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                if appModel.usage == nil && appModel.isUsageSynchronizing {
                    Text("利用状況を同期中です。")
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                } else if appModel.usage == nil {
                    Text("利用状況を読み込み中です。")
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                VStack(spacing: 10) {
                    BillingTierRow(
                        tier: BillingCatalog.free,
                        isCurrent: appModel.currentBillingTier.plan == BillingCatalog.free.plan
                    )
                    ForEach(appModel.subscriptionProducts) { product in
                        Button {
                            Task {
                                await appModel.purchaseSubscription(productId: product.id)
                            }
                        } label: {
                            SubscriptionPlanRow(
                                product: product,
                                isCurrent: appModel.currentBillingTier.plan == product.tier.plan,
                                isLoadingProducts: appModel.subscriptionProductLoadState == .loading
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(
                            appModel.billingActionInFlight
                                || appModel.currentBillingTier.plan == product.tier.plan
                                || !product.isAvailable
                        )
                        .opacity(product.isAvailable ? 1 : 0.72)
                    }
                }

                HStack(spacing: 10) {
                    Button {
                        Task {
                            await appModel.restorePurchases()
                        }
                    } label: {
                        Text("購入を復元")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(appModel.billingActionInFlight)
                }

                Text("購読はApp Storeのアカウント設定からいつでも管理できます。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
        .task {
            await appModel.loadSubscriptionProducts(showErrors: false)
        }
    }

    private var subscriptionsAreUnavailable: Bool {
        appModel.subscriptionProductLoadState == .unavailable
            || appModel.subscriptionProductLoadState == .failed
    }

    #if DEBUG
    private var devCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("開発用オプション")
                    .font(.system(.headline, design: .rounded, weight: .bold))

                Toggle(isOn: Binding(
                    get: { appModel.devModeEnabled },
                    set: { appModel.setDevModeEnabled($0) }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Dev モード")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                        Text("DEBUG ビルド専用です。同じ API に detached access header を送り、Worker 側の allowlisted device key だけ開発用 quota を使います。release には出しません。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("現在の API 接続先")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                    Text(appModel.currentAPIBaseURLDisplay)
                        .font(.system(.footnote, design: .monospaced, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .textSelection(.enabled)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("現在の device key")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                    Text(appModel.currentDeviceKeyDisplay)
                        .font(.system(.footnote, design: .monospaced, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .textSelection(.enabled)
                }

                Text(devModeStatusText)
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
        }
    }

    private var devModeStatusText: String {
        if appModel.isDetachedDevAccessActive {
            return "現在の device key は detached dev allowlist に一致しています。"
        }
        if appModel.devModeEnabled {
            return "Dev モードは ON ですが、この device key はまだ allowlist 未登録か、Worker 側の DEV_DETACHED_ACCESS_DEVICE_KEYS が未反映です。"
        }
        return "release ではこのセクション自体を出しません。無効時は通常の free / pro に戻ります。"
    }
    #endif

    private var aiCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("AI 利用")
                    .font(.system(.headline, design: .rounded, weight: .bold))

                Toggle(isOn: Binding(
                    get: { appModel.aiConsentGranted },
                    set: { appModel.setAIConsent($0) }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("AI 利用への同意")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                        Text("質問内容と対象の決算資料の抜粋が外部 AI モデルに送信されます。個人情報は入力しないでください。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
            }
        }
    }

    private var displayCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("表示")
                    .font(.system(.headline, design: .rounded, weight: .bold))

                Toggle(isOn: Binding(
                    get: { appModel.showStarterCompanies },
                    set: { appModel.setShowStarterCompanies($0) }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("スターター銘柄を表示")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                        Text("一覧に AAPL / MSFT などのスターター銘柄を出すかを切り替えます。5回目以降の起動では自動で非表示になりますが、ここで再表示できます。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }
            }
        }
    }

    private var linksCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("リンク")
                    .font(.system(.headline, design: .rounded, weight: .bold))

                Text("プライバシーポリシー / 利用条件 / サポートはアプリ内で確認できます。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)

                Button {
                    presentedLegalDocument = .privacy
                } label: {
                    SettingsLinkRow(
                        title: "プライバシーポリシー",
                        subtitle: "収集・送信・保存の方針"
                    )
                }
                .buttonStyle(.plain)

                Button {
                    presentedLegalDocument = .terms
                } label: {
                    SettingsLinkRow(
                        title: "利用条件",
                        subtitle: "投資助言ではないこと / 利用条件"
                    )
                }
                .buttonStyle(.plain)

                Button {
                    presentedLegalDocument = .support
                } label: {
                    SettingsLinkRow(
                        title: "サポート",
                        subtitle: "問い合わせに必要な情報"
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .fullScreenCover(item: $presentedLegalDocument) { document in
            LegalDocumentView(
                title: document.title,
                subtitle: document.subtitle,
                sections: legalSections(for: document)
            )
        }
    }

    private var resetCard: some View {
        card {
            VStack(alignment: .leading, spacing: 12) {
                Text("ローカルデータ")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                Text("保存銘柄、取得済みの決算資料、チャット履歴をこの端末から削除します。credit残高と購読状態に使う端末識別情報は維持されます。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                Button("データをリセット", role: .destructive) {
                    appModel.requestResetLocalDataConfirmation()
                }
            }
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .kabuyomiGlass(radius: 26, tint: Color.white.opacity(0.20), stroke: Color.white.opacity(0.58))
    }

    private var privacySections: [LegalSection] {
        [
            LegalSection(
                title: "収集する情報",
                body: "Kabuyomi は、匿名の device key、利用回数、購読状態の最小情報、エラー診断の最小ログを扱います。無料プランでは広告表示のため、Google AdMob SDK が広告識別子などの情報を扱う場合があります。氏名、メールアドレス、証券口座情報、保有資産情報は前提にしていません。"
            ),
            LegalSection(
                title: "AI 利用時に送信する情報",
                body: "AI チャットを有効化した場合、質問文、対象企業の決算資料メタデータ、抽出済み MD&A、抽出済み XBRL 指標を外部 AI モデルに送信します。個人情報や機密情報は入力しないでください。"
            ),
            LegalSection(
                title: "第三者サービス",
                body: "API と利用制限管理には Cloudflare、SEC の決算資料取得には SEC と sec-fetcher、AI 応答には外部 AI モデル、無料プランの広告表示には Google AdMob を利用します。一部の技術ログはサービス品質確認のために記録されます。"
            ),
            LegalSection(
                title: "保存期間",
                body: "ローカルの保存銘柄、取得済みの決算資料、チャット履歴はアプリ内に保存され、設定画面の「データをリセット」で削除できます。サーバー側の決算資料キャッシュは再利用と運用確認のため保持されます。"
            )
        ]
    }

    private var termsSections: [LegalSection] {
        [
            LegalSection(
                title: "サービスの性質",
                body: "Kabuyomi は SEC EDGAR の公開提出書類を日本語で読みやすくするための情報提供アプリです。投資助言、売買推奨、株価予測、アナリスト予想比較は提供しません。"
            ),
            LegalSection(
                title: "利用の前提",
                body: "仕様、UI、利用制限、出力品質は改善のため変更されることがあります。要約やチャットには誤りや省略が含まれる可能性があるため、必ず原文も確認してください。"
            ),
            LegalSection(
                title: "禁止事項",
                body: "個人情報、証券口座情報、未公開情報、第三者の機密情報を入力しないでください。サービスの不正利用、制限回避、過剰アクセスを目的とした利用は禁止します。"
            ),
            LegalSection(
                title: "免責",
                body: "Kabuyomi の情報を用いた投資判断は利用者自身の責任で行ってください。アプリの不具合や停止によって生じる損失について、補償を前提としていません。"
            )
        ]
    }

    private var supportSections: [LegalSection] {
        [
            LegalSection(
                title: "問い合わせ方法",
                body: "不具合や改善要望は、メール kabuyomi.support@gmail.com または X（Twitter）@0xt4dano へ連絡してください。"
            ),
            LegalSection(
                title: "報告してほしい内容",
                body: "対象企業、画面名、質問文、表示された出典、期待した結果、実際の結果、発生時刻をできるだけ具体的に記載してください。"
            ),
            LegalSection(
                title: "正式サポート",
                body: "サポート窓口: kabuyomi.support@gmail.com / X（Twitter）: @0xt4dano"
            )
        ]
    }

    private func legalSections(for document: LegalDocumentKind) -> [LegalSection] {
        switch document {
        case .privacy:
            privacySections
        case .terms:
            termsSections
        case .support:
            supportSections
        }
    }
}

private enum LegalDocumentKind: String, Identifiable {
    case privacy
    case terms
    case support

    var id: String { rawValue }

    var title: String {
        switch self {
        case .privacy:
            "プライバシーポリシー"
        case .terms:
            "利用条件"
        case .support:
            "サポート"
        }
    }

    var subtitle: String {
        switch self {
        case .privacy:
            "データの取り扱い"
        case .terms:
            "Kabuyomi の利用条件"
        case .support:
            "問い合わせと不具合報告"
        }
    }
}

private struct BillingTierRow: View {
    let tier: BillingTier
    let isCurrent: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(tier.title)
                    .font(.system(.body, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text(tier.summary)
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Spacer()

            if isCurrent {
                Text("現在")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(KabuyomiTheme.fill(for: .secondary)))
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(KabuyomiTheme.fill(for: isCurrent ? .secondary : .muted))
        )
    }
}

private struct SubscriptionPlanRow: View {
    let product: SubscriptionProduct
    let isCurrent: Bool
    let isLoadingProducts: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(product.tier.title)
                    .font(.system(.body, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text(product.tier.summary)
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 5) {
                if isCurrent {
                    Text("現在")
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                } else if let displayPrice = product.displayPrice {
                    Text(displayPrice)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                } else if isLoadingProducts {
                    Text("App Store確認中")
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                } else if !product.isAvailable {
                    Text("再読込待ち")
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.negative)
                } else {
                    Text("App Store確認中")
                        .font(.system(.caption, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                Image(systemName: rowIconName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(rowIconColor)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(KabuyomiTheme.fill(for: isCurrent ? .secondary : .muted))
        )
    }

    private var rowIconName: String {
        if isCurrent {
            return "checkmark.circle.fill"
        }
        return product.isAvailable ? "chevron.right" : "arrow.clockwise"
    }

    private var rowIconColor: Color {
        if isCurrent {
            return KabuyomiTheme.accentDeep
        }
        return product.isAvailable ? KabuyomiTheme.inkMuted : KabuyomiTheme.negative
    }
}

private struct SubscriptionUnavailableNotice: View {
    let message: String?
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.negative)
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: 4) {
                    Text("月額プランを読み込めませんでした")
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text(message ?? "App Storeの商品情報を取得できないため、この画面から月額プランへ登録できません。通信状況を確認して再読み込みしてください。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            Button(action: retry) {
                Label("再読み込み", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(KabuyomiTheme.negative.opacity(0.10))
        )
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

private struct SettingsLinkRow: View {
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.ink)
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.accentDeep)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .kabuyomiCard(.secondary, radius: 18)
    }
}

private struct LegalDocumentView: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let subtitle: String
    let sections: [LegalSection]

    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
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

                    VStack(alignment: .leading, spacing: 8) {
                        Text("アプリポリシー")
                            .font(.system(.caption, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.heroSubtext)
                        Text(title)
                            .font(.system(.title2, design: .rounded, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.ink)
                        Text(subtitle)
                            .font(.system(.footnote, design: .rounded, weight: .medium))
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                    .padding(18)
                    .kabuyomiCard(.primary, radius: 24)

                    ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 10) {
                                Text(String(format: "%02d", index + 1))
                                    .font(.system(.caption, design: .rounded, weight: .bold))
                                    .foregroundStyle(KabuyomiTheme.accentDeep)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 5)
                                    .background(Capsule().fill(KabuyomiTheme.accentSoft.opacity(0.58)))

                                Text(section.title)
                                    .font(.system(.headline, design: .rounded, weight: .bold))
                                    .foregroundStyle(KabuyomiTheme.ink)
                            }
                            Text(section.body)
                                .font(.system(.body, design: .rounded))
                                .foregroundStyle(KabuyomiTheme.inkSoft)
                                .lineSpacing(6)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(18)
                        .kabuyomiCard(.primary, radius: 24)
                    }
                }
                .padding(20)
            }
        }
    }
}

private struct LegalSection: Identifiable {
    let id = UUID()
    let title: String
    let body: String
}
