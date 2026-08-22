import { describe, expect, it } from "vitest";
import { validateNumericAlignment } from "../src/lib/chat/numeric-alignment";

// 2026-08-22 実機レビュー: 「AWS growth?」にモデルが MD&A 本文の数字で答えたが、
// 数値整合ゲートが XBRL 事実だけを照合して全文を捨て、汎用文に差し替えていた。
describe("numeric alignment accepts claims present in cited excerpts", () => {
  const excerpt =
    "AWS sales increased 17% in Q1 2026 compared to the comparable prior year period. AWS segment sales were $29.3 billion.";

  it("passes a percentage that appears in a cited excerpt", () => {
    const result = validateNumericAlignment({
      answer: "AWSの売上は前年同期比で17%増でした。",
      facts: [],
      citedSourceIds: ["s1"],
      citedSourceTexts: [excerpt]
    });
    expect(result.status).not.toBe("blocked");
    expect(result.labels).toContain("excerpt_supported_numeric_claim");
  });

  it("passes a currency amount that appears in a cited excerpt, across unit notation", () => {
    const result = validateNumericAlignment({
      answer: "AWSのセグメント売上は293億ドルでした。",
      facts: [],
      citedSourceIds: ["s1"],
      citedSourceTexts: [excerpt]
    });
    expect(result.status).not.toBe("blocked");
  });

  it("still blocks a number that appears nowhere", () => {
    const result = validateNumericAlignment({
      answer: "AWSの売上は前年同期比で42%増でした。",
      facts: [],
      citedSourceIds: ["s1"],
      citedSourceTexts: [excerpt]
    });
    expect(result.status).toBe("blocked");
  });

  it("does not consult excerpts that were not cited", () => {
    const result = validateNumericAlignment({
      answer: "AWSの売上は前年同期比で17%増でした。",
      facts: [],
      citedSourceIds: ["s1"],
      citedSourceTexts: []
    });
    expect(result.status).toBe("blocked");
  });

  it("accepts a number found in a seen-but-uncited context chunk and requires that chunk as a source", () => {
    const result = validateNumericAlignment({
      answer: "AWSの売上は前年同期比で17%増でした。",
      facts: [],
      citedSourceIds: ["s1"],
      citedSourceTexts: ["AWS segment commentary without numbers."],
      contextSources: [{ sourceId: "s2", text: "AWS sales increased 17% in Q1 2026." }]
    });
    expect(result.status).not.toBe("blocked");
    expect(result.requiredSourceIds).toContain("s2");
  });
});
