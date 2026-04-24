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
  assert.equal(validateInternalToken({ "x-internal-token": "secret" }, { internalToken: "" }), false);
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
      return new Response(JSON.stringify({
        facts: {
          "us-gaap": {
            Revenues: { units: { USD: [{ val: 1, form: "10-Q" }] } },
            NetIncomeLoss: { units: { USD: [{ val: 2, form: "10-Q" }] } }
          }
        }
      }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
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
    assert.equal(payload.concepts.Revenues.units.USD[0].val, 1);
    assert.equal(payload.concepts.NetIncomeLoss.units.USD[0].val, 2);
    assert.deepEqual(calls, ["https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchMetrics falls back to companyconcept only for tags missing from companyfacts", async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("/companyfacts/")) {
      return new Response(JSON.stringify({
        facts: {
          "us-gaap": {
            Revenues: { units: { USD: [{ val: 1, form: "10-Q" }] } }
          }
        }
      }), { status: 200 });
    }
    if (target.includes("/companyconcept/") && target.endsWith("/NetIncomeLoss.json")) {
      return new Response(JSON.stringify({ units: { USD: [{ val: 2, form: "10-Q" }] } }), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${target}`);
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
    const payload = await service.fetchMetrics({
      cik: "0000320193",
      tags: ["Revenues", "NetIncomeLoss"]
    });

    assert.equal(payload.concepts.Revenues.units.USD[0].val, 1);
    assert.equal(payload.concepts.NetIncomeLoss.units.USD[0].val, 2);
    assert.deepEqual(calls, [
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/NetIncomeLoss.json"
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchMetrics falls back to companyconcept when companyfacts is temporarily unavailable", async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("/companyfacts/")) {
      return new Response("temporary", { status: 503 });
    }
    if (target.endsWith("/Revenues.json")) {
      return new Response(JSON.stringify({ units: { USD: [{ val: 10, form: "10-Q" }] } }), { status: 200 });
    }
    if (target.endsWith("/NetIncomeLoss.json")) {
      return new Response(JSON.stringify({ units: { USD: [{ val: 3, form: "10-Q" }] } }), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${target}`);
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
    const payload = await service.fetchMetrics({
      cik: "0000320193",
      tags: ["Revenues", "NetIncomeLoss"]
    });

    assert.equal(payload.companyFacts, null);
    assert.equal(payload.concepts.Revenues.units.USD[0].val, 10);
    assert.equal(payload.concepts.NetIncomeLoss.units.USD[0].val, 3);
    assert.deepEqual(calls, [
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json",
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/NetIncomeLoss.json"
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchMetrics preserves fulfilled concept fallbacks when a sibling tag fails", async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("/companyfacts/")) {
      return new Response(JSON.stringify({
        facts: {
          "us-gaap": {
            Revenues: { units: { USD: [{ val: 1, form: "10-Q" }] } }
          }
        }
      }), { status: 200 });
    }
    if (target.endsWith("/NetIncomeLoss.json")) {
      return new Response(JSON.stringify({ units: { USD: [{ val: 2, form: "10-Q" }] } }), { status: 200 });
    }
    if (target.endsWith("/OperatingIncomeLoss.json")) {
      return new Response("temporary", { status: 503 });
    }

    throw new Error(`Unexpected fetch: ${target}`);
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
    const payload = await service.fetchMetrics({
      cik: "0000320193",
      tags: ["Revenues", "NetIncomeLoss", "OperatingIncomeLoss"]
    });

    assert.equal(payload.concepts.Revenues.units.USD[0].val, 1);
    assert.equal(payload.concepts.NetIncomeLoss.units.USD[0].val, 2);
    assert.equal(payload.concepts.OperatingIncomeLoss, null);
    assert.deepEqual(calls, [
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/NetIncomeLoss.json",
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/OperatingIncomeLoss.json"
    ]);
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

test("fetchSubmissions skips older split submission files on latest-only requests", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);

    if (target.endsWith("/CIK0001326801.json")) {
      return new Response(
        JSON.stringify({
          filings: {
            recent: {
              form: ["10-K"],
              accessionNumber: ["0001326801-26-000017"],
              primaryDocument: ["meta-20251231.htm"],
              filingDate: ["2026-01-29"],
              reportDate: ["2025-12-31"]
            },
            files: [
              {
                name: "CIK0001326801-submissions-001.json",
                filingCount: 2001,
                filingFrom: "2016-11-02",
                filingTo: "2024-03-18"
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected fetch: ${target}`);
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
    const payload = await service.fetchSubmissions("0001326801");

    assert.deepEqual(payload.filings.recent.accessionNumber, ["0001326801-26-000017"]);
    assert.deepEqual(calls, ["https://data.sec.gov/submissions/CIK0001326801.json"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchSubmissions merges older split submissions files when history is requested and recent annual history is incomplete", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);

    if (target.endsWith("/CIK0001326801.json")) {
      return new Response(
        JSON.stringify({
          filings: {
            recent: {
              form: ["10-K", "10-Q", "10-Q", "10-Q", "10-Q", "10-K"],
              accessionNumber: [
                "0001326801-26-000017",
                "0001326801-25-000101",
                "0001326801-25-000075",
                "0001326801-25-000048",
                "0001326801-25-000020",
                "0001326801-25-000018"
              ],
              primaryDocument: [
                "meta-20251231.htm",
                "meta-q3.htm",
                "meta-q2.htm",
                "meta-q1.htm",
                "meta-q4.htm",
                "meta-20241231.htm"
              ],
              filingDate: [
                "2026-01-29",
                "2025-10-29",
                "2025-07-30",
                "2025-04-30",
                "2025-01-29",
                "2025-01-30"
              ],
              reportDate: [
                "2025-12-31",
                "2025-09-30",
                "2025-06-30",
                "2025-03-31",
                "2024-12-31",
                "2024-12-31"
              ]
            },
            files: [
              {
                name: "CIK0001326801-submissions-001.json",
                filingCount: 2001,
                filingFrom: "2016-11-02",
                filingTo: "2024-03-18"
              },
              {
                name: "CIK0001326801-submissions-002.json",
                filingCount: 1064,
                filingFrom: "2005-05-06",
                filingTo: "2016-10-31"
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (target.endsWith("/CIK0001326801-submissions-001.json")) {
      return new Response(
        JSON.stringify({
          form: ["10-K"],
          accessionNumber: ["0001326801-24-000012"],
          primaryDocument: ["meta-20231231.htm"],
          filingDate: ["2024-02-02"],
          reportDate: ["2023-12-31"]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected fetch: ${target}`);
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
    const payload = await service.fetchSubmissions("0001326801", { includeHistory: true });

    assert.deepEqual(
      payload.filings.recent.accessionNumber.slice(0, 7),
      [
        "0001326801-26-000017",
        "0001326801-25-000101",
        "0001326801-25-000075",
        "0001326801-25-000048",
        "0001326801-25-000018",
        "0001326801-25-000020",
        "0001326801-24-000012"
      ]
    );
    assert.deepEqual(calls, [
      "https://data.sec.gov/submissions/CIK0001326801.json",
      "https://data.sec.gov/submissions/CIK0001326801-submissions-001.json"
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchFilingAssets deduplicates concurrent upstream work", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url) => {
    calls.push(String(url));
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (String(url).includes("/companyfacts/")) {
      return new Response(JSON.stringify({
        facts: {
          "us-gaap": {
            Revenues: { units: { USD: [{ val: 1, form: "10-Q" }] } }
          }
        }
      }), { status: 200 });
    }
    if (String(url).includes("/companyconcept/")) {
      return new Response(JSON.stringify({ units: { USD: [{ val: 1, form: "10-Q" }] } }), { status: 200 });
    }
    return new Response("<html>filing</html>", { status: 200 });
  };

  try {
    const service = createSecService({
      internalToken: "",
      userAgent: "Kabuyomi admin@kabuyomi.app",
      rateLimitPerSecond: 8,
      retryCount: 0,
      initialBackoffMs: 1,
      requestTimeoutMs: 50
    });

    await Promise.all([
      service.fetchFilingAssets({
        cik: "0000320193",
        accessionNumber: "0000320193-26-000057",
        primaryDocument: "a10q.htm",
        tags: ["Revenues"]
      }),
      service.fetchFilingAssets({
        cik: "0000320193",
        accessionNumber: "0000320193-26-000057",
        primaryDocument: "a10q.htm",
        tags: ["Revenues"]
      })
    ]);

    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
