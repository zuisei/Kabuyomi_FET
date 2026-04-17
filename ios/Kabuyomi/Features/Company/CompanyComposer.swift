import SwiftUI

struct ComposerBar: View {
    @Binding var question: String
    let isSending: Bool
    let isEnabled: Bool
    let placeholder: String
    let aiConsentGranted: Bool
    let sendAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !aiConsentGranted {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("初回送信時に Gemini 送信の同意確認が表示されます。")
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
                .lineLimit(1...5)
                .disabled(!isEnabled)
                .font(.system(.body, design: .rounded))
                .foregroundStyle(KabuyomiTheme.ink)
                .frame(minHeight: 24)

                Button(action: sendAction) {
                    Group {
                        if isSending {
                            ProgressView()
                                .tint(sendDisabled ? KabuyomiTheme.inkMuted : .white)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 18, weight: .bold))
                        }
                    }
                    .frame(width: 44, height: 44)
                    .foregroundStyle(sendDisabled ? KabuyomiTheme.inkMuted : .white)
                    .background(sendButtonBackground)
                }
                .buttonStyle(.plain)
                .disabled(sendDisabled)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(composerBackground)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private var sendDisabled: Bool {
        question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending || !isEnabled
    }

    private var composerBackground: some View {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
            .fill(Color.white.opacity(0.96))
            .overlay(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .stroke(Color.white.opacity(0.95), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 14, x: 0, y: 10)
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
