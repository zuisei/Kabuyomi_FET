import { describe, expect, it } from "vitest";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { resolveBillingRuntimeCapabilities } from "../src/routes/usage";

const readyEnv = {
  APPLE_APP_STORE_ISSUER_ID: "issuer",
  APPLE_APP_STORE_KEY_ID: "key",
  APPLE_APP_STORE_PRIVATE_KEY: "private-key",
  APPLE_BUNDLE_ID: "app.kabuyomi.ios",
  SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1: "subscription-secret",
  ACCOUNT_PRINCIPAL_HMAC_KEY_V1: "account-principal-secret",
  ACCOUNT_SESSION_HMAC_KEY_V1: "account-session-secret"
};

describe("usage billing runtime capabilities", () => {
  it("advertises only capabilities whose full secret-backed runtime is ready", () => {
    expect(resolveBillingRuntimeCapabilities(readyEnv as never, {
      ...DEFAULT_REMOTE_CONFIG,
      accountRecoveryReady: true
    })).toEqual({
      creditBillingEnabled: true,
      consumablePurchasesEnabled: true,
      accountRecoveryReady: true
    });
  });

  it("hides billing and consumables when Apple server authority is incomplete", () => {
    expect(resolveBillingRuntimeCapabilities({ APPLE_BUNDLE_ID: "app.kabuyomi.ios" } as never, {
      ...DEFAULT_REMOTE_CONFIG,
      accountRecoveryReady: false
    })).toEqual({
      creditBillingEnabled: false,
      consumablePurchasesEnabled: false,
      accountRecoveryReady: false
    });
  });

  it("does not expose account-bound consumables when account recovery secrets are missing", () => {
    expect(resolveBillingRuntimeCapabilities({
      ...readyEnv,
      ACCOUNT_SESSION_HMAC_KEY_V1: undefined
    } as never, {
      ...DEFAULT_REMOTE_CONFIG,
      accountRecoveryReady: true
    })).toEqual({
      creditBillingEnabled: true,
      consumablePurchasesEnabled: false,
      accountRecoveryReady: false
    });
  });

  it("honors the paid-grant emergency stop in capability output", () => {
    expect(resolveBillingRuntimeCapabilities(readyEnv as never, {
      ...DEFAULT_REMOTE_CONFIG,
      emergencyPaidGrantsDisabled: true,
      accountRecoveryReady: true
    })).toEqual({
      creditBillingEnabled: false,
      consumablePurchasesEnabled: false,
      accountRecoveryReady: true
    });
  });
});
