# 2026-08-22-human-phrasing-canary-32 Answers

## Test Method

- Scope: prompt v2 smoke response test against the Kabuyomi test Worker.
- Base URL: https://kabuyomi-api-test.dznqjmctk7.workers.dev
- Run started at: 2026-08-22T02:00:47.987Z
- Tickers: AAPL, GOOG, JPM, CAT, AVGO, META, BAC, MA
- Rows: 32
- Questions: `/private/tmp/claude-501/-Users-0xt4-t4dano-statik-apps-Kabuyomi/1f8ecabe-5262-4faf-9ede-5d595b971cb8/scratchpad/human-canary-4.jsonl`
- Company set: `inline:KABUYOMI_TESTBENCH_TICKERS`
- Question templates observed: 4
- Company tickers observed: 8
- Note: hidden internal chain-of-thought is not recorded. This report records observable test rationale, criteria, outputs, and diagnostics.

## Result Summary

- Response paths: deterministic=17, fallback=9, openai=6
- Fallback reasons: low_quality_answer=9, none=23
- Infra errors: none=32
- Source ID invalid rows: 0
- Quality rows: 32
- Quality fallback rate: 28.1%
- Quality Q03/Q04/Q06 fallback: 1
- Quality hard-intent fallback: 9
- Average latency: 5516 ms
- Max latency: BAC-Q03 14797 ms

## Quality Gate Counters

- rawEnglishSurfaced: 0
- hybridEnglishJapaneseSurfaced: 0
- genericBusinessModelAnswers: 0
- genericRevenueBreakdownAnswers: 0
- misleadingRevenueDriverCauses: 0
- nonFinancialCashFlowBankLanguage: 0
- metricOnlyImportantIntentAnswers: 0
- durabilityFollowupLostPriorDriver: 1
- numericDisplaySuspicious: 0
- unsupportedDurabilityClassification: 0
- unsupportedRiskOrLiquidityConclusion: 0
- qualitySourceEvidenceWeak: 14
- fallbackTaxonomyIntentMismatch: 1
- fallbackKindNoneOnFallbackRows: 0

## Review Notes

- Treat `fallbackReason=low_quality_answer` rows as the first human-review targets.
- Deterministic rows are expected when the local deterministic answer path handles the question.
- A row with no fallback is not automatically perfect; review the full answer text below for wording and grounding quality.

## Quality Issue Examples

### durabilityFollowupLostPriorDriver

- AVGO-Q06 AVGO Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。

### q03Q04Q06FinalEvidenceMissing

- AAPL-Q06 AAPL Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、粗利益率 です。次に見るべき指標は、粗利益率 です。
- AVGO-Q06 AVGO Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
- META-Q04 META Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、為替影響 / 広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。
- MA-Q04 MA Q04 driver_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
- MA-Q06 MA Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、営業費用・原価、為替、訴訟費用・引当 です。次に見るべき指標は、営業費用・原価、為替、訴訟費用・引当 です。

### qualitySourceEvidenceWeak

- AAPL-Q01 AAPL Q01 business_model (fallback/low_quality/business_model_sources_missing): 選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。
- AAPL-Q06 AAPL Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、粗利益率 です。次に見るべき指標は、粗利益率 です。
- GOOG-Q01 GOOG Q01 business_model (fallback/low_quality/business_model_sources_missing): 選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。
- JPM-Q01 JPM Q01 business_model (fallback/low_quality/answer_too_metric_only): この会社は総収益を源泉にして活動しています。 収益の内訳の詳細はこの資料には示されていません。
- CAT-Q01 CAT Q01 business_model (fallback/evidence_slot/answer_too_metric_only): ただし、この資料だけだと会社固有の売上要因までは追いきれません。次に見るなら、サブスク・利用量・顧客指標、価格実現、販売数量、受注・バックログ、価格とコスト・製造コスト あたりです。
- AVGO-Q01 AVGO Q01 business_model (fallback/low_quality/answer_too_metric_only): Broadcomは顧客との契約に基づく売上で稼いでいます。
- AVGO-Q06 AVGO Q06 margin_durability_followup (deterministic/none/none): 提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
- META-Q01 META Q01 business_model (fallback/low_quality/answer_too_metric_only): この会社は顧客との契約に基づく売上高を得ています。
- ... 6 more

### fallbackTaxonomyIntentMismatch

- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、為替影響 / 広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。

### fallbackTaxonomyTupleMismatch

- CAT-Q01 CAT Q01 business_model (fallback/evidence_slot/answer_too_metric_only): ただし、この資料だけだと会社固有の売上要因までは追いきれません。次に見るなら、サブスク・利用量・顧客指標、価格実現、販売数量、受注・バックログ、価格とコスト・製造コスト あたりです。

### qualityQ03Q04Q06Fallback

- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、為替影響 / 広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。

### qualityHardIntentFallback

- AAPL-Q01 AAPL Q01 business_model (fallback/low_quality/business_model_sources_missing): 選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。
- GOOG-Q01 GOOG Q01 business_model (fallback/low_quality/business_model_sources_missing): 選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。
- JPM-Q01 JPM Q01 business_model (fallback/low_quality/answer_too_metric_only): この会社は総収益を源泉にして活動しています。 収益の内訳の詳細はこの資料には示されていません。
- CAT-Q01 CAT Q01 business_model (fallback/evidence_slot/answer_too_metric_only): ただし、この資料だけだと会社固有の売上要因までは追いきれません。次に見るなら、サブスク・利用量・顧客指標、価格実現、販売数量、受注・バックログ、価格とコスト・製造コスト あたりです。
- AVGO-Q01 AVGO Q01 business_model (fallback/low_quality/answer_too_metric_only): Broadcomは顧客との契約に基づく売上で稼いでいます。
- META-Q01 META Q01 business_model (fallback/low_quality/answer_too_metric_only): この会社は顧客との契約に基づく売上高を得ています。
- META-Q06 META Q06 margin_durability_followup (fallback/evidence_slot/revenue_driver_sources_missing): 前問の要因は、為替影響 / 広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。
- BAC-Q01 BAC Q01 business_model (fallback/low_quality/answer_too_metric_only): 選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。
- ... 1 more

## Fallback Rows

- AAPL-Q01: low_quality_answer / low_quality / business_model_sources_missing
- GOOG-Q01: low_quality_answer / low_quality / business_model_sources_missing
- JPM-Q01: low_quality_answer / low_quality / answer_too_metric_only
- CAT-Q01: low_quality_answer / evidence_slot / answer_too_metric_only
- AVGO-Q01: low_quality_answer / low_quality / answer_too_metric_only
- META-Q01: low_quality_answer / low_quality / answer_too_metric_only
- META-Q06: low_quality_answer / evidence_slot / revenue_driver_sources_missing
- BAC-Q01: low_quality_answer / low_quality / answer_too_metric_only
- MA-Q01: low_quality_answer / low_quality / answer_too_metric_only

## All Answers

### AAPL-Q01

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: business_model_sources_missing
- Runtime intent: unknown
- Model: openai / unknown
- Tokens: prompt=5552, completion=534, total=6086
- Latency: 6123 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, raw_english_excerpt, driver_evidence_fragmentary, source_gate_false_positive, driver_slots_empty, fallback_slot_incomplete

Answer:

```text
選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### AAPL-Q03

- Ticker: AAPL
- Filing key: v9:0000320193:000032019326000013
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4530, completion=1344, total=5874
- Latency: 10058 ms
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
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1002 ms
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
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: mda_summary
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 852 ms
- Source count: 6
- Source IDs valid: true
- Answer quality flags: source_gate_applied, source_gate_failed, durability_context_missing, q04_durability_evidence_too_generic, hard_retrieval_used, raw_english_excerpt, final_answer_language_violation, answer_repaired_to_japanese, language_guard_source_backed_repair

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
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: business_model_sources_missing
- Runtime intent: unknown
- Model: openai / unknown
- Tokens: prompt=5373, completion=486, total=5859
- Latency: 5584 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, raw_english_excerpt, driver_evidence_fragmentary, source_gate_false_positive, fallback_slot_incomplete

Answer:

```text
選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。
```

Sources:

- CTX1: 10-Q Filing context, filed 2026-04-30 (md_a)
- S9: XBRL 売上高 (Revenues) (xbrl_metric)

### GOOG-Q03

- Ticker: GOOG
- Filing key: v9:0001652044:000165204426000048
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4470, completion=848, total=5318
- Latency: 6664 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: retry_blocked:hard_intent_retry_disabled, revenue_drivers_deterministic_repair, revenue_driver_deterministic_recovery

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
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=4624, completion=616, total=5240
- Latency: 7617 ms
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
- CTX1: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- CTX4: 10-Q Segment and revenue context, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### GOOG-Q06

- Ticker: GOOG
- Filing key: v9:0001652044:000165204426000048
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: mda_summary
- Model: openai / gpt-5-nano
- Tokens: prompt=6616, completion=971, total=7587
- Latency: 8682 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: source_gate_applied, language_guard_source_backed_repair

Answer:

```text
前問の利益率要因候補として確認できるのは、営業費用、人件費、製品・顧客ミックス です。ただし、選択された抜粋だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用、人件費、製品・顧客ミックス、価格・単価 です。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- CTX1: 10-Q MD&A context, filed 2026-04-30 (md_a)
- CTX2: 10-Q MD&A context, filed 2026-04-30 (md_a)
- CTX3: 10-Q MD&A context, filed 2026-04-30 (md_a)
- CTX4: 10-Q MD&A context, filed 2026-04-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-04-30 (md_a)

### JPM-Q01

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: unknown
- Model: openai / unknown
- Tokens: prompt=3385, completion=767, total=4152
- Latency: 6936 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, fallback_slot_incomplete

Answer:

```text
この会社は総収益を源泉にして活動しています。 収益の内訳の詳細はこの資料には示されていません。
```

Sources:

- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)
- CTX1: 10-Q Filing context, filed 2026-05-01 (md_a)

### JPM-Q03

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=3742, completion=803, total=4545
- Latency: 6053 ms
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
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / gpt-5-nano
- Tokens: prompt=3926, completion=718, total=4644
- Latency: 6110 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: context_rewritten, source_gate_applied, q04_previous_answer_driver_candidate_repair

Answer:

```text
前問で挙がっていた売上要因候補は、決済額・処理件数・国際取引量、純利息収入、非利息収入・投資銀行・市場業務、買収影響 です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、決済額・処理件数・国際取引量、純利息収入、非利息収入・投資銀行・市場業務、買収影響 です。
```

Sources:

- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- CTX2: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- CTX1: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- CTX3: 10-Q Segment and revenue context, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)

### JPM-Q06

- Ticker: JPM
- Filing key: v9:0000019617:000162828026029344
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: mda_summary
- Model: openai / gpt-5-nano
- Tokens: prompt=9645, completion=1353, total=10998
- Latency: 10029 ms
- Source count: 9
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, source_gate_applied, language_guard_source_backed_repair

Answer:

```text
前問の利益率要因候補として確認できるのは、営業費用、人件費、販売数量・稼働率、信用損失・引当、税金・評価損益 です。ただし、選択された抜粋だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用、人件費、販売数量・稼働率、信用損失・引当、税金・評価損益 です。
```

Sources:

- CTX2: 10-Q MD&A context, filed 2026-05-01 (md_a)
- S7: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)
- CTX3: 10-Q MD&A context, filed 2026-05-01 (md_a)
- CTX1: 10-Q MD&A context, filed 2026-05-01 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-01 (md_a)
- S5: 10-Q Margin and profitability discussion, filed 2026-05-01 (md_a)

### CAT-Q01

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: evidence_slot
- Fallback user reason: answer_too_metric_only
- Runtime intent: unknown
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 1203 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, source_gate_failed, driver_slots_empty, sector_required_source_missing, business_model_sources_missing, fallback_slot_incomplete, evidence_fallback_used, hard_retrieval_used

Answer:

```text
ただし、この資料だけだと会社固有の売上要因までは追いきれません。次に見るなら、サブスク・利用量・顧客指標、価格実現、販売数量、受注・バックログ、価格とコスト・製造コスト あたりです。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- S12: XBRL 営業利益 (OperatingIncomeLoss) (xbrl_metric)

### CAT-Q03

- Ticker: CAT
- Filing key: v9:0000018230:000001823026000021
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4287, completion=603, total=4890
- Latency: 5080 ms
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
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4456, completion=677, total=5133
- Latency: 5545 ms
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
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: mda_summary
- Model: openai / gpt-5-nano
- Tokens: prompt=6881, completion=751, total=7632
- Latency: 7390 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: source_gate_applied, language_guard_source_backed_repair

Answer:

```text
前問の利益率要因候補として確認できるのは、価格・単価、販売数量・稼働率 です。ただし、選択された抜粋だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、価格・単価、販売数量・稼働率 です。
```

Sources:

- S2: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-05-06 (md_a)
- CTX3: 10-Q MD&A context, filed 2026-05-06 (md_a)
- CTX4: 10-Q MD&A context, filed 2026-05-06 (md_a)
- CTX5: 10-Q MD&A context, filed 2026-05-06 (md_a)
- CTX1: 10-Q MD&A context, filed 2026-05-06 (md_a)
- CTX2: 10-Q MD&A context, filed 2026-05-06 (md_a)

### AVGO-Q01

- Ticker: AVGO
- Filing key: v9:0001730168:000173016826000054
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: unknown
- Model: openai / unknown
- Tokens: prompt=5514, completion=555, total=6069
- Latency: 6464 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, raw_english_excerpt, driver_evidence_fragmentary, source_gate_false_positive, driver_slots_empty, fallback_slot_incomplete

Answer:

```text
Broadcomは顧客との契約に基づく売上で稼いでいます。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S11: XBRL 売上高 comparison (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S12: XBRL 純利益 (ProfitLoss) (xbrl_metric)

### AVGO-Q03

- Ticker: AVGO
- Filing key: v9:0001730168:000173016826000054
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=9062, completion=1325, total=10387
- Latency: 10535 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: model_retry_used, retry_attempted, source_gate_applied, revenue_driver_deterministic_recovery, numeric_alignment_repaired

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
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4349, completion=1083, total=5432
- Latency: 7695 ms
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
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: mda_summary
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 399 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: source_gate_applied, source_gate_failed, driver_slots_empty, sector_required_source_missing, followup_target_empty, missing_followup_target_driver, missing_durability_context, durability_context_missing, durability_context_too_generic, q04_table_heavy_context, q04_driver_evidence_too_generic, fallback_slot_incomplete, hard_retrieval_used

Answer:

```text
提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、販売数量・出荷量、価格・ミックス です。次に見るべき指標は、販売数量・出荷量、価格・ミックス が次期にも続くかどうかです。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)
- S1: 10-Q Revenue driver discussion, filed 2026-06-09 (md_a)

### META-Q01

- Ticker: META
- Filing key: v9:0001326801:000162828026050705
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: unknown
- Model: openai / unknown
- Tokens: prompt=5432, completion=443, total=5875
- Latency: 5097 ms
- Source count: 1
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, fallback_slot_incomplete

Answer:

```text
この会社は顧客との契約に基づく売上高を得ています。
```

Sources:

- S10: XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax) (xbrl_metric)

### META-Q03

- Ticker: META
- Filing key: v9:0001326801:000162828026050705
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4464, completion=432, total=4896
- Latency: 4851 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: retry_blocked:hard_intent_retry_disabled, revenue_drivers_deterministic_repair, revenue_driver_deterministic_recovery

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
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 630 ms
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
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: evidence_slot
- Fallback user reason: revenue_driver_sources_missing
- Runtime intent: mda_summary
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 411 ms
- Source count: 4
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, source_gate_failed, missing_durability_context, durability_context_missing, driver_supported_but_durability_unclear, durability_context_too_generic, evidence_fallback_used, hard_retrieval_used

Answer:

```text
前問の要因は、為替影響 / 広告売上です。継続性の判断には、経営陣による業績説明、セグメント実績、売上要因の説明、利益率・採算性 の追加確認が必要です。
```

Sources:

- CTX1: 10-Q MD&A context, filed 2026-07-30 (md_a)
- S3: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)
- S4: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-07-30 (md_a)

### BAC-Q01

- Ticker: BAC
- Filing key: v9:0000070858:000007085826000394
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: unknown
- Model: openai / unknown
- Tokens: prompt=4192, completion=561, total=4753
- Latency: 4373 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, raw_english_excerpt, driver_evidence_fragmentary, source_gate_false_positive, driver_slots_empty, fallback_slot_incomplete

Answer:

```text
選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。
```

Sources:

- S9: XBRL 売上高 (Revenues) (xbrl_metric)
- S10: XBRL 純利益 (NetIncomeLoss) (xbrl_metric)

### BAC-Q03

- Ticker: BAC
- Filing key: v9:0000070858:000007085826000394
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: openai / unknown
- Tokens: prompt=4882, completion=1792, total=6674
- Latency: 14797 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: retry_blocked:hard_intent_retry_disabled, revenue_drivers_deterministic_repair

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
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=5051, completion=1347, total=6398
- Latency: 9790 ms
- Source count: 2
- Source IDs valid: true
- Answer quality flags: context_rewritten, retry_blocked:hard_intent_retry_disabled, source_gate_applied, missing_durability_context, durability_context_missing, driver_supported_but_durability_unclear, durability_context_too_generic, q04_previous_answer_driver_candidate_repair

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
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: openai
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: mda_summary
- Model: openai / gpt-5-nano
- Tokens: prompt=6159, completion=1268, total=7427
- Latency: 11055 ms
- Source count: 7
- Source IDs valid: true
- Answer quality flags: source_gate_applied, missing_durability_context, durability_context_missing, driver_supported_but_durability_unclear, durability_context_too_generic, language_guard_source_backed_repair

Answer:

```text
前問の利益率要因候補として確認できるのは、営業費用、人件費 です。ただし、選択された抜粋だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用、人件費 です。
```

Sources:

- CTX3: 10-Q MD&A context, filed 2026-07-31 (md_a)
- CTX2: 10-Q MD&A context, filed 2026-07-31 (md_a)
- S2: 10-Q Revenue driver discussion, filed 2026-07-31 (md_a)
- CTX1: 10-Q MD&A context, filed 2026-07-31 (md_a)
- CTX4: 10-Q MD&A context, filed 2026-07-31 (md_a)
- CTX5: 10-Q MD&A context, filed 2026-07-31 (md_a)
- S1: 10-Q Revenue driver discussion, filed 2026-07-31 (md_a)

### MA-Q01

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: この会社ってなにで稼いでんの？
- Intent: business_model
- Response path: fallback
- Fallback reason: low_quality_answer
- Fallback kind: low_quality
- Fallback user reason: answer_too_metric_only
- Runtime intent: unknown
- Model: openai / unknown
- Tokens: prompt=5174, completion=555, total=5729
- Latency: 4552 ms
- Source count: 3
- Source IDs valid: true
- Answer quality flags: fallback_path, fallback:low_quality_answer, source_gate_applied, sector_required_source_missing, fallback_slot_incomplete, hard_source_asset_missing_segment_results

Answer:

```text
この会社は決済サービスを提供して稼いでいます。
```

Sources:

- S10: XBRL 売上高 (Revenues) (xbrl_metric)
- S11: XBRL 純利益 (ProfitLoss) (xbrl_metric)
- CTX1: 10-Q Filing context, filed 2026-07-30 (md_a)

### MA-Q03

- Ticker: MA
- Filing key: v9:0001141391:000114139126000083
- Question: 売上のびた理由って何？
- Intent: revenue_driver
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 301 ms
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
- Question: それって今後も続く感じ？
- Intent: driver_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: yoy_change
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 306 ms
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
- Question: それ一時的なやつ？それともずっとこう？
- Intent: margin_durability_followup
- Response path: deterministic
- Fallback reason: none
- Fallback kind: none
- Fallback user reason: none
- Runtime intent: mda_summary
- Model: unknown / unknown
- Tokens: prompt=n/a, completion=n/a, total=n/a
- Latency: 319 ms
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
