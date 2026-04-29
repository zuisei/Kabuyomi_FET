import { describe, expect, it } from "vitest";
import { analyzeQuestion, wantsNarrativeDepth } from "../src/clients/gemini/fallback-question";

describe("Gemini fallback question profiling", () => {
  it("classifies short follow-up durability questions", () => {
    const profile = analyzeQuestion("その要因は一時的？");

    expect(profile.asksDurability).toBe(true);
    expect(profile.asksCause).toBe(true);
    expect(wantsNarrativeDepth(profile)).toBe(true);
  });

  it("classifies business overview and stock context questions", () => {
    expect(analyzeQuestion("何の会社？").asksBusinessOverview).toBe(true);
    const stockProfile = analyzeQuestion("最近の株はどう？");

    expect(stockProfile.asksStockContext).toBe(true);
    expect(wantsNarrativeDepth(stockProfile)).toBe(true);
  });
});
