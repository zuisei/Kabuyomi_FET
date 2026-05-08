# Kabuyomi v1.1 Q06-5 Human Review Packet

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

Source artifact:

- `workers/testbench/runs/2026-05-06-v1-1-q06-4-q05-q06.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-q06-4-q05-q06-summary.json`
- `docs/quality/V1_1_Q06_4_MARGIN_SOURCE_PACK_REPORT.md`

Production deployment: not run.

Test Worker deployment: not run in this phase.

Runtime code changes: none.

## 1. Executive Summary

Q06-5 is a human review packet for `margin_durability_followup`.

Q06-4 produced:

- Q06 OpenAI: 2/5
- Q06 fallback: 3/5
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- malformed visible currency: 0
- infra contaminated: false

Review conclusion:

- JPM-Q06 is acceptable.
- AAPL-Q06, XOM-Q06, and WMT-Q06 are acceptable safe fallbacks.
- CAT-Q06 is safe enough to review, but needs wording/source scrutiny before being accepted as final quality.

Overall recommendation: `NEEDS WORDING TWEAK`

## 2. Overall Q06 Verdict

Q06 is not blocked by critical safety failures.

The current Q06 behavior is conservative and source-safe:

- It does not answer AAPL/XOM/WMT when selected evidence is not margin-specific enough.
- It preserves JPM's bank profitability answer without investment advice or future prediction.
- It moves CAT to OpenAI only after source-gate evidence improves, but the answer still blends revenue-driver language with margin durability framing.

The human review decision should focus on whether CAT-Q06 can be accepted with wording cleanup, or whether the CAT path should be tightened before a Minimal Core rerun.

Recommended verdict: `NEEDS WORDING TWEAK`

## 3. Per-Ticker Review Table

| Case | Q06 path | Fallback | sourceIdsValid | rawEnglishInAnswer | rawEnglishSurfaced | Proposed verdict | Human review question |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AAPL-Q06 | fallback | `evidence_slot` / `low_quality_answer` | true | 0 | 0 | ACCEPT AS SAFE FALLBACK | Is the safe fallback acceptable while product/services gross-margin evidence is still weak? |
| JPM-Q06 | openai | none | true | 0 | 0 | ACCEPT | Does the answer remain cautious enough around NII/NIR, deposit margin compression, expenses, and rate sensitivity? |
| XOM-Q06 | fallback | `evidence_slot` / `low_quality_answer` | true | 0 | 0 | ACCEPT AS SAFE FALLBACK | Is fallback acceptable because current-period refining/chemical/upstream/downstream margin evidence is still absent? |
| CAT-Q06 | openai | none | true | 0 | 0 | NEEDS WORDING TWEAK | Does the answer overmix revenue drivers with margin durability, and should English terms be normalized? |
| WMT-Q06 | fallback | `evidence_slot` / `low_quality_answer` | true | 0 | 0 | ACCEPT AS SAFE FALLBACK | Is fallback acceptable because selected evidence remains revenue/eCommerce-only rather than retail margin evidence? |

## 4. Detailed Per-Ticker Notes

### AAPL-Q06

Final Q05 answer:

> 売上高は前年度比で増加、営業利益は増加、純利益は増加しています。営業利益率の直接の数値は本文内に明示されていませんが、売上総利益に対する影響を示す要因として、通貨ヘッジや関税リスクへの対応、供給網・為替の影響を管理していることが記載されています。
>
> 要因としては、製品別の売上構成変化（iPhoneの堅調な伸び、Macの減速、Servicesの成長）と費用項目の管理の結果として、利益率の変動を招く可能性がある点に留意が必要です。

Final Q06 answer:

> 確認できているのは、純利益が421億ドル、前年同期比15.9%という点です。ただし、利益率変化の具体的な要因は十分に特定できていません。
>
> そのため、選択された資料だけで一時要因か構造的変化かは分類しません。
>
> 判断には、product 売上説明、services 売上説明、geographic 売上説明、product revenue、services revenue、product launch or channel inventory discussion の説明が必要です。

Q06 response path:

- `fallback`

Q06 fallback:

- kind: `evidence_slot`
- reason: `low_quality_answer`

Selected source families:

- `margin_discussion`
- `xbrl_metric`

Selected source excerpts:

- Tariff and reciprocal-tariff risk context starting in the second quarter of 2025.
- FX hedging context that mentions gross margins and inventory purchases.
- Forward-looking statement boilerplate.
- XBRL revenue and net income metrics.

Source-gate evidence slots:

- Confirmed metric movement: net income `421億ドル`, YoY `15.9%`.
- Segment/business signals: tariff context.
- `marginDriverCount`: 0.
- Unknown: margin driver not sufficiently identified.

Source-gate failure labels:

- `margin_driver_slots_empty`
- `sector_required_source_missing`
- `missing_margin_driver_evidence`
- `source_gate_failed`
- `fallback_slot_incomplete`

Finalizer guard labels:

- `source_insufficient`

Low-quality reason:

- none on Q06 row.

Source IDs / raw English:

- `sourceIdsValid`: true
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0

Human review question:

- Is the fallback useful and honest enough, or should AAPL product/services gross-margin source assets be expanded before Minimal Core rerun?

Proposed verdict:

- `ACCEPT AS SAFE FALLBACK`

Reason:

- The answer correctly refuses to classify temporary vs structural margin change without a concrete margin driver.
- No hallucinated margin driver or overconfident structural claim is visible.

### JPM-Q06

Final Q05 answer:

> 売上高: 1824.5億ドル、営業利益: 公表値なし、純利益: 570.5億ドル. 営業利益率: 公表値未提供。
>
> 利益率の改善/悪化の要因として、非金利費用が前年同期比で増加（人件費・関連費用の上昇、技術投資・販促費の増加、オフィス関連費用の増加）、一方で非金利収益が増加しており、NIIは市場収益の拡大やクレジットカード関連のボリューム拡大などが寄与。結果として純利益は前年から減少（-2.4%）している。
>
> 注意点として、具体的な営業利益率の数値は開示されていない点がある。

Final Q06 answer:

> 売上高・営業利益・純利益: 売上高は2025年通期で1824.5億ドル、純利益は57.1億ドル。営業利益率は文中で直接開示されていませんが、純利益は前年に比べ若干減少しています。
>
> 営業利益率・純利益率: 純利益は前年同期比で約-2.43%の減少。改善/悪化の要因: 利益率の要因として、ネット金利収益はMarketsの寄与増とカードサービスの回転残高増などで拡大した一方、預金金利の圧力と低金利環境の影響により金利純益が抑制されている。
>
> 非金利収益は増加要因が多く見られるが、非金利費用は報酬・人員増、ブローカレッジ費用、オペ項目の増加等で伸びている。コストの増加要因としては人件費・技術投資・販促費・占有費の上昇が挙げられる。
>
> 注意点: 金利環境の変化、資本市場の動向、First Republic関連の影響等の不確定要素や、セキュリティリスク等の経営陣による業績説明に言及されている項目も留意点として挙げられる。

Q06 response path:

- `openai`

Q06 fallback:

- none

Selected source families:

- `margin_discussion`
- `bank_profitability_discussion`
- `xbrl_metric`

Selected source excerpts:

- NII increased 3%, driven by Markets NII, Card Services revolving balances, wholesale deposit balances, and investment securities activity; offset by deposit margin compression and lower rates.
- Noninterest expense increased 4%, driven by compensation, brokerage/distribution fees, auto lease depreciation, technology, marketing, and occupancy.
- Revenue XBRL metric.

Source-gate evidence slots:

- Confirmed metric movement: net income `570.5億ドル`, YoY `-2.4%`.
- Segment/business signals: NII/deposit margin and noninterest expense excerpts.
- `marginDriverCount`: 1.

Source-gate failure labels:

- none

Finalizer guard labels:

- none

Low-quality reason:

- none

Source IDs / raw English:

- `sourceIdsValid`: true
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0

Human review question:

- Does the answer stay cautious enough, or should it more explicitly say "this filing alone does not prove temporary vs structural"?

Proposed verdict:

- `ACCEPT`

Reason:

- The answer uses source-backed bank profitability evidence.
- It does not predict future JPM performance, give investment advice, or assert structural persistence.
- Minor wording could be made more compact, but no safety issue is apparent.

### XOM-Q06

Final Q05 answer:

> 売上高: 3322.4億ドル、純利益: 288.4億ドル。営業利益率は資料に記載の数値から読み取る必要があります。
>
> 前期比で売上は約5%減少、純利益は約14%減少。改善/悪化の要因として、価格変動や需給環境の変化、コスト構造の影響、資本投資の減少や減価償却の影響が考えられますが、具体的な要因は報告書の関連セクションを参照してください。
>
> 要因の要点としては、長期的な資本集約型プロジェクトの影響や法規制・市場環境の不確実性が挙げられます。

Final Q06 answer:

> 確認できているのは、純利益が288.4億ドル、前年同期比-14.4%という点です。ただし、利益率変化の具体的な要因は十分に特定できていません。
>
> そのため、選択された資料だけで一時要因か構造的変化かは分類しません。
>
> 判断には、セグメント実績、refining or chemical margin discussion、commodity price discussion、production volume discussion、commodity prices、production volume の説明が必要です。

Q06 response path:

- `fallback`

Q06 fallback:

- kind: `evidence_slot`
- reason: `low_quality_answer`

Selected source families:

- `energy_margin_discussion`
- `xbrl_metric`
- `margin_discussion`

Selected source excerpts:

- PP&E / depreciation and depletion accounting context.
- Revenue and net income XBRL metrics.
- Sanctions / restricted business risk context.
- Long-term capital-intensive project context.

Source-gate evidence slots:

- Confirmed metric movement: net income `288.4億ドル`, YoY `-14.4%`.
- Segment/business signals: PP&E/depletion and sanctions/risk context.
- `marginDriverCount`: 0.
- Unknown: margin driver not sufficiently identified.

Source-gate failure labels:

- `margin_driver_slots_empty`
- `sector_required_source_missing`
- `missing_margin_driver_evidence`
- `missing_margin_durability_context`
- `source_gate_failed`
- `fallback_slot_incomplete`

Finalizer guard labels:

- `source_insufficient`

Low-quality reason:

- none on Q06 row.

Source IDs / raw English:

- `sourceIdsValid`: true
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0

Human review question:

- Is the fallback acceptable, or does XOM require a deeper current-period energy margin asset extraction pass?

Proposed verdict:

- `ACCEPT AS SAFE FALLBACK`

Reason:

- The fallback is honest: selected sources do not show concrete refining/chemical/upstream/downstream margin durability evidence.
- No energy margin driver is hallucinated.

### CAT-Q06

Final Q05 answer:

> 営業利益は 111.5億ドル で、前年同期比 14.7%減 です。 本文では、販管費・開発費などの営業費用が利益率や利益の動きを見る材料として出ています。 利益の動きは、費用・評価損益・税金の内訳確認が必要です。

Final Q06 answer:

> 売上高は67.589億ドル、営業利益は111.51億ドル、純利益は88.82百万ドル。営業利益率と純利益率は、2025年実績で前期比▲14.7%、▲17.7%の変化を示している。
>
> 要因としては、販売量の増加と価格 realizationの不利がある一方、製造コストの不利や関税の影響が押し下げ要因となっている。costの要因は、短期的な影響を含む可能性があり、今後の需要動向や原価の動向次第で継続性が変わる点に注意が必要。
>
> 継続性の観点では、販売量の増加が継続するか、価格実現が改善するかが鍵。現状の資料だけでは、コスト要因が一時的か継続的かを確定できない。

Q06 response path:

- `openai`

Q06 fallback:

- none

Selected source families:

- `cost_discussion`
- `industrial_margin_discussion`
- `xbrl_metric`
- `margin_discussion`

Selected source excerpts:

- Industrial customer demand and purchase-price / owning-cost context.
- Total sales and revenues increased 4%; increase reflected higher sales volume, partially offset by unfavorable price realization.
- Profit per share and profit comparison.
- Revenue, net income, and operating income XBRL metrics.
- Construction Industries product list context.

Source-gate evidence slots:

- Confirmed metric movement: net income `88.8億ドル`, YoY `-17.7%`.
- Segment/business signals: industrial demand/product context.
- `marginDriverCount`: 1.

Source-gate failure labels:

- none

Finalizer guard labels:

- none

Low-quality reason:

- none on Q06 row.

Source IDs / raw English:

- `sourceIdsValid`: true
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0

Human review question:

- Does the answer over-rely on sales volume / price realization revenue context, and should it be rewritten to emphasize margin/profitability uncertainty more directly?

Proposed verdict:

- `NEEDS WORDING TWEAK`

Reason:

- The answer is cautious and says the filing does not prove temporary vs continuing cost factors.
- However, it mixes revenue growth wording into a margin-durability answer.
- It contains awkward English terms (`price realization`, `cost`) in otherwise Japanese text. These are allowed financial terms, but the answer would be cleaner as `価格実現` and `コスト`.
- It also says net income is `88.82百万ドル`, while the metric value indicates `88.82億ドル`; this is a user-visible unit wording risk and should be fixed before accepting CAT-Q06.

### WMT-Q06

Final Q05 answer:

> 営業利益は 298.3億ドル で、前年同期比 1.6%増 です。 利益率の方向は確認できますが、改善/悪化の具体的な要因は十分に特定できません。判断には、コスト、mix、pricing、営業費用、provision、restructuring、impairment、segment margin の説明が必要です。

Final Q06 answer:

> 確認できているのは、純利益が218.9億ドル、前年同期比12.6%という点です。ただし、利益率変化の具体的な要因は十分に特定できていません。
>
> そのため、選択された資料だけで一時要因か構造的変化かは分類しません。
>
> 判断には、セグメント実績、comparable sales discussion、traffic and ticket discussion、eCommerce discussion、comparable sales、membership or advertising discussion の説明が必要です。

Q06 response path:

- `fallback`

Q06 fallback:

- kind: `evidence_slot`
- reason: `low_quality_answer`

Selected source families:

- `cost_discussion`
- `xbrl_metric`
- `margin_discussion`

Selected source excerpts:

- Comparable sales increased, driven by unit volumes and transactions.
- Revenue, net income, and operating income XBRL metrics.
- Omnichannel strategy and store/eCommerce context.
- Private-brand merchandise list.

Source-gate evidence slots:

- Confirmed metric movement: net income `218.9億ドル`, YoY `12.6%`.
- Segment/business signals: comparable-sales and private-brand/omnichannel context.
- `marginDriverCount`: 0.
- Unknown: margin driver not sufficiently identified.

Source-gate failure labels:

- `margin_driver_slots_empty`
- `sector_required_source_missing`
- `missing_margin_driver_evidence`
- `q06_margin_context_revenue_only`
- `source_gate_failed`
- `fallback_slot_incomplete`

Finalizer guard labels:

- `source_insufficient`

Low-quality reason:

- none on Q06 row.

Source IDs / raw English:

- `sourceIdsValid`: true
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0

Human review question:

- Is this safe fallback acceptable, or should WMT retail margin assets be expanded before Minimal Core rerun?

Proposed verdict:

- `ACCEPT AS SAFE FALLBACK`

Reason:

- The answer does not treat comparable-sales/eCommerce revenue context as margin evidence.
- It remains conservative and source-safe.
- It is useful enough as a fallback, though source-pack work would be needed for a stronger answer.

## 5. Critical Failure Check

Observed critical failures:

- Wrong ticker: not observed.
- Wrong period: not observed.
- Material numeric error: one CAT wording risk noted (`88.82百万ドル` vs expected `88.82億ドル` scale from metric display).
- Sign error: not observed.
- `source_id_invalid`: not observed.
- Raw English in final answer: not observed by benchmark summary.
- Malformed user-visible currency: not observed by summary, but CAT unit wording should be reviewed.
- Unsupported investment advice: not observed.
- Buy/sell recommendation: not observed.
- Price target: not observed.
- Stock forecast: not observed.
- Hallucinated margin driver: not observed in fallback rows; CAT wording is source-adjacent but somewhat revenue-led.
- Hidden fallback hallucination: not observed.
- Overconfident structural/persistent margin claim: not observed.

## 6. Wording Risks

### CAT-Q06

Risk level: medium.

Issues:

- Uses `price realization` and `cost` directly in Japanese answer.
- Mixes sales volume / price realization revenue language into a Q06 margin-durability answer.
- Says net income is `88.82百万ドル`, which appears inconsistent with the benchmark metric text `純利益: 8882000000 USD`.

Suggested safer wording:

> このfilingだけでは、利益率低下が一時要因か構造的変化かは断定できません。確認できる材料は、価格実現、販売量、製造コスト、関税影響などですが、売上要因と利益率要因が混在しています。継続性を見るには、製造コスト、価格実現、原材料・関税、dealer inventory、セグメント営業利益の次回推移を確認する必要があります。

### JPM-Q06

Risk level: low.

The answer is acceptable, but could be more concise and could state more explicitly:

> このfilingだけでは構造的変化とは断定しません。

### Fallback Rows

Risk level: low.

AAPL/XOM/WMT fallback answers are conservative and avoid overclaiming. Some fallback source-type wording is still technical (`product revenue discussion`, `refining or chemical margin discussion`), but this is not a critical issue.

## 7. Source/Fallback Risks

### AAPL

- Product/services gross-margin evidence is still weak.
- Selected source pack includes tariff/FX/gross-margin hedging context, but not enough current-period margin-driver evidence.
- Safe fallback is acceptable, but source work is needed for a stronger answer.

### XOM

- Selected context remains PP&E/depletion/risk/project-heavy.
- Current-period refining margins, chemical margins, upstream/downstream earnings, and production-cost context are not exposed strongly enough.
- Safe fallback is acceptable.

### WMT

- Selected context remains comparable-sales/eCommerce/omnichannel-heavy.
- Retail margin evidence such as gross margin rate, markdowns, shrink, inventory, fulfillment costs, wage/labor, and operating expense leverage is still missing.
- Safe fallback is acceptable.

### CAT

- Source gate passed, but selected evidence still includes revenue/sales volume context.
- The answer is cautious, but wording should be tightened before accepting it as release-candidate quality.

### JPM

- Source pack is adequate for human review.
- No immediate source-pack blocker.

## 8. Human Reviewer Checklist

Use this checklist before allowing a Minimal Core rerun:

- Confirm CAT-Q06 unit wording does not contain a real numeric-scale error.
- Decide whether CAT-Q06 should be accepted after wording cleanup or forced to fallback until stronger margin-only sources are available.
- Confirm JPM-Q06 does not imply future NII/NIR or margin direction.
- Confirm AAPL-Q06 fallback is acceptable for v1.1, or request more product/services gross-margin source extraction.
- Confirm XOM-Q06 fallback is acceptable for v1.1, or request more current-period energy margin source extraction.
- Confirm WMT-Q06 fallback is acceptable for v1.1, or request more retail margin source extraction.
- Confirm `sourceIdsValid=false`, raw English, visible malformed currency, advice, and stock forecast remain 0 in the next rerun.

## 9. Recommendation

Recommendation: `NEEDS WORDING TWEAK`

Reason:

- There are no broad safety regressions.
- AAPL/XOM/WMT are acceptable safe fallbacks.
- JPM is acceptable.
- CAT-Q06 is close, but the wording risk around revenue-vs-margin framing and the visible `百万ドル` unit issue should be cleaned up before declaring Q06 ready for Minimal Core rerun.

Next task should be a narrow CAT-Q06 wording/finalizer review, not broader retrieval work.
