import { describe, expect, it, vi } from "vitest";
import type { Env, FilingCacheRecord } from "../src/env";
import {
  enqueueSummaryUpgrade,
  isFilingSummaryUpgradeAvailable
} from "../src/lib/filings/summary-upgrade";

function fallbackRecord(overrides: Partial<FilingCacheRecord> = {}): FilingCacheRecord {
  return {
    summaryProvider: "fallback",
    contentMode: "full",
    ...overrides
  } as FilingCacheRecord;
}

describe("filing summary upgrade provider routing", () => {
  // 2026-05-02 に LLM_PROVIDER を openai にして以降、このゲートが常に false になり
  // フォールバック要約が一度も差し替わらなくなっていた(本番 v9 は 30/30 がテンプレート)。
  it("enqueues the upgrade when OpenAI is selected and its key is configured", () => {
    const waitUntil = vi.fn();
    const env = {
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-test-key"
    } as Env;

    expect(isFilingSummaryUpgradeAvailable(env)).toBe(true);

    enqueueSummaryUpgrade(fallbackRecord(), env, { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  // 元の意図(古い Gemini 鍵に引きずられない)は維持する。
  // OpenAI が選ばれている以上、判定に使うのは OPENAI_API_KEY だけ。
  it("stays unavailable when OpenAI is selected but only a stale Gemini secret exists", () => {
    const waitUntil = vi.fn();
    const env = {
      LLM_PROVIDER: "openai",
      GEMINI_API_KEY: "stale-gemini-test-key"
    } as Env;

    expect(isFilingSummaryUpgradeAvailable(env)).toBe(false);

    enqueueSummaryUpgrade(fallbackRecord(), env, { waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("keeps the legacy Gemini upgrade available only when that provider and key are both configured", () => {
    expect(
      isFilingSummaryUpgradeAvailable({
        LLM_PROVIDER: "gemini-legacy",
        GEMINI_API_KEY: "gemini-test-key"
      } as Env)
    ).toBe(true);
    expect(isFilingSummaryUpgradeAvailable({ LLM_PROVIDER: "gemini-legacy" } as Env)).toBe(false);
  });

  it("never upgrades when the provider is disabled", () => {
    expect(
      isFilingSummaryUpgradeAvailable({
        LLM_PROVIDER: "disabled",
        OPENAI_API_KEY: "openai-test-key",
        GEMINI_API_KEY: "gemini-test-key"
      } as Env)
    ).toBe(false);
  });

  it("skips records that already carry a non-fallback summary", () => {
    const waitUntil = vi.fn();
    const env = { LLM_PROVIDER: "openai", OPENAI_API_KEY: "openai-test-key" } as Env;

    enqueueSummaryUpgrade(fallbackRecord({ summaryProvider: "openai" }), env, { waitUntil });
    enqueueSummaryUpgrade(fallbackRecord({ summaryProvider: "gemini" }), env, { waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("skips metrics-only records because the content upgrade regenerates their summary", () => {
    const waitUntil = vi.fn();
    const env = { LLM_PROVIDER: "openai", OPENAI_API_KEY: "openai-test-key" } as Env;

    enqueueSummaryUpgrade(fallbackRecord({ contentMode: "metrics_only" }), env, { waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
