import SwiftUI

struct TranslationRequestControl: View {
    let status: TranslationRequestStatus
    let isSubmitting: Bool
    let errorMessage: String?
    let request: (() -> Void)?

    var body: some View {
        CompactPolicySection(title: "日本語表示") {
            content
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(KabuyomiTheme.negative)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("translation.error")
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isSubmitting {
            ProgressView("日本語へ翻訳しています…")
                .controlSize(.small)
                .accessibilityIdentifier("translation.status")
        } else {
            switch status.state {
            case .available:
                Text("この過去資料だけを日本語へ翻訳します。結果は「自動翻訳・未確認」として原文と分けて保存します。")
                    .font(.subheadline)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("translation.status")
                requestButton(title: "日本語に翻訳", systemImage: "character.book.closed")
            case .queued:
                if status.mode == .automatic {
                    statusLabel(
                        title: "新着資料を自動翻訳しています",
                        detail: "処理が完了すると日本語表示へ切り替わります。",
                        systemImage: "clock"
                    )
                } else {
                    ProgressView("日本語へ翻訳しています…")
                        .controlSize(.small)
                        .accessibilityIdentifier("translation.status")
                    Text("通常は数秒で反映されます。画面を閉じても処理は継続します。")
                        .font(.caption)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            case .processing:
                ProgressView("日本語へ翻訳しています…")
                    .controlSize(.small)
                    .accessibilityIdentifier("translation.status")
                Text("画面を閉じても処理は継続します。")
                    .font(.caption)
                    .foregroundStyle(KabuyomiTheme.inkMuted)
            case .retry:
                statusLabel(
                    title: "翻訳を一時待機しています",
                    detail: "外部サービスの状態を確認し、自動的に再試行します。",
                    systemImage: "arrow.triangle.2.circlepath"
                )
            case .failed:
                statusLabel(
                    title: "翻訳を完了できませんでした",
                    detail: "この資料だけをすぐにもう一度翻訳できます。",
                    systemImage: "exclamationmark.triangle"
                )
                if status.canRequest {
                    requestButton(title: "翻訳を再試行", systemImage: "arrow.clockwise")
                }
            case .batchProcessing:
                statusLabel(
                    title: "一括翻訳の処理対象です",
                    detail: "重複課金を避けるため、個別翻訳は追加しません。",
                    systemImage: "tray.full"
                )
            case .translated:
                statusLabel(title: "日本語翻訳済み", detail: "翻訳結果を読み込みます。", systemImage: "checkmark.circle")
            case .unavailable:
                EmptyView()
            }
        }
    }

    private func requestButton(title: String, systemImage: String) -> some View {
        Button(action: { request?() }) {
            Label(title, systemImage: systemImage)
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .disabled(request == nil)
        .accessibilityIdentifier("translation.requestButton")
    }

    private func statusLabel(title: String, detail: String, systemImage: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
            Text(detail)
                .font(.caption)
                .foregroundStyle(KabuyomiTheme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityIdentifier("translation.status")
    }
}
