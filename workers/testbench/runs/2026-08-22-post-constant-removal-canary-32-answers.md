# 2026-08-22-post-constant-removal-canary-32 Answers

## Test Method

- Scope: prompt v2 smoke response test against the Kabuyomi test Worker.
- Base URL: https://kabuyomi-api-test.dznqjmctk7.workers.dev
- Run started at: 2026-08-22T01:53:07.062Z
- Tickers: AAPL, GOOG, JPM, CAT, AVGO, META, BAC, MA
- Rows: 32
- Questions: `/private/tmp/claude-501/-Users-0xt4-t4dano-statik-apps-Kabuyomi/1f8ecabe-5262-4faf-9ede-5d595b971cb8/scratchpad/canary-4.jsonl`
- Company set: `inline:KABUYOMI_TESTBENCH_TICKERS`
- Question templates observed: 4
- Company tickers observed: 8
- Note: hidden internal chain-of-thought is not recorded. This report records observable test rationale, criteria, outputs, and diagnostics.

## Result Summary

- Response paths: deterministic=24, fallback=3, openai=5
- Fallback reasons: low_quality_answer=3, none=29
- Infra errors: none=32
- Source ID invalid rows: 0
- Quality rows: 32
- Quality fallback rate: 9.4%
- Quality Q03/Q04/Q06 fallback: 1
- Quality hard-intent fallback: 3
- Average latency: 5305 ms
- Max latency: BAC-Q04 17662 ms

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
- qualitySourceEvidenceWeak: 7
- fallbackTaxonomyIntentMismatch: 1
- fallbackKindNoneOnFallbackRows: 0

## Review Notes

- Treat `fallbackReason=low_quality_answer` rows as the first human-review targets.
- Deterministic rows are expected when the local deterministic answer path handles the question.
- A row with no fallback is not automatically perfect; review the full answer text below for wording and grounding quality.

## Quality Issue Examples

### q03Q04Q06FinalEvidenceMissing

- AAPL-Q06 AAPL Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、粗利益率 です。次に見るべき指標は、粗利益率 です。
- META-Q04 META Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。
- MA-Q04 MA Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
- MA-Q06 MA Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、営業費用・原価、為替、訴訟費用・引当 です。次に見るべき指標は、営業費用・原価、為替、訴訟費用・引当 です。

### qualitySourceEvidenceWeak

- AAPL-Q06 AAPL Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、粗利益率 です。次に見るべき指標は、粗利益率 です。
- CAT-Q01 CAT Q01 business_model (fallback/low_quality/answer_too_metric_only): 主に Power & Energy、資源産業、建設機械 の三つのセグメントの機器販売とそれに付随するサービスが収益の源泉です。 今後は全社ベースで2026年は前年を低いダブルディジット成長で上回る見込みと示されていますが、関税費用の影響など製造コストの影響も一部留意点として挙げられています。
- META-Q04 META Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。
- BAC-Q01 BAC Q01 business_model (fallback/low_quality/answer_too_metric_only): Bank of Americaは銀行・金融サービスを幅広く提供しており、主にConsumer Banking・Global Wealth & Investment Management（GWIM）・Global Banking・Global Marketsの4セグメントで収益を得ています。 なお、セグメント別の具体的な寄与額は本報告書には明示されていません。
- MA-Q04 MA Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
- MA-Q06 MA Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、営業費用・原価、為替、訴訟費用・引当 です。次に見るべき指標は、営業費用・原価、為替、訴訟費用・引当 です。

### fallbackTaxonomyIntentMismatch

- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。

### qualityQ03Q04Q06Fallback

- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。

### qualityHardIntentFallback

- CAT-Q01 CAT Q01 business_model (fallback/low_quality/answer_too_metric_only): 主に Power & Energy、資源産業、建設機械 の三つのセグメントの機器販売とそれに付随するサービスが収益の源泉です。 今後は全社ベースで2026年は前年を低いダブルディジット成長で上回る見込みと示されていますが、関税費用の影響など製造コストの影響も一部留意点として挙げられています。
- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。
- BAC-Q01 BAC Q01 business_model (fallback/low_quality/answer_too_metric_only): Bank of Americaは銀行・金融サービスを幅広く提供しており、主にConsumer Banking・Global Wealth & Investment Management（GWIM）・Global Banking・Global Marketsの4セグメントで収益を得ています。 なお、セグメント別の具体的な寄与額は本報告書には明示されていません。

## Fallback Rows

- CAT-Q01: low_quality_answer / low_quality / answer_too_metric_only
- META-Q06: low_quality_answer / evidence_slot / revenue_driver_sources_missing
- BAC-Q01: low_quality_answer / low_quality / answer_too_metric_only

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
- Latency: 1867 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Apple Inc.は、iPhone、Mac、iPad、ウェアラブル、ホーム、アクセサリ、サービスを主な事業・製品群として持つ会社です。
```

Sources:

- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### AAPL-Q03

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4537, completion=1222, total=5759
- Latency: 8215 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery, numeric_alignment_repaired

Answer:

```text
売上高は 1,111.8億ドル で、前年同期比 16.6%増 です。 提出資料では、日本は iPhone、アジア太平洋は iPhone と サービスと説明しています。 寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

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
- Latency: 720 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, durability_context_missing, hard_retrieval_used, q04_previous_answer_driver_candidate_repair, hard_intent_explicit_insufficiency_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、iPhone、サービス売上、製品カテゴリ成長 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、iPhone、サービス売上、製品カテゴリ成長、製品別売上 です。
```

Sources:

- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### AAPL-Q06

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 754 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: source_gate_applied, source_gate_failed, q04_table_heavy_context, durability_context_missing, q04_durability_evidence_too_generic, hard_retrieval_used, raw_english_excerpt, final_answer_language_violation, answer_rewritten_to_japanese_fallback

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

### GOOG-Q01

- Ticker: GOOG
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
- Latency: 544 ms
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

### GOOG-Q03

- Ticker: GOOG
- Filing key: v9:0001652044:000165204426000048
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4477, completion=756, total=5233
- Latency: 5202 ms
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

### GOOG-Q04

- Ticker: GOOG
- Filing key: v9:0001652044:000165204426000048
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4631, completion=651, total=5282
- Latency: 4263 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、地域別売上、サービス売上、製品カテゴリ成長、Google Cloud です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、地域別売上、サービス売上、製品カテゴリ成長、Google Cloud、製品別売上 です。
```

Sources:

- CTX2: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX4: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### GOOG-Q06

- Ticker: GOOG
- Filing key: v9:0001652044:000165204426000048
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4476, completion=660, total=5136
- Latency: 5840 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: source_gate_applied, language_guard_source_backed_repair

Answer:

```text
前問の売上要因は、製品ミックス、客数、サービス売上、Googleサービス に関する説明が中心です。提出資料には 継続収益やサービス需要 も示されていますが、これだけで継続性は断定できません。次に見るべき指標は、製品ミックス、客数、サービス売上、Googleサービス です。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX4: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

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
- Latency: 550 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
JPMORGAN CHASE & COは、決済・取引サービスを主な事業にする会社です。提出資料の本文にある事業説明から確認できます。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

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
- Tokens: prompt=3749, completion=1022, total=4771
- Latency: 10089 ms
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
- Tokens: prompt=3933, completion=762, total=4695
- Latency: 5207 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、決済額・処理件数・国際取引量、純利息収入、非利息収入・投資銀行・市場業務、買収影響 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、決済額・処理件数・国際取引量、純利息収入、非利息収入・投資銀行・市場業務、買収影響 です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q06

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=3748, completion=654, total=4402
- Latency: 4416 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, language_guard_source_backed_repair

Answer:

```text
提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、減価償却費、人件費、訴訟費用・引当 です。次に見るべき指標は、減価償却費、人件費、訴訟費用・引当 です。
```

Sources:

- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- S6: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### CAT-Q01

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: business_overview
- Model: openai / unknown
- Tokens: prompt=4486, completion=1123, total=5609
- Latency: 7468 ms
- Source count: 5
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, fallback_slot_incomplete

Answer:

```text
主に Power & Energy、資源産業、建設機械 の三つのセグメントの機器販売とそれに付随するサービスが収益の源泉です。 今後は全社ベースで2026年は前年を低いダブルディジット成長で上回る見込みと示されていますが、関税費用の影響など製造コストの影響も一部留意点として挙げられています。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- CTX2: 10-Q Business overview context, filed 2026-05-06 (md_a)
- CTX3: 10-Q Business overview context, filed 2026-05-06 (md_a)
- CTX4: 10-Q Business overview context, filed 2026-05-06 (md_a)
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
- Tokens: prompt=4294, completion=541, total=4835
- Latency: 3883 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery

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
- Model: openai / unknown
- Tokens: prompt=4463, completion=827, total=5290
- Latency: 5136 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair, language_guard_source_backed_repair

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)

### CAT-Q06

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4293, completion=675, total=4968
- Latency: 5016 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: source_gate_applied, cat_q06_revenue_unit_corrected_from_source, language_guard_source_backed_repair

Answer:

```text
提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、製造コスト、関税、研究開発費、販売管理費、人件費 です。次に見るべき指標は、製造コスト、関税、研究開発費、販売管理費、人件費 です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S10: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S4: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)

### AVGO-Q01

- Ticker: AVGO
- Filing key: v9:0001730168:000173016826000054
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
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Broadcom Inc.は、クラウドサービスを主な事業にする会社です。提出資料の本文にある事業説明から確認できます。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)

### AVGO-Q03

- Ticker: AVGO
- Filing key: v9:0001730168:000173016826000054
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4187, completion=1792, total=5979
- Latency: 17049 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: retry_blocked:hard_intent_retry_disabled, revenue_drivers_deterministic_repair, numeric_alignment_repaired

Answer:

```text
売上高は 221.9億ドル で、前年同期比 47.9%増 です。 選択された提出資料では売上の増減は確認できますが、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明は確認できません。 選択資料で明示された範囲を超えて、主因は断定しません。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### AVGO-Q04

- Ticker: AVGO
- Filing key: v9:0001730168:000173016826000054
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4356, completion=984, total=5340
- Latency: 7589 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair, language_guard_source_backed_repair

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)

### AVGO-Q06

- Ticker: AVGO
- Filing key: v9:0001730168:000173016826000054
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4186, completion=909, total=5095
- Latency: 6738 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: source_gate_applied, language_guard_source_backed_repair

Answer:

```text
前問の売上要因は、製品ミックス に関する説明が中心です。ただし、提出資料だけでは継続性は断定できません。次に見るべき指標は、製品ミックス です。
```

Sources:

- S3: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-06-09 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-06-09 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-06-09 (md_a)

### META-Q01

- Ticker: META
- Filing key: v9:0001326801:000162828026050705
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1042 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Meta Platforms, Inc.は、その他収益を主な事業にする会社です。提出資料では、売上区分としてこれらの事業が確認できます。
```

Sources:

- S4: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### META-Q03

- Ticker: META
- Filing key: v9:0001326801:000162828026050705
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4471, completion=741, total=5212
- Latency: 5229 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 608億ドル で、前年同期比 28.0%増 です。 選択された提出資料では売上の増減は確認できますが、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明は確認できません。 選択資料で明示された範囲を超えて、主因は断定しません。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### META-Q04

- Ticker: META
- Filing key: v9:0001326801:000162828026050705
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 463 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, durability_context_missing, hard_retrieval_used, q04_previous_answer_driver_candidate_repair

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### META-Q06

- Ticker: META
- Filing key: v9:0001326801:000162828026050705
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: evidence_slot
- Fallback user reason: revenue_driver_sources_missing
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 479 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, source_gate_failed, missing_durability_context, durability_context_missing, driver_supported_but_durability_unclear, evidence_fallback_used, hard_retrieval_used

Answer:

```text
前問の要因は、広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- CTX1: 10-Q Segment and revenue context, filed 2026-07-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### BAC-Q01

- Ticker: BAC
- Filing key: v9:0000070858:000007085826000394
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: business_overview
- Model: openai / unknown
- Tokens: prompt=4518, completion=818, total=5336
- Latency: 15663 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, raw_english_excerpt, driver_evidence_fragmentary, source_gate_false_positive, fallback_slot_incomplete

Answer:

```text
Bank of Americaは銀行・金融サービスを幅広く提供しており、主にConsumer Banking・Global Wealth & Investment Management（GWIM）・Global Banking・Global Marketsの4セグメントで収益を得ています。 なお、セグメント別の具体的な寄与額は本報告書には明示されていません。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- CTX3: 10-Q Business overview context, filed 2026-07-31 (md_a)

### BAC-Q03

- Ticker: BAC
- Filing key: v9:0000070858:000007085826000394
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=10991, completion=1704, total=12695
- Latency: 11105 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, retry_wasted, revenue_drivers_deterministic_repair, revenue_driver_deterministic_recovery

Answer:

```text
売上高は 315.6億ドル で、前年同期比 15.0%増 です。 選択された提出資料では売上の増減は確認できますが、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明は確認できません。 選択資料で明示された範囲を超えて、主因は断定しません。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-31 (md_a)

### BAC-Q04

- Ticker: BAC
- Filing key: v9:0000070858:000007085826000394
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=11329, completion=2718, total=14047
- Latency: 17662 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, model_retry_used, retry_attempted, retry_wasted, source_gate_applied, missing_durability_context, durability_context_missing, driver_supported_but_durability_unclear, durability_context_too_generic, q04_previous_answer_driver_candidate_repair, language_guard_source_backed_repair

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-31 (md_a)

### BAC-Q06

- Ticker: BAC
- Filing key: v9:0000070858:000007085826000394
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4888, completion=905, total=5793
- Latency: 5913 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, missing_durability_context, durability_context_missing, driver_supported_but_durability_unclear, durability_context_too_generic, numeric_alignment_qualitative_recovery

Answer:

```text
追加確認が必要な点は、今後の市場環境次第で収益の成長が継続するかの判断材料（顧客需要の反復性、契約条件、受注残、マージンの持続性など）が不足している点です。
```

Sources:

- CTX2: 10-Q Segment and revenue context, filed 2026-07-31 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-07-31 (md_a)

### MA-Q01

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: この会社は何で儲けている？
- Intent: business_model
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: business_overview
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 9890 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: none

Answer:

```text
Mastercard Incは、決済・取引サービスを主な事業にする会社です。提出資料の本文にある事業説明から確認できます。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### MA-Q03

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: 売上成長、または減収の主な要因は？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 549 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: hard_retrieval_used, hard_source_asset_missing_segment_results, revenue_drivers_deterministic_repair

Answer:

```text
売上高は 92.8億ドル で、前年同期比 14.1%増 です。 選択された提出資料では売上の増減は確認できますが、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明は確認できません。 選択資料で明示された範囲を超えて、主因は断定しません。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### MA-Q04

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: その要因は一時的？それとも続きそう？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 440 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, source_gate_failed, durability_context_missing, hard_retrieval_used, hard_source_asset_missing_segment_results, q04_previous_answer_driver_candidate_repair

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### MA-Q06

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: これは一時要因？それとも構造的な変化？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 241 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: source_gate_applied, source_gate_failed, driver_slots_empty, sector_required_source_missing, followup_target_empty, missing_followup_target_driver, missing_durability_context, durability_context_missing, q04_driver_evidence_too_generic, fallback_slot_incomplete, hard_retrieval_used, hard_source_asset_missing_segment_results

Answer:

```text
提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、営業費用・原価、為替、訴訟費用・引当 です。次に見るべき指標は、営業費用・原価、為替、訴訟費用・引当 です。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S13: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)
- S11: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S5: 10-Q Margin and profitability discussion, filed 2026-07-30 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-07-30 (md_a)
- S8: 10-Q Margin and profitability discussion, filed 2026-07-30 (md_a)

