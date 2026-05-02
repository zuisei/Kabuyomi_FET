# Chat Quality Rubric

Scores are 1 to 5.

| Score | Meaning |
| ---: | --- |
| 5 | Strong production answer. Direct, grounded, specific, concise. |
| 4 | Useful answer with small omissions. |
| 3 | Partly useful, but thin, vague, or missing one important point. |
| 2 | Weak. Important source, context, or reasoning is missing. |
| 1 | Wrong, ungrounded, evasive, or unsafe for product use. |

## Weighted Categories

| Category | Weight | What It Checks |
| --- | ---: | --- |
| Factual accuracy | 20% | Numbers, period, direction, company, and section facts are correct. |
| Filing grounding | 20% | Main claims are supported by SEC filing sources. |
| Source relevance | 15% | Selected sources match the question intent. |
| Answer directness | 10% | The first sentence answers the actual question. |
| Completeness / materiality | 10% | The important investor-relevant points are included. |
| Intent-specific quality | 15% | Driver, durability, risk, cash flow, or comparison reasoning is good. |
| Conciseness | 5% | Short enough for chat, not too thin. |
| Japanese readability | 5% | Natural Japanese for beginner-to-intermediate investors. |

## Intent-Specific Rules

### Driver Questions

Questions like `売上成長の主な要因は？` or `利益率が悪化した理由は？` require company-explained causes, not only XBRL numbers.

- 5: Explains the metric change and at least one concrete company-described driver.
- 3: Gives numbers but only weak cause explanation.
- 1: Does not answer why, or invents a cause not in the sources.

### Follow-Up / Durability Questions

Questions like `その要因は一時的？` must preserve conversation context.

- 5: Resolves what "that factor" means and separates temporary, durable, and uncertain factors.
- 3: Understands the topic but stays generic.
- 1: Loses context or answers an unrelated question.

### Risk Questions

Risk answers should be company-specific and filing-grounded.

- 5: Names material risks and connects them to current business or MD&A where possible.
- 3: Lists plausible risks but mostly generic.
- 1: Invents risks or only gives generic market risk.

### Cash Flow / Liquidity Questions

Cash flow answers should distinguish earnings, operating cash flow, debt, and liquidity.

- 5: Explains operating cash flow quality and balance-sheet/liquidity context.
- 3: Mentions cash flow but lacks interpretation.
- 1: Confuses profit with cash flow or uses unsupported claims.

### Fallback Answers

Fallback is acceptable only if it remains useful and honest.

- 5: Answers within available evidence and states what is missing.
- 3: Some value, but template-like or thin.
- 1: Generic refusal, hallucination, or no useful answer.

## Initial Pass Line

For the first 60-case benchmark:

- overall average: 3.8+
- factual accuracy average: 4.2+
- filing grounding average: 4.0+
- source ID validity: 100%
- critical failures: 0
- driver questions with `metric_without_driver`: 20% or less
- follow-up questions with `followup_context_lost`: 20% or less
- fallback answers with `fallback_too_generic`: 20% or less

