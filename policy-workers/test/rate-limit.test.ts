import assert from "node:assert/strict";
import test from "node:test";
import api, { publicRequestAllowed, translationRequestAllowed, type Env } from "../src/index.ts";

function limiter(success: boolean): RateLimit {
  return {
    async limit(options: RateLimitOptions): Promise<RateLimitOutcome> {
      assert.equal(options.key, "public-api:203.0.113.10");
      return { success };
    }
  };
}

test("public API allows requests accepted by the Cloudflare limiter", async () => {
  const request = new Request("https://example.test/v1/events", { headers: { "cf-connecting-ip": "203.0.113.10" } });
  assert.equal(await publicRequestAllowed(request, limiter(true)), true);
});

test("public API rejects requests denied by the Cloudflare limiter", async () => {
  const request = new Request("https://example.test/v1/events", { headers: { "cf-connecting-ip": "203.0.113.10" } });
  assert.equal(await publicRequestAllowed(request, limiter(false)), false);
});

test("local development remains available without a binding or Cloudflare actor", async () => {
  assert.equal(await publicRequestAllowed(new Request("https://example.test/v1/events"), limiter(false)), true);
  assert.equal(await publicRequestAllowed(new Request("https://example.test/v1/events")), true);
});

test("translation requests use an independent per-actor limiter key", async () => {
  let key = "";
  const translationLimiter = {
    async limit(options: RateLimitOptions): Promise<RateLimitOutcome> {
      key = options.key;
      return { success: true };
    }
  } as RateLimit;
  const request = new Request("https://example.test/v1/events/event/translation", {
    headers: { "cf-connecting-ip": "203.0.113.10" }
  });
  assert.equal(await translationRequestAllowed(request, translationLimiter), true);
  assert.equal(key, "translation-request:203.0.113.10");
});

test("public API returns an explicit 429 contract when the limit is exceeded", async () => {
  const request = new Request("https://example.test/v1/events", { headers: { "cf-connecting-ip": "203.0.113.10" } });
  const response = await api.fetch(request, { PUBLIC_RATE_LIMITER: limiter(false) } as Env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("x-ratelimit-policy"), "300;w=60");
  assert.deepEqual(await response.json(), {
    data_mode: "synthetic",
    data: { error: { code: "rate_limited", message: "Public API request limit exceeded" } }
  });
});
