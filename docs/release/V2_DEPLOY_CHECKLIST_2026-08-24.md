# Deploy Checklist: Kabuyomi v2(Worker 本番 + iOS 1.3)

**作成 2026-08-24** / 実行者: リリースオーナー
前回の本番 Worker は `25586dc6`(2026-08-22)。**2 日ぶん・6 コミットぶんをまとめて出す。**

## ★ 先に直すもの(いま止まっている)

- [ ] **waiver の候補 ID が古い。`deploy:check` は今の状態では落ちる**
      ステージ済みは `RELEASE_GATE_STATE.pending-b73e7838.json`、
      実際の候補は **`422dfaa0ec9a16da…`**(6-K 分類器と 20-F 抽出を足した後に変わった)。
      → 候補 ID 3 箇所を差し替え、ファイル名も合わせ、`deploy:check` を再実行
      **今日 3 回ずれた。`workers/src` を触るたびに変わる。deploy 直前に必ず `release:candidate` を取り直すこと**

## Pre-Deploy

- [x] Worker typecheck 通過
- [x] Worker 1272/1272 通過(2026-08-24 実行)
- [x] sec-fetcher 15/15 通過(同上)
- [x] iOS 310/310 通過(AdMob 配線後に実行。以降 iOS は未変更)
- [ ] **`git status` が clean であることを確認** — deploy は作業ツリーの中身をそのまま出す。
      今日、別セッションの未コミットの課金コードが混ざる事故が起きかけた
- [ ] `npm run -s release:candidate` を取り直し、waiver の 3 箇所と一致させる
- [ ] `npm run deploy:check` が PASS
- [ ] migration: 0019 まで適用済み(**今回の新規 migration は無い**)
- [ ] 変更内容がリリースノートに反映されている

## Deploy

- [ ] `cd workers && npm run deploy`
- [ ] `npm run smoke:production:release` が **29 PASS / 0 FAIL**
- [ ] `configVersion` が `production-config-refresh-20260824-v1` を返す
- [ ] 実機 1 台でチャットを 1 問通す(**dev ではなく実機**。App Attest 経路が変わっているため)

## 変更ごとの確認と戻し方

| 変更 | 出た後の確認 | 戻し方 | 所要 |
|---|---|---|---|
| **config 期限の廃止** | ログに `remote_config_review_overdue_still_served` が**出ないこと**(まだ期限内) | `wrangler rollback` | 分 |
| **App Attest advisory** | `app_attest_assertion_ignored` の件数。**多発するなら実機で assertion が壊れている**(今まで 403 で見えなかった問題が可視化される) | `wrangler rollback` | 分 |
| **premium モデル ON** | 有料識別で `effectiveModelName = gpt-5.4`。**現在サブスク 0 なので当面は誰にも効かない** | `wrangler.toml` の `OPENAI_CHAT_MODEL_PREMIUM` を 1 行消して deploy | 分 |
| **有料の単価 2→5** | 同上(サブスク 0 のため当面不発火) | `PREMIUM_CHAT_CREDIT_COST=2` を設定して deploy(コード変更不要) | 分 |
| **AdMob バナー配線** | Release ビルドで free プランに枠が出るか | **戻せない。App Store 審査を通した新ビルドが必要** | **1〜2 日** |

## ⚠ この 2 つを意識しておくこと

**1. iOS は速く戻せない。Worker は戻せる。**
Worker の 4 つは `wrangler rollback` で数分。**iOS 側(バナー)だけは審査を挟むので 1〜2 日戻せない。**
リスクの重心は iOS 側にある。iOS の変更は Worker より慎重に見ること。

**2. ASO の効果測定が濁る。**
v1.2(新しいアプリ名)は **2026-08-24 00:55 に公開されたばかり**で、順位反映には 1〜2 週かかる。
**いま v1.3 を出すと、数字が動いたときに「名前が効いたのか、新ビルドが効いたのか」が分けられない。**
Worker のデプロイは App Store と無関係なので**今すぐ出してよい**。
**iOS 1.3 の提出だけは 1〜2 週ずらす**と、ASO の効果が読める。分けて出すことを勧める。

## Post-Deploy

- [ ] 24 時間、`app_attest_assertion_ignored` と `remote_config_*` の警告を見る
- [ ] `credit_ledger` に想定外の `consume` が出ていないか(単価変更のため)
- [ ] memory の本番 Worker 版数を更新
- [ ] `V2_COMPLETION_CHECKLIST.md` の D1 を `[x]` にして閉じる

## Rollback Triggers(出す前に決めておく)

- 本番 smoke が 1 件でも FAIL → **即 rollback**
- `app_attest_assertion_ignored` が実機トラフィックの大半を占める → 調査(**ただし rollback すると 403 に戻る = ユーザーが使えなくなる方向なので、rollback ではなく前進で直す**)
- チャットの 5xx が出る → 即 rollback
- 1 問あたりの消費クレジットが free で 2 以外になる → 即 rollback(課金事故)
