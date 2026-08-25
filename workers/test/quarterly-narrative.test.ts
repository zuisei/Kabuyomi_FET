import { describe, expect, it, vi } from "vitest";
import { buildQuarterlyNarrativeChunks } from "../src/lib/filings/ingest";
import {
  findLatestQuarterlyNarrative,
  quarterlyNarrativeSectionTitle,
  selectQuarterlyResultsDocuments,
  type QuarterlyNarrativeFetchers
} from "../src/lib/filings/quarterly-narrative";

/// 添付の並びは TSM の 2026-07-16 提出(accn 0001046179-26-000451)の実物。
const TSM_DOCUMENTS = [
  "0001046179-26-000451-index-headers.html",
  "0001046179-26-000451-index.html",
  "0001046179-26-000451.txt",
  "a2q26e_withguidancexfinal.htm",
  "a2q26presentatione.htm",
  "a2q26presentatione001.jpg",
  "tsm-20260716x6k.htm"
];

const RESULTS_RELEASE = `
  TSMC Reports Second Quarter EPS of NT$27.25
  HSINCHU, Taiwan, R.O.C., Jul. 16, 2026 -- TSMC today announced consolidated revenue of
  NT$1,270.38 billion, net income of NT$706.56 billion for the second quarter ended June 30, 2026.
`;

const BOARD_RESOLUTION = `
  The TSMC Board of Directors today held a meeting, which passed the following resolutions:
  1. Approved the 2026 second quarter Business Report and Financial Statements. Second quarter
  consolidated revenue was NT$1,270.38 billion and net income was NT$706.56 billion.
`;

function fetchers(
  documents: Record<string, string[]>,
  texts: Record<string, string>
): QuarterlyNarrativeFetchers {
  return {
    listDocuments: vi.fn(async (accession: string) => documents[accession] ?? []),
    readDocumentText: vi.fn(async (accession: string, name: string) => texts[`${accession}/${name}`] ?? ""),
    buildDocumentUrl: (accession: string, name: string) => `https://sec.test/${accession}/${name}`
  };
}

describe("quarterly narrative from 6-K", () => {
  /// 本体は表紙で中身は添付。説明会資料は画像が主なので外す。
  it("keeps only the attachments that could carry the release", () => {
    expect(selectQuarterlyResultsDocuments(TSM_DOCUMENTS, "tsm-20260716x6k.htm"))
      .toEqual(["a2q26e_withguidancexfinal.htm"]);
  });

  it("finds the results release and points the citation at the 6-K", async () => {
    const found = await findLatestQuarterlyNarrative(
      [{ accessionNumber: "A2", filedAt: "2026-07-16", primaryDocument: "tsm-6k.htm" }],
      fetchers(
        { A2: ["tsm-6k.htm", "release.htm"] },
        { "A2/release.htm": RESULTS_RELEASE }
      )
    );

    expect(found).toMatchObject({
      accessionNumber: "A2",
      kind: "results_release",
      documentUrl: "https://sec.test/A2/release.htm"
    });
    expect(found?.period).toMatchObject({ quarter: 2, calendarYear: 2026 });
  });

  /// 月次売上速報や取締役会決議も同じ 6-K で出る。新しい方から見ていって、
  /// 業績のものに当たるまで進む。
  it("skips the 6-K filings that are not results", async () => {
    const found = await findLatestQuarterlyNarrative(
      [
        { accessionNumber: "NEW", filedAt: "2026-08-10", primaryDocument: "cover.htm" },
        { accessionNumber: "OLD", filedAt: "2026-07-16", primaryDocument: "cover.htm" }
      ],
      fetchers(
        { NEW: ["cover.htm", "monthly.htm"], OLD: ["cover.htm", "release.htm"] },
        {
          "NEW/monthly.htm": "TSMC today announced its net revenue for the month of July 2026.",
          "OLD/release.htm": RESULTS_RELEASE
        }
      )
    );

    expect(found?.accessionNumber).toBe("OLD");
  });

  /// 同じ四半期を業績プレスと決議の両方が報じる。**プレスを優先する**。
  it("prefers the press release over a board resolution covering the same quarter", async () => {
    const found = await findLatestQuarterlyNarrative(
      [
        { accessionNumber: "BOARD", filedAt: "2026-08-11", primaryDocument: "cover.htm" },
        { accessionNumber: "PRESS", filedAt: "2026-07-16", primaryDocument: "cover.htm" }
      ],
      fetchers(
        { BOARD: ["cover.htm", "board.htm"], PRESS: ["cover.htm", "release.htm"] },
        { "BOARD/board.htm": BOARD_RESOLUTION, "PRESS/release.htm": RESULTS_RELEASE }
      )
    );

    expect(found).toMatchObject({ accessionNumber: "PRESS", kind: "results_release" });
  });

  /// 決議しか出さない四半期もある。何も返さないよりは、決議と明示して使う。
  it("falls back to a board resolution when no release is found", async () => {
    const found = await findLatestQuarterlyNarrative(
      [{ accessionNumber: "BOARD", filedAt: "2026-08-11", primaryDocument: "cover.htm" }],
      fetchers({ BOARD: ["cover.htm", "board.htm"] }, { "BOARD/board.htm": BOARD_RESOLUTION })
    );

    expect(found).toMatchObject({ kind: "board_resolution" });
    expect(quarterlyNarrativeSectionTitle(found!)).toContain("取締役会決議");
  });

  it("returns nothing when no 6-K carries results", async () => {
    const found = await findLatestQuarterlyNarrative(
      [{ accessionNumber: "A", filedAt: "2026-08-11", primaryDocument: "cover.htm" }],
      fetchers({ A: ["cover.htm", "agm.htm"] }, { "A/agm.htm": "Notice of annual general meeting." })
    );
    expect(found).toBeNull();
  });

  /// 添付一覧が引けない提出物で止まらない。1 本の失敗で四半期全体を失うのは重すぎる。
  it("moves on when a filing's document list cannot be read", async () => {
    const base = fetchers(
      { GOOD: ["cover.htm", "release.htm"] },
      { "GOOD/release.htm": RESULTS_RELEASE }
    );
    const found = await findLatestQuarterlyNarrative(
      [
        { accessionNumber: "BROKEN", filedAt: "2026-08-11", primaryDocument: "cover.htm" },
        { accessionNumber: "GOOD", filedAt: "2026-07-16", primaryDocument: "cover.htm" }
      ],
      {
        ...base,
        listDocuments: async (accession: string) => {
          if (accession === "BROKEN") throw new Error("404");
          return ["cover.htm", "release.htm"];
        }
      }
    );

    expect(found?.accessionNumber).toBe("GOOD");
  });

  it("names the section so it cannot be mistaken for the annual report", async () => {
    const found = await findLatestQuarterlyNarrative(
      [{ accessionNumber: "A", filedAt: "2026-07-16", primaryDocument: "cover.htm" }],
      fetchers({ A: ["cover.htm", "release.htm"] }, { "A/release.htm": RESULTS_RELEASE })
    );
    expect(quarterlyNarrativeSectionTitle(found!)).toBe("2026年 第2四半期 業績");
  });

  /// 引用は **6-K を指さなければならない**。年次報告書の URL を出すと、
  /// 読んだ人が原文に行っても四半期の記述が見つからない。
  it("cites the 6-K, not the annual report", () => {
    const chunks = buildQuarterlyNarrativeChunks(
      {
        accessionNumber: "0001046179-26-000451",
        filedAt: "2026-07-16",
        documentUrl: "https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/release.htm",
        documentName: "release.htm",
        period: { quarter: 2, calendarYear: 2026, periodEnd: "2026-06-30" },
        kind: "results_release",
        text: `${"TSMC の第2四半期の売上は前年同期比で増加した。".repeat(20)}\n\n${"先端プロセスの需要が牽引した。".repeat(20)}`
      },
      5
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({
      sectionTitle: "2026年 第2四半期 業績",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1046179/000104617926000451/release.htm",
      filingAccessionNumber: "0001046179-26-000451"
    });
    expect(chunks[0]?.sourceLabel).toContain("6-K");
    // 会話側の引用選択はすべて md_a で書かれている。別の型にすると拾われない。
    expect(chunks[0]?.sectionType).toBe("md_a");
    // 既存の source と ID がぶつからないこと。
    expect(chunks[0]?.sortOrder).toBe(6);
  });
});
