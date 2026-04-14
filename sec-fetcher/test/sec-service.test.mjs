import test from "node:test";
import assert from "node:assert/strict";
import { createSecService, fetchWithRetry, readConfig, validateInternalToken } from "../src/sec-service.mjs";

test("readConfig falls back to secure defaults", () => {
  const config = readConfig({});
  assert.equal(config.userAgent, "Kabuyomi admin@kabuyomi.app");
  assert.equal(config.rateLimitPerSecond, 8);
  assert.equal(config.retryCount, 2);
});

test("validateInternalToken accepts matching token", () => {
  assert.equal(validateInternalToken({ "x-internal-token": "secret" }, { internalToken: "secret" }), true);
  assert.equal(validateInternalToken({ "x-internal-token": "wrong" }, { internalToken: "secret" }), false);
});

test("fetchWithRetry retries 5xx responses before succeeding", async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async () => {
    calls.push(Date.now());
    if (calls.length === 1) {
      return new Response("temporary", { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const response = await fetchWithRetry(
      "https://example.com",
      { method: "GET" },
      { retryCount: 1, initialBackoffMs: 1 },
      { take: async () => {} }
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchMetrics returns concept map and company facts through the shared SEC service", async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/companyfacts/")) {
      return new Response(JSON.stringify({ facts: { "us-gaap": {} } }), { status: 200 });
    }
    return new Response(JSON.stringify({ units: { USD: [{ val: 1, form: "10-Q" }] } }), { status: 200 });
  };

  try {
    const service = createSecService({
      internalToken: "",
      userAgent: "Kabuyomi admin@kabuyomi.app",
      rateLimitPerSecond: 8,
      retryCount: 0,
      initialBackoffMs: 1
    });
    const payload = await service.fetchMetrics({
      cik: "0000320193",
      tags: ["Revenues", "NetIncomeLoss"]
    });

    assert.equal(Object.keys(payload.concepts).length, 2);
    assert.ok(payload.companyFacts);
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});
