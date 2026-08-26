import { describe, expect, it } from "vitest";
import { chatCreditCostForIdentity, chatEnvForIdentity, identityUsesPremiumChatModel, premiumChatModelEnabled } from "../src/lib/chat/premium-model";
import type { Env } from "../src/env";

// 2026-08-24 オーナー「サブスクを買ってもクレジットだけだと特別感がない」。
// 有料プランの実利その1 = 上位モデルでの回答。無料は標準のまま、
// OPENAI_CHAT_MODEL_PREMIUM が未設定なら誰も変わらない(本番の既定)。
describe("premium chat model lane", () => {
  const base = { OPENAI_CHAT_MODEL: "gpt-5-nano", OPENAI_CHAT_MODEL_PREMIUM: "gpt-5.6-luna" } as Env;

  it("is off for everyone when the premium model is not configured", () => {
    const env = { OPENAI_CHAT_MODEL: "gpt-5-nano" } as Env;
    expect(premiumChatModelEnabled(env)).toBe(false);
    expect(chatEnvForIdentity(env, { plan: "pro" }).OPENAI_CHAT_MODEL).toBe("gpt-5-nano");
  });

  it("keeps free users on the standard model", () => {
    expect(identityUsesPremiumChatModel({ plan: "free" })).toBe(false);
    expect(chatEnvForIdentity(base, { plan: "free" }).OPENAI_CHAT_MODEL).toBe("gpt-5-nano");
  });

  it("routes every paid plan and dev access to the premium model", () => {
    for (const plan of ["lite", "pro", "pro_max"]) {
      expect(chatEnvForIdentity(base, { plan }).OPENAI_CHAT_MODEL).toBe("gpt-5.6-luna");
    }
    expect(chatEnvForIdentity(base, { plan: "free", accessMode: "dev_unlimited" }).OPENAI_CHAT_MODEL).toBe("gpt-5.6-luna");
  });

  it("keeps the benchmark identity on the standard model so the LKG stays comparable", () => {
    const bench = { plan: "pro", accessMode: "dev_unlimited", quotaSubject: "pro:test-automation:abc" };
    expect(identityUsesPremiumChatModel(bench)).toBe(false);
    expect(chatEnvForIdentity(base, bench).OPENAI_CHAT_MODEL).toBe("gpt-5-nano");
  });

  it("charges the premium price only on the premium lane", () => {
    // 標準 2 / 上位 5(既定)。ベンチと無料は premium 設定下でも標準単価のまま。
    expect(chatCreditCostForIdentity(base, { plan: "pro" })).toBe(5);
    expect(chatCreditCostForIdentity(base, { plan: "free" })).toBe(2);
    expect(chatCreditCostForIdentity(base, { plan: "pro", quotaSubject: "pro:test-automation:x" })).toBe(2);
    expect(chatCreditCostForIdentity({ OPENAI_CHAT_MODEL: "gpt-5-nano" } as Env, { plan: "pro" })).toBe(2);
    expect(chatCreditCostForIdentity({ ...base, PREMIUM_CHAT_CREDIT_COST: "8" } as Env, { plan: "pro" })).toBe(8);
  });

  it("does not mutate the original env", () => {
    const env = { ...base };
    chatEnvForIdentity(env, { plan: "pro" });
    expect(env.OPENAI_CHAT_MODEL).toBe("gpt-5-nano");
  });

  /// dev は unmetered で 1 クレジットも減らない。なのに単価を報告していたので、
  /// 端末の「残高 >= 単価」判定に引っかかって**2 問目が送れなくなっていた**
  /// (2026-08-25 実機で発覚)。払わない相手の単価は 0。
  it("charges nothing to an identity whose reservation is unmetered", () => {
    const env = { OPENAI_CHAT_MODEL: "gpt-5-nano", OPENAI_CHAT_MODEL_PREMIUM: "gpt-5.4" } as never;
    expect(chatCreditCostForIdentity(env, { plan: "pro", accessMode: "dev_unlimited" })).toBe(0);
    // 上位モデルは使う。単価だけが 0。
    expect(identityUsesPremiumChatModel({ plan: "pro", accessMode: "dev_unlimited" })).toBe(true);
  });

  it("still charges an ordinary paid identity the premium price", () => {
    const env = { OPENAI_CHAT_MODEL: "gpt-5-nano", OPENAI_CHAT_MODEL_PREMIUM: "gpt-5.4" } as never;
    expect(chatCreditCostForIdentity(env, { plan: "pro" })).toBe(5);
    expect(chatCreditCostForIdentity(env, { plan: "free" })).toBe(2);
  });
});
