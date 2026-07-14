# Visual Refinement

Status: complete
Audit device: iPhone 17 Pro, iOS 26.2 Simulator
Audit date: 2026-07-13
Scope: presentation only. The accepted information architecture, navigation model, stores, services, billing, persistence, feature flags, and release restrictions remain unchanged.

## Direction

Kabuyomi should feel like a quiet, authoritative research desk: warm paper-like reading surfaces, compact financial metadata, editorial typography, and evidence that is always visibly connected to the claim it supports. The visual hierarchy should move from company identity, to filing context, to synthesis, to evidence, to action. Blue is reserved for navigation and source verification; neutral surfaces carry the reading experience.

The system should avoid both extremes: it is neither a chat product made of bubbles nor a dashboard made of interchangeable cards. Long-form research is the primary object. Lists, settings, and billing use the same spacing, type hierarchy, separators, and compact metadata language.

## Baseline evidence

- `artifacts/ui-refinement-2026-07-13/current/01-workspace-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/current/02-sources-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/current/03-source-detail-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/current/04-library-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/current/05-settings-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/current/06-credits-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/current/07-company-switcher-light.jpeg`

## Findings

| Severity | Screen / component | Problem | Why it weakens the product | Concrete refinement |
| --- | --- | --- | --- | --- |
| Critical | Company workspace | Company ticker is repeated in the navigation title and page header, while company name, filing identity, freshness, and actions are split into unrelated rows. | The first viewport spends too much space restating identity but still fails to establish a single authoritative research context. | Use a compact branded navigation identity, make the company name the editorial headline, place ticker/exchange/form metadata on one restrained line, and group filing freshness with its source action. |
| Critical | Research document | Overview, findings, metrics, and evidence form one undifferentiated white stream with similar weights and weak vertical cadence. | The answer reads like default text in a scroll view, not an authored financial research document; scanning and returning to evidence are slower. | Establish an editorial column, labeled section rhythm, deliberate measure/leading, a distinct synthesis lead, compact metric band, and source-adjacent evidence rows. |
| Critical | Composer | The credit warning, purchase button, input field, send button, tab bar, and safe-area material stack into a large control shelf. | The control surface obscures content and visually dominates the research it is meant to support. Disabled state looks washed out rather than intentional. | Compress status into a single contextual line, integrate the credit recovery action, use a stable bordered field, keep the send control at 44 points, and reduce material depth while preserving all gates and handlers. |
| Major | Sources and citation detail | The source browser is a generic rounded-card list; repeated citations have equal visual weight and weak document provenance. The detail sheet nests one translucent sheet inside another. | Primary-document authority is visually diluted. Users must parse repeated titles before understanding filing, date, excerpt, or original destination. | Create a document-led header, use separator-based evidence rows with provenance labels, number or distinguish evidence consistently, and present excerpts on an opaque reading surface with a clear original-source action. |
| Major | Library | A single large rounded row floats in a mostly empty grouped background. There is no visible relationship between saved companies, filing history, and research recency. | The screen feels unfinished and generic even when its behavior is correct. Empty space does not communicate product structure. | Add an editorial intro/count, use full-width rows with compact ticker monograms, recency and filing metadata, and purposeful empty-state guidance without inventing capabilities. |
| Major | Settings | Every setting is presented as a similar white capsule, section labels are low-contrast, and destructive/reset content competes with normal preferences. | Default grouped-list styling makes account, AI consent, display, support, and destructive actions feel equally important. | Use a consistent inset list with stronger section labels, compact leading symbols, explanatory footnotes, and a visually separated destructive area. Keep native switches and every existing handler. |
| Major | Credits | The page has many nested rounded rectangles, weak distinction between balance, availability restriction, plan, packs, and management, and an overly soft background. | A financial/billing surface needs calm precision and trust; excess card nesting makes the state harder to verify. | Let theme changes sharpen surfaces and separators; promote the balance as a precise numeric statement, use fewer containers, and make unavailable/pending state legible without manipulative emphasis. |
| Major | Company discovery / switcher | The title, search field, marketing statement, section heading, and company row use standard list spacing with no branded hierarchy. The sheet close button occupies a visually heavy glass capsule. | Company switching is a critical workflow but currently looks like a generic modal search example. | Add a concise research-desk masthead, use a denser search/result rhythm, introduce a restrained ticker marker, and keep close/search controls native but visually quieter. |
| Minor | Navigation chrome | Three icon-only trailing actions have equal size and emphasis; the company switch action is separated on the opposite side without visible company context. | Frequent source inspection, save, and refresh do not have equal importance. The toolbar reads as an icon cluster rather than a research navigation model. | Keep the same actions and accessibility labels, but elevate source inspection, de-emphasize refresh, and show a compact company identity in the principal position. |
| Minor | Typography | Most hierarchy comes from `.bold()` and large size changes. Japanese body text has inconsistent leading; captions and metadata frequently use the same tone. | Financial/editorial credibility depends on type rhythm and numeric precision more than ornament. | Add named semantic text roles, explicit line spacing where long-form text needs it, tabular digits for metrics/credits/dates, and distinct metadata/eyebrow treatments that still scale with Dynamic Type. |
| Minor | Dark mode | System grouped backgrounds and opacity-derived blues can collapse into multiple similarly dark rounded panels. | Depth and evidence boundaries become ambiguous; source chips risk glowing more than the actual content. | Define appearance-aware paper, canvas, elevated, separator, and source-tint colors; use borders and tonal contrast rather than shadows or heavy materials. |
| Minor | Accessibility sizes | Fixed horizontal compositions in metadata, citations, metrics, and composer can become tall or compete for width. | Accessibility Large must preserve reading order and action proximity, not simply wrap every compact row unpredictably. | Switch important rows to vertical layouts at accessibility sizes, keep actions at least 44 points, allow metadata to wrap, and verify occlusion/keyboard behavior in the live app. |

## Five largest weaknesses

1. The company and filing context is redundant but still not cohesive.
2. The research document lacks editorial hierarchy and a recognizable evidence system.
3. The composer and tab-bar stack consumes too much visual attention and content height.
4. Source provenance is presented as generic list/chip UI instead of primary-document evidence.
5. Library, Settings, and Credits fall back to rounded grouped-card conventions, so the product loses a coherent identity outside Research.

## Token plan

| Token group | Baseline | Refinement |
| --- | --- | --- |
| Canvas | System grouped background | Appearance-aware neutral research canvas |
| Paper | System background / secondary grouped background | Opaque reading paper with subtle warm/cool adaptation |
| Elevated | Generic rounded white card | Reserved elevated surface for navigation, input, and transactional emphasis |
| Separator | Low-opacity primary color | Explicit appearance-aware hairline with increased-contrast support |
| Accent | System blue | Deep ink blue for navigation and verified-source actions only |
| Source tint | Blue opacity pills | Quiet blue-gray evidence tint with stable border |
| Text | Label / secondary label | Primary ink, secondary ink, metadata ink, and inverse text roles |
| Spacing | Ad hoc 8/12/16/20/24/26 | 4-point rhythm: 4, 8, 12, 16, 20, 24, 32, 40 |
| Radius | Mostly 16-24 | 10 for compact controls, 14 for input/elevated rows, 18 only for major transactional surfaces |
| Motion | Default/ease-out | Short opacity/position transitions and restrained press feedback; Reduce Motion remains authoritative |

## Pass plan

### Pass 1 — Macro hierarchy

- Restructure company identity, filing context, research spacing, source browser, Library, and Settings surfaces.
- Reduce nested card usage and create a consistent editorial column.
- Rebalance composer and navigation chrome without changing any action or gate.
- Build, run shared UI tests, capture Research, Sources, Library, and Settings.

### Pass 2 — Typography and components

- Apply named text roles, line measure, leading, tabular figures, evidence rows, citation controls, metric treatments, and compact company rows.
- Refine source detail and transactional surfaces using the same tokens.
- Build, run tests, inspect long-form and compact-width behavior, and capture comparable states.

### Pass 3 — Consistency and finishing

- Audit light/dark, Accessibility Large, contrast, Japanese wrapping, safe areas, keyboard/composer, loading/pending, and disabled/credit states.
- Remove visual inconsistencies and confirm action sizes, focus, pressed states, and source provenance.
- Run final supported builds/tests and capture the final evidence set.

## Behavior guardrail

No refinement in this document authorizes changes to handlers, request construction, billing/accounting, product identifiers, persistence, caching, authentication, analytics, feature flags, localization architecture, release safeguards, deployment target, or navigation reachability. Visual wrappers may be reorganized only around the same observable controls and state.

## Completed refinement

### Before / after / why

| Area | Before | After | Why |
| --- | --- | --- | --- |
| Company identity | Repeated ticker dominated the navigation bar and page while filing metadata was split across rows. | Company name is the editorial anchor; ticker and form are compact metadata; filing freshness and evidence count live in one source surface. | A user can identify the active company and research context in the first viewport without parsing duplicate labels. |
| Research hierarchy | Default bold headings, bullet points, and citation capsules formed one flat white stream. | A measured reading column, synthesis lead, section cadence, quote markers, rules, and document-led evidence rows create an authored research document. | Synthesis, facts, evidence, and source actions now have distinct visual roles without turning every paragraph into a card. |
| Citations | Small horizontal pills repeated generic labels and concealed provenance. | Full-width, 44-point evidence actions expose the source label and section title with a document symbol and disclosure affordance. | Citations remain discoverable while primary-document authority is more legible and less visually noisy. |
| Composer | Two black capsules, a soft input, circular send control, material shelf, and tab bar competed with the document. | A single compact status line, integrated recovery action, bordered input, stable send control, and opaque paper separator reduce the shelf. | The composer still exposes every credit and send gate but no longer reads as the page's focal point. |
| Library and Settings | Floating grouped-list cards made secondary destinations look like unrelated default SwiftUI screens. | Shared canvas/paper tokens, editorial introductions, compact company markers, plain rows, and separator-led sections connect them to Research. | Top-level destinations now share a visual grammar while retaining distinct purposes. |
| Dark mode | System grouped grays and opacity-derived blues produced similarly weighted dark panels. | Appearance-aware canvas, paper, elevated, evidence, separator, ink, and accent roles create deliberate tonal depth. | Reading surfaces, navigation, evidence, and disabled controls remain distinct without using pure-black card stacks. |

### Pass 1 — Macro hierarchy

Visible changes:

- Rebuilt the first viewport around company identity, filing context, synthesis, and evidence.
- Replaced the generic source-card sheet with a separator-led document browser.
- Reduced composer height and removed the competing black status/purchase capsules.
- Changed Discovery, Library, and Settings from floating inset cards to a shared editorial canvas and row system.
- Established appearance-aware canvas, paper, elevated, evidence, separator, ink, and accent tokens.

Evidence:

- `artifacts/ui-refinement-2026-07-13/pass-1/01-workspace-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/pass-1/02-sources-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/pass-1/04-settings-light.jpeg`

Validation: Debug Simulator build passed. The company/search/source and top-level/billing UI flows passed. The accessibility audit exposed custom-title Dynamic Type behavior, which was carried into Pass 3 and fixed rather than ignored.

### Pass 2 — Typography and components

Visible changes:

- Introduced a calmer Japanese editorial type hierarchy and more generous answer leading.
- Replaced citation pills with source rows that include provenance and 44-point targets.
- Added rules and quote markers for evidence, and separator-led metric treatments.
- Refined question and answer presentation so synthesis is distinct from source material.
- Refined source detail into an opaque excerpt reading surface with a clear SEC-original action.
- Added Library context, counts, and compact company markers.

Evidence:

- `artifacts/ui-refinement-2026-07-13/pass-2/01-workspace-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/pass-2/02-source-detail-light.jpeg`
- `artifacts/ui-refinement-2026-07-13/pass-2/04-library-light.jpeg`

Validation: Debug Simulator build passed; the rendered Research, Source Detail, and Library screens were inspected against Pass 1.

### Pass 3 — Consistency and finishing

Visible changes:

- Replaced custom navigation-title typography with a fully scalable native title.
- Removed tracked microtype that did not respond correctly in the automated Dynamic Type audit.
- Strengthened tertiary metadata contrast and source-label readability.
- Replaced fixed numeric evidence markers with scalable semantic symbols.
- Removed citation truncation at larger text sizes.
- Tuned dark-mode tonal separation and Increased Contrast behavior.
- Kept all user-facing additions in Japanese.

Evidence:

- `artifacts/ui-refinement-2026-07-13/pass-3/01-workspace-light.png`
- `artifacts/ui-refinement-2026-07-13/pass-3/02-workspace-dark.png`
- `artifacts/ui-refinement-2026-07-13/pass-3/03-workspace-accessibility-large.png`
- `artifacts/ui-refinement-2026-07-13/pass-3/04-workspace-increased-contrast.png`

Validation:

- Debug Simulator build: passed.
- Release Simulator build: passed.
- Unit tests: 201 passed, 0 failed.
- Production-shell UI tests: 3 passed, 0 failed.
- Representative XCTest accessibility audit: passed, including Dynamic Type and contrast checks.
- StoreKit diagnostics and billing contract tests are included in the passing unit suite. No production purchase was attempted.

## Materially changed screens and components

Screens:

- Research company workspace
- Company discovery and switching
- Filing and source browser
- Source detail
- Library
- Settings
- Credit and billing surfaces through the unified theme/surface system
- Light, dark, Increased Contrast, and Accessibility Large presentations

Components:

- Company identity header
- Filing context surface
- Research overview and synthesis lead
- Evidence list and citation rows
- Metric presentation
- User question and AI research answer
- Pending/loading presentation
- Composer and credit recovery status
- Company rows
- Library introduction and history rows
- Settings sections and destinations
- Shared colors, surfaces, borders, radii, and pressed-state feedback

## Remaining visual weaknesses

- At Accessibility Large, the system tab bar plus required composer necessarily occupies a substantial portion of the compact viewport; content remains scrollable and unobscured at the end position, but the reading viewport is smaller.
- The three required toolbar actions still form a visible cluster on compact iPhone widths. Their hierarchy is improved through content/context changes, but removing or hiding actions would reduce discoverability and was not authorized.
- Billing remains information-dense because balance categories, plan status, availability restrictions, packs, restore, usage, and rewarded-credit rules must all remain reachable. The refined token system reduces card competition, but further simplification would require a separate behavioral/product decision.
- iPad was intentionally not introduced; the accepted product remains iPhone-only.

## Functional change statement

No functional behavior changed. The refinement did not alter navigation destinations, handlers, API requests or responses, AI construction, source semantics, billing or credit accounting, StoreKit product identifiers, persistence, caches, authentication, security, feature flags, localization architecture, deployment target, or Debug/Release safeguards.

## 2026-07-14 structural follow-up

The external UI audit was implemented as a structural pass rather than an accessibility-only pass:

- Removed the global installation-authentication safe-area banner that replaced the Research navigation bar and hid the first viewport. Authentication gates are unchanged; the composer still names the disabled reason, and Settings retains the full status, support code, and retry action.
- Limited the tab bar to the three root destinations. Company, source, citation, credits, and support-detail screens use their full height.
- Consolidated repeated company and filing metadata into one compact workspace header, made Save a visible toolbar action, and kept refresh/company switching in the secondary menu.
- Preserved the native Research stack and added a narrow leading-edge gesture fallback. Company, source list, and source detail now pass automated left-edge return flows.
- Changed source rows to deterministic excerpt-derived previews and kept original excerpts visible alongside translations.
- Defined Research as active discovery/work and History as the archive. History rows now expose the latest stored question, answer count, and activity time.
- Changed Settings, Credits, and support details from modal presentation to pushed destinations. Product IDs, StoreKit prices, purchase handlers, retry/pending/cancellation behavior, and restore handlers are unchanged.

Validation:

- Debug Simulator build: passed on iPhone 16e, iOS 26.2.
- Unit tests: 208 passed, 0 failed after adding four local StoreKit end-to-end scenarios.
- Normal-use UI tests: 8 passed, 0 failed; the separate accessibility audit was not used as this pass's priority gate.
- Signed Release device build: passed with the production endpoint and production App Attest entitlement; installed and launched successfully on the connected iPhone 17 Pro.
- Physical-device Release UI test: 1 passed, 0 failed. Settings → Device information was reachable and installation authentication reached the visible `確認済み` state.
- StoreKit Test: four service scenarios and two real Xcode purchase-sheet UI scenarios passed, covering success, cancellation, pending, unfinished consumable recovery, and restore. The test configuration and Debug harness are excluded from the Release app.
- No production StoreKit purchase, backend credit grant, or destructive API write was performed.

Evidence:

- `artifacts/ui-redesign-2026-07-14/structural-refinement/00-auth-banner-before.png`
- `artifacts/ui-redesign-2026-07-14/structural-refinement/01-research-workspace-after.jpg`
- `artifacts/ui-redesign-2026-07-14/structural-refinement/02-sources.png`
- `artifacts/ui-redesign-2026-07-14/structural-refinement/03-history.png`
- `artifacts/ui-redesign-2026-07-14/structural-refinement/04-credits.png`
- `artifacts/ui-redesign-2026-07-14/structural-refinement/05-credits-failure.png`
