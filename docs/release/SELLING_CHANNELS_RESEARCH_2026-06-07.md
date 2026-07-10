# Kabuyomi Selling Channels Research

Date: 2026-06-07 JST
Purpose: identify practical places to sell Kabuyomi and rank them by fit.

## Recommendation

Do not lead with source-code marketplaces. Kabuyomi is worth more as a product/business asset than as an iOS template.

Best route:

1. List or privately explore on a business/startup marketplace.
2. In parallel, do direct outreach to strategic buyers in Japanese finance, investor education, U.S. stock research, app portfolios, and AI finance tooling.
3. Use app/source-code marketplaces only as a fallback if the goal is speed over price.

## Priority Sites

| Priority | Site | Fit | Why it fits Kabuyomi | Caveat |
| --- | --- | --- | --- | --- |
| 1 | Acquire.com | High | Broad startup/micro-SaaS buyer pool. Good for source + backend + monetization + handoff package. | Better if there is revenue/traction. Fees and listing friction apply. |
| 2 | Flippa Apps | High | Explicitly supports iOS/iPadOS/Android app businesses and source-code documentation. Good if app is live/published. | Noisier marketplace; quality of buyers varies. |
| 3 | AppBusinessBrokers | High if revenue exists | Mobile-app-focused broker. Better for serious app-business buyers and guided transfer. | Broker process; likely wants clearer revenue and app-store proof. |
| 4 | Little Exits | Medium-high | Indie-hacker side-project acquisition marketplace. Good for smaller/fast exits with verified metrics. | Better if metrics/revenue can be shown. |
| 5 | Microns | Medium-high if profitable | Micro-startup marketplace with stated $1K-$1M asking-price range. | Requires paying customers/profitability; not ideal for pre-revenue/source-only sale. |
| 6 | Rakko M&A | Medium-high for Japan | Japanese site/Web service M&A platform with legal/contract workflow and buyer pool familiar with small web/app assets. | App + Cloudflare + Apple transfer story must be explained clearly. |
| 7 | TRANBI | Medium for Japan | Large Japanese M&A matching platform; seller fees can be attractive. | Broader SMB audience; may need plain-language business framing. |
| 8 | M&A Cloud / Startup M&A Advisory | Medium if aiming strategic Japanese buyer | Better if positioning as startup/product acquisition rather than quick asset sale. | Heavier process; less suitable for tiny/source-only exit. |
| 9 | Empire Flippers / Quiet Light | Medium if meaningful profit | Brokered, more serious buyer process. | Usually best when profit is stable enough to underwrite. |
| 10 | SideProjectors / Makers Marketplace | Medium-low | Quick side-project listing and visibility. | Lower price ceiling; weaker diligence process. |
| 11 | SellMyApp / BuySellMyApp / CodeCanyon-style marketplaces | Low fallback | Useful if selling source code/template only. | Likely undervalues Kabuyomi because buyer sees it as code, not a product. |
| 12 | New app-only marketplaces such as AppAcquire, AppVendora, LetsFlip | Experimental | App-specific positioning. | Marketplace depth appears limited; use only as extra optional exposure. |

## Recommended Listing Strategy

### Main Listing Positioning

Use this frame:

> Japanese SEC filing reader iOS app with Cloudflare backend, source-grounded AI answers, StoreKit credit monetization, and tested transfer packet.

Avoid this frame:

> iOS app source code for sale.

The first frame attracts product/acquisition buyers. The second frame attracts template buyers.

### Where To Start

1. Acquire.com: main international startup listing.
2. Flippa Apps: app-specific marketplace listing if the app is published/live and transferable.
3. Rakko M&A: Japan-facing listing for a buyer who understands Japanese finance/product demand.
4. Private outreach: send the sale draft directly to likely strategic buyers.

If revenue/traction is weak:

- Add Little Exits, SideProjectors, Makers Marketplace.
- Keep the asking price realistic.
- Emphasize validated technical foundation, App Store/Cloudflare readiness, and niche Japanese finance positioning.

If revenue/traction is real:

- Add AppBusinessBrokers or Empire Flippers.
- Prepare P&L, traffic/user metrics, App Store proceeds, subscriptions, support load, and cloud cost history.

## Private Strategic Buyer Targets

Categories to contact directly:

- Japanese U.S. stock newsletters and communities.
- Finance education creators with paid memberships.
- Japanese fintech/media companies that cover U.S. equities.
- App portfolio buyers focused on finance/productivity apps.
- AI finance-tool operators who lack an iOS app.
- SEC data, filing, or investor-research tool operators that want Japanese localization.

Direct outreach can beat marketplaces if the buyer already has distribution.

## Required Proof Before Listing

Minimum evidence package:

- Current validation results from `ACQUISITION_READINESS_PACKET_2026-06-06.md`.
- Clean transfer archive path.
- App Store Connect status screenshots or notes.
- Whether app transfer is possible under Apple transfer criteria.
- StoreKit product status list.
- Cloudflare asset list and transfer/secret-rotation plan.
- OpenAI prompt/API key transfer or recreation plan.
- AdMob SSV status and whether rewarded-credit UI stays visible.
- Monthly costs and support load.
- Any revenue, TestFlight, usage, or App Store proceeds evidence.

## Apple Transfer Gate

Apple app transfer rules matter before promising a full app transfer:

- The app must have at least one version released to the App Store.
- Both accounts must have accepted current paid/free agreements.
- The app must not be in certain in-review or pending release statuses.
- In-app purchases must be in allowed statuses and product IDs must not conflict with products in the recipient account.

If these are not satisfied, sell as source + guided setup instead of promising App Store app transfer.

## Pricing Direction

Without verified revenue:

- Price as a serious technical/product asset, not a high-multiple SaaS.
- Use a lower fixed price or invite offers.
- Main value is saved build time, niche product direction, working architecture, tests, and App Store/Cloudflare readiness.

With verified revenue:

- Price from profit/revenue multiples, not code value.
- Use broker/marketplace valuation tools only after P&L and recurring revenue are clean.

## Immediate Next Actions

1. Confirm whether Kabuyomi has a released App Store version and transferable app status.
2. Capture App Store Connect product/status evidence.
3. Capture Cloudflare Worker/resources evidence.
4. Decide listing path:
   - fast sale: Flippa + Rakko M&A + Little Exits
   - better price: Acquire.com + private outreach + AppBusinessBrokers
   - source-only fallback: SellMyApp / CodeCanyon-style marketplace
5. Send the private outreach draft in `SALE_LISTING_DRAFT_2026-06-06.md`.
