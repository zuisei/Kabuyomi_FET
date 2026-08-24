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

---

# 実装中に判明: 「外資全般」は本文の形で 2 つに割れる

Stage 1 の MD&A パターンを実物 5 社(TSM / SAP / TM / ASML / SHEL の最新 20-F)で
試して分かったこと。**10-K のように様式が揃っていない。**

## Type A — 本文に Item 見出しがある

TSM・SAP・トヨタ。`ITEM 5. OPERATING AND FINANCIAL REVIEW AND PROSPECTS` が本文にあり、
`ITEM 6. DIRECTORS...` で終わる。パターン抽出が効く。**3 社とも見出しから正しく抽出できた。**

引っかかった点が 2 つ:

1. **TSMC は "Reviews"(複数形)** で書く。様式どおり単数形しか見ない正規表現は TSMC を丸ごと落とす。
2. **相互参照を入口と取り違える**。`“Item 5. Operating and Financial Review and Prospects – Expected
   Developments.”` のような参照が本文より前に何度も出る。素直に書くと SAP で
   **Item 4 のサステナビリティ記述を財務レビューとして 38,000 字抜いた**(実測)。
   相互参照は章題のあとに **ダッシュか閉じ引用符**が続くので、否定先読みで弾ける。
   トヨタも同じ理由で 1 回外していた。

## Type B — 本文に Item 見出しが無い

**ASML と Shell**。自社の統合年次報告をそのまま 20-F として出し、冒頭に
「Item 5 → 23-30, 36-41 ページ」という**相互参照表**を置く形。本文の見出しは
`Financial performance – Performance KPIs` のような自社の章名で、Item 番号は本文に出てこない。

見出しベースの抽出は**原理的に効かない**。今は **null を返して落ちる**ようにしてある。
別の章を財務レビューと偽るよりは、抜けない方がよい。

### Type B をどうするか(未決)

- 案 1: `contentMode: "metrics_only"` で出す。XBRL の数字は 8 社とも取れているので、
  数字だけの会社として正直に出す。既存の仕組みにそのまま乗る(COST が同じ扱い)
- 案 2: 相互参照表を読んでページ範囲/自社章名に解決する。汎用に作るのは重い
- 案 3: **6-K の業績プレスリリースを本文として使う**。Stage 2 でどのみち読むし、
  四半期ごとに出る短い文書なので、500 ページの年次報告より会話には向く可能性がある

**案 3 が Stage 2 と重なるので筋が良さそう**だが、決めるのはオーナー。

## 現在の状態

- `FilingFormType` に 20-F を追加(型は全体に通した。**まだ門は開けていない** =
  `normalizeForm` は 10-K/10-Q しか通さないので、本番の挙動は不変)
- 20-F の MD&A パターンを追加。Type A 3 社で実物確認、Type B 2 社は意図的に null
- テスト: Worker 1266 / typecheck 緑

---

# Stage 2 着手: 6-K を本文にも使う(オーナー「3 でいいかと」)

Type B(ASML / Shell)の本文をどうするか → **案 3「6-K の業績プレスリリースを使う」で決定**。

## 前提を確認した: Type B も 6-K で業績を出している

| | 四半期の 6-K | 中身 |
|---|---|---|
| ASML | `form6-kquarterlyfilings.htm` 9.1MB | **`pressreleasefinancialresul.htm`(業績プレスリリース)** + `financialstatementsusgaa.htm` + 統計的中間報告 + 説明会資料 |
| Shell | `shel-20260630_d2.htm` 8.8MB | **`isXBRL=1 / isInlineXBRL=1`** — 四半期の数字が XBRL で取れる唯一の会社 |
| TSM | 1.4MB | EX-99.1 に損益表(前掲) |

**Type B の 2 社とも救える。** しかも Shell は XBRL があるので HTML 解析すら要らない。
20-F の本文が読めない会社でも、四半期のプレスリリースなら読める。

## 「どの 6-K か」の判別

6-K は「その月に起きたことの報告」という器なので中身が定まっていない。TSM の直近 3 か月で
四半期業績・月次売上速報・取締役会決議・配当調整・株主総会の 5 種類が出てくる。

**サイズは使えない**(TSM は月次速報 100KB / 四半期業績 1.4MB / 四半期財務諸表 4.9MB で重なる)。
**本体も使えない** — 3 社とも本体は表紙と署名だけで、中身は必ず添付に入っている。

`workers/src/lib/filings/six-k.ts` に判定を実装した。手掛かりは 3 つ:

1. **期の言及**(`second quarter` / `Q2 2026`)— **文書内で一番早いもの**を採る
2. **売上の語**(revenue / net sales / total net sales — 会社ごとに呼び方が違う)
3. **最終利益の語**(net income / profit attributable)— 月次速報はここで落ちる

実物 5 本で検証し、全部意図どおりに出た。作る過程で 2 回外している:

- **期を本文から拾って 1 年ずれた**。ASML は自社株買いの段でも "second quarter" に触れ、
  そこから一番近い "ended" が末尾のリスク要因の「Form 20-F for the year ended December 31, 2025」。
  → 一番早い言及を採り、締め日は**近く(2,000 字以内)に無ければ null**にした。
  日付が分からないと言う方が、捏造するよりよい
- **取締役会決議を業績と誤判定した** … と思ったが、**中身を読んだら同じ売上・純利益・EPS が
  載っていた**。「業績ではない」と切り捨てるのは嘘になるので、`kind` を
  `results_release` / `board_resolution` に分けて呼ぶ側が選べるようにした。
  同じ四半期に両方あればプレスリリースを優先する

## 次

- 損益表(EX-99.1 のテーブル)から数字を取り、**原文の抜粋に結びつける**
- Shell は XBRL 経路に分岐
- 提出書類の門を開ける(まだ閉じている = 本番挙動は不変)

---

# Stage 1 完了: 門を開けた(2026-08-24)

**外国企業(20-F)が実際に扱えるようになった。** 本番挙動が変わるのはデプロイ後。

## 訂正: 門は `hasEnoughSupportedHistory` ではなかった

このファイルの前半で「提出書類の門(`sec-fetcher-service.ts:645`)が最初に効く」と書いたが、**間違い**。
あれは `expandSubmissionHistory` の**ページ送り打ち切り条件**で、銘柄の可否は決めていない。

実際に弾いていたのは **`normalizeForm`**(`src/clients/sec.ts`)で、
`"10-K"` と `"10-Q"` 以外を null にしていた。`pickLatestSupportedFiling` がここを通るので、
20-F しか出さない会社は「対応する提出書類が無い」として落ちていた。

打ち切り条件の方も直した。放置すると 20-F 提出者では**永久に条件を満たさず履歴を全部取りに行く**
(正しさではなく通信量の問題)。

## 変えたところ

| 場所 | 内容 |
|---|---|
| `clients/sec.ts` `normalizeForm` | **20-F を受け付ける**(訂正版 `20-F/A` は従来どおり通さない) |
| `clients/sec.ts` `METRIC_TAGS` | 8 指標に ifrs-full のタグを追加。**us-gaap を先に置く**(トヨタ・ソニーは両方で出す) |
| `clients/sec.ts` `resolveFact` | `companyfacts` を us-gaap → ifrs-full の順で探す |
| `clients/sec.ts` `durationScore` / 期間分類 | 20-F を 10-K と同じ**年次**扱い(四半期の窓だと年次の事実が全部落ちる) |
| `lib/sec-fetcher-service.ts` | 同上のタクソノミ対応 + `companyconcept` を両タクソノミで引く |
| `lib/sec-fetcher-service.ts` | 打ち切り条件に 20-F 3 本の経路を追加 |
| `lib/contracts.ts` | backfill の `forms` に 20-F |
| `sec-fetcher/src/*.mjs` | 未使用側の実装も対で更新(ファイル冒頭の指示どおり) |
| iOS `APIModels.swift` / `AppModel.swift` | 20-F を対応済みに。「10-K / 10-Q のみ対応」の文言を修正 |

## 通貨は何もしなくてよかった

`selectBestFact` が **USD(EPS は USD/shares)しか通さない**設計だったので、
**TSMC が自分で併記している USD 換算値がそのまま乗る**。為替をこちらで持つ必要がない。

代わりに **EPS は落ちる**(TSMC は EPS を TWD でしか出さない)。
換算すれば数字は作れるが**出典の無い数字**になるので、落とすのが正しい。
NVO のように USD をまったく出さない会社は指標が空になる。これも黙って推測しないという同じ判断。

## 検証

TSMC の**実データ**(20-F `0001193125-25-083423` / FY2024、SEC の companyfacts から取得)で
`test/foreign-issuer-metrics.test.ts` を書いた。作文した値だと、IFRS のタグ名や
USD 併記の有無を取り違えても気づけない。

- 6-K だらけの提出履歴から 20-F を選ぶ
- ifrs-full から売上 882.68 億ドル / 営業利益 403.19 億 / 純利益 353.01 億 / 営業CF 556.93 億を読む
- 期間が `annual` になる
- **TWD しか無い EPS は出さない**
- **両タクソノミを持つ会社では us-gaap が勝つ**

全スイート: Worker 1278 / typecheck / sec-fetcher 15 / iOS 319。

## 残り(Stage 2)

- 6-K の損益表から**四半期**の数字を取る(判別は実装済み、抽出はこれから)
- Shell は 6-K に XBRL があるので別経路
- ASML / Shell の**本文**は 20-F からは取れないまま(Type B)。6-K のプレスリリースを使う方針
