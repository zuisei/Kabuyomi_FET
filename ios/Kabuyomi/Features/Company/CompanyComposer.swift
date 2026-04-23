import SwiftUI

struct ComposerBar: View {
    @Binding var question: String
    let isSending: Bool
    let isEnabled: Bool
    let placeholder: String
    let aiConsentGranted: Bool
    let applyPrompt: (String) -> Void
    let sendAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            consentStatusLine

            HStack(alignment: .center, spacing: 12) {
                TextField(
                    "",
                    text: $question,
                    prompt: Text(placeholder)
                        .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.82)),
                    axis: .vertical
                )
                .lineLimit(1...6)
                .disabled(!isEnabled)
                .font(.system(.body, design: .rounded))
                .foregroundStyle(KabuyomiTheme.ink)
                .frame(minHeight: 24)
                .submitLabel(.send)
                .onSubmit(sendAction)
                .accessibilityLabel("質問入力")
                .accessibilityHint(aiConsentGranted ? "入力した質問を送信できます" : "初回は同意確認後、入力内容を残します")

                Button {
                    question = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.9))
                        .frame(width: 32, height: 32)
                        .background(
                            Circle()
                                .fill(Color.white.opacity(0.72))
                        )
                }
                .buttonStyle(.plain)
                .contentShape(Circle())
                .accessibilityLabel("入力内容を消去")
                .accessibilityHidden(trimmedQuestion.isEmpty)
                .opacity(trimmedQuestion.isEmpty ? 0 : 1)
                .allowsHitTesting(!trimmedQuestion.isEmpty)
                .animation(.easeInOut(duration: 0.15), value: trimmedQuestion.isEmpty)

                Button(action: sendAction) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .bold))
                        .frame(width: 44, height: 44)
                        .foregroundStyle(sendDisabled ? KabuyomiTheme.inkMuted : .white)
                        .background(sendButtonBackground)
                }
                .buttonStyle(.plain)
                .disabled(sendDisabled)
                .accessibilityLabel("質問を送信")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .kabuyomiGlass(
                radius: 28,
                tint: Color.white.opacity(0.24),
                stroke: Color.white.opacity(0.62)
            )
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private var trimmedQuestion: String {
        question.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var sendDisabled: Bool {
        trimmedQuestion.isEmpty || isSending || !isEnabled
    }

    private var sendButtonBackground: some View {
        Circle()
            .fill(sendDisabled ? Color(red: 0.88, green: 0.87, blue: 0.85) : KabuyomiTheme.accentDeep)
            .overlay(
                Circle()
                    .stroke(sendDisabled ? Color.white.opacity(0.9) : Color.white.opacity(0.2), lineWidth: 1)
            )
            .shadow(color: sendDisabled ? Color.clear : KabuyomiTheme.accentDeep.opacity(0.24), radius: 10, x: 0, y: 6)
    }

    private var consentStatusLine: some View {
        HStack(spacing: 8) {
            Image(systemName: aiConsentGranted ? "checkmark.circle.fill" : "info.circle.fill")
                .font(.system(size: 12, weight: .bold))

            Text(aiConsentGranted ? "送信前に内容を確認できます。" : "初回は同意確認後、入力内容を残します。もう一度送信してください。")
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(.caption2, design: .rounded, weight: .semibold))
        .foregroundStyle(aiConsentGranted ? KabuyomiTheme.inkMuted : KabuyomiTheme.accentDeep)
        .padding(.horizontal, 4)
    }
}
