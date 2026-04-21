import type { RemoteConfig } from "./remote-config";

export type AccessPlan = "free" | "pro";

export interface PlanLimits {
  chatLimit: number;
  stockLimit: number;
}

export const PRO_PRODUCT_IDS = new Set(["app.kabuyomi.pro.monthly"]);

export function resolvePlanFromBilling(productId: string | null | undefined, active: boolean): AccessPlan {
  if (!active) {
    return "free";
  }

  if (productId && PRO_PRODUCT_IDS.has(productId)) {
    return "pro";
  }

  return "free";
}

export function resolvePlanLimits(plan: AccessPlan, config: RemoteConfig): PlanLimits {
  if (plan === "pro") {
    return {
      chatLimit: config.proDailyChatLimit,
      stockLimit: config.proStockLimit
    };
  }

  return {
    chatLimit: config.freeDailyChatLimit,
    stockLimit: config.freeStockLimit
  };
}
