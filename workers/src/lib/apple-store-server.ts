import type { Env } from "../env";
import {
  resolveCreditPackCredits,
  resolvePlanFromBilling,
  type AccessPlan
} from "./billing-catalog";
import {
  verifyAppleTransactionSignedData,
  type VerifiedAppleEnvironment
} from "./apple-signed-data";
import { AppError } from "./errors";
import { logEvent, logWarnEvent, suffixForLog } from "./logging";

interface CreditPurchaseVerificationRequest {
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
  signedTransactionInfo?: string;
  appAccountToken?: string;
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

interface ParsedTransactionPayload {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  bundleId?: string;
  revocationDate?: number;
  purchaseDate?: number | string;
  expiresDate?: number | string;
  signedDate?: number;
  environment?: string;
  appAccountToken?: string;
}

interface AppleVerificationAttempt {
  environment: VerifiedAppleEnvironment;
  status: number;
  errorCode?: number | string;
  errorName?: string;
  errorMessage?: string;
}

interface AppStoreServerTokenDebugInfo {
  keyId: string;
  issuerIdPrefix: string;
  issuerIdHash: string;
  bundleId: string;
  headerAlg: string;
  headerKid: string;
  headerTyp: string;
  payloadAud: string;
  payloadBid: string;
  signatureBytes: number;
}

interface AppleErrorDetails {
  reason: string;
  errorCode?: number | string;
  errorName?: string;
  errorMessage?: string;
}

const PRODUCTION_TRANSACTION_URL = "https://api.storekit.itunes.apple.com/inApps/v1/transactions";
const SANDBOX_TRANSACTION_URL = "https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions";

export async function verifyCreditPurchaseWithApple(
  env: Env,
  request: CreditPurchaseVerificationRequest
): Promise<{
  transactionId: string;
  originalTransactionId?: string;
  appAccountToken?: string;
  verificationEnvironment: VerifiedAppleEnvironment;
  verificationVersion: string;
  payloadDigest: string;
}> {
  if (!resolveCreditPackCredits(request.productId)) {
    throw new AppError(400, "Unsupported credit product");
  }

  if (request.signedTransactionInfo) {
    const clientVerification = await verifyAppleTransactionSignedData(env, request.signedTransactionInfo);
    ensureTransactionMatches("client", request, clientVerification.payload, env.APPLE_BUNDLE_ID);
  }

  const fetched = await fetchSignedTransactionInfo(env, request.transactionId);
  const appleVerification = await verifyAppleTransactionSignedData(
    env,
    fetched.signedTransactionInfo,
    fetched.environment
  );
  const applePayload = appleVerification.payload;
  ensureTransactionMatches("apple", request, applePayload, env.APPLE_BUNDLE_ID);

  if (applePayload.revocationDate) {
    throw new AppError(409, "Purchase transaction has been revoked");
  }

  return {
    transactionId: applePayload.transactionId ?? request.transactionId,
    originalTransactionId: applePayload.originalTransactionId ?? request.originalTransactionId,
    appAccountToken: applePayload.appAccountToken,
    verificationEnvironment: appleVerification.environment,
    verificationVersion: appleVerification.verificationVersion,
    payloadDigest: appleVerification.payloadDigest
  };
}

export async function verifySubscriptionWithApple(
  env: Env,
  request: SubscriptionVerificationRequest
): Promise<{
  originalTransactionId: string;
  transactionId: string | null;
  productId: string | null;
  plan: Exclude<AccessPlan, "free"> | null;
  active: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
  verificationEnvironment: VerifiedAppleEnvironment;
  verificationVersion: string;
  payloadDigest: string;
  signedDate: string | null;
}> {
  let transactionId = request.transactionId?.trim();
  if (request.signedTransactionInfo) {
    const clientVerification = await verifyAppleTransactionSignedData(env, request.signedTransactionInfo);
    const clientPayload = clientVerification.payload;
    ensureTransactionMatches(
      "client",
      { ...request, transactionId: transactionId ?? clientPayload.transactionId ?? "" },
      clientPayload,
      env.APPLE_BUNDLE_ID
    );
    transactionId = transactionId || clientPayload.transactionId;
  }

  if (!transactionId) {
    throw new AppError(400, "Subscription transaction id is required");
  }

  const fetched = await fetchSignedTransactionInfo(env, transactionId);
  const appleVerification = await verifyAppleTransactionSignedData(
    env,
    fetched.signedTransactionInfo,
    fetched.environment
  );
  const applePayload = appleVerification.payload;
  ensureTransactionMatches("apple", { ...request, transactionId }, applePayload, env.APPLE_BUNDLE_ID);
  const productId = applePayload.productId ?? request.productId ?? null;
  const resolvedPlan = resolvePlanFromBilling(productId, true);
  if (resolvedPlan === "free") {
    throw new AppError(400, "Unsupported subscription product");
  }
  const plan: Exclude<AccessPlan, "free"> = resolvedPlan;
  const expiresAt = normalizeAppleDateToIso(applePayload.expiresDate);
  const revokedAt = normalizeAppleDateToIso(applePayload.revocationDate);
  const expired = !expiresAt || Date.parse(expiresAt) <= Date.now();
  const status = revokedAt ? "revoked" : expired ? "expired" : "active";

  return {
    originalTransactionId: applePayload.originalTransactionId ?? request.originalTransactionId,
    transactionId: applePayload.transactionId ?? transactionId,
    productId,
    plan,
    active: status === "active",
    periodStart: normalizeAppleDateToIso(applePayload.purchaseDate),
    periodEnd: expiresAt,
    expiresAt,
    revokedAt,
    status,
    verificationEnvironment: appleVerification.environment,
    verificationVersion: appleVerification.verificationVersion,
    payloadDigest: appleVerification.payloadDigest,
    signedDate: normalizeAppleDateToIso(applePayload.signedDate)
  };
}

async function fetchSignedTransactionInfo(
  env: Env,
  transactionId: string
): Promise<{ signedTransactionInfo: string; environment: VerifiedAppleEnvironment }> {
  const { token, debugInfo } = await buildAppStoreServerTokenWithDebug(env);
  const environments = resolveVerificationEnvironments(env.APPLE_APP_STORE_SERVER_ENVIRONMENT);
  let lastStatus = 0;
  let lastError = "Apple transaction verification failed";
  let lastEnvironment: VerifiedAppleEnvironment | null = null;
  let lastErrorDetails: AppleErrorDetails = { reason: lastError };
  const attempts: AppleVerificationAttempt[] = [];

  for (const environment of environments) {
    lastEnvironment = environment;
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
      logEvent("apple_transaction_fetched_for_verification", {
        transactionIdSuffix: suffixForLog(transactionId),
        environment,
        attempts
      });
      return {
        signedTransactionInfo: payload.signedTransactionInfo,
        environment
      };
    }

    lastStatus = response.status;
    lastErrorDetails = await readAppleErrorDetails(response);
    lastError = lastErrorDetails.reason;
    const attempt = {
      environment,
      status: response.status,
      errorCode: lastErrorDetails.errorCode,
      errorName: lastErrorDetails.errorName,
      errorMessage: lastErrorDetails.errorMessage
    };
    attempts.push(attempt);
    logWarnEvent("apple_transaction_verification_attempt_failed", {
      transactionIdSuffix: suffixForLog(transactionId),
      ...attempt,
      appleAuth: buildAppleAuthLog(debugInfo)
    });

    if (!shouldTryNextAppleEnvironment(environment, environments, response.status, lastErrorDetails)) {
      break;
    }
  }

  logWarnEvent("apple_transaction_verification_failed", {
    transactionIdSuffix: suffixForLog(transactionId),
    status: lastStatus,
    reason: lastError,
    environment: lastEnvironment,
    attempts,
    finalFailure: {
      status: lastStatus,
      errorCode: lastErrorDetails.errorCode,
      errorName: lastErrorDetails.errorName,
      errorMessage: lastErrorDetails.errorMessage
    },
    ...(lastStatus === 401
      ? {
          appleAuth: buildAppleAuthLog(debugInfo)
        }
      : {})
  });

  if (lastStatus === 401) {
    throw new AppError(503, "Apple transaction verification is not configured", lastError);
  }
  if (lastStatus === 404 || lastStatus === 400) {
    throw new AppError(400, "Apple transaction could not be verified", lastError);
  }
  throw new AppError(502, "Apple transaction verification failed", lastError);
}

export async function buildAppStoreServerToken(env: Env): Promise<string> {
  return (await buildAppStoreServerTokenWithDebug(env)).token;
}

async function buildAppStoreServerTokenWithDebug(
  env: Env
): Promise<{ token: string; debugInfo: AppStoreServerTokenDebugInfo }> {
  const issuerId = env.APPLE_APP_STORE_ISSUER_ID?.trim();
  const keyId = env.APPLE_APP_STORE_KEY_ID?.trim();
  const privateKey = env.APPLE_APP_STORE_PRIVATE_KEY?.trim();
  const bundleId = env.APPLE_BUNDLE_ID?.trim();

  if (!issuerId || !keyId || !privateKey || !bundleId) {
    logWarnEvent("apple_transaction_verification_config_missing", {
      missing: [
        !issuerId ? "APPLE_APP_STORE_ISSUER_ID" : null,
        !keyId ? "APPLE_APP_STORE_KEY_ID" : null,
        !privateKey ? "APPLE_APP_STORE_PRIVATE_KEY" : null,
        !bundleId ? "APPLE_BUNDLE_ID" : null
      ].filter(Boolean)
    });
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
  const joseSignature = normalizeES256Signature(new Uint8Array(signature));

  return {
    token: `${signingInput}.${base64UrlEncodeBytes(joseSignature)}`,
    debugInfo: {
      keyId,
      issuerIdPrefix: issuerId.slice(0, 8),
      issuerIdHash: await shortSha256Hex(issuerId),
      bundleId,
      headerAlg: header.alg,
      headerKid: header.kid,
      headerTyp: header.typ,
      payloadAud: payload.aud,
      payloadBid: payload.bid,
      signatureBytes: joseSignature.byteLength
    }
  };
}

function ensureTransactionMatches(
  source: "client" | "apple",
  request: CreditPurchaseVerificationRequest | (SubscriptionVerificationRequest & { transactionId: string }),
  payload: ParsedTransactionPayload,
  expectedBundleId?: string
): void {
  if (!payload.transactionId || payload.transactionId !== request.transactionId) {
    throw new AppError(400, "Purchase transaction mismatch", `${source} transactionId mismatch`);
  }
  if (request.productId && payload.productId !== request.productId) {
    throw new AppError(400, "Purchase transaction product mismatch", `${source} productId mismatch`);
  }
  if (request.originalTransactionId && payload.originalTransactionId !== request.originalTransactionId) {
    throw new AppError(400, "Purchase transaction mismatch", `${source} originalTransactionId mismatch`);
  }
  if (expectedBundleId?.trim() && payload.bundleId !== expectedBundleId.trim()) {
    throw new AppError(400, "Purchase transaction bundle mismatch", `${source} bundleId mismatch`);
  }
  if (
    "appAccountToken" in request
    && request.appAccountToken
    && payload.appAccountToken?.toLowerCase() !== request.appAccountToken.toLowerCase()
  ) {
    throw new AppError(409, "Purchase account mismatch", `${source} appAccountToken mismatch`);
  }
}

function normalizeAppleDateToIso(value: number | string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const millis = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isFinite(millis)) {
    return null;
  }

  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolveVerificationEnvironments(rawValue: string | undefined): VerifiedAppleEnvironment[] {
  const normalized = rawValue?.trim().toLowerCase();
  if (normalized === "production") {
    return ["production"];
  }
  if (normalized === "sandbox") {
    return ["sandbox"];
  }
  return ["production", "sandbox"];
}

function shouldTryNextAppleEnvironment(
  environment: VerifiedAppleEnvironment,
  environments: VerifiedAppleEnvironment[],
  status: number,
  errorDetails: AppleErrorDetails
): boolean {
  if (environment !== "production" || !environments.includes("sandbox")) {
    return false;
  }
  if (status === 401) {
    return true;
  }
  if (status === 404 || status === 400) {
    return isAppleTransactionNotFound(errorDetails);
  }
  return false;
}

function isAppleTransactionNotFound(errorDetails: AppleErrorDetails): boolean {
  const normalizedName = errorDetails.errorName?.toLowerCase() ?? "";
  const normalizedMessage = errorDetails.errorMessage?.toLowerCase() ?? "";
  const normalizedReason = errorDetails.reason.toLowerCase();
  return (
    errorDetails.errorCode === 4040010 ||
    String(errorDetails.errorCode) === "4040010" ||
    normalizedName.includes("transactionidnotfound") ||
    normalizedMessage.includes("transactionidnotfound") ||
    normalizedMessage.includes("transaction id not found") ||
    normalizedReason.includes("4040010") ||
    normalizedReason.includes("transactionidnotfound") ||
    normalizedReason.includes("transaction id not found") ||
    normalizedReason.includes("not found")
  );
}

function buildAppleAuthLog(debugInfo: AppStoreServerTokenDebugInfo): Record<string, unknown> {
  return {
    keyId: debugInfo.keyId,
    issuerIdPrefix: debugInfo.issuerIdPrefix,
    issuerIdHash: debugInfo.issuerIdHash,
    bundleId: debugInfo.bundleId,
    headerAlg: debugInfo.headerAlg,
    headerKid: debugInfo.headerKid,
    headerTyp: debugInfo.headerTyp,
    payloadAud: debugInfo.payloadAud,
    payloadBid: debugInfo.payloadBid,
    signatureBytes: debugInfo.signatureBytes
  };
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

function normalizeES256Signature(signature: Uint8Array): Uint8Array {
  if (signature.byteLength === 64) {
    return signature;
  }
  if (signature.byteLength > 0 && signature[0] === 0x30) {
    return derEcdsaSignatureToJose(signature);
  }
  throw new AppError(503, "Apple transaction verification is not configured", "Unsupported ES256 signature format");
}

function derEcdsaSignatureToJose(signature: Uint8Array): Uint8Array {
  let offset = 0;
  if (signature[offset++] !== 0x30) {
    throw new AppError(503, "Apple transaction verification is not configured", "Invalid DER signature sequence");
  }

  const sequenceLength = readDerLength(signature, offset);
  offset = sequenceLength.offset;
  if (sequenceLength.length !== signature.byteLength - offset) {
    throw new AppError(503, "Apple transaction verification is not configured", "Invalid DER signature length");
  }

  const r = readDerInteger(signature, offset);
  offset = r.offset;
  const s = readDerInteger(signature, offset);
  offset = s.offset;
  if (offset !== signature.byteLength) {
    throw new AppError(503, "Apple transaction verification is not configured", "Trailing DER signature bytes");
  }

  const jose = new Uint8Array(64);
  jose.set(normalizeDerIntegerTo32Bytes(r.value), 0);
  jose.set(normalizeDerIntegerTo32Bytes(s.value), 32);
  return jose;
}

function readDerLength(bytes: Uint8Array, offset: number): { length: number; offset: number } {
  const first = bytes[offset++];
  if (first === undefined) {
    throw new AppError(503, "Apple transaction verification is not configured", "Missing DER length");
  }
  if (first < 0x80) {
    return { length: first, offset };
  }

  const byteCount = first & 0x7f;
  if (byteCount < 1 || byteCount > 2 || offset + byteCount > bytes.byteLength) {
    throw new AppError(503, "Apple transaction verification is not configured", "Unsupported DER length");
  }
  let length = 0;
  for (let index = 0; index < byteCount; index += 1) {
    length = (length << 8) | bytes[offset++];
  }
  return { length, offset };
}

function readDerInteger(bytes: Uint8Array, offset: number): { value: Uint8Array; offset: number } {
  if (bytes[offset++] !== 0x02) {
    throw new AppError(503, "Apple transaction verification is not configured", "Missing DER integer");
  }
  const lengthInfo = readDerLength(bytes, offset);
  offset = lengthInfo.offset;
  const end = offset + lengthInfo.length;
  if (lengthInfo.length < 1 || end > bytes.byteLength) {
    throw new AppError(503, "Apple transaction verification is not configured", "Invalid DER integer length");
  }
  return { value: bytes.slice(offset, end), offset: end };
}

function normalizeDerIntegerTo32Bytes(integer: Uint8Array): Uint8Array {
  let value = integer;
  while (value.byteLength > 0 && value[0] === 0x00) {
    value = value.slice(1);
  }
  if (value.byteLength > 32) {
    throw new AppError(503, "Apple transaction verification is not configured", "DER integer is too large for ES256");
  }
  const normalized = new Uint8Array(32);
  normalized.set(value, 32 - value.byteLength);
  return normalized;
}

async function shortSha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest.slice(0, 6))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

async function readAppleErrorDetails(response: Response): Promise<AppleErrorDetails> {
  try {
    const reason = await response.text();
    if (!reason) {
      return { reason: `HTTP ${response.status}` };
    }
    try {
      const payload = JSON.parse(reason) as Record<string, unknown>;
      return {
        reason,
        errorCode: readAppleErrorField(payload, "errorCode") ?? readAppleErrorField(payload, "error_code"),
        errorName: stringOrUndefined(readAppleErrorField(payload, "errorName") ?? readAppleErrorField(payload, "error")),
        errorMessage: stringOrUndefined(
          readAppleErrorField(payload, "errorMessage") ??
            readAppleErrorField(payload, "message") ??
            readAppleErrorField(payload, "error_message")
        )
      };
    } catch {
      return { reason };
    }
  } catch {
    return { reason: `HTTP ${response.status}` };
  }
}

function readAppleErrorField(payload: Record<string, unknown>, key: string): number | string | undefined {
  const value = payload[key];
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

function stringOrUndefined(value: number | string | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}
