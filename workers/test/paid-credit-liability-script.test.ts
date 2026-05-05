import { describe, expect, it } from "vitest";

// @ts-ignore Node ESM script is exercised by Vitest but is not part of the TS Worker build.
const { buildPaidCreditLiabilityQuery, reportLimitations } = await import("../scripts/paid-credit-liability.mjs");

describe("paid credit liability report script", () => {
  it("reports the v1 paid-credit liability fields from ledger snapshots", () => {
    const query = buildPaidCreditLiabilityQuery();

    expect(query).toContain("as_of");
    expect(query).toContain("user_count_with_paid_balance");
    expect(query).toContain("total_paid_credits_remaining");
    expect(query).toContain("total_paid_credit_liability_jpy");
    expect(query).toContain("total_free_or_promotional_credits_remaining");
    expect(query).toContain("total_ad_credits_remaining");
    expect(query).toContain("purchase_transactions");
    expect(query).toContain("credit_ledger");
    expect(query).toContain("kabuyomi.credits.100");
    expect(query).toContain("* 2.0");
  });

  it("documents the per-lot precision limitation", () => {
    expect(reportLimitations()).toContain("per-lot remaining balance");
    expect(reportLimitations()).toContain("¥2 per remaining paid credit");
  });
});
