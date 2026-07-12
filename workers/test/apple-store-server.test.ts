import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Environment } from "@apple/app-store-server-library";
import {
  buildAppStoreServerToken,
  verifyCreditPurchaseWithApple,
  verifySubscriptionWithApple
} from "../src/lib/apple-store-server";
import { setAppleSignedDataVerifierFactoryForTests } from "../src/lib/apple-signed-data";

describe("apple store server verification", () => {
  beforeEach(() => {
    setAppleSignedDataVerifierFactoryForTests((_env, environment) => ({
      verifyAndDecodeTransaction: async (value) => ({
        ...decodeFakeJws(value),
        environment: environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX
      }),
      verifyAndDecodeNotification: async (value) => decodeFakeJws(value),
      verifyAndDecodeRenewalInfo: async (value) => ({
        ...decodeFakeJws(value),
        environment: environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX
      })
    }));
  });

  afterEach(() => {
    setAppleSignedDataVerifierFactoryForTests(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sandbox mode only calls sandbox and verifies a sandbox credit purchase", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi.fn().mockResolvedValueOnce(successResponse(signedTransactionInfo));
    vi.stubGlobal("fetch", fetch);

    const result = await verifyCreditPurchaseWithApple(
      {
        APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
        APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
        APPLE_APP_STORE_PRIVATE_KEY: privateKey,
        APPLE_BUNDLE_ID: "app.kabuyomi.ios",
        APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
      } as never,
      {
        productId: "kabuyomi.credits.100",
        transactionId: "tx-100",
        originalTransactionId: "orig-tx-100",
        signedTransactionInfo
      }
    );

    expect(result).toMatchObject({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      verificationEnvironment: "sandbox",
      verificationVersion: "apple-node-library-3.1.0"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/tx-100");
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      accept: "application/json"
    });
    expect(String(fetch.mock.calls[0][1]?.headers.authorization)).toMatch(/^Bearer /);
  });

  it("production mode only calls production and verifies a production credit purchase", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi.fn().mockResolvedValueOnce(successResponse(signedTransactionInfo));
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
          APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "production"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          originalTransactionId: "orig-tx-100",
          signedTransactionInfo
        }
      )
    ).resolves.toMatchObject({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      verificationEnvironment: "production"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("api.storekit.itunes.apple.com/inApps/v1/transactions/tx-100");
  });

  it("rejects a verified consumable transaction whose appAccountToken belongs to another account", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-account-mismatch",
      originalTransactionId: "orig-account-mismatch",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios",
      appAccountToken: "11111111-1111-4111-8111-111111111111"
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse(signedTransactionInfo)));

    await expect(verifyCreditPurchaseWithApple({
      APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
      APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
      APPLE_APP_STORE_PRIVATE_KEY: privateKey,
      APPLE_BUNDLE_ID: "app.kabuyomi.ios",
      APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
    } as never, {
      productId: "kabuyomi.credits.100",
      transactionId: "tx-account-mismatch",
      originalTransactionId: "orig-account-mismatch",
      signedTransactionInfo,
      appAccountToken: "22222222-2222-4222-8222-222222222222"
    })).rejects.toMatchObject({ status: 409, publicMessage: "Purchase account mismatch" });
  });

  it("redacts transaction ids in Apple verification logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const privateKey = await testPrivateKeyPem();
    const transactionId = "tx-production-log-redaction-abcdefghijklmnopqrstuvwxyz";
    const signedTransactionInfo = fakeJws({
      transactionId,
      originalTransactionId: "orig-tx-production-log-redaction-abcdefghijklmnopqrstuvwxyz",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(successResponse(signedTransactionInfo)));

    await verifyCreditPurchaseWithApple(
      {
        APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
        APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
        APPLE_APP_STORE_PRIVATE_KEY: privateKey,
        APPLE_BUNDLE_ID: "app.kabuyomi.ios",
        APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
      } as never,
      {
        productId: "kabuyomi.credits.100",
        transactionId,
        signedTransactionInfo
      }
    );

    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('"transactionIdSuffix"'))).toBe(true);
    expect(lines.join("\n")).not.toContain(transactionId);
    expect(lines.join("\n")).not.toContain("orig-tx-production-log-redaction-abcdefghijklmnopqrstuvwxyz");
    expect(lines.join("\n")).not.toContain(signedTransactionInfo);
  });

  it("auto mode uses production success without calling sandbox", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi.fn().mockResolvedValueOnce(successResponse(signedTransactionInfo));
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
          APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "auto"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          originalTransactionId: "orig-tx-100",
          signedTransactionInfo
        }
      )
    ).resolves.toMatchObject({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      verificationEnvironment: "production"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("api.storekit.itunes.apple.com/inApps/v1/transactions/tx-100");
  });

  it("auto mode falls back from production 4040010 to sandbox", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(appleErrorResponse(404, 4040010, "TransactionIdNotFoundError"))
      .mockResolvedValueOnce(successResponse(signedTransactionInfo));
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
          APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "auto"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          originalTransactionId: "orig-tx-100",
          signedTransactionInfo
        }
      )
    ).resolves.toMatchObject({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      verificationEnvironment: "sandbox"
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain("api.storekit.itunes.apple.com/inApps/v1/transactions/tx-100");
    expect(String(fetch.mock.calls[1][0])).toContain("api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/tx-100");
  });

  it("auto mode falls back from production 401 to sandbox but only verifies after sandbox succeeds", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(appleErrorResponse(401, "UNAUTHORIZED", "Unauthorized"))
      .mockResolvedValueOnce(successResponse(signedTransactionInfo));
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
          APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "auto"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          originalTransactionId: "orig-tx-100",
          signedTransactionInfo
        }
      )
    ).resolves.toMatchObject({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      verificationEnvironment: "sandbox"
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toContain("api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/tx-100");
  });

  it("auto mode fails without granting when production 401 and sandbox 401 both fail", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(appleErrorResponse(401, "UNAUTHORIZED", "Unauthorized"))
      .mockResolvedValueOnce(appleErrorResponse(401, "UNAUTHORIZED", "Unauthorized"));
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
          APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "auto"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          originalTransactionId: "orig-tx-100",
          signedTransactionInfo
        }
      )
    ).rejects.toMatchObject({
      status: 503,
      publicMessage: "Apple transaction verification is not configured"
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("auto mode fails without granting when production not-found fallback and sandbox both fail", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(appleErrorResponse(404, 4040010, "TransactionIdNotFoundError"))
      .mockResolvedValueOnce(appleErrorResponse(404, 4040010, "TransactionIdNotFoundError"));
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
          APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "auto"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          originalTransactionId: "orig-tx-100",
          signedTransactionInfo
        }
      )
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Apple transaction could not be verified"
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("builds an App Store Server API JWT with JOSE ES256 shape", async () => {
    const privateKey = await testPrivateKeyPem();
    const before = Math.floor(Date.now() / 1000);

    const token = await buildAppStoreServerToken({
      APPLE_APP_STORE_ISSUER_ID: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
      APPLE_APP_STORE_KEY_ID: "QT2X2QH4G6",
      APPLE_APP_STORE_PRIVATE_KEY: privateKey,
      APPLE_BUNDLE_ID: "app.kabuyomi.ios"
    } as never);

    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const header = decodeJwtSegment(parts[0]);
    const payload = decodeJwtSegment(parts[1]);
    const signature = base64UrlDecode(parts[2]);

    expect(header).toEqual({
      alg: "ES256",
      kid: "QT2X2QH4G6",
      typ: "JWT"
    });
    expect(payload).toMatchObject({
      iss: "33b3d98d-ad68-4d93-874a-b9bc38db405d",
      aud: "appstoreconnect-v1",
      bid: "app.kabuyomi.ios"
    });
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    const issuedAt = Number(payload.iat);
    const expiresAt = Number(payload.exp);
    expect(issuedAt).toBeGreaterThanOrEqual(before);
    expect(expiresAt).toBe(issuedAt + 20 * 60);
    expect(signature).toHaveLength(64);
  });

  it("rejects mismatched transaction product ids before granting credits", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.other",
      bundleId: "app.kabuyomi.ios"
    });

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "issuer-id",
          APPLE_APP_STORE_KEY_ID: "key-id",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          originalTransactionId: "orig-tx-100",
          signedTransactionInfo
        }
      )
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Purchase transaction product mismatch"
    });
  });

  it("does not accept a client-provided JWS without Apple server verification", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-forged",
      originalTransactionId: "orig-tx-forged",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "issuer-id",
          APPLE_APP_STORE_KEY_ID: "key-id",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-forged",
          originalTransactionId: "orig-tx-forged",
          signedTransactionInfo
        }
      )
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Apple transaction could not be verified"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the Apple server transaction payload as the authority for credit purchases", async () => {
    const privateKey = await testPrivateKeyPem();
    const clientSignedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const appleSignedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.other",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ signedTransactionInfo: appleSignedTransactionInfo }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "issuer-id",
          APPLE_APP_STORE_KEY_ID: "key-id",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          originalTransactionId: "orig-tx-100",
          signedTransactionInfo: clientSignedTransactionInfo
        }
      )
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Purchase transaction product mismatch"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("requires server-side Apple credentials", async () => {
    await expect(
      verifyCreditPurchaseWithApple(
        {
          APPLE_BUNDLE_ID: "app.kabuyomi.ios"
        } as never,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100"
        }
      )
    ).rejects.toMatchObject({
      status: 503,
      publicMessage: "Apple transaction verification is not configured"
    });
  });

  it("verifies an active subscription through Apple transaction info", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "sub-tx-100",
      originalTransactionId: "orig-sub-tx-100",
      productId: "kabuyomi.sub.max.monthly",
      bundleId: "app.kabuyomi.ios",
      expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ signedTransactionInfo }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await verifySubscriptionWithApple(
      {
        APPLE_APP_STORE_ISSUER_ID: "issuer-id",
        APPLE_APP_STORE_KEY_ID: "key-id",
        APPLE_APP_STORE_PRIVATE_KEY: privateKey,
        APPLE_BUNDLE_ID: "app.kabuyomi.ios",
        APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
      } as never,
      {
        productId: "kabuyomi.sub.max.monthly",
        transactionId: "sub-tx-100",
        originalTransactionId: "orig-sub-tx-100",
        active: true,
        signedTransactionInfo
      }
    );

    expect(result).toMatchObject({
      originalTransactionId: "orig-sub-tx-100",
      transactionId: "sub-tx-100",
      productId: "kabuyomi.sub.max.monthly",
      plan: "pro_max",
      active: true,
      status: "active",
      verificationEnvironment: "sandbox",
      verificationVersion: "apple-node-library-3.1.0",
      periodStart: null,
      periodEnd: expect.any(String),
      expiresAt: expect.any(String),
      revokedAt: null
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/sub-tx-100");
  });

  it("returns a verified expired subscription snapshot without granting", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "sub-tx-expired",
      originalTransactionId: "orig-sub-expired",
      productId: "kabuyomi.sub.lite.monthly",
      bundleId: "app.kabuyomi.ios",
      expiresDate: Date.now() - 1000
    });
    const fetch = vi.fn().mockResolvedValueOnce(successResponse(signedTransactionInfo));
    vi.stubGlobal("fetch", fetch);

    const result = await verifySubscriptionWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "issuer-id",
          APPLE_APP_STORE_KEY_ID: "key-id",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
        } as never,
        {
          productId: "kabuyomi.sub.lite.monthly",
          transactionId: "sub-tx-expired",
          originalTransactionId: "orig-sub-expired",
          active: true,
          signedTransactionInfo
        }
      );
    expect(result).toMatchObject({
      active: false,
      status: "expired",
      originalTransactionId: "orig-sub-expired",
      productId: "kabuyomi.sub.lite.monthly",
      verificationEnvironment: "sandbox"
    });
  });

  it("returns a verified revoked subscription snapshot without granting", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "sub-tx-revoked",
      originalTransactionId: "orig-sub-revoked",
      productId: "kabuyomi.sub.pro.monthly",
      bundleId: "app.kabuyomi.ios",
      revocationDate: Date.now(),
      expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
    const fetch = vi.fn().mockResolvedValueOnce(successResponse(signedTransactionInfo));
    vi.stubGlobal("fetch", fetch);

    const result = await verifySubscriptionWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "issuer-id",
          APPLE_APP_STORE_KEY_ID: "key-id",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
        } as never,
        {
          productId: "kabuyomi.sub.pro.monthly",
          transactionId: "sub-tx-revoked",
          originalTransactionId: "orig-sub-revoked",
          active: true,
          signedTransactionInfo
        }
      );
    expect(result).toMatchObject({
      active: false,
      status: "revoked",
      originalTransactionId: "orig-sub-revoked",
      productId: "kabuyomi.sub.pro.monthly",
      revokedAt: expect.any(String),
      verificationEnvironment: "sandbox"
    });
  });

  it("rejects subscription bundle id mismatches", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "sub-tx-bundle",
      originalTransactionId: "orig-sub-bundle",
      productId: "kabuyomi.sub.max.monthly",
      bundleId: "wrong.bundle",
      expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000
    });

    await expect(
      verifySubscriptionWithApple(
        {
          APPLE_APP_STORE_ISSUER_ID: "issuer-id",
          APPLE_APP_STORE_KEY_ID: "key-id",
          APPLE_APP_STORE_PRIVATE_KEY: privateKey,
          APPLE_BUNDLE_ID: "app.kabuyomi.ios",
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox"
        } as never,
        {
          productId: "kabuyomi.sub.max.monthly",
          transactionId: "sub-tx-bundle",
          originalTransactionId: "orig-sub-bundle",
          active: true,
          signedTransactionInfo
        }
      )
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Purchase transaction bundle mismatch"
    });
  });
});

async function testPrivateKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  return `-----BEGIN PRIVATE KEY-----\n${base64Encode(new Uint8Array(pkcs8))}\n-----END PRIVATE KEY-----`;
}

function fakeJws(payload: Record<string, unknown>): string {
  return `${base64UrlEncodeJSON({ alg: "ES256", kid: "apple" })}.${base64UrlEncodeJSON(payload)}.signature`;
}

function decodeFakeJws(value: string): Record<string, unknown> {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("invalid_test_jws");
  }
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as Record<string, unknown>;
}

function successResponse(signedTransactionInfo: string): Response {
  return new Response(JSON.stringify({ signedTransactionInfo }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function appleErrorResponse(status: number, errorCode: number | string, errorName: string): Response {
  return new Response(
    JSON.stringify({
      errorCode,
      errorName,
      errorMessage: errorName
    }),
    {
      status,
      headers: { "content-type": "application/json" }
    }
  );
}

function base64UrlEncodeJSON(value: unknown): string {
  return base64Encode(new TextEncoder().encode(JSON.stringify(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeJwtSegment(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as Record<string, unknown>;
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
