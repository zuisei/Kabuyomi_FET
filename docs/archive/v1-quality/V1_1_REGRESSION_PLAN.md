# Kabuyomi v1.1 Regression Plan

Date: 2026-05-06 JST

## Purpose

Keep v1.1 retrieval/token improvements measurable without weakening v1 answer-safety gates.

## Seed Cases

Seed file: `workers/testbench/regression/failed-cases.jsonl`

Initial cases cover:

- AAPL Q03/Q04/Q06 hard-intent fallback rows
- JPM Q03/Q04/Q06 hard-intent fallback rows
- malformed currency formatting
- non-bank bank-word leakage
- Dominion quote translation proper noun guard
- hard-intent source insufficiency

## Comparison Workflow

Use the non-LLM diff tool after each benchmark run:

```bash
cd workers
node ./testbench/scripts/diff-runs.mjs ./testbench/runs/<before>.jsonl ./testbench/runs/<after>.jsonl
```

Join key:

- `caseId`
- `ticker`
- `templateId`

Review fields:

- `responsePath`
- `fallbackReason`
- `fallbackKind`
- `sourceIdsValid`
- `selectedSourceCount`
- `selectedSourceLabels`
- `selectedSourceTypes`
- `selectedSourceSectionFamilies`
- token fields
- latency
- source-gate failure labels

## Hold Conditions

Keep the branch on test only if any of these appear:

- `sourceIdsValid=false` increases
- hard-intent fallback rate worsens
- wrong ticker or wrong period appears
- unsupported investment advice appears
- non-bank answers emit bank-only terms
- malformed numeric/currency output appears
- raw English/internal leakage reaches final answer
- local Worker tests fail

## Oracle Context Mode

Not implemented in this slice. Design target:

- allow a test case to specify exact source IDs, section families, or a fixed context pack
- run the same prompt once through production retrieval and once through oracle context
- compare whether failure is retrieval-side or synthesis-side
