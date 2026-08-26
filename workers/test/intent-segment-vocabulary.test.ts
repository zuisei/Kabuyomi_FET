import { describe, expect, it } from "vitest";
import { classifyQuestionIntent } from "../src/lib/chat/intent";

// 2026-08-22 実機レビュー: 「AWS growth?」が unknown に落ち、文脈パックに
// AWS のセグメント本文が入らず、モデルが「資料には分かりません」と答えていた。
describe("segment vocabulary in intent classification", () => {
  it("routes a question naming the filing's own segment to segment_analysis", () => {
    expect(classifyQuestionIntent("AWS growth?", { ticker: "AMZN" })).toBe("segment_analysis");
    expect(classifyQuestionIntent("AWSの伸びは？", { ticker: "AMZN" })).toBe("segment_analysis");
    expect(classifyQuestionIntent("iPhone sales?", { ticker: "AAPL" })).toBe("segment_analysis");
    expect(classifyQuestionIntent("Google Cloud どう？", { ticker: "GOOG" })).toBe("segment_analysis");
  });

  it("leaves classification unchanged without a ticker", () => {
    expect(classifyQuestionIntent("AWS growth?")).toBe("unknown");
  });

  it("does not let a segment name override a more specific intent", () => {
    expect(classifyQuestionIntent("AWSの利益率は？", { ticker: "AMZN" })).toBe("margin_profitability");
  });

  it("ignores vocabulary from other companies", () => {
    expect(classifyQuestionIntent("AWS growth?", { ticker: "AAPL" })).toBe("unknown");
  });
});
