import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                KabuyomiTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        planCard
                        #if DEBUG
                        devCard
                        #endif
                        aiCard
                        linksCard
                        displayCard
                        resetCard
                    }
                    .padding(20)
                }
            }
            .navigationTitle("設定")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") {
                        dismiss()
                    }
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                }
            }
        }
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

                if let usage = appModel.usage {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("今日のチャット: \(usage.chatsUsed) / \(appModel.displayChatLimit(for: usage))")
                        Text("保存銘柄: \(usage.stocksUsed) / \(appModel.displayStockLimit(for: usage))")
                    }
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.ink)
                } else if appModel.isUsageSynchronizing {
                    Text("利用状況を同期中です。")
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                } else {
                    Text("利用状況を読み込み中です。")
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }

                VStack(spacing: 10) {
                    BillingTierRow(tier: BillingCatalog.free, isCurrent: appModel.currentBillingTier.plan == BillingCatalog.free.plan)
                    BillingTierRow(tier: BillingCatalog.pro, isCurrent: appModel.currentBillingTier.plan == BillingCatalog.pro.plan)
                }

                HStack(spacing: 10) {
                    Button {
                        Task {
                            await appModel.purchasePro()
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if appModel.billingActionInFlight {
                                ProgressView()
                                    .controlSize(.small)
                            }
                            Text(appModel.isProPlanActive ? "Pro 利用中" : "Pro を購入")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(KabuyomiTheme.accentDeep)
                    .disabled(appModel.billingActionInFlight || appModel.isProPlanActive)

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

                Text("StoreKit の購読状態を同期し、同じ API のまま free / pro の quota だけを切り替えます。")
                    .font(.footnote)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            }
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
                        Text("質問内容と SEC filing コンテキストが外部 AI モデルに送信されます。個人情報は入力しないでください。")
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

                NavigationLink {
                    LegalDocumentView(
                        title: "プライバシーポリシー",
                        subtitle: "beta 期間中の最小開示",
                        sections: privacySections
                    )
                } label: {
                    SettingsLinkRow(
                        title: "プライバシーポリシー",
                        subtitle: "収集・送信・保存の方針"
                    )
                }
                .buttonStyle(.plain)

                NavigationLink {
                    LegalDocumentView(
                        title: "利用条件",
                        subtitle: "Kabuyomi beta の前提",
                        sections: termsSections
                    )
                } label: {
                    SettingsLinkRow(
                        title: "利用条件",
                        subtitle: "投資助言ではないこと / beta 利用条件"
                    )
                }
                .buttonStyle(.plain)

                NavigationLink {
                    LegalDocumentView(
                        title: "サポート",
                        subtitle: "beta フィードバック窓口",
                        sections: supportSections
                    )
                } label: {
                    SettingsLinkRow(
                        title: "サポート",
                        subtitle: "TestFlight からのフィードバック案内"
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var resetCard: some View {
        card {
            VStack(alignment: .leading, spacing: 12) {
                Text("ローカルデータ")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                Text("保存銘柄、取得済み filing、チャット履歴をこの端末から削除し、端末識別情報を再生成して最初からやり直す状態に戻します。利用状況は新規ユーザー状態に戻る可能性があります。")
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
                body: "Kabuyomi beta は、匿名の device key、利用回数、購読状態の最小情報、エラー診断の最小ログを扱います。氏名、メールアドレス、証券口座情報、保有資産情報は前提にしていません。"
            ),
            LegalSection(
                title: "AI 利用時に送信する情報",
                body: "AI チャットを有効化した場合、質問文、対象企業の filing metadata、抽出済み MD&A、抽出済み XBRL 指標を外部 AI モデルに送信します。個人情報や機密情報は入力しないでください。"
            ),
            LegalSection(
                title: "第三者サービス",
                body: "API と利用制限管理には Cloudflare、SEC filing 取得には SEC と sec-fetcher、AI 応答には外部 AI モデルを利用します。beta 環境では一部の技術ログがサービス品質確認のために記録されます。"
            ),
            LegalSection(
                title: "保存期間",
                body: "ローカルの保存銘柄、取得済み filing、チャット履歴はアプリ内に保存され、設定画面の「データをリセット」で削除できます。サーバー側の filing cache は再利用と運用確認のため保持されます。"
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
                title: "beta 利用の前提",
                body: "beta 版では仕様、UI、利用制限、出力品質が予告なく変更されることがあります。要約やチャットには誤りや省略が含まれる可能性があるため、必ず原文も確認してください。"
            ),
            LegalSection(
                title: "禁止事項",
                body: "個人情報、証券口座情報、未公開情報、第三者の機密情報を入力しないでください。サービスの不正利用、制限回避、過剰アクセスを目的とした利用は禁止します。"
            ),
            LegalSection(
                title: "免責",
                body: "Kabuyomi の情報を用いた投資判断は利用者自身の責任で行ってください。beta 版の不具合や停止によって生じる損失について、現段階では補償を前提としていません。"
            )
        ]
    }

    private var supportSections: [LegalSection] {
        [
            LegalSection(
                title: "beta フィードバック方法",
                body: "TestFlight で配布された beta は、TestFlight アプリの「Send Beta Feedback」から報告してください。スクリーンショット、対象ティッカー、再現手順があると確認しやすくなります。"
            ),
            LegalSection(
                title: "報告してほしい内容",
                body: "対象企業、画面名、質問文、表示された出典、期待した結果、実際の結果、発生時刻をできるだけ具体的に記載してください。"
            ),
            LegalSection(
                title: "正式サポート",
                body: "正式公開前にプライバシーポリシー / 利用条件 / サポートの外部 URL と連絡先を設置予定です。beta 中はアプリ内案内と TestFlight フィードバックを窓口とします。"
            )
        ]
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
    let title: String
    let subtitle: String
    let sections: [LegalSection]

    var body: some View {
        ZStack {
            KabuyomiTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
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
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct LegalSection: Identifiable {
    let id = UUID()
    let title: String
    let body: String
}
