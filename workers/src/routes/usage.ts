import { loadUsage, readQuotaIdentity } from "../lib/quota";
import { isCreditBillingEnabledForIdentity } from "../lib/remote-config";
import { json } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleUsageRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "GET" && url.pathname === "/v1/usage")) {
    return null;
  }

  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const usage = await loadUsage(identity, env, config);
  const payload: Record<string, unknown> = {
    ...usage,
    creditBillingEnabled: isCreditBillingEnabledForIdentity(config, identity)
  };
  if (identity.activeSubscription) {
    payload.activePlan = identity.plan;
    payload.activeSubscription = {
      plan: identity.plan,
      productId: identity.activeSubscription.productId,
      originalTransactionId: identity.activeSubscription.originalTransactionId,
      transactionId: identity.activeSubscription.transactionId,
      periodStart: identity.activeSubscription.periodStart,
      periodEnd: identity.activeSubscription.periodEnd,
      expiresAt: identity.activeSubscription.expiresAt,
      monthlyCredits: identity.activeSubscription.monthlyCredits
    };
  }
  return json(payload);
};
