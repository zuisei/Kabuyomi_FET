import { afterEach, describe, expect, it } from "vitest";
import { Environment } from "@apple/app-store-server-library";
import type { Env } from "../src/env";
import {
  setAppleSignedDataVerifierFactoryForTests,
  verifyAppleNotificationSignedData,
  verifyAppleTransactionSignedData
} from "../src/lib/apple-signed-data";
import {
  APPLE_ROOT_CA_G2_DER_BASE64,
  APPLE_ROOT_CA_G2_SHA256,
  APPLE_ROOT_CA_G3_DER_BASE64,
  APPLE_ROOT_CA_G3_SHA256
} from "../src/lib/apple-root-certificates";

describe("Apple signed-data verification boundary", () => {
  afterEach(() => {
    setAppleSignedDataVerifierFactoryForTests(undefined);
  });

  it("returns only a cryptographically verified sandbox transaction result", async () => {
    setAppleSignedDataVerifierFactoryForTests((_env, environment) => ({
      verifyAndDecodeTransaction: async () => ({
        environment: Environment.SANDBOX,
        bundleId: "app.kabuyomi.ios",
        transactionId: "tx-1",
        originalTransactionId: "orig-1",
        productId: "kabuyomi.sub.pro.monthly"
      }),
      verifyAndDecodeNotification: async () => ({}),
      verifyAndDecodeRenewalInfo: async () => ({ environment: Environment.SANDBOX })
    }));

    const result = await verifyAppleTransactionSignedData(
      { APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox" } as Env,
      "signed-transaction"
    );

    expect(result.environment).toBe("sandbox");
    expect(result.payload.transactionId).toBe("tx-1");
    expect(result.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.verificationVersion).toBe("apple-node-library-3.1.0");
  });

  it("auto mode accepts sandbox only after the production verifier rejects", async () => {
    const attempts: string[] = [];
    setAppleSignedDataVerifierFactoryForTests((_env, environment) => ({
      verifyAndDecodeTransaction: async () => {
        attempts.push(environment);
        if (environment === "production") {
          throw new Error("invalid_signature");
        }
        return { environment: Environment.SANDBOX, bundleId: "app.kabuyomi.ios" };
      },
      verifyAndDecodeNotification: async () => ({}),
      verifyAndDecodeRenewalInfo: async () => ({ environment: Environment.SANDBOX })
    }));

    const result = await verifyAppleTransactionSignedData(
      { APPLE_APP_STORE_SERVER_ENVIRONMENT: "auto" } as Env,
      "signed-transaction"
    );

    expect(result.environment).toBe("sandbox");
    expect(attempts).toEqual(["production", "sandbox"]);
  });

  it("rejects a decoded environment that differs from the configured verifier", async () => {
    setAppleSignedDataVerifierFactoryForTests(() => ({
      verifyAndDecodeTransaction: async () => ({ environment: Environment.PRODUCTION }),
      verifyAndDecodeNotification: async () => ({}),
      verifyAndDecodeRenewalInfo: async () => ({ environment: Environment.PRODUCTION })
    }));

    await expect(
      verifyAppleTransactionSignedData(
        { APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox" } as Env,
        "signed-transaction"
      )
    ).rejects.toMatchObject({ status: 400, publicMessage: "Apple transaction signature verification failed" });
  });

  it("verifies notification payloads through the same fail-closed authority", async () => {
    setAppleSignedDataVerifierFactoryForTests((_env, environment) => ({
      verifyAndDecodeTransaction: async () => ({ environment: Environment.SANDBOX }),
      verifyAndDecodeNotification: async () => ({
        notificationUUID: "notification-1",
        signedDate: 1_783_650_000_000,
        version: "2.0",
        notificationType: "DID_RENEW",
        data: { environment: Environment.SANDBOX }
      }),
      verifyAndDecodeRenewalInfo: async () => ({ environment: Environment.SANDBOX })
    }));

    const result = await verifyAppleNotificationSignedData(
      { APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox" } as Env,
      "signed-notification"
    );
    expect(result.payload.notificationUUID).toBe("notification-1");
  });

  it("fails closed when production appAppleId is not configured", async () => {
    await expect(
      verifyAppleTransactionSignedData(
        {
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "production",
          APPLE_BUNDLE_ID: "app.kabuyomi.ios"
        } as Env,
        "signed-transaction"
      )
    ).rejects.toMatchObject({ status: 503 });
  });

  it("uses the official verifier to reject a malformed or untrusted JWS chain", async () => {
    setAppleSignedDataVerifierFactoryForTests(undefined);
    const header = btoa(JSON.stringify({ alg: "ES256", x5c: [btoa("not-a-certificate")] }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const payload = btoa(
      JSON.stringify({
        bundleId: "app.kabuyomi.ios",
        environment: Environment.SANDBOX,
        signedDate: Date.now()
      })
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");

    await expect(
      verifyAppleTransactionSignedData(
        {
          APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox",
          APPLE_BUNDLE_ID: "app.kabuyomi.ios"
        } as Env,
        `${header}.${payload}.invalid-signature`
      )
    ).rejects.toMatchObject({ status: 400, publicMessage: "Apple transaction signature verification failed" });
  });

  it.each([
    [APPLE_ROOT_CA_G2_DER_BASE64, APPLE_ROOT_CA_G2_SHA256],
    [APPLE_ROOT_CA_G3_DER_BASE64, APPLE_ROOT_CA_G3_SHA256]
  ])("keeps the bundled Apple root pinned to its audited SHA-256", async (base64, expectedHash) => {
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(actual).toBe(expectedHash);
  });
});
