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
  "evalMode": "full",
  "runStartedAt": "2026-04-26T11:00:00.000Z",
  "rowStartedAt": "2026-04-26T11:00:03.000Z",
  "baseURL": "https://kabuyomi-api.example.workers.dev",
  "deviceKey": "eval-chat-quality-v1",
  "appVersion": "8a832f9",
  "ticker": "AAPL",
  "filingKey": "v6:0000320193:000032019326000006",
  "questionId": "AAPL-01",
  "question": "何の会社？",
  "answer": "...",
  "responsePath": "gemini",
  "fallbackReason": null,
  "promptTokenCount": 1200,
  "sourceCount": 2,
  "latencyMs": 900,
  "creditBillingEnabled": true,
  "creditsCharged": 2,
  "creditsRemaining": 498,
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

Validate a recorded run before comparing it:

```bash
npm run eval:chat:validate-run -- ./eval/runs/<run-id>.jsonl
```

## Pilot Run

The pilot runner executes only one question per ticker. It uses `GET /v1/company/{ticker}` to resolve the current filing key, then calls `/v1/chat`.

```bash
KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api.example.workers.dev npm run eval:chat:pilot
```

Output is written to `eval/runs/<runId>.jsonl`. Live runs consume chat credits.

## Dynamic Full Benchmark

Use `KABUYOMI_EVAL_TICKERS` when you want the same benchmark questions against any ticker set.

The dynamic benchmark uses 10 standard questions per ticker:

1. `何の会社？`
2. `売上成長の要因は？`
3. `その要因は一時的？`
4. `利益率が悪化した理由は？`
5. `リスクは？`
6. `前回決算との違いは？`
7. `売上の柱は？`
8. `キャッシュフローは強い？`
9. `投資家目線で良い点と悪い点は？`
10. `この資料だけでは分からないことは？`

Question 3 is sent with `conversationContext` from question 2 for the same ticker, so follow-up grounding is tested as an actual chat flow.

Example full run for 5 tickers:

```bash
KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_EVAL_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
KABUYOMI_EVAL_DETACHED_ACCESS=dev_unlimited \
KABUYOMI_EVAL_TICKERS=CRWD,CL,VRT,LMT,NEM \
KABUYOMI_EVAL_MODE=full \
KABUYOMI_EVAL_LIMIT=50 \
npm run eval:chat:pilot
```

For a full run:

```bash
KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api.example.workers.dev \
KABUYOMI_EVAL_DEVICE_KEY=eval-chat-quality-v1 \
KABUYOMI_EVAL_MODE=full \
KABUYOMI_EVAL_LIMIT=50 \
npm run eval:chat:pilot
```

For a targeted regression run:

```bash
KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api.example.workers.dev \
KABUYOMI_EVAL_DEVICE_KEY=eval-chat-quality-v1 \
KABUYOMI_EVAL_QUESTION_IDS=AAPL-01,AAPL-02,MSFT-01,MSFT-02,GOOGL-06,GOOGL-07,GOOGL-08,AMZN-02 \
npm run eval:chat:pilot
```

## Contract

The current quality contract is documented in:

```text
../../docs/quality/chat_quality_contract.md
```

Use the local test console for quick manual checks:

```text
http://127.0.0.1:5187
```
