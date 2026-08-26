import { describe, expect, it } from "vitest";
import {
  findPeriodColumn,
  readQuarterlyResultsTable,
  readUnitNote
} from "../src/lib/filings/quarterly-results";

/// 表も注記も 2026-08-24 に EDGAR から取った実物。
/// TSMC は当期が**左端**、ASML は当期が**右端**。この 2 つを並べて初めて
/// 「位置で列を選んではいけない」ことが見える。

const TSM_NOTE = "TSMC's 2026 second quarter consolidated results: (Unit: NT$ million, except for EPS)";
const TSM_ROWS = [
  ["", "2Q26 Amount a", "2Q25 Amount", "YoY Inc. (Dec.) %", "1Q26 Amount", "QoQ Inc. (Dec.) %"],
  ["Net sales", "1,270,381", "933,792", "36.0", "1,134,103", "12.0"],
  ["Gross profit", "860,311", "547,369", "57.2", "751,295", "14.5"],
  ["Income from operations", "766,603", "463,423", "65.4", "658,966", "16.3"],
  ["Income before tax", "862,430", "493,036", "74.9", "687,800", "25.4"],
  ["Net income", "706,562", "398,273", "77.4", "572,480", "23.4"],
  ["EPS (NT$)", "27.25 b", "15.36 c", "77.4", "22.08 d", "23.4"]
];

const ASML_NOTE = "(Figures in millions of euros unless otherwise indicated)";
const ASML_ROWS = [
  ["(Figures in millions of euros unless otherwise indicated)", "Q1 2026", "Q2 2026"],
  ["Total net sales", "8,767", "9,326"],
  ["Gross profit", "4,645", "5,035"],
  ["Gross margin (%)", "53.0", "54.0"],
  ["Net income", "2,757", "2,918"],
  ["EPS (basic; in euros)", "7.15", "7.59"]
];

describe("quarterly results table", () => {
  it("reads the currency and the scale from the filing's own unit note", () => {
    expect(readUnitNote(TSM_NOTE)).toMatchObject({ currency: "TWD", scale: 1_000_000 });
    expect(readUnitNote(ASML_NOTE)).toMatchObject({ currency: "EUR", scale: 1_000_000 });
  });

  /// 単位を書いていない表は読まない。倍率を推測すると桁が 1000 倍ずれる。
  it("refuses a table whose unit is not stated", () => {
    expect(readUnitNote("Second quarter results were strong.")).toBeNull();
    expect(readQuarterlyResultsTable(TSM_ROWS, { quarter: 2, year: 2026 }, "no unit here")).toBeNull();
  });

  it("takes the current quarter when it is the leftmost column (TSMC)", () => {
    const table = readQuarterlyResultsTable(TSM_ROWS, { quarter: 2, year: 2026 }, TSM_NOTE);
    const by = (name: string) => table?.figures.find((figure) => figure.logicalName === name);

    expect(table?.currency).toBe("TWD");
    expect(by("revenue")).toMatchObject({ label: "Net sales", value: 1_270_381, scaledValue: 1_270_381_000_000 });
    expect(by("operatingIncome")?.value).toBe(766_603);
    expect(by("netIncome")?.value).toBe(706_562);
  });

  /// ASML は当期が右端。位置で選ぶと 8,767(前四半期)を今期として出す。
  it("takes the current quarter when it is the rightmost column (ASML)", () => {
    const table = readQuarterlyResultsTable(ASML_ROWS, { quarter: 2, year: 2026 }, ASML_NOTE);
    expect(table?.figures.find((figure) => figure.logicalName === "revenue")).toMatchObject({
      label: "Total net sales",
      value: 9_326
    });
  });

  it("returns the earlier quarter when that is the one asked for", () => {
    const table = readQuarterlyResultsTable(ASML_ROWS, { quarter: 1, year: 2026 }, ASML_NOTE);
    expect(table?.figures.find((figure) => figure.logicalName === "revenue")?.value).toBe(8_767);
  });

  /// 見出しに無い期は返さない。近い列を代わりに使うと、別の期の数字を今期として出す。
  it("returns nothing when the requested quarter is not in the header", () => {
    expect(readQuarterlyResultsTable(ASML_ROWS, { quarter: 3, year: 2026 }, ASML_NOTE)).toBeNull();
    expect(findPeriodColumn(["Q1 2026", "Q2 2026"], { quarter: 4, year: 2026 })).toBeNull();
  });

  it("understands both the 2Q26 and the Q2 2026 spellings", () => {
    expect(findPeriodColumn(["", "2Q26 Amount a"], { quarter: 2, year: 2026 })).toBe(1);
    expect(findPeriodColumn(["", "Q2 2026"], { quarter: 2, year: 2026 })).toBe(1);
  });

  /// 数字は行ごと引ける形で持つ。数字だけを持ち出すと出典が付けられない。
  it("keeps the whole row as the excerpt behind each figure", () => {
    const table = readQuarterlyResultsTable(TSM_ROWS, { quarter: 2, year: 2026 }, TSM_NOTE);
    expect(table?.figures.find((figure) => figure.logicalName === "revenue")?.sourceText)
      .toBe("Net sales 1,270,381 933,792 36.0 1,134,103 12.0");
  });

  /// 脚注記号つきの数値("27.25 b")と、対応表に無い行("Income before tax")。
  it("reads a footnoted number and keeps unmapped rows without inventing a mapping", () => {
    const table = readQuarterlyResultsTable(TSM_ROWS, { quarter: 2, year: 2026 }, TSM_NOTE);
    const eps = table?.figures.find((figure) => figure.label.startsWith("EPS"));
    expect(eps).toMatchObject({ value: 27.25, logicalName: null });
    expect(table?.figures.find((figure) => figure.label === "Income before tax")?.logicalName).toBeNull();
  });
});
