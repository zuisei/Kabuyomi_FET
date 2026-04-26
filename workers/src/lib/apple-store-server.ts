import type { Env } from "../env";
import { isSubscriptionProductId, resolveCreditPackCredits } from "./billing-catalog";
import { AppError } from "./errors";
import { logEvent, logWarnEvent } from "./logging";

interface CreditPurchaseVerificationRequest {
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
  signedTransactionInfo?: string;
}

interface SubscriptionVerificationRequest {
  productId?: string;
  transactionId?: string;
  originalTransactionId: string;
  active: boolean;
  signedTransactionInfo?: string;
}

interface AppStoreTransactionInfoResponse {
  signedTransactionInfo?: string;
}

interface DecodedTransactionPayload {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  bundleId?: string;
  revocationDate?: number;
  expiresDate?: number | string;
}

type AppStoreServerEnvironment = "production" | "sandbox" | "auto";

const PRODUCTION_TRANSACTION_URL = "https://api.storekit.itunes.apple.com/inApps/v1/transactions";
const SANDBOX_TRANSACTION_URL = "https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions";

export async function verifyCreditPurchaseWithApple(
  env: Env,
  request: CreditPurchaseVerificationRequest
): Promise<{ transactionId: string; originalTransactionId?: string }> {
  if (!resolveCreditPackCredits(request.productId)) {
    throw new AppError(400, "Unsupported credit product");
  }

  if (request.signedTransactionInfo) {
    const clientPayload = decodeJWSPayload(request.signedTransactionInfo);
    ensureTransactionMatches("client", request, clientPayload, env.APPLE_BUNDLE_ID);
  }

  const signedTransactionInfo = await fetchSignedTransactionInfo(env, request.transactionId);
  const applePayload = decodeJWSPayload(signedTransactionInfo);
  ensureTransactionMatches("apple", request, applePayload, env.APPLE_BUNDLE_ID);

  if (applePayload.revocationDate) {
    throw new AppError(409, "Purchase transaction has been revoked");
  }

  return {
    transactionId: applePayload.transactionId ?? request.transactionId,
    originalTransactionId: applePayload.originalTransactionId ?? request.originalTransactionId
  };
}

export async function verifySubscriptionWithApple(
  env: Env,
  request: SubscriptionVerificationRequest
): Promise<{ originalTransactionId: string; productId: string | null; active: boolean }> {
  if (!request.active) {
    return {
      originalTransactionId: request.originalTransactionId,
      productId: request.productId ?? null,
      active: false
    };
  }

  if (!isSubscriptionProductId(request.productId)) {
    throw new AppError(400, "Unsupported subscription product");
  }

  let transactionId = request.transactionId?.trim();
  if (request.signedTransactionInfo) {
    const clientPayload = decodeJWSPayload(request.signedTransactionInfo);
    ensureTransactionMatches(
      "client",
      { ...request, transactionId: transactionId ?? clientPayload.transactionId ?? "" },
      clientPayload,
      env.APPLE_BUNDLE_ID
    );
    ensureSubscriptionIsActive(clientPayload);
    transactionId = transactionId || clientPayload.transactionId;
  }

  if (!transactionId) {
    throw new AppError(400, "Subscription transaction id is required");
  }

  const signedTransactionInfo = await fetchSignedTransactionInfo(env, transactionId);
  const applePayload = decodeJWSPayload(signedTransactionInfo);
  ensureTransactionMatches("apple", { ...request, transactionId }, applePayload, env.APPLE_BUNDLE_ID);
  ensureSubscriptionIsActive(applePayload);

  return {
    originalTransactionId: applePayload.originalTransactionId ?? request.originalTransactionId,
    productId: applePayload.productId ?? request.productId ?? null,
    active: true
  };
}

async function fetchSignedTransactionInfo(env: Env, transactionId: string): Promise<string> {
  const token = await buildAppStoreServerToken(env);
  const environments = resolveVerificationEnvironments(env.APPLE_APP_STORE_SERVER_ENVIRONMENT);
  let lastStatus = 0;
  let lastError = "Apple transaction verification failed";

  for (const environment of environments) {
    const baseURL = environment === "sandbox" ? SANDBOX_TRANSACTION_URL : PRODUCTION_TRANSACTION_URL;
    const response = await fetch(`${baseURL}/${encodeURIComponent(transactionId)}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json"
      }
    });

    if (response.ok) {
      const payload = (await response.json()) as AppStoreTransactionInfoResponse;
      if (!payload.signedTransactionInfo) {
        throw new AppError(502, "Apple transaction verification failed", "Missing signedTransactionInfo");
      }
      logEvent("apple_transaction_verified", {
        transactionId,
        environment
      });
      return payload.signedTransactionInfo;
    }

    lastStatus = response.status;
    lastError = await safeReadError(response);
    if (!(environment === "production" && environments.includes("sandbox") && [400, 404].includes(response.status))) {
      break;
    }
  }

  logWarnEvent("apple_transaction_verification_failed", {
    transactionId,
    status: lastStatus,
    reason: lastError
  });

  if (lastStatus === 401) {
    throw new AppError(503, "Apple transaction verification is not configured", lastError);
  }
  if (lastStatus === 404 || lastStatus === 400) {
    throw new AppError(400, "Apple transaction could not be verified", lastError);
  }
  throw new AppError(502, "Apple transaction verification failed", lastError);
}

async function buildAppStoreServerToken(env: Env): Promise<string> {
  const issuerId = env.APPLE_APP_STORE_ISSUER_ID?.trim();
  const keyId = env.APPLE_APP_STORE_KEY_ID?.trim();
  const privateKey = env.APPLE_APP_STORE_PRIVATE_KEY?.trim();
  const bundleId = env.APPLE_BUNDLE_ID?.trim();

  if (!issuerId || !keyId || !privateKey || !bundleId) {
    throw new AppError(503, "Apple transaction verification is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT"
  };
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 20 * 60,
    aud: "appstoreconnect-v1",
    bid: bundleId
  };
  const signingInput = `${base64UrlEncodeJSON(header)}.${base64UrlEncodeJSON(payload)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

function ensureTransactionMatches(
  source: "client" | "apple",
  request: CreditPurchaseVerificationRequest | (SubscriptionVerificationRequest & { transactionId: string }),
  payload: DecodedTransactionPayload,
  expectedBundleId?: string
): void {
  if (payload.transactionId !== request.transactionId) {
    throw new AppError(400, "Purchase transaction mismatch", `${source} transactionId mismatch`);
  }
  if (payload.productId !== request.productId) {
    throw new AppError(400, "Purchase transaction product mismatch", `${source} productId mismatch`);
  }
  if (request.originalTransactionId && payload.originalTransactionId !== request.originalTransactionId) {
    throw new AppError(400, "Purchase transaction mismatch", `${source} originalTransactionId mismatch`);
  }
  if (expectedBundleId?.trim() && payload.bundleId !== expectedBundleId.trim()) {
    throw new AppError(400, "Purchase transaction bundle mismatch", `${source} bundleId mismatch`);
  }
}

function ensureSubscriptionIsActive(payload: DecodedTransactionPayload): void {
  if (payload.revocationDate) {
    throw new AppError(409, "Subscription transaction has been revoked");
  }

  const expiresAt =
    typeof payload.expiresDate === "string" ? Number.parseInt(payload.expiresDate, 10) : payload.expiresDate;
  if (expiresAt !== undefined && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throw new AppError(409, "Subscription transaction has expired");
  }
}

function decodeJWSPayload(jws: string): DecodedTransactionPayload {
  const parts = jws.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new AppError(400, "Invalid signed transaction info");
  }

  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as DecodedTransactionPayload;
  } catch (error) {
    throw new AppError(400, "Invalid signed transaction info", error instanceof Error ? error.message : String(error));
  }
}

function resolveVerificationEnvironments(rawValue: string | undefined): AppStoreServerEnvironment[] {
  const normalized = rawValue?.trim().toLowerCase();
  if (normalized === "production") {
    return ["production"];
  }
  if (normalized === "sandbox") {
    return ["sandbox"];
  }
  return ["production", "sandbox"];
}

function base64UrlEncodeJSON(value: unknown): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
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

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/gu, "")
    .replace(/-----END PRIVATE KEY-----/gu, "")
    .replace(/\s/gu, "");
  const bytes = base64UrlDecode(base64.replaceAll("+", "-").replaceAll("/", "_"));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function safeReadError(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return `HTTP ${response.status}`;
  }
}
