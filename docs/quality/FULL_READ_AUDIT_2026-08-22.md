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
