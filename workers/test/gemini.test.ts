import { describe, expect, it } from "vitest";
import { generateChatAnswer } from "../src/clients/gemini";

describe("Gemini local chat fallback", () => {
  it("matches Japanese questions against source text without whitespace tokenization", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "利益率悪化の主因は？",
      filing: {
        filingKey: "v1:0000000000:000000000000000000",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "利益率悪化の主因は部材コストの上昇と販促費の増加でした。",
            startOffset: 0,
            endOffset: 31,
            sortOrder: 1
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S1"]);
    expect(response.answer).toContain("利益率悪化");
  });
});
