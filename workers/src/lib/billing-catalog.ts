import type { RemoteConfig } from "./remote-config";

export type AccessPlan = "free" | "lite" | "pro";
export type CreditPlan = AccessPlan;

export interface PlanLimits {
  chatLimit: number;
  stockLimit: number;
}

export const LITE_PRODUCT_IDS = new Set(["app.kabuyomi.lite.monthly"]);
export const PRO_PRODUCT_IDS = new Set(["app.kabuyomi.pro.monthly"]);

export const CREDIT_PACK_PRODUCTS = {
  credit_pack_100: 100,
  credit_pack_300: 300,
  credit_pack_700: 700
} as const;

export type CreditPackProductId = keyof typeof CREDIT_PACK_PRODUCTS;

export function resolvePlanFromBilling(productId: string | null | undefined, active: boolean): AccessPlan {
  if (!active) {
    return "free";
  }

  if (productId && LITE_PRODUCT_IDS.has(productId)) {
    return "lite";
  }

  if (productId && PRO_PRODUCT_IDS.has(productId)) {
    return "pro";
  }

  return "free";
}

export function resolveCreditPackCredits(productId: string): number | null {
  return isCreditPackProductId(productId) ? CREDIT_PACK_PRODUCTS[productId] : null;
}

export function resolveMonthlyCreditLimit(plan: AccessPlan, config: RemoteConfig): number {
  return config.planCredits[plan];
}

export function resolvePlanLimits(plan: AccessPlan, config: RemoteConfig): PlanLimits {
  if (plan === "pro") {
    return {
      chatLimit: config.proDailyChatLimit,
      stockLimit: config.proStockLimit
    };
  }

  if (plan === "lite") {
    return {
      chatLimit: config.freeDailyChatLimit,
      stockLimit: config.freeStockLimit
    };
  }

  return {
    chatLimit: config.freeDailyChatLimit,
    stockLimit: config.freeStockLimit
  };
}

function isCreditPackProductId(productId: string): productId is CreditPackProductId {
  return Object.prototype.hasOwnProperty.call(CREDIT_PACK_PRODUCTS, productId);
}
