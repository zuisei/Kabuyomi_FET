# Kabuyomi v1.1 Final Minimal Core 60 Rerun Report

Date: 2026-05-08

Branch: `v1.1-worker-quality-token-retrieval`

HEAD at run start: `ba21da0`

Production deploy: not performed.

Push: not performed.

## Executive Summary

The dirty-worktree blocker was resolved by safely stashing unrelated local files, then a final Minimal Core 60 rerun was attempted with the selected model config:

- Model: `gpt-5-nano`
- Reasoning effort: `low`

The first final attempt was invalid due to provider/server 503 contamination and a testbench crash before artifacts were written. A second run, `-r2`, completed all 60 rows and produced artifacts.

Final recommendation: `NEEDS Q06 HUMAN ACCEPTANCE`

Reason:

- The completed `-r2` run has 60 rows.
- Effective model config is correct on model-attempt rows.
- `sourceIdsValid=false`: 0.
- `rawEnglishInAnswer`: 0.
- `rawEnglishSurfaced`: 0.
- Q03 did not regress from A/B Config A: all five Q03 rows are OpenAI.
- Q04 remains acceptable by the prior branch criteria.
- Q06 remains conservative, but AAPL-Q06 specifically fell back through the `invalid_source_id` guard and was source-repaired. Source IDs are valid in the final row, but this row should be human-reviewed before production-candidate signoff.
- One non-hard row, AAPL-Q02, hit a provider/server error and is excluded from quality metrics by the benchmark summary.

## Stash / Worktree Cleanup

Initial dirty files included unrelated iOS/legal-site changes and old untracked benchmark artifacts.

Command used:

```bash
cd /Users/0xt4/t4dano/Kabuyomi
git stash push -u -m "pre-final-rerun unrelated local files"
```

Result:

```text
Saved working directory and index state On v1.1-worker-quality-token-retrieval: pre-final-rerun unrelated local files
stash@{0}: On v1.1-worker-quality-token-retrieval: pre-final-rerun unrelated local files
```

Post-stash worktree before validation:

- `git status --short`: clean.

The stash was not popped.

## Validation Results

Commands run from `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
```

Results:

- `npm run typecheck`: passed.
- `npm test`: passed, 48 files / 582 tests.
- `npm run dryrun:test`: passed.
- `npm run testbench:validate`: passed.

## Selected Model Config

Selected config:

- `OPENAI_CHAT_MODEL=gpt-5-nano`
- `OPENAI_REASONING_EFFORT=low`

This follows the model A/B decision:

- Keep `gpt-5-nano low`.
- Do not switch to `gpt-5.4-nano none`.

## Test Worker Deploy / Restore

### First selected-config deploy

Command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
./node_modules/.bin/wrangler deploy --config wrangler.test.toml \
  --var OPENAI_CHAT_MODEL:gpt-5-nano \
  --var OPENAI_REASONING_EFFORT:low
```

Result:

- Worker name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `9972cd9d-f18d-4feb-b095-5ba31bfa2701`

This first final run attempt did not complete.

### Second selected-config deploy for `-r2`

After cooldown, the same selected config was redeployed.

Command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
./node_modules/.bin/wrangler deploy --config wrangler.test.toml \
  --var OPENAI_CHAT_MODEL:gpt-5-nano \
  --var OPENAI_REASONING_EFFORT:low
```

Result:

- Worker name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `c304f9b4-f2d2-4691-81f0-79031290e781`

### Restore checked-in test config

Command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Result:

- Worker name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `fb1383e5-631b-4427-be65-c07a1cc5be5e`
- Restored checked-in test config: `OPENAI_CHAT_MODEL=gpt-5-nano`, `OPENAI_REASONING_EFFORT=minimal`.

Production was not deployed.

## Benchmark Attempts

### Invalid first attempt

Run ID requested:

- `2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low`

Result:

- Did not write final JSONL/summary artifacts.
- The run encountered provider/server 503 rows at XOM-Q08, XOM-Q10, XOM-Q11, and XOM-Q12.
- The testbench then crashed while resolving the next filing because it received an HTML 503 response where JSON was expected.

This attempt is not used for quality comparison.

### Completed `-r2` attempt

Command:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low-r2 \
OPENAI_CHAT_MODEL=gpt-5-nano \
OPENAI_REASONING_EFFORT=low \
npm run testbench:run
```

Artifacts:

- `workers/testbench/runs/2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low-r2.jsonl`
- `workers/testbench/runs/2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low-r2-summary.json`

## Completed Run Summary

Run ID:

- `2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low-r2`

Rows:

- 60 / 60 complete.

Response path distribution:

| Path | Count |
| --- | ---: |
| OpenAI | 41 |
| fallback | 14 |
| deterministic | 5 |

Fallback reason distribution:

| Fallback reason | Count |
| --- | ---: |
| `low_quality_answer` | 11 |
| `gemini_api_error` | 1 |
| `invalid_source_id` | 1 |
| `weak_grounding` | 1 |

Quality rows:

- Quality rows: 59.
- Quality rows excluded: 1.
- Excluded row: AAPL-Q02 provider/server error.

## Effective Model / Reasoning Config Coverage

All rows recorded requested model/reasoning fields.

Model-attempt row validation:

- Effective model: `gpt-5-nano`.
- Effective reasoning effort: `low`.
- Effective config mismatches: 0.
- `reasoningEffortInvalid=true`: 0.

## Safety Metrics

| Metric | Count |
| --- | ---: |
| `sourceIdsValid=false` | 0 |
| `rawEnglishInAnswer` | 0 |
| `rawEnglishSurfaced` | 0 |
| User-visible malformed currency labels | 0 |
| Investment advice / forecast / price target labels detected | 0 |
| Wrong ticker labels detected | 0 |
| Wrong period labels detected | 0 |
| Material numeric/sign error labels detected | 0 |
| Rate-limit rows | 0 |
| Provider/server error rows | 1 |
| Infra contaminated by summary threshold | false |

Important note:

- AAPL-Q06 has `fallbackReason=invalid_source_id`, but the final row has `sourceIdsValid=true` after fallback source repair.
- This is not a `sourceIdsValid=false` failure, but it is a Q06 human-review item.

## Q03 Outcome

Q03 `revenue_driver` outcome:

| Ticker | Path | Fallback reason | sourceIdsValid |
| --- | --- | --- | --- |
| AAPL | OpenAI | none | true |
| JPM | OpenAI | none | true |
| XOM | OpenAI | none | true |
| CAT | OpenAI | none | true |
| WMT | OpenAI | none | true |

Result:

- Q03 fallback: 0/5.
- No material regression from A/B Config A.

## Q04 Outcome

Q04 `driver_durability_followup` outcome:

| Ticker | Path | Fallback reason | sourceIdsValid |
| --- | --- | --- | --- |
| AAPL | fallback | `low_quality_answer` | true |
| JPM | OpenAI | none | true |
| XOM | fallback | `low_quality_answer` | true |
| CAT | OpenAI | none | true |
| WMT | OpenAI | none | true |

Result:

- Q04 fallback: 2/5.
- This matches the accepted branch pattern: AAPL/XOM safe fallback; JPM/CAT/WMT OpenAI.

## Q06 Outcome

Q06 `margin_durability_followup` outcome:

| Ticker | Path | Fallback reason | sourceIdsValid |
| --- | --- | --- | --- |
| AAPL | fallback | `invalid_source_id` | true |
| JPM | fallback | `low_quality_answer` | true |
| XOM | fallback | `low_quality_answer` | true |
| CAT | fallback | `low_quality_answer` | true |
| WMT | fallback | `low_quality_answer` | true |

Result:

- Q06 fallback: 5/5.
- All final row source IDs are valid.
- AAPL-Q06 should be human-reviewed because the fallback went through the invalid-source guard and source repair.

AAPL-Q06 final answer:

> 一時的とは断定しにくいです。 本文では、粗利率・粗利益、在庫・ロス、為替が利益率や利益の動きを見る材料として出ています。 営業利益は 508.5億ドル で、前年同期比 18.7%増 です。 この数字だけでは継続性は決まりませんが、価格、数量、需要、コスト、mixのような営業要因は一回限りとは言いにくく、次回も同じ方向で出るかを確認する論点です。

Human review question:

- Is this acceptable as a conservative Q06 fallback after source repair, or should AAPL-Q06 be rerun/retuned because the invalid-source guard fired?

## Infra Contamination

Completed `-r2` run:

- `providerErrorRows`: 1.
- Row: AAPL-Q02.
- Fallback reason: `gemini_api_error`.
- Infra kind: `provider_server_error`.
- Benchmark summary: `infraContaminated=false`.
- This row was excluded from quality metrics.

The provider/server row is not a hard-intent Q03/Q04/Q06 row. It should still be noted before production-candidate signoff.

## Production-Candidate Recommendation

Recommendation: `NEEDS Q06 HUMAN ACCEPTANCE`

This run is strong enough to move to human review, but not enough to auto-declare production-candidate readiness.

Reasons:

- Q03 passes cleanly with 0/5 fallback.
- Q04 matches accepted branch behavior.
- Safety headline metrics are clean: no invalid final source IDs, no raw English surfaced, no visible malformed currency labels.
- However, Q06 is still 5/5 fallback, and AAPL-Q06 used the invalid-source guard before source repair.
- One non-hard provider/server row occurred and was excluded, but it means the run is not perfectly clean.

If human review accepts Q06 safe fallback behavior and the AAPL-Q06 repaired fallback, this branch can be considered for production-candidate review. Otherwise, rerun or targeted Q06 cleanup is needed.

## Remaining Human Decisions

1. Accept or reject AAPL-Q06 repaired fallback.
2. Accept or reject current Q06 conservative behavior: 5/5 fallback in this final run.
3. Decide whether the single AAPL-Q02 provider/server row is acceptable as excluded non-hard infra, or whether another clean rerun is required.
4. Decide when or whether to pop the stash containing unrelated local files.
5. Before any production deployment, run a final pre-deploy gate and confirm no temporary model override remains active.
