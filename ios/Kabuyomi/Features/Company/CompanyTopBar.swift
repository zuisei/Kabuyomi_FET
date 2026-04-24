import SwiftUI

struct ChatTopBar: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

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

    @ViewBuilder
    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            stackedToolbar
        } else {
            compactToolbar
        }
    }

    private var compactToolbar: some View {
        HStack(spacing: 14) {
            libraryButton

            Spacer(minLength: 0)

            topBarTitle

            Spacer(minLength: 0)

            actionCluster
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    private var stackedToolbar: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                libraryButton

                Spacer(minLength: 0)

                actionCluster
            }

            topBarTitle
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 10)
    }

    private var libraryButton: some View {
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
    }

    private var actionCluster: some View {
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

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
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    .multilineTextAlignment(.center)
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
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 220)
        .contentShape(Rectangle())
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
