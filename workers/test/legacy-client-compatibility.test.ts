import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeLegacyClientCompatibilityRequest,
  isLegacyClientCompatibilityRequestAuthorized,
  resolveLegacyClientCompatibilityState,
  resolveLegacyClientCoreRoute
} from "../src/lib/legacy-client-compatibility";
import { readQuotaIdentity } from "../src/lib/quota";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

const NOW = Date.parse("2026-07-11T18:00:00.000Z");
const VALID_DEVICE_KEY = "123e4567-e89b-42d3-a456-426614174000";

function activeConfig() {
  return {
    ...DEFAULT_REMOTE_CONFIG,
    legacyClientCompatibility: {
      enabled: true,
      expiresAt: "2026-08-10T18:00:00.000Z"
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("legacy production client compatibility", () => {
  it("classifies only the released core surface", () => {
    expect(resolveLegacyClientCoreRoute("GET", "/v1/usage")).toBe("usage");
    expect(resolveLegacyClientCoreRoute("GET", "/v1/company/AAPL")).toBe("company_read");
    expect(resolveLegacyClientCoreRoute("POST", "/v1/company/AAPL/refresh")).toBe("company_refresh");
    expect(resolveLegacyClientCoreRoute("POST", "/v1/watchlist/add")).toBe("watchlist_add");
    expect(resolveLegacyClientCoreRoute("POST", "/v1/watchlist/remove")).toBe("watchlist_remove");
    expect(resolveLegacyClientCoreRoute("POST", "/v1/chat")).toBe("chat");
    expect(resolveLegacyClientCoreRoute("POST", "/v1/translate-quote")).toBe("quote_translation");

    for (const [method, path] of [
      ["POST", "/v1/ios/subscriptions/sync"],
      ["POST", "/v1/ios/purchases/credits/complete"],
      ["POST", "/v1/admob/reward-intents"],
      ["POST", "/v1/account/apple/session"],
      ["POST", "/v1/identity/bootstrap"],
      ["POST", "/v1/internal/eval/credits/grant"]
    ]) {
      expect(resolveLegacyClientCoreRoute(method, path)).toBeNull();
    }
  });

  it("activates only in an exact production environment and before the fixed expiry", () => {
    const config = activeConfig();
    expect(resolveLegacyClientCompatibilityState(
      { KABUYOMI_ENV: "production", ENVIRONMENT: "production" },
      config,
      NOW
    )).toBe("active");
    expect(resolveLegacyClientCompatibilityState(
      { KABUYOMI_ENV: "production", ENVIRONMENT: "test" },
      config,
      NOW
    )).toBe("not_production");
    expect(resolveLegacyClientCompatibilityState(
      { KABUYOMI_ENV: "test", ENVIRONMENT: "test" },
      config,
      NOW
    )).toBe("not_production");
    expect(resolveLegacyClientCompatibilityState(
      { KABUYOMI_ENV: "production" },
      { ...config, legacyClientCompatibility: { ...config.legacyClientCompatibility, enabled: false } },
      NOW
    )).toBe("disabled");
    expect(resolveLegacyClientCompatibilityState(
      { KABUYOMI_ENV: "production" },
      config,
      Date.parse(config.legacyClientCompatibility.expiresAt)
    )).toBe("expired");
  });

  it("authorizes a canonical shipped UUID for a core request and preserves its legacy principal", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const request = new Request("https://kabuyomi-api.example/v1/usage", {
      headers: { "x-device-key": VALID_DEVICE_KEY }
    });
    const env = {
      KABUYOMI_ENV: "production",
      ENVIRONMENT: "production",
      INSTALLATION_TOKEN_HMAC_KEY_V1: "installed-token-authority"
    };

    expect(authorizeLegacyClientCompatibilityRequest(
      request,
      new URL(request.url),
      env as never,
      activeConfig(),
      NOW
    )).toBe(true);
    expect(isLegacyClientCompatibilityRequestAuthorized(request)).toBe(true);

    const identity = await readQuotaIdentity(request, env as never, { requireDeviceKey: true });
    expect(identity).toMatchObject({
      quotaSubject: expect.stringMatching(/^free:device:[a-f0-9]{64}$/u),
      plan: "free",
      identityKind: "device_key",
      accessMode: "legacy_client_compatibility"
    });
  });

  it("rejects malformed keys, expired gates, and every non-core grant route", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const malformed = new Request("https://kabuyomi-api.example/v1/usage", {
      headers: { "x-device-key": "attacker-chosen-key" }
    });
    expect(authorizeLegacyClientCompatibilityRequest(
      malformed, new URL(malformed.url),
      { KABUYOMI_ENV: "production" } as never,
      activeConfig(), NOW
    )).toBe(false);

    const expired = new Request("https://kabuyomi-api.example/v1/usage", {
      headers: { "x-device-key": VALID_DEVICE_KEY }
    });
    expect(authorizeLegacyClientCompatibilityRequest(
      expired, new URL(expired.url),
      { KABUYOMI_ENV: "production" } as never,
      activeConfig(), Date.parse("2026-08-10T18:00:00.000Z")
    )).toBe(false);

    const purchase = new Request("https://kabuyomi-api.example/v1/ios/purchases/credits/complete", {
      method: "POST",
      headers: { "x-device-key": VALID_DEVICE_KEY }
    });
    expect(authorizeLegacyClientCompatibilityRequest(
      purchase, new URL(purchase.url),
      { KABUYOMI_ENV: "production" } as never,
      activeConfig(), NOW
    )).toBe(false);
  });
});
