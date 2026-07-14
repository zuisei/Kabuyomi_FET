import SwiftUI

enum KabuyomiSurface {
    case hero
    case primary
    case secondary
    case input
    case muted
}

enum KabuyomiTheme {
    // A quiet editorial palette. Every custom color remains appearance-aware;
    // system accessibility settings continue to control legibility.
    static let accent = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.40, green: 0.68, blue: 0.93, alpha: 1.00)
                : UIColor(red: 0.02, green: 0.24, blue: 0.43, alpha: 1.00)
        }
    )
    static let accentDeep = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.45, green: 0.73, blue: 0.98, alpha: 1.00)
                : UIColor(red: 0.00, green: 0.18, blue: 0.34, alpha: 1.00)
        }
    )
    static let accentSoft = accent.opacity(0.14)
    static let accentMist = accent.opacity(0.075)
    static let ink = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.93, green: 0.94, blue: 0.94, alpha: 1.00)
                : UIColor(red: 0.08, green: 0.10, blue: 0.12, alpha: 1.00)
        }
    )
    static let inkSoft = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.68, green: 0.71, blue: 0.73, alpha: 1.00)
                : UIColor(red: 0.32, green: 0.35, blue: 0.37, alpha: 1.00)
        }
    )
    static let inkMuted = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.55, green: 0.58, blue: 0.60, alpha: 1.00)
                : UIColor(red: 0.37, green: 0.39, blue: 0.40, alpha: 1.00)
        }
    )
    static let paper = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.075, green: 0.088, blue: 0.098, alpha: 1.00)
                : UIColor(red: 0.997, green: 0.996, blue: 0.988, alpha: 1.00)
        }
    )
    static let canvas = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.045, green: 0.052, blue: 0.058, alpha: 1.00)
                : UIColor(red: 0.958, green: 0.958, blue: 0.942, alpha: 1.00)
        }
    )
    static let elevated = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.105, green: 0.120, blue: 0.132, alpha: 1.00)
                : UIColor(red: 0.985, green: 0.985, blue: 0.975, alpha: 1.00)
        }
    )
    static let evidence = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.075, green: 0.120, blue: 0.155, alpha: 1.00)
                : UIColor(red: 0.930, green: 0.956, blue: 0.973, alpha: 1.00)
        }
    )
    static let separator = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor.white.withAlphaComponent(0.13)
                : UIColor.black.withAlphaComponent(0.105)
        }
    )
    static let mist = elevated
    static let heroText = Color.white
    static let heroSubtext = Color.white.opacity(0.74)
    static let positive = Color(uiColor: .systemGreen)
    static let negative = Color(uiColor: .systemRed)
    static let tabBarBackground = paper
    static let tabBarStroke = separator

    static var background: some View {
        canvas
    }

    static func fill(for surface: KabuyomiSurface) -> AnyShapeStyle {
        switch surface {
        case .hero:
            return AnyShapeStyle(accentDeep)
        case .primary:
            return AnyShapeStyle(paper)
        case .secondary:
            return AnyShapeStyle(elevated)
        case .input:
            return AnyShapeStyle(elevated)
        case .muted:
            return AnyShapeStyle(canvas)
        }
    }

    static func stroke(for surface: KabuyomiSurface) -> Color {
        switch surface {
        case .hero:
            return Color.white.opacity(0.22)
        case .primary:
            return separator
        case .secondary:
            return separator.opacity(0.9)
        case .input:
            return separator
        case .muted:
            return separator.opacity(0.72)
        }
    }

    static func shadow(for surface: KabuyomiSurface) -> Color {
        .clear
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
                .shadow(color: KabuyomiTheme.shadow(for: surface), radius: 0)
        )
    }

    func kabuyomiGlass(
        radius: CGFloat = 22,
        tint: Color = .clear,
        stroke: Color = Color.primary.opacity(0.07),
        interactive: Bool = false
    ) -> some View {
        background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(Color(uiColor: .secondarySystemGroupedBackground))
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(stroke, lineWidth: 1)
                )
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

extension View {
    func kabuyomiEdgeSwipeBack(
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        overlay(alignment: .leading) {
            if enabled {
                Color.clear
                    .frame(width: 28)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 12, coordinateSpace: .global)
                            .onEnded { value in
                                let horizontalTravel = value.translation.width
                                let verticalTravel = abs(value.translation.height)
                                guard horizontalTravel >= 72,
                                      horizontalTravel > verticalTravel * 1.4 else { return }
                                action()
                            }
                    )
                    .accessibilityHidden(true)
            }
        }
    }
}
