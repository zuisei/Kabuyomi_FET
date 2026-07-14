# Kabuyomi redesign specification

## Product idea

Kabuyomi becomes an Apple-native company-research workspace. The interface should feel calm, credible, editorial, and source-aware. It should not read as a chatbot, a market dashboard, or a collection of floating cards.

## Information architecture

### iPhone

1. **Research** — discovery, active company, filing scope, research document, questions, answers, citations, and sources.
2. **History** — explicitly saved companies plus persisted research and cached filing versions. Generic recent-company switching belongs only to Research.
3. **Settings** — credit balance and StoreKit, preferences, Release-safe device/support information, legal/support, local data, and Debug-only diagnostics.

A tab is a destination, never an action. Each tab owns a `NavigationStack`. Company identity and active filing context stay visible in the Research hierarchy.

### iPad

Kabuyomi currently ships as iPhone-only. The redesign will keep its conceptual hierarchy compatible with a future `NavigationSplitView`, but this change will not widen `TARGETED_DEVICE_FAMILY` or claim iPad validation.

## Research structure

- Discovery is a native searchable list with recent and starter companies.
- Company, source-list, and citation screens share one native `NavigationStack`; the standard back control and left-edge swipe return through the same hierarchy.
- The tab bar is visible only at the Research, History, and Settings roots. Company workspaces, sources, citations, credits, and settings details use the full reading height.
- Returning to discovery changes presentation only. The active company, filing, cache, and conversation remain owned by `AppModel`.
- The workspace header prioritizes company name, filing type/date, update date, and one compact source row without repeating the same metadata in stacked cards.
- The visible filing row is the primary entry for sources. Save is a visible toolbar action; refresh and explicit company switching remain in one secondary menu.
- Filing scope opens a native destination rather than a transient edge drawer or nested sheet.
- Source rows use a deterministic preview from the existing excerpt so rows for different evidence can be distinguished before opening them. Source detail keeps the original excerpt visible when a translation is shown.
- The current filing summary is an editorial document: answer/summary first, then findings, figures, changes, evidence, and conversation.
- User questions are compact; AI answers are full-width reading surfaces with claim-adjacent source controls.
- The composer remains stable in a bottom safe-area inset and never covers the last answer.

## Research and History roles

- Research is the place to discover or switch companies and do active work. Recent companies live only here.
- History is the archive for explicitly saved companies and persisted research. Its rows show the latest stored user question, answer count, and latest activity time.
- Authentication failures never replace the Research navigation bar with a global banner. The composer keeps the relevant disabled reason, while full status and retry controls remain under Settings > Device information and support.

## Visual system

- Semantic system type and Dynamic Type; no rounded-design font override for body copy.
- System grouped background, system background reading surface, tertiary fills for controls, separators for grouping.
- System blue is the only brand accent.
- Green/red are reserved for actual positive/negative meaning and always paired with text or symbols.
- No decorative gradients, hero panels, glass-on-glass stacking, or persistent shadows.
- Corners are limited to controls, compact status chips, and bounded sheets; document sections use spacing and separators.
- Tabular digits are used for balances and comparable figures.
- Motion is short, critically damped, and disabled or reduced under Reduce Motion.

## Behavioral rules

- All actions call existing `AppModel` methods.
- No view creates an API client, persistence controller, StoreKit store, identity store, or credit calculation.
- No lifecycle callback sends a question or purchase.
- Switching tabs or navigation destinations must not reset the `AppModel` or active company.
- Unsupported, offline, insufficient-credit, pending-purchase, and capability-disabled states remain distinct.
- Existing Japanese strings and legal disclosures remain Japanese; new copy follows the same architecture.

## Cutover

The temporary Debug/test shell argument was used for before/after parity testing and has now been removed. `AppRootView` contains only `RedesignRootView`; obsolete entry, search, company drawer, timeline, composer, and toolbar presentation files were deleted. Debug and Release use the same production presentation root.
