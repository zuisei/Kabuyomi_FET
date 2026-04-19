import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec", () => ({
  listTickersByCik: vi.fn(),
  lookupTicker: vi.fn()
}));

import { listTickersByCik, lookupTicker } from "../src/clients/sec";
import { resolveTrackedTickersForExecution, selectTrackedTickerRepresentative } from "../src/lib/tracked-tickers";

afterEach(() => {
  vi.clearAllMocks();
});

describe("tracked ticker issuer normalization", () => {
  it("chooses a deterministic representative ticker for class-share aliases", () => {
    expect(selectTrackedTickerRepresentative(["GOOGL", "GOOG"])).toBe("GOOG");
    expect(selectTrackedTickerRepresentative(["BRK-B", "BRK-A"])).toBe("BRK-A");
  });

  it("dedupes configured tracked tickers by issuer and resolves a representative automatically", async () => {
    vi.mocked(lookupTicker)
      .mockResolvedValueOnce({
        ticker: "GOOG",
        companyName: "Alphabet",
        cik: "0001652044",
        exchange: "Nasdaq"
      } as never)
      .mockResolvedValueOnce({
        ticker: "GOOGL",
        companyName: "Alphabet",
        cik: "0001652044",
        exchange: "Nasdaq"
      } as never)
      .mockResolvedValueOnce({
        ticker: "BRK-B",
        companyName: "Berkshire Hathaway",
        cik: "0001067983",
        exchange: "NYSE"
      } as never);
    vi.mocked(listTickersByCik)
      .mockResolvedValueOnce(["GOOGL", "GOOG"] as never)
      .mockResolvedValueOnce(["BRK-B", "BRK-A"] as never);

    const resolved = await resolveTrackedTickersForExecution(
      {
        trackedTickers: ["GOOGL", "GOOG", "BRK-B"]
      },
      {} as never
    );

    expect(resolved).toEqual(["GOOG", "BRK-A"]);
  });
});
