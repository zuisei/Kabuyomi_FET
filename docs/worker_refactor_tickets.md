# Kabuyomi Worker Refactor Tickets

Worker 改修を安全に進めるためのローカル作業チケット。

目的は「何を触るか」「何を触らないか」「完了条件」を先に固定して、返答品質改善と信頼性改善を本番事故なしで進めること。

## 進め方

```text
1 ticket = 1 small slice
挙動変更と refactor を混ぜない
本番 deploy 前に test Worker で叩く
chat 改善は local Web UI で前後比較する
```

## 検証環境

```text
Test Worker:
  https://kabuyomi-api-test.dznqjmctk7.workers.dev

Local Web UI:
  http://127.0.0.1:5187

Local UI path:
  .kabuyomi-local/test-api-console
```

## Ticket 001 - Local test console を評価道具にする

優先度: P0
リスク: 安全
状態: Done

目的:

```text
API を iOS なしで直接叩けるようにし、chat 返答改善の前後比較を楽にする。
```

対象:

```text
.kabuyomi-local/test-api-console
```

やること:

```text
Question Set タブ
Compare Log タブ
Custom direct request タブ
fallbackReason / questionIntent / sourceIds の見やすい表示
同じ質問の連続実行
ログ export
```

完了条件:

```text
ブラウザから test Worker を叩ける
よく使う chat 質問をボタンで送れる
修正前後の response を左右比較できる
本番 Worker URL を誤って叩けない
```

検証:

```text
curl http://127.0.0.1:5187/api/config
local UI -> Search AAPL
local UI -> Question Set
local UI -> Compare Log
```

実装メモ:

```text
Question Set / Compare Log / Custom direct request を追加済み。
response signals に status / intent / fallback / path / sources / latency を表示する。
Question Set の 3x で同じ質問を連続実行できる。
Compare Log から JSON export できる。
```

## Ticket 002 - Chat quality contract を作る

優先度: P0
リスク: 安全
状態: Done

目的:

```text
返答品質を「気分」ではなく、最低限守る契約として固定する。
```

対象:

```text
workers/src/routes/chat.ts
workers/src/lib/chat/*
workers/src/clients/gemini/*
workers/test/*
docs/chat_route_notes.md
```

やること:

```text
代表質問セットを定義する
期待する最低条件を定義する
fallbackReason の分類を固定する
questionIntent を観測対象にする
sourceIds / grounding の最低条件を決める
```

完了条件:

```text
chat response に必要な観測項目が分かる
品質低下時にどこで落ちたか追える
Gemini / fallback / deterministic の違いを比較できる
```

検証:

```text
npm test
local Web UI の Question Set / Compare Log
```

実装メモ:

```text
docs/chat_quality_contract.md を追加済み。
workers/eval/chat-quality-v1.jsonl を一次評価セットとして固定。
workers/scripts/validate-chat-run.mjs で eval run の JSONL 形を検証できる。
```

## Ticket 003 - routes/chat.ts を usecase に切り出す

優先度: P1
リスク: 中間
状態: Done

目的:

```text
/v1/chat の route を薄くして、返答品質の本体と HTTP 受付を分ける。
```

対象:

```text
workers/src/routes/chat.ts
workers/src/lib/chat/*
workers/test/*
```

やること:

```text
answerChatUsecase を作る
payload validation は route 側に残す
charge/refund 契約をテストで固定する
response shape を変えない
挙動変更なしの refactor として進める
```

完了条件:

```text
routes/chat.ts が受付中心になる
buildChatResponse 呼び出し前後の責務が読みやすい
既存 response shape が壊れていない
quota / refund の動きが壊れていない
```

検証:

## Ticket 004 - Chat diagnostics / source validation を薄く分離する

優先度: P1
リスク: 低
状態: Done

目的:

```text
orchestrator.ts / usecase.ts に残っている「返答経路の本体ではない補助責務」を外に出す。
挙動は変えず、sourceId 検証と chat quality log/debug payload の形を専用 helper に固定する。
```

対象:

```text
workers/src/lib/chat/orchestrator.ts
workers/src/lib/chat/usecase.ts
workers/src/lib/chat/source-validation.ts
workers/src/lib/chat/diagnostics.ts
workers/test/chat-source-validation.test.ts
workers/test/chat-diagnostics.test.ts
```

今回やること:

```text
sourceId validation / source lookup / fallback valid source set を source-validation.ts に分離
context debug fields / answerQualityFlags / chat_quality_pipeline payload を diagnostics.ts に分離
public response shape, log field names, billing/quota/auth behavior は変えない
```

今回やらないこと:

```text
context-pack.ts の scoring / factual-pack 分割
fallback.ts の回答生成 / profile / translation 分割
latest.ts / ingest.ts / content-upgrade.ts の filing pipeline 分割
watchlist add async の Queue / Workflow 化
quota / credit / billing / entitlement の意味変更
prompt / model / UI の変更
production deploy
```

完了条件:

```text
targeted chat tests が通る
typecheck が通る
full test が通る
test Worker deploy は必要な場合だけ
```

```text
cd workers && npm run typecheck
cd workers && npm test
test deploy
local Web UI -> Chat / Question Set
```

実装メモ:

```text
workers/src/lib/chat/usecase.ts を追加済み。
routes/chat.ts は payload validation / filing lookup / error response 中心になった。
charge/refund / metrics_only upgrade / response shaping は answerChatUsecase に移動。
response shape は変更しない。
```

## Ticket 004 - Chat debug metadata を見える化する

優先度: P1
リスク: 中間
状態: Done

目的:

```text
返答が悪い時に、原因が context 不足なのか Gemini 失敗なのか grounding 失敗なのか分かるようにする。
```

対象:

```text
workers/src/routes/chat.ts
workers/src/lib/chat/context-pack.ts
workers/src/lib/chat/grounding.ts
workers/src/clients/gemini/*
```

やること:

```text
debug/test 環境だけ metadata を返す設計にする
fallbackReason を細かく保持する
questionIntent を response/log で確認できるようにする
context chunk count / selected source count を見る
```

完了条件:

```text
本番 user-facing response を汚さない
test Worker / local UI では返答経路が見える
低品質回答の原因を分類できる
```

検証:

```text
local Web UI -> Chat response
local Web UI -> Compare Log
```

実装メモ:

```text
ChatResponsePayload.debug を追加済み。
test Worker 環境だけ /v1/chat response に debug を返す。
debug には questionIntent / responsePath / fallbackReason / sourceIdsValid / retryReason / sourceCount などを載せる。
Local Web UI の response signals で debug を表示する。
本番通常 response には debug を出さない。
```

## Ticket 005 - context-pack / prompts / fallback の改善順を固定する

優先度: P1
リスク: 中間

目的:

```text
Gemini 前提の品質改善を、周辺を壊さず進める。
```

対象:

```text
workers/src/lib/chat/context-pack.ts
workers/src/clients/gemini/prompts.ts
workers/src/clients/gemini/fallback.ts
workers/src/lib/chat/deterministic.ts
```

やること:

```text
まず context selection を観測する
次に prompt を小さく調整する
fallback は理由別に返答を分ける
deterministic は Gemini 失敗時の最低品質保証として扱う
```

完了条件:

```text
どの資料を Gemini に渡したか説明できる
Gemini 失敗時に何が返るか説明できる
短い follow-up 質問の文脈落ちを検出できる
```

検証:

```text
Question Set:
  何の会社？
  なぜ？
  その要因は一時的？
Compare Log で前後比較
```

実装メモ:

```text
短い「なぜ？」「その要因は一時的？」のような follow-up を mda_summary に分類する。
ただし「営業CF」「利益率」などの明示的な論点がある質問は専用 intent を優先する。
Gemini prompt に短い follow-up の扱いを追加し、driver / risk / demand / cost / margin / cash-flow / outlook の根拠へ寄せる。
Local Web UI は同じ filingKey の直近 chat から最大3往復の conversationContext を送れる。
response signals に contextApplied を表示する。
```

## Ticket 006 - watchlist-add async を job state 化する

優先度: P1
リスク: 危険
状態: Done / Queue 化は未完了

目的:

```text
waitUntil に長い filing 準備を積む構造をやめるための設計を作る。
```

対象:

```text
workers/src/routes/watchlist-add.ts
workers/src/lib/filings/*
workers/src/durable/*
```

やること:

```text
現状の async mode の副作用を洗い出す
job state の最小データ形を決める
retry / backpressure / progress の扱いを決める
Queue / Workflow を使うかは設計後に判断する
```

完了条件:

```text
実装前に job の状態遷移が説明できる
失敗時の retry と user response が説明できる
quota refund 条件が説明できる
```

検証:

```text
まず docs のみ
その後 test Worker で watchlist add
```

実装メモ:

```text
addWatchlistTickerUsecase への切り出しは完了。
routes/watchlist-add.ts は payload validation / async header 判定 / response conversion 中心になった。
filing_prep_jobs D1 table を追加し、async watchlist add は filingPrepJob を response に返す。
background 成功時は ready、失敗時は failed_retryable / failed_permanent に更新する。
GET /v1/filing-prep/jobs/:jobId で進捗を取得できる。
現行挙動維持のため waitUntil(ensureLatestFiling) はまだ usecase 内に残している。
次は Queue/Workflow へ逃がすか、まず retry endpoint を足すかを判断する。
```

## Ticket 007 - sec-fetcher payload 丸読み問題の設計

優先度: P1
リスク: 危険
状態: In Progress / 互換 path 実装済み、fetcher deploy 未実施

目的:

```text
巨大な 10-K HTML と companyFacts を Worker がまとめて抱える構造を減らす。
```

対象:

```text
workers/src/clients/sec-fetcher.ts
sec-fetcher/*
workers/src/lib/filings/*
```

やること:

```text
prepared-filing 形式を設計する
Worker に必要な最小情報を決める
R2 保存の責務境界を決める
fetcher に負荷を寄せすぎない設計にする
```

完了条件:

```text
Worker が巨大 JSON を text() -> JSON.parse し続けなくてよい設計になる
fetcher 側の責務増加が説明できる
移行中も現行 endpoint と互換を保てる
```

検証:

```text
まず docs のみ
次に test Worker / test R2 で小さく検証
```

実装メモ:

```text
Worker 側に fetchPreparedFilingFromFetcher / fetchPreparedFiling を追加済み。
sec-fetcher 側に /internal/sec/prepared-filing を追加済み。
旧 fetcher では 404 を null として扱い、既存 filing-assets path に fallback する。
このため Worker だけ先に test deploy しても production fetcher 互換で動く。
fetcher 本番/Railway deploy と本格切替はまだ未実施。
```

## Ticket 008 - ensureLatestFiling の side effect を分ける

優先度: P2
リスク: 危険

目的:

```text
一つの関数が filing fetch / persist / preload / upgrade を連鎖させる状態をほどく。
```

対象:

```text
workers/src/lib/filings/*
workers/src/lib/historical/*
workers/src/routes/company.ts
workers/src/routes/watchlist-add.ts
```

やること:

```text
ensureLatestFiling の副作用一覧を作る
user-facing に必要な処理と background 処理を分ける
history persistence を明示オプションにする
content upgrade を job に寄せる
```

完了条件:

```text
company view で必要な処理が明確
watchlist add で必要な処理が明確
background でよい処理が明確
```

検証:

```text
npm test
test Worker -> company / watchlist
local Web UI
```

## Ticket 009 - orchestrator.ts の policy 分割

優先度: P2
リスク: 中間
状態: In Progress / decision-log 分離済み

目的:

```text
司令塔が肥大化して、返答品質の調整点が分かりにくい状態を直す。
```

対象:

```text
workers/src/lib/chat/orchestrator.ts
workers/src/lib/chat/*
```

やること:

```text
intent policy
context policy
answer policy
grounding policy
fallback policy
を小さく分ける
```

完了条件:

```text
返答が悪い時に見るファイルが分かる
policy 単位でテストできる
Gemini 変更と context 変更を分けて扱える
```

検証:

```text
npm test
Question Set / Compare Log
```

実装メモ:

```text
lib/chat/decision-log.ts を追加し、chat_context_selection / chat_llm_usage / chat_path_decision の logging を分離した。
orchestrator.ts には retry / fallback / grounding repair の判断がまだ残っている。
次は retry policy か fallback policy を小さく切り出す。
```

## Ticket 010 - pipeline.ts 経由 import を増やさない

優先度: P2
リスク: 安全

目的:

```text
便利 barrel が依存関係を見えにくくするのを止める。
```

対象:

```text
workers/src/lib/pipeline.ts
workers/src/routes/*
workers/src/lib/*
```

やること:

```text
新規 import では pipeline.ts を使わない
次に触る route から直接 import に寄せる
一気に全置換しない
```

完了条件:

```text
依存元が追いやすくなる
不要な横断 import が増えない
```

検証:

```text
rg "from .*pipeline" workers/src
npm run typecheck
```

実装メモ:

```text
routes/company.ts は lib/company/usecase.ts へ移動済み。
routes/usage.ts は lib/quota 直接 import に変更済み。
lib/daily-refresh.ts は lib/filings/latest 直接 import に変更済み。
routes/internal-backfill-history.ts は lib/filings/history-persistence 直接 import に変更済み。
routes/watchlist-add.ts は lib/filings/latest 直接 import に変更済み。
既存の pipeline.ts 経由 import は解消済み。
```

## Ticket 011 - routes/company.ts を usecase に切り出す

優先度: P1
リスク: 中間
状態: Done

目的:

```text
/v1/company/:ticker の route を薄くして、company load / refresh の責務を分ける。
```

対象:

```text
workers/src/routes/company.ts
workers/src/lib/company/usecase.ts
workers/test/ticker-routes.test.ts
```

やること:

```text
loadCompanyUsecase を作る
refreshCompanyUsecase を作る
stale fallback policy を usecase 側に移す
route は ticker validation と response conversion 中心にする
pipeline.ts 経由 import を company route から外す
```

完了条件:

```text
routes/company.ts が HTTP 受付中心になる
GET と refresh の重複が減る
SEC/fetcher 503 時の stale fallback 挙動が変わらない
```

検証:

```text
cd workers && npm test -- ticker-routes.test.ts company-response.test.ts latest-filing.test.ts
cd workers && npm run typecheck
```

## Ticket 012 - response.ts の JSON を compact 化する

優先度: P2
リスク: 中間
状態: Done

目的:

```text
API response の意味を変えずに、pretty JSON の不要な空白を減らす。
```

対象:

```text
workers/src/lib/response.ts
```

やること:

```text
JSON.stringify(data, null, 2) を JSON.stringify(data) にする
response helper の header は維持する
```

完了条件:

```text
JSON payload が compact になる
response body を json() で読む既存テストが壊れない
```

検証:

```text
cd workers && npm test
```

## Ticket 013 - chat/translation credit operation を共通化する

優先度: P1
リスク: 中間
状態: Done / credit billing path のみ

目的:

```text
chat と quote translation に散っている credit consume/refund の同型処理を helper に寄せる。
```

対象:

```text
workers/src/lib/credit-operation.ts
workers/src/lib/chat/usecase.ts
workers/src/routes/translate-quote.ts
workers/test/chat-route.test.ts
workers/test/quote-translation-route.test.ts
workers/test/credit-quota.test.ts
```

やること:

```text
consumeBillableCredits を作る
refundBillableCredits を作る
operationId / reference / creditsRemaining の扱いを固定する
daily chat quota と watchlist stock quota は今回触らない
```

完了条件:

```text
chat と translation が同じ helper で credit consume/refund する
既存の refund failure / insufficient credits / non-chargeable refund テストが通る
daily quota path の挙動が変わらない
```

検証:

```text
cd workers && npm test -- chat-route.test.ts quote-translation-route.test.ts credit-quota.test.ts
cd workers && npm run typecheck
```

## 最初にやる 3 枚

```text
1. Ticket 001 - Local test console を評価道具にする
2. Ticket 002 - Chat quality contract を作る
3. Ticket 003 - routes/chat.ts を usecase に切り出す
```

この 3 枚を終えると、返答品質を触る前に「比較できる」「壊していないと言える」「route の見通しがよい」状態になる。
