import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAccountSession,
  resolveAccountCredential,
  setAppleIdentityVerifierForTests
} from "../src/lib/account-recovery";
import { readQuotaIdentity } from "../src/lib/quota";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { buildPaidCreditMigrationSnapshot, handleAccountRecoveryRoutes } from "../src/routes/account-recovery";

function env() {
  const principals = new Map<string, { account_principal: string; app_account_token: string }>();
  const persistedValues: unknown[][] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              persistedValues.push(args);
              if (sql.includes("INSERT INTO account_principals")) {
                principals.set(String(args[0]), {
                  account_principal: String(args[0]),
                  app_account_token: String(args[2])
                });
              }
              return { meta: { changes: 1 } };
            },
            async first<T>() {
              if (sql.includes("FROM account_principals")) return (principals.get(String(args[0])) ?? null) as T;
              return null as T;
            }
          };
        }
      };
    }
  };
  return {
    value: {
      DB,
      APPLE_BUNDLE_ID: "app.kabuyomi.ios",
      ACCOUNT_PRINCIPAL_HMAC_KEY_V1: "account-principal-test-secret",
      ACCOUNT_SESSION_HMAC_KEY_V1: "account-session-test-secret"
    } as never,
    persistedValues
  };
}

const installation = (suffix: string) => ({
  token: `installation-token-${suffix}`,
  principal: `installation:v1:${suffix}`,
  tokenReference: `reference-${suffix}`,
  tokenVersion: 1 as const,
  attestationStatus: "verified" as const,
  creditMode: "full" as const,
  issuedAt: "2026-07-11T00:00:00.000Z"
});

describe("Apple account recovery principal", () => {
  afterEach(() => setAppleIdentityVerifierForTests(undefined));

  it("maps two verified devices for one Apple subject to one stable account and appAccountToken", async () => {
    const test = env();
    const rawSubject = "000742.opaque-private-apple-subject";
    setAppleIdentityVerifierForTests(async () => ({
      iss: "https://appleid.apple.com",
      aud: "app.kabuyomi.ios",
      sub: rawSubject,
      exp: Math.floor(Date.now() / 1_000) + 600
    }));

    const first = await createAccountSession(test.value, "identity-token-device-a", installation("device-a"));
    const second = await createAccountSession(test.value, "identity-token-device-b", installation("device-b"));

    expect(second.accountPrincipal).toBe(first.accountPrincipal);
    expect(second.appAccountToken).toBe(first.appAccountToken);
    expect(first.accountPrincipal).toMatch(/^account:v1:/);
    expect(first.appAccountToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(test.persistedValues)).not.toContain(rawSubject);
    const deviceAIdentity = await readQuotaIdentity(new Request("https://api.test/v1/usage", {
      headers: { "x-kabuyomi-account-token": first.token }
    }), test.value);
    const replacementDeviceIdentity = await readQuotaIdentity(new Request("https://api.test/v1/usage", {
      headers: { "x-kabuyomi-account-token": second.token }
    }), test.value);
    expect(replacementDeviceIdentity.quotaSubject).toBe(deviceAIdentity.quotaSubject);
  });

  it("does not write the raw Apple subject or identity token to logs", async () => {
    const test = env();
    const rawSubject = "raw-apple-subject-must-not-log";
    const rawToken = "raw-identity-token-must-not-log";
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((value) => logs.push(String(value)));
    setAppleIdentityVerifierForTests(async () => ({
      iss: "https://appleid.apple.com",
      aud: "app.kabuyomi.ios",
      sub: rawSubject,
      exp: Math.floor(Date.now() / 1_000) + 600
    }));

    try {
      await createAccountSession(test.value, rawToken, installation("device-a"));
    } finally {
      logSpy.mockRestore();
    }

    expect(logs.join("\n")).not.toContain(rawSubject);
    expect(logs.join("\n")).not.toContain(rawToken);
  });

  it("round-trips a signed account session and rejects tampering without deleting server state", async () => {
    const test = env();
    setAppleIdentityVerifierForTests(async () => ({
      iss: "https://appleid.apple.com",
      aud: "app.kabuyomi.ios",
      sub: "stable-subject",
      exp: Math.floor(Date.now() / 1_000) + 600
    }));
    const issued = await createAccountSession(test.value, "identity-token", installation("device-a"));
    const resolved = await resolveAccountCredential(new Request("https://api.test/v1/usage", {
      headers: { authorization: `Account ${issued.token}` }
    }), test.value);
    expect(resolved).toMatchObject({
      accountPrincipal: issued.accountPrincipal,
      appAccountToken: issued.appAccountToken
    });

    const [payload, signature] = issued.token.split(".");
    const tampered = `${payload}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
    await expect(resolveAccountCredential(new Request("https://api.test/v1/usage", {
      headers: { authorization: `Account ${tampered}` }
    }), test.value)).rejects.toMatchObject({ status: 401 });
  });

  it("uses the verified account principal as the shared quota identity", async () => {
    const test = env();
    setAppleIdentityVerifierForTests(async () => ({
      iss: "https://appleid.apple.com",
      aud: "app.kabuyomi.ios",
      sub: "shared-paid-credit-subject",
      exp: Math.floor(Date.now() / 1_000) + 600
    }));
    const issued = await createAccountSession(test.value, "identity-token", installation("device-a"));

    const identity = await readQuotaIdentity(new Request("https://api.test/v1/usage", {
      headers: { "x-kabuyomi-account-token": issued.token }
    }), test.value);

    expect(identity).toMatchObject({
      quotaSubject: issued.accountPrincipal,
      plan: "free",
      identityKind: "account",
      accessMode: "verified_apple_account"
    });
  });

  it("preserves the source buckets and paid audit evidence when moving the verified installation into the account", () => {
    const result = buildPaidCreditMigrationSnapshot({
      creditState: {
        plan: "free",
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
        monthlyRemaining: 12,
        monthlyLimit: 50,
        rewardedAdRemaining: 4,
        rewardedAdLots: [{ lotId: "ad-lot", remaining: 4 }],
        welcomeRemaining: 25,
        purchasedRemaining: 80,
        updatedAt: "2026-07-11T00:00:00.000Z"
      },
      purchaseRecords: [["purchase:tx-1", { transactionId: "tx-1" }]],
      creditOperationRecords: [["credit_operation:purchase:tx-1", { type: "purchase_grant", delta: 80 }]],
      exportedAt: "2026-07-11T00:00:00.000Z"
    });

    expect(result.purchasedRemaining).toBe(80);
    expect(result.purchaseEvidenceCount).toBe(1);
    expect(result.snapshot.creditState).toMatchObject({
      monthlyRemaining: 12,
      monthlyLimit: 50,
      rewardedAdRemaining: 4,
      welcomeRemaining: 25,
      purchasedRemaining: 80
    });
    expect(result.snapshot.monthlyGrantRecords).toEqual([]);
    expect(result.snapshot.purchaseRecords).toHaveLength(1);
    expect(result.snapshot.creditOperationRecords).toHaveLength(1);
  });

  it.each([
    "/v1/account/apple/session",
    "/v1/account/paid-credit-migration"
  ])("rejects %s before identity or Apple work when the runtime capability is disabled", async (pathname) => {
    const request = new Request(`https://api.test${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const response = await handleAccountRecoveryRoutes({
      request,
      url: new URL(request.url),
      env: {} as never,
      config: { ...DEFAULT_REMOTE_CONFIG, accountRecoveryReady: false },
      ctx: {} as never
    });

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "Account recovery is temporarily unavailable"
    });
  });
});
