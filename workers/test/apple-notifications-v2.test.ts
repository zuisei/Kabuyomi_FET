import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Environment } from "@apple/app-store-server-library";
import { EntitlementDO } from "../src/durable/entitlement";
import { UserQuotaDO } from "../src/durable/user-quota";
import { setAppleSignedDataVerifierFactoryForTests } from "../src/lib/apple-signed-data";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { handleAppleNotificationsV2Route } from "../src/routes/apple-notifications-v2";

function state() {
  const values = new Map<string, any>();
  return {
    values,
    storage: {
      async get<T>(key: string) { return values.get(key) as T | undefined; },
      async put(key: string, value: unknown) { values.set(key, structuredClone(value)); },
      async delete(key: string) { return values.delete(key); },
      async list<T>({ prefix }: { prefix?: string } = {}) {
        return new Map([...values.entries()].filter(([key]) => !prefix || key.startsWith(prefix))) as Map<string, T>;
      }
    },
    async blockConcurrencyWhile<T>(callback: () => Promise<T>) { return callback(); }
  };
}

function env() {
  const entitlementState = state();
  const quotaState = state();
  const entitlement = new EntitlementDO(entitlementState as never);
  const quota = new UserQuotaDO(quotaState as never);
  const notifications = new Map<string, {
    payload_digest: string;
    status: string;
    processing_started_at: string | null;
    processed_at?: string | null;
    error_code?: string | null;
  }>();
  const purchases = new Map<string, Record<string, any>>();
  const creditLedger = new Map<string, Record<string, any>>();
  const controls = { ledgerFailuresRemaining: 0 };
  const db = {
    prepare(sql: string) {
      let args: any[] = [];
      const statement = {
        bind(...values: any[]) { args = values; return statement; },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO app_store_notifications")) {
            if (notifications.has(args[0])) return { meta: { changes: 0 } };
            notifications.set(args[0], {
              payload_digest: args[6],
              status: "processing",
              processing_started_at: args[8]
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'processing'")) {
            const row = notifications.get(args[1]);
            const reclaimable = row && row.payload_digest === args[2] &&
              (row.status === "failed" || (row.status === "processing" &&
                (!row.processing_started_at || row.processing_started_at <= args[3])));
            if (!reclaimable || !row) return { meta: { changes: 0 } };
            row.status = "processing";
            row.processing_started_at = args[0];
            row.processed_at = null;
            row.error_code = null;
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE app_store_notifications") && sql.includes("entitlement_key")) {
            const row = notifications.get(args[4]);
            if (row) {
              row.status = args[1];
              row.processed_at = args[2];
              row.error_code = args[3];
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("UPDATE purchase_transactions") && sql.includes("status = 'refunded'")) {
            const row = purchases.get(args[5]);
            if (row) {
              row.status = "refunded";
              row.refunded_at = args[0];
              row.refund_available_removed = args[1];
              row.refund_debt_created = args[2];
              row.refund_notification_uuid ||= args[3];
              row.updated_at = args[4];
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("UPDATE purchase_transactions") && sql.includes("status = 'refund_reversed'")) {
            const row = purchases.get(args[6]);
            if (row) {
              row.status = "refund_reversed";
              row.refund_reversed_at = args[0];
              row.refund_debt_released = args[1];
              row.refund_debt_settled_restored = args[2];
              row.refund_credits_restored = args[3];
              row.refund_reversed_notification_uuid ||= args[4];
              row.updated_at = args[5];
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("UPDATE purchase_transactions") && sql.includes("status = 'pending'")) {
            const row = purchases.get(args[3]);
            if (row) {
              row.status = "pending";
              row.refund_reversed_at = args[0];
              row.refund_reversed_notification_uuid ||= args[1];
              row.updated_at = args[2];
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("INSERT OR IGNORE INTO credit_ledger")) {
            if (controls.ledgerFailuresRemaining > 0) {
              controls.ledgerFailuresRemaining -= 1;
              throw new Error("temporary credit ledger failure");
            }
            if (!creditLedger.has(args[2])) {
              creditLedger.set(args[2], {
                user_id: args[1], operation_id: args[2], type: args[3], delta: args[4],
                balance_after: args[5], purchased_balance_after: args[7], metadata_json: args[10]
              });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes("FROM app_store_notifications")) {
            return notifications.get(args[0]) ?? null;
          }
          if (sql.includes("FROM purchase_transactions")) {
            return purchases.get(args[0]) ?? null;
          }
          return null;
        }
      };
      return statement;
    }
  };
  return {
    value: {
      APPLE_BUNDLE_ID: "app.kabuyomi.ios",
      APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox",
      SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1: "notification-test-secret",
      DB: db,
      ENTITLEMENT: { getByName: () => ({ fetch: (request: Request) => entitlement.fetch(request) }) },
      USER_QUOTA: { getByName: () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => quota.fetch(new Request(input, init)) }) }
    } as any,
    entitlementState,
    quotaState,
    notifications,
    purchases,
    creditLedger,
    controls
  };
}

function request(signedPayload = "notification-jws") {
  return new Request("https://api.test/v1/apple/notifications/v2", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedPayload })
  });
}

async function seedConsumablePurchase(
  test: ReturnType<typeof env>,
  options: { transactionId: string; productId: string; credits: number }
) {
  const quotaSubject = "account:notification-owner";
  // サブスクの期限判定は実時刻と突き合わせるため、近い将来の日付を置くと
  // その日を境にテストが落ちる(2026-08-01 の expiresDate で実際に起きた)。
  // シナリオ全体を相対関係を保ったまま遠い将来へ移してある。
  const now = "2099-07-10T00:00:00.000Z";
  test.purchases.set(options.transactionId, {
    user_id: quotaSubject,
    product_id: options.productId,
    transaction_id: options.transactionId,
    original_transaction_id: options.transactionId,
    credits_granted: options.credits,
    status: "granted",
    debt_offset_applied: 0,
    refunded_at: null,
    refund_reversed_at: null,
    refund_available_removed: 0,
    refund_debt_created: 0,
    refund_debt_released: 0,
    refund_debt_settled_restored: 0,
    refund_credits_restored: 0,
    refund_notification_uuid: null,
    refund_reversed_notification_uuid: null,
    purchased_at: now,
    created_at: now,
    updated_at: now
  });
  const response = await test.value.USER_QUOTA.getByName(quotaSubject).fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "grantPurchasedCredit",
      quotaSubject,
      plan: "free",
      dateJST: "2099-07-11",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 0,
      operationId: `purchase:${options.transactionId}`,
      transactionId: options.transactionId,
      productId: options.productId,
      purchaseCredits: options.credits
    })
  });
  expect(response.status).toBe(200);
  return quotaSubject;
}

describe("App Store Server Notifications V2", () => {
  let revoked = false;
  let uuid = "notification-uuid-1";
  let productId = "kabuyomi.sub.pro.monthly";
  let notificationTypeOverride: string | null = null;
  let transactionIdOverride: string | null = null;
  let purchaseDate = Date.parse("2099-07-01T00:00:00Z");
  let notificationSignedDate = Date.parse("2099-07-11T00:00:00Z");
  let transactionFailuresRemaining = 0;
  beforeEach(() => {
    revoked = false;
    uuid = "notification-uuid-1";
    productId = "kabuyomi.sub.pro.monthly";
    notificationTypeOverride = null;
    transactionIdOverride = null;
    purchaseDate = Date.parse("2099-07-01T00:00:00Z");
    notificationSignedDate = Date.parse("2099-07-11T00:00:00Z");
    transactionFailuresRemaining = 0;
    setAppleSignedDataVerifierFactoryForTests((_env, environment) => ({
      verifyAndDecodeNotification: async () => ({
        notificationUUID: uuid,
        notificationType: notificationTypeOverride ?? (revoked ? "REFUND" : "DID_RENEW"),
        version: "2.0",
        signedDate: revoked ? Date.parse("2099-07-12T00:00:00Z") : notificationSignedDate,
        environment: Environment.SANDBOX,
        data: { signedTransactionInfo: "transaction-jws" }
      }),
      verifyAndDecodeTransaction: async () => {
        if (transactionFailuresRemaining > 0) {
          transactionFailuresRemaining -= 1;
          throw new Error("temporary transaction verifier failure");
        }
        return {
          transactionId: transactionIdOverride ?? (revoked ? "tx-2" : `tx-${productId}`),
          originalTransactionId: "original-1",
          productId,
          bundleId: "app.kabuyomi.ios",
          purchaseDate,
          expiresDate: Date.parse("2099-08-01T00:00:00Z"),
          revocationDate: revoked ? Date.parse("2099-07-12T00:00:00Z") : undefined,
          signedDate: revoked ? Date.parse("2099-07-12T00:00:00Z") : notificationSignedDate,
          environment: environment === "sandbox" ? Environment.SANDBOX : Environment.PRODUCTION
        };
      },
      verifyAndDecodeRenewalInfo: async () => ({ environment: Environment.SANDBOX })
    }));
  });
  afterEach(() => setAppleSignedDataVerifierFactoryForTests(undefined));

  it("applies one verified renewal and ignores an exact notification replay", async () => {
    const test = env();
    const context = { request: request(), url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} } };
    const first = await handleAppleNotificationsV2Route(context as never);
    const second = await handleAppleNotificationsV2Route({ ...context, request: request() } as never);
    expect(first?.status).toBe(200);
    await expect(first?.json()).resolves.toEqual({ status: "processed" });
    await expect(second?.json()).resolves.toEqual({ status: "duplicate_ignored" });
    expect(test.notifications.size).toBe(1);
    expect(test.quotaState.values.get("credit_state")).toMatchObject({ monthlyRemaining: 900, monthlyLimit: 900 });
  });

  it("propagates a verified refund to terminal revoked state without a new grant", async () => {
    const test = env();
    const base = { url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} } };
    await handleAppleNotificationsV2Route({ ...base, request: request() } as never);
    revoked = true;
    uuid = "notification-uuid-2";
    const response = await handleAppleNotificationsV2Route({ ...base, request: request() } as never);
    expect(response?.status).toBe(200);
    expect(test.entitlementState.values.get("current:v2")).toMatchObject({ status: "revoked", revokedAt: "2099-07-12T00:00:00.000Z" });
    expect(test.quotaState.values.get("credit_state")).toMatchObject({ monthlyRemaining: 900 });
  });

  it("rejects malformed or untrusted signedPayload before persistence", async () => {
    setAppleSignedDataVerifierFactoryForTests(() => ({
      verifyAndDecodeNotification: async () => { throw new Error("bad signature"); },
      verifyAndDecodeTransaction: async () => ({}),
      verifyAndDecodeRenewalInfo: async () => ({})
    }));
    const test = env();
    const response = await handleAppleNotificationsV2Route({ request: request("bad"), url: new URL("https://api.test/v1/apple/notifications/v2"),
      env: test.value, config: DEFAULT_REMOTE_CONFIG, ctx: {} } as never);
    expect(response?.status).toBe(400);
    expect(test.notifications.size).toBe(0);
  });

  it("reclaims an exact failed notification retry instead of permanently ignoring it", async () => {
    const test = env();
    const context = { request: request(), url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} } };
    transactionFailuresRemaining = 1;

    const failed = await handleAppleNotificationsV2Route(context as never);
    expect(failed?.status).toBe(400);
    await expect(failed?.json()).resolves.toEqual({ error: "Apple transaction signature verification failed" });
    expect(test.notifications.get(uuid)?.status).toBe("failed");

    const retry = await handleAppleNotificationsV2Route({ ...context, request: request() } as never);
    expect(retry?.status).toBe(200);
    await expect(retry?.json()).resolves.toEqual({ status: "processed" });
    expect(test.notifications.get(uuid)?.status).toBe("processed");
    expect(test.quotaState.values.get("credit_state")).toMatchObject({ monthlyRemaining: 900 });
  });

  it("rejects a notification UUID replay with a different signed payload digest", async () => {
    const test = env();
    const base = { url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} } };
    await handleAppleNotificationsV2Route({ ...base, request: request("notification-jws") } as never);
    const mismatch = await handleAppleNotificationsV2Route({ ...base, request: request("different-jws") } as never);
    expect(mismatch?.status).toBe(409);
    await expect(mismatch?.json()).resolves.toEqual({ error: "Notification identity payload mismatch" });
  });

  it("treats an immediate same-renewal-boundary plan change as one cycle and grants only the delta", async () => {
    const test = env();
    const base = { url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} } };
    productId = "kabuyomi.sub.lite.monthly";
    await handleAppleNotificationsV2Route({ ...base, request: request() } as never);

    uuid = "notification-uuid-upgrade";
    productId = "kabuyomi.sub.pro.monthly";
    purchaseDate = Date.parse("2099-07-15T00:00:00Z");
    notificationSignedDate = Date.parse("2099-07-15T00:05:00Z");
    const upgrade = await handleAppleNotificationsV2Route({ ...base, request: request("notification-upgrade-jws") } as never);
    expect(upgrade?.status).toBe(200);

    const monthlyGrants = [...test.quotaState.values.entries()]
      .filter(([key]) => key.startsWith("monthly_grant:"))
      .map(([, value]) => value as { creditsGranted: number });
    expect(monthlyGrants.map((grant) => grant.creditsGranted).sort((a, b) => a - b)).toEqual([400, 500]);
    expect(test.quotaState.values.get("credit_state")).toMatchObject({
      periodStart: "2099-07-01T00:00:00.000Z",
      periodEnd: "2099-08-01T00:00:00.000Z",
      monthlyLimit: 900,
      monthlyRemaining: 900
    });
  });

  it("refunds a claimed consumable once, carries spent credit as debt, and reverses exactly once", async () => {
    const test = env();
    productId = "kabuyomi.credits.100";
    transactionIdOverride = "consumable-tx-100";
    notificationTypeOverride = "REFUND";
    const quotaSubject = await seedConsumablePurchase(test, {
      transactionId: transactionIdOverride,
      productId,
      credits: 100
    });
    const consume = await test.value.USER_QUOTA.getByName(quotaSubject).fetch("https://do/quota", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "consumeCredit",
        quotaSubject,
        plan: "free",
        dateJST: "2099-07-11",
        chatLimit: 3,
        stockLimit: 3,
        monthlyCreditLimit: 0,
        operationId: "consume:before-consumable-refund",
        creditsRequired: 70,
        referenceType: "chat",
        referenceId: "before-consumable-refund"
      })
    });
    expect(consume.status).toBe(200);
    const base = { url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} } };

    const refunded = await handleAppleNotificationsV2Route({ ...base, request: request() } as never);
    expect(refunded?.status).toBe(200);
    await expect(refunded?.json()).resolves.toEqual({
      status: "processed", action: "consumable_refund", outcome: "refunded"
    });
    expect(test.purchases.get(transactionIdOverride)).toMatchObject({
      status: "refunded",
      refund_available_removed: 30,
      refund_debt_created: 70,
      refund_notification_uuid: "notification-uuid-1"
    });
    expect(test.quotaState.values.get("credit_state")).toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 70
    });
    expect(test.creditLedger.get(`purchase-refund:${transactionIdOverride}`)).toMatchObject({
      type: "purchase_refund",
      delta: -30,
      purchased_balance_after: 0
    });

    uuid = "notification-uuid-distinct-refund-duplicate";
    const duplicateRefund = await handleAppleNotificationsV2Route({ ...base, request: request("distinct-refund-jws") } as never);
    expect(duplicateRefund?.status).toBe(200);
    await expect(duplicateRefund?.json()).resolves.toMatchObject({ outcome: "refunded" });
    expect(test.quotaState.values.get("credit_state")).toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 70
    });
    expect(test.creditLedger.size).toBe(1);

    await seedConsumablePurchase(test, {
      transactionId: "consumable-settlement-tx-50",
      productId: "kabuyomi.credits.50",
      credits: 50
    });
    expect(test.quotaState.values.get("credit_state")).toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 20
    });

    uuid = "notification-uuid-refund-reversed";
    notificationTypeOverride = "REFUND_REVERSED";
    const reversed = await handleAppleNotificationsV2Route({ ...base, request: request("refund-reversed-jws") } as never);
    expect(reversed?.status).toBe(200);
    await expect(reversed?.json()).resolves.toEqual({
      status: "processed", action: "consumable_refund_reversed", outcome: "reinstated"
    });
    expect(test.purchases.get(transactionIdOverride)).toMatchObject({
      status: "refund_reversed",
      refund_debt_released: 20,
      refund_debt_settled_restored: 50,
      refund_credits_restored: 80,
      refund_reversed_notification_uuid: "notification-uuid-refund-reversed"
    });
    expect(test.quotaState.values.get("credit_state")).toMatchObject({
      purchasedRemaining: 80,
      purchasedRefundDebt: 0
    });
    const reversalLedger = test.creditLedger.get(`purchase-refund-reversal:${transactionIdOverride}`);
    expect(reversalLedger).toMatchObject({ type: "purchase_refund_reversal", delta: 80 });
    expect(JSON.parse(String(reversalLedger?.metadata_json))).toMatchObject({
      refundAvailableRemoved: 30,
      refundDebtCreated: 70,
      refundDebtReleased: 20,
      refundDebtSettledRestored: 50,
      refundCreditsRestored: 80
    });

    uuid = "notification-uuid-distinct-reversal-duplicate";
    await handleAppleNotificationsV2Route({ ...base, request: request("distinct-reversal-jws") } as never);
    expect(test.quotaState.values.get("credit_state")).toMatchObject({
      purchasedRemaining: 80,
      purchasedRefundDebt: 0
    });
    expect(test.creditLedger.size).toBe(2);
  });

  it("acknowledges unclaimed one-time and consumption events without granting or inferring data", async () => {
    const test = env();
    productId = "kabuyomi.credits.100";
    transactionIdOverride = "unclaimed-consumable-tx";
    notificationTypeOverride = "ONE_TIME_CHARGE";
    const base = { url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} } };

    const charge = await handleAppleNotificationsV2Route({ ...base, request: request() } as never);
    await expect(charge?.json()).resolves.toEqual({
      status: "acknowledged", action: "one_time_charge_no_grant"
    });
    expect(test.quotaState.values.get("credit_state")).toBeUndefined();
    expect(test.purchases.size).toBe(0);

    uuid = "notification-unclaimed-refund";
    notificationTypeOverride = "REFUND";
    const refund = await handleAppleNotificationsV2Route({ ...base, request: request("unclaimed-refund-jws") } as never);
    await expect(refund?.json()).resolves.toEqual({
      status: "processed", action: "consumable_refund", outcome: "unclaimed"
    });
    expect(test.quotaState.values.get("credit_state")).toBeUndefined();

    uuid = "notification-consumption-request";
    notificationTypeOverride = "CONSUMPTION_REQUEST";
    const consumption = await handleAppleNotificationsV2Route({ ...base, request: request("consumption-request-jws") } as never);
    await expect(consumption?.json()).resolves.toEqual({
      status: "acknowledged", action: "consumption_request_no_data"
    });
    expect(test.quotaState.values.get("credit_state")).toBeUndefined();
    expect(test.creditLedger.size).toBe(0);
  });

  it("rejects a consumable refund whose D1 product/credit authority conflicts with the verified transaction", async () => {
    const test = env();
    productId = "kabuyomi.credits.100";
    transactionIdOverride = "consumable-authority-mismatch";
    notificationTypeOverride = "REFUND";
    await seedConsumablePurchase(test, {
      transactionId: transactionIdOverride,
      productId,
      credits: 100
    });
    test.purchases.get(transactionIdOverride)!.credits_granted = 50;
    const response = await handleAppleNotificationsV2Route({
      request: request(), url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} }
    } as never);
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({ error: "Purchase transaction authority mismatch" });
    expect(test.notifications.get(uuid)?.status).toBe("failed");
    expect(test.quotaState.values.get("credit_state")).toMatchObject({ purchasedRemaining: 100 });
    expect(test.creditLedger.size).toBe(0);
  });

  it("retries D1 audit persistence after the DO refund succeeded without double clawback", async () => {
    const test = env();
    productId = "kabuyomi.credits.50";
    transactionIdOverride = "consumable-ledger-retry";
    notificationTypeOverride = "REFUND";
    await seedConsumablePurchase(test, {
      transactionId: transactionIdOverride,
      productId,
      credits: 50
    });
    test.controls.ledgerFailuresRemaining = 1;
    const context = {
      request: request(), url: new URL("https://api.test/v1/apple/notifications/v2"), env: test.value,
      config: DEFAULT_REMOTE_CONFIG, ctx: { waitUntil() {}, passThroughOnException() {}, props: {} }
    };

    await expect(handleAppleNotificationsV2Route(context as never)).rejects.toThrow("temporary credit ledger failure");
    expect(test.notifications.get(uuid)?.status).toBe("failed");
    expect(test.quotaState.values.get("credit_state")).toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 0
    });
    expect(test.creditLedger.size).toBe(0);

    const retry = await handleAppleNotificationsV2Route({ ...context, request: request() } as never);
    expect(retry?.status).toBe(200);
    expect(test.notifications.get(uuid)?.status).toBe("processed");
    expect(test.quotaState.values.get("credit_state")).toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 0
    });
    expect(test.creditLedger.get(`purchase-refund:${transactionIdOverride}`)).toMatchObject({ delta: -50 });
  });
});
