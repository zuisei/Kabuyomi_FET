import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no type declarations
import { FORBIDDEN_DECLARATIONS, scanForConstantSurfaces } from "../scripts/report-constant-answer-coverage.mjs";

/**
 * Guards the removal of the constant-answer paths without needing anyone to
 * remember to run the script.
 *
 * Each declaration below served company-specific text that the filing was never
 * consulted for — a stored business description, a stored revenue breakdown, a
 * stored durability paragraph — and attached that filing's own source chunks to
 * it as citations. That combination is what the product's
 * 「すべての記述に、出典があります」 claim rules out, so the fix was deletion rather
 * than gating: an answer now comes from extraction, from the source-validated
 * model path, or admits insufficiency.
 */

const declarationNames: string[] = (FORBIDDEN_DECLARATIONS as Array<{ name: string }>).map(
  (declaration) => declaration.name
);

let scratch: string | undefined;

afterEach(() => {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});

describe("constant-answer surfaces stay deleted", () => {
  it("finds none of them anywhere under workers/src", () => {
    const scan = scanForConstantSurfaces() as {
      files: number;
      violations: Array<{ name: string; file: string; line: number }>;
    };

    expect(scan.violations).toEqual([]);
    // A tripwire that scanned nothing would also report no violations.
    expect(scan.files).toBeGreaterThan(50);
  });

  it("checks every declaration that was removed", () => {
    expect(declarationNames).toEqual([
      "TICKER_BUSINESS_OVERVIEWS",
      "TICKER_REVENUE_BREAKDOWNS",
      "seedKnownTickerLabels",
      "seedKnownTickerRevenueFacts",
      "summarizeKnownCompanyBusiness",
      "buildJpmDurabilitySynthesis",
      "buildWmtDurabilitySynthesis",
      "buildGoogleDurabilitySynthesis"
    ]);
  });

  it("reports a reintroduced declaration instead of passing quietly", () => {
    scratch = mkdtempSync(join(tmpdir(), "constant-answer-tripwire-"));
    mkdirSync(join(scratch, "lib", "chat"), { recursive: true });
    writeFileSync(
      join(scratch, "lib", "chat", "deterministic.ts"),
      'const TICKER_BUSINESS_OVERVIEWS: Record<string, string> = { AAPL: "iPhone" };\n'
    );
    writeFileSync(join(scratch, "unrelated.ts"), "export const answer = 1;\n");

    const scan = scanForConstantSurfaces(scratch) as {
      files: number;
      violations: Array<{ name: string; file: string; line: number }>;
    };

    expect(scan.files).toBe(2);
    expect(scan.violations).toHaveLength(1);
    expect(scan.violations[0]?.name).toBe("TICKER_BUSINESS_OVERVIEWS");
    expect(scan.violations[0]?.line).toBe(1);
  });

  it("refuses to report success when it is pointed at an empty tree", () => {
    scratch = mkdtempSync(join(tmpdir(), "constant-answer-tripwire-empty-"));

    expect(() => scanForConstantSurfaces(scratch)).toThrow(/no TypeScript files found/);
  });
});
