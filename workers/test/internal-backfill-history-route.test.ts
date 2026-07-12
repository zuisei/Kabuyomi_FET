import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

const mocks = vi.hoisted(() => ({
  backfillHistoricalFilings: vi.fn(),
  ensureHistoricalFilingStored: vi.fn(),
  resolveTrackedTickersForExecution: vi.fn()
}));

vi.mock("../src/lib/history-store", () => ({
  backfillHistoricalFilings: mocks.backfillHistoricalFilings
}));
vi.mock("../src/lib/filings/history-persistence", () => ({
  ensureHistoricalFilingStored: mocks.ensureHistoricalFilingStored
}));
vi.mock("../src/lib/tracked-tickers", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/tracked-tickers")>(),
  resolveTrackedTickersForExecution: mocks.resolveTrackedTickersForExecution
}));

import { handleInternalBackfillHistoryRoute } from "../src/routes/internal-backfill-history";

describe("internal history backfill route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrackedTickersForExecution.mockResolvedValue(["AAPL"]);
    mocks.ensureHistoricalFilingStored.mockResolvedValue({ filingKey: "v7:test" });
    mocks.backfillHistoricalFilings.mockImplementation(async (options, env, config, ensureStored) => {
      await ensureStored({ filingKey: "source" }, null, env, config);
      return { failedTickers: [], options };
    });
  });

  it("passes full-content mode and continuation cursors through the bounded backfill", async () => {
    const response = await callRoute({
      tickers: ["AAPL"],
      forms: ["10-K", "10-Q"],
      maxFilingsPerTicker: 4,
      maxTotalFilings: 4,
      cursorByTicker: { AAPL: 4 },
      contentMode: "full"
    });

    expect(response.status).toBe(200);
    expect(mocks.backfillHistoricalFilings).toHaveBeenCalledWith(
      expect.objectContaining({
        tickers: ["AAPL"],
        forms: ["10-K", "10-Q"],
        cursorByTicker: { AAPL: 4 },
        contentMode: "full"
      }),
      expect.anything(),
      expect.anything(),
      expect.any(Function)
    );
    expect(mocks.ensureHistoricalFilingStored).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.anything(),
      expect.anything(),
      { contentMode: "full" }
    );
  });

  it("defaults omitted content mode to metrics-only", async () => {
    const response = await callRoute({ tickers: ["AAPL"] });

    expect(response.status).toBe(200);
    expect(mocks.ensureHistoricalFilingStored).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.anything(),
      expect.anything(),
      { contentMode: "metrics_only" }
    );
  });

  it("rejects an unsupported content mode", async () => {
    await expect(callRoute({ tickers: ["AAPL"], contentMode: "summary" })).rejects.toMatchObject({
      status: 400,
      publicMessage: "Invalid backfill payload"
    });
    expect(mocks.backfillHistoricalFilings).not.toHaveBeenCalled();
  });
});

async function callRoute(body: Record<string, unknown>): Promise<Response> {
  const request = new Request("https://kabuyomi.test/v1/internal/backfill/history", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": "one-time-secret"
    },
    body: JSON.stringify(body)
  });
  const response = await handleInternalBackfillHistoryRoute({
    request,
    url: new URL(request.url),
    env: { BACKFILL_SHARED_SECRET: "one-time-secret" } as never,
    config: DEFAULT_REMOTE_CONFIG,
    ctx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never
  });
  if (!response) throw new Error("Backfill route was not matched");
  return response;
}
