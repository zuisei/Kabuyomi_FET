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
            if !aiConsentGranted {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("初回送信時に AI 利用の同意確認が表示されます。")
                        .lineLimit(2)
                }
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(KabuyomiTheme.negative)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .kabuyomiGlass(radius: 16, tint: KabuyomiTheme.accentSoft.opacity(0.18), stroke: Color.white.opacity(0.48))
            }

            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(KabuyomiTheme.accentDeep)

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

                if !trimmedQuestion.isEmpty {
                    Button {
                        question = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(KabuyomiTheme.inkMuted.opacity(0.9))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("入力内容を消去")
                }

                Button(action: sendAction) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .bold))
                    .frame(width: 44, height: 44)
                    .foregroundStyle(sendDisabled ? KabuyomiTheme.inkMuted : .white)
                    .background(sendButtonBackground)
                }
                .buttonStyle(.plain)
                .disabled(sendDisabled)
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
}
