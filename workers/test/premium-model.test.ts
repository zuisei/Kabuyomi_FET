import { describe, expect, it } from "vitest";
import { chatEnvForIdentity, identityUsesPremiumChatModel, premiumChatModelEnabled } from "../src/lib/chat/premium-model";
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

  it("does not mutate the original env", () => {
    const env = { ...base };
    chatEnvForIdentity(env, { plan: "pro" });
    expect(env.OPENAI_CHAT_MODEL).toBe("gpt-5-nano");
  });
});
