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

Paid credits do not expire. Subscription credits, free/promotional credits, ad credits, and paid credits are separate server-side buckets. Normal chat cost is 2 credits.

Rewarded ads are visible in the v1.0.2 Credits / Account Status flow when the required AdMob rewarded config is present. They are optional and grant free/ad credits, not paid credits. Rewards require server-side Google AdMob SSV before credits are reflected. Each verified reward grants +2 ad credits, with a server-side cap of 3 successful rewards / +6 ad credits per JST day. Ad serving is not guaranteed and can be unavailable depending on device, network, or ad fill.

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
- Rewarded-credit UI is release-visible in v1.0.2 when required AdMob rewarded config is present.
- Rewarded ads are optional.
- Rewarded credits are free/ad credits and are separate from paid credits.
- Rewarded credits must grant only after server-side Google AdMob SSV verification.
- Client-only ad completion must never grant credits.
- Daily cap is 3 successful rewarded grants / +6 ad credits per JST day.
- Ads are not required to use paid credits.
- Ads do not unlock investment advice, buy/sell recommendations, premium recommendations, stock price forecasts, or target prices.
- No interstitial ads.
- No native ads.

## App Review Rewarded Ad Test Steps
1. Open Credits / Account Status.
2. Tap the rewarded ad option.
3. Watch an available rewarded ad.
4. Return to the app.
5. Wait for verification / refresh usage.
6. Confirm +2 free/ad credits if Google AdMob SSV succeeds.
7. Confirm the daily cap is 3 successful rewards per day.

If AdMob does not serve an ad during review, the app should show the ad unavailable/load failure state and should not grant credits.

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
- Confirm rewarded-credit UI is visible from Credits / Account Status when the required AdMob rewarded config is present.
- Confirm the UI describes rewarded ads as optional free/ad credits and does not show raw AdMob IDs, callback URLs, Worker routes, device keys, transaction IDs, or internal diagnostics.
- Confirm a completed rewarded ad grants credits only after server-side SSV and usage refresh.
- Send one chat and confirm the displayed credit balance decreases
- Translate one source preview and confirm it shows `訳 1 credit`
