# PR4 hard-intent targeted retrieval report

## 1. 結論

PR4 は test Worker へ deploy 済みで、PR3a/PR3b の安全 invariant は維持できました。

- sourceIdsValid false = 0
- fallbackKind none on fallback rows = 0
- raw English surfaced = 0
- banned phrase hits = 0
- bank terms in non-bank sectors = 0
- wrong sector terms = 0
- languageGuardFallbackUsed = 0

ただし、production release は引き続き HOLD です。

PR4 の主目的だった hard-intent fallback 削減は、fixed full60 では小幅改善に留まり、random canary12 では改善しませんでした。今回の実装で observability と deterministic retrieval plan は入ったものの、現行 adapter が参照できる filing source window だけでは、MD&A / segment / sector KPI の不足を十分に埋められていません。

## 2. 変更ファイル

主な変更:

- `workers/src/lib/chat/hard-intent-retrieval.ts`
- `workers/src/lib/chat/model-attempt.ts`
- `workers/src/lib/chat/source-gate.ts`
- `workers/src/lib/chat/evidence-text-quality.ts`
- `workers/src/lib/chat/evidence-slots.ts`
- `workers/src/lib/chat/diagnostics.ts`
- `workers/src/lib/chat/grounding.ts`
- `workers/src/clients/gemini/types.ts`
- `workers/testbench/scripts/run-benchmark.mjs`
- `workers/test/hard-intent-retrieval.test.ts`
- `workers/testbench/questions/pr4-hard-intents-q03-q06.jsonl`

作業中に既存の unrelated iOS 変更が worktree に残っていることを確認しましたが、PR4 では触っていません。

## 3. hard-intent targeted retrieval の内容

対象 intent は以下の3つに限定しました。

- `revenue_driver`
- `driver_durability_followup`
- `margin_durability_followup`

実装した流れ:

1. 初期 context pack を作る
2. source gate を実行する
3. source insufficient の場合だけ deterministic hard retrieval plan を作る
4. 既存 filing context から最大1回だけ source reselection / expansion する
5. source gate を再実行する
6. sufficient なら Gemini を1回だけ呼ぶ
7. still insufficient なら evidence fallback を返す

model retry は hard intent では引き続き disabled です。

## 4. source ranking 改善内容

追加した ranking / filtering:

- MD&A revenue / sales discussion を XBRL-only metric より優先
- segment results / sector KPI を generic risk text より優先
- revenue driver では XBRL-only source を追加 source として採用しない
- properties / website boilerplate / country list / table fragment / generic risk heading は driver evidence として扱わない
- sector 別 query template を追加
  - bank / capital markets
  - energy / oilfield services
  - industrial / auto
  - retail / consumer staples
  - software / technology / semiconductor equipment
  - healthcare medtech
  - REIT
  - media
  - utility
  - mining

ただし、現行 adapter は filing の利用可能な `sourceChunks` / `mdaText` の範囲内でしか source を探せないため、元データ側に sector KPI の window が薄い場合は改善しません。

## 5. observability fields

追加・維持した主な debug / testbench fields:

- `hardRetrievalPlanUsed`
- `hardRetrievalQueries`
- `hardRetrievalQueryPurposes`
- `hardRetrievalMissingSourceTypes`
- `hardRetrievalAddedSourceCount`
- `hardRetrievalAddedSourceLabels`
- `hardRetrievalAddedSourceIds`
- `hardRetrievalOutcome`
- `sourceGateSufficientBeforeHardRetrieval`
- `sourceGateSufficientAfterHardRetrieval`
- `driverSlotsCountBeforeHardRetrieval`
- `driverSlotsCountAfterHardRetrieval`
- `marginDriverSlotsCountBeforeHardRetrieval`
- `marginDriverSlotsCountAfterHardRetrieval`
- `selectedSourceLabelsBeforeHardRetrieval`
- `selectedSourceLabelsAfterHardRetrieval`

既存の PR3b fields も維持しています。

## 6. targeted validation 結果

Deploy:

- Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `693f245e-3dad-4b2c-8ae5-aa06111f010a`

Fixed hard-intent targeted run:

- rows = 20
- sourceIdsValid false = 0
- fallbackKind none on fallback rows = 0
- raw English surfaced = 0
- banned phrase hits = 0
- hardIntentRows = 15
- hardIntentFallback = 13
- hardIntentEvidenceFallback = 11
- hardRetrievalPlanUsed = 15
- hardRetrievalOutcome improved = 5
- hardRetrievalOutcome no_improvement = 10
- improved rate when used = 33.3%
- p95 = 8075ms
- p99 = 10993ms

診断:

- XOM / WMT では一部 improvement が出ました。
- AAPL / JPM / CAT は source reselection 後も source gate insufficient が残りました。
- safety invariant は target run でも維持されました。

Random hard-intent targeted run:

- rows = 44
- sourceIdsValid false = 0
- fallbackKind none on fallback rows = 0
- raw English surfaced = 0
- banned phrase hits = 0
- hardIntentFallback = 33 / 33
- hardRetrievalPlanUsed = 22
- hardRetrievalOutcome improved = 0
- p95 = 6815ms
- p99 = 7881ms

診断:

- random sector 側では targeted source addition が source sufficiency 改善につながりませんでした。
- query template は出ていますが、現行 context source pool 側に必要な section window がないケースが多いです。

## 7. fixed full60 結果

Run:

- `workers/testbench/runs/2026-05-01T23-55-pr4-fixed-full60.jsonl`
- `workers/testbench/runs/2026-05-01T23-55-pr4-fixed-full60-summary.json`

集計:

- rows = 60
- sourceIdsValid false = 0
- fallback total = 16
- fallbackKind none on fallback rows = 0
- raw English surfaced = 0
- banned phrase hits = 0
- bank terms in non-bank = 0
- wrong sector terms = 0
- metric_without_driver = 0
- temporality_not_assessed = 0
- evasive_answer = 0
- languageGuardFallbackUsed = 0
- gemini_timeout = 1
- gemini_api_error = 0
- retryAttempted = 3
- retryWasted = 2
- hardIntentRows = 15
- Q03/Q04/Q06 fallback = 13 / 15
- Q03/Q04/Q06 evidence fallback = 11 / 15
- hardRetrievalPlanUsed = 15
- hardRetrievalOutcome improved = 5
- hardRetrievalOutcome no_improvement = 10
- hardRetrieval improved rate = 33.3%
- p50 / p95 / p99 = 3691ms / 7341ms / 11202ms

PR3b checkpoint と比べると fallback total は 18 から 16 に小幅改善しました。

## 8. random canary12 結果

Run:

- `workers/testbench/runs/2026-05-02T00-10-pr4-random-canary12.jsonl`
- `workers/testbench/runs/2026-05-02T00-10-pr4-random-canary12-summary.json`

集計:

- rows = 108
- sourceIdsValid false = 0
- fallback total = 85
- fallbackKind none on fallback rows = 0
- raw English surfaced = 0
- banned phrase hits = 0
- bank terms in non-bank = 0
- wrong sector terms = 0
- metric_without_driver = 0
- temporality_not_assessed = 0
- evasive_answer = 0
- languageGuardFallbackUsed = 0
- gemini_timeout = 3
- gemini_api_error = 55
- retryAttempted = 1
- retryWasted = 1
- hardIntentRows = 36
- hardIntentFallback = 36 / 36
- hardIntentEvidenceFallback = 25 / 36
- hardRetrievalPlanUsed = 24
- hardRetrievalOutcome improved = 0
- hardRetrievalOutcome no_improvement = 24
- p50 / p95 / p99 = 655ms / 7540ms / 8822ms

注意:

- random canary12 は `gemini_api_error = 55` が大きく、品質評価と API / benchmark execution の問題が混ざっています。
- spacing を入れた再実行も部分的に試しましたが、API error は解消しなかったため、今回の random canary12 は PR4 retrieval effectiveness の純粋な評価としては汚れています。
- それでも hard retrieval improved = 0 なので、random sector への一般化は未達です。

## 9. 良くなった点

- hard intent 用の deterministic retrieval plan と observability が入った。
- fixed full60 の fallback total は 18 から 16 へ小幅改善した。
- XOM / WMT の一部 hard intent で source gate が retrieval 後に improved になった。
- PR3a/PR3b safety invariant は fixed full60 / random canary12 ともに維持した。
- raw English excerpt、banned phrase、bank term leakage、fallbackKind missing は再発していない。
- p95 / p99 latency は fixed full60 / random canary12 とも target 内に収まった。

## 10. 悪化した点

- random canary12 の fallback total は 52 から 85 に悪化した。
- random canary12 で `gemini_api_error = 55` が発生した。
- random sector hard intent では hard retrieval が 0 / 24 improved だった。
- fixed full60 の hard-intent fallback は 13 / 15 のままで、体感品質改善は限定的。

## 11. 未達成の acceptance target

Fixed full60:

- fallback total <= 12 / 60: 未達。実測 16 / 60
- Q03/Q04/Q06 fallback <= 8 / 15: 未達。実測 13 / 15
- Q03/Q04/Q06 evidence fallback <= 7 / 15: 未達。実測 11 / 15
- hardRetrievalOutcome improved >= 50%: 未達。実測 33.3%

Random canary12:

- fallback total <= 40 / 108: 未達。実測 85 / 108
- hard-intent fallback reduced by at least 30%: 未達。実測 36 / 36 fallback
- hardRetrievalOutcome improved >= 40%: 未達。実測 0%

Latency / safety:

- fixed full60 p95 <= 9000ms: 達成
- fixed full60 p99 <= 12000ms: 達成
- random canary12 p95 <= 10000ms: 達成
- random canary12 p99 <= 12000ms: 達成
- safety invariants: 達成

## 12. 残課題

- retrieval adapter が現行 `sourceChunks` / `mdaText` に依存しており、filing 全文から section-indexed に探せていない。
- MD&A / segment / sector KPI の window を生成・保存する upstream context asset が足りない可能性が高い。
- source gate は安全側に倒れているため、retrieval が少し改善しても sufficient まで上がりにくい。
- random canary12 の `gemini_api_error` の error kind が分からず、model/API側の問題と retrieval品質問題を分離できていない。
- AAPL / JPM / CAT の driver source retrieval がまだ弱い。

## 13. release / hold 判定

Production release は HOLD です。

理由:

- hard-intent fallback が fixed full60 で 13 / 15 残っている。
- random canary12 で fallback total と API error が大きく悪化している。
- PR4 は observability と retrieval plan の土台としては有効だが、answer quality release gate には未達。

## 14. 保存した run / summary / report paths

Targeted:

- `workers/testbench/runs/2026-05-01T23-35-pr4-fixed-hard-intents.jsonl`
- `workers/testbench/runs/2026-05-01T23-35-pr4-fixed-hard-intents-summary.json`
- `workers/testbench/runs/2026-05-01T23-45-pr4-random-hard-intents.jsonl`
- `workers/testbench/runs/2026-05-01T23-45-pr4-random-hard-intents-summary.json`

Full benchmarks:

- `workers/testbench/runs/2026-05-01T23-55-pr4-fixed-full60.jsonl`
- `workers/testbench/runs/2026-05-01T23-55-pr4-fixed-full60-summary.json`
- `workers/testbench/runs/2026-05-02T00-10-pr4-random-canary12.jsonl`
- `workers/testbench/runs/2026-05-02T00-10-pr4-random-canary12-summary.json`

Report:

- `workers/testbench/reports/2026-05-02-pr4-hard-intent-retrieval.md`

## 15. 次にやるべきこと

1. `gemini_api_error` を error kind 別に分解する。
2. random canary12 を API error が混ざらない条件で再実行する。
3. filing source asset 側に section-indexed retrieval を追加する。
   - MD&A revenue discussion
   - segment results
   - liquidity / debt note
   - sector KPI windows
4. hard retrieval adapter を current context pool ではなく section-indexed filing asset から引けるようにする。
5. AAPL / JPM / CAT の Q03/Q04/Q06 を固定 regression として、source sufficiency が上がるかを先に見る。
6. source gate の sufficient 判定は安全側を維持しつつ、driver slots と section labels の整合で調整する。
