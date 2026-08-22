# 2026-08-22-human-q01-refix-8 Answers

## Test Method

- Scope: prompt v2 smoke response test against the Kabuyomi test Worker.
- Base URL: https://kabuyomi-api-test.dznqjmctk7.workers.dev
- Run started at: 2026-08-22T02:22:45.215Z
- Tickers: AAPL, GOOG, JPM, CAT, AVGO, META, BAC, MA
- Rows: 8
- Questions: `/private/tmp/claude-501/-Users-0xt4-t4dano-statik-apps-Kabuyomi/1f8ecabe-5262-4faf-9ede-5d595b971cb8/scratchpad/q01-only.jsonl`
- Company set: `inline:KABUYOMI_TESTBENCH_TICKERS`
- Question templates observed: 1
- Company tickers observed: 8
- Note: hidden internal chain-of-thought is not recorded. This report records observable test rationale, criteria, outputs, and diagnostics.

## Result Summary

- Response paths: deterministic=6, fallback=2
- Fallback reasons: low_quality_answer=2, none=6
- Infra errors: none=8
- Source ID invalid rows: 0
- Quality rows: 8
- Quality fallback rate: 25.0%
- Quality Q03/Q04/Q06 fallback: 0
- Quality hard-intent fallback: 2
- Average latency: 2148 ms
- Max latency: CAT-Q01 6330 ms

## Quality Gate Counters

- rawEnglishSurfaced: 0
- hybridEnglishJapaneseSurfaced: 0
- genericBusinessModelAnswers: 0
- genericRevenueBreakdownAnswers: 0
- misleadingRevenueDriverCauses: 0
- nonFinancialCashFlowBankLanguage: 0
- metricOnlyImportantIntentAnswers: 0
- durabilityFollowupLostPriorDriver: 0
- numericDisplaySuspicious: 0
- unsupportedDurabilityClassification: 0
- unsupportedRiskOrLiquidityConclusion: 0
- qualitySourceEvidenceWeak: 2
- fallbackTaxonomyIntentMismatch: 0
- fallbackKindNoneOnFallbackRows: 0

## Review Notes

- Treat `fallbackReason=low_quality_answer` rows as the first human-review targets.
- Deterministic rows are expected when the local deterministic answer path handles the question.
- A row with no fallback is not automatically perfect; review the full answer text below for wording and grounding quality.

## Quality Issue Examples

### qualitySourceEvidenceWeak

- CAT-Q01 CAT Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: Caterpillarはエンドユーザー向けの機械・サービスの販売を通じて収益を得ています。主な収益源: Power & Energy、資源産業、建設機械 の三大セグメントの製品・サービスの販売、特にエンドユーザーへの機器販売が中心です。 要因として販売量の増加と価格 realization の改善が挙げられています。注意点: 売上増加の背景にはディーラ在庫の増加など販売量の押し上げ要因があり、同時に製造コストには関税の影響な
- BAC-Q01 BAC Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: Bank of Americaは銀行・金融サービスを提供する企業で、全社売上高を主な収益として稼いでいます。 注意点: 直近の開示では、セグメント別の収益源の内訳が示されていない点に留意してください。

### qualityHardIntentFallback

- CAT-Q01 CAT Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: Caterpillarはエンドユーザー向けの機械・サービスの販売を通じて収益を得ています。主な収益源: Power & Energy、資源産業、建設機械 の三大セグメントの製品・サービスの販売、特にエンドユーザーへの機器販売が中心です。 要因として販売量の増加と価格 realization の改善が挙げられています。注意点: 売上増加の背景にはディーラ在庫の増加など販売量の押し上げ要因があり、同時に製造コストには関税の影響な
- BAC-Q01 BAC Q01 business_model (fallback/low_quality/answer_too_metric_only): 一言概要: Bank of Americaは銀行・金融サービスを提供する企業で、全社売上高を主な収益として稼いでいます。 注意点: 直近の開示では、セグメント別の収益源の内訳が示されていない点に留意してください。

## Fallback Rows

- CAT-Q01: low_quality_answer / low_quality / answer_too_metric_only
- BAC-Q01: low_quality_answer / low_quality / answer_too_metric_only

## All Answers

### AAPL-Q01

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1756 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Apple Inc.は、iPhone、Mac、iPad、ウェアラブル、ホーム、アクセサリ、サービスを主な事業・製品群として持つ会社です。
```

Sources:

- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### GOOG-Q01

- Ticker: GOOG
- Filing key: v9:0001652044:000165204426000048
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 630 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Alphabet Inc.は、Google Search、YouTube、Google Cloud、Google Network、Other Bets、Googleサービスを主な事業・製品群として持つ会社です。
```

Sources:

- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### JPM-Q01

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 610 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
JPMORGAN CHASE & COは、決済・取引サービスを主な事業にする会社です。提出資料の本文にある事業説明から確認できます。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### CAT-Q01

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: business_overview
- Model: openai / unknown
- Tokens: prompt=4488, completion=936, total=5424
- Latency: 6330 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, fallback_slot_incomplete

Answer:

```text
一言概要: Caterpillarはエンドユーザー向けの機械・サービスの販売を通じて収益を得ています。主な収益源: Power & Energy、資源産業、建設機械 の三大セグメントの製品・サービスの販売、特にエンドユーザーへの機器販売が中心です。

要因として販売量の増加と価格 realization の改善が挙げられています。注意点: 売上増加の背景にはディーラ在庫の増加など販売量の押し上げ要因があり、同時に製造コストには関税の影響などのコスト要因も存在します。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- CTX1: 10-Q Business overview context, filed 2026-05-06 (md_a)
- CTX2: 10-Q Business overview context, filed 2026-05-06 (md_a)
- CTX4: 10-Q Business overview context, filed 2026-05-06 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)

### AVGO-Q01

- Ticker: AVGO
- Filing key: v9:0001730168:000173016826000054
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 594 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Broadcom Inc.は、クラウドサービスを主な事業にする会社です。提出資料の本文にある事業説明から確認できます。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)

### META-Q01

- Ticker: META
- Filing key: v9:0001326801:000162828026050705
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 636 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Meta Platforms, Inc.は、その他収益を主な事業にする会社です。提出資料では、売上区分としてこれらの事業が確認できます。
```

Sources:

- S4: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### BAC-Q01

- Ticker: BAC
- Filing key: v9:0000070858:000007085826000394
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: business_overview
- Model: openai / unknown
- Tokens: prompt=4520, completion=884, total=5404
- Latency: 5951 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, raw_english_excerpt, driver_evidence_fragmentary, source_gate_false_positive, fallback_slot_incomplete

Answer:

```text
一言概要: Bank of Americaは銀行・金融サービスを提供する企業で、全社売上高を主な収益として稼いでいます。 注意点: 直近の開示では、セグメント別の収益源の内訳が示されていない点に留意してください。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- CTX3: 10-Q Business overview context, filed 2026-07-31 (md_a)

### MA-Q01

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 680 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Mastercard Incは、決済・取引サービスを主な事業にする会社です。提出資料の本文にある事業説明から確認できます。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

