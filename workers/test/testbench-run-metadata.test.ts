import { describe, expect, it } from "vitest";

// @ts-ignore testbench helper is an ESM script consumed by Node, not part of the TS Worker build.
const metadata = await import("../testbench/scripts/run-metadata.mjs");

describe("testbench run input metadata", () => {
  const workersDir = "/repo/workers";

  it("records the company-set file when tickers come from JSON", () => {
    const tickerInput = metadata.resolveTickerInput({
      companySetTickers: ["aapl", " jpm ", "CAT"],
      companySetPath: "/repo/workers/testbench/company-sets/prompt-v2-expanded-multisector.json",
      workersDir
    });
    const runMetadata = metadata.buildRunInputMetadata({
      questionsPath: "/repo/workers/testbench/questions/prompt-v2-driver-followup-3.jsonl",
      questions: [{ templateId: "Q03" }, { templateId: "Q04" }, { templateId: "Q06" }],
      tickerInput,
      workersDir
    });

    expect(tickerInput.tickers).toEqual(["AAPL", "JPM", "CAT"]);
    expect(runMetadata).toEqual({
      questionsPath: "testbench/questions/prompt-v2-driver-followup-3.jsonl",
      companySetPath: "testbench/company-sets/prompt-v2-expanded-multisector.json",
      questionTemplateCount: 3,
      companyTickerCount: 3
    });
  });

  it("records inline ticker input instead of a company-set path", () => {
    const tickerInput = metadata.resolveTickerInput({
      inlineTickers: [" aapl ", "jpm"],
      companySetPath: "/repo/workers/testbench/company-sets/minimal-5.json",
      workersDir
    });
    const runMetadata = metadata.buildRunInputMetadata({
      questionsPath: "/repo/workers/testbench/questions/core-12.jsonl",
      questions: Array.from({ length: 12 }, (_, index) => ({ templateId: `Q${String(index + 1).padStart(2, "0")}` })),
      tickerInput,
      workersDir
    });

    expect(tickerInput.tickers).toEqual(["AAPL", "JPM"]);
    expect(tickerInput.companySetPath).toBe("inline:KABUYOMI_TESTBENCH_TICKERS");
    expect(runMetadata.companySetPath).toBe("inline:KABUYOMI_TESTBENCH_TICKERS");
    expect(runMetadata.questionTemplateCount).toBe(12);
    expect(runMetadata.companyTickerCount).toBe(2);
  });

  it("rejects an empty company-set ticker list", () => {
    expect(() =>
      metadata.resolveTickerInput({
        companySetTickers: [],
        companySetPath: "/repo/workers/testbench/company-sets/empty.json",
        workersDir
      })
    ).toThrow("/repo/workers/testbench/company-sets/empty.json must contain a non-empty tickers array");
  });
});
