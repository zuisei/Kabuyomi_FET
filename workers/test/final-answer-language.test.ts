import { describe, expect, it } from "vitest";
import type { Env, FilingCacheRecord, SourceChunkRecord } from "../src/env";
import {
  buildJapaneseLanguageGuardFallback,
  checkFinalAnswerJapaneseOnly
} from "../src/lib/chat/final-answer-language";
import { finalizeChatResponse } from "../src/lib/chat/response-finalizer";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { createChatTimingTracker } from "../src/lib/chat/timing";

describe("Japanese-only final answer guard", () => {
  it("rejects mostly English sentences and raw SEC excerpt fragments", () => {
    expect(checkFinalAnswerJapaneseOnly("Operating within the financial services industry on a global basis presents significant risks to the company.").ok).toBe(false);
    expect(checkFinalAnswerJapaneseOnly("利益率driverとして確認できるのは、s; • Risks related to tax and regulatory compliance audits; • Any change in t...です。").labels).toEqual(expect.arrayContaining([
      "raw_english_excerpt",
      "english_source_excerpt_as_driver",
      "final_answer_language_violation"
    ]));
  });

  it("allows Japanese answers with short financial KPI terms", () => {
    const answer = "主因を見るには、net interest income、noninterest income、provision for credit losses、segment results を追加確認する必要があります。";
    expect(checkFinalAnswerJapaneseOnly(answer).ok).toBe(true);
  });

  it("builds a safe Japanese fallback without quoting raw English excerpts", () => {
    const fallback = buildJapaneseLanguageGuardFallback({
      questionIntent: "margin_durability_followup",
      missingSourceTypes: ["segment margin"]
    });
    expect(fallback).toContain("利益率の方向");
    expect(fallback).not.toMatch(/[A-Z][A-Za-z]+(?:\s+[A-Za-z]+){7,}/);
    expect(checkFinalAnswerJapaneseOnly(fallback).ok).toBe(true);
  });

  it("rewrites unsafe runtime answers to language_guard_fallback", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？",
      response: {
        answer: "前問のdriverは、Operating within the financial services industry on a global basis presents significant risks...",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "gemini",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "gemini",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackKind).toBe("language_guard_fallback");
    expect(response.debug?.finalAnswerLanguageLabels).toEqual(expect.arrayContaining([
      "final_answer_language_violation",
      "answer_rewritten_to_japanese_fallback"
    ]));
    expect(response.debug?.languageGuardChecked).toBe(true);
    expect(response.debug?.languageGuardOk).toBe(false);
    expect(response.debug?.languageGuardFallbackUsed).toBe(true);
    expect(response.debug?.languageGuardFallbackKind).toBe("language_guard_fallback");
    expect(response.debug?.languageGuardViolationLabels).toEqual(expect.arrayContaining([
      "final_answer_language_violation",
      "answer_rewritten_to_japanese_fallback"
    ]));
    expect(response.debug?.originalAnswerBeforeLanguageGuardLength).toBeGreaterThan(0);
    expect(response.debug?.originalAnswerBeforeLanguageGuardSample).not.toContain("Operating within the financial services industry");
    expect(response.answer).toContain("前問の具体的なdriver");
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("rewrites globally banned generic phrases before returning a final answer", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "資金繰りや負債に懸念はある？",
      response: {
        answer: "具体的な負債額や資金繰りの詳細なリスクについては、この資料の範囲では確認できません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "gemini",
      debug: {
        questionIntent: "liquidity_debt",
        responsePath: "gemini",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("gemini");
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.answer).not.toContain("この資料の範囲では確認できません");
    expect(response.answer).toContain("debt note や liquidity discussion");
  });

  it("normalizes fallbackKind for fallback rows", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "資金繰りは？",
      response: {
        answer: "選択されたsourceだけでは、この質問に直接答えるための具体的な説明を十分に確認できません。追加で必要なのは liquidity discussion です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "liquidity_debt",
        responsePath: "fallback",
        fallbackReason: "gemini_timeout",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: false,
        schemaValid: true,
        fallbackKind: "none"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackKind).toBe("non_hard_model_timeout");
    expect(response.debug?.responsePathFallbackButKindNone).toBe(false);
  });

  it("replaces business-model api_error revenue snapshots with source-insufficient fallback text", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "この会社は何で儲けている？",
      response: {
        answer: "売上高は 10.4億ドル で、前年同期比 3.1%減 です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "business_model",
        responsePath: "fallback",
        fallbackReason: "gemini_api_error",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: false,
        schemaValid: false,
        fallbackKind: "api_error"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackKind).toBe("api_error");
    expect(response.answer).toContain("事業内容や収益源");
    expect(response.answer).toContain("Business");
    expect(response.answer).toContain("Segment Information");
    expect(response.answer).toContain("Revenue Note");
    expect(response.answer).toContain("売上高だけでは");
    expect(response.answer).not.toBe("売上高は 10.4億ドル で、前年同期比 3.1%減 です。");
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("replaces casual business-model api_error snapshots even when debug intent is missing", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "なにで稼いでんのこの会社",
      response: {
        answer: "売上高は 10.4億ドル で、前年同期比 3.1%減 です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        responsePath: "fallback",
        fallbackReason: "gemini_api_error",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: false,
        schemaValid: false,
        fallbackKind: "api_error",
        geminiApiErrorKind: "rate_limit"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackKind).toBe("api_error");
    expect(response.debug?.sourceIdsValid).toBe(true);
    expect(response.debug?.languageGuardChecked).toBe(true);
    expect(response.answer).toContain("事業内容や収益源");
    expect(response.answer).toContain("Business");
    expect(response.answer).toContain("Segment Information");
    expect(response.answer).toContain("Revenue Note");
    expect(response.answer).toContain("売上高だけでは");
    expect(response.answer).not.toMatch(/^売上高は/);
  });

  it("replaces casual business-model follow-up api_error snapshots", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "つまり何屋なの？",
      response: {
        answer: "売上高は 29億ドル で、前年同期比 18.5%増 です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "business_model",
        responsePath: "fallback",
        fallbackReason: "gemini_api_error",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: false,
        schemaValid: false,
        fallbackKind: "api_error",
        geminiApiErrorKind: "rate_limit"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.debug?.fallbackKind).toBe("api_error");
    expect(response.answer).toContain("事業内容や収益源");
    expect(response.answer).toContain("MD&A");
    expect(response.answer).not.toMatch(/^売上高は/);
  });

  it("does not rewrite revenue snapshot answers for revenue_snapshot questions", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "直近決算の売上はどうだった？",
      response: {
        answer: "売上高は 10.4億ドル で、前年同期比 3.1%減 です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "revenue_snapshot",
        responsePath: "fallback",
        fallbackReason: "gemini_api_error",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: false,
        schemaValid: false,
        fallbackKind: "api_error",
        geminiApiErrorKind: "rate_limit"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.debug?.fallbackKind).toBe("api_error");
    expect(response.debug?.languageGuardChecked).toBe(true);
    expect(response.answer).toBe("売上高は 10.4億ドル で、前年同期比 3.1%減 です。");
  });
});

function makeFiling(): FilingCacheRecord {
  const chunk: SourceChunkRecord = {
    sourceId: "S1",
    sectionType: "md_a",
    sectionTitle: "Item 7",
    sourceLabel: "10-K Item 7",
    text: "Liquidity discussion mentions cash and debt.",
    startOffset: 0,
    endOffset: 45,
    sortOrder: 1
  };
  return {
    filingKey: "v1:test",
    ticker: "MS",
    companyName: "Morgan Stanley",
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://www.sec.gov/test.htm",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: [chunk],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}

function sourceToEvidence(source: SourceChunkRecord) {
  return {
    sourceId: source.sourceId,
    sourceKind: "sec_filing" as const,
    sourceStrength: "filing_primary" as const,
    sectionType: source.sectionType,
    sourceLabel: source.sourceLabel,
    excerpt: source.text
  };
}
