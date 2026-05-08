# Kabuyomi v1.1 Final Clean Rerun Prep

Date: 2026-05-08

Branch: `v1.1-worker-quality-token-retrieval`

Current HEAD: `ae2f9b8`

Task scope: cleanup/classification and final-run preparation only. No runtime behavior, retrieval, prompts, model provider, finalizers/source gates, iOS/legal/AdMob/IAP, production deploy, push, or expensive benchmark run was performed.

## Executive Summary

The branch is technically ready for a final Minimal Core 60 rerun procedure, but the rerun should not be called "clean" until the unrelated dirty/untracked worktree items are resolved or intentionally isolated.

Recommendation: `BLOCKED BY DIRTY WORKTREE`

Selected final model config:

- Model: `gpt-5-nano`
- Reasoning effort: `low`

Reason for selected config:

- The model A/B concluded `KEEP GPT-5-NANO LOW`.
- `gpt-5.4-nano none` was faster and used fewer total tokens, but estimated cost was higher and Q03 hard-intent quality regressed on XOM-Q03 and WMT-Q03.

## Current Branch / HEAD

Command results:

```text
git branch --show-current
v1.1-worker-quality-token-retrieval

git rev-parse --short HEAD
ae2f9b8
```

Recent commits:

```text
ae2f9b8 (HEAD -> v1.1-worker-quality-token-retrieval) Summarize v1.1 Worker quality branch
43fa3d8 Run minimal core model config comparison
ce53df0 Support explicit OpenAI reasoning none
ab996d1 Compare minimal core model configs
818387b Clean up CAT Q06 wording
```

## Worktree Status

The worktree is not clean.

Current dirty/untracked files are classified below. None of these were staged or modified by this prep task before creating this report.

### Unrelated iOS Change

| File | Status | Classification | Action before clean rerun |
| --- | --- | --- | --- |
| `ios/Kabuyomi/Features/Settings/SettingsView.swift` | modified | unrelated iOS change | Stash, commit separately, or otherwise isolate before final clean rerun. |
| `ios/project.yml` | modified | unrelated iOS change | Stash, commit separately, or otherwise isolate before final clean rerun. |

### Unrelated Legal-Site Change

| File | Status | Classification | Action before clean rerun |
| --- | --- | --- | --- |
| `legal-site/scripts/validate.mjs` | modified | unrelated legal-site change | Stash, commit separately, or otherwise isolate before final clean rerun. |
| `legal-site/public/app-ads.txt` | untracked | unrelated legal-site change / unknown human decision | Decide whether this belongs to legal/site work, then commit separately, ignore, or remove. |

### Canonical Quality Artifact

| File | Status | Classification | Action before clean rerun |
| --- | --- | --- | --- |
| `docs/quality/V1_1_DIAGNOSTICS_BENCHMARK_RUN.md` | untracked | canonical quality artifact candidate, but old/uncommitted | Human decision: commit if this is intended canonical evidence, or archive/ignore if superseded by later reports. |

### Old / Intermediate Benchmark Artifacts

These are useful phase evidence trails, but they are not required for the final clean rerun command itself and should not be staged merely because they exist locally.

| Pattern / files | Status | Classification | Action before clean rerun |
| --- | --- | --- | --- |
| `workers/testbench/runs/2026-05-06-v1-1-diagnostics-minimal-core-60*.json*` | untracked | old/intermediate benchmark artifact | Keep local, archive, or commit only if explicitly needed as canonical evidence. |
| `workers/testbench/runs/2026-05-06-v1-1-phase-3c-q03*.json*` | untracked | old/intermediate benchmark artifact | Keep local or archive; do not stage for final rerun prep. |
| `workers/testbench/runs/2026-05-06-v1-1-phase-3i-q03-q04*.json*` | untracked | old/intermediate benchmark artifact | Keep local or archive; do not stage for final rerun prep. |
| `workers/testbench/runs/2026-05-06-v1-1-phase-3j-q03-q04*.json*` | untracked | old/intermediate benchmark artifact | Keep local or archive; do not stage for final rerun prep. |
| `workers/testbench/runs/2026-05-06-v1-1-phase-3l-q03-q04*.json*` | untracked | old/intermediate benchmark artifact | Keep local or archive; do not stage for final rerun prep. |
| `workers/testbench/runs/2026-05-06-v1-1-phase-3m-q05-q06*.json*` | untracked | old/intermediate benchmark artifact | Keep local or archive; do not stage for final rerun prep. |
| `workers/testbench/runs/2026-05-06-v1-1-q06-3-q05-q06*.json*` | untracked | old/intermediate benchmark artifact | Keep local or archive; do not stage for final rerun prep. |

### Required Final Rerun Artifact

None yet. The final Minimal Core 60 rerun has not been run in this task.

When it is run, the expected new artifacts are:

- `workers/testbench/runs/2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low.jsonl`
- `workers/testbench/runs/2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low-summary.json`

If this run ID already exists at run time, use a clearly versioned suffix such as `-r2` rather than overwriting prior artifacts.

## Test Worker Config Status

Checked file:

- `workers/wrangler.test.toml`

Current checked-in test config:

```toml
name = "kabuyomi-api-test"
OPENAI_CHAT_MODEL = "gpt-5-nano"
OPENAI_REASONING_EFFORT = "minimal"
KABUYOMI_ENV = "test"
ENVIRONMENT = "test"
```

Interpretation:

- The test Worker config file is restored to checked-in defaults.
- The final clean rerun should temporarily deploy the test Worker with CLI `--var` overrides for `gpt-5-nano` and `low`.
- After the run, restore checked-in config with `npm run deploy:test`.
- No production deploy should be run.

`npm run dryrun:test` also passed and showed the checked-in test config using:

- `OPENAI_CHAT_MODEL = "gpt-5-nano"`
- `OPENAI_REASONING_EFFORT = "minimal"`

## Validation Run

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

No Minimal Core 60 rerun, test Worker deploy, production deploy, or push was performed.

## Exact Final Minimal Core 60 Rerun Command

Run only after the dirty worktree decision is resolved.

Deploy selected config to the test Worker:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers

./node_modules/.bin/wrangler deploy --config wrangler.test.toml \
  --var OPENAI_CHAT_MODEL:gpt-5-nano \
  --var OPENAI_REASONING_EFFORT:low
```

Run Minimal Core 60:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-07-v1-1-final-minimal-core-60-gpt-5-nano-low \
OPENAI_CHAT_MODEL=gpt-5-nano \
OPENAI_REASONING_EFFORT=low \
npm run testbench:run
```

Restore checked-in test config after the run:

```bash
npm run deploy:test
```

Do not deploy production.

## Final-Rerun Acceptance Criteria

The future final run should pass all of the following:

- 60 rows complete.
- Every model-attempt row records effective model `gpt-5-nano`.
- Every model-attempt row records effective reasoning effort `low`.
- `reasoningEffortInvalid=false`.
- `sourceIdsValid=false`: 0.
- `rawEnglishInAnswer`: 0.
- `rawEnglishSurfaced`: 0.
- visible malformed currency: 0.
- no unsupported investment advice.
- no stock forecast / price target / buy-sell recommendation.
- no wrong ticker.
- no wrong period.
- no material numeric or sign error.
- Q03 should not materially regress from A/B Config A.
- Q04 should remain acceptable.
- Q06 safe fallbacks should be reviewed and accepted.
- Infra/provider-contaminated rows should be 0, or excluded and rerun if material.
- Test Worker must be restored to checked-in config after the run.

## Human Decisions Needed Before Rerun

1. Decide how to handle unrelated iOS modified files:
   - `ios/Kabuyomi/Features/Settings/SettingsView.swift`
   - `ios/project.yml`
2. Decide how to handle unrelated legal-site modified/untracked files:
   - `legal-site/scripts/validate.mjs`
   - `legal-site/public/app-ads.txt`
3. Decide whether `docs/quality/V1_1_DIAGNOSTICS_BENCHMARK_RUN.md` is canonical and should be committed, or whether it is superseded by later branch-summary/model-A-B docs.
4. Decide whether old untracked `2026-05-06-*` benchmark artifacts should remain local, be archived outside git, or be intentionally committed in a separate evidence commit.
5. Confirm Q06 safe fallback acceptance criteria before treating the next clean run as production-candidate evidence.

## Recommendation

`BLOCKED BY DIRTY WORKTREE`

The branch code and test config are ready for the final rerun mechanics, and validation passed. However, a "final clean rerun" should wait until unrelated dirty/untracked files are resolved or explicitly isolated.
