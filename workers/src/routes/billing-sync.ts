import { BillingSyncRequestSchema } from "../lib/contracts";
import { isAppError } from "../lib/errors";
import { loadUsage, type QuotaIdentity } from "../lib/quota";
import { logEvent } from "../lib/logging";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import { isCreditBillingEnabledForIdentity } from "../lib/remote-config";
import {
  resolveDeviceBindingHashFromRequest,
  resolveDeviceQuotaSubjectFromRequest,
  syncBillingEntitlement
} from "../lib/entitlements";
import type { RouteHandler } from "./types";

const BILLING_SYNC_PAYLOAD_MAX_BYTES = 20_000;

export const handleBillingSyncRoute: RouteHandler = async ({ request, url, env, config }) => {
  const isBillingSyncRoute = url.pathname === "/v1/billing/sync" || url.pathname === "/v1/ios/subscriptions/sync";
  if (!(request.method === "POST" && isBillingSyncRoute)) {
    return null;
  }

  let body;
  try {
    body = await parseJsonBody(request, BillingSyncRequestSchema, {
      invalidMessage: "Invalid billing sync payload",
      maxBytes: BILLING_SYNC_PAYLOAD_MAX_BYTES,
      tooLargeMessage: "Billing sync payload is too large"
    });
  } catch (error) {
    if (!isAppError(error)) {
      throw error;
    }
    return json({ error: error.publicMessage }, { status: error.status });
  }

  let deviceBindingHash;
  let boundQuotaSubject;
  try {
    deviceBindingHash = await resolveDeviceBindingHashFromRequest(request);
    boundQuotaSubject = await resolveDeviceQuotaSubjectFromRequest(request);
  } catch (error) {
    if (!isAppError(error)) {
      throw error;
    }
    return json({ error: error.publicMessage }, { status: error.status });
  }

  const payload = await syncBillingEntitlement(env, deviceBindingHash, boundQuotaSubject, body);
  const identity: QuotaIdentity = {
    quotaSubject: payload.quotaSubject,
    plan: payload.plan,
    identityKind: payload.plan === "free" ? "device_key" : "entitlement",
    activeSubscription:
      payload.plan === "free"
        ? undefined
        : {
            originalTransactionId: payload.originalTransactionId,
            transactionId: payload.transactionId,
            productId: payload.productId,
            periodStart: payload.subscriptionPeriodStart,
            periodEnd: payload.subscriptionPeriodEnd,
            expiresAt: payload.subscriptionExpiresAt,
            monthlyCredits: payload.subscriptionMonthlyCredits,
            monthlyGrantOperationId: payload.monthlyGrantOperationId
          }
  };
  const usage = await loadUsage(identity, env, config);
  logEvent("billing_sync_succeeded", {
    path: url.pathname,
    plan: payload.plan,
    productId: payload.productId ?? "nil",
    subscriptionPeriodStart: payload.subscriptionPeriodStart ?? "nil",
    subscriptionPeriodEnd: payload.subscriptionPeriodEnd ?? "nil"
  });
  return json({
    ...payload,
    activePlan: payload.plan === "free" ? null : payload.plan,
    activeSubscription:
      payload.plan === "free"
        ? null
        : {
            plan: payload.plan,
            productId: payload.productId,
            originalTransactionId: payload.originalTransactionId,
            transactionId: payload.transactionId,
            periodStart: payload.subscriptionPeriodStart,
            periodEnd: payload.subscriptionPeriodEnd,
            expiresAt: payload.subscriptionExpiresAt,
            monthlyCredits: payload.subscriptionMonthlyCredits
          },
    creditBillingEnabled: isCreditBillingEnabledForIdentity(config, identity),
    usage
  });
};
