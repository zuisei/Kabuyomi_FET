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

test("fetchWithRetry retries after timeout and then succeeds", async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async (_, init) => {
    calls += 1;
    if (calls === 1) {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const response = await fetchWithRetry(
      "https://example.com",
      { method: "GET" },
      { retryCount: 1, initialBackoffMs: 1, requestTimeoutMs: 1 },
      { take: async () => {} }
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
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

test("fetchSubmissions serves cached data when the upstream later fails", async () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  let calls = 0;
  let now = 0;

  Date.now = () => now;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } }), { status: 200 });
    }
    throw new Error("upstream failure");
  };

  try {
    const service = createSecService({
      internalToken: "",
      userAgent: "Kabuyomi admin@kabuyomi.app",
      rateLimitPerSecond: 8,
      retryCount: 0,
      initialBackoffMs: 1,
      requestTimeoutMs: 10
    });
    const first = await service.fetchSubmissions("0000320193");
    now = 31 * 60 * 1000;
    const second = await service.fetchSubmissions("0000320193");

    assert.deepEqual(second, first);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
  }
});
