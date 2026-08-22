# 2026-08-22-human-q08-segment-15 Answers

## Test Method

- Scope: prompt v2 smoke response test against the Kabuyomi test Worker.
- Base URL: https://kabuyomi-api-test.dznqjmctk7.workers.dev
- Run started at: 2026-08-22T14:11:32.271Z
- Tickers: AAPL, MSFT, NVDA, GOOG, AMZN, JPM, CAT, META, AVGO, MA, BAC, CVX, JNJ, COST, PLTR
- Rows: 15
- Questions: `/private/tmp/claude-501/-Users-0xt4-t4dano-statik-apps-Kabuyomi/ca69aa1c-18a9-4cea-b928-56eac4fd6d20/scratchpad/q08-human.jsonl`
- Company set: `testbench/company-sets/production-tracked-15.json`
- Question templates observed: 1
- Company tickers observed: 15
- Note: hidden internal chain-of-thought is not recorded. This report records observable test rationale, criteria, outputs, and diagnostics.

## Result Summary

- Response paths: deterministic=15
- Fallback reasons: none=15
- Infra errors: none=15
- Source ID invalid rows: 0
- Quality rows: 15
- Quality fallback rate: 0.0%
- Quality Q03/Q04/Q06 fallback: 0
- Quality hard-intent fallback: 0
- Average latency: 952 ms
- Max latency: COST-Q08 1959 ms

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
- qualitySourceEvidenceWeak: 0
- fallbackTaxonomyIntentMismatch: 0
- fallbackKindNoneOnFallbackRows: 0

## Review Notes

- Treat `fallbackReason=low_quality_answer` rows as the first human-review targets.
- Deterministic rows are expected when the local deterministic answer path handles the question.
- A row with no fallback is not automatically perfect; review the full answer text below for wording and grounding quality.

## Quality Issue Examples

### q08CompletenessMissing

- AAPL-Q08 AAPL Q08 segment_driver (deterministic/none/none): 売上高は 1,111.8億ドル で、前年同期比 16.6%増 です。 伸びた部分として提出資料に明示されているのは、欧州、日本、アジア太平洋です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- MSFT-Q08 MSFT Q08 segment_driver (deterministic/none/none): 売上高は 828.9億ドル で、前年同期比 18.3%増 です。 伸びた部分として提出資料に明示されているのは、Microsoft 365、ゲーミングです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- NVDA-Q08 NVDA Q08 segment_driver (deterministic/none/none): 売上高は 816.2億ドル で、前年同期比 85.2%増 です。 伸びた部分として提出資料に明示されているのは、データセンターです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- GOOG-Q08 GOOG Q08 segment_driver (deterministic/none/none): 売上高は 1,099億ドル で、前年同期比 21.8%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- AMZN-Q08 AMZN Q08 segment_driver (deterministic/none/none): 売上高は 1,815.2億ドル で、前年同期比 16.6%増 です。 伸びた部分として提出資料に明示されているのは、北米事業、海外事業です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- JPM-Q08 JPM Q08 segment_driver (deterministic/none/none): 伸びた部分として提出資料に明示されているのは、純利息収入、非利息収入です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- CAT-Q08 CAT Q08 segment_driver (deterministic/none/none): 売上高は 174.2億ドル で、前年同期比 22.2%増 です。 伸びた部分として提出資料に明示されているのは、北米です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- META-Q08 META Q08 segment_driver (deterministic/none/none): 売上高は 608億ドル で、前年同期比 28.0%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- ... 7 more

### q08EvidenceMappingMissing

- AAPL-Q08 AAPL Q08 segment_driver (deterministic/none/none): 売上高は 1,111.8億ドル で、前年同期比 16.6%増 です。 伸びた部分として提出資料に明示されているのは、欧州、日本、アジア太平洋です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- MSFT-Q08 MSFT Q08 segment_driver (deterministic/none/none): 売上高は 828.9億ドル で、前年同期比 18.3%増 です。 伸びた部分として提出資料に明示されているのは、Microsoft 365、ゲーミングです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- NVDA-Q08 NVDA Q08 segment_driver (deterministic/none/none): 売上高は 816.2億ドル で、前年同期比 85.2%増 です。 伸びた部分として提出資料に明示されているのは、データセンターです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- GOOG-Q08 GOOG Q08 segment_driver (deterministic/none/none): 売上高は 1,099億ドル で、前年同期比 21.8%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- AMZN-Q08 AMZN Q08 segment_driver (deterministic/none/none): 売上高は 1,815.2億ドル で、前年同期比 16.6%増 です。 伸びた部分として提出資料に明示されているのは、北米事業、海外事業です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- JPM-Q08 JPM Q08 segment_driver (deterministic/none/none): 伸びた部分として提出資料に明示されているのは、純利息収入、非利息収入です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- CAT-Q08 CAT Q08 segment_driver (deterministic/none/none): 売上高は 174.2億ドル で、前年同期比 22.2%増 です。 伸びた部分として提出資料に明示されているのは、北米です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- META-Q08 META Q08 segment_driver (deterministic/none/none): 売上高は 608億ドル で、前年同期比 28.0%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
- ... 7 more

## Fallback Rows

- None

## All Answers

### AAPL-Q08

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1584 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 1,111.8億ドル で、前年同期比 16.6%増 です。 伸びた部分として提出資料に明示されているのは、欧州、日本、アジア太平洋です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### MSFT-Q08

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1175 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 828.9億ドル で、前年同期比 18.3%増 です。 伸びた部分として提出資料に明示されているのは、Microsoft 365、ゲーミングです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### NVDA-Q08

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 540 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 816.2億ドル で、前年同期比 85.2%増 です。 伸びた部分として提出資料に明示されているのは、データセンターです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S11: XBRL 売上高 comparison (Revenues) (xbrl_metric)

### GOOG-Q08

- Ticker: GOOG
- Filing key: v9:0001652044:000165204426000048
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 671 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 1,099億ドル で、前年同期比 21.8%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### AMZN-Q08

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 935 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 1,815.2億ドル で、前年同期比 16.6%増 です。 伸びた部分として提出資料に明示されているのは、北米事業、海外事業です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### JPM-Q08

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 749 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
伸びた部分として提出資料に明示されているのは、純利息収入、非利息収入です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### CAT-Q08

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 649 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 174.2億ドル で、前年同期比 22.2%増 です。 伸びた部分として提出資料に明示されているのは、北米です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S5: 10-Q Margin and profitability discussion, filed 2026-05-06 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### META-Q08

- Ticker: META
- Filing key: v9:0001326801:000162828026050705
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 670 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 608億ドル で、前年同期比 28.0%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### AVGO-Q08

- Ticker: AVGO
- Filing key: v9:0001730168:000173016826000054
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 736 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 221.9億ドル で、前年同期比 47.9%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### MA-Q08

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 704 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 92.8億ドル で、前年同期比 14.1%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)

### BAC-Q08

- Ticker: BAC
- Filing key: v9:0000070858:000007085826000394
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 840 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 315.6億ドル で、前年同期比 15.0%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### CVX-Q08

- Ticker: CVX
- Filing key: v9:0000093410:000009341026000167
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 980 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 700.6億ドル で、前年同期比 56.3%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### JNJ-Q08

- Ticker: JNJ
- Filing key: v9:0000200406:000020040626000153
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1405 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: metrics_only_context, numeric_alignment_repaired

Answer:

```text
売上高は 253.1億ドル で、前年同期比 6.6%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S2: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### COST-Q08

- Ticker: COST
- Filing key: v9:0000909832:000090983226000051
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1959 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: metrics_only_context, numeric_alignment_repaired

Answer:

```text
売上高は 705.3億ドル で、前年同期比 11.6%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S2: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### PLTR-Q08

- Ticker: PLTR
- Filing key: v9:0001321655:000132165526000041
- Question: どこの事業が調子いいの？逆にダメなとこは？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 681 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 19.4億ドル で、前年同期比 92.8%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

