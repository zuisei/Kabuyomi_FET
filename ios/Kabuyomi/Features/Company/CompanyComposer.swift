import SwiftUI

struct ComposerBar: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @Binding var question: String
    let isSending: Bool
    let isEnabled: Bool
    let placeholder: String
    let aiConsentGranted: Bool
    let creditStatusText: String
    let hasEnoughCredits: Bool
    let applyPrompt: (String) -> Void
    let openCreditOptions: () -> Void
    let sendAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            composerStatusLine
            inputControls
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 8)
        .kabuyomiGlass(
            radius: 20,
            tint: Color.white.opacity(0.10),
            stroke: KabuyomiTheme.accentDeep.opacity(0.13)
        )
        .padding(.horizontal, 18)
        .padding(.top, 6)
        .padding(.bottom, 11)
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
            HStack(alignment: .center, spacing: 10) {
                questionField
                clearButton
                sendButton
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.44))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(KabuyomiTheme.inkMuted.opacity(0.13), lineWidth: 0.7)
            )
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
        .frame(minHeight: 22)
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
                .frame(width: 30, height: 30)
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
        Button(action: sendButtonAction) {
            Image(systemName: "arrow.up")
                .font(.system(size: 18, weight: .bold))
                .frame(width: 42, height: 42)
                .foregroundStyle(sendButtonIsDisabled ? KabuyomiTheme.inkMuted : .white)
                .background(sendButtonBackground)
        }
        .buttonStyle(.plain)
        .disabled(sendButtonIsDisabled)
        .accessibilityLabel("質問を送信")
    }

    private var trimmedQuestion: String {
        question.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var sendButtonIsDisabled: Bool {
        trimmedQuestion.isEmpty || isSending || !isEnabled
    }

    private func sendButtonAction() {
        if hasEnoughCredits {
            sendAction()
        } else {
            openCreditOptions()
        }
    }

    private var sendButtonBackground: some View {
        Circle()
            .fill(sendButtonIsDisabled ? Color(red: 0.88, green: 0.87, blue: 0.85) : KabuyomiTheme.accentDeep)
            .overlay(
                Circle()
                    .stroke(sendButtonIsDisabled ? Color.white.opacity(0.9) : Color.white.opacity(0.2), lineWidth: 1)
            )
            .shadow(color: sendButtonIsDisabled ? Color.clear : KabuyomiTheme.accentDeep.opacity(0.10), radius: 4, x: 0, y: 2)
    }

    private var composerStatusLine: some View {
        HStack(spacing: 10) {
            if !aiConsentGranted {
                Label("初回のみ同意", systemImage: "info.circle.fill")
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }

            Label(
                hasEnoughCredits ? creditStatusText : "残高不足",
                systemImage: hasEnoughCredits ? "bolt.circle.fill" : "exclamationmark.circle.fill"
            )
            .foregroundStyle(hasEnoughCredits ? KabuyomiTheme.inkMuted : KabuyomiTheme.negative)

            Spacer(minLength: 0)

            if !hasEnoughCredits {
                Button("対応を見る") {
                    openCreditOptions()
                }
                .font(.system(.caption2, design: .rounded, weight: .bold))
                .buttonStyle(.bordered)
                .controlSize(.mini)
            }
        }
        .font(.system(.caption2, design: .rounded, weight: .semibold))
        .padding(.horizontal, 4)
        .lineLimit(1)
        .dynamicTypeSize(.xSmall ... .accessibility2)
    }
}

#Preview("Chat Composer") {
    @Previewable @State var question = "営業CFの変化を日本語で要約して"

    ZStack {
        KabuyomiTheme.background

        VStack {
            Spacer()

            ComposerBar(
                question: $question,
                isSending: false,
                isEnabled: true,
                placeholder: "AAPL の 10-Q について質問",
                aiConsentGranted: true,
                creditStatusText: "48 credits",
                hasEnoughCredits: true,
                applyPrompt: { question = $0 },
                openCreditOptions: {},
                sendAction: {}
            )
        }
    }
}

#Preview("Chat Composer Needs Credits") {
    @Previewable @State var question = "売上高と利益率の変化を教えて"

    ZStack {
        KabuyomiTheme.background

        VStack {
            Spacer()

            ComposerBar(
                question: $question,
                isSending: false,
                isEnabled: true,
                placeholder: "NVDA の 10-K について質問",
                aiConsentGranted: true,
                creditStatusText: "0 credits",
                hasEnoughCredits: false,
                applyPrompt: { question = $0 },
                openCreditOptions: {},
                sendAction: {}
            )
        }
    }
}
