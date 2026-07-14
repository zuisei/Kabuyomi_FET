# Kabuyomi current behavior

Status: baseline captured before presentation-layer replacement

Baseline commit: `a9306b3`

Baseline device: iPhone 17 Pro, iOS 26.2, normally signed Debug build, isolated test Worker

## Product boundary

Kabuyomi is a Japanese-language SEC research app. It searches U.S. issuers, loads the latest supported 10-K or 10-Q, stores filings and conversations locally, and sends filing-grounded questions to the Worker. It does not provide trading, price forecasts, recommendations, or general web search. The app target currently supports iPhone only (`TARGETED_DEVICE_FAMILY = 1`); iPad is not a shipping platform.

## Current shell

The current production shell is `AppRootView -> ConversationEntryView -> CompanyView`. Company switching, saved companies, recent companies, filing history, credits, and settings are exposed from a left drawer. Filing summary and sources are exposed from a right drawer. Search is a sheet. Credits and settings are full-screen covers.

The drawers, covers, bubble styling, glass cards, gradients, and toolbar placements are presentation choices, not product behavior.

## State and dependency ownership

- `KabuyomiApp` owns one long-lived `AppModel` and injects its Core Data context.
- `AppModel` owns navigation state, cached company payloads, search, watchlist mutations, pending chat state, credit state, StoreKit actions, rewarded-ad return state, authentication degradation, and persistence reconciliation.
- `APIClient` owns route construction, request payloads, identity/App Attest headers, response decoding, error classification, and Debug/Release endpoint routing.
- `PersistenceController` owns the existing Core Data model and saves companies, filing versions, summaries, metrics, source chunks, messages, and source references.
- `SubscriptionStore` owns StoreKit product metadata, purchase verification, unfinished transactions, entitlement refresh, restore, and transaction completion.
- `DeviceIdentityStore`, `InstallationTokenStore`, and App Attest services own anonymous identity and fraud-sensitive authorization.

The redesign must consume these same instances. No presentation component may create a parallel store, API client, database, purchase ledger, or identity.

## Observable behavior

### Startup and degraded authentication

Startup is local-first. Cached research stays readable while installation authentication is offline, temporarily unavailable, unsupported, or invalid. A non-blocking status appears after authentication degrades. Mutation and credit-changing actions remain gated. A normally signed Simulator build is required; `CODE_SIGNING_ALLOWED=NO` intentionally triggers the Keychain/signature degraded state and is not valid visual evidence.

### Discovery and companies

- First launch offers starter companies and company search.
- Search accepts ticker or company name, debounces requests, distinguishes supported, unsupported, and unknown filing support, and provides separate open and save actions.
- Opening does not consume a saved-company slot. Saving calls the watchlist endpoint and persists/reconciles server truth.
- Saved and recent companies persist. Active and last-viewed ticker keys restore the company context.
- Company loads local data first, refreshes remotely, supports retryable preparation states, and can show stale-ready data.
- Refresh compares filing identity and asks before replacing an active conversation with a newly available filing.

### Research and filings

- A company workspace exposes company identity, website, save/remove, refresh, current filing type/date, summary, metrics, historical overview, source chunks, conversation history, and older filing conversations.
- Selecting a filing changes the active filing key without creating another data layer.
- Original SEC documents open through the existing validated external URL path.
- Quote translation costs one credit and keeps the original/translated preview states distinct.

### Questions and answers

- Questions cost two credits and require AI consent.
- Send is gated by non-empty input, company availability, authentication, chat capability, pending request state, and credits.
- The draft is cleared optimistically and restored if sending fails.
- One pending user message is shown while generation runs; duplicate submission is prevented.
- The current API returns a completed answer rather than token streaming. There is no user-visible cancellation control in the current implementation.
- A filing-cache miss forces one company refresh and retries the same operation ID once.
- Retry reuses request identity when filing key, question, and recent context match.
- Answers persist with source references. Citations expose source kind, label, excerpt, and existing source URL.

### Library and persistence

- Saved companies, recent companies, cached filing versions, and conversations can be revisited.
- Saving currently applies to companies; there is no separate per-answer bookmark domain model.
- Reset deletes local Core Data and presentation keys, retains the Keychain installation credential and authoritative server credit/purchase state, then returns to first-entry state.

### Credits, purchases, and rewards

- Credit balance and bucket details come from `/v1/usage`.
- StoreKit localized price is authoritative. Product IDs and credit quantities come from the existing catalog/store.
- Subscription purchase, consumable purchase, cancellation, pending, failure, unfinished-purchase recovery, restore, and server sync use the existing StoreKit/AppModel handlers.
- Purchase controls remain gated by remote capabilities, authenticated mutation availability, App Attest state, and optional account-recovery requirements.
- Rewarded credit remains gated by typed capability state, SSV readiness, environment, emergency disable, daily cap, and AdMob runtime configuration.
- Debug-only API selection, detached access, SSV smoke mode, and diagnostics do not appear in Release.

### Settings, legal, and release safeguards

- AI consent and starter-company visibility are persistent preferences.
- Privacy, terms, support, and commercial disclosure use canonical public legal URLs with existing in-app fallback content.
- Debug-only diagnostics and environment controls remain compilation-gated.
- Release remains pinned to the production Worker and production App Attest entitlement.

## Baseline evidence

Accepted baseline captures are in `artifacts/ui-redesign-2026-07-13/baseline/`. Captures made with signing disabled are retained only as failure-state evidence and are excluded from visual comparison. `07-signed-full-screen.png` is the first accepted unobstructed company-workspace baseline.
