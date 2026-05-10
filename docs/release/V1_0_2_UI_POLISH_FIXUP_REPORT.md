# Kabuyomi v1.0.2 UI Polish Fixup Report

作成日: 2026-05-10

## 1. 結論

Kabuyomi の iOS UI を、SEC filing research workspace としてより情報密度が高く、落ち着いた、根拠確認しやすい構成へ寄せた。変更は SwiftUI の表示、レイアウト、文言、テスト補強に限定した。

主要ゲートは通過した。`xcodebuild test` は 140 tests / 0 failures、`xcodebuild build` は成功、`git diff --check` も clean。

## 2. design direction

- Overview は filing brief として、巨大カードではなく、表、行、控えめなセクションで比較しやすくした。
- Chat は assistant answer を主役にし、user bubble、sources、follow-up、composer が競合しないように密度と階層を調整した。
- Credits は account status と purchase options を分離し、50-credit pack を主要、100-credit pack を互換パックとして扱う見え方にした。
- Drawer は半透明 overlay ではなく、不透明な navigation surface に変更し、下部 content leak を防いだ。
- Source detail は raw XBRL 数値を通常表示で露出せず、ユーザーが読める metric summary を先に出す構成にした。

## 3. issues fixed

- Home / drawer: 下部のバナーや背面カードが透けて見える release-blocking な見え方を、不透明背景と明確な drawer shell で解消。
- Header controls: menu、overview、bookmark、refresh の tap target と視認性を改善。
- Filing overview: summary、metadata、major metrics、改善項目、確認論点、trend comparison を compact research brief に再構成。
- Chat: assistant answer、根拠、follow-up、composer の優先順位を整理し、follow-up clipping を避ける縦方向の compact row へ寄せた。
- Credits: 残高、現在のプラン、追加クレジット、購入管理、利用状況を分離。debug-like 情報は disclosure / debug area に後退。
- Source detail: XBRL source は「今回 / 前年同期 / 増減率」の readable summary を表示し、preview で raw number を主表示しないようにした。

## 4. files changed

- `ios/Kabuyomi/App/AppModel.swift`
- `ios/Kabuyomi/App/Theme.swift`
- `ios/Kabuyomi/Features/Company/CompanyComposer.swift`
- `ios/Kabuyomi/Features/Company/CompanyInsightsSupport.swift`
- `ios/Kabuyomi/Features/Company/CompanyLibraryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanyMessageRow.swift`
- `ios/Kabuyomi/Features/Company/CompanySourceSupport.swift`
- `ios/Kabuyomi/Features/Company/CompanySummaryDrawer.swift`
- `ios/Kabuyomi/Features/Company/CompanyTimeline.swift`
- `ios/Kabuyomi/Features/Company/CompanyTopBar.swift`
- `ios/Kabuyomi/Features/Company/CompanyView.swift`
- `ios/Kabuyomi/Features/Settings/CreditView.swift`
- `ios/Kabuyomi/Services/SubscriptionStore.swift`
- `ios/KabuyomiTests/AppModelTests.swift`
- `ios/KabuyomiTests/ConversationPromptTests.swift`
- `ios/project.yml`

Worker、SEC retrieval、API endpoint、StoreKit product ID、credit grant logic は変更していない。

## 5. screens verified

- Home / menu drawer
- Search screen
- Settings screen
- Credits main
- Credits account status / usage
- Filing overview top
- Filing overview major metrics
- Filing overview improvement / confirmation points
- 2-year / 3-year comparison area
- Chat answer
- Chat sources
- Follow-up suggestions
- Composer with credit cost
- Source detail sheet
- Smallest available simulator entry / sample state
- Dynamic Type accessibility size entry state

## 6. screenshots captured

保存先: `ios/artifacts/ui-polish-fixup-2026-05-09/after/`

- `01-home-menu-drawer.jpg`
- `02-search-screen.jpg`
- `03-settings-screen-debug-build.jpg`
- `04-credits-main.jpg`
- `05-credits-account-status.jpg`
- `06-overview-top-major-metrics.jpg`
- `08-overview-improvement-confirmation.jpg`
- `09-overview-trend-comparison-sec-action.jpg`
- `10-chat-answer-sources-followups-composer.jpg`
- `14-source-detail-sheet.jpg`
- `16-smallest-iphone-16e-entry.jpg`
- `16-smallest-iphone-16e-entry-sample.jpg`
- `17-dynamic-type-iphone-16e-entry.jpg`

Clean HEAD before screenshots は temporary worktree で試行したが、iPhone 16 への install 時に CoreSimulator が `Invalid device state` を返したため取得できなかった。temporary worktree は削除済み。

## 7. semantic safety review result

PASS。

- `AppModel.swift` の変更は user-facing copy、alert 表示、status 表示補助に限定。
- `CompanyView.swift` の source detail 変更は既存 source / metric data の表示変換のみ。
- `CreditView.swift` の変更は layout、copy、disclosure、button presentation のみ。
- `SubscriptionStore.swift` の変更は localized error copy のみ。
- answer-generation behavior、prompt policy、source-selection semantics は変更なし。
- 投資助言、buy/sell、target price、undervalued / overvalued の文言は追加していない。

## 8. sensitive-info exposure result

PASS。

- 通常の Account Status は device key suffix のみを表示。
- source detail の通常 UI では raw XBRL number を主表示せず、読みやすい metric summary を表示。
- transaction ID、Apple signed payload、token、secret、full device key を通常 UI に追加表示していない。
- Settings の DEBUG-only diagnostics は `#if DEBUG` 範囲であり、release/TestFlight path には出ない前提。

## 9. billing/product/API invariant result

PASS。

- `kabuyomi.credits.50` を主要パックとして維持。
- `kabuyomi.credits.100` を互換パックとして維持。
- subscription product IDs は変更なし。
- purchase、restore、sync、grant、transaction finish の control flow は変更なし。
- `/v1/ios/purchases/credits/complete` など API endpoint path は変更なし。
- Worker / D1 / App Store Server verification / SEC retrieval 変更なし。

## 10. iPhone SE result

iPhone SE simulator はこの環境で practical に利用できなかったため、smallest available として iPhone 16e / iOS 18.5 を確認した。

- Entry / sample state で主要 control は 44pt 以上の tap target を維持。
- Follow-up start rows と sample ticker buttons に明確な clipping は見られなかった。
- Core filing/chat/credits の full flow は iPhone 16 で確認済み。iPhone 16e では local data state の制約で full research screen までは再現していない。

## 11. Dynamic Type result

アクセシビリティ最大相当の `accessibility-extra-extra-extra-large` を iPhone 16e に設定し、entry state を撮影した。確認範囲では release-blocking な clipping は見られなかった。

制約: Dynamic Type の full filing overview / chat / credits screen は、smallest simulator の local data state 制約により未撮影。iPhone 16 の通常サイズでは主要 screen を撮影済み。

## 12. tests/commands run

- `xcodebuild test -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' -parallel-testing-enabled NO`
  - PASS: 140 tests, 0 failures
- `xcodebuild build -project ios/Kabuyomi.xcodeproj -scheme Kabuyomi -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.5' CODE_SIGNING_ALLOWED=NO`
  - PASS: `** BUILD SUCCEEDED **`
- `git diff --check`
  - PASS
- XcodeBuildMCP `build_run_sim`
  - PASS: iPhone 16
  - PASS: iPhone 16e

最初の sandboxed `xcodebuild test` は CoreSimulator / SwiftPM cache permissions で失敗したため、同一コマンドを escalated で再実行して PASS。

## 13. remaining visual risks

- Clean HEAD before screenshots は CoreSimulator install failure により取得できていない。
- iPhone 16e では entry / sample state と Dynamic Type entry state までの確認。full research screen の smallest-device screenshot は未取得。
- `03-settings-screen-debug-build.jpg` は debug build の確認画像であり、release/TestFlight の DEBUG-only surfaces ではない。

上記はいずれも、今回の presentation-only fixup を止める semantic / billing / backend risk ではない。

## 14. releaseDecision

Local UI polish fixup gate is green. Proceed to production route/TestFlight StoreKit smoke.
