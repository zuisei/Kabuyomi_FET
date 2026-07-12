import { describe, expect, it, vi } from "vitest";
import type { Env, FilingCacheRecord } from "../src/env";
import {
  enqueueSummaryUpgrade,
  isFilingSummaryUpgradeAvailable
} from "../src/lib/filings/summary-upgrade";

describe("filing summary upgrade provider routing", () => {
  it("does not enqueue the Gemini-only upgrade when OpenAI is selected, even if a stale Gemini secret exists", () => {
    const waitUntil = vi.fn();
    const record = {
      summaryProvider: "fallback",
      contentMode: "full"
    } as FilingCacheRecord;
    const env = {
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-test-key",
      GEMINI_API_KEY: "stale-gemini-test-key"
    } as Env;

    enqueueSummaryUpgrade(record, env, { waitUntil });

    expect(isFilingSummaryUpgradeAvailable(env)).toBe(false);
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
});
