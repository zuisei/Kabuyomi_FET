# v1.2 提出シート(2026-08-21)

App Store Connect にそのまま貼れる形にまとめたもの。根拠は `ASO_PROPOSAL_2026-08.md`、診断は `../../HANDOFF_2026-08-21.md`。

## 1. ストア情報(名称・サブタイトル・キーワードは新バージョン提出時にしか変更できない)

**名称**(22字 / 上限30)

```
米国株の決算を日本語で読む Kabuyomi
```

**サブタイトル**(21字 / 上限30)

```
10-K/10-QをAIが要約・質問に回答
```

**キーワード**(64字 / 上限100・カンマ区切り・スペース禁止)

```
決算書,SEC,財務,四半期,翻訳,投資,分析,英語,銘柄,企業分析,決算資料,決算分析,財務諸表,米国企業,アニュアルレポート
```

文字数・スペース混入・名称/サブタイトルとの重複は検算済み。重複ゼロ(Appleは3枠を合算インデックスするため、重複は枠の無駄)。

**iPad スクショは不要**: `ios/project.yml` の `TARGETED_DEVICE_FAMILY: "1"` = iPhone 専用。App Store Connect が iPad 枠を要求することはない。

**確認しておきたいリスク(未検証)**: 推奨名は説明文にブランドを後置した形で、App Store Review Guideline **2.3.7**(アプリ名にアプリ名でない説明を含めない)に触れる可能性がある。
リジェクトされてもビルドではなくメタデータの差し戻しで済むが、審査1周分は失う。
気になる場合のフォールバックは **`Kabuyomi 米国株の決算を日本語で読む`**(ブランド先頭・22字)。
検索寄与は先頭側がやや強いので順位は落ちうるが、現状(キーワードゼロ)よりは確実に良い。

## 2. スクリーンショット(差し替え必須)

現在ストアに載っている画像は **v1.2 で削除された画面**(旧 `ConversationEntryView` / 旧 `SearchView`)を写している。App Review はスクショが実機を正確に表すことを要求するため、差し替えないままの提出はリジェクト要因になり得る。

差し替え用は作成済み。**1320×2868 = Apple 6.9インチ規定サイズ**(実寸検証済み)。

| 順 | ファイル | 見出し | 副文 |
|---|---|---|---|
| 1 | `appstore-assets/appstore_01.png` | 米国株の決算を、日本語で読む。 | SEC提出の 10-K / 10-Q を、そのまま確認できます |
| 2 | `appstore-assets/appstore_02.png` | 売上・利益・CFを、要点から。 | 主要な数値と前年同期比を、提出資料ベースで表示 |
| 3 | `appstore-assets/appstore_03.png` | すべての記述に、出典があります。 | 答えの元になった箇所を一覧で確認できます |
| 4 | `appstore-assets/appstore_04.png` | 英語の原文も、すぐ隣に。 | SEC の原文リンクつき。気になる一節は日本語に翻訳 |

1枚目の見出しが提出する**アプリ名と完全に一致**している(検索 → ページで印象が繋がる)。

組版し直す場合は `appstore-assets/make_shots.py`(素材は同フォルダ `raw/`)。同じ画像が `artifacts/appstore-2026-08/out/` にもあるが、**4枚ともハッシュ一致**なのでどちらを使っても同じ。

## 3. バージョン

`ios/project.yml` の `MARKETING_VERSION: 1.2` / `CURRENT_PROJECT_VERSION: 6`。

## 4. 提出後にやること

`aso_rank.py`(`/Users/0xt4/t4dano/statik/`)でベースライン取得済み。反映後に再実行して比較する。

観測する語: `米国株` `米国株 決算` `米国株 決算 日本語` `決算書 AI` `10-K` `決算書 読み方` `企業分析 AI` `SEC 決算`

提出前ベースライン(2026-08-21・日本ストア・深さ50):

| 検索語 | 順位 |
|---|---|
| 米国株 / 米国株 決算 / 米国株 分析 / 決算書 AI / 10-K / 決算書 読み方 | 圏外(>50) |
| 米国株 決算 日本語 | 41 |
| 企業分析 AI | 29 |
| SEC 決算 | 1 |

## 5. テストゲートの状態

正式なユニットテストゲートは CI(`.github/workflows/pull-request-ci.yml`)と同じ以下。**`StoreKitEndToEndTests` は意図的に除外**されている(hosted runner で購入が無限に pending になり得るため。`docs/ui-redesign/COMPLETION_REPORT.md` に記載)。

```
xcodebuild test -project Kabuyomi.xcodeproj -scheme Kabuyomi \
  -only-testing:KabuyomiTests \
  -skip-testing:KabuyomiTests/StoreKitEndToEndTests \
  -destination "platform=iOS Simulator,id=<iOS26のシミュレータUDID>" \
  -derivedDataPath .build -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
```

**ローカルで回すときは末尾2つの署名フラグを外すこと。** GitHub の hosted runner では通るが、ローカルの署名環境では
`Simulator device failed to launch app.kabuyomi.ios` / `Application failed preflight checks` で
テストランナーごと起動に失敗し、**テストが1件も実行されないまま `** TEST FAILED **` になる**(2026-08-21 に再現)。
`CURRENT_SHIPPING_TRUTH.md` の "Simulator UI validation must use a normally signed local build" と同根。

また `-parallel-testing-enabled NO` は必須。並列にすると `Clone N of ...` が生成され、
クローンの1台が起動に失敗して実行が途中で止まることがある。

**2026-08-21 実測**: 上記コマンド(署名フラグなし)を iPhone 17 Pro Max / iOS 26.4 で実行し、
**204件実行 / 失敗0 / `** TEST SUCCEEDED **`**。

### 2026-08-21 に直したもの

`AppModelTests` と `APIClientTests` のテスト用資格情報が `expiresAt: "2026-08-10T00:00:00.000Z"` を**ハードコード**していた。`AccountCredential.isExpired`(`ios/Kabuyomi/Services/DeviceIdentityStore.swift`)は `Date()` と比較するため、**8月10日を境に2件が自動的に落ち始めていた**。同ファイル群の既存慣習に合わせ `2099-01-01T00:00:00.000Z` に変更(製品コードは変更なし)。

### StoreKitEndToEndTests について

ローカルで単体実行すると4件中3件が落ちる。原因は製品コードではなく **`SKTestSession` の制御APIが全滅**していること:

```
[SKTestSession] Error saving configuration file: SKInternalErrorDomain Code=3
[SKTestSession] Error clearing overrides:        SKInternalErrorDomain Code=3
[SKTestSession] Error setting storefront to JPN: SKInternalErrorDomain Code=3
```

`disableDialogs` が効かず購入シートが実際に表示され、誰も押さないまま**タイムアウトして `user_cancelled`** になる(1件は108秒かかった)。`storefront = "JPN"` も効かずアプリログは `country=USA` のまま。シミュレータを `simctl erase` しても再現するため端末状態の問題ではない。

`docs/ui-redesign/FEATURE_PARITY.md` には「purchase success / user cancellation / Ask to Buy pending / unfinished consumable recovery / subscription restore はすべて StoreKit Test を通過」と記録されているので、**当時は通っていた**。Xcode かシミュレータランタイムの更新に伴う環境側の退行と見られる。

課金ライフサイクルの証跡は元々 TestFlight / 実機で取る方針(`CURRENT_SHIPPING_TRUTH.md`)なので、この3件は iOS 提出のブロッカーではない。

## 6. 未確認のまま残っているもの

このシートで検証したのはユニットテストゲート・スクショの実寸・ASOの文字数まで。以下は手つかず。

- **銘柄ユニバースの `snapshotUpdatedAt` が 2026-07-11**(約6週間前)。更新経路が cron か手動かを確認していない
- **リリース証跡マニフェストが古い candidate(`56c0c209`)に紐付いており、通常の deploy guard は失敗する**(`CURRENT_SHIPPING_TRUTH.md`)。iOS 提出は止めないが Worker を触るなら要対応
- **StoreKit / TestFlight の実機ライフサイクル証跡は未取得**(自分で課した品質ゲート)
- **ランディングページ未デプロイ**(`legal-site/public/lp/index.html`。Cloudflare Pages のアカウント操作が必要)
- **会話UIの構造的な脆さは未解決**(`structureAssistantMessage` のヒューリスティック分解。方針(a)API側で構造化JSON / (b)UI簡素化 は未決)
- **アプリの実画面はこのセッションでは未確認**(前セッションの記録に依拠)

## 7. App Store Connect への入力状況(2026-08-21 実施)

Apple ID 6762764426 / iOS App 1.2「Prepare for Submission」に対して以下を入力・保存済み。

| 項目 | 変更前 | 変更後 |
|---|---|---|
| 名称 | `Kabuyomi` | `米国株の決算を日本語で読む Kabuyomi`(22字) |
| サブタイトル | `SEC提出書類を日本語で理解。` | `10-K/10-QをAIが要約・質問に回答`(21字) |
| キーワード | `株,米国株,決算,SEC,10-K,10-Q,投資,企業分析,財務,AI,チャット,リサーチ,開示資料,売上,利益率,リスク` | 本シート1章の15語(64字) |
| What's New | 空 | v1.2 のUI刷新3点(132字) |
| スクリーンショット | 6.5" に6枚(旧UI) | **6.9" に4枚**。6.5"/6.3" は "Using 6.9" Display" で継承 |

**旧スクリーンショットは削除した**(`01_conversation_research.png` `02_choose_ticker.png` ほか計6枚)。
削除済み画面を写しており、残すと 6.5" 端末に古い画像が出るため。1.0.2 の公開ページには当面表示されているので必要なら取得可能。

アップロード直後は 6.9" の並びが 01→02→**04→03** と入れ替わったため、一度削除して1枚ずつ入れ直した。
**現在は 01→02→03→04**(米国株の決算を→売上・利益・CFを→すべての記述に→英語の原文も)。
ドラッグでの並べ替えは効かないので、順序が問題になる場合は1枚ずつアップロードすること。

変更しなかったもの(いずれも v1.2 の内容と矛盾せず、そのままで問題なし):

- Description(投資助言でない旨の免責を含む)
- サポートURL / マーケティングURL / Copyright / 審査連絡先 / 審査メモ
- リリース方法 = **Manually release this version**、段階リリースなし、**Keep existing rating**(評価リセットしない)
- Promotional Text は**空のまま**(任意項目。新バージョン提出なしで随時変更できる枠なので、使うなら後からでよい)

## 8. 提出までに残っていること(私が代行できないもの)

1. **Apple Developer Program License Agreement の承諾**
   App Store Connect が「更新された契約を **Account Holder** が承諾しないと既存アプリの更新・提出はできない」と表示している。法的契約の承諾のため代行しない。

2. **ビルドのアップロードと選択**
   バージョンページの Build 欄は "Add Build" のまま。ローカルには以下が揃っていない。
   - **Apple Distribution 証明書**(`security find-identity -v` は Apple Development 2件のみ。全キーチェーン確認済み)
   - **App Store Connect API キー**(`~/.appstoreconnect/private_keys` なし)、および認証用の環境変数

   `~/Library/Developer/Xcode/Archives/2026-07-14/Kabuyomi 2026-07-14 15.52.05.xcarchive` に
   **1.2 / build 6 のアーカイブが既にある**が、Apple Development 署名なので配布用に再署名が必要。
   Xcode の Organizer から Distribute App を実行するのが最短(署名証明書の作成とアップロード認証を Xcode が処理する)。

3. **年齢レーティングの新設問**(社会機能に関する質問)
   App Information に新しい質問が追加されており、回答期限は 2026-09-07。
   ただし「そのセクションの他の回答を更新する場合は即時必要」と記載があるため、提出時に求められる可能性がある。
