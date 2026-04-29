import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFilingAssetsFromFetcher,
  fetchMetricsFromFetcher,
  fetchPreparedFilingFromFetcher,
  fetchSubmissionsFromFetcher
} from "../src/clients/sec-fetcher";

describe("sec fetcher client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends submissions requests to the configured fetcher", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchSubmissionsFromFetcher("0000320193", {
      SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
      SEC_FETCHER_SHARED_SECRET: "secret"
    } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8789/internal/sec/submissions",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers)
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      cik: "0000320193",
      includeHistory: false
    });
  });

  it("passes submissions requests through the SEC rate limiter before the fetcher", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const limiterFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await fetchSubmissionsFromFetcher("0000320193", {
      SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
      SEC_RATE_LIMITER: {
        getByName: vi.fn().mockReturnValue({ fetch: limiterFetch })
      }
    } as never);

    expect(limiterFetch).toHaveBeenCalledWith("https://do/sec-rate-limit?tokens=1");
    expect(limiterFetch.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it("can request expanded submission history only for history-aware paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchSubmissionsFromFetcher(
      "0000320193",
      {
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_FETCHER_SHARED_SECRET: "secret"
      } as never,
      { includeHistory: true }
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      cik: "0000320193",
      includeHistory: true
    });
  });

  it("throws a clear error when the fetcher is not configured", async () => {
    await expect(
      fetchMetricsFromFetcher("0000320193", ["Revenues"], {} as never)
    ).rejects.toThrow("SEC fetcher base URL is not configured");
  });

  it("times out fetcher requests and returns a public app error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_, init?: RequestInit) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      })
    );

    let error: (Error & { publicMessage?: string }) | null = null;
    try {
      await fetchSubmissionsFromFetcher("0000320193", {
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_FETCHER_SHARED_SECRET: "secret",
        SEC_FETCHER_TIMEOUT_MS: "1"
      } as never);
    } catch (caught) {
      error = caught as Error & { publicMessage?: string };
    }

    expect(error).toBeTruthy();
    expect(error?.message).toContain("timed out");
    expect(error?.publicMessage).toBe("SEC data is temporarily unavailable");
  });

  it("sends filing-assets requests to the configured fetcher", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ html: "<html></html>", primaryDocumentUrl: "https://sec.test/doc", concepts: {}, companyFacts: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchFilingAssetsFromFetcher(
      {
        cik: "0000320193",
        ticker: "AAPL",
        companyName: "Apple Inc.",
        exchange: "Nasdaq",
        formType: "10-Q",
        accessionNumber: "0000320193-26-000057",
        primaryDocument: "a10q.htm",
        filedAt: "2026-02-03",
        periodOfReport: "2025-12-28"
      },
      ["Revenues"],
      {
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_FETCHER_SHARED_SECRET: "secret"
      } as never
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8789/internal/sec/filing-assets",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers)
      })
    );
  });

  it("charges two SEC rate limiter tokens for filing-assets requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ html: "<html></html>", primaryDocumentUrl: "https://sec.test/doc", concepts: {}, companyFacts: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const limiterFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await fetchFilingAssetsFromFetcher(
      {
        cik: "0000320193",
        ticker: "AAPL",
        companyName: "Apple Inc.",
        exchange: "Nasdaq",
        formType: "10-Q",
        accessionNumber: "0000320193-26-000057",
        primaryDocument: "a10q.htm",
        filedAt: "2026-02-03",
        periodOfReport: "2025-12-28"
      },
      ["Revenues"],
      {
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_RATE_LIMITER: {
          getByName: vi.fn().mockReturnValue({ fetch: limiterFetch })
        }
      } as never
    );

    expect(limiterFetch).toHaveBeenCalledWith("https://do/sec-rate-limit?tokens=2");
  });

  it("sends prepared-filing requests and charges two SEC rate limiter tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          primaryDocumentUrl: "https://sec.test/doc",
          mdaText: "Management discussion",
          mdaTokenCount: 5,
          usedStartPattern: "item 2",
          usedEndPattern: "item 3",
          diagnostics: {
            inputHtmlChars: 100,
            normalizedChars: 80,
            startMatchesCount: 1,
            endMatchesCount: 1,
            sanitizeMs: 0,
            domParseMs: 0,
            textReadMs: 0,
            cleanupMs: 0,
            normalizeMs: 0,
            boundaryScanMs: 0,
            selectionMs: 0,
            totalMs: 0
          },
          concepts: {},
          companyFacts: null
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const limiterFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const response = await fetchPreparedFilingFromFetcher(
      {
        cik: "0000320193",
        ticker: "AAPL",
        companyName: "Apple Inc.",
        exchange: "Nasdaq",
        formType: "10-Q",
        accessionNumber: "0000320193-26-000057",
        primaryDocument: "a10q.htm",
        filedAt: "2026-02-03",
        periodOfReport: "2025-12-28"
      },
      ["Revenues"],
      {
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_RATE_LIMITER: {
          getByName: vi.fn().mockReturnValue({ fetch: limiterFetch })
        }
      } as never
    );

    expect(response?.mdaText).toBe("Management discussion");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8789/internal/sec/prepared-filing",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers)
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      cik: "0000320193",
      accessionNumber: "0000320193-26-000057",
      primaryDocument: "a10q.htm",
      formType: "10-Q",
      tags: ["Revenues"]
    });
    expect(limiterFetch).toHaveBeenCalledWith("https://do/sec-rate-limit?tokens=2");
  });

  it("returns null when prepared-filing is unavailable on the fetcher", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Not found" }), { status: 404 })));

    const response = await fetchPreparedFilingFromFetcher(
      {
        cik: "0000320193",
        ticker: "AAPL",
        companyName: "Apple Inc.",
        exchange: "Nasdaq",
        formType: "10-Q",
        accessionNumber: "0000320193-26-000057",
        primaryDocument: "a10q.htm",
        filedAt: "2026-02-03",
        periodOfReport: "2025-12-28"
      },
      ["Revenues"],
      {
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_FETCHER_SHARED_SECRET: "secret"
      } as never
    );

    expect(response).toBeNull();
  });

  it("passes each retry attempt through the SEC rate limiter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const limiterFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await fetchSubmissionsFromFetcher("0000320193", {
      SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
      SEC_RATE_LIMITER: {
        getByName: vi.fn().mockReturnValue({ fetch: limiterFetch })
      }
    } as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(limiterFetch).toHaveBeenCalledTimes(2);
    expect(limiterFetch).toHaveBeenNthCalledWith(1, "https://do/sec-rate-limit?tokens=1");
    expect(limiterFetch).toHaveBeenNthCalledWith(2, "https://do/sec-rate-limit?tokens=1");
  });

  it("falls back to filing and metrics endpoints when filing-assets is unavailable on the fetcher", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Not found" }), { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ html: "<html>fallback</html>", primaryDocumentUrl: "https://sec.test/fallback" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ concepts: { Revenues: null }, companyFacts: null }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchFilingAssetsFromFetcher(
      {
        cik: "0000320193",
        ticker: "AAPL",
        companyName: "Apple Inc.",
        exchange: "Nasdaq",
        formType: "10-Q",
        accessionNumber: "0000320193-26-000057",
        primaryDocument: "a10q.htm",
        filedAt: "2026-02-03",
        periodOfReport: "2025-12-28"
      },
      ["Revenues"],
      {
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_FETCHER_SHARED_SECRET: "secret"
      } as never
    );

    expect(response).toEqual({
      html: "<html>fallback</html>",
      primaryDocumentUrl: "https://sec.test/fallback",
      concepts: { Revenues: null },
      companyFacts: null
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8789/internal/sec/filing",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers)
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:8789/internal/sec/metrics",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers)
      })
    );
  });
});
