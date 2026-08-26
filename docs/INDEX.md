# ドキュメントの地図

最終更新: 2026-08-25

**迷ったらここから。** 探し方は「何をしたいか」で引く。

現在の出荷状態の正は [release/CURRENT_SHIPPING_TRUTH.md](./release/CURRENT_SHIPPING_TRUTH.md)。
これと食い違う古い文書は、古い方を歴史として扱う。

---

## いま動いている作業

| 何を | どこ |
|---|---|
| **v2 の残タスクと完了条件** | [ui-redesign-v2/V2_COMPLETION_CHECKLIST.md](./ui-redesign-v2/V2_COMPLETION_CHECKLIST.md) ← **単一の真実** |
| v2 を出す手順とロールバック | [release/V2_DEPLOY_CHECKLIST_2026-08-24.md](./release/V2_DEPLOY_CHECKLIST_2026-08-24.md) |
| v2 のリリース文章・審査メモ・X 投稿 | [release/V2_RELEASE_NOTES.md](./release/V2_RELEASE_NOTES.md) |
| 外国企業(20-F / 6-K)対応の設計と実測 | [quality/FOREIGN_ISSUER_SUPPORT_2026-08-24.md](./quality/FOREIGN_ISSUER_SUPPORT_2026-08-24.md) |

## 誰にどう届けるか

| 何を | どこ |
|---|---|
| **実際に使われているかの実数** | [quality/USAGE_REALITY_2026-08-24.md](./quality/USAGE_REALITY_2026-08-24.md) ← **数字の出発点** |
| App Store の名前・キーワード | [growth/ASO_PROPOSAL_2026-08.md](./growth/ASO_PROPOSAL_2026-08.md) |
| 何を出すかの計画(9〜11月) | [growth/CAMPAIGN_PLAN_2026-09.md](./growth/CAMPAIGN_PLAN_2026-09.md) |
| 実装済みの導線と、オーナー作業 | [growth/MARKETING_PLAN_2026-08.md](./growth/MARKETING_PLAN_2026-08.md) |
| 広告費の使い方 / 出す場所 | [growth/PAID_AND_PLACES_2026-08-24.md](./growth/PAID_AND_PLACES_2026-08-24.md) |
| 差別化(機能を良くする案) | [growth/DIFFERENTIATION_2026-08-24.md](./growth/DIFFERENTIATION_2026-08-24.md) |
| 差別化(前提を変える案) | [growth/DIFFERENTIATION_ALT_2026-08-25.md](./growth/DIFFERENTIATION_ALT_2026-08-25.md) |
| 有料データを計算で出す話(法的整理つき) | [growth/DERIVED_METRICS_2026-08-25.md](./growth/DERIVED_METRICS_2026-08-25.md) |
| 記事の下書き | [articles/](./articles/) |

## 出す・運用する

| 何を | どこ |
|---|---|
| 現在の出荷状態(**正**) | [release/CURRENT_SHIPPING_TRUTH.md](./release/CURRENT_SHIPPING_TRUTH.md) |
| リリースゲートの機械可読な状態 | `release/RELEASE_GATE_STATE.json`(`deploy:check` が読む。**動かさないこと**) |
| 次のデプロイ用に用意した waiver | `release/RELEASE_GATE_STATE.pending-*.json` |
| App Review 用のメモ | [release/APP_STORE_SUBMISSION_NOTES.md](./release/APP_STORE_SUBMISSION_NOTES.md) |
| remote config の更新手順 | [release/REMOTE_CONFIG_LIFECYCLE_RUNBOOK.md](./release/REMOTE_CONFIG_LIFECYCLE_RUNBOOK.md) |
| 広告(AdMob)の運用 | [admob/](./admob/) |
| sec-fetcher の移行手順 | [deploy/](./deploy/) |
| 法務ページの文面 | [legal/](./legal/) |

## 品質・監査

| 何を | どこ |
|---|---|
| 全読み監査(2026-08-22、定数回答の全廃) | [quality/FULL_READ_AUDIT_2026-08-22.md](./quality/FULL_READ_AUDIT_2026-08-22.md) |
| 監査で出た指摘(2026-08-21) | [quality/AUDIT_FINDINGS_2026-08-21.md](./quality/AUDIT_FINDINGS_2026-08-21.md) |
| チャット回答の契約 | [quality/chat_quality_contract.md](./quality/chat_quality_contract.md) |
| Worker の構造 | [quality/WORKER_ARCHITECTURE_BRIEF.md](./quality/WORKER_ARCHITECTURE_BRIEF.md) / [quality/worker_system_map.md](./quality/worker_system_map.md) |
| モデル比較(gpt-5.6-luna) | [quality/MODEL_EVAL_LUNA_2026-08-24.md](./quality/MODEL_EVAL_LUNA_2026-08-24.md) |

## 設計

| 何を | どこ |
|---|---|
| v2 の画面設計 | [ui-redesign-v2/](./ui-redesign-v2/) |
| v1 の画面設計(歴史) | [ui-redesign/](./ui-redesign/) |

---

## archive/ — 読まなくていいもの

**現在の判断に使わない。** 過去にそうだった、という記録として残してある。

| | 中身 |
|---|---|
| `archive/v1/` | v1 の PR ごとのレポート 21 本と v1.0.2 の作業レポート 35 本、それに v1 時点の出荷状態やゲート報告。**現在の出荷状態とは食い違う** |
| `archive/v1-quality/` | v1.1 の品質改善(Q04 / Q06 の回答改善)の作業記録 39 本 |
| `archive/sale/` | 2026-06 の売却検討(買い手向け資料・販路調査) |
| `archive/diagnostics/` | 図と Worker のログ(旧 `tmp/`) |
| `archive/SYSTEM_AUDIT_2026-05-22.md` | 旧 `timpo.md`。2026-05 時点の第三者監査 |
| `archive/HANDOFF_2026-05-24.md` | 旧 `timtim.md` |
| `archive/HANDOFF_2026-08-21.md` | 8/21 時点の引き継ぎ。以降の作業で大半が更新済み |

## 置き場所のルール

新しく文書を足すときは、この分類のどれかに入れる。入らないなら分類の方を疑う。

- **release/** — 出す・運用するための手順と状態。**現役のものだけ**
- **growth/** — 届け方。ASO・キャンペーン・広告・差別化
- **quality/** — 品質と監査。回答の正しさ、Worker の構造
- **articles/** — 外に出す記事の下書き
- **archive/** — 終わった作業の記録。**日付を名前に入れる**

作業が終わって参照されなくなった文書は、消さずに `archive/` へ動かす。
消すと「なぜそうしたか」が失われる。
