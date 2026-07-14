# Kabuyomi UI replacement execution plan

Status: production presentation cutover and safe validation complete. StoreKit success, cancellation, pending, unfinished transaction, and restore are covered by a test-target-only local configuration; signed Release authentication is verified on the connected physical iPhone.

## Guardrails

- Work from clean `main` at `a9306b3`; preserve unrelated changes if they appear.
- Keep iOS 17.0 and existing packages/product IDs/endpoints.
- Use the isolated test Worker, local Debug fixtures, and StoreKit Test; never perform a production purchase or destructive production write.
- Build and validate each milestone before extending it.

## Milestones

1. **Baseline** — build and run the signed old UI, capture deterministic screens, inventory code paths, record states and release restrictions.
2. **Shared behavioral seam** — add critical accessibility identifiers, a Debug/test shell selector, and shared UI-test helpers.
3. **Foundation** — replace theme tokens with semantic neutral surfaces; add Research/History/Settings destinations without duplicating `AppModel` state.
4. **North-star flow** — discovery -> company -> question -> pending -> answer -> citation -> filing/source -> save -> History revisit.
5. **Remaining parity** — history, refresh, errors, credits, StoreKit, rewards, preferences, legal, reset, Debug/Release controls.
6. **Accessibility and layout** — light/dark, compact/large iPhone, Dynamic Type including accessibility size, VoiceOver order/labels, Increased Contrast, Differentiate Without Color, Reduce Motion, keyboard.
7. **Parity gate** — run old and new shared tests, StoreKit scenarios, unit tests, Release build, and screenshot comparison; resolve every unexplained matrix gap.
8. **Cutover** — make the redesign the only root, delete the shell switch and obsolete drawer/entry/presentation files, regenerate the Xcode project, rerun the full suite, and update parity results.

Milestones 1–8 are complete. Pre-cutover old/new UI evidence and post-cutover unit/UI result bundles are retained under `artifacts/ui-redesign-2026-07-13/results/`; the final StoreKit and Release-device result bundles are listed in `FEATURE_PARITY.md`.

## Evidence outputs

- `docs/ui-redesign/*.md`
- `artifacts/ui-redesign-2026-07-13/baseline/`
- `artifacts/ui-redesign-2026-07-13/redesign/`
- Xcode result bundles under `artifacts/ui-redesign-2026-07-13/results/`
- Final build/test/store/accessibility results recorded in `FEATURE_PARITY.md` and the completion report.
