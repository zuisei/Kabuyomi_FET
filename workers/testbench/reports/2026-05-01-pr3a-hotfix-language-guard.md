# PR3a hotfix language guard validation

## 1. 結論
PR3a-hotfix は test Worker に deploy 済みです。主目的だった raw English excerpt の user-facing 表示、sourceIdsValid=false、fallbackKind=none は、fixed full60 / random canary12 の最終 run では 0 まで落ちました。production release はまだ hold です。理由は、この PR が言語安全性の hotfix であり、non-hard fallback の品質や一部 latency は PR3 本体でまだ直す必要があるためです。

## 2. 変更ファイル
- workers/src/lib/chat/final-answer-language.ts
- workers/src/lib/chat/evidence-text-quality.ts
- workers/src/lib/chat/evidence-slots.ts
- workers/src/lib/chat/evidence-fallback.ts
- workers/src/lib/chat/source-gate.ts
- workers/src/lib/chat/response-finalizer.ts
- workers/src/lib/chat/grounding.ts
- workers/src/lib/chat/orchestrator.ts
- workers/src/lib/chat/diagnostics.ts
- workers/src/clients/gemini/types.ts
- workers/test/final-answer-language.test.ts
- workers/test/chat-source-gate.test.ts
- workers/test/pipeline.test.ts
- workers/test/chat-diagnostics.test.ts
- workers/testbench/scripts/run-benchmark.mjs

## 3. Japanese-only final answer guard
全 final answer に deterministic guard を通すようにしました。Gemini / evidence fallback / legacy fallback / deterministic / timeout / context unavailable を対象に、英語文・SEC excerpt 断片・英語 driver 化を検出した場合は Gemini repair なしで Japanese safe fallback に置換します。短い KPI、ticker、company/product/segment 名は許可します。

最終 random canary12 では language guard rewrite が 6 件発生しましたが、final answer 上の raw English excerpt surfaced は 0 件です。

## 4. sourceIdsValid=false 修正
context unavailable / invalid source fallback で、利用可能な selected filing source がある場合は final sources に保持するようにしました。fake source ID は作っていません。

- fixed full60 sourceIdsValid false: 0
- random canary12 sourceIdsValid false: 0

## 5. fallbackKind=none 修正
responsePath=fallback の場合は finalizer で fallbackKind を必ず正規化します。

- fixed full60 fallbackKind=none on fallback rows: 0
- random canary12 fallbackKind=none on fallback rows: 0

## 6. raw English excerpt suppression
source gate / evidence slot で raw English fragment を driver として採用しないようにし、最終回答にも language guard をかけました。KLAC-Q06 / MS-Q04 / ISRG-Q04 / DE-Q04 / FCX-Q06 のような既知 critical は、final answer では日本語 fallback に置換されています。

- fixed full60 raw English surfaced: 0
- random canary12 raw English surfaced: 0
- random canary12 english answer leak surfaced: 0
- random canary12 non-Japanese final answer surfaced: 0

## 7. source gate false positive tightening
raw English / risk boilerplate / section heading / table fragment を concrete driver として扱わない guard を追加しました。ただし、一部ケースでは sourceGateSufficient=true の後に final language guard が救済しているため、PR3 では gate 側の false positive をさらに減らす余地があります。

## 8. targeted validation 結果
対象ケースは random canary12 の最終 run から抽出しました。全対象で sourceIdsValid=false は 0、fallbackKind=none は 0、raw English surfaced は 0 です。

| case | path | kind | sourceValid | gate | evidence | langRewrite | bannedHits | latencyMs |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| NET-Q10 | gemini | none | true | n/a | false | false | 0 | 7065 |
| NET-Q11 | gemini | none | true | n/a | false | false | 0 | 5518 |
| KLAC-Q06 | fallback | evidence_slot | true | false | true | false | 0 | 189 |
| MS-Q04 | fallback | language_guard_fallback | true | true | true | true | 0 | 2626 |
| ISRG-Q04 | fallback | language_guard_fallback | true | true | true | true | 0 | 4318 |
| HAL-Q04 | fallback | evidence_slot | true | false | true | false | 0 | 158 |
| DE-Q04 | fallback | language_guard_fallback | true | true | true | true | 0 | 5427 |
| CL-Q04 | fallback | language_guard_fallback | true | true | true | true | 0 | 4625 |
| CL-Q06 | fallback | language_guard_fallback | true | true | true | true | 0 | 5930 |
| VTR-Q06 | fallback | evidence_slot | true | false | true | false | 0 | 204 |
| FOXA-Q06 | fallback | language_guard_fallback | true | true | true | true | 0 | 6072 |
| AEP-Q04 | fallback | evidence_slot | true | false | true | false | 0 | 158 |
| FCX-Q06 | fallback | evidence_slot | true | false | true | false | 0 | 164 |

## 9. fixed full60 結果
| metric | value |
| --- | ---: |
| rows | 60 |
| sourceIdsValid false | 0 |
| fallback total | 17 |
| fallbackKind none on fallback rows | 0 |
| raw English surfaced | 0 |
| banned fallback phrase hits | 0 |
| sourceGateApplied | 15 |
| sourceGateSufficient false | 14 |
| evidenceFallbackUsed | 15 |
| Q03/Q04/Q06 fallback | 15 |
| Q03/Q04/Q06 evidence_slot fallback | 14 |
| metric_without_driver | 0 |
| temporality_not_assessed | 0 |
| evasive_answer | 0 |
| retryAttempted | 3 |
| retryWasted | 2 |
| p50 latency | 3480ms |
| p95 latency | 7021ms |
| p99 latency | 10633ms |

## 10. random canary12 再実行結果
| metric | value |
| --- | ---: |
| rows | 108 |
| sourceIdsValid false | 0 |
| fallback total | 50 |
| fallbackKind none on fallback rows | 0 |
| raw English surfaced | 0 |
| banned fallback phrase hits | 0 |
| bank terms in non-bank sectors | 0 |
| wrong sector terms | 0 |
| sourceGateApplied | 36 |
| sourceGateSufficient false | 25 |
| evidenceFallbackUsed | 31 |
| Q03/Q04/Q06 fallback | 35 |
| Q03/Q04/Q06 evidence_slot fallback | 25 |
| metric_without_driver | 0 |
| temporality_not_assessed | 0 |
| evasive_answer | 0 |
| retryAttempted | 13 |
| retryWasted | 12 |
| p50 latency | 4866ms |
| p95 latency | 9030ms |
| p99 latency | 10669ms |

## 11. 残課題
- sourceGateSufficient=true でも language guard fallback に救われたケースが残っています。PR3 本体では source gate false positive をさらに減らすべきです。
- canary の NET-Q04 で latency outlier が出ました。今回の hotfix scope では Q01/latency 最適化はしない方針ですが、PR3 で別途見るべきです。
- Q03/Q04/Q06 は安全な fallback になりましたが、まだ「良い回答」ではなく「危険な回答を出さない」段階です。
- non-hard の Q10/Q11 weak_grounding fallback は PR3 の cleanup 対象です。

## 12. release / hold 判定
release は hold 継続です。PR3a は critical language safety hotfix としては前進していますが、production release gate ではありません。raw English / sourceIds / fallbackKind の critical は潰れましたが、driver retrieval と non-hard fallback 品質は未達です。

## 13. 保存した run / summary / report paths
- testbench/runs/2026-05-01T10-58-pr3a-fixed-full60.jsonl
- testbench/runs/2026-05-01T10-58-pr3a-fixed-full60-summary.json
- testbench/runs/2026-05-01T10-55-pr3a-random-sector-canary12.jsonl
- testbench/runs/2026-05-01T10-55-pr3a-random-sector-canary12-summary.json
- testbench/reports/2026-05-01-pr3a-hotfix-language-guard.md
