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

---

# 決定と設計(2026-08-24、オーナー回答後)

オーナーの回答:
- カデンス → **案 C「6-K の四半期業績まで読む」**
- 範囲 → **「そういう外資全般いきたい」**(TSM 単体ではない)

## 6-K を実物で確認した

`isXBRL = 0`。**6-K に構造化データは無い**(Shell だけが例外的に四半期 XBRL を持つ)。
中身は HTML の添付資料で、TSM の場合 1 回の四半期につき 3 本:

```
a2q26e_withguidancexfinal.htm   ← EX-99.1 業績プレスリリース(28KB)
a2q26presentatione.htm          ← 説明会資料
tsm-20260716x6k.htm             ← 6-K 本体(カバーレター)
```

**EX-99.1 に損益表がそのまま入っていた**(2026-07-16 提出、2Q26):

| | 2Q26 | 2Q25 | YoY% | 1Q26 | QoQ% |
|---|---|---|---|---|---|
| Net sales | 1,270,381 | 933,792 | 36.0 | 1,134,103 | 12.0 |
| Gross profit | 860,311 | 547,369 | 57.2 | 751,295 | 14.5 |
| Income from operations | 766,603 | 463,423 | 65.4 | 658,966 | 16.3 |
| Net income | 706,562 | 398,273 | 77.4 | 572,480 | 23.4 |
| EPS (NT$) | 27.25 | 15.36 | 77.4 | 22.08 | 23.4 |

盤面の 3 ピル(売上・営業利益・純利益 YoY)に必要な値が全部あり、**YoY は会社が自分で計算している**。
本文にも同じ数字が散文で書かれ、USD 建ての売上も併記されている。

ただし **6-K は四半期業績だけではない**。TSM の直近だけでも月次売上速報・取締役会決議・
月末報告が混ざる。「どの 6-K が四半期業績か」の判別が必要。

## 段取り

### Stage 1 — 外国企業を「存在する会社」にする(6-K の前に必須)

- `formType` の union `"10-K" | "10-Q"` を広げる。**33 箇所 / 19 ファイル**に出るので、
  型を広げれば全部コンパイラが指してくれる
- 提出書類の門(`sec-fetcher-service.ts:645`、および使われていない `sec-service.mjs:535`)に
  20-F を通す。会社に **年次 / 四半期のカデンス属性**を持たせる
- XBRL タクソノミを引数化(`us-gaap` 固定を外す)+ ifrs-full の対応表 8 本
- 通貨: USD 換算があれば使い、無ければ現地通貨を単位付きで
- MD&A: 20-F の **Item 5 (Operating and Financial Review and Prospects)** パターン

これだけで **ASML / BABA(既に us-gaap)と TSM の年次**が出る。

### Stage 2 — 6-K の四半期業績

- **どの 6-K が四半期業績か**を判別する(添付の EX-99.1 の有無・本文の見出し・提出月)
- EX-99.1 の損益表を読む
- **数字は必ず原文の抜粋に結びつける**。ここは新規に作らず、8/22〜23 に入れた
  excerpt-supported numeric claims / `numeric-alignment.ts` の仕組みに乗せる。
  「すべての記述に出典がある」を外国企業だけ緩めない

### Stage 3 — 表示

年次企業と四半期企業が同じ盤面に並ぶので、どちらの期のものかカードで明示する。

## この設計の一番の risk

**会社ごとにプレスリリースの形が違う。** TSM は素直だったが「外資全般」は
同じ形ではない。Stage 2 は 1 社ずつパーサを書く形にすると破綻するので、
表の見出し語彙(Net sales / Revenue / Income from operations / Operating income …)で
引き当てる汎用抽出 + 原文照合、という作りにする。**照合が取れない会社は数字を出さない**
(黙って推測しない)のが、このアプリの既存の建て付けと一致する。
