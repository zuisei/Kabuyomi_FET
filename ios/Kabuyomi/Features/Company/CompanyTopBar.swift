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
        HStack(spacing: 12) {
            libraryButton
            topBarTitle
                .frame(maxWidth: .infinity)
            actionCluster
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 6)
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
                .font(.system(size: 18, weight: .semibold))
                .frame(width: 44, height: 44)
                .foregroundStyle(KabuyomiTheme.accentDeep)
                .background(
                    Circle()
                        .fill(KabuyomiTheme.accentMist.opacity(0.72))
                        .overlay(Circle().stroke(Color.white.opacity(0.78), lineWidth: 1))
                )
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
            iconButton(
                systemName: isSaved ? "bookmark.fill" : "bookmark",
                accessibilityLabel: isSaved ? "保存済み銘柄から外す" : "保存銘柄に追加",
                isEnabled: true,
                action: toggleSaved
            )
            Button(action: refresh) {
                Group {
                    if isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .tint(KabuyomiTheme.accentDeep)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 17, weight: .semibold))
                    }
                }
                .frame(width: 44, height: 44)
                .foregroundStyle(KabuyomiTheme.accentDeep)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("企業データを更新")
        }
        .padding(.horizontal, 2)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.white.opacity(0.32))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color.white.opacity(0.72), lineWidth: 1)
                )
        )
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
                    .font(.system(.headline, design: .rounded, weight: .bold))
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
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .frame(
            maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 190,
            minHeight: 38
        )
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func iconButton(
        systemName: String,
        accessibilityLabel: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 44, height: 44)
                .foregroundStyle(isEnabled ? KabuyomiTheme.accentDeep : KabuyomiTheme.inkMuted.opacity(0.6))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(accessibilityLabel)
    }
}

#Preview("Chat Header") {
    VStack(spacing: 0) {
        ChatTopBar(
            ticker: "AAPL",
            companyName: "Apple Inc.",
            formType: "10-Q",
            companyWebsiteURL: URL(string: "https://www.apple.com/investor-relations/"),
            isSaved: true,
            isLoading: false,
            canOpenSummary: true,
            openLibrary: {},
            openCompanyWebsite: {},
            openSummary: {},
            toggleSaved: {},
            refresh: {}
        )

        Divider()
    }
    .background(KabuyomiTheme.background)
}

#Preview("Chat Header Loading") {
    VStack(spacing: 0) {
        ChatTopBar(
            ticker: "NVDA",
            companyName: "NVIDIA Corporation",
            formType: "10-K",
            companyWebsiteURL: nil,
            isSaved: false,
            isLoading: true,
            canOpenSummary: true,
            openLibrary: {},
            openCompanyWebsite: {},
            openSummary: {},
            toggleSaved: {},
            refresh: {}
        )

        Divider()
    }
    .background(KabuyomiTheme.background)
}
