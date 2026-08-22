import { describe, expect, it } from "vitest";
import { questionHasSubstance } from "../src/lib/chat/question-substance";

// 2026-08-22 実機レビュー: 「h」「G」にも回答が生成されクレジットが消費された。
describe("questionHasSubstance", () => {
  it("stops single characters and symbol-only input", () => {
    for (const q of ["h", "G", "?", "？？", " . ", "ｱ", ""]) {
      expect(questionHasSubstance(q), q).toBe(false);
    }
  });

  it("lets short but real questions through", () => {
    for (const q of ["売上", "AWS", "ok", "利益率は？", "なにで稼いでんの？", "10-K"]) {
      expect(questionHasSubstance(q), q).toBe(true);
    }
  });
});
