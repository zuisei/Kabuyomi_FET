# v2 完全体チェックリスト(継続作業の単一の真実)

2026-08-22 リリースオーナー指示: 「完全体になるまで絶対にやめるな。session limit 明けも
継続できるように対策しておけ」。

**再開手順(新しいセッションはここから):**
1. このファイルの未完了 `[ ]` を上から順に
2. 各項目は「コード → テスト緑 → test worker / シミュレータで実機確認 → コミット → ここを `[x]`」
3. 完了判定は下の「完全体の定義」をすべて満たした時。満たしたら最終節に記録

## 完全体の定義

- [x] A. 回答品質バックログ(実機で見つかった劣化)がすべて解消
- [ ] B. iOS の既知不具合がすべて解消
- [ ] C. 口語ベンチ(human-phrasing-12 × production-tracked-15)が新 LKG として記録され、
      綺麗版との経路差分が説明可能
- [ ] D. Worker の改善がすべて本番に反映され、本番 smoke PASS
- [ ] E. 全テスト緑(Worker / iOS unit / iOS UI / sec-fetcher)、docs と memory が現状と一致

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
- [ ] B3. 入力欄の「H」残り等、送信不能ドラフトの扱い(非活性時に理由を出すか)— 判断して処置

## C. ベンチ

- [ ] C1. human-phrasing-12 × production-tracked-15 を full run、LKG として記録
- [ ] C2. core-12 との経路差分を読み、A3 の効果を確認

## D. 本番反映

- [ ] D1. Worker の未反映分(意図修正 ee11b11 以降、質問ガード、safe-harbor 判定、A 系)を
      release gate の waiver 更新 → deploy → smoke:production:release PASS

## E. 整合

- [ ] E1. 全スイート緑、FULL_READ_AUDIT / V2_IA_SPEC / memory を最終状態に更新

## 判明した外部制約(完全体の定義に含めない — 抽出側の作業)

- MA の抽出 MD&A が 4,954 字(業績記述のみ、自己紹介文なし)、COST は metrics_only。
  チャット層は正直な不足回答に倒してある。根治は sec-fetcher / mda.ts の抽出範囲

## スコープ外(完全体の定義に含めない — オーナー作業)

- アプリアイコン / App Store 素材の v2 化
- AdMob 本番バナーユニットの発行
- App Attest 拡張検査の flip(計測待ち)
- 10/05 の remote config 失効対応(期日作業)
