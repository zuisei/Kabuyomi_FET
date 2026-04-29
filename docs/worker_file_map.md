# Worker File Map

Kabuyomi Worker のファイルが増えてきたため、まず「どのファイルが何を担当しているか」を見るための地図。

## 最初に見る場所

| File | 役割 |
| --- | --- |
| `workers/src/index.ts` | Worker の入口。HTTP request を routes に振り分ける。cron もここ。 |
| `workers/src/env.ts` | Worker が使う環境変数、KV、D1、R2、Durable Object の型。 |
| `workers/wrangler.toml` | Cloudflare Worker の設定。Worker 名、KV/D1/R2/DO binding、cron、環境変数。 |

## API 入口 routes

`workers/src/routes/*` は、HTTP API の受付。

| File | Endpoint | 役割 |
| --- | --- | --- |
| `routes/chat.ts` | `POST /v1/chat` | チャット受付。filingKey 確認、課金/credit、会話文脈補完、返答生成呼び出し。 |
| `routes/company.ts` | `GET /v1/company/:ticker` / refresh | 会社ページ用 filing を準備して返す。retryable failure 時は stale fallback も返す。 |
| `routes/watchlist-add.ts` | `POST /v1/watchlist/add` | 銘柄追加。quota 消費、filing 準備、async preparing 返却。 |
| `routes/watchlist-remove.ts` | `POST /v1/watchlist/remove` | 銘柄削除。保存銘柄 quota から外す。 |
| `routes/search.ts` | `GET /v1/search` | 銘柄検索。SEC ticker snapshot を使う。 |
| `routes/usage.ts` | `GET /v1/usage` | 利用状況、chat/stock/credit 残量を返す。 |
| `routes/translate-quote.ts` | `POST /v1/translate-quote` | SEC quote の日本語訳。 |
| `routes/billing-sync.ts` | `POST /v1/billing/sync` | iOS 側課金状態とサーバー状態の同期。 |
| `routes/credit-purchase-grant.ts` | `POST /v1/credit/purchase-grant` | StoreKit purchase から credit を付与する公開 route。 |
| `routes/internal-backfill-history.ts` | internal | 履歴 filing の backfill。内部 token 必須。 |
| `routes/internal-cleanup-filings.ts` | internal | 古い filing artifact の cleanup。 |
| `routes/internal-credit-purchase-grant.ts` | internal | 内部用 credit grant。 |
| `routes/internal-eval-credit-grant.ts` | internal | eval 用 credit grant。 |
| `routes/legal.ts` | legal pages/API | Legal/静的系 route。 |
| `routes/types.ts` | - | route handler 共通型。 |

## Chat 返答周り

`workers/src/lib/chat/*` と `workers/src/clients/gemini*` が `/v1/chat` の本体。

| File | あだ名 | 役割 |
| --- | --- | --- |
| `lib/chat/orchestrator.ts` | 司令塔 | 返答経路を決める中心。historical/deterministic/Gemini/retry/fallback/grounding/log を束ねる。 |
| `lib/chat/intent.ts` | 分類係 | 質問を `business_overview`, `cash_flow`, `risk_factors` などに分類する。 |
| `lib/chat/context.ts` | 会話文脈係 | 「なぜ？」など短い follow-up を前会話から補う。 |
| `lib/chat/context-pack.ts` | 資料係 | Gemini に渡す metrics/factualPack/sourceChunks を intent ごとに選ぶ。 |
| `lib/chat/deterministic.ts` | 自前回答係 | Gemini なしで売上・利益・CF など定型/数値回答を作る。 |
| `lib/chat/grounding.ts` | 監査係 | sourceIds と根拠 source を確認し、sourceUrl を付ける。 |
| `lib/chat/historical.ts` | 過去比較係 | 「この3年」「前回比較」など履歴質問を扱う。 |
| `lib/chat/web-supplement.ts` | Web補助係 | 株価/市場反応など、SEC 外の補助情報を足す。 |
| `lib/chat/answer-format.ts` | 表示整形係 | iOS に返す前の answer 表示を整える。 |
| `clients/gemini.ts` | AI係 | Gemini 呼び出し、schema repair、fallback 切り替え。 |
| `clients/gemini/prompts.ts` | Prompt係 | Gemini に渡す指示文を作る。 |
| `clients/gemini/normalize.ts` | Gemini返答整形係 | Gemini の JSON/answer/sourceIds を正規化する。 |
| `clients/gemini/fallback.ts` | fallback係 | Gemini がない/弱い/失敗した時の予備回答。 |
| `clients/gemini/request.ts` | Gemini通信係 | Gemini API への fetch、timeout、model 解決。 |
| `clients/gemini/types.ts` | - | Gemini 入出力型。 |

## Filing 準備周り

`workers/src/lib/filings/*` は SEC filing を取得・加工・保存する層。

| File | 役割 |
| --- | --- |
| `lib/filings/latest.ts` | 最新 filing を準備する中心。cache/archive/remote check/ingest/side effect を束ねる。 |
| `lib/filings/ingest.ts` | filing を取り込む。metrics、MD&A、sourceChunks、summary を作る。 |
| `lib/filings/cache.ts` | filing cache/latest alias の読み書き。 |
| `lib/filings/content-upgrade.ts` | `metrics_only` filing を full content に upgrade。companyWebsite backfill も含む。 |
| `lib/filings/history-persistence.ts` | filing を D1/R2 履歴に保存し、過去 filing preload を行う。 |
| `lib/filings/summary-upgrade.ts` | fallback summary を Gemini summary に後で upgrade。 |
| `lib/filings/cleanup.ts` | 古い filing artifact の cleanup。 |
| `lib/filings/lock.ts` | FilingLockDO を使う helper。同じ filingKey の二重処理防止。 |
| `lib/filings/company-website.ts` | filing HTML から company website URL を抽出。 |
| `lib/filings/latest-alias-store.ts` | D1 上の latest filing alias 管理。 |

## SEC / fetcher 周り

| File | 役割 |
| --- | --- |
| `clients/sec.ts` | Worker 側 SEC facade。ticker lookup、filing selection、metrics 正規化。 |
| `clients/sec-fetcher.ts` | 外部 `sec-fetcher` HTTP API を叩く client。 |
| `extractors/mda.ts` | SEC HTML から MD&A 部分を抽出する重めの処理。 |

## Storage / history

| File | 役割 |
| --- | --- |
| `lib/history-store.ts` | D1/R2 の履歴保存・検索・historical overview・backfill 本体。 |
| `lib/history-autohydration.ts` | 現在 filing から、比較用に hydrate すべき過去 filing を選ぶ。 |
| `lib/search-form-type-cache.ts` | 検索結果に出す latest form type の D1 cache。 |
| `lib/company-response.ts` | company API の返却 shape を作る。historicalOverview もここで合成。 |

## Quota / billing / credit

| File | 役割 |
| --- | --- |
| `lib/quota.ts` | device key、chat quota、stock quota、credit consume/refund の中心。 |
| `durable/user-quota.ts` | UserQuota Durable Object。日次 quota、保存銘柄、credit ledger を保持。 |
| `lib/billing-catalog.ts` | plan / credit product の定義。 |
| `lib/apple-store-server.ts` | Apple App Store Server API で purchase/subscription を検証。 |
| `lib/entitlements.ts` | entitlement 同期 helper。 |
| `durable/entitlement.ts` | Entitlement Durable Object。 |

## Durable Objects

| File | 役割 |
| --- | --- |
| `durable/filing-lock.ts` | filingKey 単位の lock。長い ingest の二重実行を防ぐ。 |
| `durable/sec-rate-limiter.ts` | SEC fetcher 呼び出しの rate limit。 |
| `durable/user-quota.ts` | quota/credit/saved tickers の状態管理。 |
| `durable/entitlement.ts` | subscription/purchase entitlement 状態管理。 |

## Common helpers

| File | 役割 |
| --- | --- |
| `lib/request.ts` | JSON body parse、content-type 確認、payload size limit。 |
| `lib/response.ts` | JSON/error response helper。 |
| `lib/errors.ts` | `AppError` など route で扱う error。 |
| `lib/logging.ts` | structured log helper。 |
| `lib/llm-usage.ts` | Gemini token/latency usage log。 |
| `lib/remote-config.ts` | remote config 読み込みと default。 |
| `lib/metrics.ts` | metric label など。 |
| `lib/internal-auth.ts` | internal route token check。 |
| `lib/detached-access.ts` | debug/dev detached access 判定。 |
| `lib/starter-tickers.ts` | starter ticker 定義。 |
| `lib/tracked-tickers.ts` | daily refresh/backfill 対象 ticker 解決。 |
| `lib/daily-refresh.ts` | cron で tracked ticker を refresh。 |
| `lib/pipeline.ts` | 古い facade/export 集約。外から使う関数を再 export。 |

## 迷った時の見方

### Chat の挙動が変

1. `routes/chat.ts`
2. `lib/chat/orchestrator.ts`
3. `lib/chat/intent.ts`
4. `lib/chat/context-pack.ts`
5. `clients/gemini.ts`
6. `clients/gemini/fallback.ts`
7. `lib/chat/grounding.ts`

`routes/chat.ts` の将来整理ポイントは `docs/chat_route_notes.md` を参照。

### 会社ページ / filing 準備が変

1. `routes/company.ts`
2. `lib/filings/latest.ts`
3. `clients/sec.ts`
4. `clients/sec-fetcher.ts`
5. `lib/filings/ingest.ts`
6. `lib/history-store.ts`

### quota / credit が変

1. `routes/chat.ts` または `routes/watchlist-add.ts`
2. `lib/quota.ts`
3. `durable/user-quota.ts`
4. `lib/billing-catalog.ts`
5. `lib/apple-store-server.ts`

### Worker が重い / 503 っぽい

1. `clients/sec-fetcher.ts`
2. `lib/filings/latest.ts`
3. `lib/filings/ingest.ts`
4. `lib/filings/content-upgrade.ts`
5. `lib/filings/history-persistence.ts`
6. `durable/filing-lock.ts`
7. `durable/sec-rate-limiter.ts`
