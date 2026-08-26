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

## 次に確かめること

**AAPL はなぜ本文(資料と根拠 25件)を持てているのか。** どこかに昇格させる経路が
あるはず。`chat/usecase.ts:363` に `chat_metrics_only_upgrade_failed` があるので、
**質問したときに昇格している**可能性が高い。もしそうなら、
「資料を開いただけでは本文が無い」のが全銘柄で起きていて、
TSM で目立ったのは 20-F が新規追加だったから、ということになる。

確かめ方: AAPL を新しい端末状態で追加し、**一度も質問せずに**開いて
`資料と根拠` の件数を見る。0件なら全銘柄の問題、25件なら 20-F 固有。
