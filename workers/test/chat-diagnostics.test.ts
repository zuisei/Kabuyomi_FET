import { describe, expect, it } from "vitest";
import type { FilingCacheRecord } from "../src/env";
import {
  buildAnswerQualityFlags,
  buildChatQualityPipelinePayload,
  buildContextDebugFields,
  estimateTokenCountFromChars,
  resolveChatResponsePath,
  selectedResponseSourceCharCount
} from "../src/lib/chat/diagnostics";
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
      answerQualityFlags: ["context_rewritten", "fallback_path", "fallback:weak_grounding", "invalid_source_ids", "model_retry_used"],
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
      selectedSourceLabels: ["10-Q Part I Item 2", "10-Q XBRL 売上高"]
    });
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
