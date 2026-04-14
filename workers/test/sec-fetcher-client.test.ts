import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMetricsFromFetcher, fetchSubmissionsFromFetcher } from "../src/clients/sec-fetcher";

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
});
