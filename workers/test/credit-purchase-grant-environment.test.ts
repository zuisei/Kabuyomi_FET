import { describe, expect, it } from "vitest";
import { isCreditGrantEnvironmentAccepted } from "../src/routes/credit-purchase-grant";

/**
 * Production runs APPLE_APP_STORE_SERVER_ENVIRONMENT = "auto", so a transaction
 * missing from Apple's production endpoint falls back to sandbox and verifies.
 * TestFlight Release builds call the production API while StoreKit gives them
 * sandbox transactions, so an ordinary TestFlight purchase minted free
 * production credits — no tampering involved.
 */
describe("credit grant environment gate", () => {
  it("accepts production transactions on every deployment", () => {
    for (const configured of ["auto", "production", "sandbox", undefined, ""]) {
      expect(isCreditGrantEnvironmentAccepted("production", configured)).toBe(true);
    }
  });

  it("refuses sandbox transactions on a production deployment", () => {
    expect(isCreditGrantEnvironmentAccepted("sandbox", "auto")).toBe(false);
    expect(isCreditGrantEnvironmentAccepted("sandbox", "production")).toBe(false);
  });

  it("still accepts sandbox transactions on a deployment configured for sandbox", () => {
    // The test worker sets this explicitly; it is meant to take sandbox purchases.
    expect(isCreditGrantEnvironmentAccepted("sandbox", "sandbox")).toBe(true);
    expect(isCreditGrantEnvironmentAccepted("sandbox", " SANDBOX ")).toBe(true);
  });

  it("refuses sandbox when the deployment declares nothing", () => {
    // Unset means resolveVerificationEnvironments falls back to production+sandbox,
    // which is a production posture — do not treat absence as permission.
    expect(isCreditGrantEnvironmentAccepted("sandbox", undefined)).toBe(false);
    expect(isCreditGrantEnvironmentAccepted("sandbox", "")).toBe(false);
  });
});
