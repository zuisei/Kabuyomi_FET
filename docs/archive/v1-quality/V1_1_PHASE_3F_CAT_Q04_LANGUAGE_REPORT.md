# Kabuyomi v1.1 Phase 3F CAT Q04 Language Report

Date: 2026-05-06
Branch: `v1.1-worker-quality-token-retrieval`
Scope: CAT Q04 `driver_durability_followup` language/finalizer behavior only
Test Worker: `kabuyomi-api-test`
Test URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
Test deploy version: `f1e8c4f6-6458-4191-8ed9-63d203c2af69`

## Conclusion

Phase 3F keeps the Japanese-only guard strict, but adds a narrow source-backed repair path for Q04 durability answers when the source gate has already passed and evidence slots are present.

In the live Q03/Q04 test run, CAT-Q04 returned through the OpenAI path with a safe Japanese answer and no raw English leakage. The repair path did not need to fire in that run because the model output was already Japanese, but focused tests cover the exact Phase 3E failure mode: a raw-English-heavy CAT durability answer is repaired into bounded Japanese instead of being exposed or broadly accepted.

Recommendation: `READY FOR AAPL Q04 DRIVER HANDOFF`.

## CAT-Q04 Diagnosis

Phase 3E CAT-Q04:

- Source gate: passed.
- Selected families: `segment_revenue`, `revenue_discussion`.
- Evidence slots included sales volume, price realization, end-user equipment sales, and 2026 Q1 sales/revenue outlook context.
- Finalizer outcome: fallback.
- Guard labels: `raw_english_excerpt`, `final_answer_language_violation`, `answer_rewritten_to_japanese_fallback`.
- Root cause: the model wrapped useful CAT evidence in Japanese but copied too much raw English SEC text into the answer. The language guard correctly blocked it; the fallback text was too pessimistic because source evidence was actually sufficient.

Classification: `raw_english_excerpt_in_model_answer` with a source-backed repair opportunity, not an allowed-proper-noun false positive.

## Implementation Summary

- Added allowed bounded English terms for CAT-like Japanese answers:
  - `Caterpillar`
  - `Construction Industries`
  - `Energy & Transportation`
  - `Resource Industries`
  - `dealer inventory`
- Added `buildJapaneseLanguageGuardRepair` for `driver_durability_followup` only.
- Repair is available only when:
  - effective intent is Q04 durability follow-up
  - `sourceGateSufficient === true`
  - source gate evidence slots contain recognizable driver evidence
  - the repaired Japanese answer itself passes the Japanese-only guard
- Repair maps evidence-slot text into cautious Japanese durability wording. It does not quote raw English excerpts and does not assert that a driver will persist.
- The finalizer now keeps the original model path when a repair is safe, records `answer_repaired_to_japanese`, and adds `language_guard_source_backed_repair` in `sourceRepairLabels`.
- If the repair cannot be built or fails the language guard, existing `language_guard_fallback` behavior remains unchanged.

## Tests Run

All required local checks passed:

- `npm run typecheck`
- `npm test`
- `npm run dryrun:test`
- `npm run testbench:validate`
- `npm test -- final-answer-language`
- `npm test -- chat-diagnostics`
- `npm test -- hard-intent`

Focused coverage added:

- mostly Japanese CAT answer with bounded English terms passes
- full English/raw excerpt behavior still fails
- CAT-like Q04 evidence can be repaired into Japanese
- no repair is produced when source gate evidence is insufficient
- finalizer keeps OpenAI path for a safe source-backed repair
- `sourceIdsValid` remains true in the repaired path

## Test Worker Deploy Result

Deployed only to the test Worker.

- Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Command: `npm run deploy:test`
- Version ID: `f1e8c4f6-6458-4191-8ed9-63d203c2af69`
- Production deploy: not run

## Benchmark Comparison

Artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3f-q03-q04.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3f-q03-q04-summary.json`

Command:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3f-q03-q04 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03-q04.jsonl \
npm run testbench:run
```

Results:

- Rows: `10`
- Q03 fallback: `1/5`
- Phase 3E Q04 fallback: `3/5`
- Phase 3F Q04 fallback: `1/5`
- Phase 3F Q04 OpenAI path: `4/5`
- `sourceIdsValid=false`: `0`
- Infra contamination: `false`
- Raw English surfaced: `0`
- Rate-limit rows: `0`
- Quality fallback total: `2/10`

## Per-company Q04 Outcome

| Case | Phase 3F outcome | Language guard | Notes |
| --- | --- | --- | --- |
| AAPL-Q04 | OpenAI | passed | Improved in this run, but this was not the Phase 3F target and may depend on Q03 answer shape. |
| JPM-Q04 | OpenAI | passed | No regression. |
| XOM-Q04 | fallback | passed | Correct safe fallback because Q03 still lacks supported energy driver evidence. |
| CAT-Q04 | OpenAI | passed | Target issue resolved in the live run; answer stayed Japanese and used sales volume / price realization context. |
| WMT-Q04 | OpenAI | passed | No regression. |

CAT-Q04 token fields:

- prompt tokens: `2561`
- completion tokens: `276`
- total tokens: `2837`
- model call latency: `3502ms`

## Remaining Risks

- The live CAT-Q04 row did not exercise the repair branch because the model answered in Japanese this time. The synthetic finalizer test exercises the Phase 3E raw-English failure mode directly.
- The repair helper is deliberately heuristic and Q04-only. It should not be generalized to Q06 or other hard intents without separate tests.
- AAPL-Q04 improved in this run, but the underlying risk remains: Q04 quality still depends on whether Q03 exposes a concrete recoverable driver.
- OpenAI rows still show `malformed_currency_detected` sanitizer labels in diagnostics for compact dollar formatting, but user-facing answers stayed Japanese and `responsePath` remained OpenAI.

## Recommendation

`READY FOR AAPL Q04 DRIVER HANDOFF`

Phase 3F should stay test-only. The CAT-specific language/finalizer issue is sufficiently addressed for the next narrow Q04 slice, but production rollout should wait until AAPL Q04 driver handoff is made less dependent on model answer shape and a broader Minimal Core comparison is run.
