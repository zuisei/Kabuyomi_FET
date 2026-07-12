import { describe, expect, it } from "vitest";
import type { FilingCacheRecord } from "../src/env";
import {
  buildAnswerQualityFlags,
  buildChatQualityPipelinePayload,
  buildContextDebugFields,
  buildModelAttemptDebugFields,
  estimateTokenCountFromChars,
  resolveChatResponsePath,
  selectedResponseSourceCharCount
} from "../src/lib/chat/diagnostics";
import { classifyLowQualityChatAnswer } from "../src/clients/gemini/chat-quality";
import type { ChatContextPack } from "../src/lib/chat/context-pack";
import type { ChatResponsePayload } from "../src/lib/chat/grounding";

describe("chat diagnostics helpers", () => {
  it("builds answer quality flags without changing the existing flag names", () => {
    const answer: ChatResponsePayload = {
      answer: "この決算資料の範囲では確認できません。",
      sources: [],
      responsePath: "fallback",
      debug: {
        fallbackReason: "weak_grounding",
        sourceIdsValid: false,
        contentMode: "metrics_only",
        retryAttempt: 1,
        geminiCalled: true,
        geminiSucceeded: false
      }
    };

    expect(buildAnswerQualityFlags(answer, { contextApplied: true })).toEqual([
      "context_rewritten",
      "fallback_path",
      "fallback:weak_grounding",
      "invalid_source_ids",
      "no_final_sources",
      "metrics_only_context",
      "model_retry_used",
      "gemini_failed",
      "context_unavailable_answer"
    ]);
  });

  it("builds the chat quality pipeline payload with the existing log field shape", () => {
    const answer: ChatResponsePayload = {
      answer: "Debug answer",
      sources: [
        {
          sourceId: "S1",
          sourceKind: "sec_filing",
          sourceStrength: "filing_primary",
          sectionType: "md_a",
          sourceLabel: "10-Q Part I Item 2",
          excerpt: "source"
        }
      ],
      responsePath: "fallback",
      debug: {
        questionIntent: "mda_summary",
        responsePath: "fallback",
        fallbackReason: "weak_grounding",
        sourceIdsValid: false,
        selectedSourceCount: 2,
        selectedSourceCharCount: 1234,
        estimatedContextTokens: 309,
        selectedSourceIds: ["S1", "S2"],
        selectedSourceLabels: ["10-Q Part I Item 2", "10-Q XBRL 売上高"],
        selectedSourceTypes: ["md_a", "xbrl_metric"],
        selectedSourceSectionFamilies: ["mda", "xbrl_metric"],
        selectedSourceFamilies: ["mda", "xbrl_metric"],
        selectedSourceExcerpts: ["source preview"],
        selectedSourceTextPreview: ["short source preview"],
        sourceGateEvidenceSlots: { companyExplainedDrivers: [] },
        modelRawAnswerPreview: "raw model answer",
        lowQualityReason: "revenue_driver_declined_despite_context",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        retryAttempt: 1,
        retryReason: "weak_grounding",
        totalPipelineMs: 321,
        contextBuildMs: 3,
        geminiFirstCallMs: 240,
        fallbackBuildMs: 12,
        webSupplementMs: 5,
        groundingMs: 1
      }
    };

    expect(
      buildChatQualityPipelinePayload({
        filing: makeFiling(),
        originalQuestion: "なぜ？",
        rewrittenQuestion: "売上高が変化した理由は？",
        answer,
        latencyMs: 42,
        modelName: "gemini-2.5-flash",
        contextMessageCount: 2
      })
    ).toMatchObject({
      ticker: "ORCL",
      filingKey: "filing-1",
      originalQuestion: "なぜ？",
      rewrittenQuestion: "売上高が変化した理由は？",
      questionIntent: "mda_summary",
      responsePath: "fallback",
      fallbackReason: "weak_grounding",
      selectedSourceCount: 2,
      selectedSourceCharCount: 1234,
      estimatedContextTokens: 309,
      modelName: "gemini-2.5-flash",
      latencyMs: 42,
      selectedSourceIds: ["S1", "S2"],
      selectedSourceLabels: ["10-Q Part I Item 2", "10-Q XBRL 売上高"],
      selectedSourceTypes: ["md_a", "xbrl_metric"],
      selectedSourceSectionFamilies: ["mda", "xbrl_metric"],
      selectedSourceFamilies: ["mda", "xbrl_metric"],
      selectedSourceExcerpts: ["source preview"],
      selectedSourceTextPreview: ["short source preview"],
      sourceGateEvidenceSlots: { companyExplainedDrivers: [] },
      modelRawAnswerPreview: "raw model answer",
      lowQualityReason: "revenue_driver_declined_despite_context",
      answerQualityFlags: ["context_rewritten", "fallback_path", "fallback:weak_grounding", "low_quality:revenue_driver_declined_despite_context", "invalid_source_ids", "model_retry_used", "fallback_kind_missing"],
      sourceIdsValid: false,
      geminiCalled: true,
      geminiSucceeded: true,
      schemaValid: true,
      retryAttempt: 1,
      retryReason: "weak_grounding",
      totalPipelineMs: 321,
      contextBuildMs: 3,
      geminiFirstCallMs: 240,
      fallbackBuildMs: 12,
      webSupplementMs: 5,
      groundingMs: 1,
      contextApplied: true,
      contextMessageCount: 2,
      finalSourceIds: ["S1"],
      finalSourceLabels: ["10-Q Part I Item 2"]
    });
  });

  it("falls back to final source chars and estimated tokens when context debug fields are absent", () => {
    const answer: ChatResponsePayload = {
      answer: "answer",
      sources: [
        {
          sourceId: "S1",
          sourceKind: "sec_filing",
          sourceStrength: "filing_primary",
          sectionType: "md_a",
          sourceLabel: "10-Q",
          excerpt: "12345678"
        }
      ],
      responsePath: "gemini"
    };

    expect(resolveChatResponsePath(answer)).toBe("gemini");
    expect(selectedResponseSourceCharCount(answer)).toBe(8);
    expect(estimateTokenCountFromChars(8)).toBe(2);
    expect(
      buildChatQualityPipelinePayload({
        filing: makeFiling(),
        originalQuestion: "Q",
        rewrittenQuestion: "Q",
        answer,
        latencyMs: 10,
        modelName: "gemini-2.5-flash",
        contextMessageCount: 0
      })
    ).toMatchObject({
      selectedSourceCount: 1,
      selectedSourceCharCount: 8,
      estimatedContextTokens: 2,
      answerQualityFlags: []
    });
  });

  it("extracts context debug fields from a context pack", () => {
    expect(buildContextDebugFields(makeContextPack())).toEqual({
      contextTokenBudget: 6_000,
      selectedSourceCount: 2,
      selectedSourceCharCount: 1234,
      estimatedContextTokens: 309,
      sourceSelectionStrategy: "mda_summary:standard:intent_ranked",
      selectedSourceIds: ["S1", "S2"],
      selectedSourceLabels: ["10-Q Part I Item 2", "10-Q XBRL 売上高"],
      selectedSourceTypes: ["md_a", "xbrl_metric"],
      selectedSourceSectionFamilies: ["mda", "xbrl_metric"],
      selectedSourceFamilies: ["mda", "xbrl_metric"],
      selectedSourceExcerpts: ["source", "metric"],
      selectedSourceTextPreview: ["source", "metric"]
    });
  });

  it("extracts retry diagnostics and marks wasted retries", () => {
    expect(
      buildModelAttemptDebugFields({
        answer: "fallback",
        sourceIds: ["S1"],
        requestedModelName: "gpt-5.4-nano",
        effectiveModelName: "gpt-5.4-nano",
        requestedReasoningEffort: "none",
        effectiveReasoningEffort: "none",
        reasoningEffortInvalid: false,
        retryDiagnostics: {
          retryAttempted: true,
          retryAllowed: true,
          retryReason: "low_quality_answer",
          retryBlockedReason: null,
          retryOutcome: "fallback",
          retryWasted: true,
          firstCallFailureKind: "low_quality_answer"
        }
      })
    ).toMatchObject({
      retryAttempted: true,
      retryAllowed: true,
      retryBlockedReason: null,
      retryOutcome: "fallback",
      retryWasted: true,
      firstCallFailureKind: "low_quality_answer",
      requestedModelName: "gpt-5.4-nano",
      effectiveModelName: "gpt-5.4-nano",
      requestedReasoningEffort: "none",
      effectiveReasoningEffort: "none",
      reasoningEffortInvalid: false,
      sourceGateApplied: false,
      sourceGateSufficient: null,
      evidenceFallbackUsed: false,
      fallbackKind: "none"
    });

    expect(
      buildAnswerQualityFlags(
        {
          answer: "answer",
          sources: [],
          responsePath: "fallback",
          debug: {
            retryAttempted: true,
            retryWasted: true,
            retryBlockedReason: "hard_intent_retry_disabled"
          }
        },
        { contextApplied: false }
      )
    ).toEqual([
      "fallback_path",
      "no_final_sources",
      "retry_attempted",
      "retry_wasted",
      "retry_blocked:hard_intent_retry_disabled"
    ]);
  });

  it("classifies revenue-driver low-quality refusals without changing the guard outcome", () => {
    const filing = makeFiling();
    filing.sourceChunks = [
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Segment and revenue context",
        text: "Comparable sales increased and eCommerce sales contributed to sales growth.",
        startOffset: 0,
        endOffset: 75,
        sortOrder: 1
      }
    ];

    expect(
      classifyLowQualityChatAnswer(
        {
          question: "売上成長の主な要因は？",
          filing,
          contextPack: {
            ...makeContextPack(),
            questionIntent: "yoy_change",
            sourceChunks: filing.sourceChunks
          }
        },
        "売上高は増加しましたが、具体的な売上成長の要因は本文で説明されていません。",
        ["S1"]
      )
    ).toBe("revenue_driver_declined_despite_context");
  });

  it("does not classify net-interest revenue durability as a profit-cause answer", () => {
    const filing = makeFiling();
    filing.sourceChunks = [
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Revenue driver discussion",
        text: "Net interest income was up 3%, driven by higher Markets net interest income and higher wholesale deposit balances, partly offset by deposit margin compression and lower rates.",
        startOffset: 0,
        endOffset: 160,
        sortOrder: 1
      }
    ];

    expect(
      classifyLowQualityChatAnswer(
        {
          question: "前問で挙げた売上高の要因（net interest income、deposits）は一時的ですか？",
          filing,
          contextPack: {
            ...makeContextPack(),
            questionIntent: "yoy_change",
            sourceChunks: filing.sourceChunks
          }
        },
        "本文で説明されている要因: NII は市場関連収益の増加やカードサービスの残高増、wholesale deposit の増加などで3%増。NII excluding Markets は横ばいで、低金利とdeposit margin compressionは相殺要因です。継続性は断定できません。",
        ["S1"]
      )
    ).toBeNull();
  });

  it("does not reject margin-driver answers that pair metrics with margin explanation terms", () => {
    const filing = makeFiling();
    filing.sourceChunks = [
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Profitability context",
        text: "Operating income increased while the discussion covers pricing, sales mix, operating expenses and segment margin trends.",
        startOffset: 0,
        endOffset: 118,
        sortOrder: 1
      },
      {
        sourceId: "S2",
        sectionType: "xbrl_metric",
        sectionTitle: "XBRL",
        sourceLabel: "XBRL Operating income",
        text: "営業利益: 29825000000 USD / 比較値: 29348000000 / YoY: 1.6%",
        startOffset: 0,
        endOffset: 68,
        sortOrder: 2
      }
    ];

    expect(
      classifyLowQualityChatAnswer(
        {
          question: "利益率が改善、または悪化した理由は？",
          filing,
          contextPack: {
            ...makeContextPack(),
            questionIntent: "margin_profitability",
            sourceChunks: filing.sourceChunks
          }
        },
        "売上高は7131.6億ドル、営業利益は298.3億ドル、純利益は218.9億ドルです。利益率の変動要因として、販売構成の変化、価格、コスト構造、営業費用の動向を確認する必要があります。",
        ["S1", "S2"]
      )
    ).toBeNull();
  });

  it("does not reject liquidity/debt answers that pair cash-flow metrics with debt caveats", () => {
    const filing = makeFiling();
    filing.sourceChunks = [
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Liquidity and Capital Resources",
        sourceLabel: "10-K Cash flow / liquidity context",
        text: "Liquidity and capital resources discussion describes operating cash flow, cash requirements, debt maturities and credit facilities.",
        startOffset: 0,
        endOffset: 126,
        sortOrder: 1
      },
      {
        sourceId: "S2",
        sectionType: "xbrl_metric",
        sectionTitle: "XBRL",
        sourceLabel: "XBRL Operating cash flow",
        text: "営業CF: 51970000000 USD / 比較値: 55022000000 / YoY: -5.5%",
        startOffset: 0,
        endOffset: 65,
        sortOrder: 2
      }
    ];

    expect(
      classifyLowQualityChatAnswer(
        {
          question: "資金繰りや負債に懸念はある？",
          filing,
          contextPack: {
            ...makeContextPack(),
            questionIntent: "liquidity_debt",
            sourceChunks: filing.sourceChunks
          }
        },
        "営業CFは前年同期比5.5%減の519.7億ドルです。資金繰りの判断には、現金残高、流動性、負債返済、満期スケジュール、信用枠の確認が必要です。現時点では、営業CFは確認できますが、負債条件だけでは懸念を断定しません。",
        ["S1", "S2"]
      )
    ).toBeNull();
  });
});

function makeFiling(): FilingCacheRecord {
  return {
    filingKey: "filing-1",
    ticker: "ORCL",
    companyName: "Oracle Corp",
    cik: "0001341439",
    formType: "10-Q",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/filing.htm",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: [],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-29T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}

function makeContextPack(): ChatContextPack {
  return {
    questionIntent: "mda_summary",
    contentMode: "full",
    metrics: [],
    verifiedFacts: [],
    sourceChunks: [
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Part I, Item 2",
        sourceLabel: "10-Q Part I Item 2",
        text: "source",
        startOffset: 0,
        endOffset: 6,
        sortOrder: 1
      },
      {
        sourceId: "S2",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "10-Q XBRL 売上高",
        text: "metric",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 2
      }
    ],
    contextTokenBudget: 6_000,
    selectedSourceCount: 2,
    sourceSelectionStrategy: "mda_summary:standard:intent_ranked",
    selectionDiagnostics: {
      candidateSourceCount: 4,
      selectedSourceCount: 2,
      selectedSourceCharCount: 1234,
      avgSelectedSourceChars: 617,
      contextTokenBudget: 6_000,
      estimatedContextTokens: 309,
      sourceSelectionStrategy: "mda_summary:standard:intent_ranked",
      rejectedShortCount: 0,
      rejectedTableFragmentCount: 0,
      rejectedLowTextQualityCount: 0,
      sectionHitCountBusiness: 0,
      sectionHitCountRisk: 0,
      sectionHitCountMda: 1
    }
  };
}
