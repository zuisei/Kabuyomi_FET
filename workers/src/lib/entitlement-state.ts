import type { AccessPlan } from "./billing-catalog";
import type { VerifiedAppleEnvironment } from "./apple-signed-data";

export const ENTITLEMENT_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;
export const ENTITLEMENT_NEAR_EXPIRY_WINDOW_MS = 72 * 60 * 60 * 1_000;
export const ENTITLEMENT_MAX_ACTIVE_BINDINGS = 5;

export type PaidAccessPlan = Exclude<AccessPlan, "free">;
export type ServerEntitlementStatus = "active" | "expired" | "revoked";
export type EntitlementBindingStatus = "active" | "revoked";
export type EntitlementBindingMethod = "verified_sync" | "verified_restore" | "admin_transfer";

export interface EntitlementDeviceBinding {
  bindingHash: string;
  status: EntitlementBindingStatus;
  method: EntitlementBindingMethod;
  boundAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  transferId?: string;
}

export interface ServerEntitlementState {
  stateVersion: 2;
  quotaSubject: string;
  principalKeyVersion: "v1";
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  plan: PaidAccessPlan;
  status: ServerEntitlementStatus;
  periodStart: string | null;
  periodEnd: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  monthlyCredits: number;
  monthlyGrantOperationId: string | null;
  lastVerifiedAt: string;
  verificationEnvironment: VerifiedAppleEnvironment;
  verificationVersion: string;
  verificationPayloadDigest: string;
  signedDate: string | null;
  bindings: EntitlementDeviceBinding[];
  createdAt: string;
  updatedAt: string;
  expiryLoggedAt?: string;
  lastRefreshAttemptAt?: string;
  lastRefreshFailureAt?: string;
}

export interface ActiveEntitlementView {
  plan: PaidAccessPlan;
  quotaSubject: string;
  productId: string;
  syncedAt: string;
  originalTransactionId: string;
  transactionId: string;
  subscriptionPeriodStart: string | null;
  subscriptionPeriodEnd: string | null;
  subscriptionExpiresAt: string | null;
  subscriptionMonthlyCredits: number;
  monthlyGrantOperationId: string | null;
  entitlementStatus: "active";
  lastVerifiedAt: string;
  verificationEnvironment: VerifiedAppleEnvironment;
  verificationVersion: string;
}

export function isEntitlementActiveAt(
  state: Pick<ServerEntitlementState, "status" | "expiresAt" | "revokedAt">,
  nowMs = Date.now()
): boolean {
  if (state.status !== "active" || state.revokedAt) {
    return false;
  }
  const expiresAtMs = Date.parse(state.expiresAt ?? "");
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export function shouldRefreshEntitlement(
  state: Pick<ServerEntitlementState, "lastVerifiedAt" | "expiresAt">,
  nowMs = Date.now()
): boolean {
  const lastVerifiedAtMs = Date.parse(state.lastVerifiedAt);
  const expiresAtMs = Date.parse(state.expiresAt ?? "");
  const stale = !Number.isFinite(lastVerifiedAtMs) || nowMs - lastVerifiedAtMs >= ENTITLEMENT_VERIFICATION_TTL_MS;
  const nearExpiry = Number.isFinite(expiresAtMs) && expiresAtMs - nowMs <= ENTITLEMENT_NEAR_EXPIRY_WINDOW_MS;
  return stale || nearExpiry;
}

export function toActiveEntitlementView(state: ServerEntitlementState): ActiveEntitlementView {
  return {
    plan: state.plan,
    quotaSubject: state.quotaSubject,
    productId: state.productId,
    syncedAt: state.updatedAt,
    originalTransactionId: state.originalTransactionId,
    transactionId: state.transactionId,
    subscriptionPeriodStart: state.periodStart,
    subscriptionPeriodEnd: state.periodEnd,
    subscriptionExpiresAt: state.expiresAt,
    subscriptionMonthlyCredits: state.monthlyCredits,
    monthlyGrantOperationId: state.monthlyGrantOperationId,
    entitlementStatus: "active",
    lastVerifiedAt: state.lastVerifiedAt,
    verificationEnvironment: state.verificationEnvironment,
    verificationVersion: state.verificationVersion
  };
}
