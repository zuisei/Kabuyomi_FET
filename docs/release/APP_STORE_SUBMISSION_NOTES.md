# App Store Submission Notes

Last checked: 2026-05-10

## Build
- Bundle ID: `app.kabuyomi.ios`
- Version: `1.0.2` in `ios/project.yml`
- Build: `4` in `ios/project.yml`
- Archive path: not rechecked in this cleanup pass

## Review Notes
Kabuyomi is a Japanese reading app for U.S. company SEC filings. It summarizes and explains SEC 10-K and 10-Q filings, shows source references, and lets users ask questions about filing content.

Kabuyomi is not an investment advisory service. It does not execute trades, connect to brokerage accounts, manage portfolios, recommend buying or selling securities, predict stock prices, or provide target prices. Answers are based on SEC filings available to the app and should be used as reading support only. Users make their own investment decisions.

Kabuyomi v1.0.2 uses credit-based monetization. Visible StoreKit products for this branch are:

- `kabuyomi.credits.50`: consumable, ¥100, grants 50 paid credits.
- `kabuyomi.credits.100`: existing compatibility consumable, remains supported when present and grants 100 paid credits.
- `kabuyomi.sub.lite.monthly`: auto-renewable subscription in group `Kabuyomi_sus`, ¥640/month, grants 400 subscription credits/month.
- `kabuyomi.sub.pro.monthly`: auto-renewable subscription in group `Kabuyomi_sus`, ¥1,280/month, grants 900 subscription credits/month.
- `kabuyomi.sub.max.monthly`: auto-renewable subscription in group `Kabuyomi_sus`, ¥2,560/month, grants 2,000 subscription credits/month.

Paid credits do not expire. Subscription credits, free/promotional credits, and paid credits are separate server-side buckets in the visible RC. Normal chat cost is 2 credits.

Rewarded-ad credit UI is visible in this RC/App Review build. Rewarded ads are optional, and credits are granted only after the Worker verifies Google AdMob server-side verification (SSV).

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
- Rewarded-credit UI is visible in this RC/App Review build.
- Rewarded credits are optional and require Worker-side Google AdMob SSV verification before grant.
- Banner/display ads may appear where implemented, but ads are not required to use paid credits.
- Ads do not unlock investment advice, buy/sell recommendations, premium recommendations, stock price forecasts, or target prices.
- No interstitial ads.
- No native ads.

## Final Manual Checks
- Confirm the deployed static legal site has the latest source contents before using public legal URLs in App Store Connect
- Confirm `LegalSiteConfig.baseURL` points to `https://kabuyomi-legal-site.pages.dev`
- Open Settings and confirm Privacy Policy / Terms / Support / 特商法 screens open
- Confirm the 特商法 page uses disclosure-by-request wording and contains no `TODO_FINAL_LEGAL_*` placeholders
- Confirm Settings/Credits shows the intended Lite / Pro / Max subscription UI for v1.0.2.
- Confirm the credit screen shows `kabuyomi.credits.50` as the primary paid credit pack.
- Confirm `kabuyomi.credits.100` remains supported/visible as a compatibility pack if StoreKit returns it.
- Confirm no ¥500 pack is visible
- Confirm subscription price/credit copy matches App Store Connect and the v1.0.2 release truth.
- Confirm rewarded-credit UI is visible from Credits / Account Status in the RC build.
- Confirm rewarded-credit copy says ads are optional and credits require server-side Google AdMob SSV before grant.
- Send one chat and confirm the displayed credit balance decreases
- Translate one source preview and confirm it shows `訳 1 credit`
