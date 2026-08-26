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

// 2026-08-26: 本文を用意する経路の振り分けも 10-K / 10-Q の直書きで、
// 20-F は 400 で弾かれていた。`sec-fetcher/src/prepared-filing.mjs` は
// Item 5 を読む実装を既に持っているのに、手前で届いていなかった。
describe("prepared-filing の振り分け", () => {
  it("対応書類は全部 prepared-filing まで届く", () => {
    for (const form of SUPPORTED_FILING_FORMS) {
      expect(isSupportedFilingForm(form)).toBe(true);
    }
    // 20-F を明示。ここが false に戻ると TSM の本文が空に戻る。
    expect(isSupportedFilingForm("20-F")).toBe(true);
  });
});
