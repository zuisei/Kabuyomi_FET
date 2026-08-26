import { describe, expect, it } from "vitest";
import { detectQuarterlyResultsRelease } from "../src/lib/filings/six-k";

/// 断片はすべて 2026-08-24 に EDGAR から取った実物の言い回し。
/// 作文した文面で通しても、実際の 6-K で通る保証にならない。

const tsmResultsRelease = `
  TSMC Reports Second Quarter EPS of NT$27.25
  HSINCHU, Taiwan, R.O.C., Jul. 16, 2026 -- TSMC (TWSE: 2330, NYSE: TSM) today announced
  consolidated revenue of NT$1,270.38 billion, net income of NT$706.56 billion, and diluted
  earnings per share of NT$27.25 (US$4.31 per ADR unit) for the second quarter ended June 30, 2026.
`;

/// ASML は見出しが「Q2 2026」形で、本文の途中(自社株買いの段)にも "second quarter" が出る。
/// 締め日は見出しから遠いところにしか無い。
const asmlResultsRelease = `
  ASML reports EUR 9.3 billion total net sales and EUR 2.9 billion net income in Q2 2026
  ASML increases outlook, expects 2026 total net sales to be between EUR 43 billion and EUR 45 billion.
  ${"Our marketplace continues to be driven by demand for advanced logic and memory. ".repeat(20)}
  Update share buyback program and dividend In the second quarter, we purchased around
  EUR 1.1 billion worth of shares under the current 2026-2028 share buyback program.
  ${"Further detail on the segment performance is set out below. ".repeat(30)}
  the risk factors included in ASML's Annual Report on Form 20-F for the year ended December 31, 2025
`;

/// TSM は毎月 10 日前後に月次売上を出す。売上はあるが最終利益が無い。
const tsmMonthlyRevenueNotice = `
  TSMC Reports Consolidated Revenue for July 2026
  TSMC today announced its net revenue for the month of July 2026: On a consolidated basis,
  revenue for July 2026 was approximately NT$369,999 million, an increase of 25.8 percent from July 2025.
`;

/// 取締役会決議。**業績プレスリリースと同じ数字が載っている**ので「業績ではない」とは言えない。
const tsmBoardResolution = `
  HSINCHU, Taiwan, R.O.C., Aug. 11, 2026 - The TSMC (TWSE: 2330, NYSE: TSM) Board of Directors
  today held a meeting, which passed the following resolutions:
  1. Approved the 2026 second quarter Business Report and Financial Statements. Second quarter
  consolidated revenue was NT$1,270.38 billion and net income was NT$706.56 billion, with
  diluted earnings per share of NT$27.25.
  2. Approved the distribution of a NT$7.0 per share cash dividend for the second quarter.
`;

const sixKCoverPageOnly = `
  UNITED STATES SECURITIES AND EXCHANGE COMMISSION Washington, D.C. 20549 Form 6-K
  REPORT OF FOREIGN ISSUER PURSUANT TO RULE 13a-16 OR 15d-16 For the month of July 2026
  Shell plc England and Wales SIGNATURES
`;

describe("6-K quarterly results detection", () => {
  it("reads the quarter and the period end out of a results release", () => {
    const signal = detectQuarterlyResultsRelease(tsmResultsRelease);
    expect(signal).toMatchObject({
      kind: "results_release",
      period: { quarter: 2, calendarYear: 2026, periodEnd: "2026-06-30" }
    });
  });

  /// 期は見出しのものを採る。本文中の "second quarter"(自社株買いの段)を起点にすると、
  /// いちばん近い "ended" が末尾の 20-F 参照になり Q2 2026 が 2025-12-31 になる。
  it("takes the period from the headline, not from a later mention in the body", () => {
    const signal = detectQuarterlyResultsRelease(asmlResultsRelease);
    expect(signal?.period.quarter).toBe(2);
    expect(signal?.period.calendarYear).toBe(2026);
    // 締め日は見出しの近くに無い。捏造せず null にする。
    expect(signal?.period.periodEnd).toBeNull();
  });

  it("ignores the monthly revenue notice, which reports sales but no earnings", () => {
    expect(detectQuarterlyResultsRelease(tsmMonthlyRevenueNotice)).toBeNull();
  });

  /// 決議にも同じ売上・純利益・EPS が載る。切り捨てず、種類を分けて呼ぶ側に選ばせる。
  it("keeps the board resolution but marks what kind of document it is", () => {
    const signal = detectQuarterlyResultsRelease(tsmBoardResolution);
    expect(signal?.kind).toBe("board_resolution");
    expect(signal?.period.quarter).toBe(2);
  });

  it("ignores a 6-K that is only the cover page", () => {
    expect(detectQuarterlyResultsRelease(sixKCoverPageOnly)).toBeNull();
  });

  it("ignores empty input", () => {
    expect(detectQuarterlyResultsRelease("   ")).toBeNull();
  });
});
