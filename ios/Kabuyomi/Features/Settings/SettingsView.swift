import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var presentedLegalDocument: LegalDocumentKind?

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
                        #if DEBUG
                        devCard
                        #endif
                        aiCard
                        linksCard
                        #if DEBUG
                        storeKitDiagnosticsCard
                        #endif
                        displayCard
                        resetCard
                    }
                    .padding(20)
                    .padding(.top, 2)
                }
                .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            }
        }
        .onAppear {
            #if DEBUG
            appModel.refreshStoreKitDiagnostics()
            #endif
        }
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

                Toggle(isOn: Binding(
                    get: { appModel.usesTestAPI },
                    set: { appModel.setUsesTestAPI($0) }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Test API を使う")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                        Text("DEBUG ビルド専用です。ON で kabuyomi-api-test、OFF で本番 API を叩きます。切り替え後に利用状況を再同期します。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }

                Toggle(isOn: Binding(
                    get: { appModel.rewardedAdSSVSmokeModeEnabled },
                    set: { appModel.setRewardedAdSSVSmokeModeEnabled($0) }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("SSV smoke mode")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                        Text("OFF では DEBUG は Google デモ広告unitを使います。広告表示は確認できますが、本番SSV credit付与は確認できません。ON は KABUYOMI_ADMOB_TEST_DEVICE_IDS が必要です。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.inkMuted)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("現在の API 接続先")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                    Text(appModel.currentAPIEnvironmentDisplayName)
                        .font(.system(.caption, design: .rounded, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                    Text(appModel.currentAPIBaseURLDisplay)
                        .font(.system(.footnote, design: .monospaced, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .textSelection(.enabled)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("device key suffix")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                    Text("…\(appModel.currentDeviceKeySuffixDisplay)")
                        .font(.system(.footnote, design: .monospaced, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .textSelection(.enabled)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("広告報酬診断")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                    Text(appModel.rewardedAdDeveloperDiagnosticLine)
                        .font(.system(.footnote, design: .monospaced, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .textSelection(.enabled)
                    if !appModel.usesTestAPI && !appModel.rewardedAdSSVSmokeModeEnabled {
                        Text("本番API + Googleデモ広告unitのため、credit付与フローは開始前にブロックします。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.negative)
                    }
                    if appModel.rewardedAdSSVSmokeModeEnabled && !appModel.rewardedAdTestDeviceModeConfigured {
                        Text("SSV smoke mode は ON ですが、Google Mobile Ads test device ID が未設定のため、本番広告unitには切り替えません。")
                            .font(.footnote)
                            .foregroundStyle(KabuyomiTheme.negative)
                    }
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

    #if DEBUG
    private var storeKitDiagnosticsCard: some View {
        card {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("購入診断")
                        .font(.system(.headline, design: .rounded, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.ink)
                    Text("TestFlight の StoreKit 商品取得を確認するための読み取り専用情報です。credit付与や環境切替はできません。")
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 6) {
                    ForEach(appModel.storeKitDiagnostics.diagnosticLines, id: \.self) { line in
                        Text(line)
                            .font(.system(.caption, design: .monospaced, weight: .medium))
                            .foregroundStyle(KabuyomiTheme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .textSelection(.enabled)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(KabuyomiTheme.paper.opacity(0.55))
                )

                Button {
                    appModel.refreshStoreKitDiagnostics()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.clockwise")
                        Text("診断表示を更新")
                    }
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(KabuyomiTheme.accentDeep)
            }
        }
    }
    #endif

    private var linksCard: some View {
        card {
            VStack(alignment: .leading, spacing: 14) {
                Text("リンク")
                    .font(.system(.headline, design: .rounded, weight: .bold))

                Text("プライバシーポリシー / 利用条件 / サポートは公開法務ページを開きます。アプリ内表示は接続できない場合の控えです。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)

                Button {
                    openLegalDocument(.privacy)
                } label: {
                    SettingsLinkRow(
                        title: "プライバシーポリシー",
                        subtitle: "収集・送信・保存の方針"
                    )
                }
                .buttonStyle(.plain)

                Button {
                    openLegalDocument(.terms)
                } label: {
                    SettingsLinkRow(
                        title: "利用条件",
                        subtitle: "投資助言ではないこと / 利用条件"
                    )
                }
                .buttonStyle(.plain)

                Button {
                    openLegalDocument(.support)
                } label: {
                    SettingsLinkRow(
                        title: "サポート",
                        subtitle: "問い合わせに必要な情報"
                    )
                }
                .buttonStyle(.plain)

                Button {
                    openLegalDocument(.tokushoho)
                } label: {
                    SettingsLinkRow(
                        title: "特定商取引法に基づく表記",
                        subtitle: "販売者情報と paid credit の条件"
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

    private func openLegalDocument(_ document: LegalDocumentKind) {
        if let url = LegalSiteConfig.url(pathComponent: document.pathComponent) {
            openURL(url)
            return
        }
        presentedLegalDocument = document
    }

    private var resetCard: some View {
        card {
            VStack(alignment: .leading, spacing: 12) {
                Text("ローカルデータ")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                Text("保存銘柄、取得済みの決算資料、チャット履歴をこの端末から削除します。credit残高に使う端末識別情報は維持されます。")
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
                body: "Kabuyomi は、匿名の device key、検索履歴、保存銘柄、閲覧した企業・提出書類、利用回数、credit 残高、購入復元に必要な最小情報、エラー診断の最小ログを扱います。氏名、メールアドレス、証券口座情報、保有資産情報、銀行口座情報はアプリの利用に必要としません。"
            ),
            LegalSection(
                title: "OpenAI API 利用時に送信する情報",
                body: "AI チャットや引用文翻訳を利用する場合、質問文、翻訳対象の引用文、対象企業の SEC 提出資料メタデータ、抽出済み MD&A、抽出済み XBRL 指標、根拠として使う資料断片を OpenAI API などの外部 AI サービスに送信することがあります。個人情報、証券口座情報、未公開情報、第三者の機密情報は入力しないでください。"
            ),
            LegalSection(
                title: "第三者サービス",
                body: "API 配信、キャッシュ、利用制限管理には Cloudflare、SEC の 10-K / 10-Q 取得には SEC EDGAR、AI 応答と翻訳には OpenAI API などの外部 AI サービス、広告表示には Google AdMob、アプリ内課金と購入復元には Apple App Store / StoreKit を利用します。"
            ),
            LegalSection(
                title: "広告と購入",
                body: "広告視聴によるcredit獲得は任意です。広告完了だけでは付与せず、Google AdMob SSV をWorkerが確認した後に無料/ad creditとして反映します。追加 paid credit の購入、返金、請求、購入復元は Apple ID と App Store の仕組みに従います。"
            ),
            LegalSection(
                title: "保存期間",
                body: "ローカルの保存銘柄、取得済みの決算資料、チャット履歴は設定画面の「データをリセット」で削除できます。サーバー側では、利用制限、credit 台帳、購入重複防止、運用監査、障害調査に必要な最小限の記録と、SEC 提出資料キャッシュを保持します。"
            ),
            LegalSection(
                title: "国外処理",
                body: "Cloudflare、OpenAI、Google、Apple などの第三者サービスでは、日本国外を含む地域でデータが処理・保存される場合があります。"
            )
        ]
    }

    private var termsSections: [LegalSection] {
        [
            LegalSection(
                title: "公開法務ページ",
                body: "最新版は https://kabuyomi-legal-site.pages.dev/terms/ で確認できます。"
            ),
            LegalSection(
                title: "サービスの性質",
                body: "Kabuyomi は SEC EDGAR の公開 10-K / 10-Q を日本語で読みやすくし、根拠付きの要約、指標表示、AI チャット、引用文翻訳を提供する SEC filing reader です。投資助言、売買推奨、株価予測、目標株価、証券口座連携、利益保証は提供しません。"
            ),
            LegalSection(
                title: "利用の前提",
                body: "要約、AI チャット、翻訳、指標抽出には誤り、欠落、遅延、解釈の違いが含まれる可能性があります。回答はアプリが利用できる SEC 提出資料に基づきます。重要な判断を行う場合は、必ず SEC 原文、企業の公式資料、必要に応じて資格を持つ専門家の助言を確認してください。投資判断は利用者自身の責任で行ってください。"
            ),
            LegalSection(
                title: "禁止事項",
                body: "個人情報、証券口座情報、未公開情報、第三者の機密情報を入力しないでください。サービスの不正利用、制限回避、過剰アクセスを目的とした利用は禁止します。"
            ),
            LegalSection(
                title: "免責",
                body: "Kabuyomi の情報を用いた投資判断は利用者自身の責任で行ってください。アプリの不具合や停止によって生じる損失について、補償を前提としていません。"
            ),
            LegalSection(
                title: "Apple 標準 EULA",
                body: "Kabuyomi の利用には Apple の Licensed Application End User License Agreement（Standard EULA）が適用されます。Terms of Use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
            ),
            LegalSection(
                title: "credit購入",
                body: "Kabuyomi では App Store のアプリ内課金として、買い切りの paid credit と月額自動更新サブスクリプションを提供します。表示する主要な paid credit 商品は kabuyomi.credits.50 で、50 paid credits を付与します。kabuyomi.credits.100 は互換性のためサポートします。月額プランは Lite、Pro、Max で、それぞれ毎月 400 / 900 / 2000 credits を付与します。paid credit は失効しません。free/promotional credit、月額プラン分 credit、paid credit はサーバー側で分けて管理され、表示された期限がある場合はその期限に従います。購入、返金、請求、購入履歴、購入復元は Apple ID と App Store の仕組みおよび適用法に従います。"
            ),
            LegalSection(
                title: "外部サービス",
                body: "Kabuyomi は Cloudflare、SEC EDGAR、OpenAI API、Google AdMob、Apple StoreKit などの外部サービスを利用します。外部サービスの停止、仕様変更、制限、障害により、一部機能が利用できない場合があります。"
            )
        ]
    }

    private var supportSections: [LegalSection] {
        [
            LegalSection(
                title: "公開法務ページ",
                body: "最新版は https://kabuyomi-legal-site.pages.dev/support/ で確認できます。"
            ),
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

    private var tokushohoSections: [LegalSection] {
        [
            LegalSection(
                title: "公開法務ページ",
                body: "最新版は https://kabuyomi-legal-site.pages.dev/tokushoho/ で確認できます。"
            ),
            LegalSection(
                title: "提出前ブロッカー",
                body: "最新版は https://kabuyomi-legal-site.pages.dev/tokushoho/ で確認できます。"
            ),
            LegalSection(
                title: "事業者 / 販売者名",
                body: "プライバシー保護のため、販売者または運営者の氏名または名称はこの画面上では省略しています。特定商取引法に基づき開示請求があった場合、kabuyomi.support@gmail.com 宛ての請求に対して、メールその他の適切な方法により遅滞なく開示します。"
            ),
            LegalSection(
                title: "所在地",
                body: "プライバシー保護のため、所在地はこの画面上では省略しています。特定商取引法に基づき開示請求があった場合、kabuyomi.support@gmail.com 宛ての請求に対して、メールその他の適切な方法により遅滞なく開示します。"
            ),
            LegalSection(
                title: "電話番号",
                body: "プライバシー保護のため、電話番号はこの画面上では省略しています。特定商取引法に基づき開示請求があった場合、kabuyomi.support@gmail.com 宛ての請求に対して、メールその他の適切な方法により遅滞なく開示します。"
            ),
            LegalSection(
                title: "連絡先",
                body: "kabuyomi.support@gmail.com または X（Twitter）@0xt4dano までご連絡ください。"
            ),
            LegalSection(
                title: "販売価格",
                body: "paid credit 商品は kabuyomi.credits.50 を主要商品として表示し、50 paid credits を付与します。kabuyomi.credits.100 は互換性のためサポートします。月額自動更新サブスクリプションは kabuyomi.sub.lite.monthly、kabuyomi.sub.pro.monthly、kabuyomi.sub.max.monthly で、それぞれ毎月 400 / 900 / 2000 credits を付与します。販売価格、税・手数料、更新条件は App Store の購入画面に表示される内容に従います。"
            ),
            LegalSection(
                title: "支払時期 / 支払方法",
                body: "購入時に Apple ID / App Store のアプリ内課金で支払います。決済処理、請求、領収書、購入履歴は Apple の仕組みに従います。"
            ),
            LegalSection(
                title: "サービス提供時期",
                body: "Apple transaction を Kabuyomi Worker が App Store Server API で確認できた後、paid credit がアプリ内残高に反映されます。重複 transaction は二重付与せず、反映済みとして扱います。"
            ),
            LegalSection(
                title: "キャンセル / 返金",
                body: "デジタルコンテンツの性質上、購入後のキャンセルは原則として App Store の仕組みと適用法に従います。返金は Apple App Store の返金手続きおよび適用法に基づいて処理されます。"
            ),
            LegalSection(
                title: "動作環境",
                body: "Kabuyomi iOS アプリ、インターネット接続、Apple App Store / StoreKit、Kabuyomi API、SEC EDGAR、Cloudflare、OpenAI API などの外部サービスが利用可能である必要があります。"
            ),
            LegalSection(
                title: "credit の有効期限",
                body: "paid credit は失効しません。free/promotional credit は paid credit と分けて管理され、期限がある場合はアプリ内表示または関連説明に従います。"
            ),
            LegalSection(
                title: "投資助言ではありません",
                body: "Kabuyomi は SEC 10-K / 10-Q の読解支援アプリです。投資助言、売買推奨、株価予測、目標株価、証券口座連携、ポートフォリオ管理は提供しません。回答はアプリが利用できる SEC 提出資料に基づきます。投資判断は利用者自身の責任で行ってください。"
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
        case .tokushoho:
            tokushohoSections
        }
    }
}

enum LegalDocumentKind: String, Identifiable {
    case privacy
    case terms
    case support
    case tokushoho

    var id: String { rawValue }

    var pathComponent: String {
        rawValue
    }

    var title: String {
        switch self {
        case .privacy:
            "プライバシーポリシー"
        case .terms:
            "利用条件"
        case .support:
            "サポート"
        case .tokushoho:
            "特定商取引法に基づく表記"
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
        case .tokushoho:
            "販売者情報と paid credit の条件"
        }
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
