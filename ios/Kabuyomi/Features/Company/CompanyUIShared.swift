import SwiftUI

extension View {
    @ViewBuilder
    func kabuyomiGlass(
        radius: CGFloat = 22,
        tint: Color = KabuyomiTheme.accent.opacity(0.035),
        stroke: Color = Color.primary.opacity(0.07),
        interactive: Bool = false
    ) -> some View {
        if #available(iOS 26, *) {
            self
                .glassEffect(
                    .regular
                        .tint(tint)
                        .interactive(interactive),
                    in: RoundedRectangle(cornerRadius: radius, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(stroke, lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.055), radius: 10, x: 0, y: 4)
        } else {
            self.background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .fill(tint)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .stroke(stroke, lineWidth: 1)
                    )
                    .shadow(color: Color.black.opacity(0.055), radius: 10, x: 0, y: 4)
            )
        }
    }
}
