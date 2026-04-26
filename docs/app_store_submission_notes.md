# App Store Submission Notes

Last checked: 2026-04-26

## Build
- Bundle ID: `app.kabuyomi.ios`
- Version: `0.1.1`
- Build: `6`
- Archive path checked locally: `build/Kabuyomi-0.1.1-6.xcarchive`

## Review Notes
Kabuyomi is a research assistant for reading US company filings. It summarizes and explains SEC filings such as 10-K and 10-Q, shows source references, and lets users ask questions about the filing content.

Kabuyomi is not an investment advisory service. It does not execute trades, connect to brokerage accounts, or provide personalized financial advice. Answers are based on company filings and should be used as research support only.

Free users receive monthly credits and may see a banner ad in the library drawer. Paid subscriptions grant monthly credits for AI chat. Standard chat currently consumes credits shown in the app.

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

Current support text points users to:
- `kabuyomi.support@gmail.com`
- `@0xt4dano`

## Current Ad Policy
- Banner only
- Free plan only
- Placement: lower area of the left library drawer
- No interstitial ads
- No native ads
- Rewarded ad unit ID exists in config but rewarded credit flow is not connected in this build

## Final Manual Checks
- Open Settings and confirm Privacy Policy / Terms / Support screens open
- Confirm Settings shows subscription plans and credit balance
- Confirm free-plan banner appears in the left drawer
- Confirm paid plan hides banner after entitlement is active
- Send one chat and confirm the displayed credit balance decreases
- Translate one source preview and confirm it shows `訳 1 credit`
