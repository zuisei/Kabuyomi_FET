# 定数由来の回答が発火しうる範囲(自動生成)

`node workers/scripts/report-constant-answer-coverage.mjs --write` で再生成する。**手で編集しない。**

## 現状: 0件

会社固有の記述を定数として持ち、それに filing の実ソースチップを付けて返す経路は
本番コードから削除済み。事業内容・売上区分・継続性の回答は、抽出結果か、
別途出典検証を通るモデル経路か、根拠不足を認める回答のいずれかになる。

スクリプトは `workers/src` 配下の TypeScript を走査し、
下表の宣言が再び現れたら非ゼロ終了する。

## 削除済みの宣言(再導入を禁止)

| 宣言 | あった場所 | 返していたもの |
|---|---|---|
| `TICKER_BUSINESS_OVERVIEWS` | `lib/chat/deterministic.ts` | 「{社名}は、{定数}で収益を得ている会社です。」+ filing の実ソースチップ |
| `TICKER_REVENUE_BREAKDOWNS` | `lib/chat/deterministic.ts` | 「売上構造を見る軸は、{定数}です。」+ filing の実ソースチップ |
| `seedKnownTickerLabels` | `lib/chat/context-factual-pack.ts` | 本文の有無に関係なく factual pack に定数ラベルを merge |
| `seedKnownTickerRevenueFacts` | `lib/chat/context-factual-pack.ts` | 本文の有無に関係なく factual pack に定数の売上区分を merge |
| `summarizeKnownCompanyBusiness` | `clients/gemini/fallback-known-business.ts (ファイルごと削除)` | PH / CRWD / CEG / INTU の事業説明を完全な定数文字列で返す |
| `buildJpmDurabilitySynthesis` | `lib/chat/response-finalizer.ts` | JPM 類似 filing に銀行業の定型段落を返し source_backed ラベルを付ける |
| `buildWmtDurabilitySynthesis` | `lib/chat/response-finalizer.ts` | WMT 類似 filing に小売の定型段落を返し source_backed ラベルを付ける |
| `buildGoogleDurabilitySynthesis` | `lib/chat/response-finalizer.ts` | Alphabet 類似 filing にプラットフォームの定型段落を返す |

## 意図的に残している銘柄別テーブル

どちらも「実データに対するフィルタ・ゲート」であって、記述を作り出さない。
この0件は「見るのをやめた」という意味ではない。

| 名前 | 場所 | 残す理由 |
|---|---|---|
| `issuerSignalLabels` | `lib/chat/deterministic.ts` | MD&A の実文から抽出済みのシグナルを、その発行体にとって意味のあるものだけに絞る。追加はできず、削るだけ。 |
| `normalizeSector` | `lib/chat/source-gate.ts` | どの根拠タイプを要求するかを決める sector 判定。回答文そのものを供給しない。 |
