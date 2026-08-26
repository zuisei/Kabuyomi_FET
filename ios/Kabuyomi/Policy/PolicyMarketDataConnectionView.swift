import SwiftUI

struct MarketDataConnectionView: View {
    var showsDoneButton = false
    var onConnected: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var keyInput = ""
    @State private var hasKey = MarketDataKeychain.read() != nil
    @State private var status = MarketDataKeychain.read() == nil
        ? "市場データ提供元は未接続です。"
        : "APIキーはこの端末に保存されています。"
    @State private var isChecking = false

    var body: some View {
        List {
            Section("接続") {
                LabeledContent("提供元", value: "Twelve Data")
                LabeledContent("方式", value: "BYOK・端末から直接取得")
                Label(
                    hasKey ? "APIキー保存済み" : "未接続",
                    systemImage: hasKey ? "checkmark.circle.fill" : "exclamationmark.circle"
                )
                .foregroundStyle(hasKey ? AppColors.official : .secondary)

                SecureField("Twelve Data APIキー", text: $keyInput)
                    .textContentType(.password)
                    .privacySensitive()

                Button("保存して接続確認") {
                    saveAndVerify()
                }
                .disabled(keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isChecking)

                if hasKey {
                    Button("接続を再確認") {
                        verify()
                    }
                    .disabled(isChecking)
                    Button("APIキーを削除", role: .destructive) {
                        MarketDataKeychain.delete()
                        keyInput = ""
                        hasKey = false
                        status = "市場データ提供元は未接続です。"
                    }
                }

                if isChecking {
                    ProgressView("接続を確認中")
                } else {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            Section("チャートの扱い") {
                Text("対象銘柄と比較対象は資料ごとに選択します。正確な時刻がある資料は分足または時間足、掲載日しかない資料は日足で表示します。")
                Text("APIキーは端末の安全な領域（Keychain）だけに保存し、Market Docketのサーバーへ送信しません。取得・表示条件は利用者自身のデータ提供元契約に従います。")
                Text("価格の値動きは記述情報です。政策との因果関係や投資判断を示しません。")
            }
            .font(.caption)
            .foregroundStyle(KabuyomiTheme.inkMuted)
        }
        .navigationTitle("市場データ")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showsDoneButton {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完了") {
                        dismiss()
                    }
                }
            }
        }
        .accessibilityIdentifier("marketData.connection")
    }

    private func saveAndVerify() {
        do {
            try MarketDataKeychain.save(keyInput)
            keyInput = ""
            hasKey = true
            verify()
        } catch {
            status = error.localizedDescription
        }
    }

    private func verify() {
        isChecking = true
        status = "接続を確認中"
        Task {
            do {
                let provider = try TwelveDataBYOKProvider()
                let response = try await provider.bars(
                    request: MarketBarsRequest(symbol: "SPY", interval: "1day", outputSize: 1)
                )
                await MainActor.run {
                    hasKey = true
                    status = "接続済み・\(response.attribution)"
                    isChecking = false
                    onConnected?()
                }
            } catch {
                await MainActor.run {
                    status = error.localizedDescription
                    isChecking = false
                }
            }
        }
    }
}
