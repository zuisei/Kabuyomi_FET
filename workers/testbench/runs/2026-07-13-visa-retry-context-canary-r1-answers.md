# 2026-07-13-visa-retry-context-canary-r1 Answers

## Test Method

- Scope: prompt v2 smoke response test against the Kabuyomi test Worker.
- Base URL: https://kabuyomi-api-test.dznqjmctk7.workers.dev
- Run started at: 2026-07-13T07:33:34.295Z
- Tickers: V
- Rows: 10
- Questions: `testbench/questions/prompt-v2-smoke-10.jsonl`
- Company set: `inline:KABUYOMI_TESTBENCH_TICKERS`
- Question templates observed: 10
- Company tickers observed: 1
- Note: hidden internal chain-of-thought is not recorded. This report records observable test rationale, criteria, outputs, and diagnostics.

## Result Summary

- Response paths: deterministic=7, historical=1, openai=2
- Fallback reasons: none=10
- Infra errors: none=10
- Source ID invalid rows: 0
- Quality rows: 10
- Quality fallback rate: 0.0%
- Quality Q03/Q04/Q06 fallback: 0
- Quality hard-intent fallback: 0
- Average latency: 3056 ms
- Max latency: V-Q03 8750 ms

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

- None

## Fallback Rows

- None

## All Answers

### V-Q01

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 2778 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
VISA INC.は、決済ネットワーク、取引処理、サービス収入、付加価値サービスで収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)

### V-Q02

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 235 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 112.3億ドル で、前年同期比 17.1%増 です。 売上構造を見る軸は、サービス収入、データ処理収入、国際取引収入、付加価値サービスです。 提出資料では、決済ネットワーク売上は 国際取引量の増加、決済額の増加、処理件数の増加 が主な説明要因と説明しています。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)

### V-Q03

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=10104, completion=480, total=10584
- Latency: 8750 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, retry_wasted, revenue_drivers_deterministic_repair

Answer:

```text
売上高は 112.3億ドル で、前年同期比 17.1%増 です。 提出資料では、決済ネットワーク売上は 国際取引量の増加、決済額の増加、処理件数の増加 が主な説明要因と説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)

### V-Q04

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / gpt-5-nano-2025-08-07
- Tokens: prompt=4613, completion=69, total=4682
- Latency: 2808 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, retry_blocked:hard_intent_retry_disabled, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、決済額・処理件数・国際取引量、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、決済額・処理件数・国際取引量、製品カテゴリ成長 です。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-04-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)

### V-Q05

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5761, completion=225, total=5986
- Latency: 3416 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率は改善しています。営業利益率は 56.6% から 64.4% へ改善しています。

純利益率は 47.7% から 53.6% へ改善しています。本文で確認できる利益率・利益要因は、人件費・報酬費の増加、訴訟・法務費用の減少、営業費用・原価の増加です。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)

### V-Q06

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=12601, completion=493, total=13094
- Latency: 7125 ms
- Source count: 8
- Source IDs valid: true
- Answer quality flags: context_rewritten, model_retry_used, retry_attempted, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、営業費用・原価、人件費、訴訟費用・引当 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用・原価、人件費、訴訟費用・引当 です。
```

Sources:

- S7: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- CTX1: 10-Q Profitability context, filed 2026-04-29 (md_a)

### V-Q07

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 478 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年12月31日 の提出資料を比べました。大きく変わった順では、 営業利益は 2025年12月31日 の 67.4億ドル から 2026年3月31日 の 72.3億ドル へ、前回比 7.4% 増加しました。

売上高は 2025年12月31日 の 109億ドル から 2026年3月31日 の 112.3億ドル へ、前回比 3.0% 増加しました。純利益は 2025年12月31日 の 58.5億ドル から 2026年3月31日 の 60.2億ドル へ、前回比 2.9% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0001403161:000140316126000079:S11: 10-Q filed 2026-04-29 · period 2026-03-31 (historical_metric)
- v9:0001403161:000140316126000045:S12: 10-Q filed 2026-01-30 · period 2025-12-31 (historical_metric)
- v9:0001403161:000140316126000079:S9: 10-Q filed 2026-04-29 · period 2026-03-31 (historical_metric)
- v9:0001403161:000140316126000045:S10: 10-Q filed 2026-01-30 · period 2025-12-31 (historical_metric)
- v9:0001403161:000140316126000079:S10: 10-Q filed 2026-04-29 · period 2026-03-31 (historical_metric)
- v9:0001403161:000140316126000045:S11: 10-Q filed 2026-01-30 · period 2025-12-31 (historical_metric)

### V-Q08

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 234 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 112.3億ドル で、前年同期比 17.1%増 です。 伸びた部分として提出資料に明示されているのは、国際取引収入です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S4: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### V-Q09

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 296 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 97.9億ドル で、前年同期比 3.0%減 です。前年差では悪化していますが、金額はプラスです。

営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。

設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### V-Q10

- Ticker: V
- Filing key: v9:0001403161:000140316126000079
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=6983, completion=281, total=7264
- Latency: 4443 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は124億ドルです。1年内返済予定の長期債務は15.6億ドルです。

長期債務（非流動）は224.2億ドルです。営業CFは97.9億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S13: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S15: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S17: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
