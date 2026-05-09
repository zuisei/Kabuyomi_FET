import type { RemoteConfig } from "./remote-config";

export type AccessPlan = "free" | "lite" | "pro" | "pro_max";
export type CreditPlan = AccessPlan;
export type ProductCreditKind = "paid";
export type AppStoreProductType = "consumable" | "autoRenewableSubscription";
export type SubscriptionPlan = "lite" | "pro" | "max";

export interface PlanLimits {
  chatLimit: number;
  stockLimit: number;
}

export interface ConsumableProductConfig {
  type: "consumable";
  credits: number;
  creditKind: ProductCreditKind;
}

export interface SubscriptionProductConfig {
  type: "autoRenewableSubscription";
  plan: SubscriptionPlan;
  accessPlan: Exclude<AccessPlan, "free">;
  monthlyCredits: number;
}

export type AppStoreProductConfig = ConsumableProductConfig | SubscriptionProductConfig;

export const PRIMARY_SMALL_CREDIT_PRODUCT_ID = "kabuyomi.credits.50";
export const LEGACY_MINI_CREDIT_PRODUCT_ID = "kabuyomi.credits.100";

export const APP_STORE_PRODUCTS = {
  [PRIMARY_SMALL_CREDIT_PRODUCT_ID]: {
    type: "consumable",
    credits: 50,
    creditKind: "paid"
  },
  [LEGACY_MINI_CREDIT_PRODUCT_ID]: {
    type: "consumable",
    credits: 100,
    creditKind: "paid"
  },
  "kabuyomi.sub.lite.monthly": {
    type: "autoRenewableSubscription",
    plan: "lite",
    accessPlan: "lite",
    monthlyCredits: 400
  },
  "kabuyomi.sub.pro.monthly": {
    type: "autoRenewableSubscription",
    plan: "pro",
    accessPlan: "pro",
    monthlyCredits: 900
  },
  "kabuyomi.sub.max.monthly": {
    type: "autoRenewableSubscription",
    plan: "max",
    accessPlan: "pro_max",
    monthlyCredits: 2000
  }
} as const satisfies Record<string, AppStoreProductConfig>;

export type AppStoreProductId = keyof typeof APP_STORE_PRODUCTS;

export const LITE_PRODUCT_IDS = new Set(["kabuyomi.sub.lite.monthly"]);
export const PRO_PRODUCT_IDS = new Set(["kabuyomi.sub.pro.monthly"]);
export const PRO_MAX_PRODUCT_IDS = new Set(["kabuyomi.sub.max.monthly"]);
export const MINI_CREDIT_PRODUCT_ID = LEGACY_MINI_CREDIT_PRODUCT_ID;

export const CREDIT_PACK_PRODUCTS = {
  [PRIMARY_SMALL_CREDIT_PRODUCT_ID]: APP_STORE_PRODUCTS[PRIMARY_SMALL_CREDIT_PRODUCT_ID].credits,
  [LEGACY_MINI_CREDIT_PRODUCT_ID]: APP_STORE_PRODUCTS[LEGACY_MINI_CREDIT_PRODUCT_ID].credits
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

  if (productId && PRO_MAX_PRODUCT_IDS.has(productId)) {
    return "pro_max";
  }

  return "free";
}

export function isSubscriptionProductId(productId: string | null | undefined): boolean {
  return resolveSubscriptionProduct(productId)?.type === "autoRenewableSubscription";
}

export function resolveCreditPackCredits(productId: string): number | null {
  return isCreditPackProductId(productId) ? CREDIT_PACK_PRODUCTS[productId] : null;
}

export function resolveCreditPackProduct(productId: string | null | undefined): ConsumableProductConfig | null {
  if (!productId) {
    return null;
  }
  const product = APP_STORE_PRODUCTS[productId as AppStoreProductId];
  return product?.type === "consumable" ? product : null;
}

export function resolveSubscriptionProduct(productId: string | null | undefined): SubscriptionProductConfig | null {
  if (!productId) {
    return null;
  }
  const product = APP_STORE_PRODUCTS[productId as AppStoreProductId];
  return product?.type === "autoRenewableSubscription" ? product : null;
}

export function resolveSubscriptionPlan(productId: string | null | undefined): SubscriptionPlan | null {
  return resolveSubscriptionProduct(productId)?.plan ?? null;
}

export function resolveSubscriptionMonthlyCredits(productId: string | null | undefined): number | null {
  return resolveSubscriptionProduct(productId)?.monthlyCredits ?? null;
}

export function resolveMonthlyCreditLimit(plan: AccessPlan, config: RemoteConfig): number {
  return config.planCredits[plan];
}

export function resolvePlanLimits(plan: AccessPlan, config: RemoteConfig): PlanLimits {
  if (plan === "pro" || plan === "pro_max") {
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
