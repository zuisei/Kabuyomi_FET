import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/admob-ssv", () => ({
  verifyAdMobSsvCallback: vi.fn()
}));

vi.mock("../src/lib/quota", () => ({
  buildQuotaDateJST: vi.fn(() => "2026-05-03"),
  grantRewardedAdCredits: vi.fn(),
  loadUsage: vi.fn(),
  readQuotaIdentity: vi.fn()
}));

import { verifyAdMobSsvCallback } from "../src/lib/admob-ssv";
import { grantRewardedAdCredits, loadUsage, readQuotaIdentity } from "../src/lib/quota";
import { DEFAULT_REMOTE_CONFIG as BASE_REMOTE_CONFIG } from "../src/lib/remote-config";
import { buildRewardedCreditCapability, handleAdMobRewardRoutes } from "../src/routes/admob-rewards";

const DEFAULT_REMOTE_CONFIG = {
  ...BASE_REMOTE_CONFIG,
  adsEnabled: true,
  rewardedCreditEnabled: true,
  rewardedSsvReady: true
};
const ENABLED_REMOTE_CONFIG = DEFAULT_REMOTE_CONFIG;

const mockVerifySsv = vi.mocked(verifyAdMobSsvCallback);
const mockGrantRewardedAdCredits = vi.mocked(grantRewardedAdCredits);
const mockLoadUsage = vi.mocked(loadUsage);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);

interface IntentRow {
  id: string;
  user_id: string;
  custom_data: string;
  reward_credits: number;
  status: "pending" | "granted" | "expired" | "rejected";
  daily_date_key: string;
  expires_at: string;
  created_at: string;
  granted_at: string | null;
  transaction_id: string | null;
  credits_remaining: number | null;
}

interface TransactionRow {
  transaction_id: string;
  user_id: string;
  reward_intent_id: string;
  status: "granted" | "rejected";
  operation_id: string;
}

interface RepairQueueRow {
  id: string;
  status: "pending" | "repaired" | "failed";
  kind: string;
  operation_id: string | null;
  quota_subject_hash: string | null;
  transaction_id_suffix: string | null;
  reward_intent_id_suffix: string | null;
  source: string;
  payload_json: string;
}

function usage(totalRemaining = 32) {
  return {
    plan: "free",
    chatsUsed: 0,
    chatLimit: 10,
    stocksUsed: 0,
    stockLimit: 3,
    savedTickers: [],
    dateJST: "2026-05-03",
    credits: {
      monthlyRemaining: 30,
      monthlyLimit: 30,
      rewardedAdRemaining: Math.max(0, totalRemaining - 30),
      rewardedAdExpiresAt: "2026-06-02T00:00:00.000Z",
      purchasedRemaining: 0,
      totalRemaining,
      resetsAt: "2026-06-01T00:00:00+09:00"
    }
  };
}

function createDb(seed?: {
  intents?: IntentRow[];
  transactions?: TransactionRow[];
  failRewardTransactionInsert?: boolean;
}) {
  const intents = [...(seed?.intents ?? [])];
  const transactions = [...(seed?.transactions ?? [])];
  const repairQueue: RepairQueueRow[] = [];
  let failRewardTransactionInsert = seed?.failRewardTransactionInsert ?? false;
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      async first<T>() {
        if (sql.includes("COUNT(*) AS count")) {
          const [userId, dateKey] = args;
          return {
            count: intents.filter((intent) => intent.user_id === userId && intent.daily_date_key === dateKey && intent.status === "granted").length
          } as T;
        }
        if (sql.includes("FROM admob_reward_intents") && sql.includes("WHERE id = ?")) {
          return (intents.find((intent) => intent.id === args[0]) ?? null) as T;
        }
        if (sql.includes("FROM admob_reward_intents") && sql.includes("WHERE custom_data = ?")) {
          return (intents.find((intent) => intent.custom_data === args[0]) ?? null) as T;
        }
        if (sql.includes("FROM admob_reward_transactions")) {
          return (transactions.find((transaction) => transaction.transaction_id === args[0]) ?? null) as T;
        }
        return null as T;
      },
      async run() {
        if (sql.includes("INSERT INTO admob_reward_intents")) {
          intents.push({
            id: args[0] as string,
            user_id: args[1] as string,
            custom_data: args[2] as string,
            reward_credits: args[3] as number,
            status: args[4] as IntentRow["status"],
            daily_date_key: args[5] as string,
            expires_at: args[6] as string,
            created_at: args[7] as string,
            granted_at: null,
            transaction_id: null,
            credits_remaining: null
          });
        }
        if (sql.includes("INSERT OR IGNORE INTO admob_reward_transactions")) {
          if (failRewardTransactionInsert) {
            failRewardTransactionInsert = false;
            throw new Error("admob reward transaction write failed");
          }
          if (!transactions.some((transaction) => transaction.transaction_id === args[0])) {
            transactions.push({
              transaction_id: args[0] as string,
              user_id: args[1] as string,
              reward_intent_id: args[2] as string,
              status: args[5] as TransactionRow["status"],
              operation_id: args[6] as string
            });
          }
        }
        if (sql.includes("SET status = 'granted'")) {
          const intent = intents.find((candidate) => candidate.id === args[3] && candidate.status === "pending");
          if (intent) {
            intent.status = "granted";
            intent.granted_at = args[0] as string;
            intent.transaction_id = args[1] as string;
            intent.credits_remaining = args[2] as number;
          }
        }
        if (sql.includes("SET status = 'rejected'")) {
          const intent = intents.find((candidate) => candidate.id === args[1] && candidate.status === "pending");
          if (intent) {
            intent.status = "rejected";
            intent.transaction_id = args[0] as string;
          }
        }
        if (sql.includes("INSERT INTO credit_audit_repair_queue")) {
          const existing = repairQueue.find((row) => row.id === args[0]);
          if (existing) {
            existing.status = existing.status === "repaired" ? "repaired" : "pending";
            existing.source = args[9] as string;
            existing.payload_json = args[12] as string;
          } else {
            repairQueue.push({
              id: args[0] as string,
              status: args[3] as RepairQueueRow["status"],
              kind: args[4] as string,
              operation_id: (args[5] as string | null) ?? null,
              quota_subject_hash: (args[6] as string | null) ?? null,
              transaction_id_suffix: (args[7] as string | null) ?? null,
              reward_intent_id_suffix: (args[8] as string | null) ?? null,
              source: args[9] as string,
              payload_json: args[12] as string
            });
          }
        }
        return {};
      }
    })
  }));
  return { db: { prepare }, intents, transactions, repairQueue };
}

/// 上限は環境変数で動くようになった(2026-08-25)。既定は 20 だが、
/// 上限まわりのテストは 3 回で書かれているので、**明示的に 3 に固定**して
/// 既定値の変更でテストの意味が変わらないようにする。
/// 既定値そのものは専用のテストで固定する。
function envWithDb(db: unknown, overrides: Record<string, unknown> = {}) {
  return {
    DB: db,
    ADMOB_REWARDED_AD_UNIT_ID: "ca-app-pub-3940256099942544/1712485313",
    ADMOB_SSV_PUBLIC_KEYS_URL: "https://www.gstatic.com/admob/reward/verifier-keys.json",
    KABUYOMI_ENV: "production",
    REWARDED_AD_DAILY_CAP: "3",
    ...overrides
  } as never;
}

function ssvUrl(params: Record<string, string>) {
  const url = new URL("https://kabuyomi.test/v1/admob/ssv");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

describe("AdMob rewarded credits route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadQuotaIdentity.mockResolvedValue({
      quotaSubject: "free:local:device-123",
      plan: "free",
      identityKind: "local_device"
    } as never);
    mockLoadUsage.mockResolvedValue(usage(32) as never);
    mockGrantRewardedAdCredits.mockResolvedValue({
      usage: usage(32),
      didMutate: true,
      operationId: "admob-reward:tx-1",
      status: "granted",
      creditsGranted: 2,
      creditsRemaining: 32,
      dailyRewardsUsed: 1,
      dailyRewardsRemaining: 2
    } as never);
    mockVerifySsv.mockResolvedValue(true);
  });

  it("keeps the released reward capability enabled with the built-in Google SSV key URL", async () => {
    const { db } = createDb();
    const capability = await buildRewardedCreditCapability(
      {
        DB: db,
        ADMOB_REWARDED_AD_UNIT_ID: "ca-app-pub-3940256099942544/1712485313",
        KABUYOMI_ENV: "production"
      } as never,
      ENABLED_REMOTE_CONFIG,
      {
        quotaSubject: "free:local:device-123",
        plan: "free",
        identityKind: "local_device"
      } as never
    );

    expect(capability).toMatchObject({
      enabled: true,
      ssvReady: true,
      environment: "production"
    });
  });

  it("creates a reward intent with a server-defined +2 credit grant and daily cap snapshot", async () => {
    const { db, intents } = createDb();
    const response = await handleAdMobRewardRoutes({
      request: new Request("https://kabuyomi.test/v1/admob/reward-intents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123",
          "x-kabuyomi-ad-unit-id": "ca-app-pub-3940256099942544/1712485313",
          "x-kabuyomi-ad-environment": "production"
        },
        body: "{}"
      }),
      url: new URL("https://kabuyomi.test/v1/admob/reward-intents"),
      env: envWithDb(db),
      config: ENABLED_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      rewardCredits: 2,
      dailyRemaining: 3
    });
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      user_id: "free:local:device-123",
      reward_credits: 2,
      status: "pending",
      daily_date_key: "2026-05-03"
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("keeps a client-created reward intent pending until a verified SSV callback arrives", async () => {
    const { db, intents } = createDb();
    const intentResponse = await handleAdMobRewardRoutes({
      request: new Request("https://kabuyomi.test/v1/admob/reward-intents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123",
          "x-kabuyomi-ad-unit-id": "ca-app-pub-3940256099942544/1712485313",
          "x-kabuyomi-ad-environment": "production"
        },
        body: "{}"
      }),
      url: new URL("https://kabuyomi.test/v1/admob/reward-intents"),
      env: envWithDb(db),
      config: ENABLED_REMOTE_CONFIG,
      ctx: {} as never
    });
    const intentPayload = (await intentResponse?.json()) as { rewardIntentId: string };
    const statusUrl = new URL(`https://kabuyomi.test/v1/admob/reward-status?id=${intentPayload.rewardIntentId}`);

    const statusResponse = await handleAdMobRewardRoutes({
      request: new Request(statusUrl, { headers: { "x-device-key": "device-123" } }),
      url: statusUrl,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(intents[0]).toMatchObject({ status: "pending", credits_remaining: null });
    await expect(statusResponse?.json()).resolves.toMatchObject({
      rewardIntentId: intentPayload.rewardIntentId,
      status: "pending",
      rewardCredits: 2
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("returns reward status with server usage for the owning device identity", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "granted",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: "2026-05-03T00:01:00.000Z",
          transaction_id: "tx-1",
          credits_remaining: 32
        }
      ]
    });
    const url = new URL("https://kabuyomi.test/v1/admob/reward-status?id=intent-1");

    const response = await handleAdMobRewardRoutes({
      request: new Request(url, { headers: { "x-device-key": "device-123" } }),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      rewardIntentId: "intent-1",
      status: "granted",
      rewardCredits: 2,
      creditsRemaining: 32,
      dailyRemaining: 2,
      usage: {
        credits: {
          rewardedAdRemaining: 2,
          totalRemaining: 32
        }
      }
    });
  });

  it("does not expose another device identity reward status", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:other-device",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = new URL("https://kabuyomi.test/v1/admob/reward-status?id=intent-1");

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url, { headers: { "x-device-key": "device-123" } }),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toMatchObject({
      status: 404,
      publicMessage: "Reward intent not found"
    });
  });

  it("valid SSV grants exactly +2 promotional credits and records the transaction", async () => {
    const { db, intents, transactions } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-1"
    });
    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "granted",
      rewardIntentId: "intent-1",
      creditsGranted: 2,
      creditsRemaining: 32
    });
    expect(mockGrantRewardedAdCredits).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
      rewardIntentId: "intent-1",
      transactionId: "tx-1",
      credits: 2,
      expiresAt: expect.any(String),
      dailyDateKey: "2026-05-03",
      dailyCap: 3
    });
    expect(transactions).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      status: "granted",
      transaction_id: "tx-1",
      credits_remaining: 32
    });
  });

  it("queues repair state if a D1 AdMob audit write fails after the DO grant", async () => {
    const { db, intents, transactions, repairQueue } = createDb({
      failRewardTransactionInsert: true,
      intents: [
        {
          id: "intent-audit-repair",
          user_id: "free:local:device-123",
          custom_data: "custom-audit-repair",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-audit-repair",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-audit-repair"
    });

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toThrow("admob reward transaction write failed");

    expect(mockGrantRewardedAdCredits).toHaveBeenCalledOnce();
    expect(transactions).toHaveLength(0);
    expect(intents[0]).toMatchObject({ status: "pending", transaction_id: null });
    expect(repairQueue).toHaveLength(1);
    expect(repairQueue[0]).toMatchObject({
      status: "pending",
      kind: "admob_reward_transaction",
      transaction_id_suffix: "t-repair",
      reward_intent_id_suffix: "t-repair"
    });
    const payload = JSON.parse(repairQueue[0].payload_json) as Record<string, unknown>;
    expect(payload).toMatchObject({
      transactionId: "tx-audit-repair",
      userId: "free:local:device-123",
      rewardIntentId: "intent-audit-repair",
      rewardCredits: 2,
      creditsRemaining: 32
    });
  });

  it("redacts AdMob SSV identifiers in production log payloads", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const transactionId = "tx-admob-log-redaction-abcdefghijklmnopqrstuvwxyz";
    const rewardIntentId = "intent-log-redaction-abcdefghijklmnopqrstuvwxyz";
    const adUnit = "ca-app-pub-3940256099942544/1712485313";
    mockGrantRewardedAdCredits.mockResolvedValueOnce({
      usage: usage(32),
      didMutate: true,
      operationId: `admob-reward:${transactionId}`,
      status: "granted",
      creditsGranted: 2,
      creditsRemaining: 32,
      dailyRewardsUsed: 1,
      dailyRewardsRemaining: 2
    } as never);
    const { db } = createDb({
      intents: [
        {
          id: rewardIntentId,
          user_id: "free:local:device-123",
          custom_data: `${rewardIntentId}.custom-secret-redaction-value`,
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request("https://kabuyomi.test/v1/admob/ssv"),
      url: ssvUrl({
        custom_data: `${rewardIntentId}.custom-secret-redaction-value`,
        transaction_id: transactionId,
        ad_unit: adUnit,
        reward_amount: "2",
        reward_item: "credits",
        signature: "raw-signature-should-not-log",
        key_id: "3335741209"
      }),
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    const joined = lines.join("\n");
    expect(joined).toContain('"transactionIdSuffix"');
    expect(joined).toContain('"rewardIntentIdSuffix"');
    expect(joined).toContain('"quotaSubjectHash"');
    expect(joined).not.toContain(transactionId);
    expect(joined).not.toContain(rewardIntentId);
    expect(joined).not.toContain(adUnit);
    expect(joined).not.toContain("free:local:device-123");
    expect(joined).not.toContain("custom-secret-redaction-value");
    expect(joined).not.toContain("raw-signature-should-not-log");
    logSpy.mockRestore();
  });

  it("valid SSV with reward amount and item grants only the configured +2 credits", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-1",
      reward_amount: "2",
      reward_item: "credits"
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "granted",
      creditsGranted: 2
    });
    expect(mockGrantRewardedAdCredits).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
      rewardIntentId: "intent-1",
      transactionId: "tx-1",
      credits: 2,
      expiresAt: expect.any(String),
      dailyDateKey: "2026-05-03",
      dailyCap: 3
    });
  });

  it("rejects signed SSV callbacks with mismatched reward_amount", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-1",
      reward_amount: "10",
      reward_item: "credits"
    });

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Invalid rewarded ad amount"
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("rejects signed SSV callbacks with mismatched reward_item", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-1",
      reward_amount: "2",
      reward_item: "coins"
    });

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Invalid rewarded ad item"
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("rejects invalid SSV signatures before reading callback grant fields", async () => {
    mockVerifySsv.mockResolvedValue(false);
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-1"
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "invalid_signature" });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("accepts the numeric ad_unit suffix Google can send in SSV callbacks", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "1712485313",
      custom_data: "custom-1"
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    expect(mockGrantRewardedAdCredits).toHaveBeenCalledOnce();
  });

  it("accepts the exact configured ad_unit without ca-app-pub prefix", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "3940256099942544/1712485313",
      custom_data: "custom-1"
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    expect(mockGrantRewardedAdCredits).toHaveBeenCalledOnce();
  });

  it("rejects non-allowlisted ad_unit values even when SSV signature is valid", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "9999999999",
      custom_data: "custom-1"
    });

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Invalid rewarded ad unit"
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("accepts signed AdMob Console verification callbacks with valid custom_data but does not grant without grant fields", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      custom_data: "custom-1"
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "verified_no_grant",
      rewardIntentId: "intent-1",
      creditsGranted: 0
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("accepts signed AdMob Console verification callbacks that use customData casing", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      customData: "custom-1"
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "verified_no_grant",
      rewardIntentId: "intent-1",
      creditsGranted: 0
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("accepts signed AdMob Console verification callbacks with dummy ad_unit but does not grant", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      ad_network: "5450213213286189855",
      ad_unit: "1234567890",
      custom_data: "custom-1",
      reward_amount: "2",
      reward_item: "credits",
      timestamp: "1777811026047",
      transaction_id: "123456789"
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "verified_no_grant",
      rewardIntentId: "intent-1",
      creditsGranted: 0
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("rejects signed SSV callbacks without custom_data", async () => {
    const { db } = createDb();
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "1712485313"
    });

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Missing custom_data"
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("rejects signed SSV callbacks with unknown custom_data", async () => {
    const { db } = createDb();
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "1712485313",
      custom_data: "unknown-custom-data"
    });

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Invalid rewarded ad custom data"
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("rejects signed SSV callbacks for expired reward intents", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2000-01-01T00:00:00.000Z",
          created_at: "2000-01-01T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "1712485313",
      custom_data: "custom-1"
    });

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Reward intent is not grantable"
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("duplicate SSV callbacks are success no-ops and do not grant twice", async () => {
    const { db } = createDb({
      intents: [
        {
          id: "intent-1",
          user_id: "free:local:device-123",
          custom_data: "custom-1",
          reward_credits: 2,
          status: "granted",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: "2026-05-03T00:01:00.000Z",
          transaction_id: "tx-1",
          credits_remaining: 32
        }
      ],
      transactions: [
        {
          transaction_id: "tx-1",
          user_id: "free:local:device-123",
          reward_intent_id: "intent-1",
          status: "granted",
          operation_id: "admob-reward:tx-1"
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-1",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-1"
    });
    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "duplicate_ignored",
      creditsGranted: 0,
      creditsRemaining: 32
    });
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
  });

  it("handles concurrent valid callbacks by accepting at most three same-day grants", async () => {
    const pendingIntent = (index: number): IntentRow => ({
      id: `intent-${index}`,
      user_id: "free:local:device-123",
      custom_data: `custom-${index}`,
      reward_credits: 2,
      status: "pending",
      daily_date_key: "2026-05-03",
      expires_at: "2999-01-01T00:00:00.000Z",
      created_at: "2026-05-03T00:00:00.000Z",
      granted_at: null,
      transaction_id: null,
      credits_remaining: null
    });
    const { db, intents, transactions } = createDb({
      intents: [1, 2, 3, 4, 5].map(pendingIntent)
    });
    mockGrantRewardedAdCredits.mockImplementation(async (_identity, _env, _config, options) => {
      const index = Number.parseInt(options.transactionId.replace("tx-", ""), 10);
      if (index > 3) {
        return {
          usage: usage(36),
          didMutate: false,
          operationId: `admob-reward:${options.transactionId}`,
          status: "cap_reached",
          creditsGranted: 0,
          creditsRemaining: 36,
          dailyRewardsUsed: 3,
          dailyRewardsRemaining: 0
        } as never;
      }
      return {
        usage: usage(30 + index * 2),
        didMutate: true,
        operationId: `admob-reward:${options.transactionId}`,
        status: "granted",
        creditsGranted: 2,
        creditsRemaining: 30 + index * 2,
        dailyRewardsUsed: index,
        dailyRewardsRemaining: 3 - index
      } as never;
    });

    const settled = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((index) =>
        handleAdMobRewardRoutes({
          request: new Request("https://kabuyomi.test/v1/admob/ssv"),
          url: ssvUrl({
            transaction_id: `tx-${index}`,
            ad_unit: "ca-app-pub-3940256099942544/1712485313",
            custom_data: `custom-${index}`
          }),
          env: envWithDb(db),
          config: DEFAULT_REMOTE_CONFIG,
          ctx: {} as never
        })
      )
    );

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(
      settled.filter(
        (result) => result.status === "rejected" && typeof result.reason === "object" && result.reason?.status === 429
      )
    ).toHaveLength(2);
    expect(transactions).toHaveLength(3);
    expect(intents.filter((intent) => intent.status === "granted")).toHaveLength(3);
    expect(intents.filter((intent) => intent.status === "rejected")).toHaveLength(2);
  });

  it("handles concurrent duplicate callbacks for the same transaction as one grant", async () => {
    const { db, intents, transactions } = createDb({
      intents: [
        {
          id: "intent-duplicate",
          user_id: "free:local:device-123",
          custom_data: "custom-duplicate",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    let calls = 0;
    mockGrantRewardedAdCredits.mockImplementation(async () => {
      calls += 1;
      return {
        usage: usage(32),
        didMutate: calls === 1,
        operationId: "admob-reward:tx-duplicate",
        status: calls === 1 ? "granted" : "duplicate_ignored",
        creditsGranted: calls === 1 ? 2 : 0,
        creditsRemaining: 32,
        dailyRewardsUsed: 1,
        dailyRewardsRemaining: 2
      } as never;
    });
    const url = ssvUrl({
      transaction_id: "tx-duplicate",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-duplicate"
    });

    const responses = await Promise.all([
      handleAdMobRewardRoutes({
        request: new Request("https://kabuyomi.test/v1/admob/ssv"),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      }),
      handleAdMobRewardRoutes({
        request: new Request("https://kabuyomi.test/v1/admob/ssv"),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ]);

    const payloads = (await Promise.all(responses.map((response) => response?.json()))) as Array<Record<string, unknown>>;
    expect(payloads.filter((payload) => payload.status === "granted")).toHaveLength(1);
    expect(payloads.filter((payload) => payload.status === "duplicate_ignored")).toHaveLength(1);
    expect(transactions).toHaveLength(1);
    expect(intents.filter((intent) => intent.status === "granted")).toHaveLength(1);
  });

  it("enforces the daily cap server-side before granting an SSV callback", async () => {
    mockGrantRewardedAdCredits.mockResolvedValueOnce({
      usage: usage(36),
      didMutate: false,
      operationId: "admob-reward:tx-4",
      status: "cap_reached",
      creditsGranted: 0,
      creditsRemaining: 36,
      dailyRewardsUsed: 3,
      dailyRewardsRemaining: 0
    } as never);
    const grantedIntent = (index: number): IntentRow => ({
      id: `granted-${index}`,
      user_id: "free:local:device-123",
      custom_data: `granted-custom-${index}`,
      reward_credits: 2,
      status: "granted",
      daily_date_key: "2026-05-03",
      expires_at: "2999-01-01T00:00:00.000Z",
      created_at: "2026-05-03T00:00:00.000Z",
      granted_at: "2026-05-03T00:01:00.000Z",
      transaction_id: `granted-tx-${index}`,
      credits_remaining: 32
    });
    const { db, intents } = createDb({
      intents: [
        grantedIntent(1),
        grantedIntent(2),
        grantedIntent(3),
        {
          id: "intent-4",
          user_id: "free:local:device-123",
          custom_data: "custom-4",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-4",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-4"
    });

    await expect(
      handleAdMobRewardRoutes({
        request: new Request(url),
        url,
        env: envWithDb(db),
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toMatchObject({
      status: 429,
      publicMessage: "Rewarded ad daily cap reached"
    });
    expect(mockGrantRewardedAdCredits).toHaveBeenCalledOnce();
    expect(intents.find((intent) => intent.id === "intent-4")).toMatchObject({
      status: "rejected",
      transaction_id: "tx-4"
    });

    const statusUrl = new URL("https://kabuyomi.test/v1/admob/reward-status?id=intent-4");
    const statusResponse = await handleAdMobRewardRoutes({
      request: new Request(statusUrl, { headers: { "x-device-key": "device-123" } }),
      url: statusUrl,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    await expect(statusResponse?.json()).resolves.toMatchObject({
      status: "rejected",
      dailyRemaining: 0
    });
  });

  /// 3 回は渋すぎたので既定を上げた(2026-08-25 オーナー「3回制限撤廃していいよ」)。
  /// ゼロにはしていない。ここはクレジットが**増える**唯一の経路で、
  /// 偽装がそのままモデルの原価になる。人間が当たらない値まで開けて、環境変数で動かす。
  /// 3 回は渋すぎたので既定を上げた(2026-08-25 オーナー「3回制限撤廃していいよ」)。
  /// ゼロにはしていない。ここはクレジットが**増える**唯一の経路で、
  /// 偽装がそのままモデルの原価になる。人間が当たらない値まで開けて、環境変数で動かす。
  it("no longer stops at three, and takes the cap from the environment", async () => {
    const { db } = createDb();
    const identity = { quotaSubject: "free:local:device-123", plan: "free" as const, identityKind: "local_device" as const };
    const base = {
      DB: db,
      ADMOB_REWARDED_AD_UNIT_ID: "ca-app-pub-3940256099942544/1712485313",
      KABUYOMI_ENV: "production"
    };

    const byDefault = await buildRewardedCreditCapability(base as never, ENABLED_REMOTE_CONFIG, identity as never);
    expect(byDefault.dailyCap).toBe(20);

    const overridden = await buildRewardedCreditCapability(
      { ...base, REWARDED_AD_DAILY_CAP: "7" } as never,
      ENABLED_REMOTE_CONFIG,
      identity as never
    );
    expect(overridden.dailyCap).toBe(7);
  });

  it("allows the third same-day reward and then reports zero remaining", async () => {
    const grantedIntent = (index: number): IntentRow => ({
      id: `granted-${index}`,
      user_id: "free:local:device-123",
      custom_data: `granted-custom-${index}`,
      reward_credits: 2,
      status: "granted",
      daily_date_key: "2026-05-03",
      expires_at: "2999-01-01T00:00:00.000Z",
      created_at: "2026-05-03T00:00:00.000Z",
      granted_at: "2026-05-03T00:01:00.000Z",
      transaction_id: `granted-tx-${index}`,
      credits_remaining: 32
    });
    const { db, intents } = createDb({
      intents: [
        grantedIntent(1),
        grantedIntent(2),
        {
          id: "intent-3",
          user_id: "free:local:device-123",
          custom_data: "custom-3",
          reward_credits: 2,
          status: "pending",
          daily_date_key: "2026-05-03",
          expires_at: "2999-01-01T00:00:00.000Z",
          created_at: "2026-05-03T00:00:00.000Z",
          granted_at: null,
          transaction_id: null,
          credits_remaining: null
        }
      ]
    });
    const url = ssvUrl({
      transaction_id: "tx-3",
      ad_unit: "ca-app-pub-3940256099942544/1712485313",
      custom_data: "custom-3",
      reward_amount: "2",
      reward_item: "credits"
    });

    const response = await handleAdMobRewardRoutes({
      request: new Request(url),
      url,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "granted",
      creditsGranted: 2
    });
    expect(mockGrantRewardedAdCredits).toHaveBeenCalledOnce();
    expect(intents.find((intent) => intent.id === "intent-3")).toMatchObject({
      status: "granted",
      transaction_id: "tx-3"
    });

    const statusUrl = new URL("https://kabuyomi.test/v1/admob/reward-status?id=intent-3");
    const statusResponse = await handleAdMobRewardRoutes({
      request: new Request(statusUrl, { headers: { "x-device-key": "device-123" } }),
      url: statusUrl,
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    await expect(statusResponse?.json()).resolves.toMatchObject({
      status: "granted",
      dailyRemaining: 0
    });
  });
});
