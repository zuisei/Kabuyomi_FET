import SwiftUI

struct ChatTopBar: View {
    let ticker: String
    let companyName: String?
    let formType: String?
    let companyWebsiteURL: URL?
    let isSaved: Bool
    let isLoading: Bool
    let canOpenSummary: Bool
    let openLibrary: () -> Void
    let openCompanyWebsite: () -> Void
    let openSummary: () -> Void
    let toggleSaved: () -> Void
    let refresh: () -> Void

    private var isResolvingCompanyWebsite: Bool {
        isLoading && companyWebsiteURL == nil && companyName != nil
    }

    var body: some View {
        HStack(spacing: 14) {
            Button(action: openLibrary) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 48, height: 48)
                    .foregroundStyle(KabuyomiTheme.accentDeep)
                    .kabuyomiGlass(radius: 24, interactive: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("一覧を開く")
            .accessibilityHint("保存済みや最近の会話から銘柄を切り替えます")
            .accessibilityIdentifier("company.libraryButton")

            Spacer(minLength: 0)

            topBarTitle

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
            .kabuyomiGlass(radius: 24, interactive: true)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    private var topBarTitle: some View {
        Group {
            if companyWebsiteURL != nil {
                Button(action: openCompanyWebsite) {
                    topBarTitleContent(isLink: true)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(ticker) の会社サイトを開く")
                .accessibilityHint("企業ホームページまたは投資家向けページを開きます")
            } else {
                topBarTitleContent(isLink: false)
            }
        }
    }

    private func topBarTitleContent(isLink: Bool) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 6) {
                Text(ticker)
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(KabuyomiTheme.ink)

                if isLink {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(KabuyomiTheme.accentDeep)
                } else if isResolvingCompanyWebsite {
                    ProgressView()
                        .controlSize(.small)
                        .tint(KabuyomiTheme.accentDeep)
                }
            }

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

            if isResolvingCompanyWebsite {
                Text("会社サイトを確認中...")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(KabuyomiTheme.accentDeep)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: 220)
        .kabuyomiGlass(radius: 22, tint: Color.white.opacity(0.22), stroke: Color.white.opacity(0.58))
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
