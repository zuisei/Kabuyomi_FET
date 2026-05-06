# Chat Quality Contract

Kabuyomi の `/v1/chat` 改善で守る最低契約。

目的は、Gemini prompt / context-pack / fallback / deterministic を触る前に、返答品質を比較できる状態に固定すること。

## 対象

```text
Route:
  POST /v1/chat

Main code:
  workers/src/routes/chat.ts
  workers/src/lib/chat/orchestrator.ts
  workers/src/lib/chat/context-pack.ts
  workers/src/clients/gemini/prompts.ts
  workers/src/clients/gemini/fallback.ts
  workers/src/lib/chat/deterministic.ts
  workers/src/lib/chat/grounding.ts

Eval:
  workers/eval/chat-quality-v1.jsonl
  workers/scripts/run-chat-eval-pilot.mjs
  workers/scripts/validate-chat-eval.mjs
```

## 固定する質問セット

一次評価セットは `workers/eval/chat-quality-v1.jsonl`。

```text
version:
  chat-quality-v1

size:
  5 tickers x 10 questions = 50 rows

tickers:
  AAPL
  MSFT
  NVDA
  AMZN
  GOOGL
```

この dataset は、prompt や context selection を変えるたびに書き換えない。  
新しい観点が必要になったら `chat-quality-v2` として別 version を作る。

## 返答の最低契約

`/v1/chat` の成功 response は以下を守る。

```text
answer:
  空ではない日本語回答

sources:
  配列
  SEC filing に紐づく source を返す
  unsupported answer の場合だけ空配列を許容

responsePath:
  gemini | deterministic | fallback | historical

modelName:
  responsePath が gemini の時だけ remote model 名
  それ以外は null

usage:
  chat quota / creditBillingEnabled を含む
```

返答品質としては以下を満たす必要がある。

```text
質問意図に合っている
資料にない断定をしない
数字を聞かれたら可能な範囲で数字を出す
source が answer の根拠になっている
短い follow-up は直前文脈で補完される
Gemini が失敗しても fallback / deterministic の理由が追える
```

## 観測するシグナル

今コード上で重要なシグナル。

```text
questionIntent:
  classifyQuestionIntent の結果

responsePath:
  gemini / deterministic / fallback / historical

fallbackReason:
  gemini_timeout
  gemini_api_error
  schema_invalid
  json_parse_failed
  invalid_source_id
  no_sources
  weak_grounding
  low_quality_answer
  deterministic_repair
  metrics_only_insufficient

sourceCount:
  最終 response の sources 数

sourceIdsValid:
  Gemini が返した sourceIds が contextPack 内で有効か

retryReason:
  model retry の理由
```

`questionIntent` や `fallbackReason` は log 側に加えて、test Worker では `/v1/chat` response の `debug` にも返す。  
本番通常 response には `debug` を返さない。

```json
{
  "debug": {
    "questionIntent": "business_overview",
    "responsePath": "fallback",
    "fallbackReason": "schema_invalid",
    "sourceCount": 2,
    "sourceIds": ["S1", "S2"],
    "sourceIdsValid": true,
    "contextApplied": false,
    "modelName": null,
    "retryReason": "schema_invalid"
  }
}
```

## 評価ラベル

手動評価では以下を使う。

```text
good
too_generic
missing_numbers
wrong_section
off_topic
unsupported_claim
missing_source
wrong_source
too_vague
over_refusal
missed_key_point
numeric_error
stale_context
bad_comparison
bad_japanese
too_short
```

最低ライン:

```text
P0 regression:
  unsupported_claim
  wrong_source
  stale_context
  numeric_error

P1 regression:
  too_generic
  missing_numbers
  wrong_section
  over_refusal
  bad_japanese
  too_short
```

## 作業前後の確認

安全な最小確認。

```bash
cd workers
npm run eval:chat:validate
npm test -- chat-route.test.ts chat-context.test.ts chat-intent-context.test.ts
npm run typecheck
```

test Worker で手動確認。

```bash
cd workers
KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_EVAL_DEVICE_KEY=eval-chat-quality-v1-test \
npm run eval:chat:pilot
```

ローカル UI。

```text
http://127.0.0.1:5187

使うタブ:
  Question Set
  Compare Log
  Custom
```

## 改修時の判定

prompt / context-pack / fallback を触った後は、以下を比較する。

```text
1. responsePath が意図せず fallback に寄っていないか
2. sourceCount が大きく減っていないか
3. 「何の会社？」が一般論になっていないか
4. 「なぜ？」「その要因は一時的？」が文脈を失っていないか
5. 数字質問で missing_numbers が増えていないか
6. risk 質問で wrong_section / unsupported_claim が増えていないか
```

## 触ってはいけないこと

```text
dataset を変更して改善したように見せない
response shape を無断で広げない
source なし回答を通常成功扱いにしない
fallbackReason を generic failure に潰さない
questionIntent を prompt 文言だけの問題にしない
```
