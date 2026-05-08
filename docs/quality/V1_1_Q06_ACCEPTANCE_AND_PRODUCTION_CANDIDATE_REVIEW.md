# Kabuyomi v1.1 Q06 Acceptance and Production Candidate Review

Date: 2026-05-08

Branch: `v1.1-worker-quality-token-retrieval`

HEAD at review time: `f882828`

Production deploy: not performed.

Test Worker deploy: not performed in this review.

Push: not performed.

Stash status: `stash@{0}: On v1.1-worker-quality-token-retrieval: pre-final-rerun unrelated local files`

## Executive Summary

The final Minimal Core 60 rerun completed with the selected v1.1 model configuration:

- Model: `gpt-5-nano`
- Reasoning effort: `low`
- Run ID: `2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low-r2`
- Rows complete: 60 / 60

Q06 `margin_durability_followup` is accepted as a safe fallback pattern for v1.1 under the current filing-only scope.

Final release-decision conclusions:

- Q06 decision: `ACCEPT AS SAFE FALLBACK`
- External context / web search: `DEFER TO v1.2`
- Model decision: `KEEP GPT-5-NANO LOW`
- Production-candidate recommendation: `READY FOR PRODUCTION CANDIDATE AFTER CLEAN PRE-DEPLOY CHECK`

This is not a production deploy approval. It means the Worker quality branch can move to production-candidate review after the final pre-deploy gates pass and the remaining non-blocking watch items are accepted by a human reviewer.

## Q06 Acceptance Decision

Decision:

`ACCEPT AS SAFE FALLBACK`

The final rerun produced Q06 fallback for all five Minimal Core companies:

| Ticker | Q06 path | Fallback reason | sourceIdsValid | Acceptance |
| --- | --- | --- | --- | --- |
| AAPL | fallback | `invalid_source_id` | true | Accept as safe fallback; watch item. |
| JPM | fallback | `low_quality_answer` | true | Accept as safe fallback under final rerun evidence. |
| XOM | fallback | `low_quality_answer` | true | Accept as safe fallback. |
| CAT | fallback | `low_quality_answer` | true | Accept as safe fallback; no raw English surfaced. |
| WMT | fallback | `low_quality_answer` | true | Accept as safe fallback. |

Q06 asks whether a margin/profitability factor is temporary or structural. Under filing-only evidence, this is often not answerable without overclaiming. The accepted v1.1 behavior is to avoid unsupported structural/persistent margin claims and return a useful filing-limited fallback when evidence is insufficient.

## Why Q06 Fallback Is Acceptable Under Filing-Only Scope

The Worker now distinguishes margin-driver evidence from revenue-only, table-heavy, generic business, and XBRL-only context. Q06 remains strict by design:

- It requires a recoverable margin/profitability driver from Q05 or selected context.
- It requires margin/cost/profitability evidence, not only revenue growth or comparable-sales evidence.
- It requires durability, temporary, structural, or uncertainty context before answering the follow-up directly.
- It falls back when the filing does not support a temporary-vs-structural conclusion.

That behavior is acceptable for v1.1 because:

- A filing can identify what changed, but not always whether the factor will persist.
- A structural margin conclusion often needs external information, later-period confirmation, or management commentary beyond the selected filing.
- Safe fallback is preferable to hallucinating persistence, cyclicality, or a structural change.
- The final rerun had no user-visible source ID invalidity, raw English leakage, malformed currency, or investment-advice labels.

## External Context / Web Search Deferral To v1.2

Decision:

`DEFER TO v1.2`

External context and web search should not be added to this v1.1 branch.

Potential v1.2 design area:

- Optional paid external context for durability questions.
- Explicit user-facing distinction between filing-only evidence and external/news/market evidence.
- Separate source families and citations for external sources.
- Cost controls and clear billing/credit behavior before enabling external context.

For v1.1, Q06 remains filing-only. If the filing does not support durability, the correct behavior is a safe fallback.

## Final Minimal Core 60 Safety Metrics

Final run:

- JSONL: `workers/testbench/runs/2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low-r2.jsonl`
- Summary: `workers/testbench/runs/2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low-r2-summary.json`

Overall:

| Metric | Result |
| --- | ---: |
| Rows complete | 60 / 60 |
| OpenAI rows | 41 |
| fallback rows | 14 |
| deterministic rows | 5 |
| Quality rows | 59 |
| Quality rows excluded | 1 |
| `sourceIdsValid=false` | 0 |
| `rawEnglishInAnswer` | 0 |
| `rawEnglishSurfaced` | 0 |
| Visible malformed currency labels | 0 |
| Investment advice / forecast / price target labels | 0 |
| Wrong ticker labels detected | 0 |
| Wrong period labels detected | 0 |
| Rate-limit rows | 0 |
| Provider/server error rows | 1 |
| Summary infra contaminated | false |

Fallback reason distribution:

| Fallback reason | Count |
| --- | ---: |
| `low_quality_answer` | 11 |
| `gemini_api_error` | 1 |
| `invalid_source_id` | 1 |
| `weak_grounding` | 1 |

Effective config coverage:

- Requested model/reasoning fields were recorded.
- Model-attempt rows used effective model `gpt-5-nano`.
- Model-attempt rows used effective reasoning effort `low`.
- `reasoningEffortInvalid=true`: 0.

## Q03 / Q04 / Q06 Final Status

Final hard-intent status:

| Scope | Final outcome | Acceptance |
| --- | --- | --- |
| Q03 `revenue_driver` | 5 / 5 OpenAI | Accepted. No material regression from A/B Config A. |
| Q04 `driver_durability_followup` | 3 OpenAI / 2 fallback | Accepted pattern: JPM/CAT/WMT answer; AAPL/XOM safe fallback. |
| Q06 `margin_durability_followup` | 5 / 5 fallback | Accepted as safe filing-only fallback. |

Q03:

- AAPL, JPM, XOM, CAT, and WMT all used OpenAI path.
- `sourceIdsValid=false`: 0.
- This preserves the selected model A/B result where `gpt-5-nano low` was materially stronger than `gpt-5.4-nano none` for Q03.

Q04:

- AAPL: safe fallback because selected context remains insufficient/table-heavy for durability.
- JPM: OpenAI path with cautious source-backed durability framing.
- XOM: safe fallback because the current-period energy revenue driver remains insufficient.
- CAT: OpenAI path with cautious wording.
- WMT: OpenAI path with cautious wording; no overconfident persistence claim accepted from the final run.

Q06:

- AAPL: fallback accepted, with a watch item below.
- JPM: fallback accepted in this final rerun; the system avoids unsupported bank profitability durability claims.
- XOM: fallback accepted because filing-only evidence is not enough for current-period energy margin durability.
- CAT: fallback accepted; previous CAT wording/unit risks were fixed, and the final answer did not surface raw English.
- WMT: fallback accepted because retail margin durability evidence remains weaker than revenue/eCommerce evidence.

## AAPL-Q06 Watch Item

The final rerun had:

- `fallbackReason=invalid_source_id`
- `sourceIdsValid=true` in the final row after source repair
- `rawEnglishInAnswer=0`
- `rawEnglishSurfaced=0`

Decision:

Accept AAPL-Q06 as a safe fallback because no invalid source ID surfaced to the user and the final row reports valid source IDs.

This should remain a non-blocking watch item:

- It should not reopen Q06 in this branch.
- It should be reviewed if the final user-visible answer is judged misleading.
- A future cleanup can separate internal invalid-source repair labels from final user-visible source validity more clearly.

## AAPL-Q02 Provider Row

The final rerun had one non-hard provider/server row:

- Row: AAPL-Q02
- Fallback reason: `gemini_api_error`
- Guard label: `model_api_error:provider_server_error`
- `sourceIdsValid=true`
- Excluded from quality metrics by the benchmark summary.

Decision:

Acceptable for human review, but the final pre-deploy smoke should include an AAPL revenue/segment snapshot or AAPL-Q02-like chat smoke.

This does not block production-candidate review because:

- It is an isolated provider/server row.
- The summary does not mark the run as infra-contaminated.
- It did not create source ID, raw English, malformed currency, or advice/forecast safety failures.

If this row repeats during final pre-deploy smoke, rerun that smoke before production deploy approval.

## Model Decision

Decision:

`KEEP GPT-5-NANO LOW`

The Minimal Core 60 A/B compared:

- Config A: `gpt-5-nano` + `low`
- Config B: `gpt-5.4-nano` + `none`

Key A/B findings:

| Metric | Config A: `gpt-5-nano low` | Config B: `gpt-5.4-nano none` |
| --- | ---: | ---: |
| Total tokens | 155,216 | 129,485 |
| Estimated model cost | `$0.02168940` | `$0.04011085` |
| Model latency p50 | 8,695 ms | 3,169 ms |
| Model latency p95 | 16,760 ms | 6,791 ms |
| `sourceIdsValid=false` | 0 | 0 |
| `rawEnglishInAnswer` | 0 | 0 |
| Q03 fallback | 0 / 5 | 2 / 5 |

Config B was faster and used fewer tokens, but it cost more and regressed Q03 hard-intent quality. The production-candidate model config should remain `gpt-5-nano` with reasoning effort `low`.

## Remaining Non-Blocking Risks

These are accepted or watch-listed risks, not blockers for production-candidate review:

- Q06 is intentionally conservative and returns safe fallbacks in the final rerun.
- AAPL-Q06 used an internal `invalid_source_id` fallback path, but final `sourceIdsValid=true`; watch only.
- AAPL-Q02 had one provider/server row; include a similar smoke in pre-deploy checks.
- External context is not available in v1.1, so some durability questions will remain unanswered by design.
- The stash contains unrelated local files and should remain untouched until intentionally handled.
- This document does not replace a final pre-deploy validation run.

## Production-Candidate Recommendation

Recommendation:

`READY FOR PRODUCTION CANDIDATE AFTER CLEAN PRE-DEPLOY CHECK`

Rationale:

- Final Minimal Core 60 completed all 60 rows.
- Selected model config is verified.
- Q03 is clean in the final run.
- Q04 follows the accepted safe/answered pattern.
- Q06 has an explicit human/product acceptance decision as safe fallback under filing-only v1.1.
- Safety metrics show no source ID invalidity in final rows, no raw English surfaced to users, no visible malformed currency, and no investment advice/forecast/price target labels.
- Production was not deployed from temporary model overrides.

Do not call this production-ready until the final pre-deploy checklist below is completed and production deployment is explicitly approved.

## Required Final Pre-Deploy Checklist

Before production merge/deploy:

- Confirm worktree is clean or only intentional files are staged.
- Keep the stash untouched or handle it intentionally outside this release gate.
- Run from `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
```

- Confirm the test Worker is restored to checked-in config.
- Confirm no production deploy was made from temporary model overrides.
- Confirm production deploy happens only after explicit approval.
- Run post-deploy smoke after production approval:
  - `/v1/search?q=AAPL`
  - `/v1/usage`
  - one chat smoke
  - one IAP usage path if relevant
- Include an AAPL-Q02/revenue snapshot smoke or equivalent due to the isolated provider/server row.
- Keep App Store / iOS release work separate from this Worker quality branch.
- Reconfirm Q06 safe fallback acceptance with the product reviewer if product copy or user expectations change.

## Validation Run For This Review

Command run:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run testbench:validate
```

Result:

- Passed.
- `Testbench validation passed: 5 default tickers, 12 question templates.`

No benchmark, test Worker deploy, production deploy, stash pop, or push was performed in this review.
