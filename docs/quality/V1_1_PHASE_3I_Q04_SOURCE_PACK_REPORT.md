# Kabuyomi v1.1 Phase 3I Q04 Source Pack Report

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

## Conclusion

Phase 3I improved the Q04 follow-up source pack for CAT and WMT and made weak/table-heavy Q04 packs fail earlier. The clean post-deploy run shows:

- Q03/Q04 rows: 10
- OpenAI path: 8/10
- fallback: 2/10
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishInDiagnostics`: 1
- `rawEnglishSurfaced`: 0

Recommendation: `KEEP ON TEST ONLY`

Reason: CAT/WMT source-pack quality is better, AAPL and XOM now fail safely when Q04 evidence is table-heavy or too generic, and no final user-visible raw English surfaced. However, post-gate answer quality still needs human review because some OpenAI Q04 answers carry `malformed_currency_detected` labels and Q04 durability wording can still be more metric-heavy than ideal.

## Diagnosis Summary

Phase 3H showed two instability classes:

- CAT/WMT selected useful Q04 evidence but mixed it with generic company history, strategy, finance-subsidiary, and segment-description snippets.
- Phase 3H r2 counted `rawEnglishSurfaced=1`, but inspection showed this was not necessarily final user-visible raw English; the metric was mixing final answers with diagnostic/source-preview and repair labels.

Phase 3I clean run diagnosis:

- AAPL-Q04: correct source-gate fallback. Selected context remains table/gross-margin/tariff-heavy and lacks concrete durability evidence.
- JPM-Q04: OpenAI path in the clean run, with NII/NIR/Markets revenue evidence selected.
- XOM-Q04: correct source-gate fallback after tightening. Selected energy context is broad/long-term and table-heavy, not clean current-period durability evidence.
- CAT-Q04: OpenAI path with sales volume, price realization, expected sales/revenues, and dealer inventory evidence.
- WMT-Q04: OpenAI path with comparable sales, transactions/unit volume, eCommerce contribution, and Walmart+ member engagement evidence.

## Implementation Summary

Changed `workers/src/lib/chat/context-pack.ts`:

- Added revenue-driver distractor filtering for Q04-adjacent source packs.
- Downranked or removed generic snippets such as company history, store footprint, broad strategy, seasonal/table-of-contents text, CAT finance-subsidiary boilerplate, and generic segment descriptions.
- Improved excerpt clipping so selected previews focus around concrete driver/durability cues instead of nearby generic text.

Changed `workers/src/lib/chat/source-gate.ts`:

- Added narrow explicit follow-up target recovery from rewritten Q04 questions.
- Required Q04 source sufficiency to reject metric-only or table-heavy context even when another weak durability signal exists.

Changed `workers/testbench/scripts/benchmark-quality.mjs`:

- Split raw-English diagnostics into:
  - `rawEnglishInAnswer`
  - `rawEnglishInDiagnostics`
  - `rawEnglishSurfaced`
- `rawEnglishSurfaced` now means final user-visible answer only.

Added focused tests:

- CAT source pack prefers sales volume / price realization / dealer inventory over generic finance/segment descriptions.
- WMT source pack prefers comparable sales / eCommerce / member engagement over history/strategy snippets.
- Raw English in repaired diagnostics is not counted as user-visible raw English.

## Tests Run

From `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm test -- chat-source-gate
npm test -- chat-intent-context
npm test -- benchmark-quality
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
```

Final validation result:

- `npm run typecheck`: passed
- `npm test`: passed, 48 files / 553 tests
- `npm run dryrun:test`: passed using `wrangler.test.toml`
- `npm run testbench:validate`: passed

## Test Worker Deploy Result

Production was not deployed.

Test deploy command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Resolved deploy target:

- Worker name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `0459844a-247b-4399-886d-885df74ae933`
- Config: `wrangler.test.toml`

## Benchmark Comparison

Benchmark command shape:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=<run-id> \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03-q04.jsonl \
npm run testbench:run
```

Question subset:

- Q03 revenue driver
- Q04 driver durability follow-up
- AAPL, JPM, XOM, CAT, WMT
- 10 rows per run

Phase 3H baseline:

- `2026-05-06-v1-1-phase-3h-q03-q04`: OpenAI 7/10, fallback 3/10, `sourceIdsValid=false` 0, `rawEnglishSurfaced` 0
- `2026-05-06-v1-1-phase-3h-q03-q04-r2`: OpenAI 5/10, fallback 5/10, `sourceIdsValid=false` 0, legacy `rawEnglishSurfaced` 1

Phase 3I clean run:

- Artifact: `workers/testbench/runs/2026-05-06-v1-1-phase-3i-q03-q04-r7.jsonl`
- Summary: `workers/testbench/runs/2026-05-06-v1-1-phase-3i-q03-q04-r7-summary.json`
- OpenAI 8/10
- fallback 2/10
- `sourceIdsValid=false` 0
- `rawEnglishInAnswer` 0
- `rawEnglishInDiagnostics` 1
- `rawEnglishSurfaced` 0

Phase 3I infra-contaminated runs:

- `2026-05-06-v1-1-phase-3i-q03-q04-r8`: provider 503 rows 9/10
- `2026-05-06-v1-1-phase-3i-q03-q04-r9`: provider 503 rows 10/10

These runs are not quality-comparable, but they confirm `sourceIdsValid=false` remained 0.

## Per-Company Q04 Outcome

Clean run: `2026-05-06-v1-1-phase-3i-q03-q04-r7`

- AAPL-Q04: fallback before model, source gate failed with `q04_table_heavy_context`, `q04_driver_evidence_too_generic`, `durability_context_missing`, `q04_durability_evidence_too_generic`.
- JPM-Q04: OpenAI path. Selected NII/NIR/Markets revenue evidence.
- XOM-Q04: fallback before model, source gate failed with `q04_table_heavy_context`. This is safer than passing broad long-term energy context.
- CAT-Q04: OpenAI path. Selected previews include higher sales volume, unfavorable price realization, expected stronger sales/revenues, and dealer inventory.
- WMT-Q04: OpenAI path. Selected previews include comparable-sales drivers, transactions/unit volume, eCommerce contribution, and Walmart+ member engagement.

## Run-To-Run Variability

Phase 3I reduced the CAT/WMT source-pack instability in the clean run:

- CAT-Q04: stable OpenAI in the clean post-fix run with stronger source previews.
- WMT-Q04: OpenAI in the clean post-fix run with less history/strategy noise.
- AAPL-Q04: stable safe fallback when context is table-heavy.
- XOM-Q04: safe fallback after table-heavy Q04 context was made insufficient.

Two follow-up attempts were blocked by provider-side 503 errors, so a second clean quality run was not available in this pass.

## Raw English Finding

Phase 3H’s `rawEnglishSurfaced=1` was diagnostically ambiguous because the summary mixed final answers with diagnostic/source-preview and repair labels.

Phase 3I now separates:

- `rawEnglishInAnswer`: final user-visible answer leakage
- `rawEnglishInDiagnostics`: source/debug/repair-label raw English only
- `rawEnglishSurfaced`: alias for final user-visible leakage

In the clean Phase 3I run:

- `rawEnglishInAnswer=0`
- `rawEnglishInDiagnostics=1`
- `rawEnglishSurfaced=0`

The diagnostic-only case was XOM-Q04: the language guard detected English in the pre-fallback path, rewrote to Japanese fallback, and the final answer shown to the user was Japanese.

## Remaining Risks

- JPM-Q04 and CAT-Q04 OpenAI answers still showed `malformed_currency_detected` in finalizer labels in the clean run. The answer was not blocked, so this should be reviewed before moving to production-candidate work.
- WMT-Q04 is source-backed, but the model can still phrase durability more strongly than ideal. It should remain under test-only observation.
- XOM still lacks first-class current-period energy durability assets. The current behavior is safer fallback, not solved synthesis.
- Provider 503 instability prevented a second clean post-fix run.

## Recommendation

`KEEP ON TEST ONLY`

Phase 3I is a useful source-pack improvement, but not ready to advance as production-quality Q04 behavior. Recommended next step: review or tighten post-gate finalizer handling for malformed currency / metric-heavy Q04 answers, then rerun Q03/Q04 when provider stability returns. If Q04 is accepted as test-only, Q06 work can start from this branch with these risks explicitly tracked.
