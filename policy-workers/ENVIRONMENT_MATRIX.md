# Environment Resource Matrix

PreviewとProductionはD1/R2を物理的に分離する。prefix共有はしない。

| Role | Preview | Production | Synthetic data |
|---|---|---|---|
| Public Worker | `md-api-preview` | `md-api-prod` | Previewのみ可 |
| Admin Worker | `md-admin-preview` | `md-admin-prod` | 非公開 |
| D1 Core | `market-docket-core-preview` | `market-docket-core-prod` | Productionへ投入禁止 |
| D1 Ops | `market-docket-ops-preview` | `market-docket-ops-prod` | Productionへ投入禁止 |
| R2 Raw | `market-docket-raw-preview` | `market-docket-raw-prod` | Productionへ投入禁止 |
| R2 Derived | `market-docket-derived-preview` | `market-docket-derived-prod` | Productionへ投入禁止 |
| R2 Temp | `market-docket-temp-preview` | `market-docket-temp-prod` | Productionへ投入禁止 |

TestFlightはPreview/Productionから物理分離する。

| Role | TestFlight |
|---|---|
| Public Worker | `md-api-testflight` |
| Admin Worker | `md-admin-testflight` |
| D1 Core | `market-docket-core-testflight` / `7c5551d7-6aa8-45ac-a09c-bb53802c9fe9` |
| D1 Ops | `market-docket-ops-testflight` / `1b011ef4-37b6-4049-9c45-8b4d0e05ed2e` |
| R2 Raw / Derived / Temp | `market-docket-{raw,derived,temp}-testflight` |

## Resource IDs and status (2026-07-22 JST)

- Preview Core: `d2ea87cc-99be-40f6-8533-04e7399de5cf`
- Preview Ops: `09ff11ce-34f7-4ac8-a713-06f0c09f836c`
- Production Core: `1622c15a-5301-4edc-a749-ef078bba67b1`
- Production Ops: `93bf5ee8-ff4e-446e-b2f7-93c3bcd85fd1`
- Preview/ProductionのTemp bucketはいずれも`v1/runs/`を14日後に削除する。
- Production Coreはmigration `0011`、Opsは`0004`まで適用済み。公式ソース由来のlive eventは121件で、synthetic eventは0件。
- Production Public/Admin Workerは`md-api-prod` version `e8698dfc-f661-4484-82bb-382357b6d981` / `md-admin-prod` version `b1964f9d-0dd0-44ad-8e34-ec6c886057c3`。Public APIはschema 5。個別翻訳POSTはprivate Admin service bindingを同期呼び出しし、15分Cronは自動新着と障害回収のfallbackとして残す。
- OpenAI credentialは`md-admin-prod`のsecretだけに保存し、Public WorkerとiPhoneへは渡さない。Public/Admin間は専用`TRANSLATION_TRIGGER_TOKEN`で認証する。2026-07-22 00:00 JSTより前の資料は、利用者が1件ずつ要求した場合だけ`manual_priority`へ移し、履歴Batchは自動作成・自動送信しない。
- TestFlight独立環境はCore `0011` / Ops `0004`まで適用済み。Public/Admin Workerは`md-api-testflight` version `80e77af8-bb7b-4add-b465-04506177cdee` / `md-admin-testflight` version `53a5a1b6-aaa4-47e7-a3d9-4188e9edc359`。Public APIはschema 6。個別翻訳と失敗した自動翻訳の明示的な再試行は同期service bindingで即時処理し、15分Cronへは依存しない。品質検査で英語のまま残った化学物質名は日本語名またはカタカナへ修復し、原題にない訂正suffixは保存前に除去する。原文がcommentでhearingではない場合は、`公聴期間`や`コメント期間`を`意見募集期間`へ正規化する。
- OpenAI credentialは`md-admin-testflight`のsecretだけに保存し、Public WorkerとiPhoneへは渡さない。Production処理済み4件（受理2、validation rejected 2）はTestFlightへpromotionし、同じ内容への追加OpenAI利用を0 tokensにした。
- TestFlight履歴359件は`batch / awaiting_batch`候補のみ。Batch manifest、input file、OpenAI Batch申請・送信はいずれも0件で、明示確認までprepare / submitしない。
- 2026-07-22 14:31 JSTの記録済み翻訳tokenはTestFlight 11,115、Production 5,723。両環境ともBatch manifest 0、processing 0、retry 0。
- Synthetic fixtureはProduction D1/R2へ投入しない。
- Preview Admin WorkerはCloudflare Access application `Market Docket Admin Preview`の前段保護と、Worker内Bearer Admin tokenの二重認証。人間はOwnerメールAllow、Mac ProcessorはService Authを使う。
