# Kabuyomi - 完全仕様書 v3

> Historical / stale document. Not current v1 release truth. See `docs/release/RELEASE_TRUTH.md`.

## アプリ概要
米国株の SEC 提出書類を日本語で読み、企業ごとに出典付きで質問できる iOS アプリ。

アプリ名：Kabuyomi（株読み）  
ターゲット：米国個別株を調べる日本語ユーザー  
対応プラットフォーム：iOS  
リリース目標：2026年5月  
開発体制：個人開発

### v1 の提供価値
- 英語の 10-K / 10-Q を日本語で要約して読める
- 企業ごとに AI へ質問できる
- 回答は SEC 提出書類と XBRL 数値に限定し、出典を必ず表示する
- 株価、アナリスト予想、売買シグナルではなく、一次資料の読解支援に特化する

---

## 解決する課題
米国株の投資判断に役立つ一次資料は SEC EDGAR に集約されているが、英語の 10-K / 10-Q を深く読むのは負荷が高い。既存サービスは株価・チャート・ニュース速報には強いが、SEC 提出書類を日本語で要約し、出典付きで掘り下げて質問できる体験は弱い。

Kabuyomi は「決算書を読むためのアプリ」として、以下を最優先にする。
- 日本語で短時間に要点を掴めること
- 回答の根拠が明示されること
- 余計な市場データを混ぜず、提出書類ベースで完結すること

---

## プロダクト原則
1. **出典拘束**  
   AI の要約と回答は、与えた SEC 本文断片と XBRL 数値からのみ生成する。

2. **非助言**  
   投資助言、売買推奨、株価予測、アナリスト予想比較は扱わない。

3. **一次資料優先**  
   企業が提出した 10-K / 10-Q と、その filing に紐づく XBRL 数値を唯一の根拠とする。

4. **低コスト運用**  
   同一 filing の取得・抽出・要約はサーバー側で 1 回だけ行い、複数ユーザーで共有する。

5. **プライバシー最小化**  
   アカウント登録なしで利用できる設計を優先し、個人情報の入力を前提にしない。

---

## v1 のスコープ
### 対応すること
- ティッカー / 企業名検索
- ウォッチリスト管理
- 最新の 10-K / 10-Q の日本語サマリー表示
- 主要財務数値の表示
- 企業ごとの AI チャット
- 回答ごとの出典表示
- オフライン閲覧用のローカル保存
- StoreKit 2 によるサブスクリプション課金
- Free / Pro の利用制限
- Free プランでのバナー広告表示

### v1 で対応しないこと
- 20-F / 6-K
- 8-K ベースの要約
- アナリスト予想、EPS サプライズ、コンセンサス比較
- 株価チャート、リアルタイム株価、ニュース速報
- 売買シグナル、ポートフォリオ管理、証券口座連携
- プッシュ通知
- Web 版 / Android 版
- 明示的な Gemini context caching 運用

---

## ポジショニング
Kabuyomi は「投資執行アプリ」ではなく、**SEC 提出書類の日本語読解・調査支援アプリ**として設計する。

App Store の説明文、スクリーンショット、審査用 Review Notes では次を徹底する。
- 売買や投資判断を代行しない
- 証券会社機能を持たない
- ポートフォリオ管理をしない
- AI の回答は SEC 提出書類の範囲に限定される
- ユーザーは原文確認を前提に使う

---

## 技術構成

### フロントエンド
- iOS（Swift / SwiftUI）
- CoreData でローカル保存
- StoreKit 2 で月額課金
- URLSession で Cloudflare Workers API と通信
- WebView は使わず、原文閲覧は Safari 遷移を基本とする

### バックエンド
- Cloudflare Workers（TypeScript）
- 全 API リクエストを Workers 経由で処理
- Gemini API キーは Workers Secrets で管理（`env.GEMINI_API_KEY`）
- SEC へのアクセス制御、共有キャッシュ、利用制限はサーバー側で一元管理

### Cloudflare の保存設計
#### Workers KV
読み取り中心かつ不変・低頻度更新のデータを保存する。
- `tickers_snapshot`
- `remote_config`
- `filing_cache:{extractorVersion}:{cik}:{accession}`

#### Durable Objects
整合性が必要な状態と調停処理を担当する。
- `SecRateLimiterDO`：SEC 全体の 10 req/s 制限を守るためのトークンバケット
- `FilingLockDO`：同一 filing の初回取り込みを 1 本に直列化
- `UserQuotaDO`：ユーザーごとの日次利用制限を JST 基準で管理
- `EntitlementDO`：StoreKit の有効購読状態からプランを判定し、サーバーが信用する `quotaSubject` を発行

### データソース
- SEC EDGAR 公式データのみ
- 全リクエストに `User-Agent: Kabuyomi admin@kabuyomi.app` を付与
- SEC へのアクセスはサーバー側で全体 10 req/s 以下に制御

### AI
- Gemini Developer API
- モデル：`gemini-2.5-flash`
- エンドポイント：`generateContent`
- v1 は **implicit caching のみ** を前提とする
- explicit caching は v1 対象外。必要になった時点で feature flag 付きで v1.1 以降に導入する

---

## 外部依存の前提
### SEC EDGAR
- レート制限は全体で 10 req/s 以下
- User-Agent 宣言必須
- `company_tickers_exchange.json` は定期更新されるが、精度や網羅性は保証されない前提で扱う

### Gemini API
- 料金とレート制限はコードに固定値で埋め込まない
- 実運用の上限は AI Studio 上のプロジェクト単位の active limits を正とする
- v1 の public release は Paid Tier を前提とする
- 開発・TestFlight 内部検証のみ Free Tier を許容する
- Free Tier は prompt / response が Google 製品改善に利用されうるため、本番運用では使わない

### Apple / App Store
- すべてのアプリで Privacy Policy リンクが必要
- チャット入力を第三者 AI に送る場合は、何をどこへ送るかを開示し、初回利用前に同意を取る
- 2026年4月28日以降、App Store Connect へ提出する iOS アプリは iOS 26 SDK 以降でのビルドが必要

---

## EDGAR API エンドポイント

### ティッカー / CIK / 取引所一覧
`GET https://www.sec.gov/files/company_tickers_exchange.json`

### 企業の提出履歴
`GET https://data.sec.gov/submissions/CIK{10桁ゼロ埋め}.json`

### 単一 XBRL 指標
`GET https://data.sec.gov/api/xbrl/companyconcept/CIK{10桁}/us-gaap/{tag}.json`

### 決算書本文
`GET https://www.sec.gov/Archives/edgar/data/{CIK}/{accessionNoNoDash}/{primaryDocument}`

---

## v1 対応フォーム
- 10-K：MD&A は `Item 7`
- 10-Q：MD&A は `Part I, Item 2`
- 20-F：v1 対象外
- 6-K：v1 対象外
- 8-K：v1 対象外

---

## 指標プリロード設計
v1 で事前取得する論理指標は次の 5 項目。

1. 売上高
2. 純利益
3. EPS（Basic）
4. 営業利益
5. 営業 CF

### 論理指標とタグ候補
単一タグ固定では欠損が出るため、論理指標ごとに候補タグを順に試す。

- 売上高
  - `RevenueFromContractWithCustomerExcludingAssessedTax`
  - `Revenues`
  - `SalesRevenueNet`

- 純利益
  - `NetIncomeLoss`
  - `ProfitLoss`

- EPS（Basic）
  - `EarningsPerShareBasic`

- 営業利益
  - `OperatingIncomeLoss`

- 営業 CF
  - `NetCashProvidedByUsedInOperatingActivities`
  - `NetCashProvidedByUsedInOperatingActivitiesContinuingOperations`

### 取得ルール
- まず `companyconcept` を候補タグ順に試す
- 目標 filing の `filedAt` / `periodOfReport` / `formType` に最も近い fact を採用する
- すべて欠損した場合のみ `companyfacts` を fallback として許容する
- 単位は monetary = `USD`、EPS = `USD/shares` を優先する

### YoY 計算ルール
- 最新 filing が 10-Q の場合：前年同四半期を優先して比較
- 最新 filing が 10-K の場合：前年 10-K を比較対象にする
- 比較対象が見つからない場合：YoY 表示は非表示

---

## サーバー側データ取得フロー

### 1. 夜間バッチ（Cron Trigger）
1. `company_tickers_exchange.json` を取得
2. 正規化して `tickers_snapshot` に保存
3. `updatedAt` を付与
4. 毎日 03:00 JST に更新

### 2. 銘柄追加時
1. `tickers_snapshot` から ticker / companyName を検索
2. 対応する CIK を取得
3. `submissions/CIK{cik}.json` を取得
4. 最新の **対応 form（10-K / 10-Q）** を 1 件選ぶ
5. `filingKey = {extractorVersion}:{cik}:{accession}` を作成
6. `FilingLockDO` で当該 `filingKey` の取り込み権を取得
7. KV に `filing_cache` があればそれを返す
8. キャッシュがなければ filing HTML 本文を取得
9. MD&A を抽出
10. 財務指標 5 項目を取得
11. 比較用の前期データを取得して YoY / 変化点生成用に整形
12. Gemini で日本語サマリーを生成
13. 出典付きの `SourceChunk` を生成
14. `filing_cache` に保存
15. レスポンスを返す

### 3. MD&A 抽出ルール
#### 10-K
- 開始候補：`Item 7`
- 終了候補：`Item 7A` または `Item 8`

#### 10-Q
- 開始候補：`Part I, Item 2`
- 終了候補：`Item 3` または `Item 4`

#### 実装方針
- まず Inline XBRL / anchor / id / name を利用して位置特定
- 取れない場合は heading 文字列の正規表現で開始・終了を推定
- 目次の誤検出を避けるため、文量が閾値未満の候補は捨てる
- HTML をテキスト化した後に空白・改行・脚注ノイズを正規化
- 文章途中で切らないよう sentence boundary を見ながら上限まで採用する

### 4. トークン上限
- モデル上の上限ではなく、**コストと応答速度を制御するため** に MD&A を最大 15,000 トークンで切る
- 先頭優先で採用し、できるだけ文末で切る
- 15,000 トークンを超える場合でも filing metadata は必ず残す

### 5. サマリー生成
Gemini には以下を渡す。
- filing metadata（企業名、ticker、formType、filedAt、periodOfReport）
- 抽出済み MD&A
- 現在値 5 指標
- 比較用の前期値
- sourceId 付き source chunks

### 6. サマリー出力形式
サマリーは JSON で返し、サーバー側で schema validation する。

```json
{
  "verdict": "string",
  "highlights": [
    { "text": "string", "sourceIds": ["S1", "S3"] }
  ],
  "changes": [
    { "text": "string", "sourceIds": ["S4"] }
  ]
}
```

---

## AI チャット設計

### v1 のチャット方針
- 文脈は **最新 filing の MD&A + 主要 XBRL 指標** に限定する
- その範囲にない質問には「この filing の提供コンテキストでは確認できません」と返す
- 回答の各主張に sourceId を付ける
- sourceId が存在しない回答はサーバー側で破棄または再試行する

### チャット時の流れ
1. `filing_cache` から MD&A / metrics / source chunks を取得
2. 固定テンプレートで system prompt を組み立てる
3. source chunks に `S1`, `S2` のような sourceId を付与する
4. ユーザー質問を Gemini に送る
5. Gemini は回答本文と sourceIds を返す
6. サーバー側で sourceIds を検証する
7. 構造化された出典に変換して iOS に返す
8. ローカルに ChatMessage を保存する

### チャットの禁止事項
モデルには次を明示する。
- 株価見通しを言わない
- 売買推奨をしない
- アナリスト予想や市場期待を持ち込まない
- 与えた source chunks にない数値を作らない
- 不明な場合は不明と返す

---

## Gemini API 仕様
モデル：`gemini-2.5-flash`  
エンドポイント：
`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`

認証：`x-goog-api-key` ヘッダー

### v1 の運用方針
- public release は Paid Tier Standard を前提とする
- v1 は implicit caching のみ
- explicit caching は未使用
- system prompt の並び順・表現を固定して、implicit caching が効きやすい入力に寄せる

### 料金メモ（2026年4月時点の前提）
- Standard input：$0.30 / 1M tokens（text / image / video）
- Standard output：$2.50 / 1M tokens
- explicit context caching：$0.03 / 1M cached tokens + $1.00 / 1M tokens / hour storage

### レート制御
- Gemini のレート制限はプロジェクト単位で扱う
- アプリ内の Free / Pro 制限は独自実装し、Gemini 側の RPD とは分離する
- Workers 側に soft cap / hard cap を設ける
- 月次 spend cap は AI Studio 側でも設定する

---

## 課金とプラン設計

### プラン構成
| | Free | Pro |
|---|---:|---:|
| ウォッチ銘柄数 | 3 | 無制限 |
| AI チャット | 3回 / 日 | 50回 / 日 |
| 広告 | あり | なし |
| 価格 | 無料 | 月額 ¥980 |

### 課金方式
- StoreKit 2 の auto-renewable subscription
- 商品は月額 1 プランのみで開始
- 年額プランは v2 以降

### Apple 手数料
- Small Business Program 参加を前提
- 想定受取は 85%
- ただし reduced commission は申請承認後に反映されるため、申請未完了の公開直後は標準料率で着地する可能性がある
- 収益計画は Small Business Program 承認タイミングを別管理する

### 運用方針
- **内部開発 / TestFlight（限定）**：Gemini Free Tier 可
- **App Store 公開版**：Gemini Paid Tier Standard
- 月次コストは fixed numbers ではなく spend cap と remote config で管理

### Remote Config
KV の `remote_config` に下記を保持する。
- `freeStockLimit`
- `freeDailyChatLimit`
- `proDailyChatLimit`
- `adsEnabled`
- `chatEnabled`
- `maintenanceMode`
- `extractorVersion`
- `promptVersion`

これにより、コスト逼迫時にアプリ更新なしで利用制限を変更できる。

---

## ユーザー識別と利用制限

### 基本方針
アカウント登録は設けない。その代わり、**端末識別** と **購読識別** を分けて扱う。

### 端末識別
- 初回起動時に匿名 UUID を生成
- Keychain に保存
- Free プラン時の利用制限はこの `deviceKey` 単位

### Pro 識別
- StoreKit 2 の購読情報をサーバーへ同期
- サーバーは有効な購読から `quotaSubject` を発行
- `quotaSubject` は `originalTransactionId` 相当の安定識別子をハッシュ化した値を利用する
- これにより、同一 Apple ID での復元時に Pro 状態をサーバー側で再現できる

### 利用制限の判定
- Free：`free:{deviceKey}`
- Pro：`pro:{subscriptionHash}`

### 利用制限の保存先
`UserQuotaDO` に JST 日付単位で保存する。

管理項目：
- `quotaSubject`
- `plan`
- `dateJST`
- `chatsUsed`
- `stocksUsed`
- `updatedAt`

---

## Workers API 仕様

### `GET /v1/search?q=...`
検索画面用。`tickers_snapshot` から ticker / companyName / exchange を返す。

#### Response
```json
{
  "items": [
    {
      "ticker": "AAPL",
      "companyName": "Apple Inc.",
      "cik": "0000320193",
      "exchange": "Nasdaq"
    }
  ],
  "snapshotUpdatedAt": "2026-04-12T03:00:00+09:00"
}
```

### `POST /v1/watchlist/add`
銘柄追加。最新 filing の取得・抽出・要約まで行う。

#### Request
```json
{
  "ticker": "AAPL"
}
```

### `GET /v1/company/{ticker}`
最新のローカル表示用データ取得。summary / metrics / filing metadata を返す。

### `POST /v1/company/{ticker}/refresh`
手動再取得。最新 supported filing が変わっていれば再取り込みする。

### `POST /v1/chat`
企業ごとの質問。

#### Request
```json
{
  "filingKey": "v1:0000320193:000032019326000057",
  "question": "今期の利益率悪化の主因は？"
}
```

#### Response
```json
{
  "answer": "...",
  "sources": [
    {
      "sourceId": "S3",
      "sectionType": "md_a",
      "sourceLabel": "10-Q Part I Item 2, filed 2026-02-03",
      "excerpt": "..."
    }
  ],
  "usage": {
    "plan": "free",
    "chatsUsed": 2,
    "chatLimit": 3
  }
}
```

### `GET /v1/usage`
現在のプランと残利用回数を返す。

### `POST /v1/billing/sync`
StoreKit の購読状態をサーバーと同期し、plan / quotaSubject を更新する。

---

## 画面構成

### タブバー
- ホーム
- 検索
- 設定

### ホーム画面
- ウォッチリスト銘柄一覧
- 各銘柄カード
  - 企業名
  - ティッカー
  - 最新サマリー冒頭
  - 主要数値
  - 更新日
  - 新着バッジ
- Free のみ左カラム下部に AdMob バナー

### 検索画面
- ticker / 企業名検索
- 検索結果に追加ボタン
- 検索画面内には AdMob バナーを出さない

### 企業ページ
#### ヘッダー
- 企業名
- ティッカー
- 取引所
- 会社開示ベースの一言結論
- formType
- filedAt
- 原文を開くボタン

#### 財務数値ミニカード
- 売上高（YoY）
- 純利益（YoY）
- EPS（YoY）

#### タブ 1：決算サマリー
- 一言結論
- 業績ハイライト一覧
- 比較期間からの変化点一覧
- 最終更新日
- 再取得ボタン
- 各行に出典チップ表示

#### タブ 2：AI チャット
- サジェスト質問 5 件
- 入力欄
- 回答本文
- 出典チップ
- 免責事項
- AI 利用に関する注意文言

### 設定画面
- 現在のプラン
- Pro へアップグレード
- 使用状況（銘柄数 / 今日のチャット回数）
- 購読の復元
- プライバシーポリシー
- 利用規約
- サポート
- AI 利用同意の再確認
- データリセット
- バージョン

### v1 から外す UI
- 通知設定
- Buy Me a Coffee
- 株価チャート
- EPS 予想差
- 予想上回る / 下回る バッジ

---

## CoreData モデル

### Stock
- `id: UUID`
- `ticker: String`
- `companyName: String`
- `cik: String`
- `exchange: String`
- `addedAt: Date`
- `lastUpdatedAt: Date`
- relationship: `filings`

### Filing
- `id: UUID`
- `filingKey: String`
- `formType: String`（10-K / 10-Q）
- `filedAt: Date`
- `periodOfReport: Date`
- `accessionNumber: String`
- `primaryDocumentUrl: String`
- `mdaText: String`
- `mdaTokenCount: Int`
- `extractorVersion: String`
- `promptVersion: String`
- relationship: `stock`
- relationship: `summary`
- relationship: `metrics`
- relationship: `sourceChunks`
- relationship: `chatMessages`

### Summary
- `id: UUID`
- `generatedAt: Date`
- `verdictText: String`
- `comparisonLabel: String`
- `modelName: String`
- relationship: `filing`
- relationship: `items`

### SummaryItem
- `id: UUID`
- `kind: String`（highlight / change）
- `text: String`
- `sortOrder: Int`
- relationship: `summary`
- relationship: `sourceRefs`

### FinancialMetric
- `id: UUID`
- `logicalName: String`（revenue / netIncome / epsBasic / operatingIncome / operatingCashFlow）
- `tagUsed: String`
- `value: Double`
- `unit: String`
- `periodEnd: Date`
- `comparisonValue: Double?`
- `yoyPercent: Double?`
- relationship: `filing`

### SourceChunk
- `id: UUID`
- `sourceId: String`（S1, S2, ...）
- `sectionType: String`（md_a / xbrl_metric）
- `sectionTitle: String`
- `sourceLabel: String`
- `text: String`
- `startOffset: Int`
- `endOffset: Int`
- `tagName: String?`
- `sortOrder: Int`
- relationship: `filing`

### ChatMessage
- `id: UUID`
- `role: String`（user / assistant）
- `content: String`
- `createdAt: Date`
- `modelName: String`
- relationship: `filing`
- relationship: `sourceRefs`

### MessageSourceRef
- `id: UUID`
- `sourceLabelSnapshot: String`
- `excerpt: String`
- relationship: `chatMessage`
- relationship: `sourceChunk`

---

## サーバーキャッシュ設計

### KV: `tickers_snapshot`
```json
{
  "updatedAt": "2026-04-12T03:00:00+09:00",
  "items": [
    {
      "ticker": "AAPL",
      "companyName": "Apple Inc.",
      "cik": "0000320193",
      "exchange": "Nasdaq"
    }
  ]
}
```

### KV: `filing_cache:{extractorVersion}:{cik}:{accession}`
```json
{
  "filingKey": "v1:0000320193:000032019326000057",
  "ticker": "AAPL",
  "companyName": "Apple Inc.",
  "cik": "0000320193",
  "formType": "10-Q",
  "filedAt": "2026-02-03",
  "periodOfReport": "2025-12-28",
  "primaryDocumentUrl": "...",
  "mdaText": "...",
  "metrics": [],
  "sourceChunks": [],
  "summary": {
    "verdict": "...",
    "highlights": [],
    "changes": []
  },
  "generatedAt": "2026-04-12T03:10:00+09:00"
}
```

### キャッシュ方針
- filing は accession 単位で実質不変なので、**短 TTL は付けない**
- 抽出ロジックや prompt が変わった場合は `extractorVersion` / `promptVersion` を上げて新キーで再生成する
- 旧キャッシュの削除は運用タスクで行う

---

## エラーハンドリング方針

### SEC 側エラー
- 429 / 403 / Access Denied 時は再試行せず、ユーザーには「現在取得できません」を返す
- `SecRateLimiterDO` により通常時の 10 req/s 超過を防ぐ
- filing 取得失敗時も検索結果自体は残す

### MD&A 抽出失敗
- サマリー生成を行わず「本文抽出に失敗しました」を返す
- ユーザーには原文を開く導線を出す
- 失敗 filing は再試行対象としてログに残す

### Gemini 側エラー
- 既存サマリーがあればそれを表示し、チャットだけ一時停止
- チャット失敗はローカル保存しない
- rate limit 到達時は remote config で chatEnabled を落とせるようにする

### オフライン
- 取得済みの summary / metrics / chat history は CoreData から表示
- 再取得と新規チャットは無効化

---

## プライバシーとデータ共有

### 収集方針
- アカウント登録なし
- 氏名、メールアドレス、証券口座情報、保有銘柄、資産残高は収集しない
- サーバーに保存するのは匿名識別子、購読状態、利用回数、問い合わせログ最小限

### AI 利用時に送るデータ
- ユーザー質問テキスト
- 対象企業の filing metadata
- 抽出済み MD&A
- 抽出済み XBRL 数値

### 初回 AI 利用時の同意
初回チャット開始前に以下を表示し、同意がない限り AI チャットを使わせない。
- 入力内容が Google Gemini に送信されること
- 送信されるのは質問内容と対象企業の SEC 提出書類コンテキストであること
- 個人情報や機密情報を書かないこと
- プライバシーポリシーへのリンク

### App Privacy
App Store Connect の privacy nutrition label は、実装した SDK に応じて以下を申告対象とする。
- User Content（チャット入力）
- Identifiers（deviceKey、購読識別子、広告 SDK が利用する識別子）
- Diagnostics（クラッシュ / エラーの範囲で導入時のみ）

### Privacy Policy に必ず書く内容
- 何を収集するか
- 何を送信するか
- どの第三者に送るか
- 保存期間
- 削除方法
- 問い合わせ先

---

## 広告方針
- AdMob バナーは Free プランの左カラム下部に限定する
- Company / Chat の会話本文、検索結果、入力欄周辺には広告を出さない
- v1 はバナーのみ
- インタースティシャル、リワード、ネイティブ広告は使わない
- 広告実装時はプライバシーラベルと ATT 要否を release checklist で最終確認する

---

## 免責事項
### アプリ内表示文言
本アプリは SEC EDGAR の公開提出書類を読みやすくするための情報提供アプリです。  
株価予測、投資助言、売買推奨、アナリスト予想の提供は行いません。  
AI による要約・回答には誤りや省略が含まれる可能性があります。  
必ず原文も確認し、投資判断はご自身の責任で行ってください。

### チャット入力欄の補助文言
個人情報、証券口座情報、機密情報は入力しないでください。

---

## App Store 審査対応

### メタデータの方針
- 説明文では「投資助言」ではなく「SEC 提出書類の読解支援」と表現する
- スクリーンショットでは出典表示 UI を見せる
- プライバシーポリシーと利用規約のリンクを用意する
- 外部課金導線、Buy Me a Coffee は置かない

### Review Notes に書く要点
- 本アプリは公開 SEC filing の読解支援アプリである
- 売買執行やポートフォリオ管理はしない
- AI 回答は SEC 提出書類と XBRL 数値に限定される
- すべての回答に出典を付ける
- ユーザー入力は Gemini へ送信されるため、初回利用時に同意を取得する

### 提出前チェック
- iOS 26 SDK でビルド
- Privacy Policy リンクが機能する
- サポート連絡先が有効
- 購読復元が動作する
- StoreKit 商品情報がレビュー環境で見える

---

## 開発スケジュール

### Week 1
- Workers プロジェクト作成
- KV / Durable Objects 設定
- SEC レート制御実装
- ticker snapshot の Cron 実装
- submissions / filing HTML / companyconcept 取得実装
- MD&A 抽出器実装
- 代表銘柄の fixture を使った抽出テスト作成

### Week 2
- iOS プロジェクト作成
- CoreData モデル実装
- Home / Search / Company 基本 UI 実装
- Workers API 通信実装
- ローカル保存実装

### Week 3
- サマリー UI 実装
- AI チャット UI 実装
- 出典チップ表示
- StoreKit 2 実装
- AdMob 実装
- UserQuotaDO と利用制限同期

### Week 4
- エラーハンドリング全体
- オフライン動作確認
- Privacy Policy / Terms / Support 導線実装
- TestFlight 配布
- App Review 用スクリーンショット作成
- Review Notes 作成
- バグ修正

---

## テスト方針
### 抽出テスト
- 10-K / 10-Q の代表サンプルを最低 20 本用意
- TOC 誤検出
- Inline XBRL あり / なし
- HTML 構造差分
- 大型 filing
- 欠損タグ

### API テスト
- SEC 429 想定
- filing cache hit / miss
- 同一 filing 同時追加
- quota 超過
- 購読復元

### UI テスト
- Free / Pro 切替
- オフライン表示
- 出典チップ押下
- 長文回答折りたたみ
- 広告あり / なし

---

## 将来拡張（v1.1 以降）
- 20-F 対応
- 6-K の限定対応
- explicit caching の短 TTL 導入
- push 通知
- Web 版
- 年額プラン
- セクション追加（Risk Factors / Notes）
- 8-K の限定サマリー

---

## まとめ
Kabuyomi v1 は、機能を **10-K / 10-Q の日本語読解 + 出典付き AI チャット** に絞った iOS アプリとして出す。

成功条件は次の 4 点。
- SEC の一次資料だけで完結すること
- 出典が必ず見えること
- サーバー側で重複取得を防ぎ、低コストで運用できること
- App Store 審査上「投資助言アプリ」に見せず、読解支援アプリとして一貫させること
