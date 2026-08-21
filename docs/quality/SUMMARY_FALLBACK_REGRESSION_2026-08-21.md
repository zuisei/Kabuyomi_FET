# 決算要約がテンプレートになっている問題(2026-08-21 調査)

## 結論

**現行世代(v9)の本番レコードは 30件中 30件、100% がフォールバックのテンプレート。**
`summaryProvider` も全件 `"fallback"`。AIによる要約が1件も生成されていない。

退行は **2026-05-02 のコミット `4db887f` "chore(worker): enable OpenAI provider in production config"** と時期が一致する。

## 計測(本番の実データ)

世代は `filing_key` の接頭辞。現行は `CURRENT_EXTRACTOR_VERSION = "v9"`(`workers/src/lib/remote-config.ts:63`)。

| 世代 | 件数(D1) | 最終生成 | 保存先 |
|---|---:|---|---|
| **v9(現行)** | 30 | 2026-08-16 | D1 + R2 |
| v6 | 238 | 2026-07-03 | 一部 KV |
| v5 | 88 | 2026-04-23 | KV |
| v4 | 9 | 2026-04-22 | KV |
| v3 | 125 | 2026-04-22 | KV |

**v9(現行・R2 から全30件を読んだ結果)**

| | 件数 |
|---|---:|
| FALLBACK | **30 (100%)** |
| REAL | 0 |

`contentMode`: `full` 9件 / `metrics_only` 21件。

**v6(KV にあった36件・生成は 2026-04-23〜25、つまりプロバイダ切替の前)**

| | 件数 |
|---|---:|
| REAL | 25 (69%) |
| FALLBACK | 11 (31%) |

→ **切替前は7割が本物の要約だった。切替後はゼロ。**

## 原因(複合)

### 1. 初回取り込みは意図的にフォールバック

`workers/src/lib/filings/latest.ts:113` — `deferFullContent` のとき `summaryMode: "fallback_only"`。
`ingest.ts:127` が `GEMINI_API_KEY` を明示的に `undefined` にしてテンプレートを即返す(速度優先の設計)。
これ自体は仕様。**あとで差し替わる前提**になっている。

### 2. 差し替え経路が 2026-05-02 から死んでいる

```ts
// workers/src/lib/filings/summary-upgrade.ts:35
export function isFilingSummaryUpgradeAvailable(env: Env): boolean {
  return resolveLlmProvider(env) === "gemini-legacy" && Boolean(env.GEMINI_API_KEY?.trim());
}
```

本番は `LLM_PROVIDER = "openai"` → `resolveLlmProvider` は `"openai"` を返す → **常に false**。
専用の修復経路が一度も走らない。**一度フォールバックになると永久に直らない。**

### 3. OpenAI に要約の実装が存在しない

`workers/src/clients/llm/providers/openai/` にあるのは chat と引用翻訳のみ。
`generateSummary`(`clients/gemini.ts`)は Gemini 実装しかなく、`env.GEMINI_API_KEY` を直接見る。
アーキテクチャ文書も chat の移行しか記述していない(`docs/quality/WORKER_ARCHITECTURE_BRIEF.md:8`)。

### 4. 要約の Gemini 呼び出しはスキーマなし再試行を持たない

`workers/src/clients/gemini/request.ts:68` — summary は `includeSchema: true` の**単発**。
chat と quote_translation は `includeSchema: false` の再試行を持つが、summary にはない。
モデルは chat 用の `gemma-4-31b-it` を流用。

### 5. content upgrade も完了していない

v9 の 21/30 が `metrics_only` のまま。`enqueueContentUpgrade` はプロバイダゲートを持たないが、
これらは full に上がっていない。full に上がった 9件も `summaryProvider: "fallback"` のままで、
その時点の Gemini 呼び出しが失敗している。

## 環境差(調査中に判明)

| | `GEMINI_API_KEY` |
|---|---|
| `kabuyomi-api`(本番) | あり |
| `kabuyomi-api-test` | **なし** → `missing_api_key` で必ずフォールバック |

**Debug ビルドは `kabuyomi-api-test` を叩く**(`ios/project.yml:111`)。
シミュレータで見える要約は常にテンプレートになるので、本番の判断材料にしてはいけない。

## 調査の副作用

test 環境に ORCL / CRM / AM(Antero Midstream)の取り込みが発生している(2026-08-21)。
診断のために実機シミュレータから開いたもの。本番には影響なし。

## 直す方向

1. **OpenAI に要約を実装**(`generateOpenAISummary`)して `generateSummary` から分岐
2. **`isFilingSummaryUpgradeAvailable` のプロバイダゲートを解除** — これがないと既存30件が永久に直らない
3. **既存レコードの再生成** — `/v1/internal/backfill/history`(`BACKFILL_SHARED_SECRET` で保護)が利用できる

補足: 古い世代(v3 等)のレコードには `summaryProvider` フィールド自体が無い。
`record.summaryProvider !== "fallback"` は undefined のとき true になり早期 return するため、
旧世代を修復対象にするなら undefined も対象に含める必要がある。

---

# 対応(2026-08-21 実施)

## 変更点

### 1. OpenAI に要約を実装

- `workers/src/clients/llm/providers/openai/request.ts`
  - `invokeOpenAISummary` / `buildOpenAISummaryRequest` を追加
  - OpenAI の strict モードは入れ子の各オブジェクトに `additionalProperties: false` と
    全プロパティを含む `required` を要求するため、`withStrictObjectConstraints` で再帰的に付与
  - 要約専用の上限を追加(`OPENAI_SUMMARY_TIMEOUT_MS` 既定30秒 / `OPENAI_SUMMARY_MAX_COMPLETION_TOKENS` 既定2500)
    10-K は本文が長く、生成は `waitUntil` の背景処理なので chat より待てる

- `workers/src/clients/llm/provider.ts`
  - `generateModelSummary` を追加(chat の `generateModelChatAnswer` と同じ形)
  - **スキーマ不一致時に1回だけ再試行**する。要約は従来スキーマ付き単発で、chat にある再試行が無かった
  - 再試行不能な失敗(認証エラー等)は1回で打ち切る
  - 例外は投げず、必ずテンプレートに落として返す
  - `isModelSummaryAvailable` を追加(`isQuoteTranslationAvailable` と同じ分岐)

### 2. 差し替えの粘着を解消

`isFilingSummaryUpgradeAvailable` の `resolveLlmProvider(env) === "gemini-legacy"` 固定を
`isModelSummaryAvailable(env)` に置き換えた。あわせて `current.summaryProvider === "gemini"` の
早期 return を `!== "fallback"` に修正(OpenAI 生成分も「差し替え済み」として扱うため)。

`content-upgrade.ts` も `generateModelSummary` 経由に変更。metrics_only の差し替えは
この経路が担うため、ここが Gemini 直呼びのままだと片肺になる。

### 3. ingest の env 書き換えハックを廃止

`{ ...env, GEMINI_API_KEY: undefined }` でフォールバックへ落としていたのを
`generateModelSummary(env, input, { forceFallback: true })` に変更。プロバイダが増えても意図が保たれる。

### 4. 要約プロンプトを書き直し

`buildSummaryPrompt`(Gemini/OpenAI 共通)に以下を追加:

- `verdict` は1文で、実際に何が起きたかを述べる。「適切に要約済み」「確認できます」等の状態語を禁止
- `highlights` は「なぜ動いたか」を書く。アプリが別途表示する主要数値グリッドの単なる再掲を禁止
- `changes` は highlights と同じ文の繰り返しを禁止
- 数値表記をアプリの `preferredFinancialDisplay` に合わせる(億ドル / 兆ドル、1株当たりはドル)
- 「十億ドル」「百万ドル」「USD億」を禁止
- 文中への英単語混入を禁止(revenues, gains, margin 等)
- `epsBasic` を 希薄化後 と書かない

## 検証(test 環境・実データ)

`kabuyomi-api-test` にデプロイして実機シミュレータから取得。

**修正前(ORCL / 2026-08-21)**

```
verdict: ORACLE CORPの最新10-Kでは、売上高を中心に提出資料ベースで確認できます。
H: 売上高は 673.6億ドル で、前年同期比 17.3%増 でした。
H: 提出資料 の記述を確認できます。
```

**修正後(KO 10-Q / summaryProvider: openai)**

```
verdict: 売上高は前四半期比で12.1%増、純利益は約17.8%増となり、
         原価削減とボリューム拡大が主要因として挙げられる。
H: 4-3-2026期の売上高は前年同期比で12.1%増の124.72億ドル。ボリューム拡大と価格/構成の有利さ、為替の寄与が寄与。
H: 四半期の営業利益は前年同期比で19.1%増の43.59億ドル。販売量の増加と費用抑制、為替影響が寄与。
C: 現金及び現金同等物は期首対比で約25.6%増の105.74億ドル。
```

単位(億ドル)、verdict の実質性、highlights の「なぜ」が満たされている。

## テスト

- `npm run typecheck` クリーン
- `npm test` **1142 passed / 4 failed**(変更前は 1125 passed / 6 failed)
- 残る4件は `App Store Server Notifications V2` で、**変更前から失敗している**(クリーンな作業ツリーで再現確認済み)
- 追加: `workers/test/openai-summary.test.ts`(11件)
- 更新: `workers/test/filing-summary-upgrade.test.ts` — 旧テストは
  「OpenAI 選択時は差し替えを走らせない」という**当時のバグを仕様として固定**していた。
  元の意図(古い Gemini 鍵に引きずられない)は維持したまま、新しい契約に書き直した
- 更新: `workers/test/ingest.test.ts` — モック先をルータへ変更し、`forceFallback` の引き渡しを検証

## 残っていること

- **本番未デプロイ**。`kabuyomi-api-test` にのみ反映済み
- 本番 v9 の 30件は `summaryProvider: "fallback"` のまま。デプロイ後、
  ユーザーが企業を開くたびに差し替えが走って順次直る(`/v1/internal/backfill/history` で一括再生成も可能)
- 残る文言の粗さ: 英単語の混入(`concentrate` 等の商品固有語)、日付表記(「4-3-2026期」)
