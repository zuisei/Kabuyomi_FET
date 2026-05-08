# Kabuyomi v1.1 Minimal Core 60 Model A/B Human Review Packet

Date: 2026-05-07

Branch: `v1.1-worker-quality-token-retrieval`

HEAD at run start: `ce53df0`

## Executive Summary

This packet reviews the controlled Minimal Core 60 A/B benchmark:

- Config A: `gpt-5-nano` + reasoning effort `low`
- Config B: `gpt-5.4-nano` + reasoning effort `none`

Overall proposed verdict: `KEEP GPT-5-NANO LOW`

Config B is faster and uses fewer completion tokens, but it costs more and regresses Q03 revenue-driver behavior on XOM and WMT.

## Overall Review Status

Human review is useful for several rows, especially AAPL-Q06, but the model-config decision does not require switching to Config B.

Primary recommendation:

- Keep Config A as the branch default candidate.
- Do not switch to Config B based on this run.
- If Config B is revisited, rerun a Q03-focused review first.

## Critical Failure Check

| Check | Config A | Config B | Status |
| --- | ---: | ---: | --- |
| `sourceIdsValid=false` | 0 | 0 | Pass |
| `rawEnglishInAnswer` | 0 | 0 | Pass |
| `rawEnglishSurfaced` | 0 | 0 | Pass |
| Visible malformed currency | 0 | 0 | Pass |
| Provider/server errors | 1 | 0 | AAPL-Q01 excluded from row quality comparison |
| Rate-limit rows | 0 | 0 | Pass |
| Unsupported investment advice / forecast / price target | not observed | not observed | Pass by available diagnostics |

Diagnostic note:

- Config A had one `malformed_currency_detected` warning on AAPL-Q05, but no user-visible malformed-currency label was present.

## Review Queue

Rows included because they are Q03/Q04/Q06, changed response path, had >25% token delta, had infra contamination, or had a critical-looking diagnostic warning.

| Row | Class | A path/reason | B path/reason | Review trigger |
| --- | --- | --- | --- | --- |
| AAPL-Q01 | `cannot_compare_due_to_infra` | fallback / `gemini_api_error` | openai | path changed; infra |
| AAPL-Q03 | `A_better` | openai | openai | hard-intent review |
| AAPL-Q04 | `both_safe_fallback` | fallback / `low_quality_answer` | fallback / `low_quality_answer` | hard-intent review |
| AAPL-Q05 | `B_better` | openai | openai | token -63.4%; currency detector warning on A |
| AAPL-Q06 | `B_better` | fallback / `low_quality_answer` | openai | hard-intent review; path changed |
| AAPL-Q12 | `A_better` | openai | openai | token +63.1% for B |
| CAT-Q03 | `A_better` | openai | openai | hard-intent review |
| CAT-Q04 | `tie` | openai | openai | hard-intent review |
| CAT-Q06 | `both_safe_fallback` | fallback / `low_quality_answer` | fallback / `low_quality_answer` | hard-intent review; token -26.1% |
| CAT-Q11 | `B_better` | openai | openai | token -61.1% |
| JPM-Q03 | `A_better` | openai | openai | hard-intent review |
| JPM-Q04 | `tie` | openai | openai | hard-intent review |
| JPM-Q06 | `both_safe_fallback` | fallback / `low_quality_answer` | fallback / `low_quality_answer` | hard-intent review |
| WMT-Q03 | `A_better` | openai | fallback / `low_quality_answer` | hard-intent review; path changed |
| WMT-Q04 | `tie` | openai | openai | hard-intent review |
| WMT-Q05 | `A_better` | openai | fallback / `low_quality_answer` | path changed |
| WMT-Q06 | `both_safe_fallback` | fallback / `low_quality_answer` | fallback / `low_quality_answer` | hard-intent review |
| WMT-Q08 | `B_better` | openai | openai | token -31.2% |
| WMT-Q11 | `B_better` | fallback / `low_quality_answer` | openai | path changed |
| XOM-Q03 | `A_better` | openai | fallback / `low_quality_answer` | hard-intent review; path changed |
| XOM-Q04 | `both_safe_fallback` | fallback / `low_quality_answer` | fallback / `low_quality_answer` | hard-intent review |
| XOM-Q05 | `A_better` | openai | openai | token -32.8% |
| XOM-Q06 | `both_safe_fallback` | fallback / `low_quality_answer` | fallback / `low_quality_answer` | hard-intent review |
| XOM-Q12 | `B_better` | openai | openai | token -33.5% |

## Hard-Intent Row Notes

### AAPL-Q03

Proposed verdict: `A_better`

- A and B both answer.
- A is slightly cleaner and more compact.
- B is acceptable but more verbose and less direct in its caveat.

### AAPL-Q04

Proposed verdict: `both_safe_fallback`

- Both configs produce the same safe fallback.
- This is acceptable because the prior concrete driver remains insufficient.

### AAPL-Q06

Proposed verdict: `NEEDS HUMAN REVIEW`

- A falls back safely.
- B answers using product mix, FX, tariff and gross-margin context.
- The B answer is cautious, but this row should be reviewed because prior Q06 work accepted AAPL-Q06 safe fallback when durability evidence was weak.
- Do not count this as a decisive B win without human source review.

### JPM-Q03

Proposed verdict: `A_better`

- Both answer.
- A is more concise and directly separates NII/NIR, one-time items, and persistence-review needs.
- B is acceptable but longer and more likely to need wording review.

### JPM-Q04

Proposed verdict: `tie`

- Both answer with source-backed caution.
- Both mention NII/NIR, deposits/margin pressure, fees, and one-time items.

### JPM-Q06

Proposed verdict: `both_safe_fallback`

- Both fall back with `contextual_reasoning_metric_only`.
- Safe because the model did not synthesize unsupported margin durability.

### XOM-Q03

Proposed verdict: `A_better`

- A answers.
- B falls back with `revenue_driver_declined_despite_context`.
- Since Q03 is one of the main improved hard intents for v1.1, this is a material Config B regression.

### XOM-Q04

Proposed verdict: `both_safe_fallback`

- Both fall back safely because the prior driver remains unsupported.

### XOM-Q06

Proposed verdict: `both_safe_fallback`

- Both fall back safely due to insufficient current-period energy margin/result evidence.

### CAT-Q03

Proposed verdict: `A_better`

- Both answer.
- A uses cleaner Japanese numeric scale and directly states volume increase plus unfavorable price realization.
- B is acceptable but has more raw numeric formatting.

### CAT-Q04

Proposed verdict: `tie`

- Both answer and remain cautious about inventory and price realization.
- B is longer, but not a safety failure.

### CAT-Q06

Proposed verdict: `both_safe_fallback`

- Both fall back safely.
- No raw English or malformed currency surfaced.

### WMT-Q03

Proposed verdict: `A_better`

- A answers with traffic, transaction/unit volume, grocery/health/wellness, eCommerce contribution, membership/omnichannel, and fuel offset.
- B falls back with `contextual_reasoning_metric_only`.
- This is a material Config B regression in Q03.

### WMT-Q04

Proposed verdict: `tie`

- Both answer with the same cautious wording.
- No overconfident durability claim observed.

### WMT-Q06

Proposed verdict: `both_safe_fallback`

- Both fall back safely because margin durability evidence remains insufficient.

## Non-Hard-Intent Notable Rows

### AAPL-Q01

Proposed verdict: `cannot_compare_due_to_infra`

- Config A hit provider/server fallback.
- Config B answered.
- Exclude from quality comparison.

### AAPL-Q05

Proposed verdict: `B_better`, but minor review note

- Both answer.
- B uses far fewer tokens.
- A has a `malformed_currency_detected` warning, but no visible malformed-currency label was present.

### WMT-Q05

Proposed verdict: `A_better`

- A answers.
- B falls back as metric-only.
- This favors A for margin-driver handoff setup.

### WMT-Q11

Proposed verdict: `B_better`

- B answers risk question where A falls back.
- This is useful but does not outweigh B's Q03 regressions.

## Human Reviewer Checklist

Reviewers should confirm:

- AAPL-Q06 B answer does not overstate structural margin persistence.
- XOM-Q03 A answer is preferable to B fallback and does not hallucinate energy revenue drivers.
- WMT-Q03 A answer is source-backed and preferable to B fallback.
- JPM-Q03/JPM-Q04 wording remains acceptable and does not overstate persistence.
- CAT-Q03/CAT-Q04 wording remains acceptable with English finance terms normalized enough for user-facing output.
- AAPL-Q05 Config A warning is not a user-visible malformed currency issue.

## Recommendation

`KEEP GPT-5-NANO LOW`

Config B can stay as a future latency experiment, but this run does not support switching the v1.1 test Worker default because hard-intent Q03 quality regressed and estimated dollar cost increased.
