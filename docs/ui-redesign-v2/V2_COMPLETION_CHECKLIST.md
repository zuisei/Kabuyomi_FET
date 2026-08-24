# v2 完全体チェックリスト(継続作業の単一の真実)

2026-08-22 リリースオーナー指示: 「完全体になるまで絶対にやめるな。session limit 明けも
継続できるように対策しておけ」。

**再開手順(新しいセッションはここから):**
1. このファイルの未完了 `[ ]` を上から順に
2. 各項目は「コード → テスト緑 → test worker / シミュレータで実機確認 → コミット → ここを `[x]`」
3. 完了判定は下の「完全体の定義」をすべて満たした時。満たしたら最終節に記録

## 完全体の定義

- [x] A. 回答品質バックログ(実機で見つかった劣化)がすべて解消
- [x] B. iOS の既知不具合がすべて解消
- [x] C. 口語ベンチ(human-phrasing-12 × production-tracked-15)が新 LKG として記録され、
      綺麗版との経路差分が説明可能
- [ ] D. Worker の改善がすべて本番に反映され、本番 smoke PASS
- [x] E. 全テスト緑(Worker / iOS unit / iOS UI / sec-fetcher)、docs と memory が現状と一致

## A. 回答品質バックログ

- [x] A1. セグメント質問が売上スナップショットに吸われる(「AWS growth?」→全社売上)。
      セグメント語を含む質問は segment_driver/model 経路へ
- [x] A2. Q01 薄ラベル: JPM「決済・取引サービス」、AVGO「クラウドサービス」、META「その他収益」。
      抽出ラベルが1件だけ/汎用語のときは guard が拾ってモデル経路へ
- [x] A3. 口語語彙: Q10「借金やばくない？」→ liquidity_debt、Q11「やばいとこある？」→ risk_factors
      (intent-colloquial-parity の pin を解除して一致させる)
- [x] A4. 投資助言ベイトの口語セット(「で、これ買い？」)をベンチに追加し、redirect を確認

## B. iOS 既知不具合

- [x] B1. 検索結果の行が生 API 名(SEC 大文字)— 表記の関所を通す
- [x] B2. 「Dev モード」トグルが ON にできない — **アプリの不具合ではない**。シミュレータへの
      注入タップ(シミュレータパネル経由も同じ)が UISwitch を動かさず、Apple 純正の
      設定 > Show Borders でも同じ。スワイプなら全トグルが保存される(コンテナ内 plist で確認)。
      注意: `simctl spawn defaults` が見る plist はアプリの物ではない。実体は
      `simctl get_app_container … data` 配下の `Library/Preferences/app.kabuyomi.ios.plist`
- [x] B3. 入力欄の「H」残り等、送信不能ドラフトの扱い — 字はあるが送れない時だけ、会社チップと残高の間に
      「もう少し詳しく」を出す(`streamDraftHint`)。残高不足など他の理由が優先。空欄には出さない

## C. ベンチ

- [x] C1. human-phrasing-12 × production-tracked-15 を full run、LKG として記録
      → `2026-08-22-human-phrasing-12x15-lkg`(+ AAPL/JPM/MA 取り直し `…-aapl-rerun`、
      Q08 再検証 `2026-08-22-human-q08-segment-15`)。証跡は FULL_READ_AUDIT Q-2
- [x] C2. core-12 との経路差分を読み、A3 の効果を確認 → `2026-08-22-core-12x15-lkg`。
      意図 10/12 一致(残り 2 は口語の読みの違い)、経路差は Q08 のみ → 修正後 15/15 一致。
      Q10/Q11 は両版とも 15/15 が liquidity_debt / risk_factors

## D. 本番反映

- [ ] D1. Worker の未反映分(意図修正 ee11b11 以降、質問ガード、safe-harbor 判定、A 系)を
      release gate の waiver 更新 → deploy → smoke:production:release PASS
      **本番デプロイはリリースオーナーの明示 GO があってから**(この制約は /goal より先に
      オーナーが置いたもの。waiver の `APPROVED_BY_RELEASE_OWNER` を私が書くのは承認の捏造)。
      準備済み手順(GO 後に実行、所要 10 分。release guard の check-only は PASS 済み):
      1. `cd workers && npm run -s release:candidate` が `6b4267b1…` であることを確認
         (workers/src・d1/migrations・shared を触ると変わる。変わっていたら pending ファイルの
         候補 ID 3 箇所を置き換える)
      2. `cp docs/release/RELEASE_GATE_STATE.pending-6b4267b1.json docs/release/RELEASE_GATE_STATE.json`
         → scope 末尾の「Release-owner GO: PENDING」を GO の日付に書き換えて commit
      3. `npm run deploy:check`(PASS)→ `npm run deploy` → `npm run smoke:production:release`
      4. 本節を `[x]`、memory の本番 worker 版を更新

## E. 整合

- [x] E1. 全スイート緑(Worker 1253 / typecheck / iOS unit / iOS UI 21 / sec-fetcher 15)、
      FULL_READ_AUDIT Q 節 / V2_IA_SPEC Phase 7 / memory 更新済み

## 判明した外部制約(完全体の定義に含めない — 抽出側の作業)

- MA の抽出 MD&A が 4,954 字(業績記述のみ、自己紹介文なし)、COST は metrics_only。
  チャット層は正直な不足回答に倒してある。根治は sec-fetcher / mda.ts の抽出範囲

## スコープ外(完全体の定義に含めない — オーナー作業)

- アプリアイコン / App Store 素材の v2 化
- AdMob 本番バナーユニットの発行
- App Attest 拡張検査の flip(計測待ち)
- 10/05 の remote config 失効対応(期日作業)

## F. UI 再監査(2026-08-24、オーナー「全てにおいてゴミ」)

- [x] F1. サマリー: 空白の海+濁ピル → 指標カード(ラベル上・色付き tabular 数字・箱塗り廃止)
      +「銘柄を追加」破線カード(`RedesignSummaryCompanyCard`)
- [x] F2. 根拠チップ: 全文断片つき縦積みの反復 → バッジ+ラベル1行の横並び
      (`RedesignCompactSourceChips`、断片は引用詳細に残る)。ストリーム・会話の両方
- [x] F3. 会話の回答が見出しサイズ → 常に本文サイズ(短文のみ太字で立てる)
- [x] F4. 文書ヘッダー(展開時)が生 SEC 名 → 表記の関所経由
- [x] F5. 資料/会話の segmented control → アクセント下線の自作タブ(選択は太さ+色+下線)
- [x] F6. 2度目の再監査(「ホームに質問バーがある理由がわからん/送信後どこ行った/
      同じ銘柄だらけ/銘柄どこ/バナーどこ」)→ **IA を組み替え**:
      ホーム=盤面(指標カード+追加+バナー)、会話タブ=会社ごと1行(最新の質問+回答数)
      → 会話面へ着地。ストリームと質問バーは廃止、質問はワークスペースのコンポーザ1本。
      ピッカーの「宛先にする」二役も廃止。ShellParityUITests は新骨格で書き直し(16本)。
      バナーは safeAreaInset だと iOS 26 の浮遊タブバー下で描かれない(ロード成功ログ
      は出るのに非表示)→ 盤面リストの行に移して表示を確認(AX 監査は
      `-KabuyomiUITestDisableBannerAds` で広告 HTML を対象外に)
- [x] F7. 3度目の指摘「スクロール量が多い/情報パネルに会話UIを埋め込むな」→
      会話を独立チャット画面(`RedesignChatScreen`)に摘出。ワークスペース=資料のみ+
      会話への入口バー1本。会話タブは 会社→チャット を積んで直行(戻れば資料)。
      提案チップはチャットの空状態へ移動(資料面が短くなる)。iOS 全テスト緑
- [x] F8. 「質問と回答の境界線がうすすぎて醜い」→ チャットバブル化: 質問=右寄せ
      accent バブル(onAccent 文字)、回答・作成中=elevated の角丸カード
- [x] F9. オーナー再確認 OK(2026-08-24「いいねやっとよくなった」)。F 節完了。
      掃除候補(旧ストリームの不要コード、ようこそ文言)は非緊急の別タスクとして残す
- [x] F10. 「広告表示はどこへ？」→ 真犯人は Dev クォータが plan=pro を名乗ること
      (8/22 の Dev モード付与以降ずっとバナーが消えていた)。DEBUG の dev モード中は
      free 扱いで表示。ロード中も枠を保持(「広告」プレースホルダ、失敗時のみ畳む)

## G. モデル検討(2026-08-24、オーナー「5.6 luna も検討」)

- [x] G1. gpt-5.6-luna A/B 36行 → `docs/quality/MODEL_EVAL_LUNA_2026-08-24.md`。
      結論: 保留(ガード同等・日本語は締まる・数値表現の乱れ1件・単価未確認)。
      切り替えるなら 180行 LKG を luna で1本流してから。単価確認はオーナー作業

## 最終状態(2026-08-22 深夜)

A・B・C・E 完了。**残りは D1 のみ**で、それはリリースオーナーの明示 GO を待つ
(手順は D1 に準備済み、所要 10 分)。GO が出たら D1 を実行して本ファイルを閉じる。
