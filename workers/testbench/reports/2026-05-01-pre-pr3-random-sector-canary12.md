# Pre-PR3 random sector canary 12

## 1. 結論

この canary は production release gate ではなく PR3 設計用の診断 run。結論として、PR2 の hard-intent source gate は固定5銘柄以外にも概ね発火しているが、**generalize は不十分**。

良い点:

- hard intent 36 rows すべてで `sourceGateApplied=true`
- bank terms の non-bank leak は 0
- wrong sector term 検出は 0
- `metric_without_driver` は 0

悪い点:

- `sourceIdsValid false = 2` が出た。これは critical。
- fallback rows のうち `fallbackKind=none` が 20件。
- raw English excerpt が 11件。特に hard-intent evidence fallback で英語 excerpt がそのまま日本語説明に混ざっている。
- p95 latency が 22948ms、p99 が 24622ms。固定 full60 より大きく悪化。

PR3 は「non-hard fallback cleanup」だけでなく、**evidence fallback の raw excerpt 抑制**と**fallbackKind 欠損の整理**を優先すべき。

## 2. run 情報

- Target Worker: `kabuyomi-api-test`
- Version ID: `5cb7208e-727b-4d1d-8891-af869fc67aeb`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- appVersion / git short: `433a507`
- Seed: `kabuyomi-2026-05-01`
- Rows: 12 tickers x 9 questions = 108
- Runtime Worker code changes: none
- Testbench-only file added: `workers/testbench/questions/pre-pr3-canary-9.jsonl`

## 3. canary 銘柄

| sector | ticker |
|---|---|
| software_it_services | NET |
| semiconductors_equipment | KLAC |
| financials_banks_cards | MS |
| healthcare_pharma_medtech | ISRG |
| energy_oil_gas | HAL |
| industrials_machinery | DE |
| consumer_discretionary | TSLA |
| consumer_staples | CL |
| real_estate_reit | VTR |
| communication_media | FOXA |
| utilities_power_gas | AEP |
| materials_chemicals_metals | FCX |

Question set: Q01, Q03, Q04, Q05, Q06, Q08, Q10, Q11, Q12. Q04/Q06 were run as follow-ups using prior answers.

## 4. 集計

| 指標 | 結果 |
|---|---:|
| rows | 108 |
| sourceIdsValid false | 2 |
| responsePath gemini | 44 |
| responsePath fallback | 53 |
| responsePath deterministic | 11 |
| fallback rows with fallbackKind=none | 20 |
| sourceGateApplied | 36 |
| sourceGateSufficient false | 16 |
| retrievalRetryUsed | 19 |
| evidenceFallbackUsed | 27 |
| genericFallbackPhraseDetected | 0 |
| bannedFallbackPhraseHits | 9 |
| hard intent rows | 36 |
| hard intent fallback | 33 |
| hard intent evidence_slot fallback | 27 |
| metric_without_driver | 0 |
| temporality_not_assessed | 2 |
| evasive_answer | 13 |
| fallback_kind_missing | 20 |
| legacy_template | 6 |
| raw English excerpt surfaced | 11 |
| wrong sector term | 0 |
| bank terms in non-bank sectors | 0 |
| gemini_timeout | 9 |
| gemini_api_error | 1 |
| retryAttempted | 12 |
| retryWasted | 11 |
| latency p50 | 5141ms |
| latency p95 | 22948ms |
| latency p99 | 24622ms |

## 5. hard intent の診断

PR2 source gate は 36/36 で適用された。これは良い。

ただし、false positive がある。`sourceGateSufficient=true` のまま evidence fallback が raw English excerpt を driver として出しているケースが 11件ある。

代表例:

- `KLAC-Q06`: tax / regulatory risk の英語断片を margin driver として表示
- `MS-Q04`: financial services risk text を revenue driver として表示
- `ISRG-Q04`: lung lesion / tariff / mission text が driver として混在
- `DE-Q04`: SaaS products text が DE の revenue driver 表現に混入
- `CL-Q04/Q06`: toothpaste market / Hill's Pet Nutrition の英語断片がそのまま出る
- `AEP-Q04`: utility revenue recognition table text が driver として出る
- `FCX-Q06`: country list text が margin driver として出る

つまり PR2 は「source gate を通す/落とす」までは機能しているが、**source gate sufficient 時の evidence slot extraction が粗い**。PR3 では raw excerpt をそのまま driver 文にしない制御が必要。

## 6. non-hard intent の診断

PR3 優先は Q10 / Q11 / Q12 と Q01 latency。

- `NET-Q10`, `NET-Q11`: `sourceIdsValid=false`, no final sources, fallbackKind none, answer は「この決算資料の範囲では確認できません。」のみ。critical。
- Q10/Q11 で `weak_grounding` が目立つ: `KLAC-Q10`, `MS-Q10`, `ISRG-Q10`, `VTR-Q10/Q11`, `FOXA-Q11`, `FCX-Q10/Q11`
- Q12 は `gemini_timeout` が複数: `NET-Q12`, `KLAC-Q12`, `CL-Q12`
- Q01 は成功しても非常に遅いケースが多い:
  - `KLAC-Q01`: 29392ms
  - `MS-Q01`: 24629ms
  - `FCX-Q01`: 24622ms
  - `VTR-Q01`: 24227ms
  - `HAL-Q01`: 23962ms
  - `DE-Q01`: 23624ms
  - `FOXA-Q01`: 22948ms

## 7. sector 別の弱点

| sector | ticker | fallback | fallbackKind missing | raw English | sourceIdsValid false | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| software_it_services | NET | 7 | 4 | 0 | 2 | 10305ms |
| semiconductors_equipment | KLAC | 6 | 3 | 1 | 0 | 11353ms |
| financials_banks_cards | MS | 5 | 2 | 1 | 0 | 12612ms |
| healthcare_pharma_medtech | ISRG | 6 | 3 | 1 | 0 | 8046ms |
| energy_oil_gas | HAL | 2 | 0 | 1 | 0 | 5924ms |
| industrials_machinery | DE | 3 | 1 | 1 | 0 | 7142ms |
| consumer_discretionary | TSLA | 3 | 0 | 0 | 0 | 6961ms |
| consumer_staples | CL | 4 | 1 | 2 | 0 | 6908ms |
| real_estate_reit | VTR | 5 | 2 | 1 | 0 | 11457ms |
| communication_media | FOXA | 5 | 2 | 1 | 0 | 7370ms |
| utilities_power_gas | AEP | 2 | 0 | 1 | 0 | 5629ms |
| materials_chemicals_metals | FCX | 5 | 2 | 1 | 0 | 10337ms |

NET is the most concerning because it produced both `sourceIdsValid=false` rows. TSLA and AEP were comparatively cleaner.

## 8. fallbackKind / fallbackReason breakdown

fallbackKind:

| fallbackKind | count |
|---|---:|
| none | 75 |
| evidence_slot | 27 |
| legacy_template | 6 |

Important: `fallbackKind=none` includes successful gemini/deterministic rows, but **fallback rows with fallbackKind=none = 20**. This is a PR3 observability bug.

fallbackReason:

| fallbackReason | count |
|---|---:|
| null | 55 |
| low_quality_answer | 35 |
| gemini_timeout | 9 |
| weak_grounding | 8 |
| gemini_api_error | 1 |

retrievalRetryOutcome:

| outcome | count |
|---|---:|
| not_used | 89 |
| no_improvement | 16 |
| improved | 3 |

Retrieval retry is mostly not improving source sufficiency.

## 9. critical failures

Critical failures found:

1. `NET-Q10`
   - `sourceIdsValid=false`
   - `fallbackKind=none`
   - no final sources
   - answer: 「この決算資料の範囲では確認できません。」

2. `NET-Q11`
   - `sourceIdsValid=false`
   - `fallbackKind=none`
   - no final sources
   - answer: 「この決算資料の範囲では確認できません。」

3. raw English excerpt presented as driver explanation: 11 rows
   - `KLAC-Q06`, `MS-Q04`, `ISRG-Q04`, `HAL-Q04`, `DE-Q04`, `CL-Q04`, `CL-Q06`, `VTR-Q06`, `FOXA-Q06`, `AEP-Q04`, `FCX-Q06`

No bank-term leak into non-bank sectors was detected. No wrong-sector term was detected by the canary analyzer.

## 10. PR3 に入れるべき修正

1. Fallback rows must never have `fallbackKind=none`.
   - Add fallbackKind mapping for non-hard fallback paths.
   - `context_unavailable_answer` should be its own fallbackKind or at least `legacy_template`.

2. Preserve source validity even when final answer has no final sources.
   - For context-unavailable fallback, either attach nearest valid filing source or set source validity semantics explicitly.
   - `NET-Q10/Q11` should not emit `sourceIdsValid=false`.

3. Do not surface raw English excerpts as Japanese driver explanations.
   - Evidence slot fallback should summarize or say the driver is not sufficiently identified.
   - If extracted driver text is mostly English raw excerpt / table fragment / risk boilerplate, treat it as insufficient.

4. Tighten source gate false positives for Q04/Q06.
   - Prior driver must be concrete and Japanese-answerable.
   - Generic risk text, table headings, country lists, revenue recognition text, and boilerplate should not count as driver evidence.

5. Improve non-hard Q10/Q11/Q12 fallback.
   - Liquidity/risk/watch-point fallback should say which source types are missing and what to inspect next.
   - Avoid one-line evasive answers.

6. Investigate Q01 latency.
   - Many Q01 successful Gemini calls were 20s+.
   - Business model questions need deterministic or lower-budget path when source quality is enough.

## 11. PR3 前に直すべき緊急 bug があるか

Yes. Two urgent bugs before PR3 implementation planning should be treated as blockers for the next validation loop:

1. `sourceIdsValid=false` on `NET-Q10/Q11`
2. raw English excerpt as driver explanation in hard-intent evidence fallback

These are not production deploy blockers from this canary alone, but they are PR3 input blockers because they would pollute post-PR3 comparison if left unaddressed.

## 12. 保存した run / summary / report paths

- `workers/testbench/runs/2026-05-01T09-28-pre-pr3-random-sector-canary12.jsonl`
- `workers/testbench/runs/2026-05-01T09-28-pre-pr3-random-sector-canary12-summary.json`
- `workers/testbench/reports/2026-05-01-pre-pr3-random-sector-canary12.md`
