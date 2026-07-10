# Kabuyomi Sale Listing Draft

Date: 2026-06-06 JST
Status: draft copy for outreach or private buyer diligence

## One-Line Summary

Kabuyomi is a Japanese iOS app and Cloudflare backend for reading U.S. SEC 10-K / 10-Q filings with source-grounded AI answers, StoreKit credit monetization, and a tested filing/chat pipeline.

## Short Buyer Pitch

Kabuyomi gives Japanese users a focused way to inspect U.S. company filings without reading raw SEC documents in English. The app combines an iOS SwiftUI client, a Cloudflare Workers backend, SEC filing ingestion, source-grounded AI answers, StoreKit credit billing, and legal/App Review preparation docs.

The current codebase is suitable for a buyer who wants a niche finance/AI product foundation, not just a prototype. The repository includes the iOS app, Worker API, SEC fetcher, legal site, tests, release documentation, and transfer readiness notes.

## What Is Included

- iOS SwiftUI app generated with XcodeGen.
- Cloudflare Workers API with KV, D1, R2, and Durable Objects.
- SEC fetcher service and Worker-integrated SEC filing pipeline.
- Source-grounded chat orchestration with OpenAI prompt-version config, deterministic answers, fallback paths, source validation, and quality tests.
- StoreKit credit and subscription code paths:
  - `kabuyomi.credits.50`
  - `kabuyomi.credits.100`
  - `kabuyomi.sub.lite.monthly`
  - `kabuyomi.sub.pro.monthly`
  - `kabuyomi.sub.max.monthly`
- Optional rewarded-ad credit path with Google AdMob SSV gating.
- Static legal site source.
- Release, App Review, StoreKit, AdMob, and acquisition readiness docs.

## Current Technical Proof

Latest local validation on 2026-06-06 JST:

- Workers typecheck: passed.
- Workers test suite: 633/633 passed.
- Workers dry-run deploy to test config: passed.
- Worker testbench validation: passed.
- SEC fetcher tests: 15/15 passed.
- Legal-site validation: passed.
- iOS simulator tests: 153/153 passed with zero warnings.

See `docs/release/ACQUISITION_READINESS_PACKET_2026-06-06.md` for the detailed diligence packet.

## Suggested Buyer Profile

- Japanese finance media / investor education operator.
- AI app operator looking for a vertical product with existing iOS and Worker infrastructure.
- Developer or small team that can operate Apple Developer, Cloudflare, OpenAI, and AdMob accounts.
- Existing brokerage, newsletter, or community owner that wants a filing-reader companion app.

## Honest Limitations To Disclose

- This is not investment advice and does not provide buy/sell recommendations, forecasts, or target prices.
- Production deploy parity and live smoke should be reconfirmed before closing.
- Apple, Cloudflare, OpenAI, and AdMob accounts/secrets must be transferred or recreated outside the repository.
- Rewarded-ad production/TestFlight SSV evidence should be recorded before relying on rewarded ads in App Review.
- Local generated artifacts should be excluded from the final clean transfer package.

## Private Outreach Message

I am looking to sell Kabuyomi, a Japanese iOS + Cloudflare Workers app for reading U.S. SEC filings with source-grounded AI answers. It is not a generic chatbot: the product is built around 10-K / 10-Q filings, source citations, Japanese explanations, StoreKit credit monetization, and a tested Worker filing pipeline.

The codebase includes the SwiftUI app, Cloudflare backend, SEC fetcher, legal-site source, billing paths, AdMob rewarded-credit path, tests, and release documentation. Latest local validation passes across Workers, iOS simulator tests, SEC fetcher, legal site, and Worker dry-run deploy.

I can provide a diligence packet with architecture, validation evidence, transfer checklist, known gaps, and account assets that need handoff. I am looking for a buyer who can operate the Apple Developer, Cloudflare, OpenAI, and AdMob sides and take the product from near-transfer state into production ownership.

## Closing Checklist Before Sending To A Buyer

- Decide whether the sale includes app/account transfer, source-only sale, or source plus guided handoff.
- Decide whether historical local artifacts are included or excluded.
- Produce a clean branch or archive with generated directories removed.
- Record fresh live smoke evidence if representing the app as production-ready.
- Confirm App Store Connect and Cloudflare transfer mechanics.
- Rotate secrets after buyer-side accounts are ready.
- Prepare a short demo video or simulator walkthrough.
