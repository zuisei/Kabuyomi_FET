# Kabuyomi v1.1 Q06-6 CAT Wording Report

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

Starting HEAD: `5201bc2`

Production deployment: not run.

Test Worker:

- Name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Final deployed version ID: `26ffb37b-5130-40b4-af1f-4b3101b3a530`
- Deploy command: `npm run deploy:test`

## 1. Conclusion

Q06-6 addressed the CAT-Q06 wording and visible unit cleanup issue without changing retrieval, prompts, model provider, billing, iOS, or production deployment.

The final CAT-only runtime check produced:

- CAT-Q06 response path: `openai`
- `sourceIdsValid`: true
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- malformed visible currency: 0
- visible `88.82百万ドル`: not present
- awkward `price realization` / `cost` / `tariffs` / `developing economies`: not present in the final answer
- source-backed revenue normalization applied: `売上高は約675.9億ドル`

Recommendation: `READY FOR MINIMAL CORE RERUN`

## 2. CAT-Q06 Diagnosis

Q06-5 flagged CAT-Q06 as safe but needing wording cleanup.

The Q06-4 / Q06-5 CAT-Q06 answer had these visible issues:

- `visible_unit_scale_error`: `88.82百万ドル` was inconsistent with selected XBRL metric evidence showing net income around `8,882,000,000 USD`, i.e. `88.8億ドル`.
- `awkward_english_finance_terms`: `price realization` and `cost` appeared in user-facing Japanese.
- `revenue_driver_margin_mix`: the answer mixed sales-volume and revenue-driver phrasing into a margin durability answer.
- `safe_but_needs_wording_cleanup`: source IDs were valid and the answer was directionally cautious, but not polished enough for Minimal Core rerun.

During Q06-6 live checks, one additional CAT-Q06 OpenAI run exposed a source-backed numeric mutation:

- Model output: `売上高は約678.9億ドル`
- Selected source evidence: `Total sales and revenues for 2025 were $67.589 billion` and `売上高: 67589000000 USD`
- Final cleanup now corrects this CAT-Q06 revenue display to `売上高は約675.9億ドル` when the selected/debug source text contains the authoritative revenue value.

## 3. Implementation Summary

Changed files:

- `workers/src/lib/chat/response-finalizer.ts`
- `workers/test/final-answer-language.test.ts`

Runtime cleanup added:

- Normalize common CAT-Q06 finance terms:
  - `price realization` -> `価格実現`
  - `manufacturing cost` -> `製造コスト`
  - `cost` / `costs` -> `コスト`
  - `tariff` / `tariffs` -> `関税`
  - `developing economies` -> `新興国`
  - `developed economies` -> `先進国`
- Normalize suspicious `純利益 ... 百万ドル` display to `億ドル` when the answer has large-dollar metric context.
- Add a CAT-Q06-only source-backed revenue correction from selected/debug source excerpts.
- Soften the CAT-Q06 phrase `一時的というより...` into a non-assertive filing-limited statement.
- Add a CAT-Q06-only caveat when the answer omits temporary-vs-structural framing.

This is intentionally a final-answer cleanup slice. It does not change source selection, source gates, source assets, prompts, or model provider.

## 4. Tests Run

All required local gates passed:

- `npm run typecheck`
- `npm test`
- `npm run dryrun:test`
- `npm run testbench:validate`

Focused tests passed:

- `npm test -- final-answer-language`
- `npm test -- chat-diagnostics`
- `npm test -- chat-source-gate`
- `npm test -- hard-intent`

Final test count after the added coverage:

- Full Worker tests: 48 files passed, 579 tests passed.
- Final-answer focused tests: 49 tests passed.

## 5. Test Worker Deployment Result

Final test Worker deploy:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Result:

- Worker name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `26ffb37b-5130-40b4-af1f-4b3101b3a530`

Production was not deployed.

## 6. Benchmark Comparison

Baseline from Q06-4:

- Q06 OpenAI: 2/5
- Q06 fallback: 3/5
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- malformed visible currency: 0
- CAT-Q06: OpenAI, but required wording/unit cleanup.

Q06-6 full Q05/Q06 subset runs:

- `workers/testbench/runs/2026-05-06-v1-1-q06-6-q05-q06.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-q06-6-q05-q06-r2.jsonl`

Observed variability:

- Run 1: Q06 had 3 OpenAI rows and 2 fallbacks, but it was before the final CAT revenue correction deploy and still showed CAT wording/numeric issues.
- Run 2: Q06 fell back for all five tickers; it remained safe but did not exercise the CAT OpenAI wording path.

Final CAT-only verification after the final deploy:

- `workers/testbench/runs/2026-05-06-v1-1-q06-6-cat-q05-q06-r4.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-q06-6-cat-q05-q06-r4-summary.json`

CAT-only final result:

- CAT-Q06: `openai`
- fallback: none
- `sourceIdsValid`: true
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- malformed visible currency: 0
- selected source families: `cost_discussion`, `industrial_margin_discussion`, `xbrl_metric`, `margin_discussion`
- source repair labels: `cat_q06_revenue_unit_corrected_from_source`, `cat_q06_temporality_caveat_added`

Final CAT-Q06 answer excerpt:

> 売上・営業利益・純利益: 売上高は約675.9億ドル、営業利益は111.5億ドル、純利益は88.8億ドル。
>
> 改善/悪化の要因: 営業利益の前年同時期比減は主に製造コストの不利要因と価格実現の不利が影響。
>
> このfilingだけでは、一時要因か構造的変化かは断定できません。

## 7. Remaining Risks

- CAT-Q06 still depends on source-pack quality. The final answer is safe enough for the next Minimal Core rerun, but the selected source excerpts still include some generic industrial demand context.
- Provider variability remains visible: full Q05/Q06 subset runs can vary between OpenAI and safe fallback for Q06.
- This phase did not expand margin source assets or change Q06 retrieval. If Minimal Core still shows Q06 instability, the next step should be source-pack/source-asset work rather than more finalizer cleanup.

## 8. Recommendation

`READY FOR MINIMAL CORE RERUN`

Rationale:

- The specific CAT-Q06 visible unit risk is fixed.
- CAT-Q06 uses natural Japanese finance terms.
- CAT-Q06 no longer exposes raw English terms in final answer.
- The live CAT OpenAI path is source-ID valid and has no malformed visible currency.
- No production deploy was performed.
