# 20-F は保存できるが本文が出ない(2026-08-26・未解決)

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

## 次にやること

1. TSM の archived record が**いつ・どの経路で**書かれたのか特定する。
   有力: 履歴バックフィル。`history-store.ts` の `DEFAULT_BACKFILL_FORMS` は
   10-K のみ、`:526` の絞り込みも 10-K/10-Q だけを通す — **20-F がどう入ったのか**
   ここと整合しない。まずそこを読む
2. 昇格路を通す条件を決める。`deferFullContent` が true でも、
   **本文が無い記録を返そうとしているなら昇格させる**のが素直
3. `markFilingPrepJobReady` が「読める」を確かめずに ready にしている点も直す。
   ready の意味を「本文がある」に寄せる
