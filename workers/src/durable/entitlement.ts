import type { DurableObjectState } from "@cloudflare/workers-types";
import type { z } from "zod";
import { VerifiedEntitlementMutationSchema } from "../lib/contracts";
import {
  ENTITLEMENT_MAX_ACTIVE_BINDINGS,
  isEntitlementActiveAt,
  type EntitlementDeviceBinding,
  type ServerEntitlementState
} from "../lib/entitlement-state";
import { isAppError } from "../lib/errors";
import { hashForLog, logEvent } from "../lib/logging";
import { parseJsonBody } from "../lib/request";
import { resolvePlanFromBilling } from "../lib/billing-catalog";

const ENTITLEMENT_PAYLOAD_MAX_BYTES = 20_000;
const CURRENT_ENTITLEMENT_KEY = "current:v2";

type VerifiedEntitlementMutation = z.infer<typeof VerifiedEntitlementMutationSchema>;

export class EntitlementDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return this.serialized(() => this.readActiveEntitlement(request));
    }
    if (request.method !== "POST") {
      return this.reply({ error: "Method not allowed" }, 405, { allow: "GET, POST" });
    }

    let body: VerifiedEntitlementMutation;
    try {
      body = await parseJsonBody(request, VerifiedEntitlementMutationSchema, {
        invalidMessage: "Invalid verified entitlement payload",
        maxBytes: ENTITLEMENT_PAYLOAD_MAX_BYTES,
        tooLargeMessage: "Verified entitlement payload is too large"
      });
    } catch (error) {
      if (!isAppError(error)) {
        throw error;
      }
      return this.reply({ error: error.publicMessage }, error.status);
    }

    return this.serialized(async () => {
      if (body.action === "apply_verified" || body.action === "apply_verified_notification") {
        return this.applyVerifiedEntitlement(body);
      }
      if (body.action === "record_refresh_failure") {
        return this.recordRefreshFailure(body);
      }
      return this.revokeBinding(body);
    });
  }

  private async readActiveEntitlement(request: Request): Promise<Response> {
    const current = await this.loadCurrent();
    if (!current) {
      return this.reply({ error: "Entitlement not found" }, 404);
    }

    const bindingHash = request.headers.get("x-kabuyomi-device-binding")?.trim();
    const binding = current.bindings.find((candidate) => candidate.bindingHash === bindingHash);
    if (!binding || binding.status !== "active") {
      return this.reply({ error: "Entitlement device binding mismatch" }, 403);
    }

    const nowMs = Date.now();
    if (!isEntitlementActiveAt(current, nowMs)) {
      if (current.status === "active") {
        const expiredAt = new Date(nowMs).toISOString();
        current.status = "expired";
        current.updatedAt = expiredAt;
        if (!current.expiryLoggedAt) {
          current.expiryLoggedAt = expiredAt;
          logEvent("entitlement_expired_on_read", {
            quotaSubjectHash: hashForLog(current.quotaSubject),
            verificationEnvironment: current.verificationEnvironment
          });
        }
        await this.saveCurrent(current);
      }
      return this.reply({ error: "Entitlement is not active" }, 404);
    }

    binding.lastSeenAt = new Date(nowMs).toISOString();
    current.updatedAt = binding.lastSeenAt;
    await this.saveCurrent(current);
    return this.reply(current, 200);
  }

  private async applyVerifiedEntitlement(
    body: Extract<VerifiedEntitlementMutation, { action: "apply_verified" | "apply_verified_notification" }>
  ): Promise<Response> {
    if (this.state.id?.name && this.state.id.name !== body.quotaSubject) {
      return this.reply({ error: "Entitlement principal mismatch" }, 409);
    }
    const verifiedPlan = resolvePlanFromBilling(body.productId, true);
    if (verifiedPlan === "free" || verifiedPlan !== body.plan) {
      return this.reply({ error: "Verified entitlement product mismatch" }, 409);
    }

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const effectiveStatus = body.revokedAt
      ? "revoked"
      : body.status === "active" && body.expiresAt && Date.parse(body.expiresAt) > nowMs
        ? "active"
        : "expired";
    const current = await this.loadCurrent();

    if (current) {
      if (
        current.quotaSubject !== body.quotaSubject ||
        current.originalTransactionId !== body.originalTransactionId ||
        current.verificationEnvironment !== body.verificationEnvironment
      ) {
        return this.reply({ error: "Verified entitlement lineage mismatch" }, 409);
      }
      if (current.status === "revoked" && effectiveStatus !== "revoked") {
        return this.reply({ error: "Revoked entitlement cannot be reactivated" }, 409);
      }
    }

    const bindings = current?.bindings.map((binding) => ({ ...binding })) ?? [];
    if (body.action === "apply_verified") {
      const bindingResult = addOrRefreshVerifiedBinding(bindings, body.bindingHash, body.bindingMethod, now);
      if (bindingResult === "revoked") {
        return this.reply({ error: "Revoked device binding requires an explicit transfer" }, 409);
      }
      if (bindingResult === "limit") {
        return this.reply({ error: "Entitlement device binding limit reached" }, 409);
      }
    }

    const incomingIsOlder = Boolean(
      current && compareVerificationOrder(body.signedDate, body.lastVerifiedAt, current.signedDate, current.lastVerifiedAt) < 0
    );
    const canonicalPeriodStart = canonicalizeSubscriptionPeriodStart(current, body, effectiveStatus);
    const next: ServerEntitlementState = incomingIsOlder && current
      ? {
          ...current,
          bindings,
          updatedAt: now
        }
      : {
          stateVersion: 2,
          quotaSubject: body.quotaSubject,
          principalKeyVersion: body.principalKeyVersion,
          originalTransactionId: body.originalTransactionId,
          transactionId: body.transactionId,
          productId: body.productId,
          plan: body.plan,
          status: effectiveStatus,
          periodStart: canonicalPeriodStart,
          periodEnd: body.periodEnd,
          expiresAt: body.expiresAt,
          revokedAt: body.revokedAt,
          monthlyCredits: body.monthlyCredits,
          monthlyGrantOperationId: body.monthlyGrantOperationId,
          lastVerifiedAt: body.lastVerifiedAt,
          verificationEnvironment: body.verificationEnvironment,
          verificationVersion: body.verificationVersion,
          verificationPayloadDigest: body.verificationPayloadDigest,
          signedDate: body.signedDate,
          bindings,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          expiryLoggedAt: effectiveStatus === "expired" ? current?.expiryLoggedAt ?? now : undefined,
          lastRefreshAttemptAt: body.lastVerifiedAt,
          lastRefreshFailureAt: undefined
        };

    await this.saveCurrent(next);
    logEvent("verified_entitlement_applied", {
      quotaSubjectHash: hashForLog(next.quotaSubject),
      bindingHash: body.action === "apply_verified" ? hashForLog(body.bindingHash) : "notification",
      plan: next.plan,
      entitlementStatus: next.status,
      verificationEnvironment: next.verificationEnvironment,
      activeBindingCount: next.bindings.filter((binding) => binding.status === "active").length
    });
    return this.reply(next, 200);
  }

  private async recordRefreshFailure(
    body: Extract<VerifiedEntitlementMutation, { action: "record_refresh_failure" }>
  ): Promise<Response> {
    const current = await this.loadCurrent();
    if (!current) {
      return this.reply({ error: "Entitlement not found" }, 404);
    }
    const binding = current.bindings.find(
      (candidate) => candidate.bindingHash === body.bindingHash && candidate.status === "active"
    );
    if (!binding) {
      return this.reply({ error: "Entitlement device binding mismatch" }, 403);
    }
    current.lastRefreshAttemptAt = body.failureAt;
    current.lastRefreshFailureAt = body.failureAt;
    current.updatedAt = body.failureAt;
    await this.saveCurrent(current);
    return this.reply({ status: "recorded" }, 200);
  }

  private async revokeBinding(
    body: Extract<VerifiedEntitlementMutation, { action: "revoke_binding" }>
  ): Promise<Response> {
    const current = await this.loadCurrent();
    if (!current) {
      return this.reply({ error: "Entitlement not found" }, 404);
    }
    const binding = current.bindings.find((candidate) => candidate.bindingHash === body.bindingHash);
    if (!binding) {
      return this.reply({ error: "Entitlement device binding not found" }, 404);
    }
    if (binding.status === "active") {
      binding.status = "revoked";
      binding.revokedAt = body.revokedAt;
      binding.transferId = body.transferId;
      current.updatedAt = body.revokedAt;
      await this.saveCurrent(current);
    }
    return this.reply({ status: binding.status }, 200);
  }

  private loadCurrent(): Promise<ServerEntitlementState | undefined> {
    return this.state.storage.get<ServerEntitlementState>(CURRENT_ENTITLEMENT_KEY);
  }

  private saveCurrent(value: ServerEntitlementState): Promise<void> {
    return this.state.storage.put(CURRENT_ENTITLEMENT_KEY, value);
  }

  private serialized<T>(callback: () => Promise<T>): Promise<T> {
    const state = this.state as DurableObjectState & {
      blockConcurrencyWhile?<R>(callback: () => Promise<R>): Promise<R>;
    };
    return state.blockConcurrencyWhile ? state.blockConcurrencyWhile(callback) : callback();
  }

  private reply(payload: unknown, status: number, extraHeaders?: Record<string, string>): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...extraHeaders
      }
    });
  }
}

function canonicalizeSubscriptionPeriodStart(
  current: ServerEntitlementState | undefined,
  incoming: Extract<VerifiedEntitlementMutation, { action: "apply_verified" | "apply_verified_notification" }>,
  effectiveStatus: ServerEntitlementState["status"]
): string | null {
  if (
    !current || effectiveStatus !== "active" || current.status !== "active" ||
    !current.periodStart || !current.periodEnd || !incoming.periodStart || !incoming.periodEnd ||
    current.periodEnd !== incoming.periodEnd
  ) {
    return incoming.periodStart;
  }

  // StoreKit can issue a new purchaseDate for an immediate upgrade or
  // downgrade while keeping the same renewal boundary. Treat that as the same
  // subscription cycle so quota applies only the plan delta, not a second full
  // monthly grant.
  return Date.parse(current.periodStart) <= Date.parse(incoming.periodStart)
    ? current.periodStart
    : incoming.periodStart;
}

function addOrRefreshVerifiedBinding(
  bindings: EntitlementDeviceBinding[],
  bindingHash: string,
  method: EntitlementDeviceBinding["method"],
  now: string
): "added" | "refreshed" | "revoked" | "limit" {
  const existing = bindings.find((binding) => binding.bindingHash === bindingHash);
  if (existing) {
    if (existing.status !== "active") {
      return "revoked";
    }
    existing.lastSeenAt = now;
    existing.method = method;
    return "refreshed";
  }
  if (bindings.filter((binding) => binding.status === "active").length >= ENTITLEMENT_MAX_ACTIVE_BINDINGS) {
    return "limit";
  }
  bindings.push({
    bindingHash,
    status: "active",
    method,
    boundAt: now,
    lastSeenAt: now
  });
  return "added";
}

function compareVerificationOrder(
  incomingSignedDate: string | null,
  incomingVerifiedAt: string,
  currentSignedDate: string | null,
  currentVerifiedAt: string
): number {
  const incoming = Date.parse(incomingSignedDate ?? incomingVerifiedAt);
  const current = Date.parse(currentSignedDate ?? currentVerifiedAt);
  return incoming - current;
}
