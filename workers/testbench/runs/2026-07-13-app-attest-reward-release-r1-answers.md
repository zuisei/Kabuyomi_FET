# 2026-07-13-app-attest-reward-release-r1 Answers

## Test Method

- Scope: prompt v2 smoke response test against the Kabuyomi test Worker.
- Base URL: https://kabuyomi-api-test.dznqjmctk7.workers.dev
- Run started at: 2026-07-13T07:03:03.000Z
- Tickers: AAPL, JPM, XOM, CAT, WMT, NVDA, MU, MSFT, GOOGL, AMZN, TSLA, LLY, V, KO, DAL
- Rows: 150
- Questions: `testbench/questions/prompt-v2-smoke-10.jsonl`
- Company set: `testbench/company-sets/prompt-v2-expanded-multisector.json`
- Question templates observed: 10
- Company tickers observed: 15
- Note: hidden internal chain-of-thought is not recorded. This report records observable test rationale, criteria, outputs, and diagnostics.

## Result Summary

- Response paths: deterministic=111, historical=15, openai=24
- Fallback reasons: none=150
- Infra errors: none=150
- Source ID invalid rows: 0
- Quality rows: 150
- Quality fallback rate: 0.0%
- Quality Q03/Q04/Q06 fallback: 0
- Quality hard-intent fallback: 0
- Average latency: 2106 ms
- Max latency: AMZN-Q05 9910 ms

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
- qualitySourceEvidenceWeak: 1
- fallbackTaxonomyIntentMismatch: 0
- fallbackKindNoneOnFallbackRows: 0

## Review Notes

- Treat `fallbackReason=low_quality_answer` rows as the first human-review targets.
- Deterministic rows are expected when the local deterministic answer path handles the question.
- A row with no fallback is not automatically perfect; review the full answer text below for wording and grounding quality.

## Quality Issue Examples

### q03Q04Q06FinalEvidenceMissing

- AAPL-Q04 AAPL Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、粗利益率 です。次に見るべき指標は、粗利益率 です。

### qualitySourceEvidenceWeak

- AAPL-Q04 AAPL Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、粗利益率 です。次に見るべき指標は、粗利益率 です。

## Fallback Rows

- None

## All Answers

### AAPL-Q01

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 2691 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Apple Inc.は、iPhone、Mac、iPad、ウェアラブル機器、サービスで収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### AAPL-Q02

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 254 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 1,111.8億ドル で、前年同期比 16.6%増 です。 売上構造を見る軸は、iPhone、Mac、iPad、ウェアラブル機器、サービスです。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### AAPL-Q03

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4537, completion=180, total=4717
- Latency: 3985 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, numeric_alignment_qualitative_recovery

Answer:

```text
追加確認としてはマージンや費用構造の影響、長期的な需要動向の持続性の評価が不足している。
```

Sources:

- CTX2: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)

### AAPL-Q04

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 809 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, q04_table_heavy_context, durability_context_missing, q04_durability_evidence_too_generic, hard_retrieval_used, raw_english_excerpt, final_answer_language_violation, answer_rewritten_to_japanese_fallback

Answer:

```text
提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、粗利益率 です。次に見るべき指標は、粗利益率 です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S16: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S12: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### AAPL-Q05

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5766, completion=261, total=6027
- Latency: 3524 ms
- Source count: 9
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery, numeric_alignment_repaired

Answer:

```text
提出資料上、利益率は改善しています。 営業利益率は 31.0% から 32.3% へ改善しています。 純利益率は 26.0% から 26.6% へ改善しています。 本文で確認できる利益率・利益要因は、粗利率・粗利益の改善です。 一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S16: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S12: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S17: XBRL 営業利益 comparison (OperatingIncomeLoss) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S13: XBRL 純利益 comparison (NetIncomeLoss) (xbrl_metric)

### AAPL-Q06

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 257 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, missing_margin_durability_context, hard_retrieval_used, q06_previous_answer_margin_candidate_repair, hard_intent_explicit_insufficiency_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、粗利益率 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、粗利益率 です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### AAPL-Q07

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 475 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月28日）と、直前の同じ様式の 2025年12月27日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年12月27日 の 421億ドル から 2026年3月28日 の 295.8億ドル へ、前回比 29.7% 減少しました。

営業利益は 2025年12月27日 の 508.5億ドル から 2026年3月28日 の 358.9億ドル へ、前回比 29.4% 減少しました。売上高は 2025年12月27日 の 1,437.6億ドル から 2026年3月28日 の 1,111.8億ドル へ、前回比 22.7% 減少しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000320193:000032019326000013:S12: 10-Q filed 2026-05-01 · period 2026-03-28 (historical_metric)
- v9:0000320193:000032019326000006:S12: 10-Q filed 2026-01-30 · period 2025-12-27 (historical_metric)
- v9:0000320193:000032019326000013:S16: 10-Q filed 2026-05-01 · period 2026-03-28 (historical_metric)
- v9:0000320193:000032019326000006:S16: 10-Q filed 2026-01-30 · period 2025-12-27 (historical_metric)
- v9:0000320193:000032019326000013:S10: 10-Q filed 2026-05-01 · period 2026-03-28 (historical_metric)
- v9:0000320193:000032019326000006:S10: 10-Q filed 2026-01-30 · period 2025-12-27 (historical_metric)

### AAPL-Q08

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
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

### AAPL-Q09

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 251 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
営業CFは 826.3億ドル で、前年同期比 53.3%増 です。前年差でも改善しています。

営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。

設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S19: XBRL 営業CF comparison (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### AAPL-Q10

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=6376, completion=229, total=6605
- Latency: 4525 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: liquidity_conclusion_deterministic_recovery, q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は455.7億ドルです。1年内返済予定の長期債務は83.1億ドルです。

長期債務（非流動）は744億ドルです。営業CFは826.3億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S20: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S22: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S24: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### JPM-Q01

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 591 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
JPMORGAN CHASE & COは、純利息収入、投資銀行・市場業務、カード・決済、資産運用で収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q02

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 342 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上構造を見る軸は、純利息収入、投資銀行・市場業務、カード・決済、資産運用です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q03

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=3749, completion=189, total=3938
- Latency: 3978 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery

Answer:

```text
純利息収入では、市場部門の純利息収入、預金残高、カード事業のリボルビング残高の増加が寄与し、金利低下の影響が一部を相殺しました。 非利息収入では、資産運用手数料、投資銀行手数料、市場関連収入、決済手数料の増加が寄与しました。 一方、前年に計上した買収関連利益が当期にはなかったことは相殺要因です。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q04

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=3933, completion=292, total=4225
- Latency: 4228 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、決済額・処理件数・国際取引量、純利息収入、非利息収入・投資銀行・市場業務、買収影響 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、決済額・処理件数・国際取引量、純利息収入、非利息収入・投資銀行・市場業務、買収影響 です。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q05

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=3616, completion=200, total=3816
- Latency: 3032 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery

Answer:

```text
選択された指標だけでは、売上高に対する利益率を同じ定義で計算できないため、利益率の改善・悪化は断定しません。純利益は比較期の 146.4億ドル から当期の 164.9億ドル へ増加しています。

本文で確認できる利益率・利益要因は、人件費・報酬費の増加、訴訟・法務費用の増加、減価償却費の増加です。一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### JPM-Q06

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=3849, completion=339, total=4188
- Latency: 3756 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、減価償却費、人件費、訴訟費用・引当 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、減価償却費、人件費、訴訟費用・引当 です。
```

Sources:

- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S8: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- CTX1: 10-Q Profitability context, filed 2026-05-01 (md_a)

### JPM-Q07

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 659 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年9月30日 の提出資料を比べました。 大きく変わった順では、 純利益は 2025年9月30日 の 143.9億ドル から 2026年3月31日 の 164.9億ドル へ、前回比 14.6% 増加しました。 各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000019617:000162828026029344:S10: 10-Q filed 2026-05-01 · period 2026-03-31 (historical_metric)
- v9:0000019617:000162828025048859:S9: 10-Q filed 2025-11-04 · period 2025-09-30 (historical_metric)

### JPM-Q08

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 380 ms
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

### JPM-Q09

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 523 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは -2,117.6億ドル で、前年同期比 15.9%増 です。前年差では改善していますが、まだマイナスです。

同じ対象期間の純利益は 164.9億ドル です。純利益と営業CFの差は、貸出・預金や取引資産負債の増減を含むため、大小だけで利益の現金化を評価しません。

金融機関では、運転資本の代わりに貸出・預金・取引資産負債の増減を確認する必要があります。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

ただし金融機関の営業CFは、貸出・預金・取引資産負債の増減で大きく動くため、一般事業会社のように単純な本業の現金創出力とは見ません。預金、貸出、信用損失、流動性の説明と合わせて見る必要があります。
```

Sources:

- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)

### JPM-Q10

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=4220, completion=264, total=4484
- Latency: 3424 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
営業CFは-2,117.6億ドルです。現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。

返却された根拠では手元資金・1年内返済予定の長期債務・長期債務（非流動）を確認できません。コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。

返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### XOM-Q01

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 657 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
EXXON MOBIL CORPは、上流の石油・天然ガス、下流の燃料、化学製品で収益を得ている会社です。
```

Sources:

- S1: 10-Q Segment revenue comparison, filed 2026-05-04 (md_a)
- S2: 10-Q Margin and profitability discussion, filed 2026-05-04 (md_a)
- S3: 10-Q Part I Item 2, filed 2026-05-04 (md_a)

### XOM-Q02

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 221 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 851.4億ドル で、前年同期比 2.4%増 です。 売上構造を見る軸は、上流の石油・天然ガス、燃料、化学製品、特殊製品です。 提出資料のセグメント別外部売上表では、エネルギー製品部門の増加が全社増収を最も押し上げ、上流部門の減少が一部を相殺しています。 この表だけでは、価格と生産量のどちらが寄与したかまでは結び付けられません。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Segment revenue comparison, filed 2026-05-04 (md_a)
- S2: 10-Q Margin and profitability discussion, filed 2026-05-04 (md_a)
- S3: 10-Q Part I Item 2, filed 2026-05-04 (md_a)

### XOM-Q03

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=3196, completion=194, total=3390
- Latency: 3037 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 851.4億ドル で、前年同期比 2.4%増 です。提出資料のセグメント別外部売上表では、エネルギー製品部門の増加が全社増収を最も押し上げ、上流部門の減少が一部を相殺しています。

この表だけでは、価格と生産量のどちらが寄与したかまでは結び付けられません。寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Segment revenue comparison, filed 2026-05-04 (md_a)

### XOM-Q04

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 401 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, durability_context_missing, hard_retrieval_used, q04_previous_answer_driver_candidate_repair, hard_intent_explicit_insufficiency_repair

Answer:

```text
前問で挙がっていた売上要因候補は、Energy Productsの売上増加、Upstreamの売上減少、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、Energy Productsの売上増加、Upstreamの売上減少、製品カテゴリ成長 です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S1: 10-Q Segment revenue comparison, filed 2026-05-04 (md_a)
- S2: 10-Q Margin and profitability discussion, filed 2026-05-04 (md_a)

### XOM-Q05

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=4617, completion=180, total=4797
- Latency: 2900 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率の改善は確認できません。 純利益率は 9.3% から 4.9% へ低下しています。 本文で確認できる利益率・利益要因は、減価償却費の増加です。 一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S2: 10-Q Margin and profitability discussion, filed 2026-05-04 (md_a)

### XOM-Q06

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=4793, completion=223, total=5016
- Latency: 3079 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、減価償却費 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、減価償却費 です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- CTX1: 10-Q Profitability context, filed 2026-05-04 (md_a)
- S1: 10-Q Segment revenue comparison, filed 2026-05-04 (md_a)
- S2: 10-Q Margin and profitability discussion, filed 2026-05-04 (md_a)
- CTX2: 10-Q Profitability context, filed 2026-05-04 (md_a)

### XOM-Q07

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 447 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年9月30日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年9月30日 の 75.5億ドル から 2026年3月31日 の 41.8億ドル へ、前回比 44.6% 減少しました。

売上高は 2025年9月30日 の 852.9億ドル から 2026年3月31日 の 851.4億ドル へ、前回比 0.2% 減少しました。各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000034088:000003408826000067:S10: 10-Q filed 2026-05-04 · period 2026-03-31 (historical_metric)
- v9:0000034088:000003408825000061:S10: 10-Q filed 2025-11-03 · period 2025-09-30 (historical_metric)
- v9:0000034088:000003408826000067:S9: 10-Q filed 2026-05-04 · period 2026-03-31 (historical_metric)
- v9:0000034088:000003408825000061:S9: 10-Q filed 2025-11-03 · period 2025-09-30 (historical_metric)

### XOM-Q08

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 315 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 851.4億ドル で、前年同期比 2.4%増 です。 伸びた部分として提出資料に明示されているのは、エネルギー製品、化学製品です。 弱かった部分として明示されているのは、上流事業です。
```

Sources:

- S1: 10-Q Segment revenue comparison, filed 2026-05-04 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### XOM-Q09

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 283 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 87.1億ドル で、前年同期比 32.8%減 です。前年差では悪化していますが、金額はプラスです。

同じ対象期間の純利益は 41.8億ドル です。営業CFと純利益はいずれもプラスで、営業CFは純利益を上回っています。

運転資本の増減内訳は、返却された根拠では確認できません。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)

### XOM-Q10

- Ticker: XOM
- Filing key: v9:0000034088:000003408826000067
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=4921, completion=254, total=5175
- Latency: 3365 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は84.4億ドルです。営業CFは87.1億ドルです。

現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。返却された根拠では1年内返済予定の長期債務・長期債務（非流動）を確認できません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S13: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### CAT-Q01

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 590 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
CATERPILLAR INCは、建設機械、資源産業向け機械、エネルギー・輸送機器と関連サービスで収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)

### CAT-Q02

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 248 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 174.2億ドル で、前年同期比 22.2%増 です。 売上構造を見る軸は、建設機械、資源産業向け機械、エネルギー・輸送機器、関連サービスです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)

### CAT-Q03

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4294, completion=171, total=4465
- Latency: 2923 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, hybrid_english_business_phrase, final_answer_language_violation, answer_repaired_to_deterministic_japanese, language_guard_deterministic_repair, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 174.2億ドル で、前年同期比 22.2%増 です。 選択された提出資料では売上の増減は確認できますが、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明は確認できません。 選択資料で明示された範囲を超えて、主因は断定しません。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)

### CAT-Q04

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=4463, completion=197, total=4660
- Latency: 3681 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, retry_blocked:hard_intent_retry_disabled, source_gate_applied, q04_previous_answer_driver_candidate_repair, language_guard_source_backed_repair

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)

### CAT-Q05

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=12085, completion=504, total=12589
- Latency: 6061 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, hybrid_english_business_phrase, final_answer_language_violation, answer_repaired_to_deterministic_japanese, language_guard_deterministic_repair, split_margin_direction_deterministic_recovery, margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率は項目ごとに方向が分かれています。営業利益率は 18.1% から 17.7% へ低下しています。

純利益率は 14.1% から 14.6% へ改善しています。本文で確認できる利益率・利益要因は、価格実現・製品ミックスの改善、製造コストの減少、関税影響、人件費・報酬費の増加です。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- CTX1: 10-Q Profitability context, filed 2026-05-06 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)

### CAT-Q06

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 268 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, missing_margin_durability_context, hard_retrieval_used, q06_previous_answer_margin_candidate_repair, hard_intent_explicit_insufficiency_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、価格・ミックス、製造コスト、関税、人件費 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、価格・ミックス、製造コスト、関税、人件費、原価・営業コスト です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- CTX1: 10-Q Profitability context, filed 2026-05-06 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-06 (md_a)

### CAT-Q07

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 532 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年9月30日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年9月30日 の 23億ドル から 2026年3月31日 の 25.5億ドル へ、前回比 10.8% 増加しました。

売上高は 2025年9月30日 の 176.4億ドル から 2026年3月31日 の 174.2億ドル へ、前回比 1.3% 減少しました。営業利益は 2025年9月30日 の 30.5億ドル から 2026年3月31日 の 30.9億ドル へ、前回比 1.1% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000018230:000001823026000021:S10: 10-Q filed 2026-05-06 · period 2026-03-31 (historical_metric)
- v9:0000018230:000001823025000048:S10: 10-Q filed 2025-11-03 · period 2025-09-30 (historical_metric)
- v9:0000018230:000001823026000021:S9: 10-Q filed 2026-05-06 · period 2026-03-31 (historical_metric)
- v9:0000018230:000001823025000048:S9: 10-Q filed 2025-11-03 · period 2025-09-30 (historical_metric)
- v9:0000018230:000001823026000021:S12: 10-Q filed 2026-05-06 · period 2026-03-31 (historical_metric)
- v9:0000018230:000001823025000048:S12: 10-Q filed 2025-11-03 · period 2025-09-30 (historical_metric)

### CAT-Q08

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 634 ms
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

### CAT-Q09

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 262 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 18.7億ドル で、前年同期比 45.1%増 です。前年差でも改善しています。

同じ対象期間の純利益は 25.5億ドル です。営業CFと純利益はいずれもプラスですが、営業CFは純利益を下回るため、運転資本による差を確認する必要があります。

提出資料では運転資本の増減要因に触れていますが、この根拠だけでは営業CFへの寄与額を算定しません。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-06 (md_a)

### CAT-Q10

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=4838, completion=144, total=4982
- Latency: 2464 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は40.7億ドルです。営業CFは18.7億ドルです。

現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。返却された根拠では1年内返済予定の長期債務・長期債務（非流動）を確認できません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S14: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### WMT-Q01

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 605 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Walmart Inc.は、米国小売、海外小売、Sam's Clubなどの商品販売と会員サービスで収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)

### WMT-Q02

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 291 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 1,777.5億ドル で、前年同期比 7.3%増 です。 売上構造を見る軸は、米国小売、海外小売、Sam's Club、会員サービスです。 提出資料では、既存店売上は 取引件数の増加、客単価の上昇、食品と一般商品の好調 が押し上げ要因と説明しています。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)

### WMT-Q03

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=4639, completion=273, total=4912
- Latency: 3924 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: retry_blocked:hard_intent_retry_disabled, revenue_drivers_deterministic_repair

Answer:

```text
売上高は 1,777.5億ドル で、前年同期比 7.3%増 です。 提出資料では、既存店売上は 取引件数の増加、客単価の上昇、食品と一般商品の好調 が押し上げ要因と説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)

### WMT-Q04

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4811, completion=216, total=5027
- Latency: 3361 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、取引件数・客単価、食品・一般商品、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、取引件数・客単価、食品・一般商品、製品カテゴリ成長 です。
```

Sources:

- CTX3: 10-Q Segment and revenue context, filed 2026-05-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-05-29 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-05-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- CTX4: 10-Q Segment and revenue context, filed 2026-05-29 (md_a)

### WMT-Q05

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5858, completion=248, total=6106
- Latency: 3440 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: split_margin_direction_deterministic_recovery, margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率は項目ごとに方向が分かれています。営業利益率は 4.3% から 4.2% へ低下しています。

純利益率は 2.7% から 3.0% へ改善しています。本文で確認できる利益率・利益要因は、価格実現・製品ミックスの改善、配送・フルフィルメント費用の増加、燃料・精製関連費用の増加、粗利率・粗利益の改善です。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S3: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-29 (md_a)

### WMT-Q06

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=6095, completion=218, total=6313
- Latency: 2966 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、価格・ミックス、粗利益率、燃料費 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、価格・ミックス、粗利益率、燃料費 です。
```

Sources:

- S5: 10-Q Margin and profitability discussion, filed 2026-05-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-29 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-29 (md_a)

### WMT-Q07

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 595 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年4月30日）と、直前の同じ様式の 2025年10月31日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年10月31日 の 61.4億ドル から 2026年4月30日 の 53.3億ドル へ、前回比 13.2% 減少しました。

営業利益は 2025年10月31日 の 67億ドル から 2026年4月30日 の 74.9億ドル へ、前回比 11.9% 増加しました。売上高は 2025年10月31日 の 1,795億ドル から 2026年4月30日 の 1,777.5億ドル へ、前回比 1.0% 減少しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000104169:000010416926000102:S10: 10-Q filed 2026-05-29 · period 2026-04-30 (historical_metric)
- v9:0000104169:000010416925000191:S11: 10-Q filed 2025-12-03 · period 2025-10-31 (historical_metric)
- v9:0000104169:000010416926000102:S12: 10-Q filed 2026-05-29 · period 2026-04-30 (historical_metric)
- v9:0000104169:000010416925000191:S13: 10-Q filed 2025-12-03 · period 2025-10-31 (historical_metric)
- v9:0000104169:000010416926000102:S9: 10-Q filed 2026-05-29 · period 2026-04-30 (historical_metric)
- v9:0000104169:000010416925000191:S10: 10-Q filed 2025-12-03 · period 2025-10-31 (historical_metric)

### WMT-Q08

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 298 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 1,777.5億ドル で、前年同期比 7.3%増 です。 伸びた部分として提出資料に明示されているのは、Walmart米国、Sam's Club、海外事業です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-29 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### WMT-Q09

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 248 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 47.4億ドル で、前年同期比 12.4%減 です。前年差では悪化していますが、金額はプラスです。

同じ対象期間の純利益は 53.3億ドル です。営業CFと純利益はいずれもプラスですが、営業CFは純利益を下回るため、運転資本による差を確認する必要があります。

提出資料では運転資本の増減要因に触れていますが、この根拠だけでは営業CFへの寄与額を算定しません。提出資料では設備投資に触れていますが、設備投資後のフリーCFはこの根拠だけでは確定できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-29 (md_a)

### WMT-Q10

- Ticker: WMT
- Filing key: v9:0000104169:000010416926000102
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=5980, completion=228, total=6208
- Latency: 3612 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は107.3億ドルです。1年内返済予定の長期債務は39億ドルです。

長期債務（非流動）は368.9億ドルです。営業CFは47.4億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S14: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S15: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S16: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### NVDA-Q01

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 538 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
NVIDIA CORPは、データセンター向けGPU・アクセラレータ、ゲーミング、車載、プロ向け可視化で収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)

### NVDA-Q02

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 227 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 816.2億ドル で、前年同期比 85.2%増 です。 売上構造を見る軸は、データセンター、ゲーミング、車載、プロ向け可視化です。 提出資料では、データセンター向けAI製品 が全社増収の主な説明要因と説明しています。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S11: XBRL 売上高 comparison (Revenues) (xbrl_metric)

### NVDA-Q03

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=8983, completion=369, total=9352
- Latency: 5779 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, retry_wasted, revenue_drivers_deterministic_repair, revenue_driver_deterministic_recovery, numeric_alignment_repaired

Answer:

```text
売上高は 816.2億ドル で、前年同期比 85.2%増 です。 提出資料では、データセンター向けAI製品 が全社増収の主な説明要因と説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S11: XBRL 売上高 comparison (Revenues) (xbrl_metric)

### NVDA-Q04

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / gpt-5-nano-2025-08-07
- Tokens: prompt=4351, completion=68, total=4419
- Latency: 2175 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, retry_blocked:hard_intent_retry_disabled, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、データセンター向けAI製品、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、データセンター向けAI製品、製品カテゴリ成長 です。
```

Sources:

- S3: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-20 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)

### NVDA-Q05

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5615, completion=224, total=5839
- Latency: 2939 ms
- Source count: 8
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery, numeric_alignment_repaired

Answer:

```text
提出資料上、利益率は改善しています。 営業利益率は 49.1% から 65.6% へ改善しています。 純利益率は 42.6% から 71.5% へ改善しています。 本文で確認できる利益率・利益要因は、在庫引当・評価損の減少、粗利率・粗利益の改善です。 一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S16: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S12: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)
- S17: XBRL 営業利益 comparison (OperatingIncomeLoss) (xbrl_metric)
- S11: XBRL 売上高 comparison (Revenues) (xbrl_metric)
- S13: XBRL 純利益 comparison (NetIncomeLoss) (xbrl_metric)

### NVDA-Q06

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=12182, completion=663, total=12845
- Latency: 7394 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: context_rewritten, model_retry_used, retry_attempted, numeric_alignment_repaired

Answer:

```text
売上高は816.2億ドル、営業利益は535.4億ドル、純利益は583.2億ドルです。営業利益率は65.6%、純利益率は71.46%で、直近は前期より大幅に改善しています。

改善要因として資料は在庫引当・評価損の減少と粗利率の改善を挙げ、これが利益率の押し上げに寄与しています。一方、同資料だけでは一時要因と継続要因を区別する根拠が不足します。

確認できる情報は在庫関連の改善と粗利改善で、長期的な継続性を判断するには次期の費用・価格・構成要因の動向やマネジメントの見解が追加で必要です。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S16: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S12: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)

### NVDA-Q07

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 593 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年4月26日）と、直前の同じ様式の 2025年10月26日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年10月26日 の 319.1億ドル から 2026年4月26日 の 583.2億ドル へ、前回比 82.8% 増加しました。

営業利益は 2025年10月26日 の 360.1億ドル から 2026年4月26日 の 535.4億ドル へ、前回比 48.7% 増加しました。売上高は 2025年10月26日 の 570.1億ドル から 2026年4月26日 の 816.2億ドル へ、前回比 43.2% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0001045810:000104581026000052:S12: 10-Q filed 2026-05-20 · period 2026-04-26 (historical_metric)
- v9:0001045810:000104581025000230:S12: 10-Q filed 2025-11-19 · period 2025-10-26 (historical_metric)
- v9:0001045810:000104581026000052:S16: 10-Q filed 2026-05-20 · period 2026-04-26 (historical_metric)
- v9:0001045810:000104581025000230:S16: 10-Q filed 2025-11-19 · period 2025-10-26 (historical_metric)
- v9:0001045810:000104581026000052:S10: 10-Q filed 2026-05-20 · period 2026-04-26 (historical_metric)
- v9:0001045810:000104581025000230:S10: 10-Q filed 2025-11-19 · period 2025-10-26 (historical_metric)

### NVDA-Q08

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 287 ms
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

### NVDA-Q09

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 243 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
営業CFは 503.4億ドル で、前年同期比 83.6%増 です。前年差でも改善しています。

同じ対象期間の純利益は 583.2億ドル です。営業CFと純利益はいずれもプラスですが、営業CFは純利益を下回るため、運転資本による差を確認する必要があります。

提出資料では運転資本の増減要因に触れていますが、この根拠だけでは営業CFへの寄与額を算定しません。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S12: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-20 (md_a)
- S19: XBRL 営業CF comparison (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### NVDA-Q10

- Ticker: NVDA
- Filing key: v9:0001045810:000104581026000052
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=6413, completion=269, total=6682
- Latency: 3364 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: liquidity_conclusion_deterministic_recovery, q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は132.4億ドルです。1年内返済予定の長期債務は10億ドルです。

長期債務（非流動）は74.7億ドルです。営業CFは503.4億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計より手元資金が上回っています。ただし、この3項目だけから直ちに資金繰り懸念がないとは断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S20: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S22: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S23: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### MU-Q01

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 579 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
MICRON TECHNOLOGY INCは、DRAM、NAND、ストレージなどのメモリ製品で収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)

### MU-Q02

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 279 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 414.6億ドル で、前年同期比 345.7%増 です。 売上構造を見る軸は、DRAM、NAND、ストレージです。 提出資料では、DRAM売上は 平均販売価格の上昇、ビット出荷量の増加 が主な説明要因、NAND売上は 平均販売価格の上昇、ビット出荷量の増加 が主な説明要因と説明しています。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### MU-Q03

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4539, completion=175, total=4714
- Latency: 2752 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: source_gate_applied, hard_source_asset_missing_sector_kpi, revenue_driver_deterministic_recovery, numeric_alignment_repaired

Answer:

```text
売上高は 414.6億ドル で、前年同期比 345.7%増 です。 提出資料では、DRAM売上は 平均販売価格の上昇、ビット出荷量の増加 が主な説明要因、NAND売上は 平均販売価格の上昇、ビット出荷量の増加 が主な説明要因と説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### MU-Q04

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4703, completion=164, total=4867
- Latency: 3133 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, hard_source_asset_missing_sector_kpi, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、販売数量・出荷量、価格・ミックス、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、販売数量・出荷量、価格・ミックス、製品カテゴリ成長 です。
```

Sources:

- CTX2: 10-Q Segment and revenue context, filed 2026-06-25 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-06-25 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-06-25 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-06-25 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)

### MU-Q05

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5738, completion=173, total=5911
- Latency: 5542 ms
- Source count: 8
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery, numeric_alignment_repaired

Answer:

```text
提出資料上、利益率は改善しています。営業利益率は 23.3% から 80.4% へ改善しています。

純利益率は 20.3% から 68.1% へ改善しています。本文で確認できる利益率・利益要因は、粗利率・粗利益の改善、価格実現・製品ミックスの改善、製造コストの減少、販売数量・出荷量の増加です。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S16: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S12: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-06-25 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-06-25 (md_a)
- S17: XBRL 営業利益 comparison (OperatingIncomeLoss) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S13: XBRL 純利益 comparison (NetIncomeLoss) (xbrl_metric)

### MU-Q06

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 256 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, missing_margin_durability_context, hard_retrieval_used, hard_source_asset_missing_sector_kpi, q06_previous_answer_margin_candidate_repair, hard_intent_explicit_insufficiency_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、販売数量・出荷量、価格・ミックス、製造コスト、粗利益率 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、販売数量・出荷量、価格・ミックス、製造コスト、粗利益率、原価・営業コスト です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-06-25 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-06-25 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-06-25 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-06-25 (md_a)

### MU-Q07

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1377 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年5月28日）と、直前の同じ様式の 2026年2月26日 の提出資料を比べました。大きく変わった順では、 営業利益は 2026年2月26日 の 161.4億ドル から 2026年5月28日 の 333.2億ドル へ、前回比 106.5% 増加しました。

純利益は 2026年2月26日 の 137.9億ドル から 2026年5月28日 の 282.4億ドル へ、前回比 104.9% 増加しました。売上高は 2026年2月26日 の 238.6億ドル から 2026年5月28日 の 414.6億ドル へ、前回比 73.7% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000723125:000072312526000015:S16: 10-Q filed 2026-06-25 · period 2026-05-28 (historical_metric)
- v9:0000723125:000072312526000006:S16: 10-Q filed 2026-03-19 · period 2026-02-26 (historical_metric)
- v9:0000723125:000072312526000015:S12: 10-Q filed 2026-06-25 · period 2026-05-28 (historical_metric)
- v9:0000723125:000072312526000006:S12: 10-Q filed 2026-03-19 · period 2026-02-26 (historical_metric)
- v9:0000723125:000072312526000015:S10: 10-Q filed 2026-06-25 · period 2026-05-28 (historical_metric)
- v9:0000723125:000072312526000006:S10: 10-Q filed 2026-03-19 · period 2026-02-26 (historical_metric)

### MU-Q08

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 268 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 414.6億ドル で、前年同期比 345.7%増 です。 伸びた部分として提出資料に明示されているのは、DRAM、NANDです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-06-25 (md_a)
- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### MU-Q09

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 297 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
営業CFは 457億ドル で、前年同期比 287.5%増 です。前年差でも改善しています。

営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。

設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S19: XBRL 営業CF comparison (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### MU-Q10

- Ticker: MU
- Filing key: v9:0000723125:000072312526000015
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=4982, completion=255, total=5237
- Latency: 3289 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は250億ドルです。営業CFは457億ドルです。

現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。返却された根拠では1年内返済予定の長期債務・長期債務（非流動）を確認できません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S20: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S18: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### MSFT-Q01

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 533 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
MICROSOFT CORPは、クラウド、Office・Microsoft 365、Windows、LinkedIn、ゲームで収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)

### MSFT-Q02

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 265 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 828.9億ドル で、前年同期比 18.3%増 です。売上構造を見る軸は、クラウド、Office・Microsoft 365、Windows、LinkedIn、ゲームです。

提出資料では、検索広告は 検索量の増加、検索当たり収益の上昇、第三者提携の寄与 が押し上げ要因、Microsoft 365クラウドは ユーザー単価の上昇、Microsoft 365 E5・Copilot、利用席数の増加 が押し上げ要因と説明しています。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)

### MSFT-Q03

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=8191, completion=410, total=8601
- Latency: 5706 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 828.9億ドル で、前年同期比 18.3%増 です。提出資料では、検索広告は 検索量の増加、検索当たり収益の上昇、第三者提携の寄与 が押し上げ要因、Microsoft 365クラウドは ユーザー単価の上昇、Microsoft 365 E5・Copilot、利用席数の増加 が押し上げ要因と説明しています。

寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)

### MSFT-Q04

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4087, completion=245, total=4332
- Latency: 3325 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, hard_source_asset_coverage_low, hard_source_asset_missing_mda_revenue, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、販売数量・出荷量、製品カテゴリ成長、クラウド、広告需要 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、販売数量・出荷量、製品カテゴリ成長、クラウド、広告需要 です。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)

### MSFT-Q05

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5490, completion=287, total=5777
- Latency: 3858 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率は改善しています。 営業利益率は 45.7% から 46.3% へ改善しています。 純利益率は 36.9% から 38.3% へ改善しています。 本文で確認できる利益率・利益要因は、営業費用・原価の増加です。 一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S13: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S11: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)

### MSFT-Q06

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=5685, completion=247, total=5932
- Latency: 3221 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, hard_source_asset_coverage_low, hard_source_asset_missing_mda_revenue, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、営業費用・原価 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用・原価 です。
```

Sources:

- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)

### MSFT-Q07

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 595 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年12月31日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年12月31日 の 384.6億ドル から 2026年3月31日 の 317.8億ドル へ、前回比 17.4% 減少しました。

売上高は 2025年12月31日 の 812.7億ドル から 2026年3月31日 の 828.9億ドル へ、前回比 2.0% 増加しました。営業利益は 2025年12月31日 の 382.8億ドル から 2026年3月31日 の 384億ドル へ、前回比 0.3% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000789019:000119312526191507:S11: 10-Q filed 2026-04-29 · period 2026-03-31 (historical_metric)
- v9:0000789019:000119312526027207:S10: 10-Q filed 2026-01-28 · period 2025-12-31 (historical_metric)
- v9:0000789019:000119312526191507:S10: 10-Q filed 2026-04-29 · period 2026-03-31 (historical_metric)
- v9:0000789019:000119312526027207:S9: 10-Q filed 2026-01-28 · period 2025-12-31 (historical_metric)
- v9:0000789019:000119312526191507:S13: 10-Q filed 2026-04-29 · period 2026-03-31 (historical_metric)
- v9:0000789019:000119312526027207:S12: 10-Q filed 2026-01-28 · period 2025-12-31 (historical_metric)

### MSFT-Q08

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 297 ms
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

### MSFT-Q09

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 253 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 1,274.9億ドル で、前年同期比 36.3%増 です。前年差でも改善しています。

営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。運転資本の増減内訳は、返却された根拠では確認できません。

設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S14: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### MSFT-Q10

- Ticker: MSFT
- Filing key: v9:0000789019:000119312526191507
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=5897, completion=237, total=6134
- Latency: 3236 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は321.1億ドルです。1年内返済予定の長期債務は88.4億ドルです。

長期債務（非流動）は314.2億ドルです。営業CFは1,274.9億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S15: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S17: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S19: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S14: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### GOOGL-Q01

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 545 ms
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

### GOOGL-Q02

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 219 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 1,099億ドル で、前年同期比 21.8%増 です。 提出資料では、Googleサービス売上の増加、Google Cloud売上の増加 が全社増収の主な説明要因と説明しています。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### GOOGL-Q03

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4477, completion=177, total=4654
- Latency: 3121 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 1,099億ドル で、前年同期比 21.8%増 です。 提出資料では、Googleサービス売上の増加、Google Cloud売上の増加 が全社増収の主な説明要因と説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### GOOGL-Q04

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4631, completion=115, total=4746
- Latency: 2880 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、サービス売上、製品カテゴリ成長、Google Cloud です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、サービス売上、製品カテゴリ成長、Google Cloud、製品別売上 です。
```

Sources:

- CTX2: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX4: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### GOOGL-Q05

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5495, completion=377, total=5872
- Latency: 4821 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率は改善しています。営業利益率は 33.9% から 36.1% へ改善しています。

純利益率は 38.3% から 56.9% へ改善しています。本文で確認できる利益率・利益要因は、人件費・報酬費の増加、減価償却費の増加、営業費用・原価の増加、研究開発・販管費の増加です。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)

### GOOGL-Q06

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=5719, completion=230, total=5949
- Latency: 3099 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、営業費用・原価、研究開発費、販売管理費、減価償却費、人件費 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用・原価、研究開発費、販売管理費、減価償却費、人件費 です。
```

Sources:

- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)

### GOOGL-Q07

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 718 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年9月30日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年9月30日 の 349.8億ドル から 2026年3月31日 の 625.8億ドル へ、前回比 78.9% 増加しました。

営業利益は 2025年9月30日 の 312.3億ドル から 2026年3月31日 の 397億ドル へ、前回比 27.1% 増加しました。売上高は 2025年9月30日 の 1,023.5億ドル から 2026年3月31日 の 1,099億ドル へ、前回比 7.4% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0001652044:000165204426000048:S10: 10-Q filed 2026-04-30 · period 2026-03-31 (historical_metric)
- v9:0001652044:000165204425000091:S11: 10-Q filed 2025-10-30 · period 2025-09-30 (historical_metric)
- v9:0001652044:000165204426000048:S12: 10-Q filed 2026-04-30 · period 2026-03-31 (historical_metric)
- v9:0001652044:000165204425000091:S13: 10-Q filed 2025-10-30 · period 2025-09-30 (historical_metric)
- v9:0001652044:000165204426000048:S9: 10-Q filed 2026-04-30 · period 2026-03-31 (historical_metric)
- v9:0001652044:000165204425000091:S10: 10-Q filed 2025-10-30 · period 2025-09-30 (historical_metric)

### GOOGL-Q08

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 248 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 1,099億ドル で、前年同期比 21.8%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### GOOGL-Q09

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 297 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 457.9億ドル で、前年同期比 26.7%増 です。前年差でも改善しています。

同じ対象期間の純利益は 625.8億ドル です。営業CFと純利益はいずれもプラスですが、営業CFは純利益を下回るため、運転資本による差を確認する必要があります。

運転資本の増減内訳は、返却された根拠では確認できません。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)

### GOOGL-Q10

- Ticker: GOOGL
- Filing key: v9:0001652044:000165204426000048
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=7041, completion=278, total=7319
- Latency: 3972 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は380.6億ドルです。1年内返済予定の長期債務は20億ドルです。

長期債務（非流動）は775億ドルです。営業CFは457.9億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S14: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S16: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S18: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### AMZN-Q01

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1120 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
AMAZON COM INCは、オンライン小売、第三者販売サービス、広告、サブスクリプション、AWSで収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### AMZN-Q02

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 234 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 1,815.2億ドル で、前年同期比 16.6%増 です。 売上構造を見る軸は、オンライン小売、第三者販売サービス、広告、サブスクリプション、AWSです。 提出資料では、北米売上は 販売数量の増加、第三者販売の増加、広告売上の増加、サブスクリプション売上の増加 が主な説明要因と説明しています。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### AMZN-Q03

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4221, completion=207, total=4428
- Latency: 3874 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 1,815.2億ドル で、前年同期比 16.6%増 です。 提出資料では、北米売上は 販売数量の増加、第三者販売の増加、広告売上の増加、サブスクリプション売上の増加 が主な説明要因と説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### AMZN-Q04

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4398, completion=130, total=4528
- Latency: 2821 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、販売数量・出荷量、製品カテゴリ成長、広告需要 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、販売数量・出荷量、製品カテゴリ成長、広告需要、販売数量・ボリューム です。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)

### AMZN-Q05

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=11559, completion=425, total=11984
- Latency: 9910 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率は改善しています。営業利益率は 11.8% から 13.1% へ改善しています。

純利益率は 11.0% から 16.7% へ改善しています。本文で確認できる利益率・利益要因は、販売数量・出荷量の増加、広告売上の増加、配送・フルフィルメント費用の増加です。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)

### AMZN-Q06

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=5941, completion=217, total=6158
- Latency: 2968 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、販売数量・出荷量 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、販売数量・出荷量 です。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)

### AMZN-Q07

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 465 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年9月30日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年9月30日 の 211.9億ドル から 2026年3月31日 の 302.6億ドル へ、前回比 42.8% 増加しました。

営業利益は 2025年9月30日 の 174.2億ドル から 2026年3月31日 の 238.5億ドル へ、前回比 36.9% 増加しました。売上高は 2025年9月30日 の 1,801.7億ドル から 2026年3月31日 の 1,815.2億ドル へ、前回比 0.7% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0001018724:000101872426000014:S10: 10-Q filed 2026-04-30 · period 2026-03-31 (historical_metric)
- v9:0001018724:000101872425000123:S10: 10-Q filed 2025-10-31 · period 2025-09-30 (historical_metric)
- v9:0001018724:000101872426000014:S12: 10-Q filed 2026-04-30 · period 2026-03-31 (historical_metric)
- v9:0001018724:000101872425000123:S12: 10-Q filed 2025-10-31 · period 2025-09-30 (historical_metric)
- v9:0001018724:000101872426000014:S9: 10-Q filed 2026-04-30 · period 2026-03-31 (historical_metric)
- v9:0001018724:000101872425000123:S9: 10-Q filed 2025-10-31 · period 2025-09-30 (historical_metric)

### AMZN-Q08

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 293 ms
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

### AMZN-Q09

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 229 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 260.3億ドル で、前年同期比 53.0%増 です。前年差でも改善しています。

同じ対象期間の純利益は 302.6億ドル です。営業CFと純利益はいずれもプラスですが、営業CFは純利益を下回るため、運転資本による差を確認する必要があります。

提出資料では運転資本の増減要因に触れていますが、この根拠だけでは営業CFへの寄与額を算定しません。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### AMZN-Q10

- Ticker: AMZN
- Filing key: v9:0001018724:000101872426000014
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=6964, completion=313, total=7277
- Latency: 4350 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は1,018.2億ドルです。1年内返済予定の長期債務は28.3億ドルです。

長期債務（非流動）は1,190.7億ドルです。営業CFは260.3億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S14: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S16: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S18: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### TSLA-Q01

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 544 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Tesla, Inc.は、車両販売・関連サービス、サービス・その他、エネルギー生成・蓄電で収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)

### TSLA-Q02

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 280 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 223.9億ドル で、前年同期比 15.8%増 です。売上の柱は、車両販売・関連サービス、サービス・その他です。

提出資料では、サービス・その他売上は 中古車販売数量の増加、有償整備・修理売上の増加、有料スーパーチャージ利用の増加、自動車保険売上の増加 が主な説明要因、自動車販売売上は 納車台数の増加、平均販売価格の上昇、販売構成、為替影響 が主な説明要因と説明しています。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)

### TSLA-Q03

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4214, completion=213, total=4427
- Latency: 4020 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: source_gate_applied, missing_segment_revenue_context, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 223.9億ドル で、前年同期比 15.8%増 です。提出資料では、サービス・その他売上は 中古車販売数量の増加、有償整備・修理売上の増加、有料スーパーチャージ利用の増加、自動車保険売上の増加 が主な説明要因、自動車販売売上は 納車台数の増加、平均販売価格の上昇、販売構成、為替影響 が主な説明要因と説明しています。

寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)

### TSLA-Q04

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4438, completion=285, total=4723
- Latency: 3785 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、サービス売上、販売数量・出荷量、価格・ミックス、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、サービス売上、販売数量・出荷量、価格・ミックス、製品カテゴリ成長 です。
```

Sources:

- S4: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-23 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-23 (md_a)

### TSLA-Q05

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5698, completion=239, total=5937
- Latency: 3362 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率は改善しています。営業利益率は 2.1% から 4.2% へ改善しています。

純利益率は 2.1% から 2.1% で、大きな変化はありません。本文で確認できる利益率・利益要因は、販売数量・出荷量の増加、人件費・報酬費の増加、研究開発・販管費の増加です。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-23 (md_a)

### TSLA-Q06

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=5917, completion=354, total=6271
- Latency: 4383 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、販売数量・出荷量、研究開発費、販売管理費、人件費 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、販売数量・出荷量、研究開発費、販売管理費、人件費 です。
```

Sources:

- S6: 10-Q Margin and profitability discussion, filed 2026-04-23 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-23 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)

### TSLA-Q07

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 480 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年9月30日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年9月30日 の 13.7億ドル から 2026年3月31日 の 4.8億ドル へ、前回比 65.3% 減少しました。

営業利益は 2025年9月30日 の 16.2億ドル から 2026年3月31日 の 9.4億ドル へ、前回比 42.1% 減少しました。売上高は 2025年9月30日 の 281億ドル から 2026年3月31日 の 223.9億ドル へ、前回比 20.3% 減少しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0001318605:000162828026026673:S10: 10-Q filed 2026-04-23 · period 2026-03-31 (historical_metric)
- v9:0001318605:000162828025045968:S11: 10-Q filed 2025-10-23 · period 2025-09-30 (historical_metric)
- v9:0001318605:000162828026026673:S12: 10-Q filed 2026-04-23 · period 2026-03-31 (historical_metric)
- v9:0001318605:000162828025045968:S13: 10-Q filed 2025-10-23 · period 2025-09-30 (historical_metric)
- v9:0001318605:000162828026026673:S9: 10-Q filed 2026-04-23 · period 2026-03-31 (historical_metric)
- v9:0001318605:000162828025045968:S10: 10-Q filed 2025-10-23 · period 2025-09-30 (historical_metric)

### TSLA-Q08

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 227 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 223.9億ドル で、前年同期比 15.8%増 です。 伸びた部分として提出資料に明示されているのは、サービス・その他です。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-23 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### TSLA-Q09

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 255 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 39.4億ドル で、前年同期比 82.6%増 です。前年差でも改善しています。

同じ対象期間の純利益は 4.8億ドル です。営業CFと純利益はいずれもプラスで、営業CFは純利益を上回っています。

運転資本の増減内訳は、返却された根拠では確認できません。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)

### TSLA-Q10

- Ticker: TSLA
- Filing key: v9:0001318605:000162828026026673
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=4570, completion=263, total=4833
- Latency: 3744 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: liquidity_conclusion_deterministic_recovery, q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は166億ドルです。営業CFは39.4億ドルです。

現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。返却された根拠では1年内返済予定の長期債務・長期債務（非流動）を確認できません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S14: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### LLY-Q01

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 611 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
ELI LILLY & Coは、糖尿病・肥満症、がん、免疫などの医薬品で収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### LLY-Q02

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 267 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 198億ドル で、前年同期比 55.5%増 です。 売上構造を見る軸は、糖尿病・肥満症薬、がん領域、免疫領域、その他医薬品です。 提出資料では、全社売上は 販売数量の増加、実現価格の低下による一部相殺 が主な説明要因と説明しています。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### LLY-Q03

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4061, completion=216, total=4277
- Latency: 3527 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, missing_segment_revenue_context, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 198億ドル で、前年同期比 55.5%増 です。 提出資料では、全社売上は 販売数量の増加、実現価格の低下による一部相殺 が主な説明要因と説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### LLY-Q04

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4218, completion=183, total=4401
- Latency: 3096 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、販売数量・出荷量、価格・ミックス、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、販売数量・出荷量、価格・ミックス、製品カテゴリ成長、販売数量・ボリューム です。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)

### LLY-Q05

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=9138, completion=373, total=9511
- Latency: 6748 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, retry_wasted, margin_snapshot_deterministic_repair, margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率は改善しています。 純利益率は 21.7% から 37.4% へ改善しています。 本文で確認できる利益率・利益要因は、価格実現・製品ミックスの悪化、研究開発・販管費の増加、買収関連費用の減少です。 一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)

### LLY-Q06

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=4763, completion=390, total=5153
- Latency: 6751 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、価格・ミックス、研究開発費、販売管理費、買収関連費用 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、価格・ミックス、研究開発費、販売管理費、買収関連費用 です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- CTX1: 10-Q Profitability context, filed 2026-04-30 (md_a)
- CTX2: 10-Q Profitability context, filed 2026-04-30 (md_a)

### LLY-Q07

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 472 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年3月31日）と、直前の同じ様式の 2025年9月30日 の提出資料を比べました。大きく変わった順では、 純利益は 2025年9月30日 の 55.8億ドル から 2026年3月31日 の 74億ドル へ、前回比 32.5% 増加しました。

売上高は 2025年9月30日 の 176億ドル から 2026年3月31日 の 198億ドル へ、前回比 12.5% 増加しました。各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000059478:000005947826000045:S10: 10-Q filed 2026-04-30 · period 2026-03-31 (historical_metric)
- v9:0000059478:000005947825000254:S11: 10-Q filed 2025-10-30 · period 2025-09-30 (historical_metric)
- v9:0000059478:000005947826000045:S9: 10-Q filed 2026-04-30 · period 2026-03-31 (historical_metric)
- v9:0000059478:000005947825000254:S10: 10-Q filed 2025-10-30 · period 2025-09-30 (historical_metric)

### LLY-Q08

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 285 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 198億ドル で、前年同期比 55.5%増 です。 伸びた部分として提出資料に明示されているのは、Mounjaro、Zepboundです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### LLY-Q09

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 242 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 53.3億ドル で、前年同期比 220.1%増 です。前年差でも改善しています。

同じ対象期間の純利益は 74億ドル です。営業CFと純利益はいずれもプラスですが、営業CFは純利益を下回るため、運転資本による差を確認する必要があります。

運転資本の増減内訳は、返却された根拠では確認できません。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)

### LLY-Q10

- Ticker: LLY
- Filing key: v9:0000059478:000005947826000045
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=5740, completion=195, total=5935
- Latency: 3573 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は52.8億ドルです。長期債務（非流動）は393.7億ドルです。

営業CFは53.3億ドルです。現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。

返却された根拠では1年内返済予定の長期債務を確認できません。コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。

返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S13: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S15: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S12: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

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
- Latency: 610 ms
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
- Latency: 230 ms
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
- Tokens: prompt=10104, completion=491, total=10595
- Latency: 9404 ms
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
- Model: openai / gpt-5-nano
- Tokens: prompt=4613, completion=214, total=4827
- Latency: 2947 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

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
- Tokens: prompt=5761, completion=202, total=5963
- Latency: 3471 ms
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
- Tokens: prompt=5977, completion=285, total=6262
- Latency: 3795 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、営業費用・原価、人件費、訴訟費用・引当 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用・原価、人件費、訴訟費用・引当 です。
```

Sources:

- S5: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-29 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)
- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S7: 10-Q Margin and profitability discussion, filed 2026-04-29 (md_a)

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
- Latency: 507 ms
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
- Latency: 235 ms
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
- Latency: 232 ms
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
- Tokens: prompt=6983, completion=265, total=7248
- Latency: 3256 ms
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

### KO-Q01

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 589 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
COCA COLA COは、飲料原液・完成品、ブランド飲料、地域ボトラー向け販売で収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### KO-Q02

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
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
- Source count: 5
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 124.7億ドル で、前年同期比 12.1%増 です。 売上構造を見る軸は、濃縮原液、完成品飲料、炭酸飲料、水・スポーツ飲料・コーヒー・茶です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S10: XBRL 売上高 comparison (Revenues) (xbrl_metric)

### KO-Q03

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=10038, completion=410, total=10448
- Latency: 7722 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, retry_wasted, revenue_drivers_deterministic_repair, numeric_alignment_repaired

Answer:

```text
売上高は 124.7億ドル で、前年同期比 12.1%増 です。 選択された提出資料では売上の増減は確認できますが、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明は確認できません。 選択資料で明示された範囲を超えて、主因は断定しません。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S10: XBRL 売上高 comparison (Revenues) (xbrl_metric)

### KO-Q04

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=4665, completion=151, total=4816
- Latency: 3809 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, retry_blocked:hard_intent_retry_disabled, source_gate_applied, q04_previous_answer_driver_candidate_repair, language_guard_source_backed_repair

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### KO-Q05

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5754, completion=211, total=5965
- Latency: 3505 ms
- Source count: 12
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery, numeric_alignment_repaired

Answer:

```text
提出資料上、利益率は改善しています。営業利益率は 32.9% から 35.0% へ改善しています。

純利益率は 29.9% から 31.5% へ改善しています。本文で確認できる利益率・利益要因は、販売数量・出荷量の増加、価格実現・製品ミックスの改善、為替の押し上げです。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S15: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S11: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S16: XBRL 営業利益 comparison (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 売上高 comparison (Revenues) (xbrl_metric)
- S12: XBRL 純利益 comparison (NetIncomeLoss) (xbrl_metric)

### KO-Q06

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=5955, completion=225, total=6180
- Latency: 3472 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、販売数量・出荷量、価格・ミックス、為替 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、販売数量・出荷量、価格・ミックス、為替 です。
```

Sources:

- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-04-30 (md_a)

### KO-Q07

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 785 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年4月3日）と、直前の同じ様式の 2025年9月26日 の提出資料を比べました。大きく変わった順では、 営業利益は 2025年9月26日 の 39.8億ドル から 2026年4月3日 の 43.6億ドル へ、前回比 9.5% 増加しました。

純利益は 2025年9月26日 の 37億ドル から 2026年4月3日 の 39.2億ドル へ、前回比 6.2% 増加しました。売上高は 2025年9月26日 の 124.6億ドル から 2026年4月3日 の 124.7億ドル へ、前回比 0.1% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000021344:000162828026028802:S15: 10-Q filed 2026-04-30 · period 2026-04-03 (historical_metric)
- v9:0000021344:000162828025046054:S16: 10-Q filed 2025-10-23 · period 2025-09-26 (historical_metric)
- v9:0000021344:000162828026028802:S11: 10-Q filed 2026-04-30 · period 2026-04-03 (historical_metric)
- v9:0000021344:000162828025046054:S12: 10-Q filed 2025-10-23 · period 2025-09-26 (historical_metric)
- v9:0000021344:000162828026028802:S9: 10-Q filed 2026-04-30 · period 2026-04-03 (historical_metric)
- v9:0000021344:000162828025046054:S10: 10-Q filed 2025-10-23 · period 2025-09-26 (historical_metric)

### KO-Q08

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 222 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
売上高は 124.7億ドル で、前年同期比 12.1%増 です。 選択された抜粋では、伸びた具体的なセグメント・地域・製品を特定できません。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 売上高 comparison (Revenues) (xbrl_metric)

### KO-Q09

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 229 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: numeric_alignment_repaired

Answer:

```text
営業CFは当期 20.2億ドル で、前年同期の -52億ドル から符号が転じました。前年同期のマイナスから当期はプラスへ転じています。

同じ対象期間の純利益は 39.2億ドル です。営業CFと純利益はいずれもプラスですが、営業CFは純利益を下回るため、運転資本による差を確認する必要があります。

運転資本の増減内訳は、返却された根拠では確認できません。設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。

プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S17: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S11: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S18: XBRL 営業CF comparison (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### KO-Q10

- Ticker: KO
- Filing key: v9:0000021344:000162828026028802
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=4913, completion=225, total=5138
- Latency: 3388 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: liquidity_conclusion_deterministic_recovery, q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は105.7億ドルです。営業CFは20.2億ドルです。

現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。返却された根拠では1年内返済予定の長期債務・長期債務（非流動）を確認できません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S19: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S17: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)

### DAL-Q01

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 678 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
DELTA AIR LINES, INC.は、旅客航空、プレミアム座席、ロイヤルティ、貨物・整備関連サービスで収益を得ている会社です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)

### DAL-Q02

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: 直近決算の売上はどうだった？
- Intent: revenue_snapshot
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: revenue_breakdown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 291 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 197.6億ドル で、前年同期比 18.7%増 です。 売上構造を見る軸は、旅客収入、プレミアム座席、ロイヤルティ、貨物・整備関連サービスです。 提出資料では、旅客収入・全社売上は 運賃・価格の上昇、幅広い旅客需要、プレミアム・法人・ロイヤルティ需要 が主な説明要因と説明しています。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)

### DAL-Q03

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4648, completion=234, total=4882
- Latency: 3895 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 197.6億ドル で、前年同期比 18.7%増 です。 提出資料では、旅客収入・全社売上は 運賃・価格の上昇、幅広い旅客需要、プレミアム・法人・ロイヤルティ需要 が主な説明要因と説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)

### DAL-Q04

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4823, completion=251, total=5074
- Latency: 3794 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、価格・ミックス、需給環境、製品カテゴリ成長、旅客収入 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、価格・ミックス、需給環境、製品カテゴリ成長、旅客収入 です。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-07-10 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-07-10 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-07-10 (md_a)

### DAL-Q05

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: 利益率が改善、または悪化した理由は？
- Intent: margin_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / unknown
- Tokens: prompt=5845, completion=222, total=6067
- Latency: 3254 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: margin_driver_deterministic_recovery

Answer:

```text
提出資料上、利益率の改善は確認できません。営業利益率は 12.6% から 9.4% へ低下しています。

純利益率は 12.8% から 8.1% へ低下しています。本文で確認できる利益率・利益要因は、燃料・精製関連費用の増加、人件費・報酬費の増加、価格実現・製品ミックスの改善です。

一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。
```

Sources:

- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-07-10 (md_a)

### DAL-Q06

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: margin_profitability
- Model: openai / gpt-5-nano
- Tokens: prompt=6066, completion=343, total=6409
- Latency: 5116 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q06_previous_answer_margin_candidate_repair

Answer:

```text
前問で挙がっていた利益率要因候補は、価格・ミックス、人件費、燃料費 です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、価格・ミックス、人件費、燃料費 です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-07-10 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-07-10 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-07-10 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)

### DAL-Q07

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: 前回決算と比べて大きく変わった点は？
- Intent: prior_filing_delta
- Response path: historical
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: historical_comparison
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 555 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
直近の 10-Q（対象期間 2026年6月30日）と、直前の同じ様式の 2026年3月31日 の提出資料を比べました。大きく変わった順では、 純利益は 2026年3月31日 の -2.9億ドル から 2026年6月30日 の 16億ドル へ増加し、マイナスからプラスに転じました。

営業利益は 2026年3月31日 の 5億ドル から 2026年6月30日 の 18.6億ドル へ、前回比 272.1% 増加しました。売上高は 2026年3月31日 の 158.5億ドル から 2026年6月30日 の 197.6億ドル へ、前回比 24.6% 増加しました。

各数値は、この2つの提出資料に記録された対象期間値どうしの比較です。
```

Sources:

- v9:0000027904:000002790426000031:S10: 10-Q filed 2026-07-10 · period 2026-06-30 (historical_metric)
- v9:0000027904:000002790426000022:S10: 10-Q filed 2026-04-08 · period 2026-03-31 (historical_metric)
- v9:0000027904:000002790426000031:S12: 10-Q filed 2026-07-10 · period 2026-06-30 (historical_metric)
- v9:0000027904:000002790426000022:S12: 10-Q filed 2026-04-08 · period 2026-03-31 (historical_metric)
- v9:0000027904:000002790426000031:S9: 10-Q filed 2026-07-10 · period 2026-06-30 (historical_metric)
- v9:0000027904:000002790426000022:S9: 10-Q filed 2026-04-08 · period 2026-03-31 (historical_metric)

### DAL-Q08

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: どのセグメントや地域が伸びた？弱かった部分は？
- Intent: segment_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: segment_analysis
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 329 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
売上高は 197.6億ドル で、前年同期比 18.7%増 です。 伸びた部分として提出資料に明示されているのは、旅客収入、プレミアム座席、ロイヤルティです。 減収・減益が明示されたセグメントや地域は、この抜粋からは特定できません。これは弱い部分が存在しないという意味ではなく、比較表やセグメント注記の追加確認が必要です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-07-10 (md_a)
- S9: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### DAL-Q09

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: 営業キャッシュフローは健全？
- Intent: cash_flow_quality
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: cash_flow
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 227 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
営業CFは 40.3億ドル で、前年同期比 4.9%減 です。前年差では悪化していますが、金額はプラスです。

営業CFと同じ対象期間の純利益を確認できないため、両者の大小は比較しません。提出資料では運転資本の増減要因に触れていますが、この根拠だけでは営業CFへの寄与額を算定しません。

設備投資額が返却された根拠にないため、設備投資後の余力は確認できません。プラスの営業CFなので、本業から現金は生んでいますが、利益の現金化と投資後の余力を確認するまでは健全性を断定しません。
```

Sources:

- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-07-10 (md_a)

### DAL-Q10

- Ticker: DAL
- Filing key: v9:0000027904:000002790426000031
- Question: 資金繰りや負債に懸念はある？
- Intent: liquidity_debt
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: liquidity_debt
- Model: openai / unknown
- Tokens: prompt=6886, completion=228, total=7114
- Latency: 4121 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: q10_semantic_deterministic_recovery, numeric_alignment_deterministic_recovery

Answer:

```text
現金及び現金同等物は46.7億ドルです。1年内返済予定の長期債務は28億ドルです。

長期債務（非流動）は101億ドルです。営業CFは40.3億ドルです。

同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。

コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。
```

Sources:

- S14: XBRL 現金及び現金同等物 (CashAndCashEquivalentsAtCarryingValue) (xbrl_metric)
- S15: XBRL 1年内返済予定の長期債務 (LongTermDebtCurrent) (xbrl_metric)
- S17: XBRL 長期債務（非流動） (LongTermDebtNoncurrent) (xbrl_metric)
- S13: XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities) (xbrl_metric)
