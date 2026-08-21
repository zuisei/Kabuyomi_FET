import { describe, expect, it } from "vitest";
import { buildJapaneseLanguageGuardRepair } from "../src/lib/chat/final-answer-language";

// 語境界の無いパターンが、無関係な業種のラベルを回答に混入させていた。
// 実測: KO(飲料)と LLY(製薬)の回答が「DRAM・NAND需要」を売上要因として提示し、
// しかも responsePath は "openai"、ラベルは *_source_backed_repair だった。
// 出典に基づかない記述が混ざる経路なので、語境界を固定する。
function repairFor(excerpt: string): string | null {
  return buildJapaneseLanguageGuardRepair({
    question: "その要因は一時的？それとも続きそう？",
    questionIntent: "driver_durability_followup",
    sourceGateSufficient: true,
    selectedSourceExcerpts: [excerpt]
  });
}

describe("driver label inference word boundaries", () => {
  it("does not read semiconductor memory demand out of the word 'dramatically'", () => {
    const answer = repairFor(
      "Net sales increased as unit case volume grew and conditions improved dramatically during the period."
    );
    expect(answer ?? "").not.toContain("DRAM");
    expect(answer ?? "").not.toContain("NAND");
  });

  it("still labels a genuine DRAM/NAND discussion", () => {
    const answer = repairFor(
      "Sales of DRAM products increased while NAND bit shipments grew during the period."
    );
    expect(answer ?? "").toContain("DRAM");
  });

  it("does not read average selling price out of 'grasp' or 'gasp'", () => {
    const answer = repairFor(
      "Management continues to grasp the demand environment as sales volume increased."
    );
    expect(answer ?? "").not.toContain("平均販売価格");
  });

  it("still labels a genuine average selling price discussion", () => {
    const answer = repairFor(
      "Average selling prices increased and sales volume grew during the period."
    );
    expect(answer ?? "").toContain("平均販売価格");
  });

  it("does not attribute AWS customer usage to an unrelated company", () => {
    const answer = repairFor(
      "Revenue grew as customer usage increased across our subscription products and demand continued."
    );
    expect(answer ?? "").not.toContain("AWS");
  });

  it("does not read product mix out of the word 'mixture'", () => {
    const answer = repairFor(
      "A mixture of factors affected results while sales volume increased and demand continued."
    );
    expect(answer ?? "").not.toContain("製品ミックス");
  });
});
