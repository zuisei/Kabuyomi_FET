import SwiftUI

struct ComposerBar: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @Binding var question: String
    let isSending: Bool
    let isEnabled: Bool
    let placeholder: String
    let aiConsentGranted: Bool
    let applyPrompt: (String) -> Void
    let sendAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !aiConsentGranted {
                consentStatusLine
            }

            inputControls
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .kabuyomiGlass(
            radius: 28,
            tint: Color.white.opacity(0.28),
            stroke: Color.white.opacity(0.66)
        )
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    @ViewBuilder
    private var inputControls: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 10) {
                questionField

                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    clearButton
                    sendButton
                }
            }
        } else {
            HStack(alignment: .center, spacing: 12) {
                questionField
                clearButton
                sendButton
            }
        }
    }

    private var questionField: some View {
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
        .accessibilityHint(aiConsentGranted ? "入力した質問を送信できます" : "初回は同意後にこの質問を送信します")
    }

    private var clearButton: some View {
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
    }

    private var sendButton: some View {
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
            Image(systemName: "info.circle.fill")
                .font(.system(size: 12, weight: .bold))

            Text("初回は同意後にこの質問を送信します。")
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(.caption2, design: .rounded, weight: .semibold))
        .foregroundStyle(KabuyomiTheme.accentDeep)
        .padding(.horizontal, 4)
    }
}
