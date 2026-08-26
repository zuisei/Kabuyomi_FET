# Kabuyomi v1.1 Phase 3J Q04 Final Review

Date: 2026-05-06

Branch: `v1.1-worker-quality-token-retrieval`

## Conclusion

Phase 3J fixed the Q04 malformed-currency label/formatting problem, but Q04 should not be marked ready for Q06 without human review.

Final recommendation: `NEEDS HUMAN Q04 REVIEW`

Why:

- `sourceIdsValid=false` remained 0.
- `rawEnglishInAnswer` remained 0.
- User-visible malformed currency was fixed in the final clean runtime run.
- AAPL-Q04 and XOM-Q04 remained safe fallbacks.
- CAT-Q04 returned OpenAI with no malformed-currency guard labels after the final cleanup.
- WMT-Q04 returned OpenAI with clean currency formatting, but the wording still says eCommerce contribution is "継続的に高まり", which is source-adjacent but slightly stronger than the safest durability wording.
- JPM-Q04 can still fall back after source gate passes with `durability_missing_assessment`, so post-gate synthesis/finalizer variability remains.

## Diagnosis Summary

Clean Phase 3I r7 showed:

- JPM-Q04 and CAT-Q04 had `malformed_currency_detected` labels while remaining OpenAI.
- JPM visible answer included mixed Korean-style unit text such as `1,824억4700万 USD`.
- CAT visible answer could include generated currency/scale text that was either malformed or misleading.
- WMT visible answer could include Chinese currency text such as `美元` in later Phase 3J runtime checks.

Classification:

- JPM-Q04: `malformed_currency_true_positive` in Phase 3I, fixed by normalization.
- CAT-Q04: `malformed_currency_true_positive` for `十億 USD` style output, fixed by normalization.
- WMT-Q04: `malformed_currency_true_positive` for `亿美元` / `美元` style output, fixed by normalization.
- AAPL-Q04: `correct_safe_fallback`; Q04 source context remains table-heavy / insufficient.
- XOM-Q04: `correct_safe_fallback`; current-period supported energy driver/durability evidence remains insufficient.

## Malformed Currency Finding

Implemented narrow finalizer cleanup in `workers/src/lib/chat/response-finalizer.ts`:

- Normalize Korean/Chinese mixed USD units:
  - `1,824억4700万 USD` -> `1824.5億ドル`
  - `7131.63 亿 USD` -> `7131.6億ドル`
- Normalize billion-unit model wording:
  - `67.589十億 USD` -> `675.9億ドル`
  - `7.9十億ドル` -> `79.0億ドル`
- Normalize Chinese currency wording:
  - `7131.63亿美元` -> `7131.6億ドル`
- Remove misleading yen-scale wording generated from USD context:
  - `1兆円超の規模` -> `金額規模`
- Suppress stale `malformed_currency_detected` taxonomy only after the final user-visible answer is confirmed clean.
- Keep `malformed_currency_detected` for severe placeholders such as `売上高の数値表示`.

Final clean runtime run:

- Artifact: `workers/testbench/runs/2026-05-06-v1-1-phase-3j-q03-q04-r5.jsonl`
- Summary: `workers/testbench/runs/2026-05-06-v1-1-phase-3j-q03-q04-r5-summary.json`
- `rawEnglishInAnswer`: 0
- `rawEnglishSurfaced`: 0
- `sourceIdsValid=false`: 0
- JPM-Q04 guard labels: none
- CAT-Q04 guard labels: none
- WMT-Q04 guard labels: none

## Durability Wording Finding

WMT-Q04 in final r5:

- Source-backed elements:
  - eCommerce contribution to comparable sales
  - omnichannel pickup/delivery
  - member engagement
  - unit volume and transaction growth
  - fuel price offset
- Safety concern:
  - The answer says eCommerce contribution is "継続的に高まり".
  - The answer also says continued tracking is needed, so it is not a pure unsupported durability claim.
  - Still, this should be human-reviewed because the safer wording would be closer to: "継続要因になり得ますが、このfilingだけでは断定できません。"

JPM-Q04 in final r5:

- Source gate passed, but final answer fell back with `durability_missing_assessment`.
- This is a post-gate synthesis/finalizer variability issue, not a retrieval/source-ID issue.

CAT-Q04 in final r5:

- OpenAI path.
- No malformed-currency label.
- Answer says price realization and dealer inventory should be checked for persistence, which is cautious enough for test-only review.

## Implementation Summary

Changed:

- `workers/src/lib/chat/response-finalizer.ts`
- `workers/test/final-answer-language.test.ts`

No retrieval, source gate, prompt, provider, billing, iOS, IAP, legal, or production deploy changes were made in this phase.

## Tests Run

From `/Users/0xt4/t4dano/Kabuyomi/workers`:

```bash
npm test -- final-answer-language
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
npm test -- benchmark-quality
npm test -- chat-diagnostics
npm test -- chat-source-gate
```

Final local validation:

- `npm run typecheck`: passed
- `npm test`: passed, 48 files / 555 tests
- `npm run dryrun:test`: passed with `wrangler.test.toml`
- `npm run testbench:validate`: passed

## Test Worker Deploy Result

Production was not deployed.

Final test deploy command:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Final test Worker:

- Worker name: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `8d96ff09-500f-4b32-bc0e-582ea1fc8180`
- Config: `wrangler.test.toml`

## Benchmark / Rerun Result

Command:

```bash
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3j-q03-q04-r5 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03-q04.jsonl \
npm run testbench:run
```

Final clean run:

- Rows: 10
- Infra contaminated: false
- Provider error rows: 0
- OpenAI: 6/10
- fallback: 4/10
- `sourceIdsValid=false`: 0
- `rawEnglishInAnswer`: 0
- `rawEnglishInDiagnostics`: 1
- `rawEnglishSurfaced`: 0

Per-company Q04:

- AAPL-Q04: fallback, safe source-insufficient answer.
- JPM-Q04: fallback after source gate passed, `durability_missing_assessment`.
- XOM-Q04: fallback, safe source-insufficient / language-rewritten Japanese fallback.
- CAT-Q04: OpenAI, no malformed currency label.
- WMT-Q04: OpenAI, no malformed currency label, but durability wording needs human review.

## Remaining Risks

- Q04 post-gate behavior is still variable. JPM can pass source gate and still fall back due missing durability assessment.
- WMT wording remains slightly assertive around eCommerce persistence.
- XOM still depends on better first-class energy/current-period source assets for a non-fallback answer.
- Provider quality/runtime variability remains visible, even when source IDs and language guards hold.

## Recommendation

`NEEDS HUMAN Q04 REVIEW`

Do not move directly to Q06 as a quality milestone until a human reviews whether WMT-Q04 wording is acceptable and whether JPM-Q04 post-gate fallback should be fixed or accepted as a safe fallback. Production remains unsafe for these v1.1 changes.
