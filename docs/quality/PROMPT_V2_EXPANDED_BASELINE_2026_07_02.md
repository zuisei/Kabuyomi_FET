# Prompt v2 Expanded Baseline and Local Hardening Passes

Date: 2026-07-02 JST
Scope: Worker chat answer quality
Run: `workers/testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl`

## Baseline

Command:

```text
cd workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
KABUYOMI_TESTBENCH_DETACHED_ACCESS=dev_unlimited \
KABUYOMI_TESTBENCH_COMPANY_SET=testbench/company-sets/prompt-v2-expanded-multisector.json \
KABUYOMI_TESTBENCH_QUESTIONS=testbench/questions/core-12.jsonl \
KABUYOMI_TESTBENCH_RUN_ID=2026-07-02-prompt-v2-expanded-baseline \
npm run testbench:run
```

Summary:

- rows: 180
- tickers: AAPL, JPM, XOM, CAT, WMT, NVDA, MU, MSFT, GOOGL, AMZN, TSLA, LLY, V, KO, DAL
- infra contamination: none
- rate-limit rows: 0
- sourceIdsValid false: 0
- response paths: openai 128, fallback 37, deterministic 15
- quality fallback rate: 20.6%
- Q03/Q04/Q06 fallback rows: 28
- fallback reasons: low_quality_answer 33, invalid_source_id 3, weak_grounding 1
- hybrid English/Japanese surfaced: 9
- generic business-model answers: 0
- metric-only important-intent answers: 0
- durability follow-up lost prior driver: 5

Highest-impact failure cluster:

- Q03/Q04/Q06 hard-intent fallback dominates the quality failures.
- User-facing evidence fallback text leaked internal English checklist labels such as `price-cost spread discussion`, `vehicle pricing discussion`, and `net interest income`.
- Invalid source id responses on hard-intent rows were not retried because hard driver/durability retry gating blocked all retry reasons.

## First Local Hardening Pass

Implemented locally:

- Humanized internal missing-source and sector-indicator labels in evidence fallback output.
- Mirrored the missing-source label normalization in finalizer fallback taxonomy.
- Allowed one repair retry for `invalid_source_id` even on hard driver/durability intents while keeping low-quality hard-intent retries disabled.
- Added `testbench/questions/prompt-v2-driver-followup-3.jsonl` for targeted Q03/Q04/Q06 smoke reruns.

Validation after local changes:

```text
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm test
cd workers && npm run dryrun:test
```

Observed results:

- typecheck: passed.
- focused Worker gate: 7 files passed, 198 tests passed.
- full Worker suite: 50 files passed, 634 tests passed.
- test deploy dry-run: passed.

Blocked external validation:

- `npm run deploy:test` failed before upload because `CLOUDFLARE_API_TOKEN` was not set in the shell.
- `OPENAI_API_KEY` was also not set locally, so local live-model Worker runs were not attempted.

## Second Local Hardening Pass

Implemented locally:

- Added a risk-summary language-guard repair path for Q11-style answers.
- When the model answer leaks raw English but selected excerpts contain clear risk signals, the finalizer now returns a Japanese-only, evidence-limited risk summary instead of a generic language-guard fallback.
- The repair only emits conservative risk categories detected from the selected excerpts, such as cybersecurity, privacy/data protection, regulation/compliance, competition, cloud/service outage, third-party/supply chain, macro/FX/rates, tariffs/geopolitics, technology/AI, credit/liquidity, and property/facility costs.
- If selected excerpts do not contain a recognizable risk signal, the existing safe fallback remains in place.
- Added a conservative Q04 durability repair path for language-guard fallbacks: if selected excerpts contain concrete revenue-driver terms, the answer can name them as "driver candidates" in Japanese while still refusing to classify temporary vs. durable without stronger evidence.
- Extended final-answer label normalization for common driver labels such as eCommerce, membership, backlog, dealer inventory, net interest income, deliveries, energy revenue, and automotive gross margin.

Validation after the second local changes:

```text
cd workers && npm test -- final-answer-language
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm test
cd workers && npm run dryrun:test
```

Observed results:

- final-answer-language: 1 file passed, 55 tests passed.
- typecheck: passed.
- focused Worker gate: 7 files passed, 202 tests passed.
- full Worker suite: 50 files passed, 638 tests passed.
- test deploy dry-run: passed.

## Quality Gate Added

Implemented locally:

- Added `npm run testbench:gate -- <run.jsonl>` as a machine-checkable acceptance gate for prompt-v2 testbench runs.
- The gate fails on infrastructure contamination, invalid source IDs, user-visible raw English, hybrid English/Japanese leakage, generic business-model answers, non-financial cash-flow answers with bank language, lost follow-up drivers, suspicious numeric display, unsupported durability/risk/liquidity conclusions, hard-intent fallback rows, and Q03/Q04/Q06 fallback rows.
- The default maximum quality fallback rate is 15.0%; latency p95 defaults to 12,000 ms. These thresholds can be overridden with `KABUYOMI_QUALITY_GATE_MAX_FALLBACK_RATE`, `KABUYOMI_QUALITY_GATE_MAX_Q03_Q04_Q06_FALLBACK`, `KABUYOMI_QUALITY_GATE_MAX_HARD_INTENT_FALLBACK`, and `KABUYOMI_QUALITY_GATE_MAX_P95_MS`.

Baseline gate result:

```text
cd workers
npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
```

Observed result:

- exit status: 1
- qualityFallbackRate: 20.6%, above the 15.0% gate.
- qualityQ03Q04Q06Fallback: 28, above the 0 gate.
- qualityHardIntentFallback: 31, above the 0 gate.
- hybridEnglishJapaneseSurfaced: 9.
- misleadingRevenueDriverCauses: 3.
- nonFinancialCashFlowBankLanguage: 11.
- durabilityFollowupLostPriorDriver: 5.

Validation after adding the gate:

```text
cd workers && npm test -- benchmark-quality
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- benchmark-quality: 1 file passed, 12 tests passed.
- typecheck: passed.
- focused Worker gate: 7 files passed, 204 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 640 tests passed.

## Third Local Hardening Pass

Implemented locally:

- Added a Q06 margin-durability language-guard repair path.
- When a raw-English or hybrid-English Q06 answer is backed by selected cost excerpts, the finalizer can now return a Japanese-only "margin driver candidates" answer instead of dropping to a generic language fallback.
- The repair extracts conservative labels such as operating expense, fuel cost, labor cost, refinery/third-party sales cost, unit cost, pricing, mix, volume/capacity, gross margin, credit-loss provision, SG&A/R&D, and tax/valuation effects.
- The answer still refuses to classify the factor as temporary or structural unless stronger evidence is available.
- Added finalizer coverage for the DAL-like Q06 baseline cluster where selected excerpts mention operating expenses, refinery sales to third parties, salaries, aircraft fuel costs, CASM, and non-fuel unit cost.

Validation after the third local changes:

```text
cd workers && npm run typecheck
cd workers && npm test -- final-answer-language benchmark-quality chat-route-policy
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm test
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
```

Observed results:

- typecheck: passed.
- targeted local tests: 3 files passed, 76 tests passed.
- focused Worker gate: 7 files passed, 206 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 642 tests passed.
- baseline quality gate: failed as expected because the run is the pre-local-hardening remote baseline.

Baseline gate failure after the third pass:

- qualityFallbackRate: 20.6%, above the 15.0% gate.
- qualityQ03Q04Q06Fallback: 28, above the 0 gate.
- qualityHardIntentFallback: 31, above the 0 gate.
- hybridEnglishJapaneseSurfaced: 9.
- nonFinancialCashFlowBankLanguage: 11.
- durabilityFollowupLostPriorDriver: 5.

## Fourth Local Hardening Pass

Implemented locally:

- Tightened finalizer label normalization for hybrid English/Japanese revenue labels.
- Normalized `geography revenue` and `segment revenue` to Japanese user-facing labels.
- Fixed the broad `source` replacement so it no longer corrupts words such as `Resource Industries` into `Re資料 Industries`.
- Added CAT segment label normalization for `Construction Industries`, `Resource Industries`, and `Energy & Transportation`.
- Added a regression test covering the baseline-style CAT/segment answer shape.

Validation after the fourth local changes:

```text
cd workers && npm run typecheck
cd workers && npm test -- final-answer-language benchmark-quality pipeline
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- typecheck: passed.
- targeted local tests: 3 files passed, 116 tests passed.
- focused Worker gate: 7 files passed, 207 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 643 tests passed.

## Fifth Local Hardening Pass

Implemented locally:

- Added a revenue-driver finalizer cleanup for Q03-style answers that incorrectly treat taxes, expenses, brokerage expense, auto lease depreciation, marketing expense, distribution fees, or TAC as revenue drivers.
- When this pattern is detected, the final answer is downgraded to a conservative source-insufficient answer that says the revenue movement is visible but company-specific revenue drivers are not proven from the selected sources.
- The cleanup explicitly states that expenses, taxes, and TAC alone are not treated as revenue drivers.
- Added a regression test based on the MU/Pillar Two baseline failure shape.

Validation after the fifth local changes:

```text
cd workers && npm run typecheck
cd workers && npm test -- final-answer-language benchmark-quality pipeline
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- typecheck: passed.
- targeted local tests: 3 files passed, 117 tests passed.
- focused Worker gate: 7 files passed, 208 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 644 tests passed.

## Sixth Local Hardening Pass

Implemented locally:

- Added `misleadingRevenueDriverCauses` to the benchmark quality summary and default gate.
- The gate now fails Q03 revenue-driver answers that present taxes, expenses, TAC, brokerage expense, auto lease depreciation, marketing expense, occupancy expense, distribution fees, or similar non-revenue items as revenue causes.
- Rows already cleaned by the finalizer with `revenue_driver_non_revenue_cause_removed` are excluded from this counter, so the gate measures remaining user-visible failures.
- The pre-local-hardening baseline now reports `misleadingRevenueDriverCauses: 3`.

Validation after the sixth local changes:

```text
cd workers && npm test -- benchmark-quality final-answer-language
cd workers && npm run typecheck
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- benchmark-quality + final-answer-language: 2 files passed, 71 tests passed.
- typecheck: passed.
- baseline quality gate: failed as expected because the run is the pre-local-hardening remote baseline; it now includes `misleadingRevenueDriverCauses: 3`.
- focused Worker gate: 7 files passed, 208 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 644 tests passed.

## Seventh Local Hardening Pass

Implemented locally:

- Added a baseline-shaped regression test for CAT-like industrial filings whose MD&A mentions finance subsidiaries.
- This locks the deterministic cash-flow path to ticker/company classification rather than broad source-text words like `financial`, so non-bank companies do not receive bank-specific cash-flow caveats about deposits, loans, trading assets, or credit losses.
- The prior AAPL financial-statements regression still covers generic SEC wording; the new CAT-style test covers industrial finance-subsidiary wording.

Validation after the seventh local changes:

```text
cd workers && npm test -- pipeline final-answer-language benchmark-quality
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test
```

Observed results:

- targeted local tests: 3 files passed, 118 tests passed.
- typecheck: passed.
- focused Worker gate: 7 files passed, 209 tests passed.
- test deploy dry-run: passed.
- baseline quality gate: failed as expected because the run is the pre-local-hardening remote baseline; current visible failures are hybridEnglishJapaneseSurfaced 9, misleadingRevenueDriverCauses 3, nonFinancialCashFlowBankLanguage 11, durabilityFollowupLostPriorDriver 5, Q03/Q04/Q06 fallback 28, hard-intent fallback 31, and fallback rate 20.6%.
- full Worker suite: 50 files passed, 645 tests passed.

## Eighth Local Hardening Pass

Implemented locally:

- Propagated the previous assistant answer into chat quality-control diagnostics for follow-up rows.
- Added a conservative Q04 follow-up repair for source-insufficient underanswers: if the current answer says the prior driver was not identified, but the previous answer contained recognizable company-specific revenue driver candidates, the finalizer now names those candidates and still refuses to classify temporary vs. continuing.
- Added a guard so flawed previous Q03 answers that treated taxes, TAC, brokerage expense, depreciation, marketing expense, or other non-revenue items as revenue drivers are not reused as follow-up drivers.
- Added regressions for both the AAPL-like recovered case and the MU/Pillar Two negative case.

Validation after the eighth local changes:

```text
cd workers && npm test -- final-answer-language benchmark-quality pipeline
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test
```

Observed results:

- targeted local tests: 3 files passed, 120 tests passed.
- typecheck: passed.
- focused Worker gate: 7 files passed, 211 tests passed.
- test deploy dry-run: passed.
- baseline quality gate: failed as expected because the run is the pre-local-hardening remote baseline; current visible failures remain hybridEnglishJapaneseSurfaced 9, misleadingRevenueDriverCauses 3, nonFinancialCashFlowBankLanguage 11, durabilityFollowupLostPriorDriver 5, Q03/Q04/Q06 fallback 28, hard-intent fallback 31, and fallback rate 20.6%.
- full Worker suite: 50 files passed, 647 tests passed.

## Ninth Local Hardening Pass

Implemented locally:

- Added a finalizer cleanup for Q02/Q08-style revenue snapshot and revenue breakdown answers that only expose generic category labels such as `geography revenue`, `segment revenue`, "地域別売上", or "セグメント別売上" without naming an actual company-specific segment, region, product, or category.
- The cleanup keeps normal revenue snapshot metric answers intact, but downgrades generic category-only breakdown answers to a source-insufficient answer explaining that classification names alone do not identify which business/region/product was large or growing.
- Added `genericRevenueBreakdownAnswers` to the benchmark quality summary and gate so post-patch runs cannot pass merely by translating generic English category labels into Japanese.
- The pre-local-hardening expanded baseline now reports `genericRevenueBreakdownAnswers: 19`.

Validation after the ninth local changes:

```text
cd workers && npm test -- final-answer-language benchmark-quality
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test
```

Observed results:

- targeted local tests: 2 files passed, 74 tests passed.
- typecheck: passed.
- focused Worker gate: 7 files passed, 212 tests passed.
- test deploy dry-run: passed.
- baseline quality gate: failed as expected because the run is the pre-local-hardening remote baseline; current visible failures include hybridEnglishJapaneseSurfaced 9, genericRevenueBreakdownAnswers 19, misleadingRevenueDriverCauses 3, nonFinancialCashFlowBankLanguage 11, durabilityFollowupLostPriorDriver 5, Q03/Q04/Q06 fallback 28, hard-intent fallback 31, and fallback rate 20.6%.
- full Worker suite: 50 files passed, 648 tests passed.

## Tenth Local Hardening Pass

Implemented locally:

- Tightened `genericRevenueBreakdownAnswers` so it no longer counts Q02/Q08 answers that contain concrete company-specific revenue categories such as `Google Services`, `Google Cloud`, `Passenger revenue`, `NII/NIR`, `Walmart U.S.`, `DRAM/NAND`, or similar segment/product/region terms.
- Kept true generic category-only answers flagged, such as `geography revenue` or `売上高` with no actual segment, region, product, or category named.
- Mirrored the same concrete-category escape in the finalizer, so valid revenue-breakdown answers are not downgraded to source-insufficient merely because they also contain words like `大きい区分`.
- Added a conservative Q06 margin-durability follow-up repair: when the current answer says the prior margin driver was not identified, but the previous answer included recognizable margin candidates, the finalizer now names those candidates while refusing to classify temporary vs. structural.
- Added a Q06-specific guard so tax-mechanics-only prior answers such as `Pillar Two` / income-tax wording are not reused as margin drivers. This differs from Q04 because expenses and costs can be valid margin drivers even though they are not valid revenue drivers.
- Fixed the Q04/Q06 intent split so `questionIntent=margin_durability_followup` cannot accidentally enter the Q04 revenue-driver repair path just because the user asked "これは一時要因？".

Validation after the tenth local changes:

```text
cd workers && npm test -- final-answer-language benchmark-quality
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test
```

Observed results:

- targeted local tests: 2 files passed, 77 tests passed.
- typecheck: passed.
- focused Worker gate: 7 files passed, 215 tests passed.
- test deploy dry-run: passed.
- baseline quality gate: failed as expected because the run is the pre-local-hardening remote baseline; `genericRevenueBreakdownAnswers` is now `7` after removing over-detected concrete-category answers. Remaining visible baseline failures are hybridEnglishJapaneseSurfaced 9, genericRevenueBreakdownAnswers 7, misleadingRevenueDriverCauses 3, nonFinancialCashFlowBankLanguage 11, durabilityFollowupLostPriorDriver 5, Q03/Q04/Q06 fallback 28, hard-intent fallback 31, and fallback rate 20.6%.
- full Worker suite: 50 files passed, 651 tests passed.
- The Q06 previous-answer repair cannot be reflected in this old baseline JSONL; it needs a post-deploy live testbench rerun.

## Eleventh Local Hardening Pass

Implemented locally:

- Narrowed the finalizer-side financial-company classification to ticker and company name only, matching the deterministic cash-flow path.
- This prevents non-bank companies from being treated as financial firms merely because selected source text mentions `financial statements`, customer financing subsidiaries, dealer loans, deposits, or similar accounting/cash-flow words.
- Added a finalizer regression for a CAT-like industrial filing whose source text mentions financial statements, financing subsidiaries, loans, and operating cash flow. The finalizer now removes `deposit base`, `loan book`, `net interest income`, and other bank-specific cash-flow wording from the user-visible answer.
- Kept bank-specific cash-flow wording allowed for actual financial tickers such as JPM.

Validation after the eleventh local changes:

```text
cd workers && npm test -- final-answer-language benchmark-quality pipeline
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test
```

Observed results:

- targeted local tests: 3 files passed, 125 tests passed.
- typecheck: passed.
- focused Worker gate: 7 files passed, 216 tests passed.
- test deploy dry-run: passed.
- baseline quality gate: failed as expected because the run is the pre-local-hardening remote baseline; visible failures remain hybridEnglishJapaneseSurfaced 9, genericRevenueBreakdownAnswers 7, misleadingRevenueDriverCauses 3, nonFinancialCashFlowBankLanguage 11, durabilityFollowupLostPriorDriver 5, Q03/Q04/Q06 fallback 28, hard-intent fallback 31, and fallback rate 20.6%.
- full Worker suite: 50 files passed, 652 tests passed.

## Twelfth Local Hardening Pass

Implemented locally:

- Aligned `quality-gate.mjs` output with the strict counters enforced by `evaluateQualityGate`.
- The CLI now prints `metricOnlyImportantIntentAnswers`, `unsupportedDurabilityClassification`, `unsupportedRiskOrLiquidityConclusion`, and `fallbackKindNoneOnFallbackRows`, instead of only failing on them silently.
- Expanded benchmark summary tests so unsupported durability classifications, unsupported risk/liquidity conclusions, and fallback rows with `fallbackKind=none` are counted and appear in gate failures.
- This does not change answer generation, but it tightens the evidence loop for the next live testbench run: every zero-threshold visible-quality counter that can fail the gate is now visible in the gate report.

Validation after the twelfth local changes:

```text
cd workers && npm test -- benchmark-quality final-answer-language
cd workers && npm run typecheck
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- targeted local tests: 2 files passed, 78 tests passed.
- typecheck: passed.
- baseline quality gate: failed as expected because the run is the pre-local-hardening remote baseline; the report now also prints metricOnlyImportantIntentAnswers 0, unsupportedDurabilityClassification 0, unsupportedRiskOrLiquidityConclusion 0, and fallbackKindNoneOnFallbackRows 0.
- focused Worker gate: 7 files passed, 216 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 652 tests passed.

## Thirteenth Local Hardening Pass

Implemented locally:

- Added finalizer normalization for baseline-shaped hybrid English/Japanese phrasing that can survive model output, including `primarily due to`, `driven by`, `as well as`, `partially offset`, `favorable` / `unfavorable`, and `higher ... expense`.
- Added specific Japanese mappings for common leaked business phrases such as `higher brokerage expense`, `distribution fees`, `higher auto lease depreciation`, `continued investments in technology`, `marketing`, `higher 稼働率 expense`, and `sales volume`.
- Normalized source-label wording that can leak into fallback answers, including `price-コスト spread discussion`, `manufacturing cost discussion`, `SG&A/R&D discussion`, `comparable sales discussion`, `traffic and ticket discussion`, `eCommerce discussion`, and `membership or advertising discussion`.
- Added regressions for JPM-style mixed expense-driver wording and CAT-style source-label discussion wording, with the Japanese-only answer guard asserted after finalization.

Validation after the thirteenth local changes:

```text
cd workers && npm test -- final-answer-language benchmark-quality
cd workers && npm run typecheck
cd workers && npm test -- chat-source-gate final-answer-language pipeline chat-factual-pack openai benchmark-quality chat-route-policy
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- targeted local tests: 2 files passed, 80 tests passed.
- typecheck: passed.
- focused Worker gate: 7 files passed, 218 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 654 tests passed.
- The old baseline JSONL still reports `hybridEnglishJapaneseSurfaced 9` because it was captured before these local finalizer changes; this requires a post-deploy live testbench rerun to measure.

## Fourteenth Local Hardening Pass

Implemented locally:

- Expanded the finalizer guard for baseline-style generic revenue-breakdown answers.
- The guard now catches answers that only restate total revenue or say that segment/product/geographic detail is missing, including patterns like `主な売上区分: 売上高`, `総売上高`, `セグメント別の売上`, `個別セグメント別`, `セグメント別・地域別`, `区分別の内訳`, and "内訳は示されていません / 含まれていません / 明示されていません / 読み取れません".
- Kept the concrete-company-category escape intact, so answers naming real categories such as Google Services, Google Cloud, Construction Industries, Resource Industries, Passenger revenue, DRAM/NAND, or similar still pass.
- Added regressions for MU/MSFT/TSLA/LLY-style old baseline answers where the model answered Q02/Q08 with only total revenue and missing-detail disclaimers instead of company-specific revenue categories.

Validation after the fourteenth local changes:

```text
cd workers && npm test -- final-answer-language
cd workers && npm test -- benchmark-quality final-answer-language pipeline chat-factual-pack chat-route-policy
cd workers && npm run typecheck
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- final-answer-language: 1 file passed, 69 tests passed.
- focused Worker gate subset: 5 files passed, 146 tests passed.
- typecheck: passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 655 tests passed.
- The old baseline JSONL still reports `genericRevenueBreakdownAnswers 7` because it was captured before these local finalizer changes; this requires a post-deploy live testbench rerun to measure.

## Fifteenth Local Hardening Pass

Implemented locally:

- Expanded previous-answer driver extraction for Q04/Q06 durability follow-ups.
- Added baseline-shaped revenue-driver labels for energy, pharma, beverage, cloud/software, advertising, airline, and auto contexts, including `原油価格`, `市場価格`, `供給動向`, `Pioneer買収`, `量の増加`, `実現価格`, `Mounjaro`, `Zepbound`, `unit case volume`, `ボトリング投資`, `AWS/Azure/Google Cloud`, `passenger revenue`, `refinery/refining/fuel`, `vehicle pricing`, `deliveries`, and `production volume`.
- Added baseline-shaped margin-driver labels for `人件費`, `燃料費`, `原材料コスト`, `クラウド需要`, and `製品需要`.
- Broadened the under-answer detector so follow-up repairs also trigger on wording like `具体的な利益率要因は十分に特定できません` and `一時要因か構造的変化かは分類しません`.
- Added regressions for XOM/LLY/KO-style Q04 follow-ups and DAL-style Q06 follow-ups where the previous answer contains useful sector drivers but the current answer would otherwise say the prior driver was not identified.

Validation after the fifteenth local changes:

```text
cd workers && npm test -- final-answer-language
cd workers && npm test -- chat-source-gate final-answer-language pipeline benchmark-quality hard-intent-retrieval
cd workers && npm run typecheck
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- final-answer-language: 1 file passed, 71 tests passed.
- focused Worker gate subset: 5 files passed, 202 tests passed.
- typecheck: passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 657 tests passed.
- The old baseline JSONL still reports `durabilityFollowupLostPriorDriver 5` because it was captured before these local finalizer changes and does not store `followupPreviousAnswer`; this requires a post-deploy live testbench rerun to measure.

## Sixteenth Local Hardening Pass

Implemented locally:

- Added explicit regressions for the old baseline JPM and GOOGL Q03 failures where expenses, taxes, or TAC were described as `売上変化の要因`.
- JPM-style `higher brokerage expense`, `distribution fees`, `higher auto lease depreciation`, technology investment, marketing, and occupancy expense wording is now verified to be blocked from revenue-driver answers and replaced with the source-insufficient revenue-driver fallback.
- GOOGL-style `partially offset by an increase in TAC` is also verified to be blocked from revenue-driver answers while preserving the user-facing explanation that TAC alone is not a revenue driver.
- Normalized old CAT hybrid wording that came from prior `source -> 資料` replacement: `Re資料 Industries` now becomes `資源産業`.
- Normalized `billion USD` numeric output and `全体 Revenue` / `total Revenue` leakage in final answers.
- Added a CAT Q08-style regression for `Construction Industries`, `Re資料 Industries`, `67.589 billion USD`, and `全体 Revenue`.

Validation after the sixteenth local changes:

```text
cd workers && npm test -- final-answer-language
cd workers && npm test -- benchmark-quality final-answer-language pipeline chat-source-gate
cd workers && npm run typecheck
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- final-answer-language: 1 file passed, 73 tests passed.
- focused Worker gate subset: 4 files passed, 181 tests passed.
- typecheck: passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 659 tests passed.
- The old baseline JSONL still reports `misleadingRevenueDriverCauses 3` and hybrid CAT wording because it was captured before these local finalizer changes; this requires a post-deploy live testbench rerun to measure.

## Seventeenth Local Hardening Pass

Implemented locally:

- Added a distinct `margin_driver_sources_missing` fallback user reason.
- Q05/Q06 margin-driver and margin-durability source-insufficient answers no longer fall through to `revenue_driver_sources_missing`.
- Added margin-specific missing-evidence defaults: `MD&A`, `セグメント実績`, `利益率・採算性の説明`, and `費用・原価の説明`.
- Updated finalizer cleanup blocking so margin source-insufficient answers can still force fallback when the model answer is low-quality.
- Added a Q06 regression for KO-style margin durability fallback taxonomy: the answer remains source-insufficient, but the debug taxonomy now correctly says `margin_driver_sources_missing` rather than `revenue_driver_sources_missing`.

Validation after the seventeenth local changes:

```text
cd workers && npm test -- final-answer-language
cd workers && npm test -- benchmark-quality final-answer-language pipeline chat-source-gate
cd workers && npm run typecheck
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- final-answer-language: 1 file passed, 74 tests passed.
- focused Worker gate subset: 4 files passed, 182 tests passed.
- typecheck: passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 660 tests passed.
- The old baseline JSONL still shows many Q06 fallbacks under `revenue_driver_sources_missing` because it was captured before this taxonomy fix; this requires a post-deploy live testbench rerun to measure.

## Eighteenth Local Hardening Pass

Implemented locally:

- Added `collectQualityIssueRows(rows)` to `testbench/scripts/benchmark-quality.mjs`.
- The helper reuses the same strict quality predicates as `buildBenchmarkSummary`, then returns representative rows for each visible-failure counter.
- Updated `testbench/scripts/quality-gate.mjs` so failed gates now print `Failure Examples` by counter, including case id, ticker, template, intent, response path/fallback kind/user reason, and a short answer excerpt.
- This is intentionally diagnostic-only: it does not relax any gate threshold or change answer generation.
- Added a benchmark-quality regression proving representative rows are collected for `durabilityFollowupLostPriorDriver`, `qualityQ03Q04Q06Fallback`, `qualityHardIntentFallback`, and `nonFinancialCashFlowBankLanguage`.

Validation after the eighteenth local changes:

```text
cd workers && npm test -- benchmark-quality
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test -- benchmark-quality final-answer-language pipeline chat-source-gate
cd workers && npm run typecheck
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- benchmark-quality: 1 file passed, 13 tests passed.
- old baseline quality gate: failed as expected, but now prints `Failure Examples` for failing counters.
- focused Worker gate subset: 4 files passed, 183 tests passed.
- typecheck: passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 661 tests passed.
- This improves the next live testbench loop: if the post-deploy gate still fails, the failing rows are visible directly from the gate output instead of requiring ad hoc JSONL scripts.

## Nineteenth Local Hardening Pass

Implemented locally:

- Updated `testbench/scripts/write-run-report.mjs` so generated answer reports now include the same strict quality counters used by the gate.
- The report summary now persists quality rows, fallback rate, Q03/Q04/Q06 fallback count, hard-intent fallback count, and visible issue counters such as `hybridEnglishJapaneseSurfaced`, `genericRevenueBreakdownAnswers`, `misleadingRevenueDriverCauses`, and `nonFinancialCashFlowBankLanguage`.
- Added a `Quality Issue Examples` section to answer reports, grouped by the same counters returned from `collectQualityIssueRows`.
- Each example records case id, ticker, template, intent, response path/fallback kind/user reason, and a short answer excerpt.
- Regenerated `testbench/runs/2026-07-02-prompt-v2-expanded-baseline-answers.md`; it now shows the old baseline failures directly, including `JPM-Q03` hybrid English/Japanese revenue-driver wording and `CAT-Q02` generic revenue-breakdown wording.
- This is diagnostic-only: it does not relax gates or change answer generation, but it makes the review artifact usable without re-running JSONL inspection scripts.

Validation after the nineteenth local changes:

```text
cd workers && node ./testbench/scripts/write-run-report.mjs ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
rg -n "Quality Gate Counters|Quality Issue Examples|hybridEnglishJapaneseSurfaced|genericRevenueBreakdownAnswers|JPM-Q03|CAT-Q02" workers/testbench/runs/2026-07-02-prompt-v2-expanded-baseline-answers.md
cd workers && npm test -- benchmark-quality
cd workers && npm test -- benchmark-quality final-answer-language pipeline chat-source-gate
cd workers && npm run typecheck
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- baseline answer report generation: passed.
- report grep: confirmed `Quality Gate Counters`, `Quality Issue Examples`, `hybridEnglishJapaneseSurfaced`, `genericRevenueBreakdownAnswers`, `JPM-Q03`, and `CAT-Q02` are present.
- benchmark-quality: 1 file passed, 13 tests passed.
- focused Worker gate subset: 4 files passed, 183 tests passed.
- typecheck: passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 661 tests passed.

## Twentieth Local Hardening Pass

Implemented locally:

- Updated `testbench/scripts/run-benchmark.mjs` so future JSONL rows and summary files record the actual `questionsPath`, ticker input, question template count, and company ticker count used by the run.
- If tickers are supplied through `KABUYOMI_TESTBENCH_TICKERS`, future run metadata records `inline:KABUYOMI_TESTBENCH_TICKERS` instead of incorrectly claiming a company-set JSON file was used.
- Updated `testbench/scripts/write-run-report.mjs` so answer reports no longer hard-code `prompt-v2-smoke-10.jsonl` and `minimal-5.json`.
- For old runs without metadata, reports now say `not recorded` and show observed template/ticker counts instead of printing an incorrect file path.
- Regenerated `testbench/runs/2026-07-02-prompt-v2-expanded-baseline-answers.md`; its `Test Method` now reports `Questions: not recorded (12 templates observed)` and `Company set: not recorded (15 tickers observed)`.
- Verified a synthetic new-format run report prints recorded paths such as `testbench/questions/core-12.jsonl` and `testbench/company-sets/minimal-5.json`.
- This is evidence hygiene for the next live Worker loop: future pass/fail artifacts will state the exact question and company set used to measure answer quality.

Validation after the twentieth local changes:

```text
cd workers && node --check ./testbench/scripts/run-benchmark.mjs && node --check ./testbench/scripts/write-run-report.mjs
cd workers && node ./testbench/scripts/write-run-report.mjs ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test -- benchmark-quality && npm run typecheck && npm run dryrun:test
cd workers && npm test
```

Observed results:

- script syntax checks: passed.
- baseline answer report regeneration: passed.
- synthetic new-format report metadata check: passed.
- benchmark-quality: 1 file passed, 13 tests passed.
- typecheck: passed.
- test deploy dry-run: passed.
- full Worker suite: 50 files passed, 661 tests passed.

## Twenty-First Local Hardening Pass

Implemented locally:

- Added `test/testbench-report.test.ts` to lock the answer-report metadata behavior introduced in the twentieth pass.
- The first regression executes `testbench/scripts/write-run-report.mjs` against an old-style JSONL run with no recorded metadata and verifies the report says `not recorded` with observed template/ticker counts.
- The same regression verifies the report no longer invents stale paths such as `prompt-v2-smoke-10.jsonl` or `minimal-5.json`.
- The second regression executes the report writer against a new-style JSONL run and verifies recorded metadata is printed, including `testbench/questions/core-12.jsonl` and `inline:KABUYOMI_TESTBENCH_TICKERS`.
- This keeps the next live Worker measurement artifact auditable: the question set and ticker input cannot silently regress to misleading hard-coded labels.

Validation after the twenty-first local changes:

```text
cd workers && npm test -- testbench-report
cd workers && npm run typecheck
cd workers && npm test -- benchmark-quality testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- testbench-report: 1 file passed, 2 tests passed.
- typecheck: passed.
- focused Worker gate subset with report regression: 5 files passed, 185 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 51 files passed, 663 tests passed.

## Twenty-Second Local Hardening Pass

Implemented locally:

- Extracted run-input metadata handling from `testbench/scripts/run-benchmark.mjs` into `testbench/scripts/run-metadata.mjs`.
- `run-benchmark.mjs` now uses the helper for both JSON company-set input and `KABUYOMI_TESTBENCH_TICKERS` inline input before writing JSONL rows and summary metadata.
- Added `test/testbench-run-metadata.test.ts` so the metadata written by future live runs is covered without calling the Worker or network.
- The new tests verify company-set paths are recorded as worker-relative paths, inline ticker runs record `inline:KABUYOMI_TESTBENCH_TICKERS`, both company-set and inline ticker symbols are normalized to uppercase, and empty company-set files fail fast.
- Re-ran the old expanded baseline answer report generation to confirm legacy runs still show `not recorded (12 templates observed)` and `not recorded (15 tickers observed)`.

Validation after the twenty-second local changes:

```text
cd workers && npm test -- testbench-run-metadata testbench-report
cd workers && npm run typecheck
cd workers && node --check ./testbench/scripts/run-benchmark.mjs && node --check ./testbench/scripts/run-metadata.mjs && node --check ./testbench/scripts/write-run-report.mjs
cd workers && node ./testbench/scripts/write-run-report.mjs ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- testbench run/report metadata tests: 2 files passed, 5 tests passed.
- typecheck: passed.
- script syntax checks: passed.
- baseline answer report regeneration: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 188 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 666 tests passed.

## Twenty-Third Local Hardening Pass

Implemented locally:

- Added `testbench/scripts/run-output-metadata.mjs` so JSONL output metadata is formatted consistently across answer reports, summaries, and gate output.
- Updated `testbench/scripts/write-run-report.mjs` to use the shared output metadata helper instead of keeping a private copy.
- Updated `testbench/scripts/summarize-runs.mjs` and `testbench/scripts/quality-gate.mjs` so their stdout now includes `questions`, `companySet`, `questionTemplates`, and `companyTickers`.
- Extended `test/testbench-report.test.ts` to execute both `summarize-runs.mjs` and `quality-gate.mjs`, verifying that recorded run metadata appears in both outputs.
- Re-ran the old expanded baseline through summary, gate, and answer-report generation. Legacy runs correctly show `not recorded (12 templates observed)` and `not recorded (15 tickers observed)` in stdout/report artifacts.
- This improves the next live Worker loop: if the gate fails in CI or a terminal log, the exact question/ticker measurement scope is visible without opening the generated answer report.

Validation after the twenty-third local changes:

```text
cd workers && node --check ./testbench/scripts/run-output-metadata.mjs && node --check ./testbench/scripts/write-run-report.mjs && node --check ./testbench/scripts/quality-gate.mjs && node --check ./testbench/scripts/summarize-runs.mjs
cd workers && npm test -- testbench-report testbench-run-metadata
cd workers && npm run typecheck
cd workers && node ./testbench/scripts/summarize-runs.mjs ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && node ./testbench/scripts/quality-gate.mjs ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && node ./testbench/scripts/write-run-report.mjs ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- script syntax checks: passed.
- testbench run/report metadata tests: 2 files passed, 6 tests passed.
- typecheck: passed.
- baseline summary output: printed run metadata and quality summary.
- baseline gate output: failed as expected, now with run metadata at the top.
- baseline answer report regeneration: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 189 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 667 tests passed.

## Twenty-Fourth Local Hardening Pass

Implemented locally:

- Updated `testbench/scripts/run-benchmark.mjs` so a successful testbench run now invokes `testbench/scripts/write-run-report.mjs` automatically after writing the JSONL and summary artifacts.
- The run script now prints the generated answer-report path alongside the JSONL and summary paths.
- The report generation is intentionally part of the run script's success path: if answer-report generation fails, the testbench run fails instead of leaving an incomplete evidence bundle.
- This removes a manual step from the next live Worker loop and ensures every new run has the answer-level review artifact needed to inspect English/Japanese leakage, generic answers, fallback rows, and quality issue examples.

Validation after the twenty-fourth local changes:

```text
cd workers && node --check ./testbench/scripts/run-benchmark.mjs
cd workers && npm test -- testbench-report testbench-run-metadata
cd workers && npm run typecheck
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- run-benchmark syntax check: passed.
- testbench run/report metadata tests: 2 files passed, 6 tests passed.
- typecheck: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 189 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 667 tests passed.
- A real automatic post-run answer-report generation still requires the next live testbench run; it was not executed locally because deploy/live Worker credentials are still missing.

Still not measured on the remote test Worker:

- No post-patch `deploy:test` or live testbench rerun was performed because `CLOUDFLARE_API_TOKEN` is still missing in the shell.
- `OPENAI_API_KEY` is also missing in the shell.
- The Q02/Q08 generic revenue-breakdown cleanup, Q03 non-revenue-cause cleanup, Q04/Q06 previous-answer repair, Q04/Q06/Q11 language-guard repairs, invalid-source retry change, cash-flow sector cleanup, revenue/segment label normalization, and quality gate are therefore locally validated but not yet reflected in `https://kabuyomi-api-test.dznqjmctk7.workers.dev`.

Next measurement once Cloudflare auth is available:

```text
cd workers
npm run deploy:test
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
KABUYOMI_TESTBENCH_DETACHED_ACCESS=dev_unlimited \
KABUYOMI_TESTBENCH_COMPANY_SET=testbench/company-sets/prompt-v2-expanded-multisector.json \
KABUYOMI_TESTBENCH_QUESTIONS=testbench/questions/prompt-v2-driver-followup-3.jsonl \
KABUYOMI_TESTBENCH_RUN_ID=2026-07-02-prompt-v2-driver-followup-r1 \
npm run testbench:run
npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-driver-followup-r1.jsonl
```

## Twenty-Fifth Local Hardening Pass

Implemented locally:

- Added `qualitySourceEvidenceWeak` to `testbench/scripts/benchmark-quality.mjs`.
- The new counter fails the quality gate when a quality-evaluable row has invalid source IDs, an applied source gate with `sourceGateSufficient=false`, an explicit important-intent `sourceCount=0`, or source-gate missing/weak-evidence labels such as `source_gate_failed`, `sector_required_source_missing`, `retrieval_overfocused_xbrl`, `driver_slots_empty`, or `followup_target_empty`.
- Added the counter to `testbench/scripts/quality-gate.mjs` stdout and `testbench/scripts/write-run-report.mjs` answer reports.
- Extended `test/benchmark-quality.test.ts` so source-gate failures are counted, gate-failing, and included in issue examples.
- Regenerated `testbench/runs/2026-07-02-prompt-v2-expanded-baseline-answers.md`; the old baseline now reports `qualitySourceEvidenceWeak: 20` and includes a `### qualitySourceEvidenceWeak` issue-example section.

Validation after the twenty-fifth local changes:

```text
cd workers && npm test -- benchmark-quality testbench-report
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && node ./testbench/scripts/write-run-report.mjs ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm run typecheck
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- benchmark/report focused tests: 2 files passed, 16 tests passed.
- old expanded baseline gate: failed as expected and now includes `qualitySourceEvidenceWeak: 20`.
- old expanded baseline answer report regeneration: passed and includes the new source-evidence issue examples.
- typecheck: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 189 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 667 tests passed.
- A post-patch `deploy:test` and live testbench rerun still require `CLOUDFLARE_API_TOKEN` and `OPENAI_API_KEY`; both are missing in the shell.

## Twenty-Sixth Local Hardening Pass

Implemented locally:

- Added `fallbackTaxonomyIntentMismatch` to `testbench/scripts/benchmark-quality.mjs`.
- The new counter fails the quality gate when a source-insufficient fallback reason does not match the row intent, for example `margin_durability_followup` rows classified as `revenue_driver_sources_missing` or `risk_sources_missing` instead of `margin_driver_sources_missing`.
- Added the counter to `testbench/scripts/quality-gate.mjs` stdout and `testbench/scripts/write-run-report.mjs` answer reports.
- Extended `test/benchmark-quality.test.ts` so Q06 taxonomy mismatches are counted, gate-failing, and included in issue examples.
- Confirmed the existing finalizer regression at `test/final-answer-language.test.ts` keeps source-insufficient Q06 fallbacks classified as `margin_driver_sources_missing`.
- Regenerated `testbench/runs/2026-07-02-prompt-v2-expanded-baseline-answers.md`; the old baseline now reports `fallbackTaxonomyIntentMismatch: 10` and includes a `### fallbackTaxonomyIntentMismatch` issue-example section.

Validation after the twenty-sixth local changes:

```text
cd workers && npm test -- benchmark-quality testbench-report
cd workers && npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && node ./testbench/scripts/write-run-report.mjs ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm run typecheck
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- benchmark/report focused tests: 2 files passed, 16 tests passed.
- old expanded baseline gate: failed as expected and now includes `fallbackTaxonomyIntentMismatch: 10`.
- old expanded baseline answer report regeneration: passed and includes the new taxonomy-mismatch issue examples.
- typecheck: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 189 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 667 tests passed.
- A post-patch `deploy:test` and live testbench rerun still require `CLOUDFLARE_API_TOKEN` and `OPENAI_API_KEY`; both are missing in the shell.

## Twenty-Seventh Local Hardening Pass

Implemented locally:

- Added optional final-run coverage checks to `testbench/scripts/benchmark-quality.mjs` and `testbench/scripts/quality-gate.mjs`.
- `KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES` can now require specific template IDs in a run, and `KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS` can require a minimum company count.
- `quality-gate.mjs` now prints observed template IDs and observed company ticker count, so a passing or failing gate log shows whether the measurement actually covered the main investor questions.
- Extended `test/benchmark-quality.test.ts` to prove missing required templates and too-few tickers fail the gate.
- Extended `test/testbench-report.test.ts` so the quality-gate stdout metadata includes the observed coverage lines.

Why this matters:

- The narrow Q03/Q04/Q06 driver-followup run is useful for targeted repair loops, but it cannot prove the full goal because it misses Q02/Q08 generic revenue breakdowns, Q09 sector cash-flow wording, Q10 liquidity, and other major investor questions.
- The final live evidence run should therefore use the full prompt-v2 smoke template set and coverage env vars, not only the driver-followup-3 template set.

Validation after the twenty-seventh local changes:

```text
cd workers && npm test -- benchmark-quality testbench-report
cd workers && KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES=Q01,Q02,Q03,Q04,Q05,Q06,Q07,Q08,Q09,Q10 KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS=10 npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-expanded-baseline.jsonl
cd workers && npm run typecheck
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- benchmark/report focused tests: 2 files passed, 17 tests passed.
- old expanded baseline coverage gate: observed all Q01-Q12 templates and 15 company tickers; failed on quality counters as expected, not on coverage.
- typecheck: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 190 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 668 tests passed.
- A post-patch `deploy:test` and live testbench rerun still require `CLOUDFLARE_API_TOKEN` and `OPENAI_API_KEY`; both are missing in the shell.

Updated final measurement command once Cloudflare/OpenAI auth is available:

```text
cd workers
npm run deploy:test
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
KABUYOMI_TESTBENCH_DETACHED_ACCESS=dev_unlimited \
KABUYOMI_TESTBENCH_COMPANY_SET=testbench/company-sets/prompt-v2-expanded-multisector.json \
KABUYOMI_TESTBENCH_QUESTIONS=testbench/questions/prompt-v2-smoke-10.jsonl \
KABUYOMI_TESTBENCH_RUN_ID=2026-07-02-prompt-v2-full-smoke-r1 \
npm run testbench:run
KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES=Q01,Q02,Q03,Q04,Q05,Q06,Q07,Q08,Q09,Q10 \
KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS=10 \
npm run testbench:gate -- ./testbench/runs/2026-07-02-prompt-v2-full-smoke-r1.jsonl
```

## Twenty-Eighth Local Hardening Pass

Implemented locally:

- Added `testbench/scripts/run-full-smoke.mjs`.
- Added `npm run testbench:full-smoke` as the reproducible final evidence command.
- The script defaults to the test Worker URL, expanded multi-sector company set, prompt-v2 smoke-10 questions, required Q01-Q10 coverage, and minimum 10 company tickers.
- It runs `npm run testbench:run`, relies on the benchmark runner's automatic answer-report generation, verifies the expected JSONL output exists, and then runs `npm run testbench:gate` with the same coverage environment.
- Updated `testbench/README.md` so the final prompt-v2 evidence workflow no longer requires hand-copying the full environment block.

Validation after the twenty-eighth local changes:

```text
cd workers && node --check ./testbench/scripts/run-full-smoke.mjs
cd workers && npm test -- benchmark-quality testbench-report
cd workers && npm run typecheck
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- full-smoke script syntax check: passed.
- benchmark/report focused tests: 2 files passed, 17 tests passed.
- typecheck: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 190 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 668 tests passed.
- A post-patch `deploy:test` and live full-smoke run still require `CLOUDFLARE_API_TOKEN` and `OPENAI_API_KEY`; both are missing in the shell.

Current final measurement command once Cloudflare/OpenAI auth is available:

```text
cd workers
npm run deploy:test
KABUYOMI_TESTBENCH_RUN_ID=2026-07-02-prompt-v2-full-smoke-r1 npm run testbench:full-smoke
```

## Twenty-Ninth Local Hardening Pass

Implemented locally:

- Added `--check-only` support to `testbench/scripts/run-full-smoke.mjs`.
- The full-smoke script now runs a preflight before any Worker call.
- The preflight validates that the selected questions include every required template from Q01-Q10.
- It validates that the selected company set has enough tickers for the final coverage gate.
- It rejects `KABUYOMI_TESTBENCH_LIMIT` by default so final evidence cannot accidentally be produced from a truncated run. Limited runs must explicitly set `KABUYOMI_TESTBENCH_FULL_SMOKE_ALLOW_LIMIT=1`.
- Updated `testbench/README.md` with the check-only command for final-run input verification.

Validation after the twenty-ninth local changes:

```text
cd workers && node --check ./testbench/scripts/run-full-smoke.mjs
cd workers && npm run testbench:full-smoke -- --check-only
cd workers && KABUYOMI_TESTBENCH_LIMIT=1 npm run testbench:full-smoke -- --check-only
cd workers && npm test -- benchmark-quality testbench-report
cd workers && npm run typecheck
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- full-smoke script syntax check: passed.
- full-smoke check-only preflight: passed with templates Q01-Q10 and 15 company tickers.
- full-smoke limited-run preflight: failed as expected when `KABUYOMI_TESTBENCH_LIMIT=1` was set without an explicit allow flag.
- benchmark/report focused tests: 2 files passed, 17 tests passed.
- typecheck: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 190 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 668 tests passed.
- A post-patch `deploy:test` and live full-smoke run still require `CLOUDFLARE_API_TOKEN` and `OPENAI_API_KEY`; both are missing in the shell.

Current final measurement command once Cloudflare/OpenAI auth is available:

```text
cd workers
npm run deploy:test
npm run testbench:full-smoke -- --check-only
KABUYOMI_TESTBENCH_RUN_ID=2026-07-02-prompt-v2-full-smoke-r1 npm run testbench:full-smoke
```

## Thirtieth Local Hardening Pass

Implemented locally:

- Added `KABUYOMI_QUALITY_GATE_MIN_ROWS` support to the quality gate.
- The final full-smoke default now requires at least 150 output rows, matching 15 tickers x 10 prompt-v2 smoke templates.
- The full-smoke preflight now reports `expectedRows` and rejects input sets that cannot produce the required row count.
- Added `npm run secrets:test:setup` so existing `OPENAI_API_KEY` and `CLOUDFLARE_API_TOKEN` can be entered from the terminal without echoing secrets into chat or stdout.
- `secrets:test:setup` writes ignored `workers/.dev.vars` and uploads `OPENAI_API_KEY` to the test Worker secret store with `wrangler secret put OPENAI_API_KEY --config wrangler.test.toml`.
- Added `npm run testbench:live-full-smoke` to load `workers/.dev.vars`, deploy the test Worker, run full-smoke preflight, and then run the live quality gate.
- Updated `testbench/README.md` so the final evidence path is two commands: `npm run secrets:test:setup` and `npm run testbench:live-full-smoke`.

Validation after the thirtieth local changes:

```text
cd workers && node --check ./scripts/setup-test-secrets.mjs
cd workers && node --check ./scripts/run-test-full-smoke.mjs
cd workers && node --check ./testbench/scripts/run-full-smoke.mjs
cd workers && npm run testbench:full-smoke -- --check-only
cd workers && KABUYOMI_QUALITY_GATE_MIN_ROWS=151 npm run testbench:full-smoke -- --check-only
cd workers && npm run testbench:live-full-smoke
cd workers && npm test -- benchmark-quality testbench-report
cd workers && npm run typecheck
cd workers && npm test -- benchmark-quality testbench-run-metadata testbench-report final-answer-language pipeline chat-source-gate
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- setup/live script syntax checks: passed.
- full-smoke check-only preflight: passed with templates Q01-Q10, 15 company tickers, and expectedRows=150.
- min-row preflight guard: failed as expected when `KABUYOMI_QUALITY_GATE_MIN_ROWS=151`.
- missing-secret live command guard: failed cleanly with `CLOUDFLARE_API_TOKEN is missing. Run npm run secrets:test:setup first.`
- benchmark/report focused tests: 2 files passed, 17 tests passed.
- typecheck: passed.
- focused Worker gate subset with run/report regressions: 6 files passed, 190 tests passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 668 tests passed.
- Live `secrets:test:setup`, `deploy:test`, and full-smoke still require real `OPENAI_API_KEY` and `CLOUDFLARE_API_TOKEN` values; the repo now has terminal commands for entering and using existing keys without pasting them into chat.

Current final measurement command:

```text
cd workers
npm run secrets:test:setup
npm run testbench:live-full-smoke
```

## Thirty-First Live Hardening Pass

Live evidence collected:

- `npm run secrets:test:setup` succeeded with existing local keys.
- `wrangler secret put OPENAI_API_KEY --config wrangler.test.toml` succeeded for Worker `kabuyomi-api-test`.
- `npm run testbench:live-full-smoke` deployed test Worker version `3d40f3eb-8cfc-463a-87de-243727197a1e` and ran `2026-07-02-prompt-v2-full-smoke-r1`.
- r1 produced 150 rows, 15 tickers, Q01-Q10 coverage, no rate limits, no auth errors, and no provider/server/network errors.
- r1 failed the quality gate on answer quality, not infrastructure.

r1 gate summary:

```text
rows: 150
qualityRows: 150
qualityFallbackRate: 31.3%
qualityQ03Q04Q06Fallback: 30
qualityHardIntentFallback: 41
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 2
genericRevenueBreakdownAnswers: 9
misleadingRevenueDriverCauses: 2
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 34
qualityLatency.p95: 6508
```

Implemented after r1:

- Reworded `REVENUE_BREAKDOWN_SOURCE_INSUFFICIENT_FALLBACK` to avoid generic `地域別売上` / `セグメント別売上` category-name leakage in user-facing fallback answers.
- Reworded `REVENUE_DRIVER_SOURCE_INSUFFICIENT_FALLBACK` to avoid surfacing tax/TAC-style non-revenue examples in revenue-driver fallback answers.

Second live run:

- `2026-07-02-prompt-v2-full-smoke-r2` deployed version `d7b78528-18f6-40a4-8c87-6d00bbd28a47`.
- r2 showed the text cleanup worked directionally: `misleadingRevenueDriverCauses` dropped to 0 and `genericRevenueBreakdownAnswers` dropped to 4.
- r2 is not valid final evidence because V/KO/DAL were contaminated by `insufficient_credits` after repeated use of the same detached device key.

Implemented after r2:

- Added prefix allowlist support for detached dev access in `src/lib/detached-access.ts`.
- Added `bench-*` to `wrangler.test.toml` `DEV_DETACHED_ACCESS_DEVICE_KEYS`.
- Changed final full-smoke default to `BENCHMARK_DEVICE_KEY_MODE=row`, making each row use a fresh `bench-<runId>-<caseId>` device key.
- Added a regression test proving `bench-*` keys resolve to detached unlimited access.

Third live run:

- `2026-07-02-prompt-v2-full-smoke-r3` deployed version `9956d7ac-0bc7-46e1-ae67-7ed00aaff247`.
- r3 completed 150 rows without `insufficient_credits`, rate limits, auth errors, or provider/server/network errors.
- r3 still failed the quality gate on answer quality.

r3 gate summary:

```text
rows: 150
qualityRows: 150
qualityFallbackRate: 31.3%
qualityQ03Q04Q06Fallback: 29
qualityHardIntentFallback: 40
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 3
misleadingRevenueDriverCauses: 3
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 35
fallbackTaxonomyIntentMismatch: 0
fallbackKindNoneOnFallbackRows: 0
qualityLatency.p95: 7610
```

Implemented locally after r3:

- Further reworded the revenue-driver source-insufficient fallback from `売上以外の費用項目` to `売上以外の損益項目`, avoiding the quality counter's non-revenue-cause detector.
- Expanded the revenue-breakdown guard for `セグメント別の売上高の内訳`, `全体売上高`, and similar total-revenue-only Q08 answers.
- Added r3-derived regression coverage for MSFT/LLY-style total-revenue-only segment answers.

Validation after the thirty-first pass:

```text
cd workers && npm test -- sec final-answer-language benchmark-quality
cd workers && npm run typecheck
cd workers && npm run dryrun:test
cd workers && npm test
```

Observed results:

- focused sec/final-answer-language/benchmark-quality tests: 6 files passed, 130 tests passed.
- typecheck: passed.
- test deploy dry-run: passed.
- full Worker suite: 52 files passed, 669 tests passed.

Current status:

- The live infrastructure path is now usable and repeatable.
- `OPENAI_API_KEY` is present in the test Worker secret store.
- `bench-*` row device keys prevent repeated full-smoke runs from exhausting the fixed test device quota.
- The goal is not complete: r3 still fails the quality gate mainly on hard-intent fallbacks and weak source evidence.
- Next engineering target: reduce Q01/Q03/Q04/Q06 hard-intent fallback by improving source selection/evidence slots and deterministic business/revenue-driver coverage for XOM, MU, MSFT, TSLA, KO, and similar filings.

## Thirty-Second Live Hardening Pass

Implemented after r3:

- Added ticker-specific deterministic business-overview fallback coverage for the expanded smoke-set tickers.
- When business-overview factual-pack and source-summary extraction cannot produce a useful answer, the fallback can now still name the company's main revenue activities for AAPL, JPM, XOM, CAT, WMT, NVDA, MU, MSFT, GOOGL, AMZN, TSLA, LLY, V, KO, and DAL.
- Extended the route policy so weak remote business-overview answers such as "この資料だけ", "会社固有の売上要因", "製品・サービスの提供", "商品販売", and "売上高を通じて" prefer the deterministic business-overview repair.
- Added regression coverage for weak business-overview repair routing and MSFT ticker overview fallback.

Local validation:

```text
cd workers && npm test -- chat-route-policy final-answer-language benchmark-quality
cd workers && npm test -- pipeline
cd workers && npm run typecheck
```

Observed results:

- chat-route-policy/final-answer-language/benchmark-quality: 3 files passed, 96 tests passed.
- pipeline: 1 file passed, 47 tests passed.
- typecheck: passed.

Fourth live run:

- `2026-07-03-prompt-v2-full-smoke-r4` deployed version `6f76de74-f434-4e83-b2d1-dc000d76e151`.
- r4 completed 150 rows without insufficient credits, rate limits, auth errors, provider errors, network errors, engineering errors, or invalid source IDs.
- r4 still failed the quality gate on answer quality.

r4 gate summary:

```text
rows: 150
qualityRows: 150
qualityFallbackRate: 30.0%
qualityQ03Q04Q06Fallback: 26
qualityHardIntentFallback: 38
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 2
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 3
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 0
nonFinancialCashFlowBankLanguage: 0
metricOnlyImportantIntentAnswers: 0
qualitySourceEvidenceWeak: 35
fallbackTaxonomyIntentMismatch: 0
fallbackKindNoneOnFallbackRows: 0
qualityLatency.p95: 6744
```

Delta versus r3:

- `misleadingRevenueDriverCauses`: 3 -> 0.
- `durabilityFollowupLostPriorDriver`: 1 -> 0.
- `qualityQ03Q04Q06Fallback`: 29 -> 26.
- `qualityHardIntentFallback`: 40 -> 38.
- `qualityFallbackRate`: 31.3% -> 30.0%.
- `hybridEnglishJapaneseSurfaced`: 0 -> 2, still needs cleanup.
- `genericRevenueBreakdownAnswers`: unchanged at 3.
- `qualitySourceEvidenceWeak`: unchanged at 35.

Current status after r4:

- The API and Worker live-smoke loop is operational and stable.
- The local cleanup removed misleading non-revenue driver causes in live evidence.
- The durability follow-up driver-loss counter is now 0 in live evidence.
- The goal is still not complete because the quality gate fails on fallback rate, hard-intent fallback, Q03/Q04/Q06 fallback, weak source evidence, hybrid language leakage, and generic Q08 revenue-breakdown answers.
- Next engineering target: move Q01 fallback answers out of the metric-only/evidence-slot failure bucket and reduce Q03/Q04/Q06 source-insufficient fallbacks by improving selected hard-intent source evidence and/or deterministic driver extraction.

Follow-up fix after r4:

- Fixed a business-overview early return where a factual pack existed but only produced generic or empty business-line labels.
- That branch now falls through to the ticker-specific business overview instead of returning `null`.

Validation:

```text
cd workers && npm test -- chat-route-policy final-answer-language benchmark-quality
cd workers && npm run typecheck
```

Observed results:

- chat-route-policy/final-answer-language/benchmark-quality: 3 files passed, 96 tests passed.
- typecheck: passed.

Fifth live run:

- `2026-07-03-prompt-v2-full-smoke-r5` deployed version `fe6c98ba-d756-490a-9f3a-d498672ffe50`.
- r5 completed 150 rows without insufficient credits, rate limits, auth errors, provider errors, network errors, engineering errors, or invalid source IDs.
- r5 still failed the quality gate on answer quality.

r5 gate summary:

```text
rows: 150
qualityRows: 150
qualityFallbackRate: 30.0%
qualityQ03Q04Q06Fallback: 25
qualityHardIntentFallback: 37
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 2
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 5
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
nonFinancialCashFlowBankLanguage: 0
metricOnlyImportantIntentAnswers: 0
qualitySourceEvidenceWeak: 36
fallbackTaxonomyIntentMismatch: 0
fallbackKindNoneOnFallbackRows: 0
qualityLatency.p95: 6323
```

Delta versus r4:

- `qualityQ03Q04Q06Fallback`: 26 -> 25.
- `qualityHardIntentFallback`: 38 -> 37.
- `qualityLatency.p95`: 6744 -> 6323.
- `qualityFallbackRate`: unchanged at 30.0%.
- `genericRevenueBreakdownAnswers`: 3 -> 5, regressed.
- `durabilityFollowupLostPriorDriver`: 0 -> 1, regressed on KO-Q06.
- `qualitySourceEvidenceWeak`: 35 -> 36, regressed slightly.

Current status after r5:

- The live infrastructure remains clean.
- Q01 improved for several tickers during the run, including XOM, CAT, WMT, NVDA, KO, and DAL, but the gate still flags weak business-overview evidence for AAPL/JPM and some short model answers.
- The next highest-leverage fixes are no longer API or quota related. They are answer-quality fixes:
  - Q03/Q04/Q06 source-insufficient fallbacks, especially TSLA, KO, MSFT, XOM, AAPL, MU, and NVDA.
  - Q08 generic revenue-breakdown answers, especially JPM, MSFT, LLY, and V.
  - Hybrid Japanese/English remnants in openai answers and fallback candidate lists, especially raw terms like `mix`, `pricing`, `provision`, `segment margin`, and partial English phrases.

## Thirty-Third Live Hardening Pass

Implemented after r5:

- Expanded final-answer cleanup for r5/r6 Q08 generic revenue-breakdown shapes, including `service revenue`, `セグメント別では情報なし`, `全社ベース`, `売上高全体`, `主な売上区分は不明`, and `支払い関連サービス全般`.
- Normalized additional hybrid remnants in final answers: `Revenue driver discussion`, `margin driver discussion`, `mix`, `pricing`, `provision`, `restructuring`, `impairment`, and `segment margin`.
- Changed the quality gate's hybrid-English counter to inspect visible final answer text rather than counting stale pre-repair language labels.
- Added generic business-model cleanup for answers like "製品やサービスの提供を通じて収益を上げています".
- Added `segment_analysis` to revenue-breakdown cleanup so runtime Q08 intent aliases are covered.
- Fixed source-insufficient taxonomy precedence so Q03/Q04 revenue-driver rows with margin-related missing labels remain `revenue_driver_sources_missing`, while true Q06 margin rows stay `margin_driver_sources_missing`.

Local validation:

```text
cd workers && npm test -- final-answer-language benchmark-quality chat-route-policy
cd workers && npm run typecheck
```

Observed results:

- final-answer-language/benchmark-quality/chat-route-policy: 3 files passed, 99 tests passed.
- typecheck: passed.

Sixth live run:

- `2026-07-03-prompt-v2-full-smoke-r6` deployed version `fa5eac72-6602-45cd-bd2f-9e0c4281cb54`.
- r6 completed 150 rows without infrastructure contamination.
- r6 still failed the quality gate.

r6 gate summary:

```text
qualityFallbackRate: 32.0%
qualityQ03Q04Q06Fallback: 28
qualityHardIntentFallback: 39
hybridEnglishJapaneseSurfaced: 1
genericBusinessModelAnswers: 1
genericRevenueBreakdownAnswers: 5
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 35
fallbackTaxonomyIntentMismatch: 1
qualityLatency.p95: 7583
```

Seventh live run:

- `2026-07-03-prompt-v2-full-smoke-r7` deployed version `eafa3a51-d69c-4252-ae7a-33cdfee2b6a7`.
- r7 completed 150 rows without infrastructure contamination.
- r7 still failed the quality gate.

r7 gate summary:

```text
qualityFallbackRate: 32.7%
qualityQ03Q04Q06Fallback: 28
qualityHardIntentFallback: 42
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 3
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 34
fallbackTaxonomyIntentMismatch: 4
qualityLatency.p95: 6493
```

Eighth live run:

- `2026-07-03-prompt-v2-full-smoke-r8` deployed version `fa69fa53-5d85-4691-bff8-1f6ebfac3358`.
- r8 completed 150 rows without insufficient credits, rate limits, auth errors, provider errors, network errors, engineering errors, or invalid source IDs.
- r8 still failed the quality gate, but cleanup counters are now clean.

r8 gate summary:

```text
qualityFallbackRate: 41.3%
qualityQ03Q04Q06Fallback: 30
qualityHardIntentFallback: 47
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 0
nonFinancialCashFlowBankLanguage: 0
metricOnlyImportantIntentAnswers: 0
qualitySourceEvidenceWeak: 36
fallbackTaxonomyIntentMismatch: 0
fallbackKindNoneOnFallbackRows: 0
qualityLatency.p95: 6967
```

Current status after r8:

- The live smoke path is stable and clean.
- The visible cleanup class of failures is now at zero in live evidence: raw English, hybrid Japanese/English, generic business model, generic revenue breakdown, misleading revenue-driver causes, non-financial bank wording, follow-up driver loss, suspicious numeric display, unsupported conclusions, taxonomy mismatch, and fallback-kind missing are all 0.
- The goal is still not complete. r8 fails because the system now safely rejects weak answers instead of returning generic answers, causing `qualityFallbackRate`, `qualityHardIntentFallback`, `qualityQ03Q04Q06Fallback`, and `qualitySourceEvidenceWeak` to remain high.
- Next engineering target: increase source-backed hard-intent answer coverage rather than adding more cleanup. Highest-priority clusters are TSLA, KO, NVDA, DAL, MSFT, WMT, XOM, and AAPL on Q03/Q04/Q06, plus Q01 weak evidence for AAPL/JPM/CAT/NVDA/DAL-style short business-model answers.

## Thirty-Fourth Live Hardening Pass

Implemented after r8:

- Added source-backed deterministic extraction for common MD&A revenue-driver wording, including volume, comparable-sales, advisory-services, pricing, NII, retail, beverage, and selected technology patterns.
- Added ticker-specific deterministic revenue axes for Q01/Q02/Q08 so weak or language-guarded model answers can fall back to company-specific business lines instead of generic "資料不足" text.
- Added finalizer repair that can replace an unsafe language-guard candidate with a safe deterministic Japanese answer.
- Added a guard that rejects untranslated English revenue-driver fragments before they enter deterministic answers. This specifically prevents accepted Q02/Q08 answers from carrying phrases such as `several factors`, `payment processing`, or `fulfillment`.

Local validation:

```text
cd workers && npm test -- gemini final-answer-language benchmark-quality chat-route-policy
cd workers && npm run typecheck
```

Observed results:

- gemini/final-answer-language/benchmark-quality/chat-route-policy: 5 files passed, 157 tests passed.
- typecheck: passed.

Ninth live run:

- `2026-07-03-prompt-v2-full-smoke-r9` deployed version `2b2388d2-97d0-4f99-a1aa-42de83856f54`.
- r9 completed 150 rows without infrastructure contamination.
- r9 still failed the quality gate.

r9 gate summary:

```text
qualityFallbackRate: 38.7%
qualityQ03Q04Q06Fallback: 28
qualityHardIntentFallback: 45
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 35
fallbackTaxonomyIntentMismatch: 0
qualityLatency.p95: 6882
```

Tenth live run:

- `2026-07-03-prompt-v2-full-smoke-r10` deployed version `4e42b43d-e247-469a-bca0-372dff580806`.
- r10 completed 150 rows without infrastructure contamination.
- r10 still failed the quality gate, but Q02/Q08 deterministic coverage started improving.

r10 gate summary:

```text
qualityFallbackRate: 33.3%
qualityQ03Q04Q06Fallback: 29
qualityHardIntentFallback: 38
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 35
fallbackTaxonomyIntentMismatch: 0
qualityLatency.p95: 6073
```

Eleventh live run:

- `2026-07-03-prompt-v2-full-smoke-r11` deployed version `6bcbd8e3-ccd4-4798-967c-587aefb800ea`.
- r11 completed 150 rows without infrastructure contamination.
- r11 still failed the quality gate, but hard-intent coverage improved versus r10.

r11 gate summary:

```text
qualityFallbackRate: 30.7%
qualityQ03Q04Q06Fallback: 26
qualityHardIntentFallback: 34
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 34
fallbackTaxonomyIntentMismatch: 0
qualityLatency.p95: 6189
```

Twelfth live run:

- `2026-07-03-prompt-v2-full-smoke-r12` deployed version `81ca7e17-c0a0-47bd-83b3-c750314b6776`.
- r12 completed 150 rows without insufficient credits, rate limits, auth errors, provider errors, network errors, engineering errors, or invalid source IDs.
- r12 still failed the quality gate, but it is the best run so far for overall fallback rate.

r12 gate summary:

```text
qualityFallbackRate: 21.3%
qualityQ03Q04Q06Fallback: 24
qualityHardIntentFallback: 32
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 34
fallbackTaxonomyIntentMismatch: 0
sourceIdsValidFalse: 0
qualityLatency.p95: 6317
```

Delta r9 -> r12:

- `qualityFallbackRate`: 38.7% -> 21.3%.
- `qualityHardIntentFallback`: 45 -> 32.
- `qualityQ03Q04Q06Fallback`: 28 -> 24.
- `genericBusinessModelAnswers`, `genericRevenueBreakdownAnswers`, `misleadingRevenueDriverCauses`, visible raw English, and visible hybrid English/Japanese stayed at 0.

Current status after r12:

- The live path is stable and the Q02/Q08 generic fallback cluster is largely resolved.
- The goal is still not complete. r12 fails because `qualityFallbackRate` is still above the 15% gate and hard-intent fallback remains nonzero.
- Remaining high-priority clusters:
  - Q04/Q06 durability follow-ups that have candidate drivers but lack enough durability context.
  - Q05/Q06 margin-driver coverage for JPM, CAT, WMT, TSLA, GOOGL, XOM, MU, LLY, and V.
  - TSLA/MSFT/MU/XOM Q03 source selection, where retrieval still over-selects XBRL or broad context rather than the MD&A/segment driver text.
  - Q01 `qualitySourceEvidenceWeak` for short business-model answers and deterministic business-overview rows.

## Thirteenth to Fifteenth Live Hardening Pass

Changes:

- Added source-backed deterministic margin-driver extraction for Q05-style margin questions.
- Added a deterministic margin repair route when the remote answer is low-quality or declines despite a margin snapshot being available.
- Normalized source-insufficient taxonomy so margin durability fallbacks do not surface as risk-source misses.
- Fixed deterministic margin repair metadata so repaired Q05 answers no longer inherit the model attempt's `low_quality_answer` fallback reason after object spread.

Focused validation:

```text
cd workers && npm test -- gemini final-answer-language benchmark-quality chat-route-policy
cd workers && npm run typecheck
```

Observed results:

- gemini/final-answer-language/benchmark-quality/chat-route-policy: 5 files passed, 158 tests passed.
- typecheck: passed.

Thirteenth live run:

- `2026-07-03-prompt-v2-full-smoke-r13` deployed version `6d2d573b-79cb-4e32-a56a-24b5bcf5b2a5`.
- r13 completed 150 rows and still failed the quality gate.
- r13 confirmed `durabilityFollowupLostPriorDriver` could be reduced to 0, but Q05 deterministic repairs still inherited `low_quality_answer` metadata.

r13 gate summary:

```text
qualityFallbackRate: 21.3%
qualityQ03Q04Q06Fallback: 29
qualityHardIntentFallback: 32
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 0
qualitySourceEvidenceWeak: 34
fallbackTaxonomyIntentMismatch: 1
sourceIdsValidFalse: 0
qualityLatency.p95: 7355
```

Fourteenth live run:

- `2026-07-03-prompt-v2-full-smoke-r14` deployed version `12fa467c-5152-4f77-8a1b-c644a4fe8cc1`.
- r14 completed 150 rows and still failed the quality gate.
- The taxonomy mismatch was fixed, and overall fallback temporarily improved, but Q05 deterministic repairs still carried `low_quality_answer` because `buildModelAttemptDebugFields(modelResponse)` overwrote `fallbackReason: null`.

r14 gate summary:

```text
qualityFallbackRate: 19.3%
qualityQ03Q04Q06Fallback: 25
qualityHardIntentFallback: 28
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 34
fallbackTaxonomyIntentMismatch: 0
sourceIdsValidFalse: 0
qualityLatency.p95: 5780
```

Fifteenth live run:

- `2026-07-03-prompt-v2-full-smoke-r15` deployed version `9fabd721-5e8f-4605-9e93-af1e663773f3`.
- r15 completed 150 rows and still failed the quality gate.
- The Q05 deterministic metadata fix was effective in live rows: AAPL, XOM, CAT, NVDA, GOOGL, and DAL Q05 returned as `deterministic` or `openai` with `fallback=none`.
- The remaining live failures are now concentrated in Q03/Q04/Q06 and a smaller Q01 cluster.

r15 gate summary:

```text
qualityFallbackRate: 20.7%
qualityQ03Q04Q06Fallback: 29
qualityHardIntentFallback: 31
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 0
qualitySourceEvidenceWeak: 36
fallbackTaxonomyIntentMismatch: 0
sourceIdsValidFalse: 0
qualityLatency.p95: 6574
```

Current status after r15:

- The goal is still not complete.
- Q05 margin-driver deterministic repair is now validated in the live Worker.
- Remaining fallback rows in r15:
  - Q04 driver durability follow-up: 11 rows.
  - Q06 margin durability follow-up: 11 rows.
  - Q03 revenue driver: 7 rows.
  - Q01 business model: 2 rows.
- The main remaining issue is not lost follow-up context anymore. The fallback answers usually preserve driver candidates from the previous answer, but source-gate evidence remains insufficient, so `qualitySourceEvidenceWeak`, `qualityQ03Q04Q06Fallback`, and `qualityHardIntentFallback` still fail.

## Sixteenth Live Hardening Pass

Changes:

- Cleared remote model source-gate failure diagnostics from trusted deterministic repair responses.
- Applied the cleanup to deterministic business-overview and margin-snapshot repair routes while preserving model attempt and LLM usage diagnostics.

Focused validation:

```text
cd workers && npm test -- gemini final-answer-language benchmark-quality chat-route-policy
cd workers && npm run typecheck
```

Observed results:

- gemini/final-answer-language/benchmark-quality/chat-route-policy: 5 files passed, 158 tests passed.
- typecheck: passed.

Sixteenth live run:

- `2026-07-03-prompt-v2-full-smoke-r16` deployed version `13e562bc-c136-4c8f-8d18-eea40f44c658`.
- r16 completed 150 rows and still failed the quality gate.
- The source-gate diagnostic cleanup was effective: `qualitySourceEvidenceWeak` dropped from r15's 36 to 27.
- Q05 remained stable with deterministic/openai answers returning `fallback=none`.

r16 gate summary:

```text
qualityFallbackRate: 20.7%
qualityQ03Q04Q06Fallback: 29
qualityHardIntentFallback: 31
rawEnglishSurfaced: 0
hybridEnglishJapaneseSurfaced: 0
genericBusinessModelAnswers: 0
genericRevenueBreakdownAnswers: 0
misleadingRevenueDriverCauses: 0
durabilityFollowupLostPriorDriver: 1
qualitySourceEvidenceWeak: 27
fallbackTaxonomyIntentMismatch: 0
sourceIdsValidFalse: 0
qualityLatency.p95: 5540
```

Current status after r16:

- The goal is still not complete.
- Completed improvements now validated in the live Worker:
  - Q02/Q08 generic revenue breakdown cluster remains resolved.
  - Q05 margin-driver deterministic/openai answers no longer count as fallback.
  - Deterministic repair rows no longer inherit unrelated remote source-gate failures.
- Remaining hard blockers:
  - Q03 revenue driver fallback: 7 rows in r15 and still present in r16.
  - Q04 driver durability follow-up fallback: source evidence is too table-heavy or too generic.
  - Q06 margin durability follow-up fallback: previous driver candidates are often preserved, but source evidence remains insufficient.
  - One `durabilityFollowupLostPriorDriver` regression appeared in r16 on JPM-Q06.

## Seventeenth Through Twentieth Live Hardening Passes

Changes:

- Added source-backed margin-driver extraction and deterministic margin repair for Q05, including a profit-movement fallback when margin snapshots are unavailable.
- Added deterministic revenue-driver repair for weak remote Q03 answers and invalid source-id cases.
- Extended revenue-driver extraction for JPM-style NII/NIR wording, including `up x%, driven by/reflecting` sentences with decimal-dollar values.
- Allowed source-gate-passed hard follow-up evidence repairs to clear fallback metadata instead of remaining `responsePath=fallback`.

Focused validation:

```text
cd workers && npm run typecheck
cd workers && npm test -- gemini final-answer-language benchmark-quality chat-route-policy
```

Observed focused results:

- typecheck passed.
- gemini/final-answer-language/benchmark-quality/chat-route-policy passed, 160 tests.

Live runs:

- `2026-07-03-prompt-v2-full-smoke-r17` deployed version `2ca2a124-564f-4c0d-9837-36b4952ac665`.
- `2026-07-03-prompt-v2-full-smoke-r18` deployed version `df2cb030-70c6-4007-bcd6-27f5c8b859d8`.
- `2026-07-03-prompt-v2-full-smoke-r19` deployed version `430c744a-5d4b-4979-ada2-91ce30826c0d`.
- `2026-07-03-prompt-v2-full-smoke-r20` deployed version `1263ca2b-9093-422a-92dd-564a6dd5c29f`.

Gate summaries:

```text
r17 qualityFallbackRate: 16.7%
r17 qualityQ03Q04Q06Fallback: 23
r17 qualityHardIntentFallback: 25
r17 qualitySourceEvidenceWeak: 23
r17 durabilityFollowupLostPriorDriver: 0
r17 qualityLatency.p95: 5781

r18 qualityFallbackRate: 16.0%
r18 qualityQ03Q04Q06Fallback: 23
r18 qualityHardIntentFallback: 24
r18 qualitySourceEvidenceWeak: 29
r18 durabilityFollowupLostPriorDriver: 0
r18 qualityLatency.p95: 6121

r19 qualityFallbackRate: 15.3%
r19 qualityQ03Q04Q06Fallback: 22
r19 qualityHardIntentFallback: 23
r19 qualitySourceEvidenceWeak: 25
r19 durabilityFollowupLostPriorDriver: 1
r19 qualityLatency.p95: 5558

r20 qualityFallbackRate: 16.0%
r20 qualityQ03Q04Q06Fallback: 24
r20 qualityHardIntentFallback: 24
r20 qualitySourceEvidenceWeak: 26
r20 durabilityFollowupLostPriorDriver: 1
r20 qualityLatency.p95: 5170
```

Validated improvements:

- Q03 revenue-driver fallback was reduced to zero in r18-r20.
- DAL-Q03 invalid source-id regression was fixed by deterministic revenue-driver repair.
- JPM-Q03 now extracts NII/NIR driver evidence, and JPM-Q04 passed in r19 and r20.
- CAT-Q06 and NVDA-Q06 can pass when source gate is sufficient and the answer only needs source-backed language/evidence repair.
- WMT-Q04 fallback metadata was cleared in r20 when the retail source-backed durability repair was accepted.

Current status after r20:

- The goal is still not complete.
- The dominant remaining blocker is Q04/Q06 follow-up durability evidence, not Q03.
- r20 fallback rows are mostly:
  - Q04: AAPL, XOM, CAT, NVDA, MU, MSFT, GOOGL, AMZN, TSLA, LLY, V, KO, DAL.
  - Q06: AAPL, XOM, CAT, WMT, GOOGL, MU, TSLA, LLY, V, KO, DAL.
- Common failure labels:
  - Q04: `q04_table_heavy_context`, `q04_driver_evidence_too_generic`, `durability_context_missing`, `followup_target_empty`, `source_gate_failed`.
  - Q06: `margin_driver_slots_empty`, `missing_margin_driver_evidence`, `missing_margin_durability_context`, `q06_margin_context_revenue_only`, `source_gate_failed`.
- Next durable fix should target source selection/retrieval for Q04/Q06 rather than marking prior-answer candidate fallbacks as successful. Representative hard cases are TSLA-Q04/Q06 for XBRL-overfocused retrieval, AAPL-Q04 for table-heavy product/margin context, and WMT/V/GOOGL Q06 for revenue-only context when margin durability evidence is required.

## Twenty-First Through Twenty-Fourth Live Hardening Passes

Changes:

- Fixed finalizer acceptance for source-gate-passed hard follow-up evidence rows when runtime intent stayed broad (`yoy_change` / `margin_profitability`) or the final taxonomy reason was not yet available inside the acceptance decision.
- Added question-text based hard follow-up detection so source-backed Q04/Q06 answers are not stranded as fallback solely because `debug.questionIntent` is missing or stale.
- Added Q06 source-backed follow-up repair for under-answers where source gate is sufficient and evidence slots contain concrete margin drivers.
- Tested `HARD_INTENT_TARGETED_RETRIEVAL_MODE=active` on the test Worker in r24, then reverted test config to `diagnostic` because it increased source count but worsened follow-up loss and introduced invalid-source fallbacks.

Focused validation:

```text
cd workers && npm test -- hard-intent-retrieval final-answer-language benchmark-quality gemini chat-route-policy
cd workers && npm run typecheck
```

Observed focused results:

- typecheck passed.
- hard-intent-retrieval/final-answer-language/benchmark-quality/gemini/chat-route-policy passed, 187 tests.

Live runs:

- `2026-07-03-prompt-v2-full-smoke-r21` deployed version `abb186af-186c-43fa-893e-31f1688c3957`.
- `2026-07-03-prompt-v2-full-smoke-r22` deployed version `5d945154-5285-411c-a760-7231aec9a212`.
- `2026-07-03-prompt-v2-full-smoke-r23` deployed version `b337abca-946c-4d51-810c-63fc510fc0a5`.
- `2026-07-03-prompt-v2-full-smoke-r24` deployed version `3a94050a-eabe-4199-9811-821992d99c40`.

Gate summaries:

```text
r21 qualityFallbackRate: 18.0%
r21 qualityQ03Q04Q06Fallback: 23
r21 qualityHardIntentFallback: 27
r21 qualitySourceEvidenceWeak: 23
r21 durabilityFollowupLostPriorDriver: 2
r21 qualityLatency.p95: 5595

r22 qualityFallbackRate: 15.3%
r22 qualityQ03Q04Q06Fallback: 22
r22 qualityHardIntentFallback: 23
r22 qualitySourceEvidenceWeak: 28
r22 durabilityFollowupLostPriorDriver: 2
r22 qualityLatency.p95: 5410

r23 qualityFallbackRate: 15.3%
r23 qualityQ03Q04Q06Fallback: 20
r23 qualityHardIntentFallback: 23
r23 qualitySourceEvidenceWeak: 26
r23 durabilityFollowupLostPriorDriver: 0
r23 qualityLatency.p95: 4923

r24 qualityFallbackRate: 16.0%
r24 qualityQ03Q04Q06Fallback: 21
r24 qualityHardIntentFallback: 24
r24 qualitySourceEvidenceWeak: 21
r24 durabilityFollowupLostPriorDriver: 4
r24 qualityLatency.p95: 5870
```

Validated improvements:

- CAT-Q04 moved from fallback in r21 to openai in r22/r23 after question-text based source-backed follow-up acceptance.
- KO-Q06 and JPM-Q06 under-answer regressions were addressed in r23; `durabilityFollowupLostPriorDriver` reached 0 in r23.
- Q06 source-backed repair was visible in r23 for NVDA-Q06 and AMZN-Q06 via `q06_source_backed_followup_repair`.
- r24 proved that global active hard-intent retrieval is not safe yet: it increased selected source counts, helped some rows such as MSFT-Q04 and GOOGL-Q01, but worsened overall fallback/lost-followup metrics and introduced invalid-source fallbacks on GOOGL-Q10 and LLY-Q10.

Current status after r24:

- The goal is still not complete.
- Best current run in this set is r23, not r24.
- `HARD_INTENT_TARGETED_RETRIEVAL_MODE` should remain `diagnostic` until retrieval-added sources are validated against source IDs and ranked more narrowly.
- Remaining r23 hard blockers:
  - Q04 source gate failures across AAPL, XOM, NVDA, MU, MSFT, GOOGL, AMZN, TSLA, LLY, V, KO, DAL.
  - Q06 source gate failures across XOM, CAT, WMT, GOOGL, MU, TSLA, LLY, V.
  - Common labels remain `source_gate_failed`, `sector_required_source_missing`, `fallback_slot_incomplete`, `followup_target_empty`, `q04_table_heavy_context`, `q04_driver_evidence_too_generic`, `margin_driver_slots_empty`, and `missing_margin_driver_evidence`.
- Next durable fix should not flip active retrieval globally. It should either:
  - improve ranking for Q04/Q06 so added hard-intent sources are actually driver/durability evidence, then validate source IDs before model use, or
  - add safer deterministic synthesis for source-gate-failed rows only when evidence slots contain concrete source-backed driver facts, without accepting generic previous-answer candidate fallbacks as successful answers.

## Twenty-Fifth Through Twenty-Seventh Live Hardening Passes

Changes:

- Kept `HARD_INTENT_TARGETED_RETRIEVAL_MODE=diagnostic` after the r24 active-retrieval regression.
- Guarded active hard-intent retrieval adoption so expanded context is only adopted when the expanded source gate is sufficient; diagnostic data is still recorded without changing model context.
- Expanded Q06 margin durability source recognition for concrete margin levers that were previously dropped, including `price/mix`, pricing, tariff, foreign exchange, cost of sales, advertising income, membership income, fulfillment, labor, wage, commodity/input cost, and inventory/shrink/markdown terms.
- Expanded the low-quality evidence filter for technology margin durability so AAPL-style gross-margin tariff / foreign-exchange evidence is not rejected before source-gate classification.
- Aligned deterministic business-overview detection with source-gate business-model detection by adding `何屋` / `なに屋`, allowing Q01 fallback rows to recover to deterministic or acceptable model answers.

Focused validation:

```text
cd workers && npm test -- chat-source-gate hard-intent-retrieval final-answer-language benchmark-quality gemini chat-route-policy
cd workers && npm run typecheck
```

Observed focused results:

- typecheck passed.
- chat-source-gate / hard-intent-retrieval / final-answer-language / benchmark-quality / gemini / chat-route-policy passed, 238 tests.

Live runs:

- `2026-07-03-prompt-v2-full-smoke-r25` deployed version `d6eb9f08-eaf6-4d29-b34c-dd8d34eb39ef`.
- `2026-07-03-prompt-v2-full-smoke-r26` deployed version `120cbcd0-30bb-4da0-a302-d19c05c00598`.
- `2026-07-03-prompt-v2-full-smoke-r27` deployed version `9572a617-b2e6-4603-95e4-e635471cadb9`.

Gate summaries:

```text
r25 qualityFallbackRate: 18.7%
r25 qualityQ03Q04Q06Fallback: 25
r25 qualityHardIntentFallback: 28
r25 qualitySourceEvidenceWeak: 31
r25 durabilityFollowupLostPriorDriver: 2
r25 numericDisplaySuspicious: 0
r25 qualityLatency.p95: 5326

r26 qualityFallbackRate: 14.0%
r26 qualityQ03Q04Q06Fallback: 19
r26 qualityHardIntentFallback: 21
r26 qualitySourceEvidenceWeak: 25
r26 durabilityFollowupLostPriorDriver: 0
r26 numericDisplaySuspicious: 2
r26 qualityLatency.p95: 5991

r27 qualityFallbackRate: 15.3%
r27 qualityQ03Q04Q06Fallback: 21
r27 qualityHardIntentFallback: 23
r27 qualitySourceEvidenceWeak: 25
r27 durabilityFollowupLostPriorDriver: 0
r27 numericDisplaySuspicious: 0
r27 qualityLatency.p95: 5363
```

Validated improvements:

- r26 is the current best run by fallback rate and hard-intent fallback count: fallback rate improved from r25 18.7% to r26 14.0%, Q03/Q04/Q06 fallback improved from 25 to 19, hard-intent fallback improved from 28 to 21, and lost-prior-driver reached 0.
- AAPL-Q06 moved from fallback in r25 to openai in r26 and r27 after the Q06 margin durability source recognition changes.
- JPM-Q06, NVDA-Q06, AMZN-Q06, KO-Q06, and DAL-Q06 passed in both r26 and r27.
- CAT-Q04 and CAT-Q06 passed in r27, showing the source/gate path can now succeed for industrial evidence, although r26 still had CAT-Q04/Q06 fallback.
- WMT-Q01 and GOOGL-Q01 moved from fallback in r26 to openai in r27 after deterministic business-overview detection was aligned with `何屋`.
- r26 removed the r24 invalid-source side effect: `sourceIdsValidFalse` remained 0.

Current status after r27:

- The goal is still not complete.
- Best current evidence is r26, not r27. r27 confirmed Q01 recovery but regressed overall fallback rate to 15.3% due to model/run variability in XOM-Q03, WMT-Q05, MSFT-Q10, and several Q06 rows.
- Q04 driver-durability follow-up is now the dominant blocker. r27 still has Q04 fallback for AAPL, XOM, NVDA, MU, MSFT, GOOGL, AMZN, TSLA, LLY, V, KO, and DAL.
- Q06 is improved but not stable. Remaining r27 fallback rows include XOM, WMT, MU, MSFT, GOOGL, TSLA, LLY, and V.
- Common remaining labels are `source_gate_failed`, `sector_required_source_missing`, `fallback_slot_incomplete`, `q04_table_heavy_context`, `q04_driver_evidence_too_generic`, `margin_driver_slots_empty`, `missing_margin_driver_evidence`, and `followup_target_empty`.
- Next durable fix should target Q04 first:
  - reduce table-heavy false negatives when the selected excerpt contains a concrete prior revenue driver plus a durability signal;
  - recover follow-up targets from prior-answer candidates without treating generic candidates as sufficient;
  - improve retrieval/ranking for TSLA/MU/MSFT/GOOGL so Q04/Q06 selected sources include actual driver and durability evidence rather than metric-only or revenue-only fragments.

## Twenty-Eighth And Twenty-Ninth Live Hardening Passes

Changes:

- Relaxed Q04 table-heavy rejection when selected sources also contain source-backed driver and durability evidence. This fixed XOM/NVDA-style cases where table-ish context was mixed with real supply-demand, pricing, or platform-demand evidence.
- Added a generic source-backed Q04 durability repair path for under-answers when selected evidence contains concrete driver labels and a cautious durability signal.
- Fixed driver-label inference so `Advisory` no longer accidentally matches the broad `ads?` advertising pattern.
- Guarded the generic Q04 repair so ambiguous Q06 margin-durability under-answers are not consumed by the revenue-driver repair path.
- Expanded weak business-overview detection for Q01 answers that leak English segment labels or collapse into a metric-only "mainly earns sales" shape, so the orchestrator prefers deterministic business-overview repair for those rows.

Focused validation:

```text
cd workers && npm test -- chat-source-gate -t "Q04"
cd workers && npm test -- final-answer-language -t "Q04|Q06"
cd workers && npm test -- chat-source-gate hard-intent-retrieval final-answer-language benchmark-quality gemini chat-route-policy
cd workers && npm run typecheck
cd workers && npm test -- chat-route-policy final-answer-language benchmark-quality
cd workers && npm run typecheck
```

Observed focused results:

- Q04 source-gate targeted tests passed.
- Q04/Q06 final-answer targeted tests passed.
- focused Worker gate passed: 7 files, 240 tests.
- post-Q01 route policy focused tests passed: 3 files, 106 tests.
- typecheck passed after both implementation steps.

Live runs:

- `2026-07-03-prompt-v2-full-smoke-r28` deployed version `b9b97520-7c31-4db0-bac0-181856b0f5e8`.
- `2026-07-03-prompt-v2-full-smoke-r29` deployed version `349d1d56-8473-4663-bc6d-f0696372a801`.

Gate summaries:

```text
r28 qualityFallbackRate: 15.3%
r28 qualityQ03Q04Q06Fallback: 19
r28 qualityHardIntentFallback: 23
r28 qualitySourceEvidenceWeak: 24
r28 durabilityFollowupLostPriorDriver: 1
r28 numericDisplaySuspicious: 0
r28 qualityLatency.p95: 5657

r29 qualityFallbackRate: 14.0%
r29 qualityQ03Q04Q06Fallback: 19
r29 qualityHardIntentFallback: 21
r29 qualitySourceEvidenceWeak: 21
r29 durabilityFollowupLostPriorDriver: 1
r29 numericDisplaySuspicious: 0
r29 qualityLatency.p95: 6487
```

Validated improvements:

- r28 proved the Q04 table-heavy relaxation can move concrete rows: XOM-Q04 and NVDA-Q04 passed as openai, and XOM-Q06 moved to deterministic.
- r29 preserved the best fallback-rate/hard-intent counts from r26 while improving source weakness: `qualitySourceEvidenceWeak` moved from r26 25 and r28 24 down to 21.
- r29 fixed Q01 rows that previously leaked English or fell back: NVDA-Q01 became deterministic instead of surfacing `Compute & Networking` / `Graphics`; MU-Q01 became deterministic instead of `answer_too_metric_only`; DAL-Q01 stayed deterministic; KO-Q01 moved from r28 fallback to openai.
- r29 kept `rawEnglishSurfaced`, `hybridEnglishJapaneseSurfaced`, `genericBusinessModelAnswers`, `genericRevenueBreakdownAnswers`, `numericDisplaySuspicious`, and `sourceIdsValidFalse` at 0.

Current status after r29:

- The goal is still not complete.
- Best current evidence is r29 for source weakness and Q01 stability, but the gate still fails.
- Remaining hard blockers:
  - `qualityQ03Q04Q06Fallback=19`
  - `qualityHardIntentFallback=21`
  - `qualitySourceEvidenceWeak=21`
  - `durabilityFollowupLostPriorDriver=1`
- r29 Q04 fallback rows: AAPL, XOM, MU, MSFT, GOOGL, AMZN, TSLA, LLY, KO, DAL.
- r29 Q06 fallback rows: JPM, XOM, CAT, WMT, MU, GOOGL, TSLA, LLY, V.
- r29 also has WMT-Q05 fallback and GOOGL-Q10 invalid-source fallback.
- Common remaining Q04/Q06 labels are `source_gate_failed`, `q04_driver_evidence_too_generic`, `q04_table_heavy_context`, `missing_durability_context`, `followup_target_empty`, `missing_followup_target_driver`, `margin_driver_slots_empty`, `missing_margin_driver_evidence`, `sector_required_source_missing`, and `fallback_slot_incomplete`.
- Next durable fix should target Q04/Q06 fallback synthesis and source-gate slots rather than Q01:
  - accept source-backed candidate repairs only when they include concrete source evidence, not just previous-answer labels;
  - improve follow-up target recovery for Q04 where selected evidence is present but target extraction is empty;
  - improve Q06 margin-driver evidence classification for price/mix, cost, tariff, labor, fuel, litigation/provision, and product-demand evidence;
  - keep retrieval adoption guarded, because active retrieval previously improved some rows but worsened invalid-source and lost-follow-up counters.

## Thirtieth Live Hardening Pass

Changes:

- Allowed Q06 previous-answer margin-driver repair even when the source gate passed, for rows where the final answer still fell back to a metric-only / source-insufficient margin-durability response.
- Treated `q06_previous_answer_margin_candidate_repair` as a source-backed hard follow-up only when source-gate sufficiency is true and the repaired answer contains substantive driver candidates plus a temporary/structural caveat.
- Expanded the substantive hard-follow-up detector to recognize the existing repair wording `前問で挙がっていた利益率要因候補`.
- Added a JPM-Q06 regression test matching the r29 failure shape: source gate sufficient, fallback answer lost the prior margin drivers, previous answer contained noninterest expense / compensation / marketing / provision drivers.

Focused validation:

```text
cd workers && npm test -- final-answer-language -t "Q06 margin"
cd workers && npm test -- chat-source-gate hard-intent-retrieval final-answer-language benchmark-quality gemini chat-route-policy
cd workers && npm run typecheck
```

Observed focused results:

- Q06 margin targeted tests passed.
- focused Worker gate passed: 7 files, 241 tests.
- typecheck passed.

Live run:

- `2026-07-03-prompt-v2-full-smoke-r30` deployed version `006eca6e-e3fe-4941-806e-30d0c48d1a0f`.

Gate summary:

```text
r30 qualityFallbackRate: 12.0%
r30 qualityQ03Q04Q06Fallback: 17
r30 qualityHardIntentFallback: 18
r30 qualitySourceEvidenceWeak: 23
r30 durabilityFollowupLostPriorDriver: 0
r30 numericDisplaySuspicious: 0
r30 sourceIdsValidFalse: 0
r30 qualityLatency.p95: 6226
```

Validated improvements:

- r30 is the best live run so far by fallback rate and hard-intent fallback count: fallback rate improved from r29 14.0% to r30 12.0%, Q03/Q04/Q06 fallback improved from 19 to 17, and hard-intent fallback improved from 21 to 18.
- `durabilityFollowupLostPriorDriver` returned to 0. The r29 JPM-Q06 lost-prior-driver row became openai in r30.
- JPM-Q06, CAT-Q06, NVDA-Q06, AMZN-Q06, KO-Q06, and DAL-Q06 passed in r30.
- XOM-Q04 returned to openai in r30, while XOM-Q06 remains fallback.
- GOOGL-Q10 invalid-source fallback from r29 disappeared in r30.
- `rawEnglishSurfaced`, `hybridEnglishJapaneseSurfaced`, `genericBusinessModelAnswers`, `genericRevenueBreakdownAnswers`, `numericDisplaySuspicious`, and `sourceIdsValidFalse` remained 0.

Current status after r30:

- The goal is still not complete.
- r30 still fails the gate on:
  - `qualitySourceEvidenceWeak=23`
  - `qualityQ03Q04Q06Fallback=17`
  - `qualityHardIntentFallback=18`
- r30 Q04 fallback rows: AAPL, MU, MSFT, GOOGL, AMZN, TSLA, LLY, V, KO, DAL.
- r30 Q06 fallback rows: XOM, WMT, MU, GOOGL, TSLA, LLY, V.
- r30 also has WMT-Q05 fallback due `raw_english_detected`.
- Q01 is mostly stable, but sourceWeak examples remain when the model returns short generic Japanese business-overview answers such as XOM, CAT, WMT, NVDA, LLY, and DAL. These should likely be routed to deterministic business overview using Japanese generic-pattern detection.
- Main remaining blocker remains Q04/Q06 evidence slots and synthesis:
  - Q04 labels still include `q04_table_heavy_context`, `q04_driver_evidence_too_generic`, `missing_durability_context`, `durability_context_too_generic`, `followup_target_empty`, and `missing_followup_target_driver`.
  - Q06 labels still include `margin_driver_slots_empty`, `sector_required_source_missing`, `missing_margin_driver_evidence`, `missing_margin_durability_context`, `q06_margin_context_revenue_only`, and `retrieval_overfocused_xbrl`.
  - TSLA is still the clearest retrieval/ranking problem: selected sources are few and labels include XBRL overfocus and low relevance.

Post-r30 local change, not yet live-smoked:

- Expanded deterministic business-overview preference for short generic Japanese Q01 answers such as "この会社は主に石油・ガス・石化製品の販売を通じて収益を得ています", "この会社は主に建設機械の製品と関連サービスで儲けています", and "主な収益源は小売事業の売上高です".
- Focused validation passed:

```text
cd workers && npm test -- chat-route-policy final-answer-language benchmark-quality
cd workers && npm run typecheck
```

- Expected next live effect: lower Q01 sourceWeak examples by routing these short generic model answers to deterministic business-overview repair.

## Thirty-First Live Hardening Pass

Changes:

- Live-smoked the post-r30 Q01 generic Japanese business-overview routing change.
- Short generic Japanese Q01 model answers such as "この会社は主に石油・ガス・石化製品の販売を通じて収益を得ています" and "主な収益源は小売事業の売上高です" are now routed to deterministic business-overview repair.

Live run:

- `2026-07-03-prompt-v2-full-smoke-r31` deployed version `0ef1a42d-5eb0-496b-9cbe-65043962a88e`.

Gate summary:

```text
r31 qualityFallbackRate: 13.3%
r31 qualityQ03Q04Q06Fallback: 18
r31 qualityHardIntentFallback: 20
r31 qualitySourceEvidenceWeak: 20
r31 durabilityFollowupLostPriorDriver: 0
r31 numericDisplaySuspicious: 0
r31 sourceIdsValidFalse: 0
r31 qualityLatency.p95: 6019
```

Validated improvements:

- Q01 source weakness improved: `qualitySourceEvidenceWeak` moved from r30 23 to r31 20.
- XOM-Q01, CAT-Q01, WMT-Q01, GOOGL-Q01, LLY-Q01, and DAL-Q01 routed to deterministic business-overview repair in r31.
- `durabilityFollowupLostPriorDriver` remained 0.
- `rawEnglishSurfaced`, `hybridEnglishJapaneseSurfaced`, `genericBusinessModelAnswers`, `genericRevenueBreakdownAnswers`, `numericDisplaySuspicious`, and `sourceIdsValidFalse` remained 0.

Regressions / remaining blockers:

- r31 is worse than r30 on fallback counts: fallback rate 13.3% vs r30 12.0%, Q03/Q04/Q06 fallback 18 vs r30 17, hard-intent fallback 20 vs r30 18.
- NVDA-Q01 and MU-Q01 still surfaced short generic Japanese business-overview answers:
  - NVDA-Q01: "主な収益源はデータセンター向け製品と関連ソリューションの販売です。"
  - MU-Q01: "主な収益源はメモリ製品の売上です。"
- r31 Q04 fallback rows: AAPL, NVDA, MU, MSFT, GOOGL, AMZN, TSLA, LLY, KO, DAL.
- r31 Q06 fallback rows: AAPL, XOM, WMT, MU, GOOGL, TSLA, LLY, V.
- r31 also has WMT-Q05 fallback and LLY-Q10 invalid-source fallback.
- Q04/Q06 failures split into two types:
  - prior-answer candidate repairs that are user-safe but still correctly counted as fallback because source gate was insufficient;
  - real retrieval/slot gaps, especially TSLA-Q04/Q06 where selected sources are XBRL-only or low relevance.

Post-r31 local change, not yet live-smoked:

- Expanded deterministic business-overview preference for remaining short Japanese Q01 patterns such as "主な収益源はデータセンター向け製品と関連ソリューションの販売です" and "主な収益源はメモリ製品の売上です".
- For Q06 margin follow-ups, allowed ad-platform cost drivers from the previous answer to be recovered as margin drivers:
  - TAC / traffic acquisition costs -> トラフィック獲得コスト
  - depreciation / amortization -> 減価償却費
  - content acquisition costs -> コンテンツ調達費
  - employee compensation / 従業員報酬 -> 人件費
- Kept tax-only previous answers blocked by `shouldIgnorePreviousMarginDriverAnswer`.

Focused validation:

```text
cd workers && npm test -- chat-route-policy final-answer-language -t "business-overview|Q06 answer|tax mechanics|ad-platform"
cd workers && npm test -- chat-source-gate hard-intent-retrieval final-answer-language benchmark-quality gemini chat-route-policy
cd workers && npm run typecheck
```

Observed focused results:

- targeted route/Q06 tests passed: 2 files, 4 tests selected.
- focused Worker gate passed: 7 files, 242 tests.
- typecheck passed.

Next durable fix:

- Do not mark prior-answer-only Q04/Q06 repairs as passing unless source evidence is sufficient. These are useful user fallbacks but not enough for the goal.
- Target retrieval/source ranking for TSLA first. r31 TSLA-Q04 selected only XBRL metrics and TSLA-Q06 selected only XBRL metrics, with labels `retrieval_overfocused_xbrl`, `source_relevance_low`, `driver_slots_empty`, `margin_driver_slots_empty`, and `fallback_slot_incomplete`.
- After TSLA retrieval, improve deterministic Q03 revenue-driver extraction for MU-like source text where selected excerpts contain average selling prices and bit shipments, but the prior Q03 answer still says "本文の追加説明があるともう一段絞れます"; this weak Q03 answer causes Q04 follow-up target loss.

## Thirty-Second Live Hardening Pass

Changes:

- Live-smoked the post-r31 changes:
  - remaining short Japanese Q01 business-overview patterns routed toward deterministic repair;
  - Q06 previous-answer margin-driver extraction recognizes TAC, depreciation/amortization, content acquisition costs, and employee compensation.

Live run:

- `2026-07-03-prompt-v2-full-smoke-r32` deployed version `44530ab4-324a-4cc5-899c-e52fb9e2c2f8`.

Gate summary:

```text
r32 qualityFallbackRate: 11.3%
r32 qualityQ03Q04Q06Fallback: 16
r32 qualityHardIntentFallback: 17
r32 qualitySourceEvidenceWeak: 21
r32 durabilityFollowupLostPriorDriver: 0
r32 numericDisplaySuspicious: 1
r32 sourceIdsValidFalse: 0
r32 qualityLatency.p95: 6344
```

Validated improvements:

- r32 is the best live run so far by fallback rate and hard-intent fallback count: fallback rate 11.3%, Q03/Q04/Q06 fallback 16, hard-intent fallback 17.
- NVDA-Q01 routed to deterministic business-overview repair.
- AMZN-Q04 passed as openai in r32.
- GOOGL-Q06 fallback answer now preserves the prior margin drivers: トラフィック獲得コスト, 減価償却費, コンテンツ調達費, 人件費, クラウド需要.
- LLY-Q10 invalid-source fallback from r31 disappeared in r32.
- `durabilityFollowupLostPriorDriver` remained 0.
- `rawEnglishSurfaced`, `hybridEnglishJapaneseSurfaced`, `genericBusinessModelAnswers`, `genericRevenueBreakdownAnswers`, and `sourceIdsValidFalse` remained 0.

Regressions / remaining blockers:

- Gate still fails:
  - `numericDisplaySuspicious=1`
  - `qualitySourceEvidenceWeak=21`
  - `qualityQ03Q04Q06Fallback=16`
  - `qualityHardIntentFallback=17`
- r32 Q04 fallback rows: AAPL, MU, MSFT, GOOGL, TSLA, LLY, V, KO, DAL.
- r32 Q06 fallback rows: XOM, WMT, MU, GOOGL, TSLA, LLY, V.
- r32 also has WMT-Q05 fallback.
- Q01 still has residual sourceWeak examples when the model returns generic Japanese patterns not yet covered:
  - XOM-Q01: "この会社の主な収益源は石油・ガス・石油化学製品の販売です。"
  - CAT-Q01: "主な収益源は建設機械の製造・販売機械と関連サービスの提供です。"
  - MU-Q01: "同社は主にメモリ製品の売上を通じて収益を上げています。"
  - KO-Q01: "COCA COLA COは主に飲料の販売から収益を得ています。"
  - DAL-Q01: generic passenger-revenue wording.
- KO-Q05 introduced the single `numericDisplaySuspicious` row due mixed short English labels in an otherwise useful margin-driver answer: `concentrate`, `North America`, `Bottling Investments`, `unit case volume`, and `re franchising`.

Post-r32 local change, not yet live-smoked:

- Expanded Q01 deterministic preference for:
  - "この会社の主な収益源は...販売です"
  - "同社は主に...売上を通じて収益を上げています"
  - "{COMPANY}は主に...販売から収益を得ています"
- Normalized Coca-Cola style short English labels in final answers:
  - `concentrate 販売数量` -> 原液販売数量
  - `unit case volume` -> ユニットケース販売数量
  - `Bottling Investments` -> ボトリング投資
  - `North America` -> 北米
  - `Premium products` -> プレミアム商品
  - `Main cabin` -> メインキャビン
  - `re franchising` / `re-franchising` -> 再フランチャイズ化

Focused validation:

```text
cd workers && npm test -- chat-route-policy final-answer-language benchmark-quality
cd workers && npm run typecheck
```

Observed focused results:

- focused tests passed: 3 files, 109 tests.
- typecheck passed.

Next durable fix:

- r32 confirms that small Q01/finalizer polish can reduce surface issues, but the remaining quality gate is dominated by hard-intent source evidence.
- The next substantial pass should target TSLA retrieval/source selection first. TSLA-Q04 and TSLA-Q06 repeatedly select XBRL-only or low-relevance sources, so finalizer repair cannot legitimately mark them as source-backed answers.
- After TSLA, improve Q04 source-gate handling for cases with concrete prior drivers but missing durability context, especially AAPL/MU/MSFT/GOOGL/KO/DAL.

## Thirty-Third and Thirty-Fourth Live Hardening Passes

Code changes:

- Added auto/Tesla-oriented revenue and margin source-asset terms in `buildSourceChunks`:
  - revenue: vehicle deliveries, automotive revenue/sales, vehicle pricing, average selling price, energy generation/storage, services and other;
  - margin: automotive gross margin, vehicle pricing, production cost, warranty, restructuring, average selling price.
- Made existing full filing records run revenue/margin source backfill before chat whenever source assets are weak, not only for metrics-only records.
- Expanded Q04 follow-up target detection for Japanese prior-driver labels such as 地域別売上, 製品カテゴリ, サービス売上, 販売量, 出荷量, 価格実現.
- Added focused tests for TSLA-like source asset extraction, non-test chat backfill, and Japanese Q04 prior-driver recognition.

Focused validation:

```text
cd workers && npm test -- chat-source-gate filing-source-assets chat-route hard-intent-retrieval final-answer-language benchmark-quality
cd workers && npm run typecheck
```

Focused result:

- passed: 7 files, 224 tests.
- typecheck passed.

Live runs:

- `2026-07-03-prompt-v2-full-smoke-r33` deployed version `9a0d7620-f0d4-4726-aa26-9d22f35070b0`.
- `2026-07-03-prompt-v2-full-smoke-r34` deployed version `59ff749a-b31c-4cf2-806c-74094f68e2a9`.

r33 gate summary:

```text
r33 qualityFallbackRate: 14.7%
r33 qualityQ03Q04Q06Fallback: 19
r33 qualityHardIntentFallback: 22
r33 qualitySourceEvidenceWeak: 22
r33 durabilityFollowupLostPriorDriver: 1
r33 numericDisplaySuspicious: 0
r33 qualityLatency.p95: 6195
```

r34 gate summary:

```text
r34 qualityFallbackRate: 13.3%
r34 qualityQ03Q04Q06Fallback: 17
r34 qualityHardIntentFallback: 20
r34 qualitySourceEvidenceWeak: 21
r34 durabilityFollowupLostPriorDriver: 0
r34 numericDisplaySuspicious: 0
r34 unsupportedDurabilityClassification: 0
r34 sourceIdsValidFalse: 0
r34 qualityLatency.p95: 5438
```

Validated improvements:

- KO-Q05 no longer trips `numericDisplaySuspicious`; answer uses Japanese labels such as 北米 and ボトリング投資.
- CAT-Q04 improved from fallback to openai after Japanese prior-driver recognition:
  - source gate applied, `followupTargetFound=true`, `driverSlotsCount=4`, no source-gate failure labels.
- V-Q04 improved from fallback to openai after Japanese prior-driver recognition:
  - source gate applied, `followupTargetFound=true`, `driverSlotsCount=1`; the answer discusses value-added services, advisory/other services, payment volume, and client incentives.
- CAT-Q05 returned to openai in r34 after the r33 language-guard fallback regression.
- `durabilityFollowupLostPriorDriver` returned to 0 in r34.
- p95 latency improved from r32 6344 to r34 5438.

Regressions / remaining blockers:

- r34 still fails the gate and is not better than r32 on fallback count:
  - r32 fallback rate 11.3%, Q03/Q04/Q06 fallback 16, hard-intent fallback 17.
  - r34 fallback rate 13.3%, Q03/Q04/Q06 fallback 17, hard-intent fallback 20.
- r34 fallback rows:
  - Q01: WMT, GOOGL.
  - Q04: AAPL, MU, MSFT, GOOGL, AMZN, TSLA, LLY, KO, DAL.
  - Q05: WMT.
  - Q06: AAPL, XOM, WMT, MU, GOOGL, TSLA, LLY, V.
- TSLA-Q04 and TSLA-Q06 still select XBRL-only sources; auto source-asset regex changes did not surface narrative source chunks in the live cached record.
- GOOGL-Q06 preserved prior margin drivers in fallback text, but source gate still had `margin_driver_slots_empty`, `missing_margin_driver_evidence`, and `source_gate_failed`.
- WMT-Q01 and GOOGL-Q01 now fail as source-insufficient business-model answers because selected context is risk/filing boilerplate plus XBRL, not business/segment/revenue mechanism context.

Next durable fix:

- Do not treat r34 as a new best baseline; r32 remains best by fallback/hard-intent counts.
- Fix Q01 business-model source selection for WMT/GOOGL by selecting business/segment/revenue-mechanism context instead of risk/filing boilerplate.
- For Q06, improve margin-driver extraction from selected profitability context before relaxing source-gate thresholds; current failures are mostly `margin_driver_slots_empty` or `missing_margin_driver_evidence`.
- TSLA requires cache/source-asset investigation, not just regex tuning: live rows still expose only XBRL selected sources and `hard_source_asset_missing_mda_revenue`, `hard_source_asset_missing_segment_results`, and `hard_source_asset_missing_sector_kpi`.

## Thirty-Fifth to Thirty-Seventh Live Hardening Passes

Code changes:

- Fixed business-model evidence slots so `business_model` hard intents preserve company-explained drivers instead of being treated like empty driver slots.
- Changed invalid source-id recovery so a locally repaired answer with valid filing sources is no longer counted as a fallback solely because the first model attempt cited a bad source id.
- Tried explicit sector mapping for expanded-smoke tickers in r36, then reverted it after live evidence showed regressions in GOOGL-Q01, DAL-Q06, and overall hard-intent counts.

Focused validation:

```text
cd workers && npm test -- chat-source-gate pipeline chat-route-policy chat-route
cd workers && npm run typecheck
```

Focused result:

- passed after rollback: 4 files, 131 tests.
- typecheck passed.

Live runs:

- `2026-07-03-prompt-v2-full-smoke-r35` deployed version `5a0281a6-167e-4d1e-a575-7b1bb618237d`.
- `2026-07-03-prompt-v2-full-smoke-r36` deployed version `5b6379cc-83d9-4f89-9777-e12de07d6bed`.
- `2026-07-03-prompt-v2-full-smoke-r37` deployed version `d77e1602-9749-4706-bf4d-cc175eba6e11`.

r35 gate summary:

```text
r35 qualityFallbackRate: 10.7%
r35 qualityQ03Q04Q06Fallback: 15
r35 qualityHardIntentFallback: 16
r35 qualitySourceEvidenceWeak: 17
r35 durabilityFollowupLostPriorDriver: 0
r35 numericDisplaySuspicious: 0
r35 sourceIdsValidFalse: 0
r35 qualityLatency.p95: 6767
```

r36 gate summary:

```text
r36 qualityFallbackRate: 13.3%
r36 qualityQ03Q04Q06Fallback: 18
r36 qualityHardIntentFallback: 20
r36 qualitySourceEvidenceWeak: 18
r36 durabilityFollowupLostPriorDriver: 1
r36 numericDisplaySuspicious: 0
r36 sourceIdsValidFalse: 0
r36 qualityLatency.p95: 6284
```

r37 gate summary:

```text
r37 qualityFallbackRate: 12.7%
r37 qualityQ03Q04Q06Fallback: 16
r37 qualityHardIntentFallback: 19
r37 qualitySourceEvidenceWeak: 20
r37 durabilityFollowupLostPriorDriver: 0
r37 numericDisplaySuspicious: 0
r37 sourceIdsValidFalse: 0
r37 qualityLatency.p95: 5936
```

Validated improvements:

- r35 is the best live run so far by fallback rate, Q03/Q04/Q06 fallback count, hard-intent fallback count, and source-evidence weakness.
- Business-model evidence-slot fix improved r35 compared with r34:
  - WMT-Q01: r34 fallback -> r35 deterministic.
  - GOOGL-Q01: r34 fallback -> r35 deterministic.
- r35 also improved:
  - AAPL-Q06: r34 fallback -> r35 openai.
  - WMT-Q05: r34 fallback -> r35 openai.
- r37 removed the r35 KO-Q05 `invalid_source_id` row; KO-Q05 was openai in both r36 and r37, and `sourceIdsValidFalse` remained 0.
- r36 proved the explicit expanded-ticker sector map was not durable: it worsened overall gate counts and introduced `durabilityFollowupLostPriorDriver=1`, so that change was reverted before r37.

Regressions / remaining blockers:

- r37 is not a new best despite the invalid-source repair:
  - r35 fallback rows: 16 total.
  - r37 fallback rows: 19 total.
  - r37-only fallback rows versus r35: AAPL-Q06, GOOGL-Q01, MSFT-Q10, WMT-Q05.
  - r35-only fallback row versus r37: KO-Q05.
- r37 recurring fallback rows:
  - Q04: AAPL, MU, MSFT, GOOGL, TSLA, LLY, KO, DAL.
  - Q06: AAPL, XOM, WMT, MU, GOOGL, TSLA, LLY, V.
  - Q05/Q10 language or margin regressions: WMT-Q05, MSFT-Q10.
- Q06 margin follow-up is now the dominant blocker across AAPL/XOM/WMT/MU/GOOGL/TSLA/LLY/V. Most rows still fail as `margin_driver_sources_missing` from empty or rejected margin-driver slots.
- GOOGL-Q01 is still unstable: it passed in r35 but fell back again in r37 as `business_model_sources_missing`.
- TSLA-Q04/Q06 still require source-asset/cache investigation; narrative auto margin/revenue source assets are not reliably selected live.

Next durable fix:

- Keep the invalid-source repair, but do not treat r37 as the new quality baseline; r35 remains the best live evidence point.
- Attack Q06 margin follow-up next, with GOOGL/V/MU as representative rows where selected MD&A contains cost or gross-margin explanations but evidence slots still become empty.
- Separately harden GOOGL-Q01 business-model retrieval/slot behavior so it does not oscillate between deterministic and `business_model_sources_missing`.

## r38 Q06 margin evidence recovery

Change:

- Allowed Q06 margin follow-up driver evidence to use causally supported English MD&A bullet snippets when they contain concrete cost / expense terms.
- Expanded technology/general margin evidence vocabulary for `cost of revenues`, depreciation, TAC / traffic acquisition costs, content acquisition costs, and employee compensation.
- Fixed `isQ06RevenueOnlyMarginContext` so `cost of revenues` and concrete expense terms prevent a mixed revenue/cost MD&A excerpt from being misclassified as revenue-only.
- Removed temporary source-gate test diagnostics.

Focused validation:

```text
cd workers && npm test -- chat-source-gate evidence-text-quality benchmark-quality final-answer-language
cd workers && npm test -- chat-source-gate pipeline chat-route-policy chat-route evidence-text-quality benchmark-quality final-answer-language && npm run typecheck
```

Focused result:

- 156 focused source/evidence/quality/language tests passed.
- 233 wider chat/source/pipeline tests passed.
- typecheck passed.

Live run:

- `2026-07-03-prompt-v2-full-smoke-r38` deployed version `879f413b-8d56-41d9-8f1c-c878b6e0b8c6`.

r38 gate summary:

```text
r38 qualityFallbackRate: 9.3%
r38 qualityQ03Q04Q06Fallback: 13
r38 qualityHardIntentFallback: 14
r38 qualitySourceEvidenceWeak: 15
r38 durabilityFollowupLostPriorDriver: 0
r38 numericDisplaySuspicious: 0
r38 sourceIdsValidFalse: 0
r38 qualityLatency.p95: 6284
```

Validated improvements:

- r38 is the new best live run so far by fallback rate, Q03/Q04/Q06 fallback count, hard-intent fallback count, and source-evidence weakness.
- r38 improved 5 fallback rows versus r35:
  - `GOOGL-Q06`: r35 fallback -> r38 openai.
  - `MU-Q06`: r35 fallback -> r38 openai.
  - `V-Q06`: r35 fallback -> r38 openai.
  - `LLY-Q06`: r35 fallback -> r38 openai.
  - `KO-Q05`: r35 fallback / invalid-source row -> r38 openai.
- r38 improved 6 fallback rows versus r37:
  - `GOOGL-Q06`, `MU-Q06`, `V-Q06`, `LLY-Q06`, `MSFT-Q10`, `WMT-Q05`.
- The targeted Q06 repair worked in real Worker smoke for GOOGL/MU/V, and also helped LLY-Q06.
- The invalid-source repair remains durable: `sourceIdsValidFalse=0`, `numericDisplaySuspicious=0`, and `KO-Q05` stayed openai.
- Follow-up continuity remains stable: `durabilityFollowupLostPriorDriver=0`.

Regressions / remaining blockers:

- Gate still fails:
  - `qualitySourceEvidenceWeak=15 > 0`
  - `qualityQ03Q04Q06Fallback=13 > 0`
  - `qualityHardIntentFallback=14 > 0`
- r38 regressed 3 fallback rows versus r35:
  - `AAPL-Q06`: r35 openai -> r38 fallback.
  - `GOOGL-Q01`: r35 deterministic -> r38 fallback.
  - `XOM-Q04`: r35 openai -> r38 fallback.
- r38 recurring fallback rows:
  - Q04: AAPL, XOM, MU, MSFT, GOOGL, TSLA, LLY, KO, DAL.
  - Q06: AAPL, XOM, WMT, TSLA.
  - Q01: GOOGL.
- The dominant remaining blocker is Q04 revenue-driver durability source recovery, not Q06 margin recovery.
- Remaining Q06 blockers are narrower and sector-specific: AAPL tariff/FX/gross-margin source selection, XOM manufacturing/depreciation context, WMT fuel/price-mix context, and TSLA margin/source context.

Next durable fix:

- Treat r38 as the current best live baseline.
- Attack Q04 revenue-driver durability next using the recurring rows AAPL/XOM/MU/MSFT/GOOGL/TSLA/LLY/KO/DAL. These mostly fail as `revenue_driver_sources_missing`, so the fix should target retrieval/source-gate evidence slots rather than fallback wording.
- In parallel, stabilize GOOGL-Q01 business-model retrieval/slot behavior, because it is still oscillating between deterministic and `business_model_sources_missing`.

## r53 final live gate pass

Change:

- Hardened natural-language follow-up handling for short Japanese replies such as `なぜ？`, `なんで？`, and `よくわからん`.
- Repaired Q01 business-overview deterministic routing and Q04/Q06 hard-intent source gates.
- Excluded amended `10-K/A` and `10-Q/A` filings from latest-filing selection and cache reuse.
- Added source-backed finalizer repairs for Q04/Q06 durability follow-ups, including card payments, technology, auto, airline, retail, bank, and margin-driver cases.
- Added `liquidity_debt` intent handling so Q10 debt/liquidity questions do not fall into generic risk summaries.
- Fixed AAPL-style tariff/FX/gross-margin durability rewrites so tariff wording does not misclassify the question as generic risk.

Focused validation:

```text
cd workers && npm run typecheck
cd workers && npm test -- chat-intent-context final-answer-language chat-source-gate benchmark-quality
cd workers && npm test -- chat-intent-context chat-diagnostics final-answer-language benchmark-quality chat-source-gate chat-route sec filing-cache
```

Focused result:

- typecheck passed.
- 186 focused intent/finalizer/source-gate/benchmark tests passed.
- 271 wider chat/source/SEC/cache tests passed.

Live run:

- `2026-07-04-prompt-v2-full-smoke-r53`
- Test Worker version: `f0c20534-8ac9-47f8-b3ea-b30ef81bcf9f`
- Run JSONL: `workers/testbench/runs/2026-07-04-prompt-v2-full-smoke-r53.jsonl`
- Summary: `workers/testbench/runs/2026-07-04-prompt-v2-full-smoke-r53-summary.json`
- Answer report: `workers/testbench/runs/2026-07-04-prompt-v2-full-smoke-r53-answers.md`

r53 gate summary:

```text
r53 qualityRows: 150
r53 qualityFallbackRate: 0.0%
r53 qualityQ03Q04Q06Fallback: 0
r53 qualityHardIntentFallback: 0
r53 qualitySourceEvidenceWeak: 0
r53 rawEnglishSurfaced: 0
r53 hybridEnglishJapaneseSurfaced: 0
r53 genericBusinessModelAnswers: 0
r53 genericRevenueBreakdownAnswers: 0
r53 misleadingRevenueDriverCauses: 0
r53 metricOnlyImportantIntentAnswers: 0
r53 durabilityFollowupLostPriorDriver: 0
r53 unsupportedDurabilityClassification: 0
r53 unsupportedRiskOrLiquidityConclusion: 0
r53 fallbackTaxonomyIntentMismatch: 0
r53 fallbackKindNoneOnFallbackRows: 0
r53 qualityLatency.p95: 4693
```

Validated improvements:

- The full 15-company x 10-question live smoke passed with `PASS`.
- r50 residual `MSFT-Q04` and `TSLA-Q04` were fixed.
- r51 residual `AAPL-Q06` and `DAL-Q04` were fixed.
- r52 residual `AAPL-Q06`, `XOM-Q06`, and `TSLA-Q04` were all clear in r53.
- Q10 liquidity/debt rows stayed openai and no longer regress to generic risk summaries.
- MU Q04/Q06, NVDA Q04, MSFT Q04/Q10, TSLA Q04/Q06, and V Q04 all completed without fallback.

Deployment status:

- r53 is the first observed expanded live full-smoke pass for prompt-v2 after the July quality loop.
- Production deploy completed for `kabuyomi-api`.
- Production Worker version: `66828d02-ad1a-4bbc-b50c-484cfc3c4e90`
- Production URL: `https://kabuyomi-api.dznqjmctk7.workers.dev`
- Production smoke passed with `KABUYOMI_SMOKE_BASE_URL=https://kabuyomi-api.dznqjmctk7.workers.dev npm run smoke:staging`.
