# Kabuyomi 実装実態仕様書 (as-built)

> Status (2026-04-18): historical reference only. This file is not the current shipping contract.
> The local coordination docs (`docs/current_shipping_truth.md`, `CURRENT_SLICE.md`) are intentionally not tracked in Git. Use `docs/testflight_readiness_checklist.md` and the live code as the authoritative source.

本仕様書は、`README.md` や既存の `kabuyomi_*_spec_v1.md` を参照せず、
`ios/`, `workers/`, `sec-fetcher/` のソースコードのみを読んで、
第三者として現状のシステムをまとめ直したものである。

既存仕様との乖離は最終セクションに別立てする。

---

## 1. システム全景

Kabuyomi は米国株の SEC filing (10-K / 10-Q) を日本語で読む・質問するための
iOS アプリで、バックエンドは以下の三層構成を取っている。

```
[iOS SwiftUI app]
      │  HTTPS + x-device-key header
      ▼
[Cloudflare Workers]  ── Gemini API (要約 / chat 生成)
      │  ├─ KV (filing cache, config)
      │  ├─ R2 (filing アーカイブ)
      │  ├─ D1 (履歴・メトリクス時系列)
      │  └─ Durable Objects (quota / lock / rate limit / entitlement)
      │
      │  x-internal-token
      ▼
[sec-fetcher (Node on Railway)]
      │
      ▼
[SEC EDGAR]  ── submissions / filing HTML / XBRL companyfacts
```

iOS は sec-fetcher を直接叩かない。すべて Workers 経由。
sec-fetcher は SEC EDGAR の薄い proxy + キャッシュ + rate limiter。

---

## 2. iOS アプリ (`ios/Kabuyomi/`)

### 2.1 エントリとナビゲーション

- `@main` は `KabuyomiApp`。`AppModel` を環境に注入し、
  カラースキームは `.light` 固定 ([KabuyomiApp.swift:1-15](ios/Kabuyomi/KabuyomiApp.swift)).
- Root は `AppRootView`。`isBootstrapped` が立つまで `LaunchPlaceholderView`。
  その後 `AppTab` (`.home / .conversation / .search / .settings`) による
  4タブ構成のタブバー ([AppRootView.swift:18-89](ios/Kabuyomi/App/AppRootView.swift)).
- 起動ブートストラップは `AppModel`:
  - 起動カウントのインクリメント
  - usage の取得
  - StoreKit entitlement refresh と `/v1/billing/sync`
  - 永続化からのホーム再構築
    ([AppModel.swift:47-143](ios/Kabuyomi/App/AppModel.swift)).
- 初回判定は「保存銘柄 / 最近銘柄 / lastViewedTicker / activeConversationTicker が
  すべて空」で成立。成立時は `.home` タブを開き `InitialEntryView` を表示する
  ([AppModel.swift:110-116](ios/Kabuyomi/App/AppModel.swift)).

### 2.2 Home タブ

`HomeView` は次の縦構成:

1. **ヒーロー**: キャッチコピー + usage ピル (chat/stock の使用量と limit)
2. **まず試す銘柄**: スターター (AAPL, MSFT, NVDA, AMZN, TSLA) の横スクロール。
   起動 5 回で自動的に非表示へ切り替わる。Settings でトグル可。
3. **続きから聞く**: 最後に見た ticker
4. **保存した銘柄**: 新 filing ありなら「新しい filing」バッジ
5. **新しい filing / 最近の filing**: filed 日で並べ、上位 3 件
6. **最近見た銘柄**: 保存していない ticker の直近 3 件
   ([HomeView.swift:3-443](ios/Kabuyomi/Features/Home/HomeView.swift)).

`InitialEntryView` はスターター 5 社の横リスト + 3 つの固定ジャンプ質問:
- 「今回の一番大きい変化は？」
- 「利益率は改善した？」
- 「経営陣は何を慎重視している？」

質問をタップすると conversation タブへ遷移し composer に事前入力される。

### 2.3 Company タブ (`.conversation`)

これが実質の主役画面。ticker が選ばれていない時は
`ConversationEmptyStateView` を表示する。ticker があれば `CompanyView`。

構造は **中央 = チャット + 左右ドロワー** の 3 レイヤー
([CompanyView.swift:111-414](ios/Kabuyomi/Features/Company/CompanyView.swift)).

- **左ドロワー `.library`**: 会話内検索欄 / 最近の会話 / 保存銘柄 /
  (表示中なら) スターター / 設定への遷移。
- **右ドロワー `.summary`**: この filing の要点。
  verdict → positive / negative / focus → 前回からの変化 →
  主要メトリクス → 原文リンクの順。
- **中央タイムライン**: Live Filing コンテキストカード + suggested questions +
  会話履歴 + composer。
- **composer**: placeholder は動的。最初の suggested question
  または「利益率は改善した？」。
- **assistant message**: 「結論 / 根拠 / 限界・追加確認」のブロック構造。
  各返信の下に SEC or Web の source chip が並ぶ。
- **fallback**: source で確認できない場合
  「このfiling ではその論点を十分に確認できませんでした。
   代わりに、この資料から追いやすいポイントを続けて見ていけます。」
- **比較制限**: 他社比較系の問いには
  「この beta では他社比較はまだ限定的です。」を inline 表示。

画面上部タブとしての `chat / overview` は **コード上定義はあるが実運用は chat 固定**。
Overview 相当は独立タブではなく右ドロワーになっている
([AppModel.swift:14-17](ios/Kabuyomi/App/AppModel.swift)).

### 2.4 Search タブ

- 検索欄 1 本。debounce 280ms。
- 結果カード: ticker / 会社名 / exchange /
  サポート状況バッジ (「最新 10-K」「10-Q 対応」「未対応」「未確認」)。
- **開く**: 保存していない銘柄でも会話画面を開ける。保存は後で戻るための
  ブックマーク操作であり、開く前提ではない。
- **保存不可条件**: 対応 form が 10-K / 10-Q 以外 (20-F / 6-K など)。
  「v1 対応範囲外」と表示してボタンを無効化
  ([SearchView.swift:1-234](ios/Kabuyomi/Features/Search/SearchView.swift)).

### 2.5 Settings タブ

- **プラン**: `FREE` / `PRO` バッジ、今日の chat 回数、保存銘柄数、`free 3 / 10` と `pro 20 / 50` の比較行、購入 / 復元ボタン
- **AI 利用**: Gemini 送信への同意トグル。初回チャット送信時にダイアログ。
- **表示**: スターター銘柄の表示トグル (5 起動で自動 off の注記あり)
- **Links**: プライバシー / 利用規約 / サポート (いずれもアプリ内静的 view)
- **ローカルデータ**: 「データをリセット」(破壊的)
- **課金導線**: StoreKit の購読状態を `/v1/billing/sync` で同期し、同じ API のまま free / pro quota を切り替える。
  将来の detachable offer は free/pro 導線とは分離して扱う
  ([SettingsView.swift:1-395](ios/Kabuyomi/Features/Settings/SettingsView.swift)).

### 2.6 ネットワーク層

`APIClient` (`Services/APIClient.swift`):

- base URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
  (環境変数 / plist で上書き可)
- タイムアウト: request 45s / resource 75s
- 認証: `x-device-key` ヘッダ (端末固有の opaque ID)

呼び出す endpoint:

| Method | Path | iOS 側の用途 |
|---|---|---|
| GET | `/v1/search?q=` | 検索 |
| GET | `/v1/company/{ticker}` | 企業の最新 filing 取得 (保存不要) |
| POST | `/v1/company/{ticker}/refresh` | filing 強制再取得 |
| POST | `/v1/watchlist/add` | 保存銘柄追加 |
| POST | `/v1/chat` | 会話 (filingKey + question) |
| GET | `/v1/usage` | 本日 quota |
| POST | `/v1/billing/sync` | **beta では 503 を期待する** (サーバ側 disabled) |

エラー JSON (`{error: string}`) をユーザー表示用に分岐 (quota 超過 / 対応 filing なし /
ticker 不明 / SEC 不通)。

### 2.7 永続化

**CoreData** (`Persistence/CoreDataSchema.swift`, `PersistenceController.swift`):

- `StockEntity` 1 — N `FilingEntity`
- `FilingEntity` 1 — 1 `SummaryEntity`, 1 — N `FinancialMetricEntity`,
  1 — N `SourceChunkEntity`, 1 — N `ChatMessageEntity`
- `SummaryEntity` 1 — N `SummaryItemEntity` (`kind = highlight|change`)
- `ChatMessageEntity` 1 — N `MessageSourceRefEntity`
- リセットは全エンティティの batch delete。

**UserDefaults** で保持:
- `savedTickers`, `recentTickers`, `lastViewedTicker`,
  `activeConversationTicker`, `pendingConversationTicker`,
  `pendingConversationQuestion`
- `appLaunchCount` (5 でスターター自動 off)
- `aiConsentGranted`, `showStarterCompanies`, `hasCompletedInitialEntry`
- per-ticker: `companyTab.<ticker>`, `lastSeenFiling.<ticker>`

### 2.8 ビルドに含まれないもの

- `ios/oldui/` は 旧設計の歴史資料。ビルドターゲットには含まれない
  (リポジトリ外から参照されてもいない)。
- `CompanyTabPreference.overview` 定義はあるが実質未使用。
- 旧 `publicMonetizationEnabled` / `billingSyncEnabled` フラグ前提の説明は現状と不一致。
  現在は StoreKit 購入 / 復元と `/v1/billing/sync` による free / pro 切り替えが入っている。

---

## 3. Workers バックエンド (`workers/`)

### 3.1 ルーティング

`workers/src/index.ts` が唯一の fetch handler。

| Method | Path | 認証 | 概要 |
|---|---|---|---|
| GET | `/v1/search` | なし | ticker スナップショット検索 |
| GET | `/v1/company/{ticker}` | `x-device-key` | 最新対応 filing を返す (保存不要) |
| POST | `/v1/company/{ticker}/refresh` | `x-device-key` | 強制再取得 (5xx は cache フォールバック) |
| POST | `/v1/watchlist/add` | `x-device-key` | stock quota 消費 + filing 取得 |
| POST | `/v1/chat` | `x-device-key` | filing コンテキスト上の Q&A |
| GET | `/v1/usage` | `x-device-key` | 本日 JST の quota |
| POST | `/v1/billing/sync` | — | **現状 503 固定** |
| POST | `/v1/internal/backfill/history` | `x-internal-token` | 履歴バックフィル |

Scheduled handler: `0 18 * * *` (UTC。JST 翌日 3時)。
ticker スナップショット更新 + 追跡銘柄 (50 社) の filing 強制リフレッシュ
([index.ts:36-187](workers/src/index.ts)).

### 3.2 Durable Objects

| DO | 役割 | 主な状態 | 呼び出し元 |
|---|---|---|---|
| `UserQuotaDO` | 日次 quota | `{date_JST}:{subject}` → chats/stocks 消費数, trackedTickers | pipeline |
| `FilingLockDO` | filing 取込みロック | `lockedUntil` (30秒) | pipeline (double-check lock) |
| `SecRateLimiterDO` | SEC へのトークンバケット | timestamps (1秒窓 / 最大 10) | sec client |
| `EntitlementDO` | 将来の課金判定 (scaffold) | sha256(originalTransactionId) → active/productId | **未呼出** |

`UserQuotaDO` の free 既定値: **chat 3 / day, stock 3 累計**。
pro は chat 50 / stock 無制限だが、切り替え経路は現在無効。

### 3.3 Pipeline (filing 取得の実フロー)

`workers/src/lib/pipeline.ts` が中枢
([pipeline.ts:57-1380](workers/src/lib/pipeline.ts)):

1. `readQuotaIdentity()`: `x-device-key` → 無ければ `cf-connecting-ip` の hash
2. ticker → CIK (sec-fetcher)
3. submissions 取得 → 10-K / 10-Q のみ絞って最新を選ぶ
4. **KV `filing_cache:v1:{cik}:{accession}`** を見る。
   extractor / prompt のバージョンが一致すれば即返し
5. miss なら **R2 `filings/{filingKey}.json`** を見る。あれば KV に戻す
6. どちらも無ければ `FilingLockDO` でロック → `ingestFiling()`
7. `ingestFiling`:
   - sec-fetcher `/filing-assets` (HTML + XBRL metrics)
   - MD&A を regex で切り出し
   - narrative を 8 chunk に分割
   - metrics を source 化
   - Gemini に要約依頼
   - KV に保存 + `ctx.waitUntil` で R2 / D1 永続化
8. シリアライズして返す
   (`filingKey, ticker, companyName, cik, formType, filedAt, periodOfReport,
     primaryDocumentUrl, summary, metrics, sourceChunks, lastUpdatedAt`)

### 3.4 Chat の実フロー

`buildChatResponse()` ([pipeline.ts:241-312](workers/src/lib/pipeline.ts)):

1. 時系列クエリ判定 (「過去3年」「推移」等) にマッチすれば D1 の
   `metric_history` / `segment_highlights` を参照して trend 文を返す
2. 決定論的に返せる問い (マージン / 売上ドライバ / CF / 市況反応) は
   ハードコードルールで返す
3. そうでなければ Gemini 呼び出し (filing コンテキスト + 質問)
4. 返ってきた `sourceIds` を検証。弱い narrative しか引けていなければ
   決定論パスに fallback
5. 補足が弱い場合 web search で supplement を差し挟む

返却: `{ answer, sources: [{sourceId, sourceKind, sectionType,
sourceLabel, excerpt}], usage }`

source がない場合の回答は:
「この filing の提供コンテキストでは確認できません。」に強制される。

### 3.5 Contracts (`workers/src/lib/contracts.ts`)

Zod スキーマで request / response を型付け:

- `WatchlistAddRequestSchema`, `ChatRequestSchema (question 1-1000 chars)`,
  `BackfillHistoryRequestSchema`, `SearchQuerySchema`
- レスポンス: `SummaryResponseSchema`, `ChatModelResponseSchema`,
  `SourceSchema`

### 3.6 History Store (`workers/src/lib/history-store.ts`)

3 年分の時系列分析を D1 で持つ。

- R2: `filings/{filingKey}.json` に `FilingCacheRecord` を immutable 保存
- D1 テーブル:
  - `filings`: 1 filing = 1 行
  - `metric_history`: filing × metric の縦持ち (logical_name, value, yoy_percent)
  - `segment_highlights`: 地域別売上ドライバ

書き込み契機:
- 通常の filing 取得後に `ctx.waitUntil(enqueueHistoricalPersistence(...))`
- `POST /v1/internal/backfill/history` による batch 取込み

読み込み契機: chat で時系列問いを検出した場合のみ。

### 3.7 外部クライアント

- **`sec-fetcher.ts` client**: Railway の sec-fetcher を叩く。
  timeout 25s (`SEC_FETCHER_TIMEOUT_MS`), retry 1 回。
- **`gemini.ts` client**: model 既定 `gemma-4-31b-it`, timeout 12s。
  API key 無し or 失敗時は **silent に決定論要約にフォールバック**
  (ユーザーに degraded である旨は示されない)。
- **`web-search.ts` client**: 補足用 web 検索。

### 3.8 環境 bindings

- KV: `KABUYOMI_CACHE` (filing cache / ticker alias / snapshot / remote config)
- D1: `DB` (`kabuyomi-history`)
- R2: `FILINGS_BUCKET` (`kabuyomi-filings`)
- DO: `SEC_RATE_LIMITER / FILING_LOCK / USER_QUOTA / ENTITLEMENT`
- env: `GEMINI_API_KEY (optional)`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`,
  `SEC_USER_AGENT`, `SEC_FETCHER_BASE_URL`, `SEC_FETCHER_SHARED_SECRET`,
  `SEC_FETCHER_TIMEOUT_MS`, `BACKFILL_SHARED_SECRET`

### 3.9 テスト

`workers/test/`:
- `pipeline.test.ts` (大) — 決定論回答 / source 検証 / 時系列
- `gemini.test.ts` — schema / fallback
- `sec-fetcher-client.test.ts` — request 構築 / error
- `sec.test.ts` — ticker search scoring
- `mda.test.ts` — MD&A regex
- `history-store.test.ts` — バックフィル / segment 抽出
- `user-quota.test.ts` — 状態遷移
- `remote-config.test.ts` — config merge
- 未テスト領域: E2E HTTP / rate limiter 並行性 / DO 内部挙動

---

## 4. sec-fetcher (`sec-fetcher/`)

### 4.1 位置づけ

Node.js (ESM) の独立 HTTP サービス。Railway にデプロイ想定
(コミット `b44e560 Prepare sec-fetcher for Railway`)。
Workers と同居できない理由: 長時間接続の維持 / 永続キャッシュ /
SEC EDGAR の rate limit (UA 必須 & <10 req/s) を満たすため。

### 4.2 ルーティング

全て POST、`x-internal-token` 必須 ([server.mjs](sec-fetcher/server.mjs)):

| Path | 引数 | SEC への呼び出し |
|---|---|---|
| `GET /health` | — | なし |
| `/internal/sec/tickers-snapshot` | — | `company_tickers_exchange.json` |
| `/internal/sec/submissions` | `cik` | `submissions/CIK{pad}.json` |
| `/internal/sec/filing` | `cik, accessionNumber, primaryDocument` | filing HTML (Archives) |
| `/internal/sec/metrics` | `cik, tags[]` | companyconcept / companyfacts |
| `/internal/sec/filing-assets` | 上記 2 つの合成 | 上記両方を並行 |

戻り値: 200 JSON / 400 (必須欠落) / 401 (token) / 405 / 404 / 502 (上流失敗)。

### 4.3 キャッシュ戦略 (`src/sec-service.mjs`)

全てオンメモリ Map (ディスクなし):

- tickers snapshot: 24h
- submissions: 30m
- filing HTML: 24h
- XBRL concepts / companyfacts: 6h

**並行重複排除**: 同 URL の in-flight Promise を共有。
**stale-fallback**: TTL 切れで上流が落ちている場合、期限切れの値を返す
([sec-service.test.mjs:108-142](sec-fetcher/test/sec-service.test.mjs)).

### 4.4 Rate limit / Retry

- 自前のスライディングウィンドウ token bucket (既定 8 req/s)。
- `fetchWithRetry`: 429 / 5xx を `SEC_FETCHER_RETRY_COUNT` (既定 2) リトライ。
  backoff は `initialBackoffMs * (attempt + 1)` (線形、exponential ではない)。
- 各 fetch は AbortController でタイムアウト (既定 12s)。

### 4.5 env

`SEC_FETCHER_SHARED_SECRET` のみ **必須** (無いと起動時クラッシュ)。
その他は全てデフォルト値で動作:

- `SEC_USER_AGENT` = `"Kabuyomi admin@kabuyomi.app"`
- `SEC_RATE_LIMIT_PER_SECOND` = 8
- `SEC_FETCHER_RETRY_COUNT` = 2
- `SEC_FETCHER_INITIAL_BACKOFF_MS` = 400
- `SEC_FETCHER_HTTP_TIMEOUT_MS` = 12000
- `PORT` = 8789 / `HOST` = `0.0.0.0`

### 4.6 パースの責任分界

sec-fetcher は **HTML / XBRL の解釈を行わない**。
filing HTML は文字列としてそのまま返し、
XBRL は SEC が返す JSON をそのまま転送する。
MD&A の抽出・メトリクス整形は Workers 側 (`pipeline.ts`) の責務。

---

## 5. データフロー (主要ユースケース)

### 5.1 検索から開く / 保存まで

```
iOS Search → Workers /v1/search
                └─ KV スナップショット参照 (sec-fetcher 非経由)
iOS 開くタップ → /v1/company/{ticker}
                └─ Company pipeline (KV → R2 → sec-fetcher → Gemini)
                └─ 保存 slot は消費しない
iOS 保存タップ → /v1/watchlist/add
                └─ UserQuotaDO.consumeStock
                └─ Company pipeline (KV → R2 → sec-fetcher → Gemini)
                └─ iOS は CoreData に保存
```

### 5.2 会話

```
iOS composer 送信 → /v1/chat
  ├─ UserQuotaDO.consumeChat
  ├─ 時系列クエリ判定 → D1 metric_history
  ├─ 決定論ルール → 即返答
  ├─ Gemini 呼び出し (filing chunks + question)
  ├─ source 検証 (sourceId が有効な chunk を指すか)
  └─ 必要なら web_supplement を付与
```

### 5.3 日次 cron

```
03:00 JST → scheduled()
  ├─ ticker snapshot refresh
  └─ 固定 50 銘柄の filing を force refresh
       └─ 未取得 filing が取り込まれ R2/D1 に蓄積
```

---

## 6. 認証・Quota モデル

- 端末識別は `x-device-key` (opaque)。Apple Sign-in も JWT もなし。
- `x-device-key` が無い場合は `cf-connecting-ip` の hash を fallback に quota を当てる。
- 内部エンドポイント (backfill) は `x-internal-token` による
  定時間比較 (`timingSafeEqual`)。
- quota は JST の日付でリセット (UserQuotaDO)。
- App Store 課金 (Entitlement) の枠は用意されているが無効。
  `/v1/billing/sync` も 503 固定。

---

## 7. 提出フォーマット対応範囲

- **iOS と Workers ともに 10-K / 10-Q のみサポート**。
- Search で 20-F / 6-K が引けても保存不可表示。
- pipeline の `pickLatestSupportedFiling()` も同フィルタ。

---

## 8. プロダクトの挙動上の原則 (コードから読み取れるもの)

コード内の振る舞いから読み取れる、暗黙の product rule:

1. **source-bound**: chat 回答は `sourceIds` が空なら
   「提供コンテキストでは確認できません」に強制される。
2. **他社比較は未実装扱い**: UI 上、beta の制限バナーで明示。
3. **投資助言に寄せない**: 決定論回答のルールでも「買い / 売り / 予測」は避ける形。
4. **silent fallback**: Gemini 失敗時の決定論経路はユーザーに通知しない。
5. **冪等 filing key**: KV/R2 キーは `{cik}:{accessionNumber}` ベース。
   同 filing の再ダウンロードは避ける設計。
6. **起動 5 回でスターターを引っ込める**: 初期誘導が学習された後は静かにする。

---

## 9. 既存仕様書 (v1) との乖離

参照用。既存 `*_spec_v1.md` とコード実装のズレ:

| 項目 | v1 仕様書 | コード実装 |
|---|---|---|
| 企業画面のタブ | `質問する / 要点` の 2 タブを上部に | タブ UI なし。chat が本体、要点は右ドロワー |
| Home ヒーローコピー | 「米国株の決算変化を、3分で掴む」 | 実装は存在するが beta 版 UI の表現は別 (要確認) |
| `次に聞くべきこと` ブロック | summary 3 ブロック目として | `suggestedQuestions` は filing の context card 側に同居 |
| スターター 5 社 | AAPL, MSFT, NVDA, AMZN, TSLA | 一致 |
| 自動非表示 | 5 回起動で auto-hide | 一致 (`starterCompaniesAutoHideLaunchThreshold = 5`) |
| push 通知 | Phase 2 として将来 | 未実装。`PushNotification` 等は外部ツールの話 |
| beta quota / 課金導線 | 旧仕様では未確定 | **実装は free 3 / 10, pro 20 / 50** |
| 他社比較 | v1 対象外 | UI に明示的な制限バナーあり |
| 20-F / 6-K | 対象外 | Search で弾く、pipeline でも弾く (一致) |
| ランディングの「保存した銘柄」改名 | `ブックマーク` 等への寄せ提案 | UI は `保存した銘柄` のまま |

---

## 10. 観測された注意点 (as-built の弱点)

1. **Gemini silent fallback**: API key 欠落 / timeout 時に UI 上で degraded が
   分からない。要約の品質変化がサイレントに発生しうる。
2. **EntitlementDO が dead weight**: bindings は貼られているが index.ts に経路なし。
3. **`/v1/billing/sync` 503 固定**: iOS 側は 503 を想定して動く必要がある
   (現状は例外扱いで握りつぶしている)。
4. **sec-fetcher の 429 backoff が線形**: 強めの exponential ではない。
   SEC からの 429 が連続した場合、client 側の rate limiter も含めて
   二重に詰まる可能性。
5. **MD&A 抽出は regex**: 変則的な HTML で空抽出になり 422 を返す道がある。
6. **テストは pipeline の決定論経路が厚い一方、E2E と DO 並行性は薄い**。
7. **DEBUG ビルドの「無限モード」**: device key を回して quota をバイパスする
   設計。リリースビルドには入らないが、この切替が生存していること自体は
   運用上認識しておく必要がある。

---

## 11. サマリ

- Kabuyomi は **iOS / Cloudflare Workers / Node (Railway)** の三層。
- 主役は **SEC 10-K / 10-Q を filing 単位で取得し、source-bound で要約 + 質問** する体験。
- filing の取得・要約は Workers が **KV → R2 → sec-fetcher → Gemini** の
  順で重層キャッシュし、D1 に時系列を貯める。
- iOS は **4 タブ構成、conversation が実質の核**、
  要点は Company 画面の右ドロワー。
- **10-K / 10-Q 以外は明示的に対象外**。
- **課金 / push / 他社比較は未稼働**。scaffold のみある箇所と、
  UI で明示的に制限している箇所が混在する。
- quota は端末キーもしくは IP ベースで JST 日次。既定値は chat 3 / stock 3。

本仕様書はコードに対する「現状スナップショット」であり、
今後の改修時にはこの文書自体を更新するか、差分を v2 として別立てにするのがよい。
