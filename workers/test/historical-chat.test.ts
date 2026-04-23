import { describe, expect, it } from "vitest";
import type { FilingReference } from "../src/env";
import { selectHistoricalAutohydrationCandidates } from "../src/lib/history-autohydration";

function makeFiling(
  formType: FilingReference["formType"],
  accessionNumber: string,
  periodOfReport: string
): FilingReference {
  return {
    cik: "0000320193",
    ticker: "AAPL",
    companyName: "Apple Inc.",
    exchange: "Nasdaq",
    formType,
    accessionNumber,
    primaryDocument: `${accessionNumber}.htm`,
    filedAt: periodOfReport,
    periodOfReport
  };
}

describe("selectHistoricalAutohydrationCandidates", () => {
  it("picks the two latest annual filings inside the three-year window", () => {
    const current = makeFiling("10-K", "0001-04", "2025-09-28");
    const candidates = selectHistoricalAutohydrationCandidates(current, [
      current,
      makeFiling("10-K", "0001-03", "2024-09-29"),
      makeFiling("10-K", "0001-02", "2023-09-24"),
      makeFiling("10-K", "0001-01", "2022-09-25"),
      makeFiling("10-K", "0001-00", "2021-09-26")
    ]);

    expect(candidates.map((candidate) => candidate.accessionNumber)).toEqual(["0001-03", "0001-02"]);
  });

  it("picks matching prior-year quarters instead of adjacent quarters", () => {
    const current = makeFiling("10-Q", "0002-05", "2025-12-27");
    const candidates = selectHistoricalAutohydrationCandidates(current, [
      current,
      makeFiling("10-Q", "0002-04", "2025-09-27"),
      makeFiling("10-Q", "0002-03", "2024-12-28"),
      makeFiling("10-Q", "0002-02", "2024-09-28"),
      makeFiling("10-Q", "0002-01", "2023-12-30")
    ]);

    expect(candidates.map((candidate) => candidate.accessionNumber)).toEqual(["0002-03", "0002-01"]);
  });
});
