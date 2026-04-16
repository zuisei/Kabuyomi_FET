# Kabuyomi

Kabuyomi is an iOS + Cloudflare Workers app for reading SEC filings in Japanese with source-grounded AI answers.

## Structure

- `ios/`: SwiftUI app scaffold generated with XcodeGen
- `workers/`: Cloudflare Workers API, Durable Objects, and SEC ingestion pipeline
- `sec-fetcher/`: on-demand SEC fetcher used by Workers for submissions, filing HTML, metrics, and ticker snapshot refresh

## Quick Start

### SEC Fetcher

```bash
cd /Users/0xt4/Desktop/Kabuyomi/sec-fetcher
npm install
SEC_FETCHER_SHARED_SECRET=replace-me npm run dev
```

### Workers

```bash
cd /Users/0xt4/Desktop/Kabuyomi/workers
npm install
cp .dev.vars.example .dev.vars
npm run test
npm run dev
```

For local Workers development, set `SEC_FETCHER_BASE_URL=http://127.0.0.1:8789` and the same
`SEC_FETCHER_SHARED_SECRET` in `workers/.dev.vars`. You can also override `GEMINI_MODEL`
there to switch between hosted Gemini/Gemma model IDs without code changes. If needed,
`GEMINI_TIMEOUT_MS`, `SEC_FETCHER_TIMEOUT_MS`, and `BACKFILL_SHARED_SECRET` can be tuned there as well.

## Storage Layout

- `KV`: latest filing alias, remote config, hot filing cache
- `D1`: 3-year history index for `trend / compare` style questions
- `R2`: archived filing payloads (`sourceChunks`, `mdaText`, summary JSON)

`/v1/chat` keeps using KV-backed current filings by default. Only explicit history-style prompts such as
`3年`, `比較`, `推移`, `trend`, or `compare` trigger the D1 path.

## D1 Schema

Create the D1 schema from `workers/d1/migrations/0001_history.sql` before a remote deploy:

```bash
cd /Users/0xt4/Desktop/Kabuyomi/workers
npx wrangler d1 execute kabuyomi-history --local --file ./d1/migrations/0001_history.sql
npx wrangler d1 execute kabuyomi-history --remote --file ./d1/migrations/0001_history.sql
```

Free-tier note:
- Backfill should be chunked. Start with a few tickers and `maxFilingsPerTicker=1` or `2`, not all history at once.
- D1 stores lookup metadata only. Large derived filing payloads are written to R2 to avoid bloating KV or D1.
- Remote deploys that include `FILINGS_BUCKET` require R2 to be enabled once in the Cloudflare Dashboard for the target account.

## History Backfill

Run the worker locally or deploy it first, then call the internal backfill route with a shared secret:

```bash
cd /Users/0xt4/Desktop/Kabuyomi/workers
BACKFILL_URL=http://127.0.0.1:8787 \
BACKFILL_SHARED_SECRET=replace-me \
node ./scripts/backfill-history.mjs AAPL MSFT --years=3 --max-filings-per-ticker=2
```

If no tickers are supplied, the worker uses the configured tracked tickers list. Use multiple small runs to stay within
Workers/D1/R2 free-tier expectations.

### iOS

```bash
cd /Users/0xt4/Desktop/Kabuyomi/ios
xcodegen generate
open Kabuyomi.xcodeproj
```
