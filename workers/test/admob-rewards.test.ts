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
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { handleAdMobRewardRoutes } from "../src/routes/admob-rewards";

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

function createDb(seed?: { intents?: IntentRow[]; transactions?: TransactionRow[] }) {
  const intents = [...(seed?.intents ?? [])];
  const transactions = [...(seed?.transactions ?? [])];
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
        return {};
      }
    })
  }));
  return { db: { prepare }, intents, transactions };
}

function envWithDb(db: unknown) {
  return {
    DB: db,
    ADMOB_REWARDED_AD_UNIT_ID: "ca-app-pub-3940256099942544/1712485313"
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
      creditsGranted: 2,
      creditsRemaining: 32
    } as never);
    mockVerifySsv.mockResolvedValue(true);
  });

  it("creates a reward intent with a server-defined +2 credit grant and daily cap snapshot", async () => {
    const { db, intents } = createDb();
    const response = await handleAdMobRewardRoutes({
      request: new Request("https://kabuyomi.test/v1/admob/reward-intents", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: "{}"
      }),
      url: new URL("https://kabuyomi.test/v1/admob/reward-intents"),
      env: envWithDb(db),
      config: DEFAULT_REMOTE_CONFIG,
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
      expiresAt: expect.any(String)
    });
    expect(transactions).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      status: "granted",
      transaction_id: "tx-1",
      credits_remaining: 32
    });
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

  it("enforces the daily cap server-side before granting an SSV callback", async () => {
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
    expect(mockGrantRewardedAdCredits).not.toHaveBeenCalled();
    expect(intents.find((intent) => intent.id === "intent-4")).toMatchObject({
      status: "rejected",
      transaction_id: "tx-4"
    });
  });
});
