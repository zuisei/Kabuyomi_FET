import SwiftUI

struct ChatTopBar: View {
    let ticker: String
    let companyName: String?
    let formType: String?
    let isSaved: Bool
    let isLoading: Bool
    let canOpenSummary: Bool
    let openLibrary: () -> Void
    let openSummary: () -> Void
    let toggleSaved: () -> Void
    let refresh: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button(action: openLibrary) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 48, height: 48)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .kabuyomiGlass(radius: 24)
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            VStack(spacing: 2) {
                Text(ticker)
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)
                if let companyName {
                    Text(companyName)
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .lineLimit(1)
                } else if let formType {
                    Text(formType)
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                }
            }

            Spacer(minLength: 0)

            HStack(spacing: 0) {
                iconButton(
                    systemName: "sidebar.right",
                    accessibilityLabel: "要点を開く",
                    isEnabled: canOpenSummary,
                    action: openSummary
                )
                Divider()
                    .frame(height: 22)
                    .overlay(KabuyomiTheme.stroke(for: .secondary))
                iconButton(
                    systemName: isSaved ? "bookmark.fill" : "bookmark",
                    accessibilityLabel: isSaved ? "保存済み銘柄から外す" : "保存銘柄に追加",
                    isEnabled: true,
                    action: toggleSaved
                )
                Divider()
                    .frame(height: 22)
                    .overlay(KabuyomiTheme.stroke(for: .secondary))
                Button(action: refresh) {
                    Group {
                        if isLoading {
                            ProgressView()
                                .controlSize(.small)
                                .tint(KabuyomiTheme.accentDeep)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 18, weight: .semibold))
                        }
                    }
                    .frame(width: 44, height: 48)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("企業データを更新")
            }
            .padding(.horizontal, 4)
            .kabuyomiGlass(radius: 24)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    private func iconButton(
        systemName: String,
        accessibilityLabel: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .semibold))
                .frame(width: 44, height: 48)
                .foregroundStyle(isEnabled ? KabuyomiTheme.accentDeep : KabuyomiTheme.inkMuted.opacity(0.6))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(accessibilityLabel)
    }
}
