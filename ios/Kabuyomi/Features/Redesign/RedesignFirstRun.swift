import SwiftUI

/// v2 IA Phase 6(docs/ui-redesign-v2/V2_IA_SPEC.md「Phase 6」節)。
/// 初回動線(ようこそ 1枚 → スターター複数選択)と、スキップした人を受け止める空状態。
///
/// ここに置く文言は仕様で確定しているものだけで、言い換えは作らない。
/// ミッション文だけは既存文言なので `RedesignDiscoveryMission` を**そのまま**使い、
/// この enum には持たない(2か所に同じ文字列を置くと、片方だけ動く日が来る)。
enum RedesignFirstRunCopy {
    static let welcomePrimary = "銘柄を選んではじめる"
    static let welcomeSecondary = "あとで"

    static let starterPickerTitle = "気になる会社を選ぶ"
    static let starterPickerStart = "はじめる"

    static let emptyTitle = "銘柄を追加しよう"
    static let emptyBody = "会社を追加すると、新しい決算がここに流れます。"
    static let emptyAction = "銘柄をさがす"

    /// 会社がどこにも無いときのアスクバーの会社チップ。
    static let askContextPlaceholder = "銘柄を選ぶ"
}

/// スターターピッカーが実際に保存へ渡す銘柄と、その順序。
///
/// 選んだ順をそのまま返す(盤面の並びが起動ごとに揺れないため)。
/// すでに保存済みのものは落とす — 通すと `AppModel.saveTicker` が
/// 「すでに保存済みです。」のダイアログを返し、初回動線の最中に
/// 押した覚えのない警告が出る。
func redesignStarterPickerSaveOrder(
    selection: [String],
    isAlreadySaved: (String) -> Bool
) -> [String] {
    selection.filter { !isAlreadySaved($0) }
}

/// スターターピッカーの CTA を押せるか。1社でも選んでいれば押せる。
///
/// 純関数にしてあるのは、「選択ゼロで保存に入れてしまう」経路が
/// ビューの `disabled` の書き間違いひとつで開くため。単体テストで固定する。
func redesignStarterPickerCanStart(selectionCount: Int) -> Bool {
    selectionCount > 0
}

// MARK: - ボタン

/// 一等地の主 CTA。塗りは accent、載せる文字は onAccent
/// (paper や白だとライトモードで読めなくなる — CreditView と同じ約束)。
struct RedesignPrimaryButton: View {
    let title: String
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.bold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 50)
                .foregroundStyle(isEnabled ? KabuyomiTheme.onAccent : KabuyomiTheme.inkMuted)
                .background(
                    isEnabled ? AnyShapeStyle(KabuyomiTheme.accent) : AnyShapeStyle(KabuyomiTheme.elevated),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(isEnabled ? Color.clear : KabuyomiTheme.separator, lineWidth: KabuyomiTheme.hairlineWidth)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // 押せないことを色だけで言わない。`disabled` は VoiceOver に
        // 「淡色表示」として届き、Switch Control でも飛ばされる。
        .disabled(!isEnabled)
    }
}

/// 副 CTA。塗らない。主 CTA と同じ高さを取り、押せる面積だけ揃える。
struct RedesignSecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - ようこそ(1枚だけ)

/// 初回インストールの1枚目。カルーセルもページドットもイラストも持たない
/// (3枚組ウォークスルーはテンプレ臭そのものなので仕様で禁じられている)。
///
/// 見出しは既存のミッション文をそのまま流用する。ここで新しい売り文句を書くと、
/// 法務上の断り書き(「投資助言や売買推奨は行いません。」)が付いていない
/// 二つ目のミッション文が生まれてしまう。
struct RedesignWelcomeView: View {
    let start: () -> Void
    let skip: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 12)

            ScrollView {
                RedesignDiscoveryMission(size: .welcome)
                    .padding(.horizontal, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)

            Spacer(minLength: 12)

            VStack(spacing: 6) {
                RedesignPrimaryButton(title: RedesignFirstRunCopy.welcomePrimary, action: start)
                    .accessibilityIdentifier("redesign.welcome.start")
                RedesignSecondaryButton(title: RedesignFirstRunCopy.welcomeSecondary, action: skip)
                    .accessibilityIdentifier("redesign.welcome.skip")
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(KabuyomiTheme.canvas)
        // ここに識別子は付けない。素の VStack に付けると子孫まで降りていって
        // 主 CTA と副 CTA の識別子を両方この1つで上書きする
        // (アスクバーで踏んだのと同じ罠。シミュレータ実機確認 2026-08-22。
        //  UI テストが「あとで」を見失い、覆いが外れないまま以降が全滅した)。
        // この面の存在は2つのボタンで確かめる。
    }
}

// MARK: - 空状態の CTA

/// 「銘柄を追加しよう」の一段。ストリームとサマリー盤面で同じ形を使う。
///
/// ミッション文を**置き換えない**。スキップした人がミッション文に一度も
/// 行き当たらなくなると、法務上の断り書きごと画面から消える。
/// この段は上に足すもので、下にミッション文が残る。
struct RedesignEmptyCallToAction: View {
    let action: () -> Void
    var identifierPrefix: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(RedesignFirstRunCopy.emptyTitle)
                .font(.title3.weight(.bold))
                .foregroundStyle(KabuyomiTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(RedesignFirstRunCopy.emptyBody)
                .font(.subheadline)
                .foregroundStyle(KabuyomiTheme.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            RedesignPrimaryButton(title: RedesignFirstRunCopy.emptyAction, action: action)
                .accessibilityIdentifier("\(identifierPrefix).empty.find")
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 12)
        .padding(.bottom, 6)
    }
}

// MARK: - スターターの選択行

/// スターターピッカーの1行。盤面行と同じ体系で読めるように、
/// モノグラム(`RedesignTickerMonogram`)と ticker の字送りを盤面行から借りている。
///
/// 選択は色だけで言わない。塗りの変化に加えて必ずチェックの字形が出る
/// (`checkmark.circle.fill` / `circle`)。VoiceOver には
/// `.isSelected` の trait で届く。
struct RedesignStarterChoiceRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let ticker: String
    let companyName: String
    let detail: String
    let isSelected: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .top, spacing: 11) {
                RedesignTickerMonogram(ticker: ticker)
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 2) {
                    Text(ticker)
                        .font(KabuyomiTheme.figure(.subheadline, weight: .semibold))
                        .foregroundStyle(KabuyomiTheme.ink)
                        .lineLimit(1)
                    Text(companyName)
                        .font(.footnote)
                        .foregroundStyle(KabuyomiTheme.inkSoft)
                        .multilineTextAlignment(.leading)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(KabuyomiTheme.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(isSelected ? KabuyomiTheme.accent : KabuyomiTheme.inkMuted)
                    .padding(.top, 2)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 7)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(ticker)、\(companyName)、\(detail)")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("redesign.picker.starter.\(ticker)")
        .listRowBackground(KabuyomiTheme.paper)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
    }
}
