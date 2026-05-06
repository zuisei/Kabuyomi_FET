# Chat Route Notes

`workers/src/routes/chat.ts` は `/v1/chat` の受付。

ここは返答品質そのものを作る場所ではなく、チャット API としての外枠を守る場所。

現在は `workers/src/lib/chat/usecase.ts` の `answerChatUsecase()` に、quota / credit / filing preparation / answer generation / refund / response shaping を寄せている。

## 今の役割

```text
POST /v1/chat
  |
  v
payload を検証
  |
  v
filingKey で requested filing を読む
  |
  v
stale / missing filing は 404
  |
  v
device key / quota identity を読む
  |
  v
metrics_only filing なら full upgrade を試す
  |
  v
chat quota / credit を消費
  |
  v
conversationContext から短い質問を補完
  |
  v
buildChatResponse()
  |
  v
失敗または non-chargeable なら refund
  |
  v
answer / sources / responsePath / usage を返す
```

現在の分担:

```text
routes/chat.ts
  payload 検証
  filingKey lookup
  stale / missing filing の 404
  InsufficientCreditsError の HTTP response

lib/chat/usecase.ts
  device key / quota identity
  metrics_only upgrade
  charge / refund
  conversationContext 補完
  buildChatResponse()
  response shaping
```

## 今すぐ触らない理由

`routes/chat.ts` は以前より薄くなった。まだ usecase 側は太いが、HTTP 受付と chat 実行の境界は見えやすくなっている。

返答品質の本体は主に以下。

```text
workers/src/lib/chat/orchestrator.ts
workers/src/lib/chat/context-pack.ts
workers/src/clients/gemini.ts
workers/src/clients/gemini/fallback.ts
workers/src/lib/chat/deterministic.ts
workers/src/lib/chat/grounding.ts
```

## 将来の修正候補

### 1. usecase をさらに分ける

今は `answerChatUsecase()` が以下を持っている。

```text
受付
filing 準備
課金
返金
conversationContext 補完
response shaping
```

将来的には usecase に寄せる。

```text
answerChatUsecase()
  |
  +-- prepareChatFiling()
  +-- charge/refund policy
  +-- buildChatResponse()
  +-- shapeChatResponse()
```

次は charge/refund policy と response shaping を必要に応じて分ける。

### 2. `prepareFilingForChat()` の重さを逃がす

`metrics_only` filing の場合、chat request 中に `upgradeMetricsOnlyRecord()` を試す。

これは回答品質には効くが、重くなりうる。

```text
chat request
  |
  v
metrics_only upgrade
  |
  v
SEC HTML fetch / MD&A extraction / summary generation
```

将来的には以下を検討する。

```text
full upgrade を job 化
chat では metrics_only 用の回答方針を明確にする
upgrade 中なら preparing / limited answer にする
```

### 3. charge / refund の契約を明文化する

今は回答生成前に quota / credit を消費し、失敗時に refund する。

守るべき契約。

```text
buildChatResponse が throw
  -> refund する

answer.chargeable === false
  -> refund する

InsufficientCreditsError
  -> consume されていないので refund 不要
```

この周辺は壊すと「失敗したのに課金された」になるため、修正時はテスト優先。

### 4. conversationContext 補完の置き場所を整理する

今は route 側で `resolveContextualQuestion()` している。

```text
routes/chat.ts
  -> resolveContextualQuestion()
  -> buildChatResponse()
```

将来的には chat usecase の前処理に寄せたい。

理由:

```text
route は HTTP 受付に集中できる
chat の文脈処理を chat 側にまとめられる
テスト対象が分かりやすくなる
```

### 5. デバッグ情報の返し方を決める

今の API response は主にこれ。

```json
{
  "answer": "...",
  "sources": [],
  "responsePath": "gemini",
  "modelName": "...",
  "usage": {},
  "creditsCharged": 2,
  "creditsRemaining": 123
}
```

ログには `questionIntent`, `fallbackReason`, `sourceIdsValid`, `retryReason` があるが、API には返していない。

将来的に dev/debug 限定で返すか検討する。

```text
通常ユーザー向け API contract は広げすぎない
debug/dev mode だけ詳細 metadata を返す
または logs / local viewer で見る
```

## 触る時の注意

`routes/chat.ts` を触る時に必ず見るテスト。

```text
workers/test/chat-route.test.ts
workers/test/index.test.ts
workers/test/pipeline.test.ts
workers/test/chat-context.test.ts
workers/test/credit-quota.test.ts
```

最低確認コマンド。

```bash
cd workers
npm test -- chat-route.test.ts chat-context.test.ts credit-quota.test.ts
npm run typecheck
```

広く確認するなら。

```bash
cd workers
npm test
```

## 現時点の判断

`routes/chat.ts` は将来的に整理したいが、今すぐ大改修する場所ではない。

まずは以下を優先する。

```text
1. 地図と責務の明文化
2. chat contract / refund contract のテスト維持
3. 返答品質は context-pack / fallback / deterministic / grounding 側で見る
4. 重い filing upgrade は将来 job 化
```
