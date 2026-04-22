import type { FilingReference } from "../../src/env";
import type { CompanyFactsResponse, ConceptResponse } from "../../src/clients/sec";

type FetcherMetricsPayload = {
  concepts: Record<string, ConceptResponse | null>;
  companyFacts: CompanyFactsResponse | null;
};

export type RevenueRegressionCase = {
  name: string;
  currentFiling: FilingReference;
  comparisonFiling: FilingReference | null;
  payload: FetcherMetricsPayload;
  expected: {
    tagUsed: string;
    value: number;
    comparisonValue?: number;
  };
};

function filingReference(
  overrides: Partial<FilingReference> & Pick<FilingReference, "ticker" | "companyName" | "cik" | "exchange" | "formType" | "accessionNumber" | "primaryDocument" | "filedAt" | "periodOfReport">
): FilingReference {
  return {
    ticker: overrides.ticker,
    companyName: overrides.companyName,
    cik: overrides.cik,
    exchange: overrides.exchange,
    formType: overrides.formType,
    accessionNumber: overrides.accessionNumber,
    primaryDocument: overrides.primaryDocument,
    filedAt: overrides.filedAt,
    periodOfReport: overrides.periodOfReport
  };
}

// Regression fixtures are trimmed from SEC companyfacts/companyconcept payloads.
export const REVENUE_REGRESSION_CASES: RevenueRegressionCase[] = [
  {
    name: "prefers Circle annual Revenues over contract-only revenue components",
    currentFiling: filingReference({
      cik: "0001876042",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      exchange: "NYSE",
      formType: "10-K",
      accessionNumber: "0001876042-26-000062",
      primaryDocument: "crcl-20251231.htm",
      filedAt: "2026-03-09",
      periodOfReport: "2025-12-31"
    }),
    comparisonFiling: filingReference({
      cik: "0001876042",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      exchange: "NYSE",
      formType: "10-K",
      accessionNumber: "0001876042-26-000062",
      primaryDocument: "crcl-20251231.htm",
      filedAt: "2026-03-09",
      periodOfReport: "2024-12-31"
    }),
    payload: {
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 1_676_253_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2024-01-01",
                end: "2024-12-31"
              },
              {
                val: 2_746_642_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2025-01-01",
                end: "2025-12-31"
              }
            ]
          }
        },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              {
                val: 15_169_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2024-01-01",
                end: "2024-12-31"
              },
              {
                val: 109_820_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2025-01-01",
                end: "2025-12-31"
              }
            ]
          }
        }
      },
      companyFacts: null
    },
    expected: {
      tagUsed: "Revenues",
      value: 2_746_642_000,
      comparisonValue: 1_676_253_000
    }
  },
  {
    name: "prefers Circle quarterly Revenues over YTD and contract-only values in 10-Q filings",
    currentFiling: filingReference({
      cik: "0001876042",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      exchange: "NYSE",
      formType: "10-Q",
      accessionNumber: "0001876042-25-000051",
      primaryDocument: "crcl-20250930.htm",
      filedAt: "2025-11-12",
      periodOfReport: "2025-09-30"
    }),
    comparisonFiling: filingReference({
      cik: "0001876042",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      exchange: "NYSE",
      formType: "10-Q",
      accessionNumber: "0001876042-25-000051",
      primaryDocument: "crcl-20250930.htm",
      filedAt: "2025-11-12",
      periodOfReport: "2024-09-30"
    }),
    payload: {
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 1_240_886_000,
                form: "10-Q",
                filed: "2025-11-12",
                start: "2024-01-01",
                end: "2024-09-30"
              },
              {
                val: 445_762_000,
                form: "10-Q",
                filed: "2025-11-12",
                start: "2024-07-01",
                end: "2024-09-30"
              },
              {
                val: 1_976_410_000,
                form: "10-Q",
                filed: "2025-11-12",
                start: "2025-01-01",
                end: "2025-09-30"
              },
              {
                val: 739_759_000,
                form: "10-Q",
                filed: "2025-11-12",
                start: "2025-07-01",
                end: "2025-09-30"
              }
            ]
          }
        },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              {
                val: 12_769_000,
                form: "10-Q",
                filed: "2025-11-12",
                start: "2024-01-01",
                end: "2024-09-30"
              },
              {
                val: 547_000,
                form: "10-Q",
                filed: "2025-11-12",
                start: "2024-07-01",
                end: "2024-09-30"
              },
              {
                val: 72_984_000,
                form: "10-Q",
                filed: "2025-11-12",
                start: "2025-01-01",
                end: "2025-09-30"
              },
              {
                val: 28_518_000,
                form: "10-Q",
                filed: "2025-11-12",
                start: "2025-07-01",
                end: "2025-09-30"
              }
            ]
          }
        }
      },
      companyFacts: null
    },
    expected: {
      tagUsed: "Revenues",
      value: 739_759_000,
      comparisonValue: 445_762_000
    }
  },
  {
    name: "falls through to Apple SalesRevenueNet and ignores the YTD fact in 10-Q filings",
    currentFiling: filingReference({
      cik: "0000320193",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      exchange: "Nasdaq",
      formType: "10-Q",
      accessionNumber: "0000320193-18-000100",
      primaryDocument: "a10-q20186302018.htm",
      filedAt: "2018-08-01",
      periodOfReport: "2018-06-30"
    }),
    comparisonFiling: filingReference({
      cik: "0000320193",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      exchange: "Nasdaq",
      formType: "10-Q",
      accessionNumber: "0000320193-18-000100",
      primaryDocument: "a10-q20186302018.htm",
      filedAt: "2018-08-01",
      periodOfReport: "2017-07-01"
    }),
    payload: {
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 229_234_000_000,
                form: "10-K",
                filed: "2018-11-05",
                start: "2016-09-25",
                end: "2017-09-30"
              },
              {
                val: 265_595_000_000,
                form: "10-K",
                filed: "2018-11-05",
                start: "2017-10-01",
                end: "2018-09-29"
              }
            ]
          }
        },
        SalesRevenueNet: {
          units: {
            USD: [
              {
                val: 202_695_000_000,
                form: "10-Q",
                filed: "2018-08-01",
                start: "2017-10-01",
                end: "2018-06-30"
              },
              {
                val: 53_265_000_000,
                form: "10-Q",
                filed: "2018-08-01",
                start: "2018-04-01",
                end: "2018-06-30"
              },
              {
                val: 45_408_000_000,
                form: "10-Q",
                filed: "2018-08-01",
                start: "2017-04-02",
                end: "2017-07-01"
              }
            ]
          }
        }
      },
      companyFacts: null
    },
    expected: {
      tagUsed: "SalesRevenueNet",
      value: 53_265_000_000,
      comparisonValue: 45_408_000_000
    }
  }
];
