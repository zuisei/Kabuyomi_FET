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
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
KABUYOMI_TESTBENCH_DETACHED_ACCESS=dev_unlimited \
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

`secrets:test:setup` prompts for an existing `OPENAI_API_KEY` and `CLOUDFLARE_API_TOKEN` without echoing them, writes them to ignored `workers/.dev.vars`, and uploads `OPENAI_API_KEY` to the test Worker secret store. If both variables are already exported in the shell, the command uses those values without prompting.

`testbench:live-full-smoke` loads `workers/.dev.vars`, deploys the test Worker, runs the full-smoke input preflight, and then runs the final live quality gate. Override the run id with `KABUYOMI_TESTBENCH_RUN_ID=...` when needed.

Defaults used by `testbench:full-smoke`:

- `KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- `KABUYOMI_TESTBENCH_COMPANY_SET=testbench/company-sets/prompt-v2-expanded-multisector.json`
- `KABUYOMI_TESTBENCH_QUESTIONS=testbench/questions/prompt-v2-smoke-10.jsonl`
- `KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES=Q01,Q02,Q03,Q04,Q05,Q06,Q07,Q08,Q09,Q10`
- `KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS=10`
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
2. Open the JSONL run file.
3. Add human-review fields if needed:
   - `answerRating`
   - `failureLabelsObserved`
   - `notes`
4. Run `testbench:summarize`.
5. Fix the highest-frequency failure labels first.

The first quality pass should focus on:

1. `retrieval_missing_mda`
2. `metric_without_driver`
3. `followup_context_lost`
4. `fallback_too_generic`
5. `vague_answer`
