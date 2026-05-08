import { describe, expect, it } from "vitest";
import type { Env, FilingCacheRecord, SourceChunkRecord } from "../src/env";
import type { DeterministicChatAnswer } from "../src/lib/chat/deterministic";
import {
  chooseRetryReason,
  combineLlmUsage,
  fallbackReasonForMissingValidSourceIds,
  fallbackReasonForNoSources,
  retryContextMode,
  retryBlockedReasonForQuestion,
  shouldLetModelTryBeforeDeterministic,
  shouldPreferDeterministicBusinessOverview,
  shouldRetryModelAnswer
} from "../src/lib/chat/route-policy";

describe("chat route policy helpers", () => {
  it("lets Gemini try before deterministic only for model-worthy deterministic strategies", () => {
    expect(shouldLetModelTryBeforeDeterministic({ GEMINI_API_KEY: "key" } as Env, deterministic("business_overview"))).toBe(true);
    expect(shouldLetModelTryBeforeDeterministic({ GEMINI_API_KEY: "key" } as Env, deterministic("revenue_drivers"))).toBe(true);
    expect(shouldLetModelTryBeforeDeterministic({ GEMINI_API_KEY: "key" } as Env, deterministic("margin_snapshot"))).toBe(true);
    expect(shouldLetModelTryBeforeDeterministic({} as Env, deterministic("revenue_drivers"))).toBe(false);
  });

  it("chooses retry reasons without mixing retry policy into orchestration", () => {
    const filing = makeFiling([source("S1", "Available information on investor relations website.")]);

    expect(
      chooseRetryReason({
        filing,
        question: "売上成長の要因は？",
        modelResponse: { answer: "answer", sourceIds: ["S9"] },
        approvedSourceIds: []
      })
    ).toBe("invalid_source_id");

    expect(
      chooseRetryReason({
        filing,
        question: "売上成長の要因は？",
        modelResponse: { answer: "この決算資料の範囲では確認できません。", sourceIds: [] },
        approvedSourceIds: []
      })
    ).toBe("no_sources");

    expect(
      chooseRetryReason({
        filing,
        question: "売上成長の要因は？",
        modelResponse: { answer: "answer", sourceIds: ["S1"] },
        approvedSourceIds: ["S1"]
      })
    ).toBe("weak_grounding");
  });

  it("keeps retry gating and context mode decisions explicit", () => {
    expect(shouldRetryModelAnswer({ answer: "answer", sourceIds: ["S1"] }, "weak_grounding")).toBe(true);
    expect(shouldRetryModelAnswer({ answer: "answer", sourceIds: ["S1"], retryAttempt: 1 }, "weak_grounding")).toBe(false);
    expect(shouldRetryModelAnswer({ answer: "answer", sourceIds: ["S1"], geminiCalled: false }, "weak_grounding")).toBe(false);
    expect(shouldRetryModelAnswer({ answer: "answer", sourceIds: ["S1"] }, "gemini_timeout")).toBe(false);
    expect(retryContextMode("weak_grounding")).toBe("expanded");
    expect(retryContextMode("schema_invalid")).toBe("standard");
    expect(retryContextMode("gemini_timeout")).toBe("compact");
  });

  it("temporarily blocks retries for hard driver and durability intents", () => {
    expect(
      shouldRetryModelAnswer({ answer: "answer", sourceIds: ["S1"] }, "low_quality_answer", {
        questionIntent: "yoy_change",
        question: "売上成長の主な要因は？"
      })
    ).toBe(false);
    expect(
      retryBlockedReasonForQuestion("low_quality_answer", "yoy_change", "売上成長の主な要因は？")
    ).toBe("hard_intent_retry_disabled");
    expect(
      shouldRetryModelAnswer({ answer: "answer", sourceIds: ["S1"] }, "low_quality_answer", {
        questionIntent: "unknown",
        question: "これは一時要因？それとも構造的な変化？"
      })
    ).toBe(false);
    expect(
      shouldRetryModelAnswer({ answer: "answer", sourceIds: ["S1"] }, "low_quality_answer", {
        questionIntent: "business_overview",
        question: "何の会社？"
      })
    ).toBe(true);
  });

  it("keeps fallback reason and usage merge behavior stable", () => {
    expect(fallbackReasonForNoSources({ answer: "answer", sourceIds: [] }, "metrics_only")).toBe("metrics_only_insufficient");
    expect(fallbackReasonForNoSources({ answer: "answer", sourceIds: [] }, "full")).toBe("no_sources");
    expect(fallbackReasonForMissingValidSourceIds({ answer: "answer", sourceIds: ["S9"] }, "full")).toBe("invalid_source_id");
    expect(combineLlmUsage(undefined, undefined)).toBeUndefined();
    expect(combineLlmUsage([{ model: "a" } as never], [{ model: "b" } as never])).toEqual([{ model: "a" }, { model: "b" }]);
  });

  it("keeps deterministic business-overview repair policy stable", () => {
    expect(shouldPreferDeterministicBusinessOverview("売上高は 100億ドルです。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("この決算資料の範囲では確認できません。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("同社はクラウドサービスを提供する会社です。", true)).toBe(false);
    expect(shouldPreferDeterministicBusinessOverview("同社はクラウドサービスを提供する会社です。", false)).toBe(true);
  });
});

function deterministic(strategy: DeterministicChatAnswer["strategy"]): DeterministicChatAnswer {
  return {
    strategy,
    response: {
      answer: "answer",
      sources: []
    }
  };
}

function source(sourceId: string, text = "source text"): SourceChunkRecord {
  return {
    sourceId,
    sectionType: "md_a",
    sectionTitle: "Item 7",
    sourceLabel: `10-K ${sourceId}`,
    text,
    startOffset: 0,
    endOffset: text.length,
    sortOrder: Number(sourceId.replace(/\D/g, "")) || 1
  };
}

function makeFiling(sourceChunks: SourceChunkRecord[]): FilingCacheRecord {
  return {
    filingKey: "v1:0000000000:000000000000000001",
    ticker: "TST",
    companyName: "Test Corp",
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/filing",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks,
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}
