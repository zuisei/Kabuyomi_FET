# Worker / sec-fetcher 全読み点検(2026-08-22)

対象: `workers/src` 148ファイル 47,047行 + `sec-fetcher` 1,674行 = **48,721行**
方針: 全ファイルを読む。バグ型が確立した時点で全ソースへ機械的に横断適用する。

**修正はまだ入れていない**(「全部読んでから決める」方針)。
唯一の例外は、読解中に実測で確定した RF-1(下記)を先に閉じた分。

---

# A. 実測で確定したバグ

## A-1 【最重要】無関係な業種の用語が回答に混入する — 同型9箇所

### 発端(修正済 / commit 68c2b70)

`inferDriverLabels`(`final-answer-language.ts`)の
`add("DRAM・NAND需要", /dram|nand/)` に語境界が無く、**"dramatically" に部分一致**していた。

実測(`workers/testbench/runs/2026-07-04-prompt-v2-full-smoke-r53.jsonl`):

```
ticker=KO   A: 前問の売上要因は、販売数量、DRAM・NAND需要 …
ticker=LLY  A: 前問の売上要因は、販売数量、DRAM・NAND需要 …
```

コカ・コーラとイーライリリーが「DRAM・NAND需要」を売上要因として提示していた。
`responsePath` は `openai`、ラベルは `*_source_backed_repair` なので、
ユーザーには出典に基づく回答として見える。**数値を含まないため numeric-alignment では捕まらない。**

### 横断スイープで追加発見(未修正)

全 `src/` から `add("ラベル", /pattern/)` を機械抽出し、候補35件を英単語コーパスで検証。
**意味が無関係なのに一致するもの5箇所**:

| 場所 | パターン | 誤って一致する語 | 付くラベル |
|---|---|---|---|
| `final-answer-language.ts:512` | `asm` | enthusiasm, sarcasm, spasm, chasm, **plasma** | 販売数量・稼働率(航空) |
| `final-answer-language.ts:510` | `fare` | **welfare**, warfare, fanfare | 価格・単価(航空) |
| `final-answer-language.ts:511` | 裸の `mix` | **mixed**, mixture | 製品・顧客ミックス |
| `final-answer-language.ts:505,509` | `casm` | sarcasm | 営業費用・単位コスト |
| `evidence-fallback.ts` | `ASP` / 裸の `mix` | grasp / mixed | 平均販売価格・製品ミックス |

`asm`/`fare`/`casm` は **DAL(デルタ航空)向けラベル**だが、DAL は本番の追跡銘柄に無い。
**ベンチの残骸が他業種を汚染する構図。**

### さらに別種(未修正)

`fallback.ts:1104` と `deterministic.ts:~700` の
`add("がん検査・診断", /cancer|tumor|screening|diagnostic/i)` が汎用語に一致。実測:

```
"wafer screening" "diagnostic tools" "credit screening"
"screening of employees" "diagnostics software" "self-diagnostic"
```

→ **半導体やソフトウェア企業が「がん検査・診断を主な事業にする会社」と説明されうる。**

## A-2 本番32件中30件が「銀行」と誤判定される

`gemini/fallback.ts` の `isBankLike` は
`/(jpm|bank|financial|deposits?|loans?|...)/` を
**ticker + 社名 + mdaText の先頭5000字**に当てるだけ。
MD&A には "financial condition" / "financial statements" が必ず出る。

**実測: 本番 v9 レコード32件中30件が true。** Apple も Coca-Cola も Tesla も Eli Lilly も銀行扱い。

影響: `missingSourceTypesForNonHard(intent="liquidity_debt")` が銀行用リスト
(deposits / credit quality / capital ratios)を返し、ユーザー向けの
**「確認すべき箇所」に「預金」「信用品質」が出る**。

同概念の `isFinancialFilingForFinalizer`(`response-finalizer.ts`)は
明示ティッカー集合 + 社名のみの `\b` 付き正規表現で厳格。**同じ概念の実装が2つあり挙動が正反対。**

## A-3 キュレーション表のキーが本番銘柄と合っていない

`deterministic.ts` の `TICKER_BUSINESS_OVERVIEWS` /
`TICKER_REVENUE_BREAKDOWNS` / `issuerSignalLabels`(各15銘柄):

```
本番30銘柄中 表に有り: 12  (NVDA AAPL MSFT AMZN TSLA WMT JPM LLY V XOM MU CAT)
              表に無し: 18  (GOOG AVGO META BRK-B JNJ ORCL MA AMD COST NFLX
                            BAC ABBV CVX PLTR HD INTC PG CSCO)
表にあるが本番で追跡していない: GOOGL, KO, DAL
```

**キー不一致バグ: 表は `"GOOGL"` だが本番の追跡は `"GOOG"`。Alphabet は一生ヒットしない。**

`summarizeSegmentPerformance` は `issuerSignalLabels[ticker]` が無いと
`issuerSignals` が空になり**セグメント/地域の強弱を一切検出できない**。
表に無い18銘柄では常に「伸びた具体的なセグメント・地域・製品を特定できません」を返す。
→ **12銘柄と18銘柄で品質の崖。**

## A-4 最終整形が固有名詞を壊す

`sanitizeFinalUserFacingAnswer`(約200個の無差別 regex 置換)。関数を直接呼んだ実測:

```
"Emerging Markets の需要"    → "Emerging 市場業務 の需要"
"the Pioneer transaction"    → "the Pioneer 取引件数"
"trading volume が増加"      → "trading 販売数量 が増加"
"Total Liabilities は増加"   → "Total 負債 は増加"
"This transaction also drove higher marketing expense."
                             → "This 取引件数 また drove マーケティング費用の増加."
```

冪等ではある。原因は `/\bMarkets?\b/→市場業務`、`/\btransactions?\b/→取引件数`、
`/\bvolume\b/→販売数量` 等の文脈無視の全置換。

コード内に「壊してから個別に戻す」痕跡が多数あり、常態化している:

```ts
.replace(/Re資料 Industries/g, "資源産業")             // source→資料 で壊れた CAT
.replace(/Productivity\s+and\s+事業内容\s+Processes/)  // Business→事業内容 で壊れた MSFT
.replace(/\bUniform Rental and Facility サービス/)     // Services→サービス で壊れた Cintas
.replace(/price-コスト/gi, "価格とコスト")             // costs?→コスト で壊れた price-cost
```

**ベンチに出た固有名詞だけが個別に救済され、それ以外は壊れたまま出る。**

## A-5 出典の無い記述が出典チップ付きで出る

3系統ある。いずれも実ソースを出典として添付する。

1. **企業固有の完全定数回答** — `buildWmtDurabilitySynthesis` は Walmart 向けに
   「既存店売上にECが寄与し…Walmart+の会員利用…」を **filing の内容に関係なく**返す。
   ラベルは `q04_retail_durability_source_backed_repair`(**source_backed を名乗る**)。
   実測でベンチ6件発火。JPM / GOOGL 版も同型。CAT 版はモデルの特定出力文字列を丸ごと別文に置換する。
2. **事業内容の定数テーブル** — `buildTickerBusinessOverviewAnswer` は
   「{社名}は、{定数}で収益を得ている会社です。」を返す。
   コメントに `Prefer its stable, reviewed overview` と明記され、**実抽出より優先**される。
3. **もう1つの定数表** — `fallback-known-business.ts` に PH / CRWD / CEG / INTU の
   事業説明が定数であり、`selectKnownBusinessSourceId` が「最初の md_a チャンク」を機械的に添付。
   4銘柄とも本番の追跡リストに無い。

---

# B. 要判断(実装ミスではないが運用上の選択)

## B-1 sandbox の Apple 取引が本番で通る

本番の `APPLE_APP_STORE_SERVER_ENVIRONMENT = "auto"` は `["production","sandbox"]`。
`fetchSignedTransactionInfo` も production→sandbox の順で両方叩く。
(取引がどちらの環境か事前に判らないため **Apple が推奨する形**であり実装ミスではない)

問題は**下流が environment で区別していないこと**:

- `routes/credit-purchase-grant.ts` に environment の参照が1つも無い
  → **sandbox 購入でも本番クレジットが付与される**
- `entitlements.ts` は environment を principal 導出に混ぜているので
  sandbox 購読が本番購読を乗っ取ることは無い(隔離はできている)

本番 App Store ビルドの StoreKit は production を使うため一般ユーザーは不可。
**TestFlight ビルドのユーザーが無償で本番クレジットを得られる。** 意図的ならこのままでよい。

## B-2 `finish_reason` を取得しているのに使っていない

OpenAI の `finish_reason` は `parseOpenAIChatCompletionPayload` が取得して
ログに載せるだけで**どこでも分岐に使っていない**。
上限(chat 1800 / summary 2500)で切られると JSON が途中で終わり
`json_parse_failed` → フォールバック。再試行は**同じ上限**なので同じ所で切れる。

→ 引き継ぎの既知指摘「OpenAI 要約のトークン上限切れ再試行」の正体。
`finishReason === "length"` を見て上限を上げて1回だけ再試行すれば閉じる。

## B-3 その他

- `quota.ts`: `markPurchaseTransactionGranted` だけ `assertPurchaseProjectionUpdated` が無い。
  他3つの `mark*` は全て 0行更新で 409 を投げる。ここだけ黙って通り、
  DO(権威)は付与済みなのに D1 projection が乖離しうる。
- `user-quota.ts`: `refundChat` が**日次リセット境界をまたぐと別の日のカウンタを減らす**。
  23:59消費 → 00:01返金 で当日分が1回無料になる。`chatsUsed>0` ガードで負にはならない。
  クレジット課金が有効な現状 legacy_chat は主経路ではない。
- `user-quota.ts`: `pruneOldCreditOperations` は `list({limit:500})` で
  **辞書順先頭500件しか見ない**。operationId は時刻順でないため古い記録が残りうる。
- `source-gate.ts`: **MA(Mastercard)が "card" の部分一致で bank に誤分類**され、
  存在しない「純利息収入の議論」を要求してゲートが常に落ちる。同業の Visa は general。
- `source-gate.ts`: `normalizeSector` は本番30銘柄中**21銘柄が general** に落ちる(実測)。
- `clients/web-search.ts`: DuckDuckGo HTML を**Chrome の UA を騙って**スクレイプする。
  現状 `webSupplementEnabled=false` なので死んだ経路。
- 法務: `routes/legal.ts` の改訂日は修正済(2026-07-11 に統一)。

---

# C. 読んで問題が無かったところ

推測で不安を残さないため、確認した範囲を明示する。

## お金(最重点)

| 対象 | 判定 |
|---|---|
| `user-quota.ts` (3,105行) 完読 | 予約→コミット/解放の**全経路**が `blockConcurrencyWhile` + `withStorageTransaction`。`expireReservation` は `status !== "reserved"` で冪等。`restoreReservationAllocations` は legacy_chat も不変条件付きで戻す。月次分は期間一致時のみ復元、期限切れ広告ロットは復元しない |
| `quota.ts` (1,743行) 完読 | 全 mutate が ledger/grant を永続化し、失敗時は `enqueueCreditAuditRepair` に積む。`credit_ledger.operation_id` は UNIQUE なので `INSERT OR IGNORE` が正しく冪等 |
| 返金・返金取消 | operationId 冪等 + `purchaseRefundInvariantError` が**毎回**集計債務と個別債務の一致を検証 |
| クレジット配分 | 期限が早いバケット順 → welcome → purchased。最後に `if (remaining !== 0) throw` の不変条件 |
| principal migration | lock→export(digest)→apply(digest照合)→tombstone の各段が冪等。対象側に既存 state があれば409 |
| **二重消費・返却漏れ** | **見つからなかった** |

## 認証・署名

| 対象 | 判定 |
|---|---|
| `apple-signed-data.ts` | Apple 公式 `@apple/app-store-server-library` と実物のルートCA(G2/G3)。自前実装ではない。payload の environment も照合 |
| `verifyCreditPurchaseWithApple` | クライアント提供 JWS を信用せず**必ず Apple サーバから取り直して**検証、`revocationDate` も見る |
| `admob-ssv.ts` | Google の手順どおり(`&signature=` 前が署名対象、ECDSA P-256/SHA-256、verifier-keys.json から keyId 一致鍵) |
| `apple-notifications-v2.ts` | 署名検証 → payload digest で重複判定 → 5分の stale 再取得。REFUND/REFUND_REVERSED を冪等処理、CONSUMPTION_REQUEST/ONE_TIME_CHARGE では付与しない |
| `internal-auth.ts` | timing-safe、未設定なら false(fail-closed) |
| `test-automation-access` / `detached-access` | **`KABUYOMI_ENV` と `ENVIRONMENT` の両方が `"test"`** を必須。本番では絶対に有効化されない。**権限昇格経路なし** |
| `installation-identity.ts` | HMAC 由来 principal、bootstrap のネットワーク鍵あたり3回制限、App Attest 鍵の重複登録を409で拒否、INSERT 競合時の再取得 |
| `account-recovery.ts` | セッション発行前に App Attest 検証済みを要求。Apple JWKS 検証 |
| `sec-fetcher` の内部認証 | `timingSafeEqual` + 長さ事前チェック + 起動時必須 + **ボディ読取前**に検証 |

## 根拠(出典)

| 対象 | 判定 |
|---|---|
| `numeric-alignment.ts` | 通貨・百分率クレームはラベルが付かない時点で `blockedResolution` = fail-closed |
| 抽出段(全角) | **修正済**。長さを保つ正規化で「素通り」と「誤分裂」を同時に解消 |
| `requiredSourceIds` | `addRequiredNumericSources` が出典チップに追加する。「検証は通ったが出典が出ない数値」は発生しない |
| `source-validation.ts` | モデルが遠隔実行された場合、**contextPack にあるソースIDしか許可しない**。厳格 |
| `context-pack.ts` (1,295行) | 既存チャンクの選択と MD&A 本文からの窓切り出しのみ。捏造なし |
| `hard-intent-retrieval.ts` | 追加ソースも `filing.sourceChunks` と MD&A 窓のみ |
| `verified-financial-facts.ts` | 派生マージンは scope/期間/通貨/四半期の**完全一致**を要求。符号跨ぎでは派生率を出さない |
| `history-store.ts` (1,414行) | 期間種別・期間長(±45日)・符号跨ぎを検証。出典に両方の filing が含まれることを確認してから回答 |
| `evidence-fallback.ts` | evidence slot(実ソース由来)からのみ文を組み、`isUnsafeEvidenceText` で生の英文断片を除外 |

## sec-fetcher

- 本番/test とも `SEC_FETCHER_BASE_URL = "cloudflare-internal"`。
  **Node 版サービスはどちらの経路にも無い**(その15テストは何も守っていない)。
- **訂正**: 前回「`SEC_FETCHER_SHARED_SECRET` は死んだ鍵」と書いたが誤り。
  Worker は `/internal/sec/*` を**受信側でも公開**しており、この鍵で認証している。
  使われていないのは送信側だけ。
- S-1(バイト数上限)/ S-2(列長一致)は 2026-08-22 に修正済(commit cf6ae35)。

---

# D. 総括

48,721行を読んだ結果、**構造は2層に分かれている**。

**下層(お金・認証・出典検証)は堅い。** 不変条件、冪等性、fail-closed、
公式ライブラリの使用、環境ゲートが一貫している。二重消費も返却漏れも権限昇格も見つからなかった。

**上層(回答生成)はベンチ最適化の層で、一般化されていない。**
15前後のキュレーション銘柄に対しては具体的に答え、それ以外では
「特定できません」に落ちるか、悪くすると**無関係な業種の用語が混入する**。
本番の追跡30銘柄のうち表に載っているのは12銘柄で、しかも Alphabet はキー綴りの不一致で外れている。

A-1〜A-5 はいずれも**上層のこの性質から出ている**。個別に潰すこともできるが、
根は「特定企業の特定文面に合わせたルールを production 経路に置いている」ことにある。

---

# E. 「全部読んだか」の再確認で追加で出たもの(2026-08-22 後半)

最初の報告は完了を過大に申告していた。読み残しを潰した結果、さらに5件出た。

## E-1 【重大】本番のチャットプロンプトはリポジトリに無い

`clients/llm/providers/openai/client.ts:38`

```ts
invocation = resolveOpenAIPromptId(env) !== null
  ? await invokeOpenAIDashboardPrompt(env, prompt, promptVariables)   // ← 本番はこちら
  : await invokeOpenAIChat(env, prompt);
```

本番は `OPENAI_PROMPT_ID = "pmpt_69f5…"` / `OPENAI_PROMPT_VERSION = "2"` を設定済み。
送信 body は `{ model, prompt: { id, version, variables }, text.format: json_schema(strict) }`。

→ **`prompts.ts` の `buildChatPrompt`(約60行の根拠固定ルール)は本番で送られていない。**
「事実を作るな」「Sources にある sourceId だけ返せ」「投資助言をするな」という
**このアプリの安全性の中核が OpenAI のダッシュボード側にあり、git に無い。**

- ダッシュボードを触れる人が、コミットもレビューもデプロイも無しに本番の回答挙動を変えられる
- リポジトリを監査しても本番の指示は読めない(**今回の点検でも読めていない**)
- リポジトリの `buildChatPrompt` は「本番の真実」に見えるが chat では死んでいる

緩和: 出力スキーマ(`json_schema` strict)はリポジトリ側で強制しているので、
回答の「形」は保証される。保証されないのは「中身の作り方」。

## E-2 App Attest の拡張検査が本番で無効化されている

本番 `APP_ATTEST_ALLOW_MISSING_APP_EXTENSIONS = "true"`。
`verifyAppExtensions` は extensions が無いとき**そこで return する**ため、
**validation category の検査も bundle version の検査も両方スキップされる**。

→ 前回「ビルド番号を上げると新規インストールが黙って落ちる」と書いたが、
extensions を持たない attestation はそもそも門を通らないので影響は限定される。
**逆に言うと、バージョン許可リストは確実には効いていない。**

なお実装自体は Apple 仕様どおりで隙が無い(ルートCA固定、nonce照合、
rpIdHash、counter===0、aaguid環境判定、keyId===credentialId、公開鍵ハッシュ照合)。

## E-3 検証されていないラベルが「事実」としてモデルに渡る(A-5 の第3系統)

`context-factual-pack.ts` の `seedKnownTickerLabels` は
**filing 本文に出ているかに関係なく**ハードコードのラベルを merge する
(AAPL MSFT NVDA AMZN GOOGL GOOG PH CRWD INTU CEG)。
`seedKnownTickerRevenueFacts` も同様に売上区分を seed。

**これは factual pack に入り、プロンプトは明示的に
「Factual pack を raw source excerpt より優先して使え」と指示している。**

## E-4 GOOG 漏れは意図ではなく見落とし(A-3 の裏付け)

`context-factual-pack.ts` は `GOOGL || GOOG` を**両方**扱っている
(`businessProductDefinitions` / `seeds` / `hasKnownBusinessLabels` / `seedKnownTickerRevenueFacts`)。
一方 `deterministic.ts` の3テーブルは `GOOGL` のみ。
**同一リポジトリ内で扱いが割れている。**

## E-5 内部トークン比較が1箇所だけ timing-safe でない

`routes/internal-subscription-principal-migration.ts:13` だけが素の `!==` 比較。
他の内部ルートは全て `timingSafeEqual`。ヘッダ名も1つだけ違う
(`x-kabuyomi-internal-token` vs `x-internal-token`)。
このエンドポイントは**購読 principal の移行**(有料クレジットの移動)を行う特権経路。

## sec-fetcher の完了

`prepared-filing.mjs`(272行)と `request-body.mjs`(81行)が未読だった。読了。

- `request-body.mjs`: content-type / 宣言長 / ストリーミング上限すべて正しい
- `prepared-filing.mjs`: **`workers/src/extractors/mda.ts` と同じMD&A抽出の二重実装**。
  定数(TOKEN_BUDGET 15,000 / MIN_SECTION_CHARS 2,400)まで同じ。
  本番は Worker 側(`extractMDASectionWithDiagnostics`)を使うため Node 側は死んでいる。
  → sec-service / prepared-filing の**2組の二重実装**が sec-fetcher に存在する。

---

# F. 訂正 — 「お金は問題なし」は言い過ぎだった(2026-08-22 後半 追検証)

前節までで「二重消費・返却漏れ・権限昇格は無い」と書いた。それ自体は変わらない。
ただしその見出しを **「お金は問題なし」** と要約したのは誤りだった。
**付与の入口に環境の区別が無い**ことを、重要度の低い運用事項として扱っていた。
AUDIT_PROMPT.md の「提出/課金/データ破損を最上位」に反する順位付けだったので訂正する。

## F-1 【重大・実測】sandbox の購入が本番でクレジットを付与する

**経路(全て確認済み):**

1. `wrangler.toml:46` → `APPLE_APP_STORE_SERVER_ENVIRONMENT = "auto"`(本番設定)
2. `apple-store-server.ts:390` `resolveVerificationEnvironments("auto")` → `["production", "sandbox"]`
3. `fetchSignedTransactionInfo` は production を先に叩き、404 `TransactionIdNotFound`(4040010)なら
   `shouldTryNextAppleEnvironment` が true を返して **sandbox にフォールバックする**
4. sandbox の transactionId は production に存在しないので必ず 404 → sandbox で検証成功
5. `verifyCreditPurchaseWithApple` は `verificationEnvironment` を**返している**
   (`apple-store-server.ts:115`)が、
   `routes/credit-purchase-grant.ts:40-45` は **それを `grantPurchasedCredits` に渡していない**

→ sandbox 由来の取引が、**呼び出し元の本番 quotaSubject に対して実クレジットを付与する。**
   環境の記録すら残らない。

**失敗シナリオ(具体・攻撃を要しない):**
TestFlight の Release ビルドは `APIBaseURLResolver.productionURL`
(`ios/Kabuyomi/Services/APIClient.swift:68`)を叩く。DEBUG 切り替えは
`kabuyomi-api-test` 側にしか効かない(`SettingsView.swift:136`)。
一方 TestFlight の StoreKit が返すのは **sandbox の取引**である。
つまり **TestFlight ユーザーが普通にクレジットパックを買うだけで**、
production 照会が 4040010 で外れ → sandbox 照会が通り → 本番クレジットが無償で付与される。
悪意も細工も要らない。`revocationDate` が無い限り 409 にもならない。

(悪用経路としては、その `transactionId` を本番アプリの principal で
`POST /v1/ios/purchases/credits/complete` に投げ直すこともできる。
ただし**主たる問題は攻撃ではなく、TestFlight の通常利用そのもの**である。)

**購読との対比(ここが判断材料):**
購読側は環境を捨てていない。`entitlements.ts:83` / `:343` が
`deriveStableSubscriptionPrincipal(env, originalTransactionId, environment)` に環境を渡すため、
sandbox 購読は **production とは別の principal** に着地する(=本番ユーザーの権利にはならない)。
`durable/entitlement.ts:116` は環境が変わった状態遷移も検出する。
**同じリポジトリ内で、購読は環境を分離していて、消費型クレジットだけしていない。**
これは設計の一貫性が破れている箇所であり、「auto は Apple 推奨だから正しい」では説明できない。

**⑨ との複合:** 本番 `APP_ATTEST_ALLOW_MISSING_APP_EXTENSIONS = "true"` により
`verifyAppExtensions` は extensions 不在で早期 return する。
attestation 側での build 由来の絞り込みは当てにできない。

## F-2 【実施済】環境を記録する(2026-08-22)

`verificationEnvironment` は credit 経路で受け取ったまま**どこにも記録されていなかった**。
事後に「どの付与が sandbox 由来か」を D1 から特定する手段が無かったので、まずそこを塞いだ。

- `d1/migrations/0019_purchase_transaction_environment.sql`
  `purchase_transactions.verification_environment TEXT`(**nullable**)。
  既存行は環境を知り得ないので `production` での backfill はしない。NULL は「不明」であって
  「production」ではない。
- 経路: `credit-purchase-grant.ts` → `grantPurchasedCredits` → `ensurePurchaseTransactionRow`
  → INSERT / SELECT / `PurchaseTransactionRow`(cf6ae35 と同種の列ずれを避けるため
  SELECT 列と型も同時に広げた)
- `production` は `logEvent`、それ以外は `logWarnEvent`
  (`credit_purchase_grant_non_production_environment`)。D1 を引かずに気づける。
- 回帰テスト: sandbox 付与が `"sandbox"` として記録されることを bind 引数で固定。

**この作業で追加で1件出た。**

- **F-3 [中]** `routes/internal-credit-purchase-grant.ts` が
  **Apple 検証を一切通さない第2の付与経路**である。型を必須にしたことで露見した。
  ここを `production` と記録すると内部付与が実購入と区別できなくなるため、
  記録値を `production` / `sandbox` / **`internal`** の3値(`CreditGrantEnvironment`)にした。

## F-4 【重要】(b)「sandbox を別 principal に隔離」は**成立しない**

指示は (b) だったが、実装しようとして矛盾が出たので報告する。

購読が環境で principal を分けられるのは、`readQuotaIdentity` に **entitlement 段があり、
消費時にも同じ sandbox principal が再導出されるから**である。
クレジットにはその段が無い。消費は device / account principal で解決される。

→ 付与だけを別 principal に隔離すると、**誰も使えないクレジットが発行される**。
   TestFlight での課金テストは (a) と同じく死に、しかも 403 ではなく**黙って失敗する**。
   (a) のコストを払って (a) より悪い挙動になる。

消費側も揃えるには「この installation は sandbox クライアントである」という
**永続的な識別状態を課金経路に新設する**ことになり、(b) の想定を超える。

したがって **遮断方式は (a) / (c) / 現状維持のいずれかで再決定が必要**。
F-2 はどれを選んでも必要な土台なので先に入れてある。

## F-5 【実施済】(a) を入れた — 「計測してから」は誤った推奨だった(2026-08-22)

いったん「F-2 をデプロイして sandbox 付与の件数を見てから遮断方式を決める」と推奨したが、
**その計測は判断を分岐させない**。sandbox 付与が0件でも穴は塞ぐべきで、
0件でなくても塞ぐべきである。計測が答えるのは
「**既存の不正付与を回収する必要があるか**」であって「塞ぐべきか」ではない。
2つの問いを混ぜていたので訂正する。

⑨(App Attest)と②(seed)は計測先行が正しい。**フリップの代償が違う**からである。

| | フリップの代償 | 計測は判断を変えるか |
|---|---|---|
| ⑧ | TestFlight での付与テストのみ(ユーザーに影響なし) | **変えない** |
| ⑨ | **実ユーザーを締め出しうる** | 変える |
| ② | 主要5銘柄の回答が劣化しうる | 変える |

**入れたもの:** `isCreditGrantEnvironmentAccepted`(`routes/credit-purchase-grant.ts`)。

- `production` の取引は全デプロイで受理
- `sandbox` の取引は **`APPLE_APP_STORE_SERVER_ENVIRONMENT` が明示的に `"sandbox"`
  のデプロイ(= test worker)でのみ受理**
- `auto` / `production` / 未設定 は本番姿勢とみなし 403

未設定を「許可」と解釈しないのは意図的。未設定は
`resolveVerificationEnvironments` が `["production","sandbox"]` に落ちる
= 本番と同じ姿勢だからである。

**設定変更(`APPLE_APP_STORE_SERVER_ENVIRONMENT` を `"production"` にする)ではなく
コード側で塞いだ理由:** この env は購読側の
`derivePrincipalCandidates` と `appleVerificationEnvironmentReady` でも読まれる。
`"production"` にすると sandbox の**購読**検証まで止まる。
購読側は principal で分離済みで問題が無いため、影響範囲の広い設定変更より
消費型クレジットだけを対象にするコード側の方が外科的。

**代償(明示):** TestFlight ビルドでクレジットを買っても**付与されなくなる**。
購入とサーバーの拒否までは検証できるので、失うのは付与の1手のみ。
付与まで通す検証は test worker を指すビルドで行う必要がある。

**回収の要否は別問題。** F-2 のログと `verification_environment` 列で
既存の sandbox 付与を洗い出すこと。これは遮断とは独立に必要。

---

# G. 純粋バグの修正結果(2026-08-22)

「回答の中身を変えない」ものだけを対象にした。全て typecheck + 1165/1165 通過。

| # | 内容 | 状態 |
|---|---|---|
| ③ | `casm`→sarcasm / `fare`→welfare・warfare / `asm`→plasma・enthusiasm / `mix`→mixed(`final-answer-language.ts`) | 修正済 |
| ③ | `screening|diagnostic` 単独で「がん検査・診断」(`gemini/fallback.ts`)→ 腫瘍学語の近接必須に | 修正済 |
| ④ | `Emerging Markets`→「Emerging 市場業務」/ `the Pioneer transaction`→「the Pioneer 取引件数」 | 修正済 |
| ⑦ | `card` 部分一致で MA が bank 誤分類 → `\bcard\b` | 修正済 |
| ⑪ | `markPurchaseTransactionGranted` の0行更新が黙って通る | 修正済 |
| ⑬ | `pruneOldCreditOperations` が辞書順先頭500件しか見ない | 修正済 |
| ⑭ | 購読 principal 移行の内部トークン比較が timing-safe でない | 修正済 |

## ④ で1つ踏んだ罠(記録)

`transactions?` の保護に `(?<!\b[A-Z]...)` を足したが、置換が `/gi` だったため
**`i` フラグが lookbehind の `[A-Z]` にも効き**、`processed transactions` まで
保護対象になって訳されなくなった。`/g` + `[Tt]ransactions?` に変更して解消。
この置換チェーンは他にも `gi` が多く、同種の見落としが残っている可能性がある。

## 着手しなかった2件と、その理由

**⑥(キュレーション表の GOOG 欠落)は意図的に見送った。**
`deterministic.ts` の3表に GOOG を足すと、**定数由来の回答が発火する銘柄が増える**。
②で選ばれた「まず可視化だけ」と逆方向なので、②のフェーズで扱う。
⑥ は「coverage の穴」ではなく「②の対象範囲がどこまでかという問題」である。

**⑫(`refundChat` の日次境界)は現状発火しない。**
`refundChatQuota` の**呼び出し元がゼロ**(テストにも無い)。
DO 側の `refundChat` アクションは `mutateUsage` 経由でしか到達できず、
その唯一の入口である `refundChatQuota` を誰も呼んでいない。
`consumeChatQuota` も `pipeline.ts` で import されているだけで未使用。

日付を正しく扱うには「消費時の dateJST を返却時まで運ぶ」配線が要るが、
その契約を決める呼び出し元が存在しない。存在しない呼び出し元を前提に
配線を作るのは避けたので、**死んでいる事実の記録に留める**。
削除するかどうかは別途判断。

---

# H. ②の可視化(2026-08-22)

方針は「まず可視化だけ」。回答は変えていない。
`workers/scripts/report-constant-answer-coverage.mjs` が定数表をソースから直接抽出し、
本番の `DEFAULT_TRACKED_TICKERS` 30件と突き合わせる。結果は
[CONSTANT_ANSWER_COVERAGE.md](CONSTANT_ANSWER_COVERAGE.md)(自動生成、手編集しない)。

表がリネーム・再構成されたら**黙って「該当なし」を返さず落ちる**ように、
各抽出器は空を検出した時点で exit 1 する。

## 出た数字

**13/30 銘柄**が1つ以上の定数経路に該当する。裏返すと **17銘柄はキュレーションが一切無い**
(AVGO META BRK-B JNJ ORCL MA AMD COST NFLX BAC ABBV CVX PLTR HD INTC PG CSCO)。
「ベンチは通るが本番の過半には効かない」という A-1〜A-5 の構造が、銘柄単位で確定した。

| 発見 | 数字 |
|---|---|
| `deterministic.ts` の3表 | 12/30。GOOGL キーのため **GOOG は3表すべてで外れる** |
| `context-factual-pack.ts` の seed | 5/30(AAPL MSFT NVDA AMZN GOOG)。**本文の有無に関係なく merge される** |
| `source-gate.ts` の sector 表 | 6/30。表の17件中**11件は本番で追跡されていない銘柄**向け |
| `gemini/fallback-known-business.ts` | **0/30**。PH CRWD CEG INTU はいずれも本番の追跡外で、この経路は本番では死んでいる |
| 定型合成(JPM / WMT / GOOG(L)) | 各1/30 |

## ⑥(GOOG 欠落)はここに畳んだ

`GOOG` は factual pack の seed・既知事業ラベル・売上ファクト seed・GOOG(L)定型合成の
**4経路には該当する**が、`deterministic.ts` の3表には**該当しない**。
E-4 で「同一リポジトリ内で扱いが割れている」と書いた件が、銘柄単位で裏付けられた。

3表に `GOOG` を足せば揃うが、それは**定数由来の回答が発火する範囲を広げる**ことになる。
「まず可視化だけ」の方針に反するので**足していない**。
②の方針が決まった時点で、揃える / 3表ごと落とす のどちらかに寄せる判断になる。

---

# I. ①の解決 — 本番プロンプトを実際に見に行った(2026-08-22)

E-1 で「本番のプロンプトはリポジトリに無く、**今回の点検でも読めていない**」と書いた。
Chrome から OpenAI ダッシュボードを開いて読んだので、その未読を解消する。

写しは `workers/src/clients/llm/providers/openai/production-prompt/` に置いた。
developer 指示 7,567文字は **SHA-256 でバイト一致を検証済**
(`7b426ce7250fbc3a0e6dd0c156b9164c9bffb305f6d0ae57e16513fa89c53924`)。
転記時に1文字誤ったがハッシュ不一致で検出できたので、目視ではなく機械で担保している。

## I-1 【訂正】「安全性の中核がダッシュボード側にある」は言い過ぎだった

`buildOpenAIResponsesPromptRequest`(`request.ts:535`)は毎回
`model` / `text.format` / `verbosity` / `reasoning.effort` / `max_output_tokens` を
**明示的に送っている**ため、ダッシュボードに保存された設定は上書きされる。

| 項目 | ダッシュボードの保存値 | 実際に送られる値 | 勝つのは |
|---|---|---|---|
| model | `gpt-5-nano` | `OPENAI_CHAT_MODEL` = `gpt-5-nano` | リポジトリ(一致) |
| reasoning effort | `minimal` | `OPENAI_REASONING_EFFORT` = **`low`** | **リポジトリ(不一致)** |
| verbosity | `low` | `"low"`(ハードコード) | リポジトリ |
| text format | `json_schema` `kabuyomi_chat_answer` | `openAIChatResponseJsonSchema()` | リポジトリ |
| max output tokens | — | `OPENAI_MAX_COMPLETION_TOKENS` = 1800 | リポジトリ |

→ **ダッシュボードが握っているのは指示文だけ**。出力の形もモデルもトークン上限も
リポジトリ側にある。構造的な問題(コミット無しで本番挙動を変えられる)は残るが、
影響範囲は E-1 に書いたより狭い。

なお reasoning effort はダッシュボードが `minimal`、送信値が `low` で**食い違っている**。
実際に効くのは `low`。ダッシュボード側の `minimal` を見て挙動を推測すると誤る。

## I-2 プロンプトの中身は、看板と整合していた

読んだ限り、「すべての記述に出典があります」を支える指示は**実在した**。

- `You must not invent facts.` / `You must not use outside knowledge.`
- `Use only sourceIds that exist in the provided Sources list.`
- `If no provided source supports a statement, do not include that statement.`
- `If a sourceId was not actually used to support the answer, do not include it.`
- 投資助言の禁止(価格目標、売買推奨、ポートフォリオ配分、株価予想を名指しで禁止)
- 通貨換算の捏造禁止、durability を根拠なく断定することの禁止

`workers/test/openai-production-prompt-snapshot.test.ts` がこれらの行の存在と
ハッシュを固定する。

## I-3 【重要】ただし ② との矛盾はプロンプト側では解けない

プロンプトは `Factual pack` を使えと指示している。
一方 `seedKnownTickerLabels` は **filing 本文の有無に関係なく**定数ラベルを
その factual pack に merge する(E-3、H節で 5/30銘柄と確定)。

→ モデルから見ると、seed された定数は「提供された文脈」そのものである。
   `You must not invent facts` を完璧に守っても、**定数は事実として出力される**。
   ②は、プロンプトを直しても解けない。**seed をやめるかどうかの問題**である。

## I-4 テストの限界(正直に)

このテストは **ダッシュボードが変更されたことを検知できない**。
検知できるのは (a) `wrangler.toml` の id / version のずれ、(b) 写しの無断編集だけ。
定期的に取り直して差分を見る運用が要る。

## 副産物

ダッシュボードのプロンプトは `Kabuyomi` と `test` の2件のみ。
本番が指している `Kabuyomi` は v2 が default。

---

# J. ⑤ と ⑩、および着手しないと決めた3件(2026-08-22)

## J-1 ⑤ の実体 —「同概念の実装が2つあり正反対」の正体

⑤ を「本番32件中30件が銀行誤判定」と書いたが、SG-1 の
「`normalizeSector` は21/30が general に落ちる」と食い違っていた。
**別の関数だった。**

`src/clients/gemini/fallback.ts` に、同じ概念の実装が2つある。

| 関数 | 判定材料 | 語境界 | 挙動 |
|---|---|---|---|
| `isBankLike`(574) | ticker + 社名 + **MD&A 先頭5,000文字** | **無し** | ほぼ全社が bank |
| `isBankOrFinancialCompany`(755) | ticker + 社名のみ | 有り + ティッカー許可リスト | 妥当 |

`isBankLike` の旧実装は `/(jpm|bank|financial|deposits?|loans?|...)/`。
**`financial` が致命的で、"consolidated financial statements" と
"financial condition" はどの 10-K / 10-Q にも必ず出る。** 実測:

```
AAPL "condensed consolidated financial statements" -> bank ("financial")
KO   "financial condition and results of operations" -> bank ("financial")
NVDA "our consolidated financial statements"        -> bank ("financial")
CAT  "term loans and bank credit facilities"        -> bank ("loans")
PG   "committed bank credit facilities"             -> bank ("financial")
```

**影響:** `missingSourceTypesForNonHard`(539)で
`intent === "liquidity_debt" && isBankLike(filing)` のとき、
不足ソース種別に **「deposits」「credit quality」** が加わる。
非銀行の提出資料には存在しないので、資金繰りの質問に対して
**永久に埋まらない不足**を提示することになる。
`localChatFallback` は OpenAI 経路の失敗時に必ず通る(`openai/client.ts:27,54,67,102`)ので、
これは本番の生きた経路。

**修正:** 判定を2段に分けた。社名・ティッカーは**実際に銀行を指す語**のみ、
MD&A は**銀行の MD&A にしか出ない語**(net interest margin / provision for credit losses /
net charge-offs / tier 1 capital 等)のみ。
JPM・BAC・C は引き続き true、上記5社は false。
`test/bank-like-classification.test.ts` で固定。

なお `isBankOrFinancialCompany` の許可リストには `\bc\b`(Citigroup)が入っており、
社名に単独の "c" があると誤爆しうる。実害は小さいので今回は触っていない。

## J-2 ⑩ finish_reason —「同じ上限で再試行」の中身

`parseOpenAIChatCompletionPayload` は `finishReason` を返し、
`invokeOpenAISummary` はそれを**ログに出すだけ**で戻り値に載せていなかった。
`generateOpenAISummary`(`provider.ts`)の再試行ループは失敗理由を問わず `continue` する。

**結果:** トークン上限で切られた要約は、
**より長いプロンプト**(`retrySummaryPrompt` はスキーマ説明を5行足す)を
**同じ上限**に投げ直す。必ず同じ場所で切れる。

**修正:** スキーマ不一致と上限切れは**逆の再試行を要求する**ので分岐させた。

- 上限切れ → 同じ base prompt を **上限2倍**で1回だけ投げ直す
- スキーマ不一致 → 従来どおり説明を足したプロンプト(上限は据え置き)
- 上限2倍でも切れたら **break**(3回目を投げない)

ログの `reason` も `output_truncated_at_token_limit` に分離した。

**あわせて chat 側も直した。** 本番のチャットは Responses API 経路で、
こちらは打ち切りを `finish_reason` ではなく
`status: "incomplete"` + `incomplete_details.reason: "max_output_tokens"` で返す。
`parseOpenAIResponsesPayload` はこれを**一切見ていなかった**ため、
上限切れが `json_parse_failed` と区別できず、
チャットの fallback 率を原因別に分解できない状態だった。検出とログを追加。

## J-3 着手しないと決めた3件

**⑨ App Attest 拡張検査の無効化** — `APP_ATTEST_ALLOW_MISSING_APP_EXTENSIONS = "true"` は
**本番の設定値**であり、コードのバグではない。false にすると
extensions を持たない attestation が門で落ちるため、**実在のインストールを締め出しうる**。
⑧ の遮断方式と同じく、あなたの判断が要る。

**⑮ `web-search` の UA 偽装** — 前回の読みどおり本番経路から到達しない。
生きた経路に戻すなら直す価値があるが、現状は死んでいる。

**⑯ sec-fetcher の二重実装2組** — 失敗シナリオが無い。
`sec-service` / `prepared-filing` はいずれも本番で使われず(本番は Worker 側)、
「重複がある」以上の害を特定できていない。リファクタの話であって修正ではない。
