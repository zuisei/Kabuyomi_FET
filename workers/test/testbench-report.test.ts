import { describe, expect, it } from "vitest";
// @ts-ignore Node builtins are used only by this script-level regression test.
import { execFileSync } from "node:child_process";
// @ts-ignore Node builtins are used only by this script-level regression test.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
// @ts-ignore Node builtins are used only by this script-level regression test.
import { tmpdir } from "node:os";
// @ts-ignore Node builtins are used only by this script-level regression test.
import { join } from "node:path";

declare const process: {
  cwd(): string;
  execPath: string;
};

describe("testbench answer report metadata", () => {
  it("does not invent question or company-set paths for old JSONL runs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "kabuyomi-report-old-"));
    try {
      const runPath = join(tempDir, "old-run.jsonl");
      writeJsonl(runPath, [
        makeRow({ runId: "old-run", ticker: "AAPL", caseId: "AAPL-Q01", templateId: "Q01" }),
        makeRow({ runId: "old-run", ticker: "JPM", caseId: "JPM-Q03", templateId: "Q03" })
      ]);

      execFileSync(process.execPath, ["./testbench/scripts/write-run-report.mjs", runPath], { cwd: process.cwd() });
      const report = readFileSync(join(tempDir, "old-run-answers.md"), "utf8");

      expect(report).toContain("- Questions: not recorded (2 templates observed)");
      expect(report).toContain("- Company set: not recorded (2 tickers observed)");
      expect(report).not.toContain("prompt-v2-smoke-10.jsonl");
      expect(report).not.toContain("minimal-5.json");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prints recorded question and ticker input metadata for new JSONL runs", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "kabuyomi-report-new-"));
    try {
      const runPath = join(tempDir, "new-run.jsonl");
      writeJsonl(runPath, [
        makeRow({
          runId: "new-run",
          questionsPath: "testbench/questions/core-12.jsonl",
          companySetPath: "inline:KABUYOMI_TESTBENCH_TICKERS",
          questionTemplateCount: 12,
          companyTickerCount: 2
        })
      ]);

      execFileSync(process.execPath, ["./testbench/scripts/write-run-report.mjs", runPath], { cwd: process.cwd() });
      const report = readFileSync(join(tempDir, "new-run-answers.md"), "utf8");

      expect(report).toContain("- Questions: `testbench/questions/core-12.jsonl`");
      expect(report).toContain("- Company set: `inline:KABUYOMI_TESTBENCH_TICKERS`");
      expect(report).toContain("- Question templates observed: 12");
      expect(report).toContain("- Company tickers observed: 2");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prints run metadata in summary and quality-gate output", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "kabuyomi-gate-meta-"));
    try {
      const runPath = join(tempDir, "gate-run.jsonl");
      writeJsonl(runPath, [
        makeRow({
          runId: "gate-run",
          questionsPath: "testbench/questions/prompt-v2-driver-followup-3.jsonl",
          companySetPath: "testbench/company-sets/prompt-v2-expanded-multisector.json",
          questionTemplateCount: 3,
          companyTickerCount: 15
        })
      ]);

      const summary = execFileSync(process.execPath, ["./testbench/scripts/summarize-runs.mjs", runPath], {
        cwd: process.cwd(),
        encoding: "utf8"
      });
      const gate = execFileSync(process.execPath, ["./testbench/scripts/quality-gate.mjs", runPath], {
        cwd: process.cwd(),
        encoding: "utf8"
      });

      for (const output of [summary, gate]) {
        expect(output).toContain("questions: `testbench/questions/prompt-v2-driver-followup-3.jsonl`");
        expect(output).toContain("companySet: `testbench/company-sets/prompt-v2-expanded-multisector.json`");
        expect(output).toContain("questionTemplates: 3");
        expect(output).toContain("companyTickers: 15");
      }
      expect(gate).toContain("templates: Q01");
      expect(gate).toContain("observedCompanyTickers: 1");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function writeJsonl(path: string, rows: Array<Record<string, unknown>>) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    runId: "report-run",
    runStartedAt: "2026-07-02T00:00:00.000Z",
    baseURL: "https://example.test",
    ticker: "AAPL",
    caseId: "AAPL-Q01",
    templateId: "Q01",
    question: "この会社は何で儲けている？",
    intent: "business_model",
    responsePath: "openai",
    fallbackKind: "none",
    sourceIdsValid: true,
    latencyMs: 100,
    sourceCount: 1,
    answer: "AppleはiPhoneとサービスで売上を得ています。",
    sources: [{ sourceId: "S1", sourceLabel: "10-K Business", sectionType: "business" }],
    ...overrides
  };
}
