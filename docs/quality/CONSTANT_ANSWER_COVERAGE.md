# 定数由来の回答が発火しうる範囲(自動生成)

`node workers/scripts/report-constant-answer-coverage.mjs --write` で再生成する。**手で編集しない。**

回答を変更するものではない。「すべての記述に、出典があります」という表示に対して、
実際にはどこまでが filing 由来でどこからが定数由来なのかを見えるようにするための表。

**読み方の注意**: ここに出るのは「ティッカーで門が開くか」であって、
「その質問で必ず発火するか」ではない。定型合成は evidence の有無と
回答の未達判定も条件にする。逆に `factual pack への seed` は
**本文の有無に関係なく** merge されるので、門が開けば必ず入る。

本番の追跡銘柄: 30件 (`DEFAULT_TRACKED_TICKERS`)

## 銘柄ごと

| ティッカー | 定数経路の数 | 発火しうる経路 |
|---|---:|---|
| `NVDA` | 6 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / factual pack への seed / 既知事業ラベル / 売上ファクト seed |
| `GOOG` | 4 | factual pack への seed / 既知事業ラベル / 売上ファクト seed / GOOG(L) 定型合成 |
| `AAPL` | 7 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / factual pack への seed / 既知事業ラベル / 売上ファクト seed / sector 判定表 |
| `MSFT` | 6 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / factual pack への seed / 既知事業ラベル / 売上ファクト seed |
| `AMZN` | 6 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / factual pack への seed / 既知事業ラベル / 売上ファクト seed |
| `AVGO` | 0 | — |
| `META` | 0 | — |
| `TSLA` | 4 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / sector 判定表 |
| `BRK-B` | 0 | — |
| `WMT` | 5 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / sector 判定表 / WMT 定型合成 |
| `JPM` | 5 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / sector 判定表 / JPM 定型合成 |
| `LLY` | 3 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) |
| `V` | 3 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) |
| `XOM` | 4 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / sector 判定表 |
| `JNJ` | 0 | — |
| `MU` | 3 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) |
| `ORCL` | 0 | — |
| `MA` | 0 | — |
| `AMD` | 0 | — |
| `COST` | 0 | — |
| `NFLX` | 0 | — |
| `BAC` | 0 | — |
| `CAT` | 4 | 事業内容(定数) / 売上区分(定数) / 許可ラベル(定数) / sector 判定表 |
| `ABBV` | 0 | — |
| `CVX` | 0 | — |
| `PLTR` | 0 | — |
| `HD` | 0 | — |
| `INTC` | 0 | — |
| `PG` | 0 | — |
| `CSCO` | 0 | — |

**13/30 銘柄**が1つ以上の定数経路に該当する。

## 経路ごと

| 経路 | 場所 | 本番銘柄の該当数 | 内容 |
|---|---|---:|---|
| 事業内容(定数) | `deterministic.ts TICKER_BUSINESS_OVERVIEWS` | 12/30 | 「{社名}は、{定数}で収益を得ている会社です。」を返し、filing の実ソースをチップとして添付する |
| 売上区分(定数) | `deterministic.ts TICKER_REVENUE_BREAKDOWNS` | 12/30 | 売上の内訳を定数で提示する |
| 許可ラベル(定数) | `deterministic.ts issuerSignalLabels` | 12/30 | 抽出されたシグナルをこの定数リストに載っているものだけに絞る |
| factual pack への seed | `context-factual-pack.ts seedKnownTickerLabels` | 5/30 | **本文に出ているかに関係なく** merge され、プロンプトは factual pack を raw excerpt より優先しろと指示する |
| 既知事業ラベル | `context-factual-pack.ts hasKnownBusinessLabels` | 5/30 | 定数ラベルを持つ銘柄として扱う |
| 売上ファクト seed | `context-factual-pack.ts seedKnownTickerRevenueFacts` | 5/30 | 売上区分を定数で seed する |
| 定数の事業説明 | `gemini/fallback-known-business.ts` | 0/30 | 完全な定数文字列を返す |
| sector 判定表 | `source-gate.ts normalizeSector` | 6/30 | この表に無い銘柄は companyName のキーワードだけで sector が決まる |
| JPM 定型合成 | `response-finalizer.ts buildJpmDurabilitySynthesis` | 1/30 | 完全な定数文字列。ラベルは `source_backed` を名乗る |
| WMT 定型合成 | `response-finalizer.ts buildWmtDurabilitySynthesis` | 1/30 | 完全な定数文字列。ラベルは `source_backed` を名乗る |
| GOOG(L) 定型合成 | `response-finalizer.ts buildGoogleDurabilitySynthesis` | 1/30 | 完全な定数文字列。ラベルは `source_backed` を名乗る |

## 本番の追跡リストに載っていない銘柄向けの定数

| 経路 | ティッカー |
|---|---|
| 事業内容(定数) | `GOOGL`, `KO`, `DAL` |
| 売上区分(定数) | `GOOGL`, `KO`, `DAL` |
| 許可ラベル(定数) | `GOOGL`, `KO`, `DAL` |
| factual pack への seed | `GOOGL`, `PH`, `CRWD`, `INTU`, `CEG` |
| 既知事業ラベル | `GOOGL`, `PH`, `CRWD`, `INTU`, `CEG` |
| 売上ファクト seed | `GOOGL` |
| 定数の事業説明 | `PH`, `CRWD`, `CEG`, `INTU` |
| sector 判定表 | `NET`, `KLAC`, `MS`, `ISRG`, `HAL`, `DE`, `CL`, `VTR`, `FOXA`, `AEP`, `FCX` |

これらは本番で追跡されていないため、表に載っていても発火する経路が無い。
