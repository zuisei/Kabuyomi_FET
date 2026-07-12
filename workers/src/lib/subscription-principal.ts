import type { Env } from "../env";
import { AppError } from "./errors";
import type { VerifiedAppleEnvironment } from "./apple-signed-data";

const SUBSCRIPTION_PRINCIPAL_DOMAIN = "kabuyomi.subscription.quota.v1";

export interface StableSubscriptionPrincipal {
  quotaSubject: string;
  keyVersion: "v1";
  environment: VerifiedAppleEnvironment;
}

export async function deriveStableSubscriptionPrincipal(
  env: Pick<Env, "SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1">,
  originalTransactionId: string,
  environment: VerifiedAppleEnvironment
): Promise<StableSubscriptionPrincipal> {
  const secret = env.SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1?.trim();
  const normalizedOriginalTransactionId = originalTransactionId.trim();
  if (!secret) {
    throw new AppError(503, "Subscription principal derivation is not configured");
  }
  if (!normalizedOriginalTransactionId) {
    throw new AppError(400, "Verified original transaction id is required");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        `${SUBSCRIPTION_PRINCIPAL_DOMAIN}\u0000${environment}\u0000${normalizedOriginalTransactionId}`
      )
    )
  );

  return {
    quotaSubject: `subscription:v1:${base64UrlEncode(digest)}`,
    keyVersion: "v1",
    environment
  };
}

export async function buildStableSubscriptionGrantOperationId(options: {
  stablePrincipal: string;
  productId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<string> {
  const canonical = [
    "kabuyomi.subscription.monthly-grant.v1",
    options.stablePrincipal.trim(),
    options.productId.trim(),
    options.periodStart.trim(),
    options.periodEnd.trim()
  ].join("\u0000");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return `sub-grant:v1:${base64UrlEncode(digest).slice(0, 43)}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
