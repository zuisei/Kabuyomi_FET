# Failure Labels

Use labels to explain why an answer failed. Prefer the smallest set that explains the root cause.

## Retrieval / Source Selection

| Label | Definition |
| --- | --- |
| `retrieval_missing_mda` | Driver, margin, or durability question lacks MD&A-like explanatory source. |
| `retrieval_missing_business_section` | Business model answer lacks Business, Segment, or Revenue source. |
| `retrieval_missing_risk_factors` | Risk question lacks Risk Factors or relevant MD&A. |
| `retrieval_missing_prior_period` | Prior-period comparison lacks previous filing context. |
| `retrieval_missing_segment` | Segment question lacks segment source. |
| `retrieval_missing_liquidity_section` | Liquidity or debt question lacks liquidity, cash, debt, borrowing, or maturity context. |
| `driver_source_missing` | Driver question has numeric context but lacks MD&A, segment, revenue note, or other explanatory source. |
| `sector_required_source_missing` | Sector-specific required source family is missing, such as bank NII/deposits, retail comp sales, energy commodity/volume, or industrial backlog/price realization. |
| `retrieval_overfocused_xbrl` | Numeric XBRL source dominates and explanatory context is missing. |
| `wrong_source` | Selected source does not match the question. |
| `wrong_filing_period` | Answer uses the wrong period. |
| `wrong_ticker_source` | Answer uses another company's source. |
| `source_id_invalid` | Cited source ID is not in the returned source list. |
| `source_relevance_low` | Sources exist but are weak for the question intent. |
| `context_overstuffed` | Too much context makes the answer unfocused. |
| `insufficient_context` | Too little selected context to answer well. |

## Synthesis

| Label | Definition |
| --- | --- |
| `metric_without_driver` | Gives metric movement but not the company-described reason. |
| `driver_slot_empty` | Driver fallback could not fill any company-explained driver slot. |
| `vague_answer` | Answer is abstract or generic. |
| `evasive_answer` | Says the filing explains it without explaining the content. |
| `unsupported_claim` | Main claim is not supported by the provided source. |
| `overconfident_without_evidence` | Filing uncertainty is presented as certainty. |
| `causality_invented` | Creates a causal explanation not in the source. |
| `numeric_error` | Material number is wrong. |
| `sign_error` | Increase/decrease or improvement/deterioration is reversed. |
| `period_mismatch` | Mixes quarter, fiscal year, prior filing, or year-over-year basis. |
| `segment_mixup` | Segment, product, or region is mixed up. |
| `business_model_generic` | Business model answer is not company-specific. |
| `risk_generic` | Risk answer could apply to almost any company. |
| `temporality_not_assessed` | Asked whether a factor is temporary, but answer does not assess it. |
| `source_ignored` | Source contains the answer but response does not use it. |
| `contradiction_with_source` | Answer contradicts selected source. |

## Follow-Up

| Label | Definition |
| --- | --- |
| `followup_context_lost` | Prior question/answer context is lost. |
| `followup_target_empty` | Durability follow-up has no extracted prior driver target, so temporary/durable assessment should be limited. |
| `pronoun_resolution_failed` | "その要因" or similar reference is resolved incorrectly. |
| `wrong_intent_classification` | Follow-up intent is classified incorrectly. |
| `missing_question_rewrite` | Rewritten question is not standalone enough. |
| `answer_repeats_previous` | Repeats prior answer instead of answering the follow-up. |
| `comparison_context_lost` | Loses prior/current comparison target. |

## Fallback

| Label | Definition |
| --- | --- |
| `fallback_too_generic` | Fallback lacks ticker or filing specificity. |
| `fallback_too_short` | Fallback is too short to be useful. |
| `fallback_hallucinated` | Fallback asserts unsupported facts. |
| `fallback_not_transparent` | Fallback hides missing evidence or uncertainty. |
| `fallback_overrefusal` | Refuses despite having enough evidence to answer partially. |
| `deterministic_template_leak` | Template wording is obvious and low quality. |
| `conditional_template_mismatch` | Template uses a conditional phrase that does not fit the actual metric direction or sign. |
| `sector_inappropriate_metric` | Answer interprets a metric using a sector-inappropriate lens, such as bank operating cash flow as ordinary cash generation. |
| `timeout_after_retry` | Model retry was used and the final path still fell back due to Gemini timeout. |
| `fallback_wrong_reason` | Recorded fallback reason does not match the failure. |

## UX / Language

| Label | Definition |
| --- | --- |
| `too_short` | Too little information to be useful. |
| `too_long` | Too long for chat. |
| `unreadable_japanese` | Japanese is awkward or hard to understand. |
| `excessive_jargon` | Too much unexplained financial jargon. |
| `no_answer_first_sentence` | Does not answer the question at the start. |
| `hedging_overuse` | Too many hedges weaken the answer. |
| `investment_advice_tone` | Sounds like direct buy/sell advice. |
| `web_overweighted` | Web context outweighs SEC filing context. |
