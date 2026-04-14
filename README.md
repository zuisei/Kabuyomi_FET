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
`SEC_FETCHER_SHARED_SECRET` in `workers/.dev.vars`.

### iOS

```bash
cd /Users/0xt4/Desktop/Kabuyomi/ios
xcodegen generate
open Kabuyomi.xcodeproj
```
