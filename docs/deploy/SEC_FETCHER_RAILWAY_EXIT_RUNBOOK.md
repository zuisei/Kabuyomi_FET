# SEC Fetcher Railway Exit Runbook

This service is intentionally portable. It is a stateless Node HTTP server under `sec-fetcher/`; the only runtime secret required by the service and the Cloudflare Worker is `SEC_FETCHER_SHARED_SECRET`.

## Recommended Fast Replacement

Use a managed container host first. Cloud Run is the lowest-friction replacement because it can build directly from `sec-fetcher/Dockerfile`, expose HTTPS, and scale down when idle.

Railway does not own any durable data for this service. The in-process SEC response cache is warm-only and can be lost during migration.

## Required Environment

Set these on the new host:

```bash
SEC_FETCHER_SHARED_SECRET=<same value as Cloudflare Worker secret>
SEC_USER_AGENT="Kabuyomi admin@kabuyomi.app"
SEC_RATE_LIMIT_PER_SECOND=8
SEC_FETCHER_RETRY_COUNT=2
SEC_FETCHER_INITIAL_BACKOFF_MS=400
SEC_FETCHER_HTTP_TIMEOUT_MS=12000
```

`PORT` should be supplied by the host. The Docker image defaults to `8080` for hosts such as Cloud Run.

## Cloud Run Path

From the repo root:

```bash
cd /Users/0xt4/t4dano/Kabuyomi
gcloud run deploy kabuyomi-sec-fetcher \
  --source sec-fetcher \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars SEC_USER_AGENT="Kabuyomi admin@kabuyomi.app",SEC_RATE_LIMIT_PER_SECOND=8,SEC_FETCHER_RETRY_COUNT=2,SEC_FETCHER_INITIAL_BACKOFF_MS=400,SEC_FETCHER_HTTP_TIMEOUT_MS=12000 \
  --set-secrets SEC_FETCHER_SHARED_SECRET=SEC_FETCHER_SHARED_SECRET:latest
```

If Secret Manager is not already configured, use the host console to add `SEC_FETCHER_SHARED_SECRET` as a secret environment variable before switching Worker traffic.

## Render Path

Create a Web Service:

- Root directory: `sec-fetcher`
- Runtime: Docker
- Dockerfile path: `Dockerfile`
- Health check path: `/health`
- Environment variables: use the required environment block above

Render should expose a URL like `https://<service>.onrender.com`.

## Fly.io Path

From `sec-fetcher/`:

```bash
fly launch --name kabuyomi-sec-fetcher --dockerfile Dockerfile --no-deploy
fly secrets set SEC_FETCHER_SHARED_SECRET=<same-secret> SEC_USER_AGENT="Kabuyomi admin@kabuyomi.app"
fly deploy
```

## Switch Cloudflare Worker Traffic

After the new host returns healthy, set the Worker base URL to the new HTTPS origin:

```toml
# workers/wrangler.toml
SEC_FETCHER_BASE_URL = "https://<new-sec-fetcher-host>"
```

For the Cloudflare-native path, set the Worker to call the in-process SEC fetcher instead of a separate HTTP origin:

```toml
SEC_FETCHER_BASE_URL = "cloudflare-internal"
```

This keeps the existing SEC fetcher client contract in place while moving the SEC.gov fetch and MD&A preparation work into the Cloudflare Worker runtime.

Confirm the deployed Worker has the matching secret:

```bash
cd /Users/0xt4/t4dano/Kabuyomi/workers
npx wrangler secret put SEC_FETCHER_SHARED_SECRET
npm run deploy
```

## Smoke Checks

Check the replacement directly:

```bash
curl -fsS https://<new-sec-fetcher-host>/health

curl -fsS \
  -H "content-type: application/json" \
  -H "x-internal-token: $SEC_FETCHER_SHARED_SECRET" \
  -d '{"cik":"320193","includeHistory":false}' \
  https://<new-sec-fetcher-host>/internal/sec/submissions | head -c 200
```

Then check the Cloudflare Worker path that depends on SEC fetcher:

```bash
curl -fsS "https://<worker-host>/v1/search?q=AAPL" | head -c 500
curl -fsS "https://<worker-host>/v1/company/AAPL" | head -c 500
```

## Rollback

If the new host fails after switching traffic, revert `SEC_FETCHER_BASE_URL` in `workers/wrangler.toml` to the previous Railway URL, redeploy Workers, and keep the new host alive for log inspection.
