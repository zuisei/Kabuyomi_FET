import SwiftUI

enum KabuyomiSurface {
    case hero
    case primary
    case secondary
    case input
    case muted
}

enum KabuyomiTheme {
    // iOS 26: semantic color carries meaning; glass carries hierarchy.
    static let accent = Color(uiColor: .systemBlue)
    static let accentDeep = Color(uiColor: .systemBlue)
    static let accentSoft = Color(uiColor: .systemBlue).opacity(0.16)
    static let accentMist = Color(uiColor: .systemBlue).opacity(0.08)
    static let ink = Color(uiColor: .label)
    static let inkSoft = Color(uiColor: .secondaryLabel)
    static let inkMuted = Color(uiColor: .secondaryLabel)
    static let paper = Color(uiColor: .systemBackground)
    static let mist = Color(uiColor: .secondarySystemBackground)
    static let heroText = Color.white
    static let heroSubtext = Color.white.opacity(0.74)
    static let positive = Color(uiColor: .systemGreen)
    static let negative = Color(uiColor: .systemRed)
    static let tabBarBackground = Color(uiColor: .secondarySystemBackground).opacity(0.82)
    static let tabBarStroke = Color.primary.opacity(0.08)

    static var background: some View {
        ZStack {
            Color(uiColor: .systemGroupedBackground)

            RadialGradient(
                colors: [
                    accent.opacity(0.10),
                    .clear
                ],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 420
            )

            RadialGradient(
                colors: [
                    Color(uiColor: .systemIndigo).opacity(0.07),
                    .clear
                ],
                center: .bottomLeading,
                startRadius: 40,
                endRadius: 480
            )
        }
    }

    static func fill(for surface: KabuyomiSurface) -> AnyShapeStyle {
        switch surface {
        case .hero:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color(uiColor: .systemBlue),
                        Color(uiColor: .systemIndigo)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        case .primary:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color(uiColor: .secondarySystemGroupedBackground).opacity(0.94),
                        Color(uiColor: .secondarySystemGroupedBackground).opacity(0.82)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        case .secondary:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        accent.opacity(0.09),
                        Color(uiColor: .tertiarySystemGroupedBackground).opacity(0.76)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        case .input:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color(uiColor: .secondarySystemBackground).opacity(0.96),
                        Color(uiColor: .tertiarySystemBackground).opacity(0.88)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        case .muted:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color(uiColor: .tertiarySystemGroupedBackground).opacity(0.72),
                        Color(uiColor: .secondarySystemGroupedBackground).opacity(0.58)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        }
    }

    static func stroke(for surface: KabuyomiSurface) -> Color {
        switch surface {
        case .hero:
            return Color.white.opacity(0.22)
        case .primary:
            return Color.primary.opacity(0.06)
        case .secondary:
            return Color.primary.opacity(0.05)
        case .input:
            return Color.primary.opacity(0.08)
        case .muted:
            return Color.primary.opacity(0.04)
        }
    }

    static func shadow(for surface: KabuyomiSurface) -> Color {
        switch surface {
        case .hero:
            return Color.black.opacity(0.12)
        case .primary:
            return Color.black.opacity(0.055)
        case .secondary:
            return Color.black.opacity(0.04)
        case .input, .muted:
            return Color.black.opacity(0.025)
        }
    }
}

extension View {
    func kabuyomiCard(_ surface: KabuyomiSurface = .primary, radius: CGFloat = 20) -> some View {
        background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(KabuyomiTheme.fill(for: surface))
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(KabuyomiTheme.stroke(for: surface), lineWidth: 1)
                )
                .shadow(color: KabuyomiTheme.shadow(for: surface), radius: 10, x: 0, y: 4)
        )
    }
}

struct KabuyomiPressableButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(
                reduceMotion ? .linear(duration: 0.08) : .interactiveSpring(response: 0.28, dampingFraction: 1),
                value: configuration.isPressed
            )
    }
}
