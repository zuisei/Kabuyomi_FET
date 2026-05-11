# Current Shipping Truth

Last updated: 2026-05-10 JST

This file is the shared snapshot of what Kabuyomi currently is.
It is intentionally narrower than old product specs.

If this file and runtime disagree:
- runtime wins for "what users are seeing now"
- current working tree wins for "what we are changing next"

---

## 1. Product Definition

Kabuyomi v1 is a **Japanese SEC filing reader iOS app** for asking questions about U.S. company SEC 10-K / 10-Q filings in Japanese.

The center of the experience is:
- open a company
- ask about the filing
- get a source-grounded answer
- inspect summary and supporting evidence

Current RC scope includes consumable credits and monthly subscription credit plans. Older v1 docs that say subscription plans are absent are superseded for this branch.

---

## 2. Official iOS Route

Current official iOS route:

`AppRootView -> ConversationEntryView -> CompanyView`

Meaning:
- conversation-first is the official interaction model
- Search is a supporting entry surface
- the old Home/Tab-root mental model is not the current primary route

Current supporting surfaces:
- Conversation entry
- Search sheet / search flow
- Left drawer for company switching
- Right drawer for filing summary
- Settings sheet

---

## 3. Official Backend Route

Current official backend route:

- iOS -> Workers
- Workers -> sec-fetcher
- sec-fetcher -> SEC
- Workers -> Gemini / local fallback
- Workers -> KV / D1 / R2 / DO

Authoritative Worker entry:
- `workers/src/index.ts`
- `workers/src/routes/*`

Authoritative sec-fetcher entry:
- `sec-fetcher/server.mjs`

---

## 4. Current Beta Scope

In scope:
- 10-K
- 10-Q
- starter tickers
- search
- company load
- filing summary
- source-grounded chat
- explicit historical comparison prompts where implemented for 10-K / 10-Q
- consumable credit balance
- `kabuyomi.credits.50` primary paid credit pack
- `kabuyomi.credits.100` compatibility paid credit pack when present
- Lite / Pro / Max monthly subscription credit plans
- rewarded-credit backend routes, implemented but hidden in Release/App Review until real production/TestFlight Google SSV grant evidence is recorded in this repository

Out of scope:
- 20-F
- 6-K
- 8-K
- push notifications
- rewarded-credit behavior that grants credits without server-side Google SSV
- broad cross-company comparison product
- broad web-first investing product

---

## 5. Current Billing Truth

Billing is enabled in the current v1 path.

Current truth:
- iOS uses StoreKit for consumables and subscriptions.
- `kabuyomi.credits.50` grants 50 paid credits for ¥100.
- `kabuyomi.credits.100` remains supported as an existing compatibility product and grants 100 paid credits when present.
- Subscription group is `Kabuyomi_sus`.
- `kabuyomi.sub.lite.monthly` grants 400 subscription credits/month for ¥640/month.
- `kabuyomi.sub.pro.monthly` grants 900 subscription credits/month for ¥1,280/month.
- `kabuyomi.sub.max.monthly` grants 2,000 subscription credits/month for ¥2,560/month.
- Workers verify Apple transactions through App Store Server API before granting paid credits
- duplicate consumable transactions must be no-op / already-granted
- paid credits do not expire
- rewarded-ad credits are not visible in the RC UI; backend grant routes remain SSV-only, capped, idempotent, and test-covered
- normal chat cost is 2 credits
- DEBUG-only detached dev access is a removable non-shipping path and is not part of the public product contract

---

## 6. Current Source Policy

Current local code direction is filing-grounded by default.

Meaning:
- SEC filing sources are primary
- external supplement is not the default assumption unless explicitly enabled by current runtime/config
- source labels and source kinds should not silently blur SEC filing and external supplement

If runtime parity is not yet confirmed, treat this section as **current code truth**, not necessarily **confirmed live truth**.

---

## 7. Current Live Runtime: Confirmed

Confirmed as of 2026-04-18 JST:

- live Worker URL exists
- SEC fetcher health responds
- search works on live runtime
- core worker path exists for:
  - search
  - usage
  - company
  - chat
  - billing sync / entitlement behavior
- live/runtime parity with local working tree is **not fully guaranteed** unless explicitly re-confirmed after deploy

---

## 8. Current Live Runtime: Unconfirmed

Still considered unconfirmed unless explicitly re-checked:

- deployed Worker commit parity with local working tree
- full live `remote_config` value set
- dedicated staging environment parity
- full starter ticker quality sweep
- final TestFlight runtime parity
- post-freeze production parity after any new deploy

Write `未確認` instead of assuming.

---

## 9. Current Risks

Current known risk categories:

- local code and live runtime may drift
- docs may still contain stale route descriptions
- scaffolding for disabled features may still exist in repo
- source quality may vary by filing/company
- old product mental models may still exist in docs or naming

---

## 10. Current Stale / Reference-Only Material

These may still be useful for history/reference, but they are not the main truth set:

- old tab-root / Home-root product descriptions
- stale as-built docs that still assume older navigation
- old handoff docs that predate route splitting
- old monetization-forward wording

When in doubt:
- use current code
- use this file
- escalate to Integration

---

## 11. Current Authoritative Files

Use these as the current truth set:

- `AGENTS.md`
- `docs/release/CURRENT_SHIPPING_TRUTH.md`
- `CURRENT_SLICE.md`
- `ios/project.yml`
- `ios/Kabuyomi/App/AppRootView.swift`
- `ios/Kabuyomi/App/AppModel.swift`
- `workers/src/index.ts`
- `workers/src/routes/*`
- `sec-fetcher/server.mjs`
- `README.md`
- `docs/release/TESTFLIGHT_READINESS_CHECKLIST.md`

---

## 12. Update Rule

This file should be updated only when one of these changes:

- official route
- official beta scope
- source policy
- billing status
- verified runtime truth
- authoritative file set

Only Integration should change this file.
