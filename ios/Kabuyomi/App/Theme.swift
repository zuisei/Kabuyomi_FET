import SwiftUI

/// 面の階層。v2 では影を使わないので、面の違いは塗りと細罫だけで表す。
enum KabuyomiSurface {
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

    /// 最背面。青みの濃紺は「AI が作った画面」の定番だとオーナー指摘(2026-08-24)。
    /// 暖色に寄せた墨。紙とインクの側へ世界を移す。
    static let canvas = adaptive(
        dark: (0.090, 0.082, 0.067),   // #171511
        light: (0.937, 0.922, 0.886)   // #EFEBE2
    )

    /// 読み面。本文が載る面。生成りの紙。
    static let paper = adaptive(
        dark: (0.122, 0.114, 0.090),   // #1F1D17
        light: (0.992, 0.984, 0.965)   // #FDFBF6
    )

    /// カード・シート・行の背景。
    static let elevated = adaptive(
        dark: (0.149, 0.137, 0.110),   // #26231C
        light: (0.965, 0.949, 0.914)   // #F6F2E9
    )

    /// 入力欄・埋め込み面。読み面より一段沈める。
    static let inputWell = adaptive(
        dark: (0.106, 0.098, 0.078),   // #1B1914
        light: (0.918, 0.898, 0.855)   // #EAE5DA
    )

    /// 引用・根拠の埋め込み面。accent 側に僅かに寄せて「借りてきた文」だと分かるようにする。
    static let evidence = adaptive(
        dark: (0.118, 0.129, 0.078),   // #1E2114
        light: (0.929, 0.941, 0.875)   // #EDF0DF
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

    /// 本文。青白ではなく生成りの白。
    static let ink = adaptive(
        dark: (0.929, 0.914, 0.875),   // #EDE9DF
        light: (0.110, 0.102, 0.082)   // #1C1A15
    )

    /// 補助。
    static let inkSoft = adaptive(
        dark: (0.663, 0.635, 0.580),   // #A9A294
        light: (0.341, 0.322, 0.275)   // #575246
    )

    /// ラベル・脚注。マイクロラベルはこの階調で置く。
    static let inkMuted = adaptive(
        // 墨パレット移行時に実測(2026-08-24): #8E8676 は paper #1F1D17 上で 4.6:1、
        // light は #6B6455 が紙 #FDFBF6 上で 5.7:1。どちらも小サイズ AA を満たす。
        dark: (0.557, 0.525, 0.463),   // #8E8676
        light: (0.420, 0.392, 0.333)   // #6B6455
    )

    // MARK: - アクセント

    /// 操作・リンク・選択。ネオンのミント(#3DDCC3)は濃紺と組で「AI 画面」の
    /// 定番だった(2026-08-24 オーナー指摘)。抹茶へ。gain(朱) / loss(群青) /
    /// caution(琥珀)のどれとも衝突しない色相として選んでいる。
    static let accent = adaptive(
        dark: (0.663, 0.769, 0.416),   // #A9C46A(paper 上 8.7:1)
        light: (0.306, 0.431, 0.157)   // #4E6E28(紙上 5.7:1)
    )

    /// accent を塗りに使ったときに載せる文字色。
    static let onAccent = adaptive(
        dark: (0.122, 0.141, 0.031),   // #1F2408(accent 上 8.2:1)
        light: (1.000, 1.000, 1.000)   // #FFFFFF(accent 上 5.9:1)
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

    static var background: some View {
        canvas
    }

    static func fill(for surface: KabuyomiSurface) -> AnyShapeStyle {
        switch surface {
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

}

extension View {
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
