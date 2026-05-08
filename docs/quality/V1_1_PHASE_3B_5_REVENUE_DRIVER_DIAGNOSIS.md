# Kabuyomi v1.1 Phase 3B.5 Revenue Driver Diagnosis

Date: 2026-05-06
Branch: `v1.1-worker-quality-token-retrieval`
Base before work: `0356d23`

## Conclusion

Phase 3B.5 added bounded test/debug diagnostics and reran the Q03 subset against the test Worker. The new artifact now makes the remaining failure modes visible:

1. JPM and CAT are still source asset/cache gaps before source gate.
2. XOM and WMT no longer fell back in this run, but the selected source previews show that their gate pass can still be based on weak or generic CTX evidence.

Recommendation: `NEED CACHE/ASSET BACKFILL FIRST`

Do not move to Q04/Q06 yet. The next slice should add a test-only content upgrade/backfill or first-class revenue/segment section asset path so Q03 source evidence is real, inspectable, and consistently driver-specific.

## Commands

Validation:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run typecheck
npm test
npm run dryrun:test
npm run testbench:validate
npm test -- chat-diagnostics
npm test -- final-answer-language
npm test -- chat-source-gate
npm test -- hard-intent
```

Test deploy:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npm run deploy:test
```

Benchmark:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
node - <<'NODE'
const fs = require('fs');
const rows = fs.readFileSync('testbench/questions/core-12.jsonl', 'utf8')
  .trim()
  .split(/\n/)
  .map((line) => JSON.parse(line))
  .filter((row) => row.templateId === 'Q03');
fs.writeFileSync('/tmp/kabuyomi-q03.jsonl', rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
console.log(`wrote ${rows.length} Q03 templates to /tmp/kabuyomi-q03.jsonl`);
NODE
KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev \
KABUYOMI_TESTBENCH_DEVICE_KEY=1e5200e1-9b6e-4970-a232-9ac542bb0827 \
BENCHMARK_DEVICE_KEY_MODE=row \
KABUYOMI_TESTBENCH_RUN_ID=2026-05-06-v1-1-phase-3b-5-q03 \
KABUYOMI_TESTBENCH_QUESTIONS=/tmp/kabuyomi-q03.jsonl \
npm run testbench:run
```

Production deploy was not run.

## Test Worker

- Worker: `kabuyomi-api-test`
- URL: `https://kabuyomi-api-test.dznqjmctk7.workers.dev`
- Version ID: `1ecff5ef-ca9f-434d-a748-f6016f00e8f5`
- Command: `npm run deploy:test`

## Diagnostics Added

Added bounded debug/testbench fields:

- `selectedSourceExcerpts`
- `selectedSourceTextPreview`
- `selectedSourceFamilies`
- `selectedSourceLabels`
- `selectedSourceIds`
- `selectedSourceCharCount`
- `sourceGateEvidenceSlots`
- `modelRawAnswerPreview`
- `finalizerGuardLabels`
- `answerQualityFlags`
- `lowQualityReason`

The source previews are bounded in debug output and row artifacts. They are only included through the existing test Worker debug path and testbench runner; normal production responses are not changed.

The low-quality guard now has a small reason classifier. The boolean guard behavior was preserved; this pass did not loosen hallucination/source-grounding protection.

## Benchmark Comparison

Artifacts:

- `workers/testbench/runs/2026-05-06-v1-1-phase-3b-5-q03.jsonl`
- `workers/testbench/runs/2026-05-06-v1-1-phase-3b-5-q03-summary.json`

| Metric | Phase 3B | Phase 3B.5 |
| --- | ---: | ---: |
| Q03 rows | 5 | 5 |
| OpenAI path | 1 | 3 |
| Fallback | 4 | 2 |
| `sourceIdsValid=false` | 0 | 0 |
| Infra contamination | none | none |
| Token field coverage | 3/5 | 3/5 |

The fallback count improved in this live run, but the new previews show that this should not be treated as Q03 solved. XOM and WMT require better source assets before their improvement can be trusted as stable.

## XOM/WMT Post-Gate Diagnosis

### XOM-Q03

Phase 3B.5 result:

- `responsePath`: `openai`
- `sourceGatePassed`: `true`
- `sourceIdsValid`: `true`
- selected families: `segment_revenue`, `xbrl_metric`
- `sourceGateEvidenceSlots.companyExplainedDrivers`: 1 energy driver
- low-quality reason: `null`

What the model received:

- CTX previews include commodity/supply language, but they are broad risk/market-supply passages rather than a clean results-of-operations revenue bridge.
- Evidence slot driver preview: increased supply can reduce commodity prices if not offset by demand.

Diagnosis:

- This is no longer a post-gate low-quality fallback in the Phase 3B.5 run.
- The source gate pass is explainable, but the evidence is not yet ideal revenue-driver section evidence.
- The model answer stayed cautious and mentioned missing segment-level detail. No source ID invalid regression appeared.

### WMT-Q03

Phase 3B.5 result:

- `responsePath`: `openai`
- `sourceGatePassed`: `true`
- `sourceIdsValid`: `true`
- selected families: `segment_revenue`, `xbrl_metric`
- `sourceGateEvidenceSlots.companyExplainedDrivers`: 1 retail driver
- low-quality reason: `null`

What the model received:

- CTX previews are mostly business/history and strategy text: Sam's Club opening history, store/club footprint, remodeling, omnichannel capabilities.
- The expected comparable sales / traffic / eCommerce operating-results evidence was not present in the selected previews.

Diagnosis:

- This row no longer fell to `low_quality_answer`, but the new diagnostics show a gate/source quality concern.
- The answer was cautious and asked for direct factor confirmation, but source gate appears too willing to accept generic retail strategy/history as revenue-driver evidence.
- This is not a prompt/model issue first. It is still a source asset and evidence-quality issue.

## JPM/CAT Source Asset Diagnosis

### JPM-Q03

Phase 3B.5 result:

- `responsePath`: `fallback`
- `sourceGatePassed`: `false`
- selected families: `mda`, `xbrl_metric`
- selected previews:
  - `S2`: `Item 2. Properties... headquarters...`
  - `S9/S10/S11`: XBRL revenue, net income, EPS
- `sourceGateEvidenceSlots.companyExplainedDrivers`: empty
- missing source types include MD&A revenue discussion, segment/revenue context, net interest income discussion, noninterest income discussion, provision for credit losses discussion, and segment results.

Diagnosis:

- This is a real pre-gate source asset/cache gap.
- The selected source chunk is a properties fragment, not MD&A revenue discussion.
- Content upgrade/backfill should expose bank revenue discussion before any source-gate or prompt change.

### CAT-Q03

Phase 3B.5 result:

- `responsePath`: `fallback`
- `sourceGatePassed`: `false`
- selected families: `segment_revenue`, `xbrl_metric`
- selected previews are mostly construction segment description, competitors, product innovation, and XBRL metrics.
- `sourceGateEvidenceSlots.companyExplainedDrivers`: empty
- missing source types include MD&A revenue discussion, price realization discussion, sales volume discussion, orders/backlog discussion, and segment results.

Diagnosis:

- This is also a pre-gate source asset/cache gap.
- The current selected snippets describe the business and industry, not the period revenue bridge.
- Content upgrade/backfill or first-class revenue/segment section assets are needed.

## Tiny Fix Status

No low-quality guard relaxation was made.

The only low-quality-related change is diagnostic: the existing low-quality boolean is now backed by `lowQualityReason` when it fires. This helps distinguish cases such as `revenue_driver_declined_despite_context` from source-gate fallback.

## Risks

- Phase 3B.5 fallback improved to 2/5, but XOM/WMT source previews show the improvement may be unstable or based on generic sections.
- `finalizerGuardLabels` reports `malformed_currency_detected` for AAPL/XOM/WMT even when `responsePath=openai`; this is useful diagnostics, but it should be reviewed before production candidate work.
- Source excerpts in artifacts are bounded, but they can still contain filing text. Keep this debug/testbench-only.

## Next Recommendation

Recommended next slice:

1. Implement or trigger test-only revenue/segment MD&A content upgrade/backfill.
2. Add first-class section assets for revenue discussion and segment results before Q04/Q06 work.
3. Tighten revenue-driver evidence quality after better assets exist, especially for WMT-like generic strategy/history snippets.
4. Rerun Q03 and require stable source previews, not only lower fallback count.
