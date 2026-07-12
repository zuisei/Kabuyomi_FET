import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-ignore Node ESM operator script is exercised by Vitest but is not part of the Worker build.
const { buildBackfillPayload, main, parseBackfillArgs, runBackfillRequest } = await import("../scripts/backfill-history.mjs");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("history backfill operator script", () => {
  it("parses full-content prewarm mode and per-ticker continuation cursors", () => {
    const options = parseBackfillArgs([
      "--content-mode=full",
      "--cursor=aapl:4",
      "--cursor=MSFT:8",
      "--forms=10-k,10-q",
      "--tickers=aapl,msft",
      "--max-filings-per-ticker=4",
      "--max-total-filings=8"
    ]);

    expect(buildBackfillPayload(options)).toEqual({
      tickers: ["AAPL", "MSFT"],
      years: 3,
      forms: ["10-K", "10-Q"],
      maxFilingsPerTicker: 4,
      maxTotalFilings: 8,
      contentMode: "full",
      cursorByTicker: { AAPL: 4, MSFT: 8 }
    });
  });

  it("sends the requested content mode and cursors with the internal credential", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ failedTickers: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const options = parseBackfillArgs(["--content-mode=full", "--cursor=AAPL:4", "AAPL"]);

    await runBackfillRequest({
      options,
      baseUrl: "https://worker.example",
      sharedSecret: "one-time-secret",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://worker.example/v1/internal/backfill/history");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ "x-internal-token": "one-time-secret" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      tickers: ["AAPL"],
      contentMode: "full",
      cursorByTicker: { AAPL: 4 }
    });
  });

  it("returns exit code 2 when any ticker fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      failedTickers: [{ ticker: "AAPL", error: "upstream" }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    await expect(main(["AAPL"], {
      BACKFILL_URL: "https://worker.example",
      BACKFILL_SHARED_SECRET: "one-time-secret"
    })).resolves.toBe(2);
  });

  it("refuses plaintext remote transport before exposing the internal credential", async () => {
    const fetchImpl = vi.fn();
    await expect(runBackfillRequest({
      options: parseBackfillArgs(["AAPL"]),
      baseUrl: "http://worker.example",
      sharedSecret: "one-time-secret",
      fetchImpl
    })).rejects.toThrow("BACKFILL_URL must use HTTPS outside loopback development");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects instead of forwarding the internal credential", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      if (init.redirect === "error") throw new TypeError("redirect rejected");
      return new Response(null, { status: 302 });
    });
    await expect(runBackfillRequest({
      options: parseBackfillArgs(["AAPL"]),
      baseUrl: "https://worker.example",
      sharedSecret: "one-time-secret",
      fetchImpl
    })).rejects.toThrow("redirect rejected");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed content modes and cursors before issuing a request", () => {
    expect(() => parseBackfillArgs(["--content-mode=summary"])).toThrow("--content-mode must be metrics_only or full");
    expect(() => parseBackfillArgs(["--cursor=AAPL:-1"])).toThrow("--cursor must use TICKER:NON_NEGATIVE_INTEGER");
  });
});
