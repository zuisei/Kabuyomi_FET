import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCreditPurchaseWithApple, verifySubscriptionWithApple } from "../src/lib/apple-store-server";

describe("apple store server verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies a sandbox credit purchase through Apple transaction info", async () => {
    const privateKey = await testPrivateKeyPem();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ signedTransactionInfo }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetch);

    const result = await verifyCreditPurchaseWithApple(
      {
        APPLE_APP_STORE_ISSUER_ID: "issuer-id",
        APPLE_APP_STORE_KEY_ID: "key-id",
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
    );

    expect(result).toEqual({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100"
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain("api.storekit.itunes.apple.com/inApps/v1/transactions/tx-100");
    expect(String(fetch.mock.calls[1][0])).toContain("api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/tx-100");
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
      accept: "application/json"
    });
    expect(String(fetch.mock.calls[1][1]?.headers.authorization)).toMatch(/^Bearer /);
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
          APPLE_BUNDLE_ID: "app.kabuyomi.ios"
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
      productId: "app.kabuyomi.pro_max.monthly",
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
        productId: "app.kabuyomi.pro_max.monthly",
        transactionId: "sub-tx-100",
        originalTransactionId: "orig-sub-tx-100",
        active: true,
        signedTransactionInfo
      }
    );

    expect(result).toEqual({
      originalTransactionId: "orig-sub-tx-100",
      productId: "app.kabuyomi.pro_max.monthly",
      active: true
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/sub-tx-100");
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

function base64UrlEncodeJSON(value: unknown): string {
  return base64Encode(new TextEncoder().encode(JSON.stringify(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
