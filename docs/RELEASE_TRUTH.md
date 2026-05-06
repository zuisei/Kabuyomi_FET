# Kabuyomi v1 Release Truth

Last updated: 2026-05-06 JST

This document is the v1 submission source of truth. If older specs or handoff docs disagree with this file, use this file and the current code.

## Product Scope

- Kabuyomi v1 is a Japanese SEC filing reader for U.S. stocks.
- v1 supports SEC `10-K` and `10-Q` filings only.
- v1 provides source-grounded filing Q&A and Japanese reading support.
- v1 is a consumable-credit product only.
- v1 is not investment advice.
- v1 does not provide buy/sell recommendations.
- v1 does not provide stock price forecasts or target prices.
- Users are responsible for their own investment decisions.

## v1 Monetization

- The only visible paid IAP product in v1 is `kabuyomi.credits.100`.
- `kabuyomi.credits.100` grants 100 paid credits.
- Price truth for `kabuyomi.credits.100` is ¥200.
- Paid credits do not expire.
- Free/promotional credit and ad credit are separate from paid credit.
- Credit consumption order is free/promotional credit, then ad credit, then paid credit.
- v1 has no subscription UI.
- v1 has no Lite / Pro / Pro Max user-facing or review-facing copy.
- v1 public and review-facing copy must not use monthly credit wording.
- v1 App Review builds hide the normal rewarded-credit UI.

## Explicitly Not In v1

- Subscriptions
- Lite / Pro / Pro Max public plans
- Monthly credit grants in public or review-facing copy
- ¥500 / 280-credit pack
- 8-K support
- Web search route
- App Attest
- DeviceCheck
- Account system
- Model-tier upsell

These are v1.1+ or later items unless a new release truth document explicitly changes scope.

## AdMob Rewarded Credit Status

- AdMob rewarded-credit infrastructure exists in code and Worker routes.
- The normal rewarded-credit UI is hidden for v1 App Review.
- Rewarded credits are deferred to v1.1 / post-approval.
- When enabled after approval, rewarded ads must be optional and must never be required to use paid credits.
- When enabled after approval, rewarded ads grant +2 ad credits only after server-verified Google SSV.
- When enabled after approval, rewarded grants are capped at 3 valid grants per user per JST day.
- Invalid SSV, invalid ad unit, malformed callbacks, expired intents, and duplicate transaction callbacks must not grant credits.
- Duplicate SSV transaction callbacks are success/no-op and must not double grant.
- Ad credit expires 30 days after grant and must be disclosed in user-facing copy when the UI is enabled.
- Paid credits remain separate and do not expire.
- Real production/TestFlight Google SSV evidence must be recorded in `docs/rewarded_admob_credits_runbook.md` before rewarded credits can be enabled in a submitted build.

## Legal / Review Requirements

- Preferred public legal source for App Store metadata is the Cloudflare Pages static legal site at `https://kabuyomi-legal-site.pages.dev`, not the API Worker.
- Static legal URLs:
  - Privacy: `https://kabuyomi-legal-site.pages.dev/privacy/`
  - Terms: `https://kabuyomi-legal-site.pages.dev/terms/`
  - Support: `https://kabuyomi-legal-site.pages.dev/support/`
  - Tokushoho: `https://kabuyomi-legal-site.pages.dev/tokushoho/`
- Worker `/legal/*` routes are legacy API-hosted fallback copies only.
- Legal copy must say Kabuyomi is not investment advice.
- Legal copy must say Kabuyomi does not provide buy/sell recommendations.
- Legal copy must say Kabuyomi does not provide stock price forecasts or target prices.
- Legal copy must say answers are based on SEC filings available to the app.
- Legal copy must say paid credits do not expire.
- Legal copy must say refunds are handled through Apple App Store mechanisms and applicable law.
- A 特商法 page or section must exist.
- Tokushoho seller/operator name, address, and phone may use disclosure-by-request wording in public pages. Do not invent private legal identity values in this repository.

## Submit Gate

Default release decision is `HOLD`.

Kabuyomi can move to `SUBMIT CANDIDATE` only after all v1 gates are actually verified, including static legal URL deployment, StoreKit sandbox purchase, duplicate grant no-op, Apple server verification, confirmed hidden rewarded-credit UI for the v1 App Review build, Minimal Core 60 critical = 0, and production smoke 20 critical = 0.
