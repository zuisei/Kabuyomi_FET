import type { Env } from "../env";
import { verifySubscriptionWithApple } from "./apple-store-server";
import { resolveSubscriptionMonthlyCredits, type AccessPlan } from "./billing-catalog";
import {
  isEntitlementActiveAt,
  shouldRefreshEntitlement,
  toActiveEntitlementView,
  type ActiveEntitlementView,
  type ServerEntitlementState
} from "./entitlement-state";
import { AppError } from "./errors";
import { hashForLog, logEvent, logWarnEvent } from "./logging";
import {
  buildStableSubscriptionGrantOperationId,
  deriveStableSubscriptionPrincipal
} from "./subscription-principal";
import type { VerifiedAppleEnvironment } from "./apple-signed-data";
import { resolveInstallationCredential } from "./installation-identity";

export const ORIGINAL_TRANSACTION_ID_HEADER = "x-kabuyomi-original-transaction-id";

export interface SyncedEntitlement {
  plan: AccessPlan;
  quotaSubject: string;
  productId: string | null;
  syncedAt: string;
  originalTransactionId?: string;
  transactionId?: string | null;
  subscriptionPeriodStart?: string | null;
  subscriptionPeriodEnd?: string | null;
  subscriptionExpiresAt?: string | null;
  subscriptionMonthlyCredits?: number | null;
  monthlyGrantOperationId?: string | null;
  entitlementStatus: "active" | "inactive";
  lastVerifiedAt?: string;
  verificationEnvironment?: VerifiedAppleEnvironment;
  verificationVersion?: string;
}

export interface PublicBillingSyncRequest {
  originalTransactionId: string;
  transactionId?: string;
  productId?: string;
  active?: boolean;
  signedTransactionInfo?: string;
}

const ENTITLEMENT_DO_URL = "https://do/entitlement";
const DEVICE_BINDING_HEADER = "x-kabuyomi-device-binding";

export async function syncBillingEntitlement(
  env: Env,
  deviceBindingHash: string,
  legacyQuotaSubject: string,
  request: PublicBillingSyncRequest
): Promise<SyncedEntitlement> {
  // One-release compatibility: an explicit legacy inactive claim is read-only.
  // It can neither erase an existing entitlement nor mint a new one.
  if (request.active === false) {
    const existing = await loadEntitlementByOriginalTransaction(
      env,
      request.originalTransactionId,
      deviceBindingHash,
      false
    );
    return existing ?? buildInactiveEntitlement(legacyQuotaSubject);
  }

  if (!request.transactionId && !request.signedTransactionInfo) {
    throw new AppError(400, "Subscription transaction id is required");
  }

  const verified = await verifySubscriptionWithApple(env, {
    originalTransactionId: request.originalTransactionId,
    transactionId: request.transactionId,
    productId: request.productId,
    active: true,
    signedTransactionInfo: request.signedTransactionInfo
  });
  const stablePrincipal = await deriveStableSubscriptionPrincipal(
    env,
    verified.originalTransactionId,
    verified.verificationEnvironment
  );
  const monthlyGrantOperationId =
    verified.status === "active" && verified.productId && verified.periodStart && verified.periodEnd
      ? await buildStableSubscriptionGrantOperationId({
          stablePrincipal: stablePrincipal.quotaSubject,
          productId: verified.productId,
          periodStart: verified.periodStart,
          periodEnd: verified.periodEnd
        })
      : null;
  const now = new Date().toISOString();
  const state = await applyVerifiedEntitlement(env, stablePrincipal.quotaSubject, {
    action: "apply_verified",
    quotaSubject: stablePrincipal.quotaSubject,
    principalKeyVersion: stablePrincipal.keyVersion,
    originalTransactionId: verified.originalTransactionId,
    transactionId: requireVerifiedValue(verified.transactionId, "Verified subscription transaction id is required"),
    productId: requireVerifiedValue(verified.productId, "Verified subscription product is required"),
    plan: requireVerifiedValue(verified.plan, "Verified subscription plan is required"),
    status: verified.status,
    periodStart: verified.periodStart,
    periodEnd: verified.periodEnd,
    expiresAt: verified.expiresAt,
    revokedAt: verified.revokedAt,
    monthlyCredits: resolveSubscriptionMonthlyCredits(verified.productId),
    monthlyGrantOperationId,
    lastVerifiedAt: now,
    verificationEnvironment: verified.verificationEnvironment,
    verificationVersion: verified.verificationVersion,
    verificationPayloadDigest: verified.payloadDigest,
    signedDate: verified.signedDate,
    bindingHash: deviceBindingHash,
    bindingMethod: "verified_restore"
  });

  await persistOpaqueEntitlementIndex(env, state, legacyQuotaSubject, deviceBindingHash);
  if (!isEntitlementActiveAt(state)) {
    return buildInactiveEntitlement(legacyQuotaSubject);
  }
  return toActiveEntitlementView(state);
}

export async function loadActiveEntitlementFromRequest(request: Request, env: Env): Promise<SyncedEntitlement | null> {
  const originalTransactionId = request.headers.get(ORIGINAL_TRANSACTION_ID_HEADER)?.trim();
  if (!originalTransactionId) {
    return null;
  }
  const deviceBindingHash = await resolveDeviceBindingHashFromRequest(request, env);
  return loadEntitlementByOriginalTransaction(env, originalTransactionId, deviceBindingHash, true);
}

export async function resolveDeviceBindingHashFromRequest(request: Request, env: Env): Promise<string> {
  const installation = await resolveInstallationCredential(request, env);
  if (installation) {
    return sha256Hex(`entitlement-installation:${installation.principal}`);
  }
  const deviceKey = request.headers.get("x-device-key")?.trim();
  if (!deviceKey) {
    throw new AppError(400, "Device key is required");
  }
  return sha256Hex(`entitlement-device:${deviceKey}`);
}

export async function resolveDeviceQuotaSubjectFromRequest(request: Request, env: Env): Promise<string> {
  const installation = await resolveInstallationCredential(request, env);
  if (installation) {
    return installation.principal;
  }
  const deviceKey = request.headers.get("x-device-key")?.trim();
  if (!deviceKey) {
    throw new AppError(400, "Device key is required");
  }
  if (isLocalQuotaFallbackRequest(request)) {
    return `free:local:${deviceKey}`;
  }
  return `free:device:${await sha256Hex(`free-device:${deviceKey}`)}`;
}

async function loadEntitlementByOriginalTransaction(
  env: Env,
  originalTransactionId: string,
  bindingHash: string,
  refreshWhenRequired: boolean
): Promise<ActiveEntitlementView | null> {
  let candidates: Array<{ quotaSubject: string; environment: VerifiedAppleEnvironment }>;
  try {
    candidates = await derivePrincipalCandidates(env, originalTransactionId);
  } catch (error) {
    logWarnEvent("entitlement_principal_lookup_failed_closed", {
      errorClass: error instanceof Error ? error.name : typeof error
    });
    return null;
  }

  for (const candidate of candidates) {
    let state: ServerEntitlementState;
    try {
      state = await fetchEntitlementState(env, candidate.quotaSubject, bindingHash);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        continue;
      }
      throw error;
    }
    if (!isEntitlementActiveAt(state)) {
      return null;
    }
    if (!refreshWhenRequired || !shouldRefreshEntitlement(state)) {
      return toActiveEntitlementView(state);
    }
    return refreshStoredEntitlement(env, state, bindingHash);
  }
  return null;
}

async function refreshStoredEntitlement(
  env: Env,
  current: ServerEntitlementState,
  bindingHash: string
): Promise<ActiveEntitlementView | null> {
  try {
    const refreshed = await syncBillingEntitlement(env, bindingHash, current.quotaSubject, {
      originalTransactionId: current.originalTransactionId,
      transactionId: current.transactionId,
      productId: current.productId
    });
    return refreshed.entitlementStatus === "active" ? refreshed as ActiveEntitlementView : null;
  } catch (error) {
    const transient = error instanceof AppError && error.status >= 500;
    if (transient && isEntitlementActiveAt(current)) {
      await recordRefreshFailureSafely(env, current.quotaSubject, bindingHash);
      logWarnEvent("entitlement_refresh_transient_grace", {
        quotaSubjectHash: hashForLog(current.quotaSubject),
        expiresAt: current.expiresAt,
        errorStatus: error.status
      });
      return toActiveEntitlementView(current);
    }
    logWarnEvent("entitlement_refresh_failed_closed", {
      quotaSubjectHash: hashForLog(current.quotaSubject),
      errorStatus: error instanceof AppError ? error.status : 500,
      errorClass: error instanceof Error ? error.name : typeof error
    });
    return null;
  }
}

async function applyVerifiedEntitlement(
  env: Env,
  quotaSubject: string,
  mutation: Record<string, unknown>
): Promise<ServerEntitlementState> {
  const response = await env.ENTITLEMENT.getByName(quotaSubject).fetch(
    new Request(ENTITLEMENT_DO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mutation)
    })
  );
  const payload = (await response.json()) as ServerEntitlementState & { error?: string };
  if (!response.ok) {
    throw new AppError(response.status, payload.error ?? "Entitlement mutation failed");
  }
  return payload;
}

async function fetchEntitlementState(
  env: Env,
  quotaSubject: string,
  bindingHash: string
): Promise<ServerEntitlementState> {
  const response = await env.ENTITLEMENT.getByName(quotaSubject).fetch(
    new Request(ENTITLEMENT_DO_URL, {
      method: "GET",
      headers: { [DEVICE_BINDING_HEADER]: bindingHash }
    })
  );
  const payload = (await response.json()) as ServerEntitlementState & { error?: string };
  if (!response.ok) {
    throw new AppError(response.status, payload.error ?? "Entitlement lookup failed");
  }
  return payload;
}

async function recordRefreshFailureSafely(env: Env, quotaSubject: string, bindingHash: string): Promise<void> {
  try {
    await applyVerifiedEntitlement(env, quotaSubject, {
      action: "record_refresh_failure",
      failureAt: new Date().toISOString(),
      bindingHash
    });
  } catch (error) {
    logWarnEvent("entitlement_refresh_failure_record_failed", {
      quotaSubjectHash: hashForLog(quotaSubject),
      errorClass: error instanceof Error ? error.name : typeof error
    });
  }
}

async function derivePrincipalCandidates(
  env: Env,
  originalTransactionId: string
): Promise<Array<{ quotaSubject: string; environment: VerifiedAppleEnvironment }>> {
  const configured = env.APPLE_APP_STORE_SERVER_ENVIRONMENT?.trim().toLowerCase();
  const environments: VerifiedAppleEnvironment[] = configured === "production"
    ? ["production"]
    : configured === "sandbox"
      ? ["sandbox"]
      : configured === "auto"
        ? ["production", "sandbox"]
        : [];
  if (environments.length === 0) {
    throw new AppError(503, "Subscription principal lookup is not configured");
  }
  return Promise.all(
    environments.map(async (environment) => ({
      ...(await deriveStableSubscriptionPrincipal(env, originalTransactionId, environment)),
      environment
    }))
  );
}

async function persistOpaqueEntitlementIndex(
  env: Env,
  state: ServerEntitlementState,
  legacyQuotaSubject: string,
  bindingHash: string
): Promise<void> {
  if (!env.DB?.prepare) {
    return;
  }
  const now = new Date().toISOString();
  const entitlementKey = `entitlement:v1:${await sha256Hex(`entitlement-index:${state.quotaSubject}`)}`;
  const opaqueLegacySubject = `legacy:v1:${await sha256Hex(`legacy-quota:${legacyQuotaSubject}`)}`;
  try {
    await env.DB.prepare(
      `INSERT INTO subscription_entitlement_index (
        entitlement_key, stable_principal, principal_key_version, legacy_quota_subject,
        environment, status, product_id, period_start, period_end, expires_at,
        last_verified_at, verification_version, migration_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entitlement_key) DO UPDATE SET
        stable_principal = excluded.stable_principal,
        principal_key_version = excluded.principal_key_version,
        legacy_quota_subject = COALESCE(subscription_entitlement_index.legacy_quota_subject, excluded.legacy_quota_subject),
        environment = excluded.environment,
        status = excluded.status,
        product_id = excluded.product_id,
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        expires_at = excluded.expires_at,
        last_verified_at = excluded.last_verified_at,
        verification_version = excluded.verification_version,
        updated_at = excluded.updated_at`
    ).bind(
      entitlementKey,
      state.quotaSubject,
      state.principalKeyVersion,
      opaqueLegacySubject,
      state.verificationEnvironment,
      state.status,
      state.productId,
      state.periodStart,
      state.periodEnd,
      state.expiresAt,
      state.lastVerifiedAt,
      state.verificationVersion,
      "pending",
      state.createdAt,
      now
    ).run();
    const binding = state.bindings.find((candidate) => candidate.bindingHash === bindingHash);
    if (binding) {
      await env.DB.prepare(
        `INSERT INTO subscription_device_bindings (
          entitlement_key, binding_hash, status, method, bound_at, last_seen_at, revoked_at, transfer_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entitlement_key, binding_hash) DO UPDATE SET
          status = excluded.status,
          method = excluded.method,
          last_seen_at = excluded.last_seen_at,
          revoked_at = excluded.revoked_at,
          transfer_id = excluded.transfer_id`
      ).bind(
        entitlementKey,
        binding.bindingHash,
        binding.status,
        binding.method,
        binding.boundAt,
        binding.lastSeenAt,
        binding.revokedAt ?? null,
        binding.transferId ?? null
      ).run();
    }
  } catch (error) {
    logWarnEvent("subscription_entitlement_index_write_failed", {
      quotaSubjectHash: hashForLog(state.quotaSubject),
      errorClass: error instanceof Error ? error.name : typeof error
    });
  }
}

function buildInactiveEntitlement(quotaSubject: string): SyncedEntitlement {
  return {
    plan: "free",
    quotaSubject,
    productId: null,
    syncedAt: new Date().toISOString(),
    transactionId: null,
    subscriptionPeriodStart: null,
    subscriptionPeriodEnd: null,
    subscriptionExpiresAt: null,
    subscriptionMonthlyCredits: null,
    monthlyGrantOperationId: null,
    entitlementStatus: "inactive"
  };
}

function requireVerifiedValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined || value === "") {
    throw new AppError(400, message);
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isLocalQuotaFallbackRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname.endsWith(".test");
}
