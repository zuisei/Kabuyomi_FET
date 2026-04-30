import { describe, expect, it } from "vitest";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { finalizeChatResponse } from "../src/lib/chat/response-finalizer";
import { attachChatDebug } from "../src/lib/chat/response-payload";
import { createChatTimingTracker } from "../src/lib/chat/timing";

describe("chat response payload helpers", () => {
  it("attaches debug source fields from the final response sources", () => {
    const response = attachChatDebug(
      {
        answer: "answer",
        sources: [
          {
            sourceId: "S1",
            sourceKind: "sec_filing",
            sourceStrength: "filing_primary",
            sectionType: "md_a",
            sourceLabel: "10-K Item 7",
            excerpt: "excerpt"
          }
        ],
        responsePath: "gemini"
      },
      {
        responsePath: "gemini",
        fallbackReason: null,
        sourceIdsValid: true
      }
    );

    expect(response.debug).toMatchObject({
      responsePath: "gemini",
      fallbackReason: null,
      sourceIdsValid: true,
      sourceCount: 1,
      sourceIds: ["S1"]
    });
  });

  it("finalizes chat responses with source urls, response path, and timing debug", async () => {
    const response = await finalizeChatResponse({
      filing: {
        filingKey: "v1:0000000000:000000000000000001",
        ticker: "TST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-K",
        filedAt: "2026-01-01",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://example.com/filing",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        sourceChunks: [],
        summary: { verdict: "", highlights: [], changes: [] },
        generatedAt: "2026-01-01T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1"
      },
      question: "何の会社？",
      response: {
        answer: "answer",
        sources: [
          {
            sourceId: "S1",
            sourceKind: "sec_filing",
            sourceStrength: "filing_primary",
            sectionType: "md_a",
            sourceLabel: "10-K Item 7",
            excerpt: "excerpt"
          }
        ]
      },
      responsePath: "gemini",
      debug: {
        responsePath: "gemini",
        fallbackReason: null,
        sourceIdsValid: true
      },
      env: {} as never,
      config: DEFAULT_REMOTE_CONFIG,
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("gemini");
    expect(response.sources[0]?.sourceUrl).toBe("https://example.com/filing");
    expect(response.debug).toMatchObject({
      responsePath: "gemini",
      sourceIds: ["S1"],
      sourceCount: 1,
      sourceIdsValid: true
    });
    expect(response.debug?.totalPipelineMs).toEqual(expect.any(Number));
    expect(response.debug?.groundingMs).toEqual(expect.any(Number));
  });
});
