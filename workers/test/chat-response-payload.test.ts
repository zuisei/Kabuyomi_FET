import { describe, expect, it } from "vitest";
import { attachChatDebug } from "../src/lib/chat/response-payload";

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
});
