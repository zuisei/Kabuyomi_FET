# Kabuyomi v1.1 Worker Quality Branch Summary

Date: 2026-05-07

Branch: `v1.1-worker-quality-token-retrieval`

Current HEAD: `43fa3d8`

Production deployment from this branch: not performed in this review. Prior phase reports also record test Worker-only deployments.

Push status: not pushed in this review; local branch has no upstream shown by `git branch -vv`.

## Executive Summary

This branch is a v1.1 test-only Worker quality branch. It improves hard-intent answer quality, source selection, diagnostics, model-token observability, and benchmark reporting for `/v1/chat`, while keeping v1 release surfaces out of scope.

Major outcomes:

- Q03 `revenue_driver` moved from the original 5/5 fallback problem to mostly OpenAI answers with safer source gates.
- Q04 `driver_durability_followup` moved from 5/5 fallback to accepted behavior for the benchmark set: AAPL/XOM safe fallback; JPM/CAT/WMT cautious source-backed answers.
- Q06 `margin_durability_followup` moved from 5/5 fallback to safer, more source-aware behavior, but it is still conservative and not fully solved.
- CAT-Q06 visible wording/unit risk was fixed before the final Minimal Core rerun.
- Testbench diagnostics now capture source previews, source families, source-gate slots, low-quality/finalizer labels, token counts, model latency, and requested/effective model config.
- Explicit `OPENAI_REASONING_EFFORT=none` support was added for testable model A/B comparison.
- Full Minimal Core 60 A/B concluded: `KEEP GPT-5-NANO LOW`.

Merge-readiness decision: `READY FOR HUMAN REVIEW`

This branch is not marked production-ready yet. It needs human review of accepted safe fallbacks and a clean final production-candidate Minimal Core 60 on the selected config after the worktree is cleaned.

## Branch / Commit Range

Current command results:

```text
git branch --show-current
v1.1-worker-quality-token-retrieval

git rev-parse --short HEAD
43fa3d8
```

Branch point against `main`:

```text
merge-base(main, HEAD): d2dc50e0a9e1eed0772776e353f827b4d58a0145
commits ahead of main: 23
```

Recent commits:

```text
43fa3d8 Run minimal core model config comparison
ce53df0 Support explicit OpenAI reasoning none
ab996d1 Compare minimal core model configs
818387b Clean up CAT Q06 wording
5201bc2 Add Q06 human review packet
f65c0d7 Expand Q06 margin source packs
97e1c51 Improve Q06 margin handoff slots
e09f330 Add margin source assets for Q05
77b9a6a Start Q06 margin durability diagnosis
2b695d6 Tighten Q04 durability wording
018802c Add Q04 human review packet
560eb42 Finalize Q04 safety labels
da34654 Redesign Q04 follow-up source pack
7941bdc Stabilize Q04 durability source quality
348e9da Improve AAPL Q04 driver handoff
9a05794 Refine CAT Q04 language guard handling
5e9f5c7 Improve driver durability follow-up evidence handling
646a3fb Improve energy revenue driver source quality
f171594 Backfill revenue driver source assets for Q03
63b52d9 Add revenue driver post-gate diagnostics
```

Worktree status at review time:

- Not clean.
- Unrelated modified files remain:
  - `ios/Kabuyomi/Features/Settings/SettingsView.swift`
  - `ios/project.yml`
  - `legal-site/scripts/validate.mjs`
- Untracked older/intermediate artifacts remain, mainly under `workers/testbench/runs/` plus `docs/quality/V1_1_DIAGNOSTICS_BENCHMARK_RUN.md` and `legal-site/public/app-ads.txt`.
- These files were not staged by this summary task.

## Major Completed Work

Completed Worker quality areas:

- Baseline diagnostics and token/source observability.
- Revenue-driver source families and Q03 source pack improvements.
- Energy-specific revenue-driver safety tightening for XOM.
- Q04 driver durability handoff, source pack, post-gate repair, language guard, and wording cleanup.
- Q06 margin/cost/profitability source-family work.
- Q06 margin follow-up handoff and evidence-slot extraction.
- Q06 source pack expansion for bank, industrial, retail, energy, and technology margin evidence.
- Q06 human review packet and CAT-Q06 wording/unit cleanup.
- Explicit OpenAI reasoning effort `none` support and A/B config diagnostics.
- Full Minimal Core 60 model A/B comparison.

Out of scope and untouched by this summary task:

- Runtime behavior.
- Retrieval/source selection.
- Prompts.
- Model provider.
- Finalizers/source gates.
- iOS, legal, AdMob, and IAP.
- Production deployment.

## Q03 Before / After

Initial known baseline:

- Minimal Core Q03 `revenue_driver` fallback: 5/5.
- Hard-intent source quality was weak, with selected context often XBRL-only, table-heavy, or generic.

Final intended behavior from phase reports:

- Q03 became mostly OpenAI with source-backed revenue-driver evidence.
- Phase 3D focused Q03 result: OpenAI 4/5, fallback 1/5, `sourceIdsValid=false` 0.
- The remaining fallback was XOM, because available energy snippets were broad market/reserve/long-term context rather than current-period revenue/result driver evidence.

Per-company final state from Q03 phase work:

| Ticker | Final Q03 state | Notes |
| --- | --- | --- |
| AAPL | OpenAI | Uses product/services/geographic revenue context when selected evidence is sufficient. |
| JPM | OpenAI | Improved from Properties/XBRL to NII/NIR, Markets, fees, and bank revenue narrative. |
| XOM | Safe fallback in Phase 3D | Energy source gate now rejects broad reserve/market context as insufficient current-period revenue driver evidence. |
| CAT | OpenAI | Improved to sales volume, price realization, equipment sales to end users, and supporting revenue metric. |
| WMT | OpenAI | Improved to comparable sales, traffic/transactions/unit volume, grocery/health/wellness, eCommerce, and membership context. |

Important A/B note:

- In the final model A/B, Config A (`gpt-5-nano low`) answered all Q03 rows.
- Config B (`gpt-5.4-nano none`) regressed Q03 with XOM-Q03 and WMT-Q03 fallback.

## Q04 Before / After

Initial known baseline:

- Q04 `driver_durability_followup` fallback: 5/5.
- The Worker often lacked a recovered Q03 driver and/or durability/outlook context.

Final accepted Phase 3L behavior:

- AAPL-Q04: safe fallback.
- JPM-Q04: OpenAI.
- XOM-Q04: safe fallback.
- CAT-Q04: OpenAI.
- WMT-Q04: OpenAI via cautious source-backed repair.
- `sourceIdsValid=false`: 0.
- Raw English in final answer: 0.

Key improvements:

- Bounded follow-up handoff for prior revenue drivers.
- Q04 source pack preference for durability/outlook/uncertainty evidence.
- CAT-Q04 language guard handling to avoid raw English leakage.
- AAPL-Q04 driver handoff repair, while preserving fallback if table-heavy/weak context remains.
- WMT wording softening: overconfident phrases such as `継続的に高まり` are replaced with filing-limited caution.
- JPM NII/NIR durability handling: NII/NIR, deposit margin compression, rates, fees, Markets, and one-time items can support cautious assessment when source-gate sufficient.

Accepted Q04 rationale:

| Ticker | Final Q04 state | Rationale |
| --- | --- | --- |
| AAPL | Safe fallback | Concrete prior driver/durability chain remains insufficient or table-heavy. |
| JPM | OpenAI | Source-backed NII/NIR, deposit margin, rate, fee, Markets, and one-time-item context supports cautious answer. |
| XOM | Safe fallback | Q03 energy driver remains unsupported by current-period result evidence. |
| CAT | OpenAI | Sales volume, price realization, dealer inventory/outlook context supports cautious answer. |
| WMT | OpenAI | Comparable sales, eCommerce, transactions/unit volume, member engagement, and fuel context support a cautious answer. |

## Q06 Before / After

Initial known baseline:

- Q06 `margin_durability_followup` fallback: 5/5.
- Q05 often produced deterministic or metric-only margin answers, so Q06 lacked a recoverable margin driver.

Q06 work completed:

- Q06-1: tightened source gate so XBRL-only, table-heavy, generic business text, or revenue-driver-only context fails safely.
- Q06-2: added margin/cost/profitability source families and improved Q05 margin-driver extraction.
- Q06-3: improved Q05 to Q06 margin handoff and margin evidence-slot extraction; reduced CAT false-positive gate path.
- Q06-4: expanded margin source packs for AAPL, XOM, WMT, CAT, and preserved JPM behavior.
- Q06-5: created human review packet.
- Q06-6: cleaned CAT-Q06 wording and unit display, including `price realization` -> `価格実現`, `cost` -> `コスト`, and avoiding wrong `百万ドル` scale.

Q06-4 human-review baseline:

- Q06 OpenAI: 2/5.
- Q06 fallback: 3/5.
- `sourceIdsValid=false`: 0.
- `rawEnglishInAnswer`: 0.
- `rawEnglishSurfaced`: 0.
- malformed visible currency: 0.

Final Q06 accepted state:

| Ticker | Final Q06 state | Rationale |
| --- | --- | --- |
| AAPL | Safe fallback | Product/services gross-margin and operating-expense durability evidence remains weak. |
| JPM | Acceptable | Bank profitability evidence supports a cautious answer without prediction. |
| XOM | Safe fallback | Current-period refining/chemical/upstream/downstream margin evidence remains insufficient. |
| CAT | Cleaned up | OpenAI path is acceptable after wording/unit cleanup when selected evidence is sufficient; fallback remains safe in variable runs. |
| WMT | Safe fallback | Retail margin assets remain weaker than revenue/eCommerce evidence. |

Q06 is safer and more source-aware, but not fully solved. Remaining safe fallbacks should be product-accepted before production.

## Model A/B Result

The full Minimal Core 60 A/B compared:

- Config A: `gpt-5-nano` + reasoning effort `low`.
- Config B: `gpt-5.4-nano` + reasoning effort `none`.

Final recommendation:

`KEEP GPT-5-NANO LOW`

Do not switch to `gpt-5.4-nano` + `none` on this evidence.

### Token / Cost / Latency Comparison

| Metric | Config A: `gpt-5-nano low` | Config B: `gpt-5.4-nano none` |
| --- | ---: | ---: |
| Rows | 60 | 60 |
| OpenAI / fallback / deterministic | 43 / 12 / 5 | 43 / 12 / 5 |
| Total tokens | 155,216 | 129,485 |
| Estimated model cost | `$0.02168940` | `$0.04011085` |
| Cost per all 60 rows | `$0.00036149` | `$0.00066851` |
| Model latency p50 | 8,695 ms | 3,169 ms |
| Model latency p95 | 16,760 ms | 6,791 ms |
| `sourceIdsValid=false` | 0 | 0 |
| `rawEnglishInAnswer` | 0 | 0 |
| Q03 fallback | 0/5 | 2/5 |
| Q04 fallback | 2/5 | 2/5 |
| Q06 fallback | 5/5 | 4/5 |

Interpretation:

- Config B is faster and uses fewer completion/total tokens.
- Config B is more expensive in dollars because its per-token price is higher.
- Config B regressed Q03 hard-intent quality on XOM and WMT.
- Config A remains the safer default candidate.

## Safety Metrics

Latest A/B safety metrics:

| Metric | Config A | Config B |
| --- | ---: | ---: |
| `sourceIdsValid=false` | 0 | 0 |
| `rawEnglishInAnswer` | 0 | 0 |
| `rawEnglishSurfaced` | 0 | 0 |
| Visible malformed currency | 0 | 0 |
| Rate-limit rows | 0 | 0 |
| Infra contaminated | false | false |
| Provider/server error rows | 1 | 0 |

Investment advice / forecast / price target:

- No such critical failure was observed in the available benchmark diagnostics.
- A final human review should still scan the selected production-candidate run for these labels before release.

Provider contamination:

- Config A had one provider/server fallback on AAPL-Q01 in the A/B. That row was excluded from row-quality comparison.
- The run as a whole was not marked infra-contaminated.

## Remaining Risks

- Worktree is not clean; unrelated iOS/legal modifications and older untracked artifacts remain.
- No final clean production-candidate Minimal Core 60 has been run after this summary with only the selected final config and a clean worktree.
- Q06 still contains accepted safe fallbacks and should be explicitly product-reviewed.
- XOM energy current-period revenue/result evidence remains weak.
- AAPL and WMT margin durability evidence remains weak for Q06.
- Some phase artifacts are intermediate and not all should be treated as canonical.
- Provider variability is visible in phase reports, especially Q05/Q06 OpenAI vs fallback variability.
- Test-only source/backfill behavior should be reviewed carefully before production promotion.

## Production-Readiness Decision

Decision: `READY FOR HUMAN REVIEW`

Rationale:

- Local validation passed.
- Test Worker-only benchmark evidence is strong enough for human review.
- Safety-critical metrics stayed clean in the latest A/B.
- The branch has meaningful quality improvements for Q03/Q04 and safer Q06 handling.
- However, production-candidate status needs a clean final rerun and explicit acceptance of conservative Q06 behavior.

Do not mark as production-ready yet because:

- The worktree is dirty.
- There is no clean final Minimal Core 60 on the selected final config after this summary.
- Q06 safe fallback behavior still requires product/human acceptance.
- Production has not been deployed from this branch.

## Required Pre-Production Gates

Before production merge/deploy:

1. Clean worktree or intentionally staged/committed artifacts only.
2. Confirm unrelated iOS/legal-site changes are excluded or intentionally handled.
3. Run final local validation:
   - `npm run typecheck`
   - `npm test`
   - `npm run dryrun:test`
   - `npm run testbench:validate`
4. Confirm test Worker is restored to checked-in config.
5. Run a clean final Minimal Core 60 on selected config:
   - `gpt-5-nano`
   - `OPENAI_REASONING_EFFORT=low`
6. Optionally rerun focused Q03/Q04/Q06 subsets if final Minimal Core reveals provider variability.
7. Human-review Q06 safe fallback acceptance.
8. Confirm no `sourceIdsValid=false`.
9. Confirm no `rawEnglishInAnswer` or user-visible malformed currency.
10. Confirm no investment advice, forecast, price target, or hallucinated driver labels.
11. Do not deploy production from temporary model override config.
12. Push only after explicit instruction.

## Recommended Next Steps

Immediate:

- Human review of this branch summary and canonical packets.
- Decide whether Q06 safe fallback behavior is acceptable for v1.1.
- Clean or isolate unrelated dirty files before merge work.

Before production candidate:

- Run one clean Minimal Core 60 with `gpt-5-nano low`.
- Compare against the A/B Config A run and confirm no Q03/Q04/Q06 regression.
- Create a short production-candidate signoff doc if the clean rerun passes.

Later v1.1+ improvements:

- More current-period energy result source assets for XOM-like filings.
- More AAPL/WMT margin durability assets.
- Consider first-class outlook/risk assets if Q04/Q06 source packs remain dependent on synthetic windows.
- Revisit `gpt-5.4-nano none` only if latency becomes more important than Q03 quality/cost.

## Canonical Artifacts Index

Use these as canonical for branch review:

- `docs/archive/v1-quality/V1_1_WORKER_QUALITY_BRANCH_SUMMARY.md`
- `docs/archive/v1-quality/V1_1_MODEL_AB_MINIMAL_CORE_60_REPORT.md`
- `docs/archive/v1-quality/V1_1_MODEL_AB_HUMAN_REVIEW_PACKET.md`
- `workers/testbench/reports/model-ab-minimal-core-60-comparison.json`
- `workers/testbench/runs/2026-05-07-v1-1-minimal-core-60-gpt-5-nano-low.jsonl`
- `workers/testbench/runs/2026-05-07-v1-1-minimal-core-60-gpt-5-nano-low-summary.json`
- `workers/testbench/runs/2026-05-07-v1-1-minimal-core-60-gpt-5-4-nano-none.jsonl`
- `workers/testbench/runs/2026-05-07-v1-1-minimal-core-60-gpt-5-4-nano-none-summary.json`
- `docs/archive/v1-quality/V1_1_MODEL_AB_PREFLIGHT_FIX_REPORT.md`
- `docs/archive/v1-quality/V1_1_Q06_6_CAT_WORDING_REPORT.md`
- `docs/archive/v1-quality/V1_1_Q06_5_HUMAN_REVIEW_PACKET.md`
- `docs/archive/v1-quality/V1_1_Q06_4_MARGIN_SOURCE_PACK_REPORT.md`
- `docs/archive/v1-quality/V1_1_PHASE_3L_Q04_WORDING_AND_JPM_REPORT.md`
- `docs/archive/v1-quality/V1_1_PHASE_3D_ENERGY_REVENUE_DRIVER_REPORT.md`
- `docs/archive/v1-quality/V1_1_PHASE_3C_REVENUE_ASSET_BACKFILL_REPORT.md`
- `docs/quality/V1_1_DIAGNOSTICS_BENCHMARK_RUN.md`
- `docs/quality/WORKER_ARCHITECTURE_BRIEF.md`

## Non-Canonical / Intermediate Artifact Note

Many older phase run artifacts under `workers/testbench/runs/2026-05-06-*` are useful evidence trails, but they should not be treated as final release gates unless a report explicitly references them.

Do not stage or promote old intermediate artifacts only because they are present locally. Keep them untracked or archive them separately unless a reviewer requests the exact phase evidence.

Current untracked old/intermediate artifacts can remain local until a separate cleanup/archive decision is made.

## Validation Run for This Summary

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

No benchmark, test Worker deploy, production deploy, or push was run for this summary task.
