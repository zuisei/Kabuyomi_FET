# Kabuyomi Testbench

`testbench` is the quality benchmark workspace for Worker chat answers. It is separate from the older `eval/` folder so benchmark rules, ticker sets, runs, and summaries can move together without mixing with ad hoc investigation logs.

## Goal

Measure whether Kabuyomi answers are useful SEC filing explanations, not just plausible text.

The first benchmark is:

- 5 tickers x 12 questions = 60 cases
- tickers are swappable
- follow-up questions are sent with conversation context
- every response is saved with Worker diagnostics when available
- human review can add ratings and failure labels after the run

## Files

```text
testbench/
  README.md
  rubric.md
  failure-labels.md
  judge-prompt.md
  company-sets/
    minimal-5.json
  questions/
    core-12.jsonl
  scripts/
    run-benchmark.mjs
    summarize-runs.mjs
    validate-testbench.mjs
  runs/
    .gitkeep
```

## Run Against Test API

```bash
cd workers
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TEST_AUTOMATION_SECRET=<matching-protected-test-secret> \
npm run testbench:run
```

The output is written to:

```text
workers/testbench/runs/<run-id>.jsonl
```

## Final Prompt-v2 Full Smoke

Use this for the final answer-quality evidence run after deploying the test Worker. It runs the expanded multi-sector company set against the prompt-v2 smoke questions, writes the answer report automatically, and then applies the quality gate with required-template and ticker-count coverage checks.

```bash
cd workers
npm run secrets:test:setup
npm run testbench:live-full-smoke
```

Check the final-run inputs without calling the Worker:

```bash
npm run testbench:full-smoke -- --check-only
```

Pull-request CI verifies exact-candidate accepted evidence by default. A prior accepted packet is permitted only when `RELEASE_GATE_STATE.json` records an owner-approved one-time waiver that binds the current candidate, the prior quality candidate, the release date, and the fact that the normal production deploy guard must continue failing until refreshed:

```bash
npm run testbench:full-smoke -- --verify-manifest-or-approved-waiver
```

This CI-only acknowledgement does not change `npm run deploy` or `npm run deploy:check`; both still require accepted evidence for the exact current candidate.

`secrets:test:setup` prompts for an existing `OPENAI_API_KEY` and `CLOUDFLARE_API_TOKEN` without echoing them, writes them to ignored `workers/.dev.vars`, and uploads `OPENAI_API_KEY` to the test Worker secret store. If both variables are already exported in the shell, the command uses those values without prompting.

`testbench:live-full-smoke` loads `workers/.dev.vars`, deploys the test Worker, runs the full-smoke input preflight, applies the automated gate, and writes a pending 150-row human-review packet. This generation phase is never release-complete by itself. Override the run id with `KABUYOMI_TESTBENCH_RUN_ID=...` when needed.

Defaults used by `testbench:full-smoke`:

- `KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- `KABUYOMI_TESTBENCH_COMPANY_SET=testbench/company-sets/prompt-v2-expanded-multisector.json`
- `KABUYOMI_TESTBENCH_QUESTIONS=testbench/questions/prompt-v2-smoke-10.jsonl`
- `KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES=Q01,Q02,Q03,Q04,Q05,Q06,Q07,Q08,Q09,Q10`
- `KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS=15`
- `KABUYOMI_QUALITY_GATE_MIN_ROWS=150`

## Swap Tickers

Use an inline ticker list:

```bash
KABUYOMI_TESTBENCH_TICKERS=AAPL,JPM,XOM,CAT,WMT npm run testbench:run
```

Or point to another company-set file:

```bash
KABUYOMI_TESTBENCH_COMPANY_SET=./testbench/company-sets/minimal-5.json npm run testbench:run
```

## Summarize A Run

```bash
npm run testbench:summarize -- ./testbench/runs/<run-id>.jsonl
```

This produces a compact summary of response paths, fallback reasons, source counts, latency, and manually assigned ratings/failure labels when present.

## Review Workflow

1. Run the benchmark against the test API.
2. Generate the complete review packet. Sampling is not accepted for a release run:

   ```bash
   npm run testbench:review-packet -- ./testbench/runs/<run-id>.jsonl ./testbench/runs/<run-id>-human-review.json
   ```

3. Review every row against its question, checklist, filing period, numeric facts, and returned source excerpts. Record the reviewer and timestamp, set `result=pass`, and set all five review dimensions to `true` only when the answer is valid. Keep failure labels and notes on any failed row.
4. Seal the fully completed packet. Sealing refuses pending/failed rows and binds the exact review content and source-run digest:

   ```bash
   npm run testbench:review-seal -- ./testbench/runs/<run-id>-human-review.json <reviewer> ./testbench/runs/<run-id>.jsonl
   ```

5. Validate that the sealed packet is complete and still matches the exact source-run hash:

   ```bash
   npm run testbench:review-gate -- ./testbench/runs/<run-id>-human-review.json ./testbench/runs/<run-id>.jsonl
   ```

6. Verify release completion against the existing run and sealed packet:

   ```bash
   npm run testbench:full-smoke -- --release-verify \
     --run-path ./testbench/runs/<run-id>.jsonl \
     --human-review-packet ./testbench/runs/<run-id>-human-review.json
   ```

7. If any gate fails, run `testbench:summarize`, fix every failed row and systemic pattern, create a new run ID, and repeat. A packet with omitted rows, pending/failed reviews, missing provenance, a failed review dimension, duplicate case IDs, a changed review-content hash, or a source-run hash mismatch is a hard release failure.

The first quality pass should focus on:

1. `retrieval_missing_mda`
2. `metric_without_driver`
3. `followup_context_lost`
4. `fallback_too_generic`
5. `vague_answer`
