# Kabuyomi UI replacement completion report

Date: 2026-07-14

## 1. New information architecture

Kabuyomi is now an iPhone-native company research workspace with three non-overlapping root destinations:

- **Research**: company discovery, recent companies, the active company workspace, questions and answers, filing scope, sources, citations, save, and refresh.
- **History**: explicitly saved companies and persisted research records, showing the latest stored question, answer count, and activity time. It no longer duplicates Research recents.
- **Settings**: credits, StoreKit products and management, preferences, release-safe device information, legal/support, local data, and Debug-only developer tools.

## 2. Final navigation model

On iPhone, root destinations use the system tab bar. Company, sources, citation details, Credits, and device/support details use native pushed destinations with the tab bar hidden. The native left-edge back gesture is preserved, with a narrow SwiftUI leading-edge fallback for nested research destinations.

Kabuyomi currently declares `TARGETED_DEVICE_FAMILY = 1`; iPad is not a supported product target, so no separate iPad navigation was introduced and the deployment target remains iOS 17.0.

## 3. Preserved capabilities

Preserved capabilities include first launch, company search/open/save/remove/switch, active-company restoration, recent and saved company records, filing selection/history/refresh, summary and financial formatting, question submission, non-streaming pending state, retry and AI consent, conversation persistence, citation/source/document opening, source translation, credit balance, subscription and consumable products, purchase states, unfinished purchase recovery, restore, rewarded credits, account recovery, settings, legal/support, local-data reset, Debug controls, release restrictions, and release-safe device authentication status.

No unsupported cancellation control or per-answer bookmark model was invented.

## 4. Parity summary

The complete capability/state matrix is in `FEATURE_PARITY.md`. All previously reachable presentation capabilities have a redesigned entry point. StoreKit rows previously blocked by the lack of a local configuration now pass. The existing pre-cutover shared old/new suite passed 4/4; final unit, normal-use UI, StoreKit, and physical Release checks pass.

## 5. Old components removed

Removed presentation-only files:

- `ConversationEntryView.swift`
- `SearchView.swift`
- `CompanyView.swift`
- `CompanyComposer.swift`
- `CompanyLibraryDrawer.swift`
- `CompanySummaryDrawer.swift`
- `CompanyTimeline.swift`
- `CompanyTopBar.swift`
- `CompanyUIShared.swift`

The temporary old/new shell switch was also removed. `AppRootView` now has one production root.

## 6. New screens and components

- `RedesignRootView` and its Research, History, and Settings navigation surfaces
- company discovery and active workspace
- filing/source browser and source detail
- excerpt-derived source preview support
- compact research composer/status region
- Debug-only StoreKit purchase-sheet harness for safe UI automation

## 7. Files changed

Production presentation changes are concentrated in `AppRootView.swift`, `Theme.swift`, `RedesignRootView.swift`, `ResearchPresentationSupport.swift`, `CompanyMessageRow.swift`, `CreditView.swift`, and `SettingsView.swift`. `AppModel.swift` only adds a pure release-safe device-key suffix formatter. `KabuyomiApp.swift` adds the compile-time Debug-only StoreKit test entry. `project.yml` defines test targets/schemes and excludes test StoreKit resources from the app.

Discovery, specification, parity, state, execution, audit, validation, and completion documents live under `docs/ui-redesign/`.

## 8. Tests added or changed

- `AppModelTests`: source-list preview and release-safe device information checks
- `ShellParityUITests`: discovery, workspace, sources, root roles, secondary actions, pushed settings/billing, and native edge-swipe paths
- `StoreKitEndToEndTests`: catalog, verified purchase/restore, unfinished consumable, and pending Ask to Buy
- `StoreKitCancellationUITests`: real Xcode purchase-sheet success and cancellation

## 9. Build and test results

- iOS unit tests: 208 passed, 0 failed — `artifacts/ui-redesign-2026-07-14/results/final-unit.xcresult`
- normal-use UI tests: 8 passed, 0 failed — `artifacts/ui-redesign-2026-07-14/results/final-normal-ui.xcresult`
- final combined UI rerun: 11 passed, 0 failed (9 shell/navigation scenarios and 2 StoreKit purchase-sheet scenarios)
- signed Release device build: passed
- signed Release install and launch on iPhone 17 Pro: passed
- Release physical-device UI/authentication test: 1 passed, 0 failed — `artifacts/ui-redesign-2026-07-14/results/release-device-auth-ui.xcresult`
- Worker, SEC fetcher, and legal/App Review checks remain recorded in `FEATURE_PARITY.md`

## 10. StoreKit results

StoreKit service scenarios passed 4/4 and real Xcode purchase-sheet UI scenarios passed 2/2. Success, cancellation, pending, unfinished transaction, finish boundary, and restore are covered. The five product IDs and existing quantities are unchanged. Local placeholder prices are test-only; production UI remains StoreKit-price-authoritative.

## 11. Accessibility results

The earlier representative accessibility audit and light/dark/Dynamic Type review remain recorded. Per user direction, the July 14 structural follow-up did not use the separate accessibility audit as its priority gate; it kept touch targets, readable labels, semantic text, scrollability, and system navigation as guardrails. No additional accessibility-only visual redesign was performed.

## 12. Before-and-after screenshots

Baseline evidence: `artifacts/ui-redesign-2026-07-13/baseline/`.

Final redesign evidence: `artifacts/ui-redesign-2026-07-13/redesign/` and `artifacts/ui-redesign-2026-07-14/structural-refinement/`.

The structural set includes the original obstructing authentication banner and final Research, Sources, History, Credits, and billing-failure screens.

## 13. Known limitations

- The product is iPhone-only; iPad is not in the supported target family.
- Answer generation is request/response rather than token streaming, matching current behavior.
- A live question was not charged during safe validation because production writes and credit consumption were prohibited; handler identity, pending/error behavior, persistence, and request contracts are covered by tests.
- The pre-cutover shared old/new UI result covers four critical shell flows, while broader exceptional-state parity is established by shared handlers plus unit/contract tests rather than a 20-case old-shell XCUITest suite.

## 14. Unresolved risks

- Real App Store purchase behavior still depends on App Store Connect product availability and the production backend at release time; local StoreKit Test cannot prove external service availability.
- Physical testing used an Apple Development-signed Release configuration, so `get-task-allow` is present. The app configuration, production endpoint, optimized Release compilation, and production App Attest entitlement were verified; final App Store distribution signing remains an archive/distribution step.

## 15. Business behavior change confirmation

No business behavior was intentionally changed. The only product changes are presentation, information architecture, navigation, and release-safe display of existing authentication state. Research and History were separated without changing saved/recent persistence semantics.

## 16. Safeguard preservation confirmation

API endpoints and payloads, AI request construction, response handling, numerical/date/currency semantics, source selection, credit accounting, product IDs, StoreKit prices, entitlement and restore logic, persistence keys/schemas/cache semantics, authentication and security, feature flags, localization architecture, App Review safeguards, Debug/Release boundaries, and the iOS 17.0 deployment target were preserved. Release inspection confirmed the production Worker URL, production App Attest entitlement, absence of the Debug StoreKit harness, and absence of the local `.storekit` configuration from the app bundle.

## 17. Final deployment and repository closure

Final validation and Cloudflare closure were performed on 2026-07-14 JST:

- Worker type checking passed; 77 Worker test files and 1,131 tests passed.
- All 18 production and test D1 migrations are applied; both environments reported no pending migrations.
- The test Worker `kabuyomi-api-test` was deployed as version `0f87049a-a64b-45ed-85ed-333bf75dabe9` with release candidate `ff298a1053695e2df4399177be2a28d4c148a4594c9d12dfbc1d0d71c071b7ea`. Identity and release smoke checks passed.
- The production Worker contains no source change from this UI replacement and already serves the same release candidate as version `e60580e7-e7f5-449d-97b2-d36854c24896`. The production release smoke suite passed all active capability guardrails.
- A protected production no-op redeploy was intentionally not forced: the repository's exact-candidate evidence guard rejected it with `manifest_release_candidate_id_mismatch`. The safeguard was not bypassed because the consumed quality waiver does not authorize a new production deployment and there is no Worker payload change to deploy.
- Cloudflare Pages project `kabuyomi-legal-site` was deployed as production deployment `ab2834b8-8875-4c90-aa00-888f5c182ec1`. The canonical site and privacy, terms, support, commercial-disclosure, and `app-ads.txt` routes returned HTTP 200.
- SEC fetcher tests passed 15/15 and the legal-site validator passed.

The legacy generic staging smoke script still expects anonymous `/v1/usage` access and therefore receives the production-correct HTTP 401 response. The identity-aware and release-aware smoke suites are the authoritative checks and both passed.
