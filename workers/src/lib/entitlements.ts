import type { Env } from "../env";
import { verifySubscriptionWithApple } from "./apple-store-server";
import { AppError } from "./errors";
import { logErrorEvent } from "./logging";
import { resolvePlanFromBilling, type AccessPlan } from "./billing-catalog";

export const ORIGINAL_TRANSACTION_ID_HEADER = "x-kabuyomi-original-transaction-id";

export interface SyncedEntitlement {
  plan: AccessPlan;
  quotaSubject: string;
  productId: string | null;
  syncedAt: string;
  boundDeviceHash?: string;
}

const ENTITLEMENT_DO_URL = "https://do/entitlement";
const DEVICE_BINDING_HEADER = "x-kabuyomi-device-binding";

export async function syncBillingEntitlement(
  env: Env,
  deviceBindingHash: string,
  request: {
    originalTransactionId: string;
    transactionId?: string;
    productId?: string;
    active: boolean;
    signedTransactionInfo?: string;
  }
): Promise<SyncedEntitlement> {
  let verifiedRequest: {
    originalTransactionId: string;
    productId?: string;
    active: boolean;
    serverVerified: boolean;
    boundDeviceHash?: string;
  } = {
    originalTransactionId: request.originalTransactionId,
    productId: request.productId,
    active: request.active,
    serverVerified: false
  };

  if (request.active) {
    const verified = await verifySubscriptionWithApple(env, request);
    verifiedRequest = {
      originalTransactionId: verified.originalTransactionId,
      productId: verified.productId ?? undefined,
      active: verified.active,
      serverVerified: true,
      boundDeviceHash: deviceBindingHash
    };
  }

  return fetchEntitlementRecord(
    env,
    verifiedRequest.originalTransactionId,
    new Request(ENTITLEMENT_DO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DEVICE_BINDING_HEADER]: deviceBindingHash
      },
      body: JSON.stringify({
        ...verifiedRequest,
        boundDeviceHash: deviceBindingHash
      })
    }),
    "billing_sync_failed"
  );
}

export async function loadActiveEntitlementFromRequest(request: Request, env: Env): Promise<SyncedEntitlement | null> {
  const originalTransactionId = request.headers.get(ORIGINAL_TRANSACTION_ID_HEADER)?.trim();
  if (!originalTransactionId) {
    return null;
  }
  const deviceBindingHash = await resolveDeviceBindingHashFromRequest(request);

  try {
    const payload = await fetchEntitlementRecord(
      env,
      originalTransactionId,
      new Request(ENTITLEMENT_DO_URL, {
        method: "GET",
        headers: {
          [DEVICE_BINDING_HEADER]: deviceBindingHash
        }
      }),
      "entitlement_lookup_failed"
    );
    return payload.plan === "free" ? null : payload;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function buildSyncedEntitlement(
  originalTransactionId: string,
  productId: string | null | undefined,
  active: boolean,
  options: { serverVerified?: boolean; boundDeviceHash?: string } = {}
): Promise<SyncedEntitlement> {
  const serverVerified = options.serverVerified === true;
  const trustedActive = serverVerified ? active : false;
  const trustedProductId = serverVerified ? productId : null;
  const plan = resolvePlanFromBilling(trustedProductId, trustedActive);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(originalTransactionId));
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");

  return {
    plan,
    quotaSubject: `${plan}:${hex}`,
    productId: trustedProductId ?? null,
    syncedAt: new Date().toISOString(),
    boundDeviceHash: options.boundDeviceHash
  };
}

export async function resolveDeviceBindingHashFromRequest(request: Request): Promise<string> {
  const deviceKey = request.headers.get("x-device-key")?.trim();
  if (!deviceKey) {
    throw new AppError(400, "Device key is required");
  }

  return sha256Hex(`entitlement-device:${deviceKey}`);
}

export function readDeviceBindingHash(request: Request): string | null {
  return request.headers.get(DEVICE_BINDING_HEADER)?.trim() || null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchEntitlementRecord(
  env: Env,
  originalTransactionId: string,
  request: Request,
  errorEvent: string
): Promise<SyncedEntitlement> {
  try {
    const response = await env.ENTITLEMENT.getByName(originalTransactionId).fetch(request);
    const payload = (await response.json()) as SyncedEntitlement & { error?: string };

    if (!response.ok) {
      throw new AppError(response.status, payload.error ?? "Entitlement request failed");
    }

    return payload;
  } catch (error) {
    logErrorEvent(errorEvent, {
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
