# Codex 実装指示書

> Status (2026-04-18): historical handoff. Parts of this brief describe work that has already landed and should not be treated as the current source of truth.
> The local coordination docs (`docs/current_shipping_truth.md`, `CURRENT_SLICE.md`) are intentionally not tracked in Git. Use the current code and `docs/testflight_readiness_checklist.md` before following any instruction here literally.

Kabuyomi の現行コードベースを整理し、会話主役プロダクトとしての完成度を上げるためのリファクタリングと機能改善をまとめて実施してください。

この指示は「調査して提案する」ためのものではなく、「実装して、必要な整理まで完了する」ためのものです。曖昧な箇所は以下の方針を正として進めてください。

## 目的

- 会話主役 UX を正式ルートとして一本化する
- iOS / Workers の巨大ファイルを分割して保守性を上げる
- 重複実装や残存コードを整理する
- Kabuyomi の独自性である「履歴比較」「決算に質問する体験」を UI でも明確に出す
- beta 中の課金コードを整理し、将来再開しやすい形に整える
- テストと観測性を強化し、今後の改善速度を上げる

## 完了条件

- iOS の正式な画面導線がコード上で明確に一本化されている
- `CompanyView.swift` が適切に分割され、1 ファイル肥大化が解消されている
- Workers の `pipeline.ts` / `gemini.ts` / `index.ts` が責務ごとに分割されている
- `workers/src/routes` が空でなくなり、route 分割が行われている
- `workers/smoke/staging-worker.js` の重複問題に対処されている
- beta 期間中の課金コードの扱いが明確になっている
- 履歴比較や推移系の価値が iOS UI 上で目立つ導線として追加されている
- iOS に最低限の unit test が追加されている
- Workers に重要イベントの観測ログが追加されている
- local / deploy のモデル設定 drift が整理されている
- 変更後にテストとビルドを実行し、結果を報告している

## 実装方針

### 1. iOS の正式ルートを一本化する

現状は `AppRootView` が会話主役の `CompanyView` 直行になっている一方で、`HomeView` / `SearchView` / `selectedTab` など旧ルート由来の状態が残っています。

以下を実施してください。

- `AppRootView` を正式ルートとして維持する
- 正式な一次導線は「会話主役」に固定する
- `HomeView` と `SearchView` は「残すなら使う」「使わないなら整理する」のどちらかを選び、中途半端に放置しない
- `AppModel` 内の `selectedTab` など、現行ルートで不要になった状態は整理する
- 旧 UI を戻すためだけの構造に依存しない

判断基準:

- 「今ユーザーに見せる正式 UX」がコードから読み取れること
- 死蔵状態の画面や状態が減っていること

### 2. `CompanyView.swift` を責務ごとに分割する

`ios/Kabuyomi/Features/Company/CompanyView.swift` は肥大化しすぎています。表示要素を明確に分割してください。

最低限、以下の責務は別ファイルに切ってください。

- 会話タイムライン
- composer
- left drawer
- right summary drawer
- top bar
- insight / overview 系 UI
- message row / source chip 周辺の小部品

方針:

- 見た目は極力維持する
- 分割しても状態の流れが追いやすい構造にする
- 小さな subview 群を `Features/Company/` 以下に整理する

### 3. Workers の中核ロジックを分割する

現状の Workers は `pipeline.ts` と `gemini.ts` に責務が集中しています。以下の観点で分割してください。

- filing ingest
- cache / lock / loading
- quota
- deterministic answer builders
- historical answer integration
- web supplement
- grounding / source normalization
- Gemini request / response normalization / fallback

必要なら `workers/src/lib/` と `workers/src/clients/` に新ファイルを増やして構いません。

判断基準:

- 1 ファイルに複数の大きな責務が混在しないこと
- 変更点を追いやすいファイル構成になること

### 4. `workers/src/routes` を正式に使う

`workers/src/routes` は空ディレクトリのままです。`index.ts` に全 route が載っている現状を解消してください。

以下を実施してください。

- `search`
- `watchlist/add`
- `company`
- `chat`
- `usage`
- `internal/backfill/history`

を適切に route 単位で分割する。

`index.ts` は route wiring と共通エラーハンドリング中心に薄くしてください。

### 5. `workers/smoke/staging-worker.js` の扱いを決める

このファイルは本流 Worker と責務が大きく重複しています。以下のどちらかを選んでください。

- 削除して本流の smoke test 手段に置き換える
- もしくは shared logic を使う形まで寄せて、仕様 drift を起こしにくい形へ直す

推奨は削除または大幅縮小です。少なくとも、将来 main Worker とズレ続ける構造は解消してください。

### 6. beta 中の課金コードを整理する

現状は iOS に `SubscriptionStore` があり、Workers に `EntitlementDO` もありますが、`billing/sync` は止まっています。

このタスクでは「将来の復活余地を残しつつ、現在の beta 実装として分かりやすい状態」にしてください。

実施内容:

- 現在 beta では課金が無効であることがコード構造から分かるようにする
- 無効な機能のための分岐や UI がユーザー体験を濁しているなら整理する
- ただし StoreKit / entitlement の将来復活に必要な核まで破壊しない
- 「今動いていないコード」が main path を汚しているなら隔離する

方針:

- 削除よりも「beta disabled module」として整理するほうを優先してよい
- ただし使われないコードを main path にぶら下げ続けない

### 7. 履歴比較を UI に昇格する

Kabuyomi の backend は履歴比較に強いのに、UI 上では埋もれています。これを表に出してください。

最低限、以下のいずれかを追加してください。

- `過去3年比較`
- `前回決算との違い`
- `利益率の推移`
- `売上ドライバーの変化`

のような明示導線。

実施案:

- `CompanyView` の上部 or context card に履歴質問ショートカットを置く
- company ごとの suggested questions に履歴系を混ぜる
- source grounding を壊さない形で、「履歴を聞けるアプリ」だと UI から理解できるようにする

ここは Kabuyomi の差別化要素なので、単なる内部改善ではなくユーザー価値として見える形にしてください。

### 8. iOS テストを追加する

現状 iOS は build は通るが test target がありません。最低限の unit test を追加してください。

候補:

- `AppModel`
- `PersistenceController`
- `APIClient` のデコードや request building

要件:

- 純粋ロジック中心でよい
- ネットワーク実通信に依存しない
- 新規 test target の追加が必要なら追加する

### 9. 観測性を強化する

Workers 側で以下を追えるようにしてください。

- historical answer 使用率
- web supplement 使用率
- Gemini fallback 使用率
- deterministic answer 使用率
- grounding 修復が走った回数
- source 不足で unsupported になった回数

要件:

- 既存の `logEvent` ベースで実装してよい
- あとで集計しやすいイベント名と payload にする
- ノイズの多い冗長ログではなく、意思決定に効くイベントを増やす

### 10. モデル設定の drift をなくす

`workers/.dev.vars.example` と `workers/wrangler.toml` でモデル設定がズレています。

以下を実施してください。

- local / deployed default の意図を揃える
- コメントや README も必要に応じて更新する
- 「なぜ local と deploy が違うのか」が不明な状態を解消する

完全一致が最適でないなら、その理由が分かるようにしてください。

## 追加で見てよいポイント

必要なら以下も同時に整理してよいです。

- 旧 UI メモとの整合
- README の current architecture 反映
- Workers の module 構成に合わせた import 整理
- iOS の company feature フォルダ構成整理

## 制約

- 既存のユーザー向け挙動をむやみに壊さない
- 履歴回答、source grounding、watchlist / usage の基本仕様は維持する
- 既存の beta 方針を勝手に課金有効化しない
- destructive な git 操作はしない

## 実行順の推奨

1. Workers の route / pipeline / gemini 分割
2. `staging-worker.js` 整理
3. モデル設定整理と README 更新
4. iOS の正式ルート整理
5. `CompanyView` 分割
6. 履歴比較 UI 昇格
7. 課金コード整理
8. iOS テスト追加
9. Workers 観測性追加
10. 全体の build / test / 動作確認

## 最終報告でほしい内容

- 何をどう分割したか
- 削除した残存コードがあればその一覧
- 履歴比較 UI をどう見せるようにしたか
- 課金コードをどう整理したか
- 実行したテストとビルド結果
- まだ残るリスクや次の改善余地
