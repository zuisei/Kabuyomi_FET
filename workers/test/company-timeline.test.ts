import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec-fetcher", () => ({
  fetchFilingAssetsFromFetcher: vi.fn(),
  fetchFilingHtmlFromFetcher: vi.fn(),
  fetchPreparedFilingFromFetcher: vi.fn(),
  fetchMetricsFromFetcher: vi.fn(),
  fetchSubmissionsFromFetcher: vi.fn(),
  fetchTickerSnapshotFromFetcher: vi.fn(),
  listFilingDocumentsFromFetcher: vi.fn()
}));
vi.mock("../src/clients/sec", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/clients/sec")>()),
  lookupTicker: vi.fn()
}));

import { loadCompanyTimeline } from "../src/lib/company/timeline";
import { lookupTicker } from "../src/clients/sec";
import { fetchMetricsFromFetcher } from "../src/clients/sec-fetcher";

const mockLookup = vi.mocked(lookupTicker);
const mockMetrics = vi.mocked(fetchMetricsFromFetcher);

afterEach(() => vi.clearAllMocks());

/// Apple の実データ(SEC、2026-08-25 取得)。タグが年で切り替わるところが肝。
function annual(value: number, year: number, filed: string, accn: string) {
  return { val: value, start: `${year - 1}-09-30`, end: `${year}-09-28`, form: "10-K", fp: "FY", filed, accn };
}

describe("company timeline", () => {
  it("builds the whole span, links each year to its filing, and marks the turn", async () => {
    mockLookup.mockResolvedValue({
      cik: "0000320193",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      exchange: "NASDAQ"
    } as never);
    mockMetrics.mockResolvedValue({
      concepts: {
        SalesRevenueNet: {
          units: {
            USD: [
              annual(233_715_000_000, 2015, "2015-10-28", "0000320193-15-000356"),
              annual(215_639_000_000, 2016, "2016-10-26", "0000320193-16-000096")
            ]
          }
        },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              annual(229_234_000_000, 2017, "2019-10-31", "0000320193-19-000119"),
              annual(265_595_000_000, 2018, "2019-10-31", "0000320193-19-000119")
            ]
          }
        }
      },
      companyFacts: null
    } as never);

    const timeline = (await loadCompanyTimeline("AAPL", {} as never))!;

    // タグを跨いで 1 本の歴史になっていること。
    expect(timeline.points.map((point) => point.fiscalYear)).toEqual([2015, 2016, 2017, 2018]);
    expect(timeline.companyName).toBe("Apple Inc.");

    // 各行から原文へ辿れること。
    expect(timeline.points[0]?.sourceUrl)
      .toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019315000356/");

    // 前年比。
    expect(timeline.points[1]?.changePercent).toBeCloseTo(-7.7, 1);
    expect(timeline.points[0]?.changePercent).toBeNull();

    // Apple が初めて減収した年。年表で目を留めさせたいのはここ。
    expect(timeline.turningPoints.find((point) => point.kind === "first_decline")?.fiscalYear).toBe(2016);
  });

  it("returns nothing for a ticker that does not resolve", async () => {
    mockLookup.mockResolvedValue(null as never);
    expect(await loadCompanyTimeline("NOPE", {} as never)).toBeNull();
  });

  it("returns nothing when the company has no annual revenue facts", async () => {
    mockLookup.mockResolvedValue({ cik: "1", ticker: "X", companyName: "X", exchange: "NYSE" } as never);
    mockMetrics.mockResolvedValue({ concepts: {}, companyFacts: null } as never);
    expect(await loadCompanyTimeline("X", {} as never)).toBeNull();
  });
});
