# PR4a Gemini API error and hard-retrieval diagnostics report

## 1. 結論

PR4a は diagnostic として有効です。production release は引き続き HOLD です。

今回分かったこと:

- random canary12 の `gemini_api_error` は opaque ではなくなり、clean rerun では **73 / 73 が `rate_limit`** と分類されました。
- `bad_request`、`payload_too_large`、`context_too_large`、`provider_server_error` は今回の canary では出ていません。
- PR4 active retrieval は、subset では source を追加しても source sufficiency を改善できませんでした。
- test Worker は最終的に `HARD_INTENT_TARGETED_RETRIEVAL_MODE=diagnostic` に戻しました。

推奨は **PR4 active retrieval は無効化し、diagnostic-only を維持**です。次は retrieval query tuning ではなく、section-indexed source asset / MD&A window / segment window / sector KPI window の整備を先にやるべきです。

## 2. 変更ファイル

主な変更:

- `workers/src/clients/gemini/request.ts`
- `workers/src/clients/gemini.ts`
- `workers/src/clients/gemini/types.ts`
- `workers/src/env.ts`
- `workers/wrangler.toml`
- `workers/wrangler.test.toml`
- `workers/src/lib/chat/hard-intent-retrieval.ts`
- `workers/src/lib/chat/model-attempt.ts`
- `workers/src/lib/chat/diagnostics.ts`
- `workers/src/lib/chat/grounding.ts`
- `workers/testbench/scripts/run-benchmark.mjs`
- `workers/test/gemini.test.ts`
- `workers/test/hard-intent-retrieval.test.ts`

既存の unrelated iOS worktree changes は触っていません。

## 3. Gemini API error classification

追加した分類:

- `rate_limit`
- `auth_error`
- `bad_request`
- `payload_too_large`
- `context_too_large`
- `provider_server_error`
- `network_error`
- `timeout`
- `unknown`

追加した debug / testbench fields:

- `geminiApiErrorKind`
- `geminiApiErrorStatus`
- `geminiApiErrorCode`
- `geminiApiErrorMessageSample`
- `geminiApiErrorRetryable`
- `geminiRequestPromptCharCount`
- `geminiRequestEstimatedTokens`
- `geminiRequestSourceCount`
- `geminiRequestContextCharCount`
- `geminiModelName`
- `geminiErrorOccurredBeforeResponse`

ログは prompt / source 全文を出さず、error message sample は短く切っています。

## 4. hard retrieval mode behavior

追加した mode:

- `off`: targeted retrieval plan も runtime source mutation もしない
- `diagnostic`: plan と coverage を記録するが、selected sources は変更しない
- `active`: PR4 の targeted retrieval / source reselection を実行する

最終 test Worker は diagnostic mode です。

- Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `a3f4785e-0930-4c7d-b7cb-92f7aa8f8584`
- Mode: `diagnostic`

## 5. source asset coverage diagnostics

追加した coverage fields:

- `hardSourceCoverageScore`
- `hardSourceCoverageMissing`
- `hardSourceCoverageSectorKpiHits`
- `hardSourceCoverageHasMdaRevenueDiscussion`
- `hardSourceCoverageHasSegmentResults`
- `hardSourceCoverageHasSectorKpiWindow`

追加 label:

- `hard_source_asset_missing_mda_revenue`
- `hard_source_asset_missing_segment_results`
- `hard_source_asset_missing_sector_kpi`
- `hard_source_asset_coverage_low`

coverage は、retrieval query 以前に filing asset 側に必要 window があるかを見るためのものです。

## 6. targeted mode comparison

Active subset:

- Run: `workers/testbench/runs/2026-05-02T01-35-pr4a-active-hard-subset.jsonl`
- Summary: `workers/testbench/runs/2026-05-02T01-35-pr4a-active-hard-subset-summary.json`
- rows = 16
- fallback total = 12
- sourceIdsValid false = 0
- fallbackKind none on fallback rows = 0
- raw English surfaced = 0
- banned phrase hits = 0
- hardRetrievalMode = active for 12 hard rows
- hardRetrievalPlanUsed = 10
- hardRetrievalOutcome no_improvement = 10
- hardRetrievalAddedSourceCount = 19
- gemini_api_error = 2
- geminiApiErrorKind = `rate_limit` for 2 / 2

診断:

- active mode は source を追加できています。
- ただし追加 source は source gate sufficient まで改善できていません。
- active mode を継続する根拠はまだありません。

## 7. fixed full60 result

Diagnostic mode full60:

- Run: `workers/testbench/runs/2026-05-02T01-00-pr4a-diagnostic-full60.jsonl`
- Summary: `workers/testbench/runs/2026-05-02T01-00-pr4a-diagnostic-full60-summary.json`
- rows = 60
- fallback total = 51
- sourceIdsValid false = 0
- fallbackKind none on fallback rows = 0
- raw English surfaced = 0
- banned phrase hits = 0
- metric_without_driver = 0
- temporality_not_assessed = 0
- evasive_answer = 0
- hardIntentRows = 15
- hardIntentFallback = 15
- hardRetrievalMode = diagnostic for 60 / 60
- hardRetrievalPlanUsed = 15
- hardRetrievalOutcome = not_used for 60 / 60
- gemini_api_error = 36
- geminiApiErrorKind breakdown:
  - `rate_limit` = 36
  - `none` = 24
- p50 / p95 / p99 = 569ms / 1916ms / 2260ms

注意:

- fallback total は PR3b / PR4 より大幅に悪化していますが、主因は `rate_limit` です。
- diagnostic mode は runtime source mutation をしないため、PR4 active retrieval が原因ではありません。

## 8. random canary12 result

Clean diagnostic rerun:

- Run: `workers/testbench/runs/2026-05-02T01-50-pr4a-diagnostic-random-canary12.jsonl`
- Summary: `workers/testbench/runs/2026-05-02T01-50-pr4a-diagnostic-random-canary12-summary.json`
- rows = 108
- fallback total = 97
- sourceIdsValid false = 0
- fallbackKind none on fallback rows = 0
- raw English surfaced = 0
- banned phrase hits = 0
- bank terms in non-bank = 0
- wrong sector terms = 0
- metric_without_driver = 0
- temporality_not_assessed = 0
- evasive_answer = 0
- languageGuardFallbackUsed = 0
- hardIntentRows = 36
- hardIntentFallback = 36
- hardRetrievalMode = diagnostic for 108 / 108
- hardRetrievalPlanUsed = 24
- hardRetrievalOutcome = not_used for 108 / 108
- gemini_api_error = 73
- geminiApiErrorKind breakdown:
  - `rate_limit` = 73
  - `none` = 35
- hardSourceCoverageScoreAvg = 72
- p50 / p95 / p99 = 594ms / 4274ms / 6483ms

Safety invariant は維持されています。

## 9. API error root cause

今回の API error root cause は **rate_limit** です。

根拠:

- fixed full60 diagnostic: `gemini_api_error = 36`, `rate_limit = 36`
- random canary12 diagnostic clean rerun: `gemini_api_error = 73`, `rate_limit = 73`
- active subset: `gemini_api_error = 2`, `rate_limit = 2`
- `bad_request` / `payload_too_large` / `context_too_large` は 0

したがって、PR4 の context expansion が payload/context size を壊した、という見立ては今回の run では支持されません。主因は provider quota / rate limit です。

## 10. source coverage root cause

source coverage の診断では、source asset 側に不足が残っています。

Random canary12 の missing coverage:

- `MD&A revenue discussion` = 6
- `segment results` = 6
- `software sector KPI window` = 3
- `oilfield_services sector KPI window` = 3
- `auto sector KPI window` = 3
- `geographic or product revenue` = 3
- `profitability or margin discussion` = 2

Active subset では 19 sources を追加しましたが、`hardRetrievalOutcome no_improvement = 10 / 10` でした。つまり、現行 source pool から追加しても source gate を通る driver evidence には届いていません。

## 11. recommendation: keep PR4 active, diagnostic-only, or off

推奨: **diagnostic-only**

理由:

- active retrieval は source を追加するが sufficient まで改善できていない。
- diagnostic mode なら PR3b 相当の runtime answer path を維持しながら、query plan と source coverage を観測できる。
- API error の主因は `rate_limit` で、retrieval active / diagnostic 以前の provider quota 問題として扱うべき。
- section-indexed source asset がないまま query template を調整しても改善余地が小さい。

次に必要なのは active retrieval の template tuning ではなく、filing asset 側の window 増強です。

## 12. release / hold 判定

Production release は HOLD です。

PR4a は release-quality 改善ではなく、診断改善です。安全 invariant は維持できていますが、rate limit と hard-intent source coverage の課題が残っています。

## 13. saved run / summary / report paths

Diagnostic full60:

- `workers/testbench/runs/2026-05-02T01-00-pr4a-diagnostic-full60.jsonl`
- `workers/testbench/runs/2026-05-02T01-00-pr4a-diagnostic-full60-summary.json`

Diagnostic random canary12:

- `workers/testbench/runs/2026-05-02T01-50-pr4a-diagnostic-random-canary12.jsonl`
- `workers/testbench/runs/2026-05-02T01-50-pr4a-diagnostic-random-canary12-summary.json`

Active hard subset:

- `workers/testbench/runs/2026-05-02T01-35-pr4a-active-hard-subset.jsonl`
- `workers/testbench/runs/2026-05-02T01-35-pr4a-active-hard-subset-summary.json`

Report:

- `workers/testbench/reports/2026-05-02-pr4a-api-error-and-source-coverage-diagnostics.md`
