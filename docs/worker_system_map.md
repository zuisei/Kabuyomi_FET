# Worker System Map

Kabuyomi Worker を「ファイル一覧」ではなく「流れ」で見るための地図。

## 全体像

```text
iOS app
  |
  v
Cloudflare Worker
  |
  +-- routes/
  |     public API の入口
  |
  +-- lib/filings/
  |     SEC filing を準備する
  |
  +-- lib/chat/
  |     チャット回答を作る
  |
  +-- lib/quota.ts + durable/user-quota.ts
  |     利用制限 / credit
  |
  +-- clients/sec-fetcher.ts
  |     sec-fetcher を叩く
  |
  +-- clients/gemini.ts
  |     Gemini を叩く
  |
  v
Cloudflare KV / R2 / D1 / Durable Objects
```

## 主要な外部依存

```text
Worker
  |
  +-- sec-fetcher
  |     SEC API / SEC HTML / companyfacts を取りに行く
  |
  +-- Gemini
  |     要約 / チャット / 翻訳
  |
  +-- KV
  |     軽い cache
  |
  +-- R2
  |     filing artifact
  |
  +-- D1
  |     history / metadata / index
  |
  +-- Durable Objects
        quota, credit, lock, SEC rate limit
```

## リクエスト別の流れ

### 1. 会社ページを見る

```text
iOS
  |
  v
GET /v1/company/:ticker
  |
  v
routes/company.ts
  |
  v
lib/filings/latest.ts
  |
  +-- cache にあれば返す
  |
  +-- なければ clients/sec.ts
          |
          v
       clients/sec-fetcher.ts
          |
          v
       sec-fetcher
          |
          v
       SEC
  |
  v
lib/filings/ingest.ts
  |
  +-- metrics 作成
  +-- MD&A 抽出
  +-- sourceChunks 作成
  +-- summary 作成
  |
  v
KV / R2 / D1 に保存
  |
  v
company response
```

### 2. watchlist に追加する

```text
iOS
  |
  v
POST /v1/watchlist/add
  |
  v
routes/watchlist-add.ts
  |
  +-- ticker 確認
  +-- stock quota 消費
  |
  +-- sync mode
  |     |
  |     v
  |  ensureLatestFiling を待って company を返す
  |
  +-- async mode
        |
        v
     preparing を先に返す
        |
        v
     waitUntil(ensureLatestFiling)
```

注意: 現状の重い後処理はまだ `waitUntil` に乗っている。将来的には job/queue 化したい。

### 3. チャットする

```text
iOS
  |
  v
POST /v1/chat
  |
  v
routes/chat.ts
  |
  +-- payload 確認
  +-- filingKey で filing を読む
  +-- device key / quota / credit 確認
  +-- 短い follow-up を補完
  |
  v
lib/chat/orchestrator.ts
  |
  +-- intent.ts
  |     質問分類
  |
  +-- historical.ts
  |     過去比較なら先に見る
  |
  +-- deterministic.ts
  |     自前で答えられるなら Gemini なし
  |
  +-- context-pack.ts
  |     Gemini に渡す資料を選ぶ
  |
  +-- clients/gemini.ts
  |     Gemini に聞く
  |
  +-- clients/gemini/fallback.ts
  |     Gemini が失敗/弱い時の予備回答
  |
  +-- grounding.ts
  |     sourceIds / 根拠チェック
  |
  v
answer-format.ts
  |
  v
iOS に answer + sources + usage を返す
```

### 4. 過去比較する

```text
POST /v1/chat
  |
  v
orchestrator.ts
  |
  v
historical.ts
  |
  +-- D1 から metric_history を読む
  +-- R2 から archived filing を読むこともある
  +-- 足りなければ historical hydration を準備
  |
  v
historical response
```

### 5. 毎日 refresh

```text
Cloudflare cron
  |
  v
index.ts scheduled()
  |
  +-- refreshTickerSnapshot()
  |
  +-- refreshTrackedFilings()
        |
        v
     ensureLatestFiling(ticker, forceRemoteCheck=true)
```

## ファイルの見方

### `routes/`

API の受付。ユーザーや iOS から直接来る入口。

### `lib/filings/`

SEC filing を準備する場所。重い処理が多い。

### `lib/chat/`

チャット返答を作る場所。返答品質の中心。

### `clients/`

外部サービスに接続する場所。SEC fetcher / Gemini / Web search。

### `durable/`

状態を直列化したい場所。quota、credit、lock、rate limit。

## どこを触ると何に影響するか

| 触る場所 | 影響 |
| --- | --- |
| `routes/chat.ts` | chat API、課金、refund、filingKey contract |
| `lib/chat/orchestrator.ts` | 全チャット返答経路 |
| `lib/chat/context-pack.ts` | Gemini 回答品質、fallback 材料 |
| `clients/gemini/prompts.ts` | Gemini の文体・回答順・制約 |
| `clients/gemini/fallback.ts` | Gemini 失敗時 / Gemini なし回答 |
| `lib/chat/deterministic.ts` | Gemini なしの数値・定型回答 |
| `lib/chat/grounding.ts` | sourceIds、根拠、安全性 |
| `lib/filings/latest.ts` | company/watchlist の filing 準備 |
| `lib/filings/ingest.ts` | SEC filing 取り込み、MD&A、summary |
| `clients/sec-fetcher.ts` | Worker と sec-fetcher の境界 |
| `durable/filing-lock.ts` | filing 二重処理防止 |
| `lib/quota.ts` / `durable/user-quota.ts` | quota、credit、保存銘柄 |

## 今の不安ポイント

```text
1. Worker が SEC 巨大 payload を受けて重くなる
2. waitUntil が重い job の代わりになっている
3. chat/orchestrator.ts が長く、判断が集中している
4. Gemini なし fallback が薄く見える
5. ファイル数が多く、責務の境界が見えにくい
```

## 今後の地図の増やし方

この地図はまず全体把握用。

次に必要なら、以下を別ページ化する。

```text
docs/chat_route_notes.md
docs/chat_flow_map.md
docs/filing_prep_flow_map.md
docs/quota_credit_flow_map.md
docs/sec_fetcher_flow_map.md
```
