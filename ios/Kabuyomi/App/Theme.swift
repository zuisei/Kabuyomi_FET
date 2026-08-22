import SwiftUI

enum KabuyomiSurface {
    case hero
    case primary
    case secondary
    case input
    case muted
}

/// 上げ下げをどの色で描くかの慣習。
/// 日本の相場慣習は「上げ=赤 / 下げ=青」、欧米は「上げ=緑 / 下げ=赤」。
/// `KabuyomiTheme.marketDirectionConvention` の1行を差し替えれば
/// `gain` / `loss` が入れ替わり、呼び出し側は一切変えなくてよい。
enum MarketDirectionConvention {
    case japanese
    case western
}

enum KabuyomiTheme {
    // v2「terminal-grade dark editorial」。ダークが設計基準で、
    // ライトは判読できることだけを保証する派生値。
    // 色は常に appearance-aware に定義し、システムのアクセシビリティ設定を殺さない。

    private static func adaptive(
        dark: (CGFloat, CGFloat, CGFloat),
        light: (CGFloat, CGFloat, CGFloat)
    ) -> Color {
        Color(
            uiColor: UIColor { traits in
                let components = traits.userInterfaceStyle == .dark ? dark : light
                return UIColor(red: components.0, green: components.1, blue: components.2, alpha: 1)
            }
        )
    }

    // MARK: - 基調(面)

    /// 最背面。純黒ではなく青みの墨。
    static let canvas = adaptive(
        dark: (0.039, 0.055, 0.075),   // #0A0E13
        light: (0.937, 0.949, 0.957)   // #EFF2F4
    )

    /// 読み面。本文が載る面。
    static let paper = adaptive(
        dark: (0.063, 0.086, 0.114),   // #10161D
        light: (1.000, 1.000, 1.000)   // #FFFFFF
    )

    /// カード・シート・行の背景。
    static let elevated = adaptive(
        dark: (0.086, 0.118, 0.153),   // #161E27
        light: (0.973, 0.980, 0.988)   // #F8FAFC
    )

    /// 入力欄・埋め込み面。読み面より一段沈める。
    static let inputWell = adaptive(
        dark: (0.051, 0.075, 0.098),   // #0D1319
        light: (0.925, 0.937, 0.949)   // #ECEFF2
    )

    /// 引用・根拠の埋め込み面。accent 側に僅かに寄せて「借りてきた文」だと分かるようにする。
    static let evidence = adaptive(
        dark: (0.055, 0.102, 0.118),   // #0E1A1E
        light: (0.918, 0.957, 0.949)   // #EAF4F2
    )

    /// 境界は影ではなく罫線で引く。
    static let separator = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor.white.withAlphaComponent(0.08)
                : UIColor.black.withAlphaComponent(0.12)
        }
    )

    /// 表・グリッドの区切りなど、separator より一段はっきりさせたい罫線。
    static let separatorStrong = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor.white.withAlphaComponent(0.14)
                : UIColor.black.withAlphaComponent(0.20)
        }
    )

    /// 罫線の標準の太さ。密度を上げても線が太って見えないようにする。
    static let hairlineWidth: CGFloat = 0.5

    // MARK: - 基調(文字)

    /// 本文。
    static let ink = adaptive(
        dark: (0.910, 0.925, 0.941),   // #E8ECF0
        light: (0.063, 0.086, 0.114)   // #10161D
    )

    /// 補助。
    static let inkSoft = adaptive(
        dark: (0.604, 0.655, 0.706),   // #9AA7B4
        light: (0.286, 0.341, 0.396)   // #495765
    )

    /// ラベル・脚注。マイクロラベルはこの階調で置く。
    static let inkMuted = adaptive(
        dark: (0.420, 0.463, 0.514),   // #6B7683
        light: (0.396, 0.447, 0.502)   // #657280
    )

    // MARK: - アクセント

    /// 操作・リンク・選択。v1 の system blue 系を置き換える teal。
    /// gain(赤) / loss(青) のどちらとも衝突しない色として選んでいる。
    static let accent = adaptive(
        dark: (0.239, 0.863, 0.765),   // #3DDCC3
        light: (0.043, 0.431, 0.369)   // #0B6E5E
    )

    /// v1 からの呼び出し名。v2 ではアクセントは1色なので `accent` と同一。
    static let accentDeep = accent

    /// accent を塗りに使ったときに載せる文字色。
    static let onAccent = adaptive(
        dark: (0.024, 0.055, 0.071),   // #061012
        light: (1.000, 1.000, 1.000)   // #FFFFFF
    )

    static let accentSoft = accent.opacity(0.16)
    static let accentMist = accent.opacity(0.08)

    // MARK: - 意味色(相場の向き)

    /// 朱。日本の相場慣習では上げ。
    private static let vermilion = adaptive(
        dark: (1.000, 0.420, 0.369),   // #FF6B5E
        light: (0.729, 0.196, 0.145)   // #BA3225
    )

    /// 青。日本の相場慣習では下げ。
    private static let azure = adaptive(
        dark: (0.306, 0.612, 0.961),   // #4E9CF5
        light: (0.086, 0.353, 0.729)   // #165ABA
    )

    /// 翠。欧米慣習に切り替えたときの上げ。
    private static let jade = adaptive(
        dark: (0.259, 0.816, 0.545),   // #42D08B
        light: (0.043, 0.451, 0.259)   // #0B7342
    )

    /// 上げ下げの慣習はここ1行で切り替える。
    static let marketDirectionConvention: MarketDirectionConvention = .japanese

    /// 上昇・増加。色だけに意味を持たせないため、必ず矢印か符号を併記すること。
    static var gain: Color {
        marketDirectionConvention == .japanese ? vermilion : jade
    }

    /// 下降・減少。同上。
    static var loss: Color {
        marketDirectionConvention == .japanese ? azure : vermilion
    }

    /// 注意・保留。購入保留や取得失敗など「まだ決まっていない」状態。
    static let caution = adaptive(
        dark: (0.910, 0.690, 0.294),   // #E8B04B
        light: (0.573, 0.396, 0.043)   // #92650B
    )

    static var gainSoft: Color { gain.opacity(0.16) }
    static var lossSoft: Color { loss.opacity(0.16) }
    static var cautionSoft: Color { caution.opacity(0.16) }

    // MARK: - 意味色(状態)

    // `positive` / `negative` は「成功 / 失敗」の状態色であって、相場の向きではない。
    // 上げ下げには `gain` / `loss` を使うこと。

    /// 成功・完了。
    static let positive = adaptive(
        dark: (0.259, 0.816, 0.545),   // #42D08B
        light: (0.043, 0.451, 0.259)   // #0B7342
    )

    /// エラー・停止。
    static let negative = adaptive(
        dark: (1.000, 0.435, 0.400),   // #FF6F66
        light: (0.694, 0.145, 0.114)   // #B1251D
    )

    // MARK: - 数字の格

    /// 主要数値。大きく、細く、tabular。
    static func figure(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        .system(style, design: .default, weight: weight).monospacedDigit()
    }

    /// マイクロラベル(「売上高」等)のトラッキング。
    static let microLabelTracking: CGFloat = 0.9

    // MARK: - v1 からの互換名

    static let mist = elevated
    static let heroText = Color.white
    static let heroSubtext = Color.white.opacity(0.74)
    static let tabBarBackground = paper
    static let tabBarStroke = separator

    static var background: some View {
        canvas
    }

    static func fill(for surface: KabuyomiSurface) -> AnyShapeStyle {
        switch surface {
        case .hero:
            return AnyShapeStyle(elevated)
        case .primary:
            return AnyShapeStyle(paper)
        case .secondary:
            return AnyShapeStyle(elevated)
        case .input:
            return AnyShapeStyle(inputWell)
        case .muted:
            return AnyShapeStyle(canvas)
        }
    }

    static func stroke(for surface: KabuyomiSurface) -> Color {
        switch surface {
        case .hero:
            return separatorStrong
        case .primary:
            return separator
        case .secondary:
            return separator
        case .input:
            return separatorStrong
        case .muted:
            return separator
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
                .fill(KabuyomiTheme.elevated)
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(stroke, lineWidth: 1)
                )
        )
    }

    /// 「売上高」「前年同期比」のようなマイクロラベル。
    /// 小さく、トラッキングを広げ、inkMuted に落として数字を前に出す。
    func kabuyomiMicroLabel() -> some View {
        font(.caption2.weight(.semibold))
            .tracking(KabuyomiTheme.microLabelTracking)
            .foregroundStyle(KabuyomiTheme.inkMuted)
    }
}

/// 1本の細罫。密度を上げた面では境界をこれだけで表す。
struct KabuyomiHairline: View {
    var color: Color = KabuyomiTheme.separator

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(height: KabuyomiTheme.hairlineWidth)
            .accessibilityHidden(true)
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
