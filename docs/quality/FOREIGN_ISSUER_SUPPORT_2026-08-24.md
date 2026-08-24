# 外国企業(TSM など)への対応 — 実測調査

2026-08-24。オーナー「ついに TSM とかそのへんの企業に対応したい」を受けた事前調査。
**実装はまだ入れていない。** 数字はすべて SEC の生 API を叩いた実測で、推定ではない。

## 結論を先に

TSM は **20-F しか出さず、XBRL は `ifrs-full`、通貨は TWD**。
今のパイプラインは 3 か所で弾く。ただし **どれも小さい**。

一番効くのは技術ではなく仕様の話で、**20-F は年 1 回**だという点。
盤面の 3 ピル(売上・営業利益・純利益 YoY)は米国企業なら四半期ごとに動くが、
TSM では**年 1 回しか動かない**。これは実装では消せない差で、先に決めるべきはここ。

## 実測: 8 社の素性

| ティッカー | 提出書類 | XBRL タクソノミ | 通貨 | 四半期の XBRL 行 |
|---|---|---|---|---|
| TSM | 20-F / 6-K | `ifrs-full` | TWD + **USD** | 71 / 3,580 |
| ASML | 20-F | **`us-gaap`** | EUR | 247 / 6,326 |
| SAP | 20-F | `ifrs-full` | EUR + USD | 1 / 3,649 |
| TM (トヨタ) | 20-F | `ifrs-full` + `us-gaap` | JPY + USD | 70 / 6,068 |
| BABA | 20-F / 6-K | **`us-gaap`** | CNY + USD | 8 / 5,341 |
| SHEL | 20-F / 6-K | `ifrs-full` | **USD のみ** | 1,715 / 5,666 |
| NVO | 20-F / 6-K | `ifrs-full` | DKK + EUR(**USD 無し**) | 30 / 2,932 |
| SONY | 20-F | `us-gaap` + `ifrs-full` | JPY + USD | 24 / 8,223 |

**8 社とも 10-K / 10-Q はゼロ。** 「外国企業」はひとかたまりではなく、
タクソノミと通貨で別々に割れる。us-gaap で出している会社(ASML・BABA)もいる。

## 弾いている 3 か所

### 1. 提出書類の門(これが最初に効く)

`sec-fetcher/src/sec-service.mjs:535` — 直近 4 年で **10-K が 3 本以上かつ 10-Q が 4 本以上**を要求。
TSM は 0 本 / 0 本なので、ここで落ちる。**8 社全部が同じ理由で落ちる。**

### 2. XBRL のタクソノミ

`sec-fetcher/src/sec-service.mjs:178` が `facts["us-gaap"]` しか読まず、
同 203 行の個別取得 URL も `/us-gaap/{tag}.json` 固定。TSM に `us-gaap` は無い。

ただし対応表は小さい。`workers/src/clients/sec.ts:30` の `METRIC_TAGS` は 8 指標 12 タグしかなく、
**実測で 8 指標すべて ifrs-full に対応物があった**:

| 指標 | ifrs-full タグ | USD 換算 |
|---|---|---|
| revenue | `Revenue` | あり |
| netIncome | `ProfitLoss` ※既に候補入り | あり |
| operatingIncome | `ProfitLossFromOperatingActivities` | あり |
| operatingCashFlow | `CashFlowsFromUsedInOperatingActivities` | あり |
| cashAndCashEquivalents | `CashAndCashEquivalents` | あり |
| currentDebt | `CurrentPortionOfLongtermBorrowings` | あり |
| longTermDebt | `LongtermBorrowings` | あり |
| epsBasic | `BasicEarningsLossPerShare` | **TWD のみ** |

**TSMC は USD 換算値を自分で出している**(1 指標あたり 9 行)。為替を自前で持たなくても、
EPS 以外は USD のまま出せる。ただし NVO のように USD をまったく出さない会社もある。

### 3. 文章(MD&A)の切り出し

`sec-fetcher/src/prepared-filing.mjs:117` の `getPatterns` は
10-K の「Item 7 MD&A」と 10-Q の「Item 2 MD&A」しか知らない。
20-F の該当箇所は **「Item 5. Operating and Financial Review and Prospects」**。
当たらないと `Failed to extract MD&A section` で落ちる。

出典付きで答えるのがこのアプリの売りなので、**ここを抜くと数字だけの薄い会社になる**。
正規表現を足すだけだが、抜けているかどうかは実物で確かめる必要がある。

## 先に決めてほしいこと

**年 1 回しか動かない会社を盤面にどう出すか。**

- 案 A: 年次として正直に出す(ピルに「FY2024」等を明記し、四半期企業と区別)
- 案 B: 出さない(年次企業は会話専用にして盤面には載せない)
- 案 C: 6-K の四半期業績を読む — **これは別物の大工事**。6-K の中身は
  構造化されていない添付資料で、XBRL からは取れない(Shell だけが例外的に四半期 XBRL を持つ)

## 段取りの案

1. **門を通す**: 20-F を supported form に加える(年次企業という属性を持たせる)
2. **タクソノミを引数化**: `us-gaap` 固定を外し、ifrs-full の対応表 8 本を足す
3. **20-F の Item 5 パターン**を追加、実物で抜けを確認
4. **通貨**: USD 換算があればそれを使い、無ければ現地通貨を単位付きで出す
5. **表示**: 決めた案に沿って盤面とカードを直す

ASML と BABA は既に `us-gaap` なので、**1 と 3 だけで動く可能性がある**。
TSM を最短で出したいなら 1・2・3 が必要。
