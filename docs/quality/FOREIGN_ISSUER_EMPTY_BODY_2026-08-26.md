# 20-F は保存できるが本文が出ない(2026-08-26・**解決済み**)

TSM(台湾積体電路)を追加しても `資料と根拠 0件` で、要約も指標も出ない。
**推測ではなく、シミュレータで再現してワーカーのログを取った結果**を残す。

## 直した方(このバグとは別)

保存経路の関所が 20-F を弾いていた。`normalizeForm` は直っていたのに、
`watchlist/usecase.ts` だけ `!== "10-K" && !== "10-Q"` のまま残っていた。
`env.ts` の `SUPPORTED_FILING_FORMS` に寄せて修正・デプロイ済み。
**TSM は追加できるようになった。ここまでは確認済み。**

## 残っている方

追加はできるのに本文が無い。ログはこう:

```
filing_selected        TSM 20-F 0001628280-26-025362
latest_filing_ready    source: "archive_after_remote_check"
company_load_success   mode: refresh
history_preload        contentMode: "metrics_only"
```

D1 の `filing_prep_jobs`:

```
ticker TSM / status ready / error_message NULL / 08:06:23Z
```

**準備ジョブは成功したと言っている。それでも本文が無い。**

## 分かっている筋

- `company/usecase.ts:133` は `deferFullContent: true` を**固定**で渡す
- `latest.ts` はそのとき `ingestFiling(..., contentMode: "metrics_only")` を呼ぶ。
  metrics_only は本文抽出を通らない
- `prepareLatestRecordForReturn` に昇格路(`upgradeMetricsOnlyRecord`)はあるが、
  `deferFullContent` が true だと**素通りして metrics_only の記録をそのまま返す**
- `watchlist/usecase.ts:76` の準備ジョブも `deferFullContent: true` で走り、
  そのあと `markFilingPrepJobReady` を呼ぶ。
  **つまり `ready` は「読める」を意味していない**
- `deferFullContent` を渡す3か所は全部 true。false を渡す呼び出し元が無い

## 切り分け済み(2026-08-26、シミュレータで実測)

| 銘柄 | 形式 | 状態 | 資料と根拠 |
|---|---|---|---|
| HUN (Huntsman) | 10-Q | **新規**・今日取り込み | **9件** ✅ 要約も本文引用も出る |
| AAPL | 10-Q | 既存(7/12 のキャッシュ) | 25件 ✅ |
| TSM | 20-F | **新規**・今日 | **0件** ❌ |

**「新規追加の会社は全部空」ではない。20-F だけ。**
一度も質問していない新規 10-Q(HUN)は、開いた時点で本文を持っている。
当初「質問したときに昇格しているのでは」と疑ったが、**それは違った**。

## 効いている差

TSM のログ:

```
latest_filing_ready  source: "archive_after_remote_check"
```

**TSM は既にある記録を見つけて再利用し、HUN は無かったので取り込みが走った。**
再利用された TSM の記録が `metrics_only`(本文なし)だったので空になる。
`prepareLatestRecordForReturn` に昇格路はあるが、`deferFullContent: true` だと
素通りする。呼び出し3か所は全部 true。

## 原因(確定)

```ts
// clients/sec-fetcher.ts:315
const formType = payload.formType === "10-K" || payload.formType === "10-Q" ? payload.formType : null;
if (!formType) throw new AppError(400, "prepared filing formType must be 10-K or 10-Q");
```

**本文を用意する経路の振り分けが 20-F を 400 で弾いていた。**
`sec-fetcher/src/prepared-filing.mjs:121` は Item 5 を読む実装を**既に持っている**のに、
手前の振り分けだけが古いままで、実装まで届いていなかった。

保存の関所(`watchlist/usecase.ts`)と**まったく同じ形の取りこぼし**。
20-F を足したとき、`normalizeForm` と抽出器は直したが、
**間にある2つの振り分けを両方とも見落としていた。**

## 直した結果(シミュレータで実測)

TSM 20-F: 資料と根拠 **8件**、要約
「2025年の純売上高は前年比で31.6%増となり、主因はASPの上昇である。」
本文引用「Our net revenue in 2025 increased by 31.6% from 2024...」

## 再発防止

判定は `env.ts` の `SUPPORTED_FILING_FORMS` / `isSupportedFilingForm` に集約した。
`test/supported-filing-forms.test.ts` が 20-F を固定している。
**書類を増やすときはこの1か所だけを触る。**
