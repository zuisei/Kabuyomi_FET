# App Store Submission Notes

Last checked: 2026-05-06

## Build
- Bundle ID: `app.kabuyomi.ios`
- Version: `0.1.1`
- Build: `6`
- Archive path checked locally: `build/Kabuyomi-0.1.1-6.xcarchive`

## Review Notes
Kabuyomi is a Japanese reading app for U.S. company SEC filings. It summarizes and explains SEC 10-K and 10-Q filings, shows source references, and lets users ask questions about filing content.

Kabuyomi is not an investment advisory service. It does not execute trades, connect to brokerage accounts, manage portfolios, recommend buying or selling securities, predict stock prices, or provide target prices. Answers are based on SEC filings available to the app and should be used as reading support only. Users make their own investment decisions.

Kabuyomi v1 uses consumable credits only. The only visible paid IAP product is `kabuyomi.credits.100`, which grants 100 paid credits for ¥200. Paid credits do not expire. Free/promotional credits and ad credits are separate from paid credits.

For the v1 App Review build, the rewarded-credit UI is hidden. AdMob rewarded-credit infrastructure exists in the app and Worker, but rewarded credits are deferred to v1.1 / post-approval. App Review notes for v1 should not claim that users can earn credits by watching rewarded ads. Paid IAP remains available as `kabuyomi.credits.100`.

Support contact: `kabuyomi.support@gmail.com`

## Public Legal URLs

Preferred public legal source for App Store metadata is the static Cloudflare Pages legal site.

Do not use the API Worker `/legal/*` pages as the preferred App Store metadata URLs. They remain legacy API-hosted fallback copies only.

Use these URLs in App Store Connect:

- Privacy Policy URL: `https://kabuyomi-legal-site.pages.dev/privacy/`
- Support URL: `https://kabuyomi-legal-site.pages.dev/support/`
- Terms URL if used in metadata: `https://kabuyomi-legal-site.pages.dev/terms/`
- 特商法 URL where needed: `https://kabuyomi-legal-site.pages.dev/tokushoho/`

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

The static legal site is the preferred public source. In-app legal text remains available as fallback copy.

Current support text points users to:
- `kabuyomi.support@gmail.com`
- `@0xt4dano`

## Current Ad Policy
- For the v1 App Review build, rewarded-credit UI is hidden.
- AdMob rewarded-credit infrastructure exists and remains available for v1.1 / post-approval work.
- Do not claim rewarded-credit earning in v1 App Review notes.
- When re-enabled after approval, rewarded credits must grant only after server-side Google AdMob SSV verification.
- Ads are not required to use paid credits.
- Ads do not unlock investment advice, buy/sell recommendations, premium recommendations, stock price forecasts, or target prices.
- No interstitial ads.
- No native ads.

## Final Manual Checks
- Confirm the deployed static legal site has the latest source contents before using public legal URLs in App Store Connect
- Confirm `LegalSiteConfig.baseURL` points to `https://kabuyomi-legal-site.pages.dev`
- Open Settings and confirm Privacy Policy / Terms / Support / 特商法 screens open
- Confirm the 特商法 page uses disclosure-by-request wording and contains no `TODO_FINAL_LEGAL_*` placeholders
- Confirm Settings has no subscription UI and no Lite / Pro / Pro Max card
- Confirm the credit screen shows only `kabuyomi.credits.100` as the visible paid IAP
- Confirm no ¥500 pack is visible
- Confirm no public/review-facing recurring-credit wording appears
- Confirm rewarded-credit UI is hidden in the v1 Release/TestFlight App Review build
- Do not submit App Review notes that claim rewarded-credit earning for v1
- Send one chat and confirm the displayed credit balance decreases
- Translate one source preview and confirm it shows `訳 1 credit`
