import { Buffer } from "node:buffer";
import type {
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload
} from "@apple/app-store-server-library";
import type { Env } from "../env";
import { AppError } from "./errors";
import {
  APPLE_ROOT_CA_G2_DER_BASE64,
  APPLE_ROOT_CA_G3_DER_BASE64
} from "./apple-root-certificates";

export type VerifiedAppleEnvironment = "production" | "sandbox";

const APPLE_LIBRARY_ENVIRONMENT = {
  production: "Production",
  sandbox: "Sandbox"
} as const;

export interface VerifiedAppleSignedData<T> {
  payload: T;
  environment: VerifiedAppleEnvironment;
  payloadDigest: string;
  verificationVersion: "apple-node-library-3.1.0";
}

interface AppleSignedDataVerifierLike {
  verifyAndDecodeTransaction(value: string): Promise<JWSTransactionDecodedPayload>;
  verifyAndDecodeNotification(value: string): Promise<ResponseBodyV2DecodedPayload>;
  verifyAndDecodeRenewalInfo(value: string): Promise<JWSRenewalInfoDecodedPayload>;
}

type AppleVerifierFactory = (
  env: Env,
  environment: VerifiedAppleEnvironment
) => AppleSignedDataVerifierLike;

let testVerifierFactory: AppleVerifierFactory | undefined;

export function setAppleSignedDataVerifierFactoryForTests(factory?: AppleVerifierFactory): void {
  testVerifierFactory = factory;
}

export async function verifyAppleTransactionSignedData(
  env: Env,
  signedTransactionInfo: string,
  expectedEnvironment?: VerifiedAppleEnvironment
): Promise<VerifiedAppleSignedData<JWSTransactionDecodedPayload>> {
  return verifyAcrossAllowedEnvironments(
    env,
    signedTransactionInfo,
    expectedEnvironment,
    (verifier, value) => verifier.verifyAndDecodeTransaction(value),
    "Apple transaction signature verification failed"
  );
}

export async function verifyAppleNotificationSignedData(
  env: Env,
  signedPayload: string,
  expectedEnvironment?: VerifiedAppleEnvironment
): Promise<VerifiedAppleSignedData<ResponseBodyV2DecodedPayload>> {
  return verifyAcrossAllowedEnvironments(
    env,
    signedPayload,
    expectedEnvironment,
    (verifier, value) => verifier.verifyAndDecodeNotification(value),
    "Apple notification signature verification failed"
  );
}

export async function verifyAppleRenewalSignedData(
  env: Env,
  signedRenewalInfo: string,
  expectedEnvironment: VerifiedAppleEnvironment
): Promise<VerifiedAppleSignedData<JWSRenewalInfoDecodedPayload>> {
  return verifyAcrossAllowedEnvironments(
    env,
    signedRenewalInfo,
    expectedEnvironment,
    (verifier, value) => verifier.verifyAndDecodeRenewalInfo(value),
    "Apple renewal signature verification failed"
  );
}

async function verifyAcrossAllowedEnvironments<T>(
  env: Env,
  signedValue: string,
  expectedEnvironment: VerifiedAppleEnvironment | undefined,
  verify: (verifier: AppleSignedDataVerifierLike, value: string) => Promise<T>,
  publicMessage: string
): Promise<VerifiedAppleSignedData<T>> {
  if (!signedValue.trim()) {
    throw new AppError(400, publicMessage);
  }

  const environments = expectedEnvironment
    ? [expectedEnvironment]
    : resolveAllowedVerificationEnvironments(env.APPLE_APP_STORE_SERVER_ENVIRONMENT);
  let lastError: unknown;

  for (const environment of environments) {
    try {
      const payload = await verify(await resolveVerifier(env, environment), signedValue);
      ensureDecodedEnvironmentMatches(payload, environment);
      return {
        payload,
        environment,
        payloadDigest: await sha256Hex(signedValue),
        verificationVersion: "apple-node-library-3.1.0"
      };
    } catch (error) {
      if (error instanceof AppError && error.status >= 500) {
        throw error;
      }
      lastError = error;
    }
  }

  throw new AppError(400, publicMessage, classifyVerificationFailure(lastError));
}

async function resolveVerifier(env: Env, environment: VerifiedAppleEnvironment): Promise<AppleSignedDataVerifierLike> {
  if (testVerifierFactory) {
    return testVerifierFactory(env, environment);
  }

  const bundleId = env.APPLE_BUNDLE_ID?.trim();
  if (!bundleId) {
    throw new AppError(503, "Apple transaction verification is not configured");
  }

  const appAppleId = environment === "production" ? parseProductionAppAppleId(env.APPLE_APP_ID) : undefined;
  // The Apple package pulls in jsrsasign, which performs random initialization
  // when its module is evaluated. Cloudflare rejects that at Worker global
  // scope, so load the verifier only while handling an Apple-signed request.
  const { Environment, SignedDataVerifier } = await import("@apple/app-store-server-library");
  return new SignedDataVerifier(
    [
      Buffer.from(APPLE_ROOT_CA_G2_DER_BASE64, "base64"),
      Buffer.from(APPLE_ROOT_CA_G3_DER_BASE64, "base64")
    ],
    true,
    environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX,
    bundleId,
    appAppleId
  );
}

function resolveAllowedVerificationEnvironments(raw: string | undefined): VerifiedAppleEnvironment[] {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "production") {
    return ["production"];
  }
  if (normalized === "sandbox") {
    return ["sandbox"];
  }
  if (normalized === "auto") {
    return ["production", "sandbox"];
  }
  throw new AppError(503, "Apple transaction verification is not configured");
}

function parseProductionAppAppleId(raw: string | undefined): number {
  const normalized = raw?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) {
    throw new AppError(503, "Apple transaction verification is not configured");
  }
  const value = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(503, "Apple transaction verification is not configured");
  }
  return value;
}

function ensureDecodedEnvironmentMatches(payload: unknown, expected: VerifiedAppleEnvironment): void {
  const decoded = payload as { environment?: unknown };
  if (typeof decoded.environment !== "string") {
    return;
  }
  const expectedAppleValue = APPLE_LIBRARY_ENVIRONMENT[expected];
  if (decoded.environment !== expectedAppleValue) {
    throw new Error("verified_environment_mismatch");
  }
}

function classifyVerificationFailure(error: unknown): string {
  if (error instanceof AppError) {
    return error.internalMessage ?? error.publicMessage;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return "unknown_verification_failure";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
