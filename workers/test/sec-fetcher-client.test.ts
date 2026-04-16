import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFilingAssetsFromFetcher, fetchMetricsFromFetcher, fetchSubmissionsFromFetcher } from "../src/clients/sec-fetcher";

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
