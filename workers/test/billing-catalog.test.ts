import { describe, expect, it } from "vitest";
import {
  resolveCreditPackCredits,
  resolveMonthlyCreditLimit,
  resolvePlanFromBilling,
  resolvePlanLimits
} from "../src/lib/billing-catalog";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

describe("billing catalog", () => {
  it("maps active subscription products to credit plans", () => {
    expect(resolvePlanFromBilling("kabuyomi.sub.lite.monthly", true)).toBe("lite");
    expect(resolvePlanFromBilling("kabuyomi.sub.pro.monthly", true)).toBe("pro");
    expect(resolvePlanFromBilling("kabuyomi.sub.max.monthly", true)).toBe("pro_max");
    expect(resolvePlanFromBilling("kabuyomi.sub.pro.monthly", false)).toBe("free");
  });

  it("resolves monthly credit limits for Free, Lite, Pro, and Pro Max", () => {
    expect(resolveMonthlyCreditLimit("free", DEFAULT_REMOTE_CONFIG)).toBe(50);
    expect(resolveMonthlyCreditLimit("lite", DEFAULT_REMOTE_CONFIG)).toBe(400);
    expect(resolveMonthlyCreditLimit("pro", DEFAULT_REMOTE_CONFIG)).toBe(900);
    expect(resolveMonthlyCreditLimit("pro_max", DEFAULT_REMOTE_CONFIG)).toBe(2000);
  });

  it("keeps Lite on free legacy quota limits until credit billing is enabled", () => {
    expect(resolvePlanLimits("lite", DEFAULT_REMOTE_CONFIG)).toEqual({
      chatLimit: DEFAULT_REMOTE_CONFIG.freeDailyChatLimit,
      stockLimit: DEFAULT_REMOTE_CONFIG.freeStockLimit
    });
  });

  it("resolves consumable credit pack products", () => {
    expect(resolveCreditPackCredits("kabuyomi.credits.100")).toBe(100);
    expect(resolveCreditPackCredits("kabuyomi.credits.50")).toBe(50);
    expect(resolveCreditPackCredits("kabuyomi.credits.300")).toBeNull();
    expect(resolveCreditPackCredits("kabuyomi.credits.700")).toBeNull();
    expect(resolveCreditPackCredits("unknown_pack")).toBeNull();
  });
});
