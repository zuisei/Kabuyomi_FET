import { describe, expect, it } from "vitest";
import type { Env, FilingCacheRecord, SourceChunkRecord } from "../src/env";
import { buildDeterministicMetricAnswer, type DeterministicChatAnswer } from "../src/lib/chat/deterministic";
import {
  chooseRetryReason,
  combineLlmUsage,
  fallbackReasonForMissingValidSourceIds,
  fallbackReasonForNoSources,
  retryContextMode,
  retryBlockedReasonForQuestion,
  shouldLetModelTryBeforeDeterministic,
  shouldPreferDeterministicBusinessOverview,
  shouldPreferDeterministicRevenueDrivers,
  shouldRetryModelAnswer
} from "../src/lib/chat/route-policy";

describe("chat route policy helpers", () => {
  it("lets Gemini try before deterministic only for model-worthy deterministic strategies", () => {
    expect(shouldLetModelTryBeforeDeterministic({ GEMINI_API_KEY: "key" } as Env, deterministic("business_overview"))).toBe(false);
    expect(shouldLetModelTryBeforeDeterministic({ GEMINI_API_KEY: "key" } as Env, deterministic("revenue_drivers"))).toBe(true);
    expect(shouldLetModelTryBeforeDeterministic({ GEMINI_API_KEY: "key" } as Env, deterministic("margin_snapshot"))).toBe(true);
    expect(shouldLetModelTryBeforeDeterministic({} as Env, deterministic("revenue_drivers"))).toBe(false);
    expect(shouldLetModelTryBeforeDeterministic({
      LLM_PROVIDER: "unsupported",
      GEMINI_API_KEY: "must-not-be-used"
    } as never, deterministic("revenue_drivers"))).toBe(false);
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

  it("still retries invalid source IDs for hard driver intents", () => {
    expect(
      shouldRetryModelAnswer({ answer: "answer", sourceIds: ["S9"] }, "invalid_source_id", {
        questionIntent: "yoy_change",
        question: "売上成長の主な要因は？"
      })
    ).toBe(true);
    expect(
      retryBlockedReasonForQuestion("invalid_source_id", "yoy_change", "売上成長の主な要因は？")
    ).toBeNull();
    expect(retryContextMode("invalid_source_id")).toBe("expanded");
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
    expect(shouldPreferDeterministicBusinessOverview("この資料だけだと会社固有の売上要因までは追いきれません。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("MSFTは主に製品・サービスの提供を通じて売上を稼いでいます。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("主な収益源は石油・ガス・ petrochemical を中心とした事業による売上です。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("NVIDIAは主にデータセンター向けのCompute & Networkingと Graphics の製品・ソリューションを通じて売上を得ています。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("同社は主にMEMORY製品を中心に売上を上げています。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("この会社は主に石油・ガス・石化製品の販売を通じて収益を得ています。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("この会社は主に建設機械の製品と関連サービスで儲けています。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("主な収益源は小売事業の売上高です。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("主な収益源はデータセンター向け製品と関連ソリューションの販売です。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("主な収益源はメモリ製品の売上です。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("この会社の主な収益源は石油・ガス・石油化学製品の販売です。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("同社は主にメモリ製品の売上を通じて収益を上げています。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("COCA COLA COは主に飲料の販売から収益を得ています。", true)).toBe(true);
    expect(shouldPreferDeterministicBusinessOverview("同社はクラウドサービスを提供する会社です。", true)).toBe(false);
    expect(shouldPreferDeterministicBusinessOverview("同社はクラウドサービスを提供する会社です。", false)).toBe(true);
  });

  it("uses deterministic revenue-driver repair only for weak remote driver answers", () => {
    expect(shouldPreferDeterministicRevenueDrivers("会社固有の売上要因までは十分に特定できません。", true)).toBe(true);
    expect(shouldPreferDeterministicRevenueDrivers("確認すべき箇所は、経営陣による業績説明です。", true)).toBe(true);
    expect(shouldPreferDeterministicRevenueDrivers("本文では、サービス売上とiPhoneが売上増を支えたと説明されています。", true)).toBe(false);
    expect(shouldPreferDeterministicRevenueDrivers("本文では、サービス売上とiPhoneが売上増を支えたと説明されています。", false)).toBe(true);
    expect(shouldPreferDeterministicRevenueDrivers("売上高は増加しました。", true, "low_quality_answer")).toBe(true);
  });

  /**
   * This used to assert the opposite: a filing whose only text is "Revenue was
   * 100. Net income was 10." produced 「クラウド、Microsoft 365 ...」 out of a
   * ticker-keyed constant table, with this filing's source chunks attached as
   * citations. Nothing about Microsoft 365 was read from the filing.
   *
   * The deterministic layer now declines. Declining is what lets the pipeline
   * reach the model path, which is source-validated separately.
   */
  it("produces no business overview when the filing text cannot support one", () => {
    const filing = makeFiling([source("S1", "Revenue was 100. Net income was 10.")], {
      ticker: "MSFT",
      companyName: "Microsoft"
    });

    const result = buildDeterministicMetricAnswer(filing, "どんな会社ですか？");

    expect(result?.strategy).not.toBe("business_overview");
    expect(result?.response.answer ?? "").not.toContain("Microsoft 365");
    expect(result?.response.answer ?? "").not.toContain("クラウド");
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

function makeFiling(
  sourceChunks: SourceChunkRecord[],
  overrides: Partial<Pick<FilingCacheRecord, "ticker" | "companyName">> = {}
): FilingCacheRecord {
  return {
    filingKey: "v1:0000000000:000000000000000001",
    ticker: overrides.ticker ?? "TST",
    companyName: overrides.companyName ?? "Test Corp",
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
