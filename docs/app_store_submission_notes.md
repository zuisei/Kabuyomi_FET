# App Store Submission Notes

Last checked: 2026-05-05

## Build
- Bundle ID: `app.kabuyomi.ios`
- Version: `0.1.1`
- Build: `6`
- Archive path checked locally: `build/Kabuyomi-0.1.1-6.xcarchive`

## Review Notes
Kabuyomi is a Japanese reading app for U.S. company SEC filings. It summarizes and explains SEC 10-K and 10-Q filings, shows source references, and lets users ask questions about filing content.

Kabuyomi is not an investment advisory service. It does not execute trades, connect to brokerage accounts, manage portfolios, recommend buying or selling securities, predict stock prices, or provide target prices. Answers are based on SEC filings available to the app and should be used as reading support only. Users make their own investment decisions.

Kabuyomi v1 uses consumable credits only. The only visible paid IAP product is `kabuyomi.credits.100`, which grants 100 paid credits for ¥200. Paid credits do not expire. Free/promotional credits and ad credits are separate from paid credits.

Rewarded ads are optional. A user may watch a rewarded ad to earn +2 free/ad credits, up to 3 valid rewarded grants per day. Rewarded ad credits expire 30 days after grant. Paid credits are also available and ads are never required. Rewarded credits are granted only after server-side Google AdMob SSV verification. Duplicate callbacks do not double-grant, and invalid signatures or invalid ad units do not grant credits. Rewarded ads do not unlock investment advice, buy/sell recommendations, premium recommendations, stock price forecasts, or target prices.

Support contact: `kabuyomi.support@gmail.com`

## App Privacy Checklist
Use this as the App Store Connect privacy questionnaire reference for the current implementation.

- Device ID / Identifier:
  - Used: Yes
  - Purpose: App functionality
  - Linked to user: Yes, as an app-scoped anonymous device key
  - Tracking: No for Kabuyomi's own device key
- Purchase History:
  - Used: Yes
  - Purpose: App functionality
  - Linked to user: Yes
  - Tracking: No
- Product Interaction:
  - Used: Yes
  - Purpose: App functionality
  - Linked to user: Yes
  - Tracking: No
- Advertising Data / Identifiers:
  - Used by Google AdMob for free-plan banner ads
  - Match the App Store Connect answers to the Google AdMob SDK disclosure shown by App Store Connect

## In-App Legal Copy
The app has in-app screens for:
- Privacy Policy
- Terms
- Support
- 特商法

Current support text points users to:
- `kabuyomi.support@gmail.com`
- `@0xt4dano`

## Current Ad Policy
- Optional rewarded ads can grant +2 free/ad credits after server-side Google AdMob SSV verification.
- Rewarded grants are capped at 3 valid grants per user per day.
- Rewarded ad credits expire 30 days after grant.
- Ads are not required to use paid credits.
- Ads do not unlock investment advice, buy/sell recommendations, premium recommendations, stock price forecasts, or target prices.
- No interstitial ads.
- No native ads.

## Final Manual Checks
- Open Settings and confirm Privacy Policy / Terms / Support / 特商法 screens open
- Confirm the 特商法 page has final seller legal identity values, or that unresolved blocker placeholders are intentionally visible before final submission
- Confirm Settings has no subscription UI and no Lite / Pro / Pro Max card
- Confirm the credit screen shows only `kabuyomi.credits.100` as the visible paid IAP
- Confirm no ¥500 pack is visible
- Confirm no public/review-facing recurring-credit wording appears
- Confirm rewarded-credit UI is visible in the Release/TestFlight build
- Confirm real Google SSV evidence is recorded in `docs/rewarded_admob_credits_runbook.md` before submitting review notes that claim rewarded credits
- Send one chat and confirm the displayed credit balance decreases
- Translate one source preview and confirm it shows `訳 1 credit`
