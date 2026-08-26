# D1 Schema Inventory

Coreの業務テーブルはmigration `0001`〜`0010`適用後で37個。Cloudflare管理の`_cf_KV`と`d1_migrations`、SQLite管理の`sqlite_sequence`は含めない。既存19テーブルを破壊せず、TestFlight foundation、レビュー、市場、製品分析の各レイヤーを追加している。

| # | Table | 用途 | 保持期間 | 分類 |
|---:|---|---|---|---|
| 1 | `sources` | 取得元の定義 | source廃止まで | 内部 |
| 2 | `source_items` | 取得元で発見した項目 | 無期限 | 内部 |
| 3 | `storage_objects` | R2 objectとSHA-256の台帳 | 参照中は無期限 | 内部 |
| 4 | `documents` | 公式文書の論理単位、文書種別、corrects関係、公開・発効・取得来歴 | 無期限 | 公開元 |
| 5 | `document_revisions` | 同じ文書ID内の内容更新と利用可能時刻 | 無期限 | 公開元 |
| 6 | `document_diffs` | 版間差分の参照 | 無期限 | 公開元 |
| 7 | `policy_events` | 政策イベント本体 | 無期限 | 公開元 |
| 8 | `event_documents` | イベントと文書の関係 | 無期限 | 公開元 |
| 9 | `timeline_entries` | 公開・検知・報道・改訂等 | 無期限 | 公開元 |
| 10 | `entities` | 企業・銘柄等の実体 | 無期限 | 公開元 |
| 11 | `event_entities` | イベントと企業の根拠 | 無期限 | 公開元 |
| 12 | `tags` | Topicの正規化辞書 | 無期限 | 公開元 |
| 13 | `event_tags` | イベントとTopicの関係 | 無期限 | 公開元 |
| 14 | `confounders` | 同時発生材料 | 無期限 | 公開元 |
| 15 | `market_evaluations` | 市場評価の確定値 | ライセンス条件内 | 公開元 |
| 16 | `market_points` | 時系列市場点 | ライセンス条件内 | 公開元 |
| 17 | `corrections` | 要約・根拠の訂正履歴 | 無期限 | 公開元 |
| 18 | `publication_reviews` | 人間レビュー、Derived上のdraft参照、承認履歴 | 7年を初期方針 | 内部監査 |
| 19 | `event_read_models` | Public API用の承認済みJSON | 差替え後1年 | 公開キャッシュ |

### 追加Coreテーブル（0005〜0009）

| # | Table | 用途 | 分類 |
|---:|---|---|---|
| 20 | `policy_domains` | 政策分野カタログ | 公開元 |
| 21 | `policy_instruments` | 政策手段カタログ | 公開元 |
| 22 | `source_adapters` | Adapter構成 | 内部 |
| 23 | `dockets` | Docket識別子 | 公開元 |
| 24 | `event_dockets` | EventとDocketの関係 | 公開元 |
| 25 | `document_relationships` | 文書関係候補とレビュー | 内部監査 |
| 26 | `issuers` | 発行体。Tickerとは分離 | 公開元 |
| 27 | `securities` | 市場銘柄・Security | 公開元 |
| 28 | `ticker_aliases` | Ticker別名 | 内部 |
| 29 | `company_exposures` | 既存の企業Exposure | 公開元 |
| 30 | `exposure_evidence` | Exposure根拠 | 公開元 |
| 31 | `market_data_providers` | 市場データ権利レビュー | 内部 |
| 32 | `market_windows` | 市場評価窓 | 公開元 |
| 33 | `audit_logs` | 管理操作の監査 | 内部監査 |
| 34 | `analyst_reviews` | 既存の人間レビュー | 内部監査 |
| 35 | `policy_analyses` | version付き編集・分析、Tier、市場モード | Preview/TestFlightはDraft可、Productionはpublishedのみ |
| 36 | `policy_analysis_history` | 分析Draft・review・publish・reject履歴 | 内部監査 |
| 37 | `policy_company_relations` | Issuer/Securityを分離した根拠付き関連候補 | Preview/TestFlightはcandidate可、Productionはapprovedのみ |

`0010_document_comment_deadline.sql`は新テーブルを増やさず、`documents.comments_close_on`を追加する。法的日付は`published_on / effective_on / applicable_on / comments_close_on`として分離する。

Opsは8テーブル。Cloudflare/SQLite管理テーブルは数えない。すべて非公開で、Public Workerは内容を返さない。

`final_rule`と、それを直す別の`correcting_amendment`は`documents`の別rowにする。`document_revisions`は同じ公式文書ID/URLの内容が更新された場合だけに使う。今回の`FR Doc. 2023-17243`と`FR Doc. 2023-18047`はDocument 2件、Revisionは各1件。

| Table | 用途 | 保持期間 |
|---|---|---|
| `ingestion_runs` | 手動・自動取得run | 90日 |
| `jobs` | lease付き処理job | 完了後30日 |
| `job_events` | 状態遷移監査 | 90日 |
| `fetch_attempts` | HTTP取得結果 | 30日 |
| `source_health` | source別最新状態 | 最新値 |
| `usage_counters` | 無料枠guard | 13か月 |
| `maintenance_state` | scheduler/保守状態 | 最新値 |
| `dead_letters` | 再試行不能job | 90日 |
