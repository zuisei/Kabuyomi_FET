# PR3b non-hard fallback cleanup report

## 1. 結論
PR3b は test Worker に deploy 済みです。PR3a の critical invariant は維持できており、targeted / fixed full60 / random canary12 のすべてで sourceIdsValid=false、fallbackKind=none on fallback rows、final raw English surfaced、banned phrase hits、bank terms in non-bank sectors は 0 でした。production release は引き続き HOLD です。

## 2. 変更ファイル
- `workers/src/clients/gemini/fallback.ts`: Q10/Q11/Q12 など non-hard intent の deterministic fallback を追加・整理し、risk/watch/margin fallback の英語 source-type 依存を削減。
- `workers/src/lib/chat/evidence-fallback.ts`: evidence fallback が raw English / fragmentary driver text をそのまま表示しないように guard を追加。
- `workers/src/lib/chat/model-attempt.ts`: hard intent で sourceGateSufficient=true でも driver slot が空なら evidence fallback に戻す guard を追加。
- `workers/src/lib/chat/response-finalizer.ts`: language guard observability を debug に追加。
- `workers/src/lib/chat/diagnostics.ts`, `workers/src/lib/chat/grounding.ts`: language guard fields / flags を通す更新。
- `workers/src/lib/chat/final-answer-language.ts`: fallback source type mapping を現行 intent 名に合わせて拡張。
- `workers/src/clients/gemini/types.ts`: language guard diagnostics type を追加。
- `workers/test/non-hard-fallback.test.ts`: non-hard fallback targeted tests を追加・更新。
- `workers/test/final-answer-language.test.ts`, `workers/test/gemini.test.ts`, `workers/test/pipeline.test.ts`: PR3b behavior に合わせて更新。
- `workers/testbench/scripts/run-benchmark.mjs`: language guard observability fields を run JSONL に保存。
- `workers/testbench/questions/pr3b-target-q01-q07-q08-q10-q11-q12.jsonl`: targeted validation 用 config を追加。

## 3. non-hard fallback cleanup の内容
business_model、segment_driver、liquidity_debt、risk_summary、watch_points、margin_driver、prior_filing_delta に軽量 deterministic fallback を追加しました。fallback は「確認できること」「特定できないこと」「追加で見るべき source type / KPI」を返し、Q10/Q11 の 1 行 evasive fallback は出さない形にしています。

## 4. source-gate false-positive reduction の内容
hard intent では、source gate が sufficient と判定した後でも evidence slot の driver が空、または unsafe English fragment しかない場合は、driver として表示せず evidence fallback に戻します。これにより、Q04/Q06 で raw excerpt を driver として扱う経路を狭めました。

## 5. language guard observability
`languageGuardChecked`, `languageGuardOk`, `languageGuardViolationLabels`, `languageGuardFallbackUsed`, `languageGuardFallbackKind`, `originalAnswerBeforeLanguageGuardLength`, `originalAnswerBeforeLanguageGuardSample` を testbench JSONL に保存しています。canary12 でも `languageGuardFallbackUsed=0` で、最終段の rescue には依存していません。

## 6. targeted validation 結果
- rows: 48
- sourceIdsValid false: 0
- fallback total: 4
- fallbackKind none on fallback rows: 0
- final raw English surfaced: 0
- banned phrase hits: 0
- languageGuardFallbackUsed: 0
- Q10/Q11 one-line fallback: 0
- p95 / p99 latency: 9960ms / 11777ms

fallbackReason breakdown:
| reason | count |
| --- | ---: |
| low_quality_answer | 2 |
| none | 44 |
| weak_grounding | 2 |

## 7. fixed full60 結果
- rows: 60
- sourceIdsValid false: 0
- fallback total: 17
- fallbackKind none on fallback rows: 0
- final raw English surfaced: 0
- banned phrase hits: 0
- metric_without_driver / temporality_not_assessed / evasive_answer: 0 / 0 / 0
- Q03/Q04/Q06 fallback: 15
- Q03/Q04/Q06 evidence_slot fallback: 14
- languageGuardFallbackUsed: 0
- retryAttempted / retryWasted: 3 / 2
- p50 / p95 / p99 latency: 3503ms / 7045ms / 10895ms

fallbackKind breakdown:
| kind | count |
| --- | ---: |
| evidence_slot | 14 |
| legacy_template | 1 |
| low_quality | 1 |
| none | 43 |
| weak_grounding | 1 |

fallbackReason breakdown:
| reason | count |
| --- | ---: |
| low_quality_answer | 16 |
| none | 43 |
| weak_grounding | 1 |

## 8. random canary12 結果
- rows: 108
- sourceIdsValid false: 0
- fallback total: 53
- fallbackKind none on fallback rows: 0
- final raw English surfaced: 0
- unsafe draft caught by language guard: 0
- banned phrase hits: 0
- bank terms in non-bank: 0
- wrong sector terms: 0
- Q10/Q11 one-line fallback: 0
- weak_grounding fallback: 5
- source_gate_false_positive: 0
- languageGuardFallbackUsed: 0
- p50 / p95 / p99 latency: 4957ms / 9146ms / 10808ms

fallbackKind breakdown:
| kind | count |
| --- | ---: |
| context_unavailable | 1 |
| evidence_slot | 29 |
| legacy_template | 6 |
| low_quality | 7 |
| non_hard_model_timeout | 5 |
| none | 55 |
| weak_grounding | 5 |

fallbackReason breakdown:
| reason | count |
| --- | ---: |
| gemini_timeout | 5 |
| low_quality_answer | 42 |
| no_sources | 1 |
| none | 55 |
| weak_grounding | 5 |

## 9. 良くなった点
- PR3a invariant は維持: sourceIdsValid=false、fallbackKind missing、final raw English、banned phrase、bank leakage が 0。
- targeted と canary12 で Q10/Q11 の one-line fallback は 0。
- fixed full60 は fallback total 17/60、p95 7045ms で PR3a baseline と同等範囲。
- language guard fields は testbench で観測可能になり、今回の canary12 では `languageGuardFallbackUsed=0` でした。

## 10. 残課題
- canary12 の fallback total は 53/108 と高く、Q03/Q04/Q06 はまだ fallback 中心です。
- VTR-Q11 など non-hard weak_grounding は latency が重く、canary12 p99 は 10808ms です。
- Q10/Q11 fallback は透明になりましたが、retrieval/source selection の改善は PR3 本体に残ります。

## 11. release / hold 判定
production release は HOLD のままです。PR3b は fallback safety と observability の改善としては有効ですが、answer quality / retrieval sufficiency / hard-intent success rate は release gate 未達です。

## 12. 保存した run / summary / report paths
- targeted run: `workers/testbench/runs/2026-05-01T13-56-pr3b-target-combined.jsonl`
- targeted summary: `workers/testbench/runs/2026-05-01T13-56-pr3b-target-summary.json`
- fixed full60 run: `workers/testbench/runs/2026-05-01T14-05-pr3b-fixed-full60.jsonl`
- fixed full60 summary: `workers/testbench/runs/2026-05-01T14-05-pr3b-fixed-full60-summary.json`
- random canary12 run: `workers/testbench/runs/2026-05-01T14-13-pr3b-random-canary12.jsonl`
- random canary12 summary: `workers/testbench/runs/2026-05-01T14-13-pr3b-random-canary12-summary.json`
- report: `workers/testbench/reports/2026-05-01-pr3b-non-hard-fallback-cleanup.md`
