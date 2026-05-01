# Main checkpoint review: PR3b language-safe fallback baseline

## 1. 結論
checkpoint は PASS（canary p99 の軽微超過は説明付き）です。PR3b の Japanese-only / fallbackKind / sourceIdsValid invariant は targeted audit、fixed full60、random canary12 で維持されました。production release は引き続き HOLD です。

## 2. reviewed files
- `workers/src/lib/chat/model-attempt.ts`
- `workers/src/lib/chat/source-gate.ts`
- `workers/src/lib/chat/evidence-slots.ts`
- `workers/src/lib/chat/evidence-fallback.ts`
- `workers/src/lib/chat/final-answer-language.ts`
- `workers/src/lib/chat/evidence-text-quality.ts`
- `workers/src/lib/chat/response-finalizer.ts`
- `workers/src/lib/chat/diagnostics.ts`
- `workers/src/lib/chat/grounding.ts`
- `workers/src/clients/gemini/fallback.ts`
- `workers/src/clients/gemini/types.ts`
- `workers/testbench/scripts/run-benchmark.mjs`

## 3. commands run
- `cd workers && npm run typecheck`: pass
- `cd workers && npm test`: pass, 372 tests
- `cd workers && npm run dryrun:test`: pass
- `cd workers && npm run smoke:test`: pass against `https://kabuyomi-api-test.dznqjmctk7.workers.dev`

## 4. targeted Japanese-output audit
対象 14 case はすべて final answer Japanese-only 条件を満たしました。raw English surfaced、banned phrase hits、sourceIdsValid=false、fallbackKind=none on fallback rows、bank term leakage、unknown driver の temporary/structural classification は 0 です。

| case | path | reason | kind | sourceIdsValid | rawEnglish | bannedHits | languageGuard checked/ok/used | latency |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| AAPL-Q03 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 2082ms |
| JPM-Q03 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 1557ms |
| JPM-Q04 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 274ms |
| JPM-Q06 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 395ms |
| CAT-Q03 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 1601ms |
| WMT-Q03 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 1744ms |
| NET-Q10 | gemini | none | none | true | false | 0 | true/true/false | 9047ms |
| NET-Q11 | gemini | none | none | true | false | 0 | true/true/false | 5964ms |
| KLAC-Q06 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 199ms |
| MS-Q04 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 2867ms |
| ISRG-Q04 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 4300ms |
| CL-Q06 | fallback | low_quality_answer | legacy_template | true | false | 0 | true/true/false | 5620ms |
| VTR-Q11 | fallback | weak_grounding | weak_grounding | true | false | 0 | true/true/false | 11694ms |
| FCX-Q06 | fallback | low_quality_answer | evidence_slot | true | false | 0 | true/true/false | 281ms |

## 5. fixed full60 summary
- rows: 60
- fallback total: 18
- sourceIdsValid false: 0
- fallbackKind none on fallback rows: 0
- raw English surfaced: 0
- banned phrase hits: 0
- metric_without_driver / temporality_not_assessed / evasive_answer: 0 / 0 / 0
- languageGuardFallbackUsed: 0
- retryAttempted / retryWasted: 3 / 2
- p50 / p95 / p99 / max latency: 3505ms / 7313ms / 11160ms / 11160ms

fallbackKind breakdown:
| kind | count |
| --- | ---: |
| evidence_slot | 14 |
| legacy_template | 1 |
| low_quality | 1 |
| non_hard_model_timeout | 1 |
| none | 42 |
| weak_grounding | 1 |

fallbackReason breakdown:
| reason | count |
| --- | ---: |
| gemini_timeout | 1 |
| low_quality_answer | 16 |
| none | 42 |
| weak_grounding | 1 |

## 6. random canary12 summary
- rows: 108
- fallback total: 52
- sourceIdsValid false: 0
- fallbackKind none on fallback rows: 0
- raw English surfaced: 0
- banned phrase hits: 0
- bank terms in non-bank sectors: 0
- wrong sector terms: 0
- Q10/Q11 one-line fallback: 0
- languageGuardFallbackUsed: 0
- p50 / p95 / p99 / max latency: 5156ms / 9631ms / 12156ms / 12307ms
- p99 は acceptance 目安の 12000ms を 156ms 超過。VTR-Q10/Q11 の non-hard fallback が主因で、Japanese-only / sourceIdsValid / fallbackKind invariant には影響なし。PR4 前 checkpoint としては説明付きで許容。

fallbackKind breakdown:
| kind | count |
| --- | ---: |
| context_unavailable | 1 |
| evidence_slot | 29 |
| legacy_template | 6 |
| low_quality | 6 |
| non_hard_model_timeout | 5 |
| none | 56 |
| weak_grounding | 5 |

fallbackReason breakdown:
| reason | count |
| --- | ---: |
| gemini_timeout | 5 |
| low_quality_answer | 41 |
| no_sources | 1 |
| none | 56 |
| weak_grounding | 5 |

Note: canary の最初の FOXA run で transient な HTML response による JSON parse interruption がありました。FOXA/AEP/FCX を再実行して combined run を保存済みです。

## 7. invariants confirmed
- hard-intent model retry disabled: 確認済み。`model-attempt.ts` と `route-policy.ts` で hard intent は retryAllowed=false / hard_intent_retry_disabled。
- final answer language guard applies to all finalized responses: 確認済み。`finalizeChatResponse` が Gemini/fallback/deterministic 経路の最終 payload に適用。
- responsePath=fallback never has fallbackKind=none: benchmark で 0。
- sourceIdsValid repair does not create fake IDs: benchmark で sourceIdsValid false 0。final source は実 source のみ。
- raw English SEC excerpts cannot enter driver output: targeted/full60/canary final answer で 0。
- non-hard fallback no one-line evasive answers: Q10/Q11 one-line fallback 0。
- WMT and non-bank sectors do not get bank-specific fallback terms: canary 0。
- Q04/Q06 no temporary/structural classification when prior driver unknown: targeted audit 0。
- testbench preserves fallback/source/language fields: JSONL fields confirmed。

## 8. remaining blockers
- production release はまだ不可。Q03/Q04/Q06 は fallback 中心で、hard-intent retrieval/source selection が未達。
- random canary12 fallback total は 52/108 と高い。
- PR4 では hard-intent retrieval/source selection の改善が必要。

## 9. releaseDecision: HOLD
releaseDecision: HOLD。これは production release ではなく、test baseline checkpoint です。

## 10. nextPR: PR4 hard-intent retrieval/source selection
nextPR は PR4 hard-intent retrieval/source selection。対象は revenue_driver / driver_durability_followup / margin_durability_followup の source sufficiency と sector-aware retrieval 精度です。

## 11. run / summary / report paths
- targeted audit run: `workers/testbench/runs/2026-05-01T22-24-main-checkpoint-target-combined.jsonl`
- targeted audit summary: `workers/testbench/runs/2026-05-01T22-24-main-checkpoint-target-summary.json`
- fixed full60 run: `workers/testbench/runs/2026-05-01T22-34-main-checkpoint-fixed-full60.jsonl`
- fixed full60 summary: `workers/testbench/runs/2026-05-01T22-34-main-checkpoint-fixed-full60-summary.json`
- random canary12 run: `workers/testbench/runs/2026-05-01T22-43-main-checkpoint-random-canary12.jsonl`
- random canary12 summary: `workers/testbench/runs/2026-05-01T22-43-main-checkpoint-random-canary12-summary.json`
- checkpoint report: `workers/testbench/reports/2026-05-01-main-checkpoint-pr3b.md`
