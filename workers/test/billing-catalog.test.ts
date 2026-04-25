import { describe, expect, it } from "vitest";
import { resolveMonthlyCreditLimit, resolvePlanFromBilling, resolvePlanLimits } from "../src/lib/billing-catalog";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

describe("billing catalog", () => {
  it("maps active subscription products to credit plans", () => {
    expect(resolvePlanFromBilling("app.kabuyomi.lite.monthly", true)).toBe("lite");
    expect(resolvePlanFromBilling("app.kabuyomi.pro.monthly", true)).toBe("pro");
    expect(resolvePlanFromBilling("app.kabuyomi.pro.monthly", false)).toBe("free");
  });

  it("resolves monthly credit limits for Free, Lite, and Pro", () => {
    expect(resolveMonthlyCreditLimit("free", DEFAULT_REMOTE_CONFIG)).toBe(30);
    expect(resolveMonthlyCreditLimit("lite", DEFAULT_REMOTE_CONFIG)).toBe(150);
    expect(resolveMonthlyCreditLimit("pro", DEFAULT_REMOTE_CONFIG)).toBe(500);
  });

  it("keeps Lite on free legacy quota limits until credit billing is enabled", () => {
    expect(resolvePlanLimits("lite", DEFAULT_REMOTE_CONFIG)).toEqual({
      chatLimit: DEFAULT_REMOTE_CONFIG.freeDailyChatLimit,
      stockLimit: DEFAULT_REMOTE_CONFIG.freeStockLimit
    });
  });
});
