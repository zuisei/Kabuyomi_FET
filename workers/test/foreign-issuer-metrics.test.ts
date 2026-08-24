import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec-fetcher", () => ({
  fetchFilingAssetsFromFetcher: vi.fn(),
  fetchFilingHtmlFromFetcher: vi.fn(),
  fetchPreparedFilingFromFetcher: vi.fn(),
  fetchMetricsFromFetcher: vi.fn(),
  fetchSubmissionsFromFetcher: vi.fn(),
  fetchTickerSnapshotFromFetcher: vi.fn()
}));

import { fetchMetricSnapshots, pickLatestSupportedFiling } from "../src/clients/sec";
import { fetchMetricsFromFetcher } from "../src/clients/sec-fetcher";

const mockFetchMetricsFromFetcher = vi.mocked(fetchMetricsFromFetcher);

afterEach(() => {
  vi.clearAllMocks();
});

/// 数字はすべて TSMC の実データ(2026-08-24 に SEC の companyfacts から取得、
/// 20-F accn 0001193125-25-083423 / FY2024)。作文した値では、IFRS のタグ名や
/// TSMC が USD 換算値を併記していることを取り違えても気づけない。
const TSM_20F: Parameters<typeof fetchMetricSnapshots>[0] = {
  cik: "0001046179",
  ticker: "TSM",
  companyName: "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD",
  exchange: "NYSE",
  formType: "20-F",
  accessionNumber: "0001193125-25-083423",
  primaryDocument: "tsm-20241231.htm",
  filedAt: "2025-04-17",
  periodOfReport: "2024-12-31"
};

function ifrsFact(value: number, start: string | undefined, end: string) {
  return {
    val: value,
    accn: "0001193125-25-083423",
    form: "20-F",
    filed: "2025-04-17",
    fy: 2024,
    fp: "FY",
    ...(start ? { start } : {}),
    end
  };
}

const TSM_COMPANY_FACTS = {
  facts: {
    "ifrs-full": {
      Revenue: { units: { USD: [ifrsFact(88_268_000_000, "2024-01-01", "2024-12-31")] } },
      ProfitLossFromOperatingActivities: {
        units: { USD: [ifrsFact(40_318_800_000, "2024-01-01", "2024-12-31")] }
      },
      ProfitLoss: { units: { USD: [ifrsFact(35_301_100_000, "2024-01-01", "2024-12-31")] } },
      CashFlowsFromUsedInOperatingActivities: {
        units: { USD: [ifrsFact(55_693_100_000, "2024-01-01", "2024-12-31")] }
      },
      CashAndCashEquivalents: { units: { USD: [ifrsFact(64_886_500_000, undefined, "2024-12-31")] } }
    }
  }
};

describe("foreign issuers (20-F, ifrs-full)", () => {
  /// 20-F 提出者は 10-K も 10-Q も 1 本も出さない。ここが null を返す限り、
  /// TSM・ASML・SAP・トヨタ・BABA・Shell・NVO・ソニーは 1 社も扱えない。
  it("selects the 20-F as the analyzable filing for a company that files nothing else", () => {
    const filing = pickLatestSupportedFiling(
      { cik: "0001046179", ticker: "TSM", companyName: "TAIWAN SEMICONDUCTOR", exchange: "NYSE" },
      {
        filings: {
          recent: {
            // 直近は 6-K だらけ。TSM は月次売上速報などを毎月出す。
            form: ["6-K", "6-K", "20-F", "6-K"],
            accessionNumber: ["a-1", "a-2", "0001193125-25-083423", "a-4"],
            primaryDocument: ["x.htm", "y.htm", "tsm-20241231.htm", "z.htm"],
            filingDate: ["2025-08-10", "2025-07-16", "2025-04-17", "2025-03-10"],
            reportDate: ["2025-08-10", "2025-07-16", "2024-12-31", "2025-03-10"]
          }
        }
      } as never
    );

    expect(filing).toMatchObject({ formType: "20-F", periodOfReport: "2024-12-31" });
  });

  /// IFRS のタグ名は us-gaap と別物(Revenue / ProfitLossFromOperatingActivities /
  /// ProfitLoss / CashFlowsFromUsedInOperatingActivities)。
  it("reads the annual metrics out of ifrs-full", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {},
      companyFacts: TSM_COMPANY_FACTS
    } as never);

    const metrics = await fetchMetricSnapshots(TSM_20F, null, {} as never);
    const by = (name: string) => metrics.find((metric) => metric.logicalName === name);

    expect(by("revenue")).toMatchObject({ value: 88_268_000_000, unit: "USD", tagUsed: "Revenue" });
    expect(by("operatingIncome")).toMatchObject({
      value: 40_318_800_000,
      tagUsed: "ProfitLossFromOperatingActivities"
    });
    expect(by("netIncome")).toMatchObject({ value: 35_301_100_000, tagUsed: "ProfitLoss" });
    expect(by("operatingCashFlow")).toMatchObject({
      value: 55_693_100_000,
      tagUsed: "CashFlowsFromUsedInOperatingActivities"
    });
    expect(by("cashAndCashEquivalents")).toMatchObject({ value: 64_886_500_000 });
  });

  /// 20-F の期間は 1 年。四半期の窓(60〜120 日)で採ると年次の事実が全部落ちる。
  it("accepts the full-year duration a 20-F reports", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {},
      companyFacts: TSM_COMPANY_FACTS
    } as never);

    const metrics = await fetchMetricSnapshots(TSM_20F, null, {} as never);
    expect(metrics.find((metric) => metric.logicalName === "revenue")?.periodKind).toBe("annual");
  });

  /// TSMC は USD 換算値を併記するが、**EPS だけは現地通貨(TWD)しか無い**。
  /// 為替をこちらで当てれば数字は作れるが、それは出典の無い数字になる。出さないのが正しい。
  it("drops a metric that only exists in the local currency rather than converting it", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {},
      companyFacts: {
        facts: {
          "ifrs-full": {
            BasicEarningsLossPerShare: {
              units: { "TWD/shares": [ifrsFact(45.25, "2024-01-01", "2024-12-31")] }
            }
          }
        }
      }
    } as never);

    const metrics = await fetchMetricSnapshots(TSM_20F, null, {} as never);
    expect(metrics.find((metric) => metric.logicalName === "epsBasic")).toBeUndefined();
  });

  /// トヨタとソニーは両方のタクソノミで出す。us-gaap 側が先に選ばれること
  /// (= 既存の米国企業と同じ経路に乗ること)を固定する。
  it("prefers us-gaap when a company reports in both taxonomies", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {},
      companyFacts: {
        facts: {
          "us-gaap": { Revenues: { units: { USD: [ifrsFact(1_000, "2024-01-01", "2024-12-31")] } } },
          "ifrs-full": { Revenue: { units: { USD: [ifrsFact(2_000, "2024-01-01", "2024-12-31")] } } }
        }
      }
    } as never);

    const metrics = await fetchMetricSnapshots(TSM_20F, null, {} as never);
    expect(metrics.find((metric) => metric.logicalName === "revenue")).toMatchObject({
      value: 1_000,
      tagUsed: "Revenues"
    });
  });
});
