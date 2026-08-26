import { describe, expect, it } from "vitest";
import {
  buildSandboxGrantExposureQuery,
  buildUnknownEnvironmentTransactionQuery,
  reportLimitations
} from "../scripts/sandbox-credit-grant-exposure.mjs";

describe("sandbox credit grant exposure report", () => {
  it("separates pre-migration rows instead of folding them into production", () => {
    const query = buildSandboxGrantExposureQuery();
    expect(query).toContain("unknown_pre_0019");
    expect(query).not.toMatch(/COALESCE\(verification_environment,\s*'production'\)/u);
  });

  it("only lists rows that could still be reclaimed", () => {
    const query = buildUnknownEnvironmentTransactionQuery(10);
    expect(query).toContain("verification_environment IS NULL");
    expect(query).toContain("status IN ('granted', 'pending')");
    expect(query).toContain("LIMIT 10");
  });

  it("refuses a non-numeric limit rather than interpolating it", () => {
    expect(buildUnknownEnvironmentTransactionQuery("5; DROP TABLE purchase_transactions")).toContain("LIMIT 5;");
  });

  it("says plainly that NULL means unknown, not production", () => {
    expect(reportLimitations()).toContain("unknown — NOT production");
  });
});
