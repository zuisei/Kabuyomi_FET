# Market Docket Cloudflare Preview Deployment

## Result

PASS — 2026-07-20 09:06 JST

手動投入 → Mac Processor → 人間レビュー → 公開 → iPhone表示の縦切りに加え、文書関係・時刻来歴・外部キャッシュ識別・管理画面保護を修正した。

## Live endpoints

- Public: `https://md-api-preview.dznqjmctk7.workers.dev`
- Public Worker Version: `3d8c8b70-54d1-455e-a0e8-677d27b3216a`
- Public build time: `2026-07-20T00:04:06.136248Z`
- Dataset revision: `2026-07-19T23:48:16.457Z`
- Admin: `https://md-admin-preview.dznqjmctk7.workers.dev/admin`
- Admin Worker Version: `9c216640-23b1-4933-8d67-c09c557dab84`

Public APIは外部新規取得で`data_mode: live`。`/v1/health`はPreview環境、live mode、実Worker Version、schema version 1、dataset revision、build time、Core/Ops疎通を返す。公開レスポンスには`X-MD-Version / X-MD-Data-Mode / X-MD-Schema-Version / X-MD-Dataset-Revision`を付け、一覧は`no-cache, must-revalidate`とETagで再検証する。

## Correct document model

対象Event: `9cb65e97-dc25-43ff-8c51-2efb6cc44618`

- Document A: `FR Doc. 2023-17243` / `final_rule` / `primary`
- Document B: `FR Doc. 2023-18047` / `correcting_amendment` / `corrects Document A`
- Document A/Bはいずれも同一文書内`Revision 1`。Version 1/2として扱わない。
- D1: EventにDocument 2件、DocumentRevision 2件、Timeline 2件。
- R2: `v1/documents/{document-id}/revisions/1/...`へ別Documentとして保存。
- 同じ2文書の再投入は既存completed jobを返し、Document/Revision/Timelineを増やさない。

## Time provenance

Replayは文書ごとの`available_at`を使う。今回は公式資料に記載されたFiled時刻のタイムゾーンが確定できないため、`availability_basis=publication_date_only`、`time_precision=day`とした。

- 原規則: 掲載 `2023-08-14`、発効 `2023-08-11`、資料記載 `Filed 8/11/2023 8:45 am`、timezone `NULL`
- 訂正文書: 掲載 `2023-08-21`、発効 `2023-08-17`、適用開始 `2023-08-11`、資料記載 `Filed 8/17/2023 4:15 pm`、timezone `NULL`
- `first_observed_at`と`ingested_at`は別値で来歴に保存し、政策Replay境界には使わない。
- 一覧の`publishedAt/revisedAt`は日単位資料では`null`にし、クライアントが架空のET/JST時刻を描画しない。

Replay live確認:

- `2023-08-20T23:59:59Z`: 原規則1件、Timeline 1件。
- `2023-08-21T00:00:00Z`: 原規則＋訂正文書、Timeline 2件。

## Admin protection

Admin Worker全体をCloudflare Access application `Market Docket Admin Preview`で保護した。

- 未認証`GET /admin`: `302` Access loginへ転送。
- Owner policy: 指定メールだけ`Allow`。
- Mac Processor policy: `Service Auth` + 専用Service Token。
- Worker内Admin API: 従来どおりBearer Admin token必須。
- Access Client ID/SecretとAdmin tokenはmacOS Keychainへ保存し、平文ファイルへ置かない。
- Processorは環境変数を優先し、未指定時はPreview用KeychainからAccess credentialを取得。
- Access Service Token + Admin tokenで`POST /admin/jobs/claim`が`204`になることをlive確認。

## Resources

Preview:

- D1 Core: `market-docket-core-preview` / `d2ea87cc-99be-40f6-8533-04e7399de5cf`
- D1 Ops: `market-docket-ops-preview` / `09ff11ce-34f7-4ac8-a713-06f0c09f836c`
- R2 Raw/Derived/Temp: `market-docket-{raw,derived,temp}-preview`

Productionは別D1/R2として物理分離し、migration済み・データ0件・Worker未公開。Synthetic fixtureはProductionへ投入しない。

## Validation

- Backend unit/contract: 11/11 PASS
- Backend TypeScript: PASS
- iPhone unit: 18/18 PASS
- iPhone UI flow: 1/1 PASS
- Public fresh GET live + headers: PASS
- ETag 304: PASS
- Replay 2境界: PASS
- Idempotent re-ingest: PASS
- Access unauthenticated redirect: PASS
- Access Service Auth + Admin token: PASS
- Simulator final screenshots: `Artifacts/Screenshots/2026-07-20_09-06-01_JST_PHASE2_FINAL/`

## Boundary

Federal Register自動Adapter、Cron、全source監視、市場データ、APNs、アカウント、全文検索基盤、AI自動公開は未実装。次は既存の共通Job後半を再利用するFederal Register Adapter。
