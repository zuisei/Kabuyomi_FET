# Kabuyomi v1.1 Phase 3K Q04 Human Review Packet

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

Primary artifact:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3j-q03-q04-r5.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3j-q03-q04-r5-summary.json`

## 1. Executive Summary

This packet reviews Q04 `driver_durability_followup` before moving to Q06.

Final Phase 3J r5 status:

- Rows: 10
- Q04 rows: 5
- Provider errors: 0
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- User-visible malformed currency: 0 observed

High-level finding:

- AAPL-Q04 and XOM-Q04 are acceptable safe fallbacks.
- CAT-Q04 is acceptable for test-only review.
- WMT-Q04 is grounded but wording may be slightly too strong around durability.
- JPM-Q04 is safe but likely under-answering; source gate passes, yet final output falls back with `durability_missing_assessment`.

## 2. Overall Q04 Verdict

Recommendation: `NEEDS WORDING TWEAK`

Rationale:

- No critical safety failure was found in the final r5 Q04 outputs.
- The remaining issues are quality/wording issues, not source-ID, raw-English, malformed-currency, ticker, period, or investment-advice failures.
- WMT-Q04 should be softened before declaring Q04 fully ready.
- JPM-Q04 should be reviewed as either acceptable conservative fallback or a post-gate answer-shape issue.

Q06 should not start as a quality milestone until a human accepts these Q04 tradeoffs or chooses the WMT/JPM follow-up work.

## 3. Per-Ticker Review Table

| Case | Response path | Fallback | sourceIdsValid | Guard labels | Proposed verdict | Human review question |
|---|---:|---|---:|---|---|---|
| AAPL-Q04 | fallback | `evidence_slot` / `low_quality_answer` | true | `source_insufficient` | ACCEPT AS SAFE FALLBACK | Is it acceptable that AAPL-Q04 still cannot recover a concrete supported driver from the selected table-heavy/tariff context? |
| JPM-Q04 | fallback | `evidence_slot` / `low_quality_answer` | true | `source_insufficient` | NEEDS SOURCE/PACK WORK | Should the NII/NIR/deposit/Markets evidence support a cautious durability answer instead of fallback? |
| XOM-Q04 | fallback | `language_guard_fallback` / `low_quality_answer` | true | `english_answer_leak`, `raw_english_excerpt`, `answer_rewritten_to_japanese_fallback` | ACCEPT AS SAFE FALLBACK | Is fallback correct because XOM still lacks current-period, company-specific energy driver durability evidence? |
| CAT-Q04 | openai | none | true | none | ACCEPT | Is the sales volume / price realization / dealer inventory answer cautious enough? |
| WMT-Q04 | openai | none | true | none | NEEDS WORDING TWEAK | Is "eCommerceの売上寄与が継続的に高まり" too strong? |

## 4. Detailed Per-Ticker Notes

### AAPL-Q04

Final answer:

> 前問の具体的な要因が十分に特定できていません。そのため、選択された資料だけで一時要因か継続要因かは分類しません。判断には、経営陣による業績説明、product revenue、services revenue、geographic revenue、product launches、channel inventory の追加確認が必要です。

Runtime fields:

- Response path: `fallback`
- Fallback kind: `evidence_slot`
- Fallback reason: `low_quality_answer`
- Source gate passed: `false`
- Finalizer guard labels: `source_insufficient`
- Low quality reason: none
- `sourceIdsValid`: true
- Source families: `revenue_note`, `segment_revenue`, `mda`

Selected source excerpts:

- Tariff / gross margin uncertainty excerpt.
- Gross margin products/services table excerpt.
- Operating expenses / R&D cost excerpt.
- Repeated generic Item 2 forward-looking statement excerpts.

Source gate evidence slots:

- Confirmed metric movement: revenue `1,437.6億ドル`, comparison `1,243億ドル`, YoY `15.7%`.
- Driver slot incorrectly points to table/gross-margin context.
- Failure labels: `q04_table_heavy_context`, `q04_driver_evidence_too_generic`, `durability_context_missing`, `q04_durability_evidence_too_generic`, `source_gate_failed`.

Assessment:

- This is an honest fallback.
- It does not hallucinate an AAPL driver.
- It correctly avoids using weak table-heavy context for durability.

Human review question:

- Is the fallback useful enough, or should AAPL require more specific Services/iPhone/revenue driver source assets before Q04 is accepted?

Proposed verdict: `ACCEPT AS SAFE FALLBACK`

### JPM-Q04

Final answer:

> 純利益は 570.5億ドル で、前年同期比 2.4%減 です。 全社売上の増減は確認できますが、セグメント・地域別の強弱はこの資料では十分に分解できません。確認すべき箇所は、セグメント実績、地域別売上、製品・カテゴリ別売上、業種固有のセグメントKPIです。

Runtime fields:

- Response path: `fallback`
- Fallback kind: `evidence_slot`
- Fallback reason: `low_quality_answer`
- Source gate passed: `true`
- Finalizer guard labels: `source_insufficient`
- Low quality reason: `durability_missing_assessment`
- `sourceIdsValid`: true
- Source families: `revenue_discussion`, `xbrl_metric`

Selected source excerpts:

- NII of `$95.4 billion`, up 3%, driven by Markets NII, Card Services revolving balances, wholesale deposit balances, and investment securities activity; offset by deposit margin compression and lower rates.
- NIR of `$87.0 billion`, up 2%, reflecting Markets noninterest revenue, asset management fees, auto operating lease income, Payments fees, investment banking fees, and First Republic-related gain.
- Fixed Income Markets revenue details.
- Revenue and net income XBRL metrics.

Source gate evidence slots:

- Confirmed metric movement: revenue `1,824.5億ドル`, comparison `1,775.6億ドル`, YoY `2.8%`.
- Company driver: bank durability slot from NII/NIR driver evidence.
- Failure labels: none.

Assessment:

- The final answer is safe but under-answers Q04.
- It drifts to net income and segment-breakdown insufficiency instead of answering durability of the recovered NII/NIR drivers.
- There appears to be enough source context for a cautious answer:
  - NII: some factors may persist, but deposit margin compression / lower rates add uncertainty.
  - NIR: Markets, fees, First Republic-related gain may include more cyclical or one-time elements.

Human review question:

- Should JPM-Q04 be accepted as a conservative fallback, or should Q04 post-gate synthesis be fixed to produce a cautious durability answer from NII/NIR context?

Proposed verdict: `NEEDS SOURCE/PACK WORK`

### XOM-Q04

Final answer:

> 前問の具体的な要因を十分に特定できていないため、この資料だけで一時要因か継続要因かは分類しません。判断には、経営陣による業績説明、セグメント実績、売上説明、業種固有KPI の継続確認が必要です。

Runtime fields:

- Response path: `fallback`
- Fallback kind: `language_guard_fallback`
- Fallback reason: `low_quality_answer`
- Source gate passed: `false`
- Finalizer guard labels: `english_answer_leak`, `raw_english_excerpt`, `final_answer_language_violation`, `answer_rewritten_to_japanese_fallback`
- Low quality reason: none
- `sourceIdsValid`: true
- Source families: `segment_revenue`, `xbrl_metric`

Selected source excerpts:

- Broad energy context: crude prices remained within historical range; robust demand moved natural gas price above range; long-term prices driven by market supply/demand.
- Upstream PP&E / depreciation and depletion note.
- Revenue and net income XBRL metrics.

Source gate evidence slots:

- Confirmed metric movement: revenue `3,322.4億ドル`, comparison `3,495.9億ドル`, YoY `-5.0%`.
- Energy driver slots exist, but evidence is broad and table-heavy.
- Failure labels: `q04_table_heavy_context`, `source_gate_failed`.

Assessment:

- Safe fallback is correct.
- It avoids turning broad long-term commodity commentary into a current-period durability conclusion.
- The language guard rewrote unsafe English path into Japanese fallback; final user-visible answer is Japanese.

Human review question:

- Should XOM remain fallback until first-class current-period energy result/outlook assets exist?

Proposed verdict: `ACCEPT AS SAFE FALLBACK`

### CAT-Q04

Final answer:

> 一番大きい変化: 売上高の YoY 増加は約4.3%。主要数値: 2025年売上高は 675.9億ドル、2024年は 648.1億ドル。
>
> 本文で説明されている要因: 需要拡大による販売量の増加が主因で、機械のエンドユーザーへの販売増加とディーラー在庫の変動が影響。追加確認が必要な点: 価格実現の不利寄与があり、ディーラー在庫の期初期動向や今後の在庫動向の持続性について更なる情報が必要。

Runtime fields:

- Response path: `openai`
- Fallback kind: `none`
- Fallback reason: none
- Source gate passed: `true`
- Finalizer guard labels: none
- Low quality reason: none
- `sourceIdsValid`: true
- Source families: `revenue_discussion`, `segment_revenue`, `xbrl_metric`

Selected source excerpts:

- Total sales and revenues increased 4%, reflecting higher sales volume, partially offset by unfavorable price realization.
- Sales volume driven by higher equipment sales to end users.
- First quarter 2026 expectation: stronger sales and revenues due to higher sales volume and favorable price realization.
- Machine dealer inventory expected to increase.
- Revenue XBRL metric.

Source gate evidence slots:

- Confirmed metric movement: revenue `675.9億ドル`, comparison `648.1億ドル`, YoY `4.3%`.
- Industrial durability driver slots for sales volume, price realization, and dealer inventory.
- Failure labels: none.

Assessment:

- Grounded and cautious enough.
- It does not assert that the driver will definitely continue.
- It explicitly says dealer inventory and price realization should be watched.

Human review question:

- Is "需要拡大" too broad compared with the source wording, or is it acceptable shorthand for higher equipment sales to end users?

Proposed verdict: `ACCEPT`

### WMT-Q04

Final answer:

> 一番大きい変化: Walmart US eCommerceの売上寄与が継続的に高まり、2026年度の comparable sales に約4.3%の寄与、2025年度には約2.9%の寄与。主要数値: 売上高は7131.6億ドル、YoY 4.7%。
>
> 本文要因: eCommerceは店舗受け取り・配達を通じたOmnichannel強化と会員のエンゲージメント向上に支えられ、ユニットボリュームと取引の成長が全体を押し上げた。fuel価格の下落による影響で一部抑制も発生。
>
> 追加確認が必要な点: eCommerce寄与の持続性が今後も同様に維持されるか、燃料価格変動がどの程度継続的な影響を与えるか、セグメント別のトレンドと今後の販促施策の影響を追跡する必要がある。

Runtime fields:

- Response path: `openai`
- Fallback kind: `none`
- Fallback reason: none
- Source gate passed: `true`
- Finalizer guard labels: none
- Low quality reason: none
- `sourceIdsValid`: true
- Source families: `segment_revenue`, `revenue_discussion`, `xbrl_metric`

Selected source excerpts:

- Comparable sales driven by transactions and unit volumes, with strength in grocery and health/wellness.
- Walmart US eCommerce contributed approximately 4.3% and 2.9% to comparable sales.
- Growth reflects continued strength in customer and Walmart+ member engagement with omnichannel offerings.
- Comparable sales driven by average ticket and transactions, unit volumes, and merchandise category strength.
- Revenue and net income XBRL metrics.

Source gate evidence slots:

- Confirmed metric movement: revenue `7,131.6億ドル`, comparison `6,809.9億ドル`, YoY `4.7%`.
- Retail durability driver slots for comparable sales, transactions/unit volume, eCommerce, membership engagement.
- Failure labels: none.

Assessment:

- Grounded source use is good.
- No raw English or malformed currency surfaced.
- Main wording risk: "eCommerceの売上寄与が継続的に高まり" may overstate persistence.
- The last paragraph partially mitigates this by saying sustained contribution must be tracked.

Suggested safer wording:

> eCommerce や会員エンゲージメントは継続要因になり得ますが、このfilingだけでは継続性は断定できません。次に、eCommerce寄与率、会員エンゲージメント、取引数・単価、fuel価格影響を確認する必要があります。

Human review question:

- Should WMT-Q04 be accepted as source-backed, or should the finalizer soften "継続的に高まり" before Q04 is considered ready?

Proposed verdict: `NEEDS WORDING TWEAK`

## 5. Critical Failure Check

Final Phase 3J r5 Q04 rows:

- Wrong ticker: not observed
- Wrong period: not observed
- Material numeric error: not observed as a critical failure
- Sign error: not observed
- Unsupported investment advice: not observed
- Buy/sell recommendation: not observed
- Price target: not observed
- Stock forecast: not observed
- Hallucinated driver: not observed as critical; WMT wording is a wording risk, not a clear hallucination
- Hidden fallback hallucination: not observed
- `source_id_invalid`: not observed
- Raw English in final answer: not observed
- Malformed user-visible currency: not observed

## 6. Wording Risks

Primary risk:

- WMT-Q04 says "eCommerceの売上寄与が継続的に高まり".
- This is directionally supported by two years of eCommerce contribution and "continued strength" wording, but it should be softened because Q04 asks durability and the filing does not prove future persistence.

Secondary risk:

- CAT-Q04 uses "需要拡大". The selected excerpts more specifically say higher sales volume and higher equipment sales to end users. Human reviewer should decide whether "需要拡大" is acceptable or should be narrowed to "販売量の増加".

## 7. Source / Fallback Risks

JPM-Q04:

- Source gate passes with credible NII/NIR context, but answer falls back with `durability_missing_assessment`.
- This is probably post-gate answer-shape/finalizer variability.
- It is safe, but may be overly conservative.

AAPL-Q04:

- Fallback is safe.
- Still lacks clean driver handoff/source context for Services/iPhone/product/geography durability.

XOM-Q04:

- Fallback is safe.
- Needs better current-period energy source assets if a non-fallback answer is desired.

## 8. Human Reviewer Checklist

For each Q04 row, reviewer should mark:

- Does the answer correctly reference the prior Q03 driver?
- Does it avoid unsupported persistence claims?
- Does it separate temporary, potentially durable, and uncertain factors?
- Is the fallback honest and useful where fallback occurs?
- Are selected source excerpts sufficient for the final answer?
- Are all numeric/currency values acceptable?
- Is there any raw English user-visible leakage?
- Is any answer too generic for the ticker?

Recommended human decisions:

- AAPL-Q04: accept safe fallback, or require AAPL source asset work.
- JPM-Q04: decide whether safe fallback is acceptable, or require post-gate Q04 synthesis fix.
- XOM-Q04: accept safe fallback until energy assets improve.
- CAT-Q04: accept.
- WMT-Q04: request wording tweak unless reviewer accepts current phrasing.

## 9. Recommendation

`NEEDS WORDING TWEAK`

Minimum before `READY FOR Q06 PHASE`:

- Human reviewer accepts or edits WMT-Q04 durability wording.
- Human reviewer decides whether JPM-Q04 safe fallback is acceptable or should become a cautious source-backed answer.

Production remains out of scope and was not deployed.
