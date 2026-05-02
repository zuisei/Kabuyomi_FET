# PR4b benchmark rate-limit control

## 1. 結論

PR4b の実装目的である「provider rate_limit を回答品質 failure と分離する」ための testbench 改修は完了した。

ただし、今回の live validation では Gemini provider quota が強く枯渇しており、fixed full60 / random canary12 はどちらも infra contaminated と判定した。したがって、この run から回答品質の改善・悪化は比較しない。

Production release は引き続き HOLD。

## 2. 変更ファイル

- `workers/testbench/scripts/benchmark-quality.mjs`
- `workers/testbench/scripts/run-benchmark.mjs`
- `workers/testbench/scripts/summarize-runs.mjs`
- `workers/test/benchmark-quality.test.ts`

Worker runtime の回答ロジックは変更していない。PR4 active retrieval の default は active ではなく、diagnostic/off のまま。

## 3. benchmark rate-limit controls

`run-benchmark.mjs` に以下の env control を追加した。

- `BENCHMARK_CONCURRENCY`
- `BENCHMARK_MIN_DELAY_MS`
- `BENCHMARK_RATE_LIMIT_MAX_RETRIES`
- `BENCHMARK_RATE_LIMIT_INITIAL_BACKOFF_MS`
- `BENCHMARK_RATE_LIMIT_MAX_BACKOFF_MS`
- `BENCHMARK_RATE_LIMIT_RESPECT_RETRY_AFTER`
- `BENCHMARK_RATE_LIMIT_JITTER_MS`
- `BENCHMARK_RATE_LIMIT_STOP_THRESHOLD`
- `BENCHMARK_INFRA_CONTAMINATED_RATE_LIMIT_THRESHOLD`
- `BENCHMARK_DEVICE_KEY_MODE`

follow-up 順序を壊さないため、runner は実効 concurrency 1 のまま。`BENCHMARK_DEVICE_KEY_MODE=row` は testbench-only の補助で、credit depletion が benchmark を止めないように row ごとに chat device key を分ける。

## 4. infra vs quality metric separation

各 row に以下を追加した。

- `infraError`
- `infraErrorKind`
- `qualityEvaluable`
- `excludedFromQualityMetricsReason`
- `benchmarkAttemptCount`
- `benchmarkRateLimitRetryCount`
- `benchmarkRateLimitBackoffMsTotal`
- `benchmarkFinalInfraErrorKind`
- `rateLimitRetrySucceeded`
- `rateLimitRetryObserved`

`geminiApiErrorKind=rate_limit` は infra error とし、raw fallback には数えるが quality fallback から除外する。

summary JSON には raw metrics と quality-evaluable metrics を分離して保存する。

## 5. rate-limit retry behavior

rate_limit row は同一 row を最大2回 retry する。`Retry-After` があれば尊重し、なければ exponential backoff + jitter を使う。

今回の live validation では retry は全て失敗し、`rateLimitRetrySucceeded=0` だった。

## 6. fixed full60 result

run は rate-limit stop threshold により早期停止した。

| metric | value |
|---|---:|
| rows completed | 8 |
| sourceIdsValid false | 0 |
| fallbackKind none on fallback rows | 0 |
| raw English surfaced | 0 |
| banned phrase hits | 0 |
| rawFallbackTotal | 7 |
| qualityRows | 4 |
| qualityRowsExcluded | 4 |
| qualityFallbackTotal | 3 |
| rateLimitRows | 4 |
| rateLimitRate | 50.0% |
| infraContaminated | true |
| infraContaminationReasons | `rate_limit_rows>3` |
| benchmarkRateLimitRetryCount | 8 |
| rateLimitRetrySucceeded | 0 |
| raw latency p50 / p95 / p99 | 1270ms / 19382ms / 19382ms |
| quality latency p50 / p95 / p99 | 1165ms / 1270ms / 1270ms |

品質比較は無効。qualityRows が 4/60 相当しかない。

## 7. random canary12 result

run は rate-limit stop threshold により早期停止した。

| metric | value |
|---|---:|
| rows completed | 10 |
| sourceIdsValid false | 0 |
| fallbackKind none on fallback rows | 0 |
| raw English surfaced | 0 |
| banned phrase hits | 0 |
| bank terms in non-bank | 0 |
| wrong sector terms | 0 |
| rawFallbackTotal | 9 |
| qualityRows | 4 |
| qualityRowsExcluded | 6 |
| qualityFallbackTotal | 3 |
| rateLimitRows | 6 |
| rateLimitRate | 60.0% |
| infraContaminated | true |
| infraContaminationReasons | `rate_limit_rows>3` |
| benchmarkRateLimitRetryCount | 12 |
| rateLimitRetrySucceeded | 0 |
| raw latency p50 / p95 / p99 | 18875ms / 28308ms / 28308ms |
| quality latency p50 / p95 / p99 | 3205ms / 3223ms / 3223ms |

品質比較は無効。qualityRows が 4/108 相当しかない。

## 8. raw metrics vs quality-evaluable metrics

今回の重要点は、raw fallback と quality fallback が分離できたこと。

- raw fallback は rate_limit fallback を含む。
- quality fallback は rate_limit row を除外する。
- `infraContaminated=true` の場合、quality baseline との比較は行わない。

これにより、PR4a のように provider quota の枯渇を「回答品質悪化」と誤読するリスクは下がった。

## 9. infra contamination判定

fixed full60 contamination check:

- `rateLimitRows=4`
- threshold `>3`
- `infraContaminated=true`

random canary12 contamination check:

- `rateLimitRows=6`
- threshold `>3`
- `infraContaminated=true`

いずれも provider quota / rate_limit が原因。bad_request、payload_too_large、context_too_large は観測していない。

## 10. whether quality comparison is valid

無効。

理由:

- full60 は 8 rows で停止し、qualityRows は 4 のみ。
- canary12 は 10 rows で停止し、qualityRows は 4 のみ。
- rate-limit retry は全件失敗。
- provider quota が回答品質評価を支配している。

PR3b / PR4a との fallback total 比較は行わない。

## 11. release / hold 判定

releaseDecision: HOLD

この PR は benchmark 信頼性のための testbench 改修であり、production release 判定を前進させるものではない。

## 12. saved run / summary / report paths

- `workers/testbench/runs/2026-05-02T00-30-pr4b-fixed-full60-contamination-check.jsonl`
- `workers/testbench/runs/2026-05-02T00-30-pr4b-fixed-full60-contamination-check-summary.json`
- `workers/testbench/runs/2026-05-02T00-35-pr4b-canary12-contamination-check.jsonl`
- `workers/testbench/runs/2026-05-02T00-35-pr4b-canary12-contamination-check-summary.json`
- `workers/testbench/reports/2026-05-02-pr4b-benchmark-rate-limit-control.md`

補足: 以下は途中で止めた/credit contaminated な run なので品質比較には使わない。

- `workers/testbench/runs/2026-05-02T00-10-pr4b-fixed-full60.jsonl`
- `workers/testbench/runs/2026-05-02T00-10-pr4b-fixed-full60-summary.json`

## 13. recommendation for next PR

次は retrieval や fallback ではなく、eval quota の確保が先。

優先順:

1. test Worker 用の eval credit grant secret を使える状態にする、または benchmark 専用 credit bypass を明示的に用意する。
2. Gemini provider quota を benchmark 実行量に合わせて増やす。
3. quota が安定した状態で PR3b-equivalent / PR4 diagnostic を再実行する。
4. その後に PR4 active retrieval の判断を再開する。

rate_limit が 5% を超える run は品質比較に使わない。
