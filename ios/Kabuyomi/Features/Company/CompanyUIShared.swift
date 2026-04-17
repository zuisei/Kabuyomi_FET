import SwiftUI

extension View {
    func kabuyomiGlass(
        radius: CGFloat = 26,
        tint: Color = Color.white.opacity(0.34),
        stroke: Color = Color.white.opacity(0.72)
    ) -> some View {
        background(
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
                .shadow(color: Color.black.opacity(0.08), radius: 14, x: 0, y: 10)
        )
    }
}
