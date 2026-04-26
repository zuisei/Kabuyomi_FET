# Kabuyomi Chat Quality Evaluation

This folder holds the fixed manual evaluation set for chat quality work.

## Q1 Dataset

- File: `chat-quality-v1.jsonl`
- Scope: 5 tickers x 10 questions = 50 rows
- Tickers: AAPL, MSFT, NVDA, AMZN, GOOGL
- Goal: keep AI quality changes measurable before changing prompts, extraction, context selection, or models.

Each row is one question with expected focus areas and allowed failure labels. The dataset should stay stable unless a new version is intentionally created.

## Manual Result Row

When recording an evaluation run, write one JSON object per answer:

```json
{
  "evalSetVersion": "chat-quality-v1",
  "runId": "2026-04-26-baseline",
  "ticker": "AAPL",
  "questionId": "AAPL-01",
  "question": "何の会社？",
  "answer": "...",
  "responsePath": "gemini",
  "fallbackReason": null,
  "promptTokenCount": 1200,
  "sourceCount": 2,
  "latencyMs": 900,
  "answerRating": 4,
  "failureLabelsObserved": ["good"],
  "notes": ""
}
```

## Failure Labels

- `good`
- `too_generic`
- `missing_numbers`
- `wrong_section`
- `off_topic`
- `unsupported_claim`
- `missing_source`
- `wrong_source`
- `too_vague`
- `over_refusal`
- `missed_key_point`
- `numeric_error`
- `stale_context`
- `bad_comparison`
- `bad_japanese`
- `too_short`

Run `npm run eval:chat:validate` before relying on the dataset.

## Pilot Run

The pilot runner executes only one question per ticker. It uses `GET /v1/company/{ticker}` to resolve the current filing key, then calls `/v1/chat`.

```bash
KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api.example.workers.dev npm run eval:chat:pilot
```

Output is written to `eval/runs/<runId>.jsonl`. Live runs consume chat credits.
