import SwiftUI

enum KabuyomiSurface {
    case hero
    case primary
    case secondary
    case input
    case muted
}

enum KabuyomiTheme {
    // A deeper, editorial brown gives the warm palette more definition.
    static let accent = Color(red: 0.72, green: 0.36, blue: 0.10)
    static let accentDeep = Color(red: 0.50, green: 0.25, blue: 0.07)
    static let accentSoft = Color(red: 0.92, green: 0.84, blue: 0.73)
    static let accentMist = Color(red: 0.96, green: 0.90, blue: 0.82)
    static let ink = Color(red: 0.15, green: 0.12, blue: 0.10)
    static let inkSoft = Color(red: 0.27, green: 0.22, blue: 0.18)
    static let inkMuted = Color(red: 0.43, green: 0.38, blue: 0.31)
    static let paper = Color(red: 0.98, green: 0.96, blue: 0.93)
    static let mist = Color(red: 0.92, green: 0.88, blue: 0.82)
    static let heroText = Color(red: 0.98, green: 0.95, blue: 0.90)
    static let heroSubtext = Color(red: 0.85, green: 0.80, blue: 0.73)
    static let positive = Color(red: 0.12, green: 0.43, blue: 0.26)
    static let negative = Color(red: 0.72, green: 0.24, blue: 0.18)
    static let tabBarBackground = Color(red: 0.94, green: 0.90, blue: 0.83)
    static let tabBarStroke = Color(red: 0.58, green: 0.47, blue: 0.31).opacity(0.24)

    static var background: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.995, green: 0.985, blue: 0.97),
                    Color(red: 0.97, green: 0.94, blue: 0.89),
                    Color(red: 0.93, green: 0.90, blue: 0.84)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            RadialGradient(
                colors: [
                    accent.opacity(0.14),
                    .clear
                ],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 340
            )

            RadialGradient(
                colors: [
                    Color(red: 0.60, green: 0.51, blue: 0.39).opacity(0.11),
                    .clear
                ],
                center: .bottomLeading,
                startRadius: 40,
                endRadius: 400
            )

            LinearGradient(
                colors: [
                    Color.white.opacity(0.42),
                    Color.white.opacity(0.08),
                    .clear
                ],
                startPoint: .top,
                endPoint: .center
            )
        }
    }

    static func fill(for surface: KabuyomiSurface) -> AnyShapeStyle {
        switch surface {
        case .hero:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color(red: 0.26, green: 0.20, blue: 0.15),
                        Color(red: 0.34, green: 0.25, blue: 0.17),
                        Color(red: 0.44, green: 0.30, blue: 0.18)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        case .primary:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.92),
                        Color(red: 0.99, green: 0.98, blue: 0.96).opacity(0.84)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        case .secondary:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        accentMist.opacity(0.72),
                        mist.opacity(0.70)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        case .input:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.94),
                        Color(red: 0.99, green: 0.98, blue: 0.96).opacity(0.88)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        case .muted:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.60),
                        mist.opacity(0.66)
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
            return accentSoft.opacity(0.28)
        case .primary:
            return Color.white.opacity(0.92)
        case .secondary:
            return Color(red: 0.75, green: 0.66, blue: 0.53).opacity(0.20)
        case .input:
            return Color(red: 0.72, green: 0.61, blue: 0.45).opacity(0.20)
        case .muted:
            return Color(red: 0.69, green: 0.60, blue: 0.46).opacity(0.15)
        }
    }

    static func shadow(for surface: KabuyomiSurface) -> Color {
        switch surface {
        case .hero:
            return Color.black.opacity(0.16)
        case .primary:
            return Color(red: 0.33, green: 0.25, blue: 0.17).opacity(0.08)
        case .secondary:
            return Color(red: 0.33, green: 0.25, blue: 0.17).opacity(0.06)
        case .input, .muted:
            return Color(red: 0.33, green: 0.25, blue: 0.17).opacity(0.04)
        }
    }
}

extension View {
    func kabuyomiCard(_ surface: KabuyomiSurface = .primary, radius: CGFloat = 26) -> some View {
        background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(KabuyomiTheme.fill(for: surface))
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(KabuyomiTheme.stroke(for: surface), lineWidth: 1)
                )
                .shadow(color: KabuyomiTheme.shadow(for: surface), radius: 18, x: 0, y: 10)
        )
    }
}
