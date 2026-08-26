# Kabuyomi v1.1 Phase 3E Driver Durability Follow-up Report

Date: 2026-05-06
Branch: `v1.1-worker-quality-token-retrieval`
Scope: Q04 `driver_durability_followup` only
Test Worker: `kabuyomi-api-test`
Test URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
Final test deploy version: `21205215-7230-46ea-b0a0-4299c5443baf`

## Conclusion

Phase 3E improved Q04 from the baseline `5/5` fallback to `3/5` fallback in the final clean Q03/Q04 follow-up run.

The improvement is safe but not complete. `sourceIdsValid=false` remained `0`, XOM still falls back honestly because Q03 has no supported energy revenue driver, and AAPL falls back when the Q03 answer does not expose a recoverable driver. JPM and WMT reached the OpenAI path. CAT passed the source gate but was rewritten to fallback by the Japanese language guard because the model answer surfaced raw English/source-like text.

Recommendation: `KEEP ON TEST ONLY`.

## Q04 Diagnosis

Baseline diagnostics showed all five Q04 rows falling back with `followup_target_empty`; the rewritten question generally said the prior driver was not identified.

Current final run:

- AAPL-Q04: fallback. Q03 did not provide a recoverable concrete driver in the conversation context, so Q04 failed with `missing_followup_target_driver`.
- JPM-Q04: OpenAI. Q04 recovered `net interest income`, `deposits`, and `noninterest income`; source gate passed with bank revenue discussion and XBRL support.
- XOM-Q04: fallback. This is expected because XOM-Q03 remains an honest fallback with no supported current-period energy revenue/result driver.
- CAT-Q04: fallback after model call. Source gate passed, but finalizer applied `raw_english_excerpt`, `final_answer_language_violation`, and `answer_rewritten_to_japanese_fallback`.
- WMT-Q04: OpenAI. Q04 recovered retail/comparable-sales style drivers and selected segment/revenue evidence.

## Implementation Summary

- Added bounded previous Q/A handoff from `/v1/chat` conversation context into the model/source-gate path.
- Improved follow-up driver extraction for Japanese/English Q03 answers, including `サービス`, `価格実現`, `販売量`, `品目構成`, `NII`, `NIR`, and tariff/product-mix terms.
- Changed Q04 source gate behavior so `driver_durability_followup` requires a recovered prior driver from the previous answer, not merely driver-like selected sources.
- Added Q04 durability evidence checks and labels:
  - `missing_followup_target_driver`
  - `missing_durability_context`
  - `driver_supported_but_durability_unclear`
  - `durability_context_too_generic`
- Prevented generic business-description fallback text from becoming a recovered Q04 driver.
- Fixed a Q04 false classification where `net interest income` in the prior answer could be mistaken for a profit-cause/margin question.
- Updated testbench follow-up context clipping to respect the existing `420` character chat context message contract.

## Tests Run

All required local checks passed:

- `npm run typecheck`
- `npm test`
- `npm run dryrun:test`
- `npm run testbench:validate`
- `npm test -- chat-source-gate`
- `npm test -- hard-intent`
- `npm test -- chat-diagnostics`
- `npm test -- chat-intent-context`
- `npm test -- final-answer-language`

Focused additions cover:

- recovered Q03 driver plus durability evidence passes Q04 gate
- recovered driver with no durability evidence fails safely
- no recovered driver fails safely
- XOM-like missing Q03 driver remains fallback
- generic risk/outlook text alone does not pass
- bank `net interest income` is not mistaken for a profit/margin question
- business-description fallback text is not accepted as a recovered driver
- testbench follow-up context stays within the Worker payload contract

## Test Worker Deploy Result

Deployed only to the test Worker.

- Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Command: `npm run deploy:test`
- Final version ID: `21205215-7230-46ea-b0a0-4299c5443baf`
- Production deploy: not run

## Benchmark Comparison

Final artifact:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3e-q03-q04-r5.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3e-q03-q04-r5-summary.json`

Run command:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3e-q03-q04-r5 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03-q04.jsonl \
npm run testbench:run
```

Results:

- Rows: `10`
- Q03 fallback: `1/5`
- Q04 baseline fallback: `5/5`
- Phase 3E Q04 fallback: `3/5`
- Phase 3E Q04 OpenAI path: `2/5`
- `sourceIdsValid=false`: `0`
- Infra contamination: `false`
- HTTP 400 rows: `0`
- Rate limit rows: `0`
- Q04 exact token counts populated for model-call rows:
  - JPM-Q04: `2213`
  - CAT-Q04: `2780`
  - WMT-Q04: `2860`

## Per-company Q04 Outcome

| Case | Outcome | Source gate | Prior driver | Notes |
| --- | --- | --- | --- | --- |
| AAPL-Q04 | fallback | false | false | Q03 answer did not expose a concrete recoverable driver; fallback is safe. |
| JPM-Q04 | OpenAI | true | true | Recovered bank drivers and avoided the earlier margin/profit false-positive. |
| XOM-Q04 | fallback | false | false | Correct safe fallback because XOM-Q03 has no supported driver. |
| CAT-Q04 | fallback | true | true | Source gate improved, but language guard replaced raw-English-heavy model output. |
| WMT-Q04 | OpenAI | true | true | Recovered comparable-sales/eCommerce style context and answered cautiously. |

## Remaining Risks

- AAPL Q04 depends heavily on Q03 answer shape. If Q03 is terse, Q04 correctly falls back, but this limits quality.
- CAT Q04 now reaches the model with sufficient source evidence but still needs a final-answer/language-guard refinement or prompt constraint to avoid raw English leakage.
- Q04 still does not have full first-class outlook/risk section assets; durability evidence is inferred from selected revenue discussion and sector-specific context.
- Benchmark model output has visible variance across runs, so compare Phase 3E using the clean final run and inspect per-row source previews, not fallback count alone.
- WMT and CAT source previews still include some broad segment/business context alongside useful revenue discussion; source ranking can be tightened later.

## Recommendation

`KEEP ON TEST ONLY`

Phase 3E is safer and measurably better than baseline, but CAT Q04 language-guard fallback and AAPL Q04 driver recovery mean this should not move to production candidate yet. The next slice should either refine Q04 finalizer/language behavior for supported CAT-like answers or strengthen structured Q03 driver handoff before starting Q06.
