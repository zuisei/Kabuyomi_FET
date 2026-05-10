# Kabuyomi v1 Release Truth

Last updated: 2026-05-10 JST

This document is the v1.0.2 monetization source of truth for the `v1.0.2-subscription-rewarded-credits` branch. If older specs or handoff docs disagree with this file, use this file and the current code for this branch.

## Product Scope

- Kabuyomi v1 is a Japanese SEC filing reader for U.S. stocks.
- v1 supports SEC `10-K` and `10-Q` filings only.
- v1 provides source-grounded filing Q&A and Japanese reading support.
- v1.0.2 is a credit-based monetization release with consumable paid credits and monthly subscription credit plans.
- v1 is not investment advice.
- v1 does not provide buy/sell recommendations.
- v1 does not provide stock price forecasts or target prices.
- Users are responsible for their own investment decisions.

## v1 Monetization

- Visible paid consumable products in v1.0.2:
  - `kabuyomi.credits.50`: ¥100, grants 50 paid credits.
  - `kabuyomi.credits.100`: existing compatibility product, remains supported when present and grants 100 paid credits.
- Subscription group: `Kabuyomi_sus`.
- Visible monthly subscription products in v1.0.2:
  - `kabuyomi.sub.lite.monthly`: ¥640/month, grants 400 subscription credits/month.
  - `kabuyomi.sub.pro.monthly`: ¥1,280/month, grants 900 subscription credits/month.
  - `kabuyomi.sub.max.monthly`: ¥2,560/month, grants 2,000 subscription credits/month.
- Paid credits do not expire.
- Free/promotional credit, subscription credit, ad credit, and paid credit are separate server-side buckets.
- Credit consumption order is subscription/free/promotional credit, then ad credit, then paid credit.
- Normal chat cost is 2 credits.
- Rewarded-credit UI is release-visible in v1.0.2 when the required AdMob rewarded config is present. Rewarded ads are optional and grant only free/ad credits after server-side Google AdMob SSV verification.

## Explicitly Not In v1

- ¥500 / 280-credit pack
- 8-K support
- Web search route
- App Attest
- DeviceCheck
- Account system
- Model-tier upsell

These are later items unless a new release truth document explicitly changes scope.

## AdMob Rewarded Credit Status

- AdMob rewarded-credit UI is release-visible for Release/TestFlight/App Review when the required rewarded ad config is present.
- Rewarded ads must be optional and must never be required to use paid credits.
- Rewarded ads grant +2 ad credits only after server-verified Google SSV.
- Rewarded grants are capped at 3 valid grants per user per JST day.
- Rewarded grants are capped at +6 ad credits per JST day.
- Invalid SSV, invalid ad unit, malformed callbacks, expired intents, and duplicate transaction callbacks must not grant credits.
- Duplicate SSV transaction callbacks are success/no-op and must not double grant.
- Ad credit expires 30 days after grant and must be disclosed in user-facing copy when the UI is enabled.
- Paid credits remain separate and do not expire.
- Real production/TestFlight Google SSV smoke evidence must be recorded in `docs/admob/rewarded_admob_credits_runbook.md` before main merge or App Store submission can be marked ready.

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

Default release decision is `TESTFLIGHT_SMOKE_REQUIRED`.

Kabuyomi can move to `SUBMIT CANDIDATE` only after all v1.0.2 gates are actually verified, including static legal URL deployment, StoreKit sandbox/TestFlight product load, subscription purchase, consumable purchase, restore, duplicate grant no-op, Apple server verification, confirmed rewarded-credit UI visibility state, Minimal Core 60 critical = 0, and production smoke 20 critical = 0.
