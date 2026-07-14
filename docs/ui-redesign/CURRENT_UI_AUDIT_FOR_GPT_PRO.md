# Kabuyomi current UI audit for GPT Pro

**Audit date:** July 14, 2026
**Status:** Current-state audit, not an approved redesign
**Builds inspected:** Debug and Release, iPhone 16e Simulator, iOS 26.2, Japanese

> Post-audit status (2026-07-14): the structural recommendations were implemented. A test-target-only StoreKit configuration was subsequently added, so the StoreKit limitation recorded in this audit is historical; final results are in `FEATURE_PARITY.md` and `STOREKIT_VALIDATION.md`.
**Supported product target:** iPhone only (`TARGETED_DEVICE_FAMILY = 1`), iOS 17.0 minimum

## How to use this package

Send this document to GPT Pro together with:

- `artifacts/current-ui-audit-2026-07-14/20-core-ui-contact-sheet.png`
- `artifacts/current-ui-audit-2026-07-14/21-research-variants.png`
- The individual screenshots in `artifacts/current-ui-audit-2026-07-14/` when full-resolution inspection is needed.

The contact sheets are indexes, not substitutes for the full-resolution images.

## Executive summary

Kabuyomi now has a coherent, document-first foundation. It clearly identifies the active company and filing, treats SEC evidence as a first-class object, uses native navigation, separates Research from saved/history content, adapts credibly to dark mode, and keeps billing language restrained.

The current UI is still materially harder to use than it should be. The largest problems are structural rather than decorative:

1. At accessibility text sizes, the persistent tab bar and fixed composer/status region consume and visually cover a large part of the Research document.
2. The top-level tab bar persists in deep, focused tasks such as source browsing, citation reading, and settings sheets. It competes with the current task and obscures content near the bottom.
3. Source rows are nearly indistinguishable from each other, even though source verification is one of the product's core promises.
4. Source detail is presented as an unstructured raw-text block; paragraph boundaries can be lost, and primary actions fall below the first viewport.
5. The company workspace spends too much of the first viewport repeating identity and filing metadata before the actual research.
6. Saved research/history is technically distinct from Research, but its rows do not provide enough semantic preview to support recognition and resumption.

The next design pass should solve navigation depth, reading space, source scanability, and Dynamic Type behavior before changing colors, materials, or visual styling.

## Product behavior that must remain unchanged

The presentation and information architecture may change. The following may not be reinterpreted, duplicated, or replaced:

- API endpoints, request payloads, response handling, AI request construction, and source-selection semantics
- Credit consumption, server-authoritative balances, product identifiers, StoreKit pricing, entitlement logic, purchase completion, restore, pending, cancellation, and failure handling
- Persistence keys, Core Data schema, cache behavior, active-company restoration, filing selection, conversations, and saved-company behavior
- Authentication, Keychain/App Attest behavior, security controls, release restrictions, feature flags, legal safeguards, and Debug-versus-Release boundaries
- Financial calculations, numerical precision, currency/percentage/sign/date/time-zone formatting semantics
- Localization architecture, Japanese copy coverage, iOS 17.0 deployment target, and iPhone-only support

Do not invent missing backend data. In particular, Kabuyomi has saved companies plus persisted filing conversations; it does not currently have a separate per-answer bookmark domain model. The API is non-streaming, and there is no public generation-cancel handler.

## Audit scope and method

This audit combined:

- Fresh, current-run Simulator inspection of the production presentation root
- Release and Debug comparison
- Light mode, dark mode, and Accessibility Large screenshots
- Direct inspection of the SwiftUI navigation, Research, History, Settings, Credits, persistence, and release-gating paths
- A fresh representative XCUITest accessibility audit
- Cross-checking the current feature-parity and state-matrix documentation against the rendered app

No production purchase, destructive local reset, production credit grant, rewarded-ad grant, or real paid AI request was performed. Those states are described from the current handlers, tests, and visible safe UI only.

## Current information architecture

### Top level

Kabuyomi currently uses three tabs:

1. **Research** — company discovery, recent companies, active company workspace, filing scope, questions and answers, sources, and citation detail.
2. **History** — explicitly saved companies and persisted/cached filing research. Generic recent-company switching belongs to Research, not History.
3. **Settings** — credits and StoreKit surfaces, AI consent, display preference, device/support information, legal links, and local-data controls. Debug-only diagnostics are compile-time gated.

Each top-level destination owns a `NavigationStack`. Research navigates from discovery to company, source browser, and citation/source detail. The tab bar remains mounted throughout these nested destinations.

### Current Research flow

`Research discovery → company workspace → sources browser → source detail`

Questions and existing answers live within the company workspace. The composer is installed as a bottom `safeAreaInset`. Company switching is available by returning to discovery with the native back action/left-edge swipe or through the secondary company menu.

### Research and History are not behaviorally duplicates

- **Research** answers: “Which company am I researching now, and what can I ask or verify?” It owns search, starters, recents, active context, research content, filing scope, and the composer.
- **History** answers: “What did I explicitly retain, and what prior filing research can I reopen?” It owns saved companies and conversation-bearing/cached filing records.

This separation is conceptually correct. The remaining problem is that History does not yet communicate enough about each retained research item to make resumption efficient.

## Screen-by-screen audit

1. **Research discovery — Healthy foundation**
   Evidence: `01-research-discovery.jpg`
   - Search is immediate and prominent.
   - The SEC-first product proposition is understandable in Japanese.
   - Starter companies give the empty/new-user state a valid next action.
   - The screen does not yet prioritize “continue last research” once a user has meaningful history.

2. **Company workspace — Needs structural refinement**
   Evidence: `02-company-workspace-top.jpg`
   - Active company, ticker, filing form, filing date, freshness, and source count are unambiguous.
   - The research document is clearly more important than chat chrome.
   - The first viewport repeats company/filing context across the navigation title, company header, and filing panel before showing much evidence.
   - Save, switch, and refresh are hidden in the ellipsis menu; saved state is not visible in the main reading surface.
   - The fixed composer plus persistent tab bar takes significant height even when sending is unavailable.

3. **Sources browser — Core capability, weak scanability**
   Evidence: `04-sources-browser.jpg`
   - Filing identity and the SEC-original action are clear.
   - Every visible evidence row has essentially the same title (`10-Q Item 2 / Part I, Item 2`). The user cannot predict which row supports which claim without opening each one.
   - The tab bar visibly overlaps the final rows.
   - The list should use existing excerpt/section data to expose the semantic difference between rows without inventing new metadata.

4. **Source detail — Credible evidence, poor long-form reading**
   Evidence: `05-source-detail.jpg`
   - The UI distinguishes SEC primary evidence from synthesis.
   - Filing type, date, and section context are visible.
   - The raw excerpt is a large uninterrupted block, and a visible paragraph-boundary defect produces `OperationsThis Item`.
   - Translation and open-original actions are not visible in the first viewport; the persistent tab bar competes with the excerpt.
   - Long excerpts need paragraph preservation, optional progressive disclosure, and stable source actions without changing the underlying text or translation behavior.

5. **History — Correct role, insufficient recognition cues**
   Evidence: `06-history-populated.jpg`
   - The screen correctly contains saved/history content rather than duplicating generic recent companies.
   - The single row exposes ticker, filing form/date, and answer count, but not the question, answer topic, useful excerpt, or last activity.
   - Large unused space makes the screen feel unfinished when only one item exists.
   - Improve the row with data already persisted today; do not create a fake “research title” or bookmark model.

6. **Settings — Understandable, bottom-content collision**
   Evidence: `07-settings.jpg`, `11-device-support-release.jpg`
   - Credits, AI consent, display preference, support, and legal functions have understandable groupings.
   - The Release device/support surface is appropriately privacy-conscious: it exposes a limited support code and status, not raw credentials or internal endpoints.
   - The top-level tab bar sits over the lower settings content.
   - The Release support sheet is readable but card-heavy and long; legal actions are pushed below the first viewport.

7. **Credits — Honest billing state, weak first-fold prioritization**
   Evidence: `08-credits.jpg`
   - Balance, buckets, current plan, plan comparison, purchase availability, additional credits, restore, and management remain in one coherent destination.
   - The unavailable-purchase state is explicit and does not simulate success.
   - A zero-balance summary dominates the first viewport, while purchase/recovery actions are lower.
   - The hierarchy should adapt to what is currently actionable without changing capability gates.

8. **Subscription plans — Clear prices, poor disabled-state legibility**
   Evidence: `09-subscription-plans.jpg`
   - StoreKit-provided prices and tier quantities are visible.
   - Lite, Pro, and Max are easy to compare structurally.
   - Disabled plan cards and “currently unavailable” labels are very low contrast.
   - Price browsing and action availability should be visually distinct: a product can remain legible even when its purchase button is disabled.

9. **Debug support surface — Correctly excluded from Release**
   Evidence: `10-device-support-debug.jpg`, `11-device-support-release.jpg`
   - Debug contains development API, test purchase, SSV, and diagnostic controls.
   - Release removes those controls and shows only safe support, authentication status, AI consent, and legal information.
   - This difference is intentional and must be preserved.

10. **Dark mode — Healthy**
    Evidence: `12-research-dark.jpg`
    - Neutral surfaces, evidence tinting, text hierarchy, and disabled composer states adapt coherently.
    - No decorative red/green or excessive transparency is introduced.

11. **Accessibility Large — Critical failure**
    Evidence: `13-research-accessibility-large.jpg`, `21-research-variants.png`
    - Company and filing metadata reflow, but the fixed composer/status area and floating tab bar occupy a disproportionate share of the compact screen.
    - Research text is visibly obscured behind the lower controls.
    - The composer placeholder truncates, the send control becomes spatially detached, and the document viewport becomes too small for the core reading task.
    - This is a layout architecture issue, not a spacing tweak.

## Prioritized findings

| Priority | Finding | User impact | Evidence | Recommended design direction |
|---|---|---|---|---|
| P0 | Accessibility text sizes cause Research content to be occluded by the composer/status region and tab bar. | Core content becomes difficult or impossible to read. | `13`, `21` | Give the active workspace one coordinated bottom region; provide Dynamic Type-specific reflow; never layer persistent navigation over reading content. |
| P1 | The top-level tab bar persists inside deep reading and settings destinations. | Reduces available space, competes with local navigation, and obscures final rows/actions. | `02`, `04`, `05`, `07` | Hide or structurally collapse the tab bar after entering a focused Research/Settings destination while retaining native back and left-edge swipe. |
| P1 | Source rows are visually and semantically indistinguishable. | Users must open sources by trial and error, undermining evidence verification. | `04` | Use existing excerpt, section title, claim association, and source kind to produce differentiated previews. |
| P1 | Source detail loses paragraph structure and buries source actions. | Long SEC text is tiring to read; verification actions are not discoverable at the point of need. | `05` | Preserve paragraph boundaries; keep source context and open-original/translate controls reachable; use progressive disclosure for very long excerpts. |
| P1 | The company workspace repeats context before research content. | The first viewport is metadata-heavy and shows too little evidence. | `02` | Compress company and filing identity into one stable, adaptive header; prioritize summary and findings. |
| P1 | Save/switch/refresh are all hidden behind one overflow control. | Frequent actions and saved state are hard to discover. | `02` | Keep one or two contextually frequent actions visible; retain the rest in the menu. Do not duplicate handlers. |
| P2 | History rows lack semantic previews. | Reopening prior research depends on remembering ticker/date rather than recognizing the question or answer. | `06` | Surface persisted question/answer snippets and last activity when available; do not invent a new title model. |
| P2 | Settings and billing surfaces are long and card-heavy. | Important actions and legal/recovery paths fall below the fold. | `07`–`11` | Use native sections and disclosure hierarchy; reserve cards for bounded status objects. |
| P2 | Disabled subscription cards have weak contrast. | Product information becomes unnecessarily hard to read when purchasing is unavailable. | `09` | Keep descriptive content legible; apply disabled styling only to the unavailable action. |

## Accessibility findings

### Fresh automated result

The current representative XCUITest accessibility audit **failed 1 of 1** with `Label not human-readable`.

- Result bundle: `artifacts/current-ui-audit-2026-07-14/accessibility-audit.xcresult`
- Failing element screenshot: the first key-finding label, visually rendered as an incomplete sentence (`売上高は前年同期比15.7%増の`).
- The failure indicates that the element's accessibility label is not a complete human-readable utterance. Its source text is visually split across lines/elements.

This result conflicts with the older completion note in `FEATURE_PARITY.md` that described the representative audit as passing. The fresh July 14 run is the current evidence and should supersede that statement until the issue is fixed and the test reruns green.

### Additional accessibility risks

- Accessibility Large visibly fails the no-occlusion requirement.
- Source rows expose repeated near-identical descriptions, creating poor VoiceOver scanability even if each row is technically labeled.
- Automation inspection exposed both the previous workspace hierarchy and the current Sources hierarchy during nested navigation. Treat this as a VoiceOver focus-order risk that requires device verification, not yet as a confirmed defect.
- Disabled subscription information appears low contrast.
- Screenshot evidence cannot prove VoiceOver reading order, rotor behavior, keyboard navigation/avoidance, Reduce Motion, Differentiate Without Color, or full contrast compliance.

Required follow-up validation should include a real VoiceOver pass on discovery, company workspace, sources list, source detail, History, Credits, and Release support settings, plus rerunning the automated audit after label and layout corrections.

## Current visual system snapshot

- Native semantic typography with Dynamic Type
- Restrained neutral canvas and reading surfaces
- System blue as the primary accent
- Light evidence tint for the active filing/source context
- Thin separators and limited shadows
- Rounded containers for bounded context, sheets, and controls
- Tabular/monospaced digits for financial values where relevant
- System symbols with visible or accessible labels
- No decorative gradients, gamified investing cues, or red/green decoration

The design language is directionally appropriate. The next pass should reduce container and chrome density rather than replace the palette.

## Existing capabilities that remain reachable

- Company search, starter companies, recent companies, selection, active-company restoration, and switching
- Filing selection/history, current filing scope, refresh, summary, metrics, historical overview, and change analysis when supplied by the backend
- Asking a question, generation state, insufficient-credit state, consent gate, retry through preserved draft, answer history, and relaunch persistence
- Source browsing, citation opening, SEC-original opening, quote translation, and source excerpts
- Saving/removing companies and reopening saved or conversation-bearing filing research
- Credit balance and bucket breakdown, subscription/credit-pack product metadata, purchase/cancellation/pending/failure paths, interrupted purchase recovery, restore, rewarded credits, and account recovery when capability-enabled
- AI consent, display preference, Release-safe device/support information, legal links, local-data reset, and Debug-only diagnostics
- Authentication status, feature flags, capability gates, App Review restrictions, and Release safeguards

## States not safely exercised in this visual audit

The following should not be inferred as visually approved:

- Real paid AI completion and production credit deduction
- Live StoreKit purchase success, cancellation, pending transaction, interrupted transaction, and restore (the repository currently has no `.storekit` configuration)
- Rewarded-ad credit grant
- Destructive local reset
- Offline recovery across every screen
- Every authentication/App Attest failure mode
- Long company names, long citation titles, all supported localization strings, and every feature-flagged state
- Keyboard-open composer behavior and interactive left-edge swipe on a physical device during this specific audit run

## Brief for GPT Pro

Review the attached current-state UI as a senior iOS product designer. Do not propose a cosmetic reskin. Preserve all product behaviors and constraints listed above.

Please provide:

1. A diagnosis of the five most important structural usability problems, with screenshot-specific evidence.
2. A revised iPhone information architecture and navigation model that preserves native back and left-edge swipe.
3. A concrete solution for the active Research workspace that gives long-form content enough space while retaining filing context, credit state, composer gating, and send behavior.
4. A source-browser and source-detail structure that makes evidence rows distinguishable using only existing source data.
5. A History structure that remains distinct from Research and improves recognition/resumption without inventing a per-answer bookmark or generated title model.
6. A Settings and billing hierarchy that preserves every release restriction, StoreKit price, restore path, pending/cancellation/error state, and App Review disclosure.
7. Accessibility-specific recommendations for Accessibility Large, VoiceOver labels/order, contrast, touch targets, keyboard avoidance, and Reduce Motion.
8. A dependency-ordered implementation plan: navigation/chrome first, Research reading/composer second, sources third, History fourth, Settings/billing fifth, then accessibility validation.
9. A list of any recommendation that could accidentally change business, billing, persistence, API, security, or release behavior.
10. Textual wireframe descriptions for the key screens. Do not write production SwiftUI yet.

Reject any proposal that:

- adds unsupported AI confidence, fabricated sections, generated research titles, or new backend data
- merges Research and History into overlapping destinations
- makes the product resemble a generic chatbot or a trading dashboard
- hides evidence, pricing, restore, cancellation, pending, or failure semantics
- removes the native navigation hierarchy or left-edge back gesture
- requires a new dependency, a higher deployment target, iPad support, or business-logic duplication

## Screenshot index

| File | State |
|---|---|
| `01-research-discovery.jpg` | Research discovery, Japanese, light |
| `02-company-workspace-top.jpg` | AAPL active workspace, light |
| `03-company-workspace-scrolled.jpg` | Duplicate/unchanged scroll capture; exclude from primary review |
| `04-sources-browser.jpg` | Filing/source list |
| `05-source-detail.jpg` | SEC source excerpt detail |
| `06-history-populated.jpg` | History with one persisted research record |
| `07-settings.jpg` | Top-level Settings |
| `08-credits.jpg` | Credit balance and purchase-unavailable state |
| `09-subscription-plans.jpg` | StoreKit plan comparison |
| `10-device-support-debug.jpg` | Debug-only diagnostics/settings |
| `11-device-support-release.jpg` | Release-safe device/support settings |
| `12-research-dark.jpg` | Research workspace, dark mode |
| `13-research-accessibility-large.jpg` | Research workspace, Accessibility Large |
| `20-core-ui-contact-sheet.png` | 3 × 3 overview: discovery, workspace, sources, detail, History, Settings, Credits, plans, Release support |
| `21-research-variants.png` | Standard light, dark, and Accessibility Large comparison |

## Bottom line

The current interface has a sound product direction and credible source transparency, but it has not yet solved focused reading on a compact phone. The immediate design target is not a new aesthetic. It is a cleaner task hierarchy: top-level navigation when choosing a destination, focused native navigation when researching, a single non-overlapping bottom interaction region, differentiated evidence, and a History surface optimized for resumption.
