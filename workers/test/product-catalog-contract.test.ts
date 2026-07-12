import { readFileSync } from "node:fs";
import { resolveCreditPackCredits, resolveMonthlyCreditLimit, resolvePlanFromBilling, resolvePlanLimits } from "../src/lib/billing-catalog";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { describe, expect, it } from "vitest";

const catalog = JSON.parse(readFileSync(new URL("../../shared/product-catalog.json", import.meta.url), "utf8")) as {
  normalChatCreditCost: number;
  welcome: { credits: number; recurring: boolean };
  plans: Array<{
    plan: "free" | "lite" | "pro" | "pro_max";
    productId: string | null;
    monthlyCredits: number;
    savedCompanyLimit: number;
    dailyFairUseQuestionLimit: number;
  }>;
  consumables: Array<{ productId: string; credits: number; newPurchaseVisibleByDefault: boolean }>;
};
const swiftCatalog = readFileSync(new URL("../../ios/Kabuyomi/Services/BetaBilling.swift", import.meta.url), "utf8");

describe("authoritative product catalog contract", () => {
  it("matches Worker product IDs and monthly grants", () => {
    for (const plan of catalog.plans) {
      expect(resolveMonthlyCreditLimit(plan.plan, DEFAULT_REMOTE_CONFIG)).toBe(plan.monthlyCredits);
      expect(resolvePlanLimits(plan.plan, DEFAULT_REMOTE_CONFIG)).toEqual({
        chatLimit: plan.dailyFairUseQuestionLimit,
        stockLimit: plan.savedCompanyLimit
      });
      if (plan.productId) expect(resolvePlanFromBilling(plan.productId, true)).toBe(plan.plan);
    }
    expect(catalog.welcome).toEqual({ credits: 50, recurring: false, requiresVerifiedInstallation: true });
  });

  it("matches supported consumables and preserves the released purchase surface", () => {
    for (const product of catalog.consumables) {
      expect(resolveCreditPackCredits(product.productId)).toBe(product.credits);
      expect(product.newPurchaseVisibleByDefault).toBe(true);
    }
  });

  it("keeps Swift IDs and quantities aligned without hard-coded prices", () => {
    for (const plan of catalog.plans.filter((item) => item.productId)) {
      expect(swiftCatalog).toContain(`productID: "${plan.productId}"`);
      expect(swiftCatalog).toContain(`monthlyCredits: ${plan.monthlyCredits}`);
    }
    expect(swiftCatalog).not.toMatch(/(?:[¥￥]\s*\d|\$(?!0\b)\s*\d)/u);
    expect(catalog.normalChatCreditCost).toBe(2);
  });
});
