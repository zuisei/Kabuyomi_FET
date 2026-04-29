# Kabuyomi Worker Refactor Notes

今の Worker を上から見ていった時の「今は触らない」「あとで整理したい」「本当に危ない」をまとめるメモ。

これは実装指示書ではなく、迷子にならないための改修メモ。

## いまの前提

Kabuyomi Worker はかなり多くの責務を持っている。

```text
API route
filing 準備
SEC fetcher 連携
chat 返答
Gemini
fallback
quota / credit
D1 / R2 / KV
Durable Objects
internal maintenance
```

なので、いきなり全部を大改修しない。

基本方針はこれ。

```text
1. まず地図を作る
2. 触らなくていい場所を明確にする
3. 危ない場所だけ小さく直す
4. 大きい改修は usecase / job / strategy に分ける
```

関連地図:

```text
docs/worker_system_map.md
docs/worker_file_map.md
docs/chat_route_notes.md
docs/worker_refactor_tickets.md
tmp/kabuyomi-worker-system-map.svg
```

## 現在の修正進捗

済み:

```text
test Worker / local debug UI の整備
chat quality contract / eval validator
routes/chat.ts の answerChatUsecase 化
test 環境限定の chat debug metadata
short follow-up の intent/prompt 調整
filing-lock の token owner lease 化
routes/company.ts の loadCompanyUsecase / refreshCompanyUsecase 化
routes/watchlist-add.ts の addWatchlistTickerUsecase 化
watchlist-add async の最小 job state 化
response.ts の JSON compact 化
pipeline.ts 経由 import の解消
SEC fetcher prepared-filing 互換 path 追加
orchestrator.ts から decision logging を分離
chat/translation の credit charge/refund helper 化
```

まだ残っている大物:

```text
watchlist-add async の Queue/Workflow 化
SEC fetcher prepared-filing の fetcher deploy / 本格移行
orchestrator.ts の retry/fallback/policy 分割
history-store.ts の分割
quota/credit mutation helper の適用範囲拡大
```

## 触らなくてよさそうな場所

### `workers/src/index.ts`

状態:

```text
Worker の玄関。
route に振り分けるだけで、今はかなり薄い。
```

今すぐ修正不要。

強いて言うなら:

```text
route 順番の説明コメント
scheduled job 失敗時の方針メモ
preMaintenanceRoutes / apiRoutes の分類説明
```

ただし信頼性/返答品質のボトルネックではない。

### `workers/src/env.ts`

状態:

```text
Worker 世界の用語辞典。
Env binding と domain 型が同じファイルにある。
```

今すぐ修正不要。

気になる点:

```text
Env とアプリ内データ型が混在
FilingCacheRecord が大きい
SourceChunkRecord の sectionType が粗い
```

ただし、今分けると余計に混乱する可能性が高い。

### `workers/wrangler.toml`

状態:

```text
deploy / binding / cron / observability の設定。
```

今の構造把握や chat 改善では基本触らない。

触る必要が出るのは:

```text
staging を作る
Queue を追加する
D1/R2/KV を分ける
Durable Object を追加する
cron を変える
SEC_FETCHER_BASE_URL を変える
```

## 将来整理したい routes

### `workers/src/routes/chat.ts`

状態:

```text
/v1/chat の受付。
返答品質そのものではなく、API の外枠。
```

今持っている責務:

```text
payload 検証
filingKey 確認
metrics_only filing の upgrade
quota / credit 消費
conversationContext 補完
buildChatResponse 呼び出し
失敗時 refund
non-chargeable refund
response shaping
```

良い点:

```text
requested filing を loadFilingByKey で明示的に読む
stale/missing filing は Filing cache not found で落とす
失敗時 refund がある
non-chargeable refund がある
```

気になる点:

```text
route としては少し太い
prepareFilingForChat が重くなりうる
charge/refund が複雑
conversationContext 補完が route 側にある
debug metadata は response に出ていない
```

将来案:

```text
routes/chat.ts
  |
  v
answerChatUsecase()
```

`routes/chat.ts` は HTTP 受付に寄せる。

詳しくは:

```text
docs/chat_route_notes.md
```

### `workers/src/routes/company.ts`

状態:

```text
/v1/company/:ticker の受付。
会社ページ用 filing 準備の入口。
```

今持っている責務:

```text
ticker path parse
device key 確認
lookupTicker
ensureLatestFiling
serializeCompanyResponse
retryable 503 時の stale fallback
```

良い点:

```text
SEC/fetcher が一時的に死んだ時、stale cache を返せる
refresh と通常 view が分かれている
deferFullContent: true で request path を軽くしようとしている
```

気になる点:

```text
GET と refresh の処理が似ている
fallback policy が route 内にある
allowHistoricalPersistence: true により company response でも storage side effect が起きる
refresh の retryable fallback が内側/外側 catch で少し読みづらい
```

将来案:

```text
routes/company.ts
  |
  +-- loadCompanyUsecase()
  |
  +-- refreshCompanyUsecase()
```

route は HTTP 受付に寄せる。

fallback policy は usecase か company response policy に分ける。

現在:

```text
loadCompanyUsecase / refreshCompanyUsecase に切り出し済み。
routes/company.ts は ticker validation と usecase result の Response 化に寄せた。
fallback policy は lib/company/usecase.ts 側に移動済み。
```

### `workers/src/routes/watchlist-add.ts`

状態:

```text
/v1/watchlist/add の受付。
保存銘柄 quota と filing 準備が同時に絡む。
```

今持っている責務:

```text
payload 検証
device key / quota identity 確認
lookupTicker
同一 CIK の関連 ticker 解決
async mode 判定
async mode では latest form type を事前確認
stock quota 消費
filing 準備
失敗時の stock quota refund
company response 返却
```

良い点:

```text
async mode では unsupported form を quota 消費前に弾く
filing 準備失敗時に、新規保存した quota を refund する
同一 CIK の alias ticker を考慮して quota を扱う
sync/async の両方を持っている
```

大きい問題:

```text
async mode が waitUntil(ensureLatestFiling) に重い filing 準備を積んでいる
ensureLatestFiling の奥で historical persistence / preload / content upgrade が連鎖する
Queue / Workflow のような backpressure, retry state, progress state がない
```

今後の信頼性改善ではここが重要。

将来案:

```text
routes/watchlist-add.ts
  |
  v
addWatchlistTickerUsecase()
  |
  +-- quota を確保
  +-- filingPrepJob を作成
  +-- status: preparing を返す
```

重い処理は以下へ逃がす。

```text
filing prep queue / workflow
  |
  +-- SEC fetch
  +-- metrics/sourceChunks 作成
  +-- history persistence
  +-- content upgrade
  +-- status 更新
```

ただし、すぐに Queue 化すると影響が広い。

現在:

```text
addWatchlistTickerUsecase に切り出し済み。
routes/watchlist-add.ts は payload validation / async header 判定 / response conversion 中心。
filing_prep_jobs に preparing / ready / failed_retryable / failed_permanent を残す最小 job state を追加済み。
waitUntil(ensureLatestFiling) はまだ残っているので、Queue/Workflow 化は未完了。
GET /v1/filing-prep/jobs/:jobId で test UI / client 側から進捗確認できる。
```

短期では以下を優先。

```text
1. async waitUntil が何を連鎖しているか docs に明記
2. filing prep の job state 仕様を決める
3. quota refund の契約テストを維持
4. fetcher dedupe / concurrency limit を先に入れる
```

触る時に見るテスト:

```text
workers/test/ticker-routes.test.ts
workers/test/user-quota.test.ts
workers/test/latest-filing.test.ts
```

## 本当に大きい信頼性問題

### 1. SEC payload を Worker が丸読みしている

場所:

```text
workers/src/clients/sec-fetcher.ts
sec-fetcher/src/sec-service.mjs
sec-fetcher/server.mjs
```

問題:

```text
sec-fetcher が HTML + companyFacts を JSON に詰める
Worker が response.text()
Worker が JSON.parse
Worker 側で MD&A 抽出
```

リスク:

```text
大きい 10-K で Worker の memory / CPU / latency が跳ねる
同時アクセスで 503 化しやすい
```

将来案:

```text
fetcher 側で prepared-filing を作る
Worker には軽い metrics/sourceChunks/diagnostics だけ返す
さらに必要なら R2 artifactKey 方式にする
```

現在:

```text
Worker 側に fetchPreparedFiling 互換 path を追加済み。
fetcher 側にも /internal/sec/prepared-filing endpoint 実装を追加済み。
旧 fetcher では 404 -> 旧 filing-assets path に fallback するため、移行中も Worker は壊れない。
ただし fetcher 本番/Railway deploy はまだしていないので、test Worker は現時点では旧 path fallback で動く。
```

### 2. `waitUntil` が重い job の代わりになっている

場所:

```text
workers/src/routes/watchlist-add.ts
workers/src/lib/filings/latest.ts
workers/src/lib/filings/history-persistence.ts
workers/src/lib/filings/content-upgrade.ts
```

問題:

```text
watchlist/add async
  -> waitUntil(ensureLatestFiling)
  -> historical persistence
  -> historical preload
  -> content upgrade
  -> summary upgrade
```

リスク:

```text
backpressure がない
retry/progress/failure が見えにくい
重い処理が Worker invocation にぶら下がる
```

将来案:

```text
filing prep job を作る
preparing / ready / failed_retryable / failed_permanent を状態化
Queue / Workflow に逃がす
```

### 3. Filing lock は改善済みだが継続観察

場所:

```text
workers/src/durable/filing-lock.ts
workers/src/lib/filings/lock.ts
```

元の問題:

```text
30秒固定 TTL で、長い ingest 中に lock が切れうる
```

現在:

```text
token 所有者だけ renew / unlock できる lease 型に変更済み
```

確認済み:

```text
workers/test/filing-lock.test.ts
npm run typecheck
npm test
```

今後見ること:

```text
renew 失敗時のログ
long ingest 中の二重処理が減るか
waitUntil/job 化した後も lock が適切か
```

## Chat 返答品質の論点

返答周りの主要担当:

```text
routes/chat.ts
lib/chat/orchestrator.ts
lib/chat/intent.ts
lib/chat/context.ts
lib/chat/historical.ts
lib/chat/context-pack.ts
clients/gemini.ts
clients/gemini/prompts.ts
clients/gemini/normalize.ts
clients/gemini/fallback.ts
lib/chat/deterministic.ts
lib/chat/grounding.ts
lib/chat/web-supplement.ts
lib/chat/answer-format.ts
```

今の見立て:

```text
Gemini あり回答
  -> context-pack.ts / prompts.ts / grounding.ts が重要

Gemini なし回答
  -> fallback.ts / deterministic.ts が弱く見えやすい

ただし一部品だけ直すと他が崩れやすい
  -> 先に chat contract / eval / map が必要
```

大きい方針候補:

```text
Gemini-first backend に寄せる
fallback は賢い回答ではなく安全な最小回答にする
deterministic は補助にする
```

ただし、いきなり切り替えない。

まず必要:

```text
chat quality contract
core regression questions
questionIntent / responsePath / fallbackReason / sourceIdsValid の観測
```

## Orchestrator の扱い

`workers/src/lib/chat/orchestrator.ts` は長いが、いきなり全面改修しない。

今は以下が詰まっている。

```text
intent 判定
historical path
deterministic path
context pack
Gemini call
retry policy
source validation
fallback
grounding repair
decision logging
```

将来はまず挙動を変えずに切り出す。

候補:

```text
lib/chat/retry-policy.ts
lib/chat/source-validation.ts
lib/chat/fallback-policy.ts
lib/chat/decision-log.ts
```

その後で strategy 化する。

## 優先順

いまの現実的な順番。

```text
1. 地図と責務を docs に残す
2. index.ts / env.ts / wrangler.toml は今は触らない
3. routes/chat.ts / routes/company.ts は将来 usecase 化メモだけ残す
4. fetcher の dedupe / concurrency limit を検討
5. prepared-filing endpoint を検討
6. waitUntil job 化を検討
7. chat contract / eval を作ってから返答品質を触る
8. orchestrator は最後に分割
```

## 迷った時の判断

```text
ファイルが何かわからない
  -> docs/worker_file_map.md

全体の流れがわからない
  -> docs/worker_system_map.md

chat route の将来整理がわからない
  -> docs/chat_route_notes.md

Worker が重い/503っぽい
  -> sec-fetcher / filing prep / waitUntil / lock を見る

返答が薄い
  -> context-pack / fallback / deterministic / grounding を見る
```

## `worker_file_map.md` 上からレビュー

対象:

```text
docs/worker_file_map.md の
workers/src/index.ts
  から
workers/src/lib/pipeline.ts
  まで
```

目的:

```text
1. どこが今すぐ危ないか
2. どこは触らなくていいか
3. どこは将来整理すべきか
4. ファイル同士の連携で何が見えにくいか
```

結論を先に書く。

```text
入口/index/env/common helpers は大きく壊れていない。

危ない中心は以下。

1. routes が usecase なしで domain 処理を直接叩いている
2. filing 準備が routes/company/watchlist/chat/daily-refresh から同じ重い処理に流れ込む
3. chat は orchestrator/context-pack/fallback/deterministic/gemini の契約が暗黙
4. sec-fetcher payload と Worker 側処理が重い
5. internal maintenance が長い仕事を request 内で実行している
6. quota/credit の charge/refund 契約が routes に散っている
7. lib/pipeline.ts が古い facade として依存関係をぼかしている
```

### 1. Worker 入口

対象:

```text
workers/src/index.ts
workers/src/env.ts
workers/wrangler.toml
```

状態:

```text
index.ts は route 配列、maintenance gate、scheduled job だけ。
env.ts は bindings と domain 型の辞書。
wrangler.toml は Cloudflare binding/deploy/cron 設定。
```

評価:

```text
今すぐ大きく直す場所ではない。
信頼性や返答品質の主犯ではない。
```

修正したいポイント:

```text
index.ts
  preMaintenanceRoutes と apiRoutes の意図をコメントで残す
  scheduled で refreshTickerSnapshot 成功後に refreshTrackedFilings が続くことを docs に明記

env.ts
  Env binding と FilingCacheRecord などの domain 型が同居している
  将来は types/filing.ts などに分けてもいい

wrangler.toml
  staging/Queue/Workflow を作る時だけ触る
```

ダメなポイント:

```text
index.ts 自体には大きなダメさはない。
ただし scheduled の片方が失敗した時に cron 全体がどう扱われるかは運用上見えにくい。
```

連携面でダメなポイント:

```text
index.ts の route 配列を見るだけでは、各 route がどれだけ重い処理を呼ぶか分からない。
たとえば company/watchlist/chat は見た目は同じ route だが、奥で filing ingest や Gemini まで行く。
```

優先度:

```text
低。
ここは今は地図とコメントで十分。
```

### 2. API routes

対象:

```text
workers/src/routes/chat.ts
workers/src/routes/company.ts
workers/src/routes/watchlist-add.ts
workers/src/routes/watchlist-remove.ts
workers/src/routes/search.ts
workers/src/routes/usage.ts
workers/src/routes/translate-quote.ts
workers/src/routes/billing-sync.ts
workers/src/routes/credit-purchase-grant.ts
workers/src/routes/internal-*.ts
workers/src/routes/legal.ts
workers/src/routes/types.ts
```

状態:

```text
薄い route と太い route が混ざっている。

薄い:
  search.ts
  usage.ts
  watchlist-remove.ts
  credit-purchase-grant.ts
  types.ts

太い:
  chat.ts
  company.ts
  watchlist-add.ts
  translate-quote.ts
  billing-sync.ts
  internal-backfill-history.ts
  internal-cleanup-filings.ts
  internal-credit-purchase-grant.ts
  internal-eval-credit-grant.ts
```

良い点:

```text
parseJsonBody で payload size limit がある。
AppError を index.ts がまとめて扱う。
chat.ts は requested filing を loadFilingByKey で直接読む。
company.ts は SEC/fetcher 障害時に stale fallback を返せる。
watchlist-add.ts は async mode で unsupported filing を quota 消費前に弾く。
credit-purchase-grant.ts は Apple 検証後に credit grant する。
```

修正したいポイント:

```text
chat.ts
  HTTP route と charge/refund と filing upgrade と answer 生成が同居している
  answerChatUsecase に切り出したい

company.ts
  GET と refresh の処理が似ている
  loadCompanyUsecase / refreshCompanyUsecase に分けたい

watchlist-add.ts
  quota 確保と filing 準備が同居している
  addWatchlistTickerUsecase と filingPrepJob に分けたい

translate-quote.ts
  credit consume/refund が chat.ts と別実装
  charge/refund helper を共通化したい

billing-sync.ts
  parse/device binding の AppError だけ route 内で個別 JSON 返却している
  error handling 方針が他 route と少し違う

internal-backfill-history.ts / internal-cleanup-filings.ts
  内部 route とはいえ長い仕事を request 中に実行する
  job/queue/workflow に逃がしたい

legal.ts
  静的文面が route file に大きく入っている
  Worker の理解を邪魔するので将来は static/doc source に逃がしてもいい
```

ダメなポイント:

```text
route が「受付」以上のことを持ちすぎている。

特に:

chat.ts
  charge
  refund
  metrics_only upgrade
  conversationContext 解決
  buildChatResponse 呼び出し
  response shaping

watchlist-add.ts
  ticker lookup
  related ticker 解決
  quota mutation
  async preparing response
  waitUntil filing preparation
  refund

company.ts
  stale fallback policy
  ensureLatestFiling
  serializeCompanyResponse
  historicalOverview persistence side effect
```

連携面でダメなポイント:

```text
route から lib/pipeline.ts 経由で domain 処理に入るため、実際に何が起きるか追いにくい。

例:
routes/company.ts
  -> ensureLatestFiling
  -> fetch submissions
  -> SEC/fetcher
  -> ingest
  -> R2/D1/KV
  -> historical preload
  -> content upgrade
  -> summary upgrade

見た目は company API だが、実際は storage/job/SEC/Gemini まで連動する。
```

優先度:

```text
高:
  watchlist-add.ts
  chat.ts
  company.ts
  translate-quote.ts の charge/refund 共通化

中:
  billing-sync.ts
  internal maintenance routes

低:
  search.ts
  usage.ts
  watchlist-remove.ts
  legal.ts
  types.ts
```

### 3. Chat 返答周り

対象:

```text
workers/src/lib/chat/orchestrator.ts
workers/src/lib/chat/intent.ts
workers/src/lib/chat/context.ts
workers/src/lib/chat/context-pack.ts
workers/src/lib/chat/deterministic.ts
workers/src/lib/chat/grounding.ts
workers/src/lib/chat/historical.ts
workers/src/lib/chat/web-supplement.ts
workers/src/lib/chat/answer-format.ts
workers/src/clients/gemini.ts
workers/src/clients/gemini/*
```

状態:

```text
chat はかなり育っている。
単純な prompt 修正だけで扱える規模ではない。
```

今の大まかな流れ:

```text
routes/chat.ts
  -> resolveContextualQuestion
  -> buildChatResponse
    -> classifyQuestionIntent
    -> historical path
    -> deterministic path
    -> buildChatContextPack
    -> generateChatAnswer
    -> sourceIds validation
    -> retry
    -> fallback
    -> weak grounding repair
    -> web supplement
    -> source URL attach
```

良い点:

```text
questionIntent が first-class にある。
context selection diagnostics がある。
fallbackReason が細かい。
sourceIdsValid / schemaValid / retryAttempt が log に出る。
grounding なしの回答を落とす仕組みがある。
short follow-up は context.ts で補正できる。
```

修正したいポイント:

```text
orchestrator.ts
  経路選択、retry、fallback、grounding、logging が全部ある
  まず挙動を変えずに policy 単位へ切り出したい

context-pack.ts
  1729行で、source selection、factualPack、ticker別heuristic、diagnostics が同居
  返答品質の本丸だが、壊すと影響が広い

deterministic.ts
  1192行で、Geminiなし回答の賢さを無理に持っている
  fallback と責務が近い

fallback.ts
  933行で、Gemini失敗時の回答だけでなく local summary / local chat recovery も持つ
  deterministic.ts と似た判断が増えている

historical.ts
  chat 中に historical hydration を waitUntil へ逃がす
  user から見ると「今は準備中」になりやすい

web-supplement.ts
  SEC primary を守る設計は良い
  ただし answer の文言を見て web 補助するか決める heuristic がある
```

ダメなポイント:

```text
返答品質の責任境界が曖昧。

どれが悪いと回答が薄くなるか:

intent.ts
  intent 分類がズレる

context-pack.ts
  Gemini に渡す資料が弱い

prompts.ts
  指示が弱い

gemini.ts
  schema/quality/retry/fallback 判断が弱い

fallback.ts / deterministic.ts
  Gemini なし回答が薄い

grounding.ts / orchestrator.ts
  sourceIds の扱いで fallback に落ちる

historical.ts
  過去比較データが未準備
```

連携面でダメなポイント:

```text
orchestrator.ts が中心になりすぎている。

今は:

orchestrator
  -> historical
  -> deterministic
  -> context-pack
  -> gemini
  -> fallback
  -> grounding
  -> web-supplement

という全部入り。

そのため context-pack だけ直したつもりでも、retry や fallback の挙動で最終回答が変わる。
Gemini 前提に寄せる場合も、fallback/deterministic の役割を先に定義しないと壊れやすい。
```

優先度:

```text
高:
  chat quality contract を作る
  eval question set を作る
  responsePath / fallbackReason / questionIntent / sourceIdsValid を見ながら直す

中:
  orchestrator.ts から retry-policy / fallback-policy / source-validation / decision-log を切り出す
  fallback.ts と deterministic.ts の責務を整理する

低:
  answer-format.ts は今は薄い表示整形なので大改修不要
```

現在:

```text
decision logging は lib/chat/decision-log.ts に切り出し済み。
orchestrator.ts には retry / fallback / grounding repair の判断がまだ残っている。
なので「全部分割済み」ではなく、まずログだけ外した段階。
```

### 4. Filing 準備周り

対象:

```text
workers/src/lib/filings/latest.ts
workers/src/lib/filings/ingest.ts
workers/src/lib/filings/cache.ts
workers/src/lib/filings/content-upgrade.ts
workers/src/lib/filings/history-persistence.ts
workers/src/lib/filings/summary-upgrade.ts
workers/src/lib/filings/cleanup.ts
workers/src/lib/filings/lock.ts
workers/src/lib/filings/company-website.ts
workers/src/lib/filings/latest-alias-store.ts
```

状態:

```text
会社ページ、watchlist add、chat、daily refresh が同じ filing 準備系に流れ込む。
ここが Worker の重さと信頼性の中心。
```

今の大まかな流れ:

```text
ensureLatestFiling
  -> cache latest を見る
  -> ticker lookup
  -> submissions fetch
  -> latest filing 選択
  -> archive を見る
  -> filing lock
  -> ingestFiling
  -> upsertHistoricalArtifacts
  -> cacheLatestFilingMetadata
  -> enqueueHistoricalPersistence
  -> enqueueHistoricalCoveragePreload
  -> enqueueContentUpgrade
  -> enqueueCompanyWebsiteBackfill
  -> enqueueSummaryUpgrade
```

良い点:

```text
metrics_only で request path を軽くする工夫がある。
archive/cache/latest alias を見るため、毎回フル fetch ではない。
filing lock は token renew 型に改善済み。
content upgrade と summary upgrade は後追いできる。
```

修正したいポイント:

```text
latest.ts
  ensureLatestFiling が cache/archive/remote fetch/ingest/side effects を全部束ねる
  filingPrepUsecase と filingSideEffects に分けたい

ingest.ts
  SEC fetch、HTML、MD&A抽出、sourceChunks、summary 生成が同居
  prepared filing 作成を fetcher 側へ寄せるならここが薄くなる

content-upgrade.ts
  metrics_only から full へ戻す処理が重い
  Queue/Workflow 化した時の job handler 候補

history-persistence.ts
  historical preload が waitUntil で連鎖する
  progress/retry/backpressure が見えない

cleanup.ts
  internal route から同期実行される
  大きい cleanup は job 化したい
```

ダメなポイント:

```text
side effect が多い。

ensureLatestFiling を呼ぶだけで:

R2 archive
D1 historical index
KV/D1 latest alias
historical preload
content upgrade
summary upgrade
company website backfill

まで動く可能性がある。

呼び出し側から見ると「最新 filing を返す関数」だが、実際は job scheduler も兼ねている。
```

連携面でダメなポイント:

```text
routes/company.ts
routes/watchlist-add.ts
lib/daily-refresh.ts
lib/chat/historical.ts

が filing 準備に入れる。

どの入口から呼ばれたかで:

deferFullContent
forceRemoteCheck
executionContext の有無
contentMode
summaryMode

が変わる。

この組み合わせが docs なしだとかなり分かりにくい。
```

優先度:

```text
高:
  ensureLatestFiling の side effect 一覧を docs/worker_system_map.md に反映
  filing prep job state を設計
  waitUntil 連鎖を Queue/Workflow 候補として分離

中:
  ingest.ts を prepared-filing 化に備えて薄くする
  content-upgrade を job handler として切り出す

低:
  cache.ts / latest-alias-store.ts は今は小さく、急いで触らない
```

### 5. SEC / fetcher 周り

対象:

```text
workers/src/clients/sec.ts
workers/src/clients/sec-fetcher.ts
workers/src/extractors/mda.ts
```

状態:

```text
Worker 側の SEC facade はかなり大きい。
sec-fetcher client は外部 fetcher への窓口。
MD&A 抽出は Worker 側で重い。
```

良い点:

```text
SEC fetcher への rate limiter がある。
timeout がある。
retryable status の扱いがある。
filing-assets がない fetcher への fallback もある。
```

大きい問題:

```text
sec-fetcher.ts は response.text() で payload 全体を読む。
その後 JSON.parse する。
filing-assets は HTML + companyFacts/metrics をまとめて返す。

つまり大きい 10-K では:

sec-fetcher 側 memory
network payload
Worker 側 response.text
Worker 側 JSON.parse
Worker 側 MD&A extraction

が重なる。
```

修正したいポイント:

```text
短期:
  fetcher request の payload size / latency / route を log に出す
  fetcher concurrency をより明示的に制限する
  filing-assets と metrics-only の使い分けを整理する

中期:
  fetcher 側で prepared-filing を作る
  Worker は prepared metrics/sourceChunks/diagnostics だけ受ける

長期:
  HTML は R2 artifactKey で渡す
  Worker が巨大 HTML を直接持たない
```

ダメなポイント:

```text
SEC facade の clients/sec.ts が 946行あり、検索、ticker snapshot、filing selection、metric normalization、alias 解決が同居している。
fetcher と Worker の責務境界が曖昧。
```

連携面でダメなポイント:

```text
filing ingest の重さは Worker だけでは解決しきれない。

Worker:
  routing
  cache
  user quota
  response

Fetcher:
  SEC取得
  HTML/CompanyFacts処理
  prepared filing

の分担に寄せたい。

ただし fetcher に寄せると fetcher 側の負荷は増えるため、fetcher の dedupe/concurrency/cache も同時に必要。
```

優先度:

```text
最高:
  SEC payload 丸読み問題

高:
  prepared-filing endpoint の設計

中:
  clients/sec.ts の責務分割
```

### 6. Storage / history

対象:

```text
workers/src/lib/history-store.ts
workers/src/lib/history-autohydration.ts
workers/src/lib/search-form-type-cache.ts
workers/src/lib/company-response.ts
```

状態:

```text
D1/R2 の履歴保存、historical overview、過去比較 chat、backfill が集まる。
history-store.ts は 1029行でかなり大きい。
```

良い点:

```text
R2 archive と D1 index がある。
historicalOverview を company response に出せる。
過去比較 chat の source を historical_filing として返せる。
search form type cache がある。
```

修正したいポイント:

```text
history-store.ts
  archive
  index
  overview
  chat response
  backfill
  SQL row mapping
  formatting
  が同居している

company-response.ts
  serializeCompanyResponse の中で historicalOverview を読む
  allowHistoricalPersistence により response serialization が side effect を持つ

history-autohydration.ts
  過去比較の準備ロジックなので、filing prep job と近い
```

ダメなポイント:

```text
company response を作るだけで historicalOverview 側の永続化に触れる可能性がある。

serializeCompanyResponse は名前だけ見ると純粋な整形に見えるが、
実際は loadHistoricalOverview を呼ぶ。
```

連携面でダメなポイント:

```text
history は company response、chat historical、filing preload、internal backfill から使われる。

つまり history-store.ts を触ると:

会社ページ
過去比較チャット
watchlist add 後の準備
daily refresh
internal backfill

に波及する。
```

優先度:

```text
高:
  history-store.ts を archive/index/overview/chat/backfill に分ける計画を立てる

中:
  serializeCompanyResponse の side effect を明記または分離

低:
  search-form-type-cache.ts は小さく、今は触らない
```

### 7. Quota / billing / credit

対象:

```text
workers/src/lib/quota.ts
workers/src/durable/user-quota.ts
workers/src/lib/billing-catalog.ts
workers/src/lib/apple-store-server.ts
workers/src/lib/entitlements.ts
workers/src/durable/entitlement.ts
```

状態:

```text
quota.ts と user-quota.ts が大きい。
chat/watchlist/translation/purchase/eval がここに集まる。
```

良い点:

```text
credit operationId がある。
refundCredit が originalOperationId / refundOperationId を使う。
purchase grant は transactionId を記録する。
saved tickers は relatedTickers を考慮する。
creditBillingEnabled が identity ごとに判定される。
```

修正したいポイント:

```text
routes/chat.ts と routes/translate-quote.ts の charge/refund が似ている
watchlist-add.ts の stock quota refund も route 内にある
quota.ts が 1010行、user-quota.ts が 919行で読みづらい
credit billing disabled 時と enabled 時の response shape を整理したい
```

現在:

```text
chat / translate-quote の credit consume/refund は lib/credit-operation.ts に寄せた。
daily chat quota と watchlist stock quota はまだ既存 path のまま。
一気に quota 全体を抽象化すると事故範囲が広いので、まず credit billing だけ共通化した。
```

ダメなポイント:

```text
quota/credit の正しさが route 実装に依存している。

例:
chat.ts
  buildChatResponse 失敗時に refund
  chargeable false 時に refund

translate-quote.ts
  Gemini translation 失敗時に refund

watchlist-add.ts
  filing 準備失敗時に stock quota refund

この契約が usecase とテストに閉じていない。
```

連携面でダメなポイント:

```text
課金/credit は chat 品質と直接つながる。

回答が fallback / non-chargeable になった時:

返金するのか
usage をどう返すのか
creditsCharged をどう返すのか
responsePath をどう扱うのか

が route ごとに分散している。
```

優先度:

```text
高:
  charge/refund contract を docs 化
  chat/translation/watchlist の refund テストを維持

中:
  charge helper / refund helper を usecase 層へ寄せる

低:
  billing-catalog.ts は定義ファイルなので今は触らない
```

### 8. Durable Objects

対象:

```text
workers/src/durable/filing-lock.ts
workers/src/durable/sec-rate-limiter.ts
workers/src/durable/user-quota.ts
workers/src/durable/entitlement.ts
```

状態:

```text
状態を持つ場所。
Worker の信頼性にかなり効く。
```

良い点:

```text
filing-lock は token owner lease 型に改善済み。
sec-rate-limiter は fetcher 呼び出し前の最低限の throttle になる。
user-quota は saved tickers / daily usage / credit ledger を Durable Object に閉じている。
entitlement は billing sync と分離されている。
```

修正したいポイント:

```text
filing-lock.ts
  renew 失敗時の observability をもう少し足したい

sec-rate-limiter.ts
  1秒10 tokens の固定値
  fetcher や SEC の実負荷に合わせた設定化が欲しい

user-quota.ts
  900行超え
  daily quota / saved tickers / credits / purchases / eval grants を分けたい

entitlement.ts
  billing-sync との契約を docs に残す
```

ダメなポイント:

```text
DO は壊れると影響が大きいが、route からは普通の helper に見える。
特に user-quota は billing と app UX に直結する。
```

連携面でダメなポイント:

```text
filing-lock は filing ingest/content-upgrade/history-persistence から使われる。
user-quota は chat/watchlist/translation/purchase/eval から使われる。

どちらも横断的なので、小さい修正でも広くテストが必要。
```

優先度:

```text
高:
  filing-lock は改善済みなので long ingest で観測
  user-quota は refund/ledger テストを厚めに維持

中:
  sec-rate-limiter の設定化
```

### 9. Common helpers

対象:

```text
workers/src/lib/request.ts
workers/src/lib/response.ts
workers/src/lib/errors.ts
workers/src/lib/logging.ts
workers/src/lib/llm-usage.ts
workers/src/lib/remote-config.ts
workers/src/lib/metrics.ts
workers/src/lib/internal-auth.ts
workers/src/lib/detached-access.ts
workers/src/lib/starter-tickers.ts
workers/src/lib/tracked-tickers.ts
workers/src/lib/daily-refresh.ts
workers/src/lib/pipeline.ts
```

状態:

```text
小さい helper と、運用上重要な helper が混ざっている。
```

良い点:

```text
request.ts は streaming read with limit で良い。
errors.ts は AppError に絞れている。
logging.ts は JSON log になっている。
llm-usage.ts は token/latency を route と responsePath 付きで出せる。
remote-config.ts は feature flag 的に使える。
```

修正したいポイント:

```text
response.ts
  compact JSON に変更済み
  API payload の不要な空白を減らした

logging.ts
  redaction / request id / operation id の共通規約が薄い

remote-config.ts
  release 時の flag drift が怖い
  creditBillingEnabled などは iOS 表示と連携して見る必要がある

daily-refresh.ts
  ensureLatestFiling 経由で重い filing 準備に入る
  cron job と request path の重さが同じ関数に集まる

pipeline.ts
  古い facade/re-export
  routes から本当の責務が見えにくい
  既存の pipeline.ts 経由 import は直接 import へ変更済み
```

ダメなポイント:

```text
lib/pipeline.ts が便利すぎる。

今の import:

routes/company.ts
  -> ../lib/company/usecase

routes/chat.ts
  -> ../lib/chat/usecase

routes/watchlist-add.ts
  -> ../lib/filings/latest

routes/usage.ts
  -> ../lib/quota

routes/internal-backfill-history.ts
  -> ../lib/filings/history-persistence

lib/daily-refresh.ts
  -> ./filings/latest

このせいで、route から見た時に実体が quota なのか filing なのか chat なのか分かりにくい。
```

連携面でダメなポイント:

```text
pipeline.ts は「古い入口」として残っているが、今は map 理解の邪魔になっている。
ただし一気に消すと import 差分が増えるだけなので、次に触る route から直接 import に置き換えるのがよい。
```

優先度:

```text
高:
  pipeline.ts 経由 import を新規追加しない

中:
  次に触る route から直接 import へ寄せる
  response.ts の pretty JSON を見直す

低:
  request.ts/errors.ts/llm-usage.ts は今は触らない
```

## 横断のダメポイントまとめ

### A. route と usecase の境界がない

現状:

```text
routes/*
  -> HTTP受付
  -> payload parse
  -> quota
  -> filing prep
  -> fallback
  -> response shape
```

問題:

```text
route を読まないと業務仕様が分からない。
route を直すと課金や filing 準備まで壊しやすい。
```

保守的な形:

```text
routes/chat.ts
  -> answerChatUsecase

routes/company.ts
  -> loadCompanyUsecase
  -> refreshCompanyUsecase

routes/watchlist-add.ts
  -> addWatchlistTickerUsecase

routes/translate-quote.ts
  -> translateQuoteUsecase
```

### B. `ensureLatestFiling` が強すぎる

現状:

```text
ensureLatestFiling は最新 filing を返すだけではない。
cache/archive/remote ingest/R2/D1/KV/historical/content upgrade/summary upgrade を動かす。
```

問題:

```text
呼び出し側から副作用が見えない。
waitUntil が job queue のように使われる。
重い処理の進行状況や失敗状態が残らない。
```

保守的な形:

```text
loadOrPrepareLatestFiling
  -> 軽い読み取り

createFilingPrepJob
  -> 重い準備

runFilingPrepJob
  -> Queue/Workflow worker
```

### C. Chat 品質の契約が暗黙

現状:

```text
intent
context-pack
prompt
Gemini
fallback
deterministic
grounding
web supplement

が全部最終回答に影響する。
```

問題:

```text
一部だけ直すと別の fallback/retry/grounding で結果が変わる。
初心者目線だと「どこを触れば回答が良くなるか」が見えない。
```

保守的な形:

```text
chat quality contract
  -> 入力 question
  -> expected intent
  -> required evidence
  -> acceptable responsePath
  -> expected fallbackReason

eval runner
  -> 修正前後を比較
```

### D. fetcher と Worker の責務境界が重い

現状:

```text
fetcher
  -> HTML + companyFacts を返す

Worker
  -> response.text()
  -> JSON.parse
  -> MD&A extraction
  -> sourceChunks
  -> summary
```

問題:

```text
大きい 10-K で memory/CPU/latency が跳ねる。
fetcher に寄せるなら fetcher 側の負荷管理も必要。
```

保守的な形:

```text
fetcher
  -> prepared filing
  -> metrics/sourceChunks/diagnostics
  -> optional artifactKey

Worker
  -> cache
  -> quota
  -> response
  -> job orchestration
```

### E. quota/credit は route に散らすべきではない

現状:

```text
chat.ts
translate-quote.ts
watchlist-add.ts

がそれぞれ charge/refund を持つ。
```

問題:

```text
失敗時の返金条件が route ごとにズレる可能性がある。
non-chargeable の扱いも chat 固有に見える。
```

保守的な形:

```text
withChargeAndRefund(operation)
  -> charge
  -> run
  -> refund on failure
  -> refund on non-chargeable
```

ただし、最初から抽象化しすぎない。
まず chat/translation/watchlist の契約を docs と tests に固定する。

## 次に触る順番

安全に進めるならこれ。

```text
1. docs に map/review を残す
2. pipeline.ts 経由 import を増やさないルールを置く
3. chat quality contract/eval を作る
4. routes/chat.ts の usecase 化
5. routes/watchlist-add.ts の filing prep job state 設計
6. sec-fetcher prepared-filing 設計
7. ensureLatestFiling の side effect 分割
8. orchestrator.ts の policy 分割
```

今すぐ大規模改修に入るなら、最初の実装 slice はこれが一番安全。

```text
Slice 1:
  コード挙動は変えない
  routes/chat.ts から answerChatUsecase を切り出す
  charge/refund と response shape をテストで固定する

Slice 2:
  chat quality contract/eval を追加
  context-pack/prompts/fallback を触る前に比較できるようにする

Slice 3:
  watchlist-add async を filing prep job state に寄せる
  ただし Queue/Workflow 導入は設計後

Slice 4:
  sec-fetcher prepared-filing を追加
  Worker の巨大 payload 丸読みを減らす
```

## 修正優先度と本番影響リスク

止めたくない前提で、修正候補を以下に分ける。

```text
安全:
  本番実行経路を変えない
  deploy しても基本的に挙動は変わらない

中間:
  実行経路は少し変わる
  ただし小さい範囲でテストしやすい

危険:
  filing 準備、SEC fetch、quota、chat 経路など本番の中心を変える
  staging / dry-run / smoke なしで deploy しない
```

### 安全に進められるもの

```text
docs/fuckme.md の整理
docs/worker_file_map.md の更新
docs/worker_system_map.md の更新
chat eval/test の追加
既存 log の読み方メモ
pipeline.ts 経由 import を増やさないルールの明記
```

影響:

```text
本番影響なし。
deploy 対象に入っても実行経路は変わらない。
理解しやすくなるだけ。
```

次にやるなら:

```text
chat quality contract
eval question set
route/usecase 分割の作業書
```

### 中間リスクのもの

```text
routes/chat.ts を挙動そのままで answerChatUsecase に切り出す
routes/company.ts を loadCompanyUsecase / refreshCompanyUsecase に切り出す
translate-quote.ts の charge/refund を helper 化する
orchestrator.ts から logging / retry policy を小さく切り出す
response.ts の pretty JSON を compact JSON に変える
logging に operationId/requestId を足す
```

影響:

```text
本番挙動を変えないつもりでも、import や response shape を壊す可能性がある。
ただしテストで守りやすい。
```

必須確認:

```text
workers npm run typecheck
workers npm test
chat route の response shape 確認
credit/refund の既存テスト確認
```

やるなら条件:

```text
1 pull request / 1 slice に絞る。
挙動変更と refactor を混ぜない。
docs に「挙動変更なし」と明記できる範囲だけにする。
```

### 危険度が高いもの

```text
watchlist-add の Queue/Workflow 化
filing prep job state の client/UI 統合
ensureLatestFiling の side effect 分割
sec-fetcher prepared-filing の本格 deploy / 切替
Worker の巨大 SEC payload 丸読み解消
quota/credit/refund の全 route 共通化
UserQuotaDO の分割
history-store.ts の分割
context-pack.ts / fallback.ts / deterministic.ts の大幅変更
```

影響:

```text
会社ページが開かない
watchlist add が preparing のままになる
chat が filing を見失う
credit が消費されたまま refund されない
SEC fetch が詰まって 503 が増える
historicalOverview が出ない
過去比較 chat が準備中から戻らない
```

必須確認:

```text
workers npm run typecheck
workers npm test
wrangler deploy --dry-run
staging Worker で smoke
本番 deploy 前に git diff --name-status
本番 deploy 後に /v1/company, /v1/watchlist/add, /v1/chat, /v1/usage を smoke
wrangler tail で 503 / CPU / AppError を見る
```

やるなら条件:

```text
staging 相当を用意してから。
少なくとも本番 deploy 前に dry-run と smoke を通す。
Queue/Workflow を入れるなら wrangler.toml / binding / env / rollback 手順も一緒に書く。
```

## いま選ぶべき安全ルート

今は止めたくない。

なので短期はこれ。

```text
1. docs と map を育てる
2. chat quality contract/eval を作る
3. routes/chat.ts の usecase 化だけを設計する
4. 実装修正は staging 準備後にする
```

まだやらない:

```text
Queue/Workflow 化
sec-fetcher prepared-filing
ensureLatestFiling 分割
quota/credit の大改修
context-pack/fallback/deterministic の大幅変更
```

最初の実装候補:

```text
chat eval/test を追加する。

理由:
  本番影響がない
  返答品質改善の土台になる
  大規模改修前の比較基準になる
```

## Test API Worker 方針

本番を止めたくないので、test API は本番 Worker のコピーではなく、同じコードを別 config で deploy する。

```text
本番:
  workers/wrangler.toml
  Worker: kabuyomi-api

test:
  workers/wrangler.test.toml
  Worker: kabuyomi-api-test
```

重要:

```text
コードはコピーしない。
workers/src/* は本番/test 共通。

分けるのは Cloudflare 側の接続先。
```

分けるもの:

```text
Worker 名
KV namespace
D1 database
R2 bucket
Durable Object namespace
secrets
```

共有してはいけないもの:

```text
本番 KABUYOMI_CACHE
本番 DB
本番 FILINGS_BUCKET
本番 USER_QUOTA / FILING_LOCK / ENTITLEMENT の状態
本番 secrets
```

追加済みの安全策:

```text
workers/wrangler.test.toml
  -> test 専用 config
  -> name は kabuyomi-api-test
  -> workers_dev = true
  -> KV/D1/R2 は test resource を参照

workers/package.json
  -> check:test-config
  -> deploy:test
  -> dryrun:test
  -> d1:migrate:test
  -> smoke:test

workers/scripts/assert-test-config-ready.mjs
  -> wrangler.test.toml に placeholder や本番 resource id が残っていたら止める

.gitignore
  -> workers/.dev.vars.*
```

2026-04-29 更新:

```text
Cloudflare test resources は作成済み。

Worker:
  kabuyomi-api-test
  https://kabuyomi-api-test.dznqjmctk7.workers.dev
  Version ID: b8df5dae-b175-4988-8b58-b126d4d93a11

KV:
  kabuyomi-cache-test
  id: 93784a55abc94d46a68d3064eb711549

D1:
  kabuyomi-history-test
  id: 96270bac-37e0-46c5-af52-d96f192bec04
  migrations: 0001-0005 applied

R2:
  kabuyomi-filings-test

Secrets currently present:
  SEC_FETCHER_SHARED_SECRET
  BACKFILL_SHARED_SECRET

Smoke:
  /legal/privacy -> 200
  /v1/usage with x-device-key -> 200
  /v1/search?q=AAPL -> 200 after setting the correct SEC_FETCHER_SHARED_SECRET

Resolved blocker:
  fetcher initially returned 401 Unauthorized for /internal/sec/tickers-snapshot.
  Correct SEC_FETCHER_SHARED_SECRET was entered into kabuyomi-api-test.
  Production /v1/search currently returns 200, so the production Worker/fetcher path itself is healthy.
  test /v1/search also returns 200 now.
```

初回作成時の手作業:

```text
cd workers

npx wrangler kv namespace create kabuyomi-cache-test
npx wrangler d1 create kabuyomi-history-test
npx wrangler r2 bucket create kabuyomi-filings-test
```

その後:

```text
出てきた KV id / D1 id を workers/wrangler.test.toml に入れる。
R2 は bucket_name = kabuyomi-filings-test のままでよい。
```

test secrets:

```text
cd workers

npx wrangler secret put GEMINI_API_KEY --config wrangler.test.toml
npx wrangler secret put SEC_FETCHER_SHARED_SECRET --config wrangler.test.toml
npx wrangler secret put BACKFILL_SHARED_SECRET --config wrangler.test.toml
npx wrangler secret put EVAL_SHARED_SECRET --config wrangler.test.toml
```

D1 migration:

```text
cd workers
npm run d1:migrate:test
```

deploy 前確認:

```text
cd workers
npm run check:test-config
npm run dryrun:test
```

test deploy:

```text
cd workers
npm run deploy:test
```

test smoke:

```text
cd workers
npm run smoke:test
```

chat eval を test に向ける:

```text
cd workers
KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev npm run eval:chat:pilot
```

AI/Codex 誤認防止ルール:

```text
本番 deploy:
  npm run deploy

test deploy:
  npm run deploy:test

本番 deploy は、ユーザーが明示的に「本番deploy」と言うまで実行しない。
test deploy でも、先に npm run dryrun:test を実行する。
```

まだやらないこと:

```text
本番 wrangler.toml の binding 差し替え
本番 Worker deploy
本番 DB/KV/R2 を test Worker に接続
Cloudflare resource 作成を Codex が勝手に進めること
```
