import { describe, expect, it } from "vitest";
import { SUPPORTED_FILING_FORMS, isSupportedFilingForm } from "../src/env";

// 2026-08-26 実機: 検索は TSM を「最新 20-F」と出すのに、追加すると
// 「対応範囲外です。10-K / 10-Q / 20-F に対応しています」と言われた。
// `normalizeForm` は 20-F を通すよう直したのに、保存経路の関所だけ
// `!== "10-K" && !== "10-Q"` のまま残っていた。判定を1か所に寄せて固定する。
describe("対応書類の判定", () => {
  it("20-F を対応済みとして扱う", () => {
    expect(isSupportedFilingForm("20-F")).toBe(true);
    expect(SUPPORTED_FILING_FORMS).toContain("20-F");
  });

  it("10-K と 10-Q は従来どおり通る", () => {
    expect(isSupportedFilingForm("10-K")).toBe(true);
    expect(isSupportedFilingForm("10-Q")).toBe(true);
  });

  it("対象外の書類と未確認は通さない", () => {
    expect(isSupportedFilingForm("8-K")).toBe(false);
    expect(isSupportedFilingForm("6-K")).toBe(false);
    expect(isSupportedFilingForm(null)).toBe(false);
    expect(isSupportedFilingForm(undefined)).toBe(false);
  });
});
