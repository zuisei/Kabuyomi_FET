import { loadUsage, readQuotaIdentity } from "../lib/quota";
import type { Env } from "../env";
import type { RemoteConfig } from "../lib/remote-config";
import { isCreditBillingEnabledForIdentity } from "../lib/remote-config";
import { premiumChatModelEnabled } from "../lib/chat/premium-model";
import { json } from "../lib/response";
import type { RouteHandler } from "./types";
import { buildRewardedCreditCapability } from "./admob-rewards";

export const handleUsageRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "GET" && url.pathname === "/v1/usage")) {
    return null;
  }

  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const usage = await loadUsage(identity, env, config);
  const runtime = resolveBillingRuntimeCapabilities(env, config);
  const payload: Record<string, unknown> = {
    ...usage,
    creditBillingEnabled: runtime.creditBillingEnabled && isCreditBillingEnabledForIdentity(config, identity),
    capabilities: {
      configVersion: config.configVersion,
      configSource: config.configSource,
      chatEnabled: config.chatEnabled,
      webSupplementEnabled: config.webSupplementEnabled,
      consumablePurchasesEnabled: runtime.consumablePurchasesEnabled,
      accountRecoveryReady: runtime.accountRecoveryReady,
      premiumChatModelEnabled: premiumChatModelEnabled(env),
      rewardedCredit: await buildRewardedCreditCapability(env, config, identity)
    }
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

export function resolveBillingRuntimeCapabilities(
  env: Env,
  config: Pick<RemoteConfig,
    "creditBillingEnabled" | "consumablePurchasesEnabled" | "accountRecoveryReady" | "emergencyPaidGrantsDisabled">
) {
  const appleServerReady = [
    env.APPLE_APP_STORE_ISSUER_ID,
    env.APPLE_APP_STORE_KEY_ID,
    env.APPLE_APP_STORE_PRIVATE_KEY,
    env.APPLE_BUNDLE_ID,
    env.SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1
  ].every(nonEmpty) && appleVerificationEnvironmentReady(env);
  const accountSecretsReady = [
    env.ACCOUNT_PRINCIPAL_HMAC_KEY_V1,
    env.ACCOUNT_SESSION_HMAC_KEY_V1,
    env.APPLE_SIGN_IN_CLIENT_ID ?? env.APPLE_BUNDLE_ID
  ].every(nonEmpty);
  const creditBillingEnabled = config.creditBillingEnabled && !config.emergencyPaidGrantsDisabled && appleServerReady;
  const accountRecoveryReady = config.accountRecoveryReady && accountSecretsReady;
  return {
    creditBillingEnabled,
    accountRecoveryReady,
    consumablePurchasesEnabled:
      creditBillingEnabled &&
      config.consumablePurchasesEnabled &&
      (!config.accountRecoveryReady || accountRecoveryReady)
  };
}

function nonEmpty(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function positiveInteger(value: string | undefined): boolean {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/u.test(normalized)) return false;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function appleVerificationEnvironmentReady(env: Env): boolean {
  const environment = env.APPLE_APP_STORE_SERVER_ENVIRONMENT?.trim().toLowerCase();
  if (environment === "sandbox") return true;
  if (environment === "production" || environment === "auto") {
    return positiveInteger(env.APPLE_APP_ID);
  }
  return false;
}
