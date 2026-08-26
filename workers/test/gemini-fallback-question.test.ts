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

  /**
   * This profile drove the vacuous fallback answers in the human-phrasing canary
   * run: it recognized 何の会社 but neither 何で儲けている nor なにで稼いでんの,
   * so both the clean and the colloquial business-model question were profiled as
   * plain revenue questions.
   */
  it("classifies plain and colloquial business-model questions as business overview", () => {
    for (const question of [
      "この会社は何で儲けている？",
      "この会社ってなにで稼いでんの？",
      "つまり何屋なの？",
      "どうやって稼いでるの？",
      "ビジネスモデルは？",
      "収益源はどこ？"
    ]) {
      const profile = analyzeQuestion(question);
      expect(profile.asksBusinessOverview, question).toBe(true);
      expect(wantsNarrativeDepth(profile), question).toBe(true);
    }
  });

  it("keeps cash-generation phrasing out of the business overview flag", () => {
    for (const question of ["ちゃんとキャッシュ稼げてる？", "お金はちゃんと稼げてる？", "現金はどうやって稼いでる？"]) {
      const profile = analyzeQuestion(question);
      expect(profile.asksBusinessOverview, question).toBe(false);
      expect(profile.asksCashFlow, question).toBe(true);
    }
  });

  it("classifies investor-view prompts as narrative questions", () => {
    const profile = analyzeQuestion("投資家目線で良い点と悪い点は？");

    expect(profile.asksInvestmentView).toBe(true);
    expect(wantsNarrativeDepth(profile)).toBe(true);
  });
});
