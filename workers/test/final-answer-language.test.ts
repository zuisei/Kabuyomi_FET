import { describe, expect, it } from "vitest";
import type { Env, FilingCacheRecord, SourceChunkRecord } from "../src/env";
import {
  buildJapaneseLanguageGuardFallback,
  buildJapaneseLanguageGuardRepair,
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

  it("allows Japanese CAT durability wording with bounded English financial terms", () => {
    const answer = "CATのConstruction Industriesでは、backlog、dealer inventory、price realization の推移を見る必要があります。継続性は提出資料だけでは断定しません。";
    expect(checkFinalAnswerJapaneseOnly(answer).ok).toBe(true);
  });

  it("repairs supported CAT durability answers without allowing raw English excerpts", () => {
    const repair = buildJapaneseLanguageGuardRepair({
      question: "その要因は一時的？それとも続きそう？",
      questionIntent: "driver_durability_followup",
      sourceGateSufficient: true,
      sourceGateEvidenceSlots: {
        companyExplainedDrivers: [
          {
            category: "industrial",
            driver: "Total sales and revenues for 2025 were $67.589 billion, an increase of $2.780 billion, or 4 percent. The increase reflected higher sales volume, partially offset by unfavorable price realization and higher sales of equipment to end users.",
            sourceIds: ["S1"],
            confidence: "high"
          },
          {
            category: "industrial",
            driver: "In the first quarter of 2026 we expect stronger sales and revenues primarily due to higher sales volume and favorable price realization, partially offset by changes in dealer inventory.",
            sourceIds: ["S3"],
            confidence: "high"
          }
        ],
        segmentOrBusinessSignals: []
      }
    });

    expect(repair).toContain("販売数量");
    expect(repair).toContain("価格実現");
    expect(repair).toContain("dealer inventory");
    expect(repair).toContain("継続性は断定しません");
    expect(repair).not.toContain("Total sales and revenues");
    expect(repair).not.toContain("stronger sales and revenues");
    expect(checkFinalAnswerJapaneseOnly(repair ?? "").ok).toBe(true);
  });

  it("does not repair unsafe durability answers without sufficient source gate evidence", () => {
    const repair = buildJapaneseLanguageGuardRepair({
      questionIntent: "driver_durability_followup",
      sourceGateSufficient: false,
      sourceGateEvidenceSlots: {
        companyExplainedDrivers: [
          {
            category: "industrial",
            driver: "Operating within the industrial sector presents generic long-term risks.",
            sourceIds: ["S1"],
            confidence: "low"
          }
        ]
      }
    });

    expect(repair).toBeNull();
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
    expect(response.debug?.fallbackCategory).toBe("language_guard");
    expect(response.debug?.fallbackUserReason).toBe("raw_english_detected");
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
    expect(response.answer).toContain("前問の具体的な要因");
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("repairs source-supported CAT durability answers instead of falling back", async () => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "前問の要因は、Total sales and revenues for 2025 were $67.589 billion, an increase of $2.780 billion, or 4 percent. The increase reflected higher sales volume, partially offset by unfavorable price realization.です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceGateEvidenceSlots: {
          companyExplainedDrivers: [
            {
              category: "industrial",
              driver: "Total sales and revenues for 2025 were $67.589 billion, an increase of $2.780 billion, or 4 percent. The increase reflected higher sales volume, partially offset by unfavorable price realization and higher sales of equipment to end users.",
              sourceIds: ["S1"],
              confidence: "high"
            },
            {
              category: "industrial",
              driver: "In the first quarter of 2026 we expect stronger sales and revenues primarily due to higher sales volume and favorable price realization, partially offset by changes in dealer inventory.",
              sourceIds: ["S3"],
              confidence: "high"
            }
          ],
          segmentOrBusinessSignals: []
        },
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.languageGuardOk).toBe(true);
    expect(response.debug?.languageGuardFallbackUsed).toBe(false);
    expect(response.debug?.finalAnswerLanguageLabels).toEqual(expect.arrayContaining([
      "english_answer_leak",
      "answer_repaired_to_japanese"
    ]));
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["language_guard_source_backed_repair"]));
    expect(response.answer).toContain("販売数量");
    expect(response.answer).toContain("価格実現");
    expect(response.answer).not.toContain("Total sales and revenues");
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
    expect(response.debug?.sourceIdsValid).toBe(true);
  });

  it("softens overconfident WMT durability wording while keeping source-backed evidence", async () => {
    const filing = makeFiling({ ticker: "WMT", companyName: "Walmart Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "Walmart US eCommerceの売上寄与が継続的に高まり、会員エンゲージメントとOmnichannelがComparable salesを押し上げました。eCommerce の貢献は安定成長を示しています。次回も同じ指標を確認します。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceGateEvidenceSlots: {
          companyExplainedDrivers: [
            {
              category: "retail_driver_durability_followup",
              driver: "Walmart US eCommerce positively contributed approximately 4.3% to comparable sales. Growth reflects continued strength in customer and Walmart+ member engagement with omnichannel offerings.",
              sourceIds: ["S1"],
              confidence: "high"
            }
          ],
          segmentOrBusinessSignals: []
        },
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.answer).toContain("eCommerce");
    expect(response.answer).toContain("会員エンゲージメント");
    expect(response.answer).toContain("継続性は断定できません");
    expect(response.answer).not.toContain("継続的に高まり");
    expect(response.answer).not.toContain("安定成長を示しています");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q04_durability_wording_softened"]));
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.sourceIdsValid).toBe(true);
  });

  it("does not soften Q04 durability wording when the source gate is insufficient", async () => {
    const filing = makeFiling({ ticker: "WMT", companyName: "Walmart Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "Walmart US eCommerceの売上寄与が継続的に高まりました。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("継続的に高まり");
    expect(response.debug?.sourceRepairLabels ?? []).not.toContain("q04_durability_wording_softened");
  });

  it("repairs WMT Q04 post-gate underanswers from source-backed retail durability evidence", async () => {
    const filing = makeFiling({ ticker: "WMT", companyName: "Walmart Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "前問の具体的な要因が十分に特定できていません。そのため、選択された資料だけで一時要因か継続要因かは分類しません。判断には、経営陣による業績説明、comparable sales、traffic、ticket、eCommerce、membership income の追加確認が必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceGateEvidenceSlots: {
          companyExplainedDrivers: [
            {
              category: "retail_driver_durability_followup",
              driver: "Comparable sales were driven by transactions and unit volumes, with strong sales in grocery and health & wellness. Walmart US eCommerce sales positively contributed to comparable sales. This growth reflects continued strength in customer and Walmart+ member engagement with omnichannel offerings.",
              sourceIds: ["S1"],
              confidence: "high"
            }
          ],
          segmentOrBusinessSignals: []
        },
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("このfilingだけでは継続性は断定できません");
    expect(response.answer).toContain("comparable sales");
    expect(response.answer).toContain("eCommerce");
    expect(response.answer).toContain("member engagement");
    expect(response.answer).toContain("継続性を見る材料");
    expect(response.answer).not.toContain("継続的に高まり");
    expect(response.answer).not.toContain("持続的に伸びる");
    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q04_retail_durability_source_backed_repair"]));
    expect(response.debug?.sourceIdsValid).toBe(true);
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("repairs JPM Q04 post-gate underanswers from source-backed NII and NIR evidence", async () => {
    const filing = makeFiling({ ticker: "JPM", companyName: "JPMorgan Chase & Co." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "純利益は570.5億ドルで前年同期比2.4%減です。セグメント・地域別の強弱はこの資料では十分に分解できません。確認すべき箇所は、セグメント実績、地域別売上、製品・カテゴリ別売上、業種固有のセグメントKPIです。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        lowQualityReason: "durability_missing_assessment",
        sourceGateEvidenceSlots: {
          confirmedMetricMovement: {
            metric: "revenue",
            label: "売上高",
            value: "1,824.5億ドル",
            change: "2.8%"
          },
          companyExplainedDrivers: [
            {
              category: "bank_driver_durability_followup",
              driver: "Net interest income was up 3%, driven by higher Markets NII, Card Services revolving balances, wholesale deposit balances and investment securities activity, predominantly offset by deposit margin compression and lower rates.",
              sourceIds: ["S9"],
              confidence: "high"
            },
            {
              category: "bank_driver_durability_followup",
              driver: "Noninterest revenue was up 2%, reflecting Markets noninterest revenue, asset management fees, Payments fees, investment banking fees and a First Republic-related gain.",
              sourceIds: ["S10"],
              confidence: "high"
            }
          ],
          segmentOrBusinessSignals: []
        },
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("このfilingだけでは継続性は断定できません");
    expect(response.answer).toContain("NII");
    expect(response.answer).toContain("NIR");
    expect(response.answer).toContain("金利環境次第");
    expect(response.answer).toContain("市場関連収益や一時利益は変動しやすい");
    expect(response.answer).not.toContain("今後も伸びる");
    expect(response.answer).not.toContain("買うべき");
    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q04_bank_durability_source_backed_repair"]));
    expect(response.debug?.sourceIdsValid).toBe(true);
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("does not repair JPM Q04 underanswers without source-gate sufficiency", async () => {
    const filing = makeFiling({ ticker: "JPM", companyName: "JPMorgan Chase & Co." });
    const answer = "セグメント・地域別の強弱はこの資料では十分に分解できません。";
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer,
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        lowQualityReason: "durability_missing_assessment",
        sourceGateEvidenceSlots: {
          companyExplainedDrivers: [
            {
              category: "bank_driver_durability_followup",
              driver: "Net interest income increased.",
              sourceIds: ["S1"],
              confidence: "low"
            }
          ]
        },
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toBe(answer);
    expect(response.debug?.sourceRepairLabels ?? []).not.toContain("q04_bank_durability_source_backed_repair");
  });

  it("rewrites globally banned generic phrases before returning a final answer", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "この filing で重要なリスクは？",
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
    expect(response.answer).toContain("負債の注記 や 流動性の説明");
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
    expect(response.answer).not.toContain("source");
    expect(response.answer).toContain("選択された資料");
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
    expect(response.debug?.fallbackCategory).toBe("source_insufficient");
    expect(response.debug?.fallbackUserReason).toBe("business_model_sources_missing");
    expect(response.debug?.missingEvidenceLabelsJa).toEqual(expect.arrayContaining(["事業内容", "セグメント情報", "売上内訳"]));
    expect(response.answer).toContain("この会社の収益源");
    expect(response.answer).toContain("事業内容");
    expect(response.answer).toContain("セグメント情報");
    expect(response.answer).toContain("売上内訳");
    expect(response.answer).toContain("それだけでは");
    expect(response.answer).not.toContain("source");
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
    expect(response.debug?.fallbackCategory).toBe("source_insufficient");
    expect(response.debug?.fallbackUserReason).toBe("business_model_sources_missing");
    expect(response.debug?.sourceIdsValid).toBe(true);
    expect(response.debug?.languageGuardChecked).toBe(true);
    expect(response.answer).toContain("この会社の収益源");
    expect(response.answer).toContain("事業内容");
    expect(response.answer).toContain("セグメント情報");
    expect(response.answer).toContain("売上内訳");
    expect(response.answer).toContain("それだけでは");
    expect(response.answer).not.toContain("source");
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
    expect(response.debug?.fallbackCategory).toBe("source_insufficient");
    expect(response.debug?.fallbackUserReason).toBe("business_model_sources_missing");
    expect(response.answer).toContain("この会社の収益源");
    expect(response.answer).toContain("MD&Aの事業説明");
    expect(response.answer).not.toContain("source");
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
    expect(response.debug?.fallbackCategory).toBe("model_error");
    expect(response.debug?.fallbackUserReason).toBe("model_rate_limited");
    expect(response.answer).toBe("売上高は 10.4億ドル で、前年同期比 3.1%減 です。");
  });

  it("rewrites remote business-model answers that lead with financial metrics", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "なにで稼いでんのこの会社",
      response: {
        answer: "この会社は主に売上を「売上高」で稼いでいます。売上高は10.4億ドルで、前年同期比3.1%減です。純利益は79.2百万ドルでした。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "unknown",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.sourceIdsValid).toBe(true);
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
    expect(response.debug?.fallbackUserReason).toBe("answer_too_metric_only");
    expect(response.debug?.modelProvider).toBe("openai");
    expect(response.answer).toContain("この会社の収益源");
    expect(response.answer).toContain("それだけでは");
    expect(response.answer).not.toContain("source");
    expect(response.answer).not.toMatch(/^(この会社は)?主に?売上/);
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("preserves business-model answers that start with what the company sells", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "つまり何屋なの？",
      response: {
        answer: "Skyworks は、通信機器やスマートフォン向けのアナログ/RF半導体を売って稼ぐ会社です。今回のsourceだけでは製品別・顧客別の売上構成までは十分に分けられません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "gemini",
      debug: {
        questionIntent: "unknown",
        responsePath: "gemini",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("アナログ/RF半導体");
    expect(response.answer).toContain("今回の資料だけでは");
    expect(response.answer).not.toContain("source");
    expect(response.answer).not.toContain("売上高だけでは");
    expect(response.debug?.fallbackKind).toBe("none");
  });

  it("removes raw source wording from user-facing final answers", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "この会社は何で儲けている？",
      response: {
        answer: "選択されたsourceだけでは、事業内容を確認できません。追加のsource typeが必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "business_model",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: false,
        schemaValid: true,
        fallbackKind: "low_quality"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("選択された資料");
    expect(response.answer).toContain("資料の種類");
    expect(response.answer).not.toContain("source");
  });

  it("naturalizes AAPL-like business line labels and removes weak revenue-bucket filler", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "この会社は何で儲けている？",
      response: {
        answer: "Appleは、iPhone、Mac、iPad、Wearables, Home and Accessories, Servicesで稼ぐ会社です。売上区分としては、全社売上高も確認できます。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "business_overview",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("ウェアラブル、ホーム、アクセサリ");
    expect(response.answer).toContain("サービス");
    expect(response.answer).not.toContain("Wearables");
    expect(response.answer).not.toContain("Home and Accessories");
    expect(response.answer).not.toContain("Services");
    expect(response.answer).not.toContain("全社売上高も確認できます");
  });

  it("removes weird USD/JPY mixed unit sentences from business-model answers", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "つまり何屋なの？",
      response: {
        answer: "Skyworks は、通信機器向けの半導体部品を売って稼ぐ会社です。売上高は10億3,540千 USDでした。主な費用は6億8千8百万円でした。純利益は百万円で表されます。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "gemini",
      debug: {
        questionIntent: "business_overview",
        responsePath: "gemini",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("通信機器向けの半導体部品");
    expect(response.answer).not.toContain("10億3,540千 USD");
    expect(response.answer).not.toContain("6億8千8百万円");
    expect(response.answer).not.toContain("百万円");
    expect(response.debug?.sourceIdsValid).toBe(true);
  });

  it("removes trailing metric snapshot sentences from OpenAI business-model answers", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "なにで稼いでんのこの会社",
      response: {
        answer: "この会社は主に半導体関連のソリューションを提供し、売上は主に製品の販売から稼いでいます。2026年1月2日時点の四半期実績では、総売上高は約10.354億ドル、純利益は約7920万ドル、営業利益は約1.038億ドルです。前年同期比で売上は約-3.1%、純利益は約-51.1%、営業利益は約-42.7%の減少となっています。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "unknown",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
    expect(response.debug?.fallbackUserReason).toBe("answer_too_metric_only");
    expect(response.answer).toBe("この会社は主に半導体関連のソリューションを提供し、売上は主に製品の販売から稼いでいます。");
    expect(response.answer).not.toContain("総売上高");
    expect(response.answer).not.toContain("純利益");
    expect(response.answer).not.toContain("前年同期比");
    expect(response.debug?.sourceIdsValid).toBe(true);
  });

  it("normalizes awkward OpenAI English terms and USD unit strings in final answers", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "次回決算で見るべきポイントを3つに絞って",
      response: {
        answer: "1) 営業利益の改善（552百万 USD）。2) government支出、acquisitions、repurchaseの影響。3) NIとCash flow、capital expenditureを確認。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "watch_points",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.answer).toContain("会社固有のポイント");
    expect(response.answer).not.toContain("百万 USD");
    expect(response.answer).not.toContain("government");
    expect(response.answer).not.toContain("repurchase");
    expect(response.answer).not.toContain("acquisitions");
    expect(response.answer).not.toContain("NI");
    expect(response.answer).not.toContain("Cash flow");
  });

  it("normalizes compact oku-USD output from OpenAI answers", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "売上成長、または減収の主な要因は？",
      response: {
        answer: "売上高は6.018億USDで、政府向け需要が支えました。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_driver",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("6.0億ドル");
    expect(response.answer).toContain("政府向け需要");
    expect(response.answer).not.toContain("億USD");
  });

  it("replaces generic risk-summary style answers for liquidity/debt questions", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "この filing で重要なリスクは？",
      response: {
        answer: "主要リスク: 規制、競争、顧客データ保護、市場環境の変動が業績に影響する可能性があります。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("資金繰りや負債の懸念を直接判断するには不足");
    expect(response.answer).toContain("キャッシュフロー計算書");
    expect(response.answer).toContain("負債の注記");
    expect(response.debug?.fallbackCategory).toBe("source_insufficient");
    expect(response.debug?.fallbackUserReason).toBe("liquidity_sources_missing");
    expect(response.answer).not.toContain("規制、競争、顧客データ保護");
  });

  it("translates English fallback source labels after language-guard fallback", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "この filing で重要なリスクは？",
      response: {
        answer: "Part I. Item 2 Results of Operations contains a raw English filing excerpt that should not be shown to users. Additional Risk Factors and MD&A risk discussion are needed.",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "risk_summary",
        responsePath: "openai",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateMissingSourceTypes: ["Risk Factors", "MD&A risk discussion"],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackKind).toBe("language_guard_fallback");
    expect(response.debug?.fallbackCategory).toBe("language_guard");
    expect(response.debug?.fallbackUserReason).toBe("raw_english_detected");
    expect(response.answer).toContain("リスク要因");
    expect(response.answer).toContain("MD&Aのリスク説明");
    expect(response.answer).not.toContain("Risk Factors");
    expect(response.answer).not.toContain("MD&A risk discussion");
    expect(response.debug?.sourceIdsValid).toBe(true);
  });

  it("normalizes raw USD and comma-decimal currency strings", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "売上成長、または減収の主な要因は？",
      response: {
        answer: "売上高 601,0億ドル、参考値は379,600,000 USDです。前年同468,? は比較値として不明です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_driver",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("601.0億ドル");
    expect(response.answer).toContain("3.8億ドル");
    expect(response.answer).toContain("前年同期の比較値");
    expect(response.debug?.fallbackCategory).not.toBe("sanitation_guard");
    expect(response.debug?.fallbackUserReason).not.toBe("malformed_currency_detected");
    expect(response.answer).not.toContain("601,0億ドル");
    expect(response.answer).not.toContain("379,600,000 USD");
    expect(response.answer).not.toContain("前年同468,?");
  });

  it("normalizes mixed CJK USD units without emitting malformed currency labels", async () => {
    const filing = makeFiling({ ticker: "JPM", companyName: "JPMorgan Chase & Co." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "売上高 1,824억4700万 USD、総売上高は 7131.63 亿 USD、WMT売上高7131.63亿美元、比較値680.985亿美元、2025年売上高67.589十億 USD、7.9十億ドルの影響、純利益は57億ドルです。2026年第1四半期の在庫増加が1兆円超の規模と seasonality に依存します。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("1824.5億ドル");
    expect(response.answer).toContain("7131.6億ドル");
    expect(response.answer).toContain("681.0億ドル");
    expect(response.answer).toContain("675.9億ドル");
    expect(response.answer).toContain("79.0億ドル");
    expect(response.answer).toContain("金額規模");
    expect(response.answer).toContain("季節性");
    expect(response.answer).not.toContain("억");
    expect(response.answer).not.toContain("亿");
    expect(response.answer).not.toContain("美元");
    expect(response.answer).not.toContain("十億 USD");
    expect(response.answer).not.toContain("十億ドル");
    expect(response.answer).not.toContain("兆円");
    expect(response.debug?.fallbackCategory).not.toBe("sanitation_guard");
    expect(response.debug?.fallbackUserReason).not.toBe("malformed_currency_detected");
    expect(response.debug?.guardLabels).not.toContain("malformed_currency_detected");
  });

  it("suppresses stale malformed currency labels when the final visible answer is clean", async () => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "2025年の売上高は675.9億ドル、前年同期比4.3%増。機械ディーラー在庫が2026年第一四半期に1.0億 USD超増加する見通しです。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("1.0億ドル");
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
    expect(response.debug?.guardLabels).not.toContain("malformed_currency_detected");
  });

  it("cleans CAT Q06 finance terms and suspicious million-dollar net income units", async () => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "売上高は約678.9億ドル、営業利益は111.51億ドル、純利益は88.82百万ドル。要因としては、販売量の増加とprice realizationの不利がある一方、manufacturing costやcost、tariffs、developing economiesの影響が押し下げ要因です。利益率の変動要因は一時的というより、需要の変動とコスト構造の影響が組み合わさっています。Construction Industriesの継続性はこのfilingだけでは断定できません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceExcerpts: [
          "Total sales and revenues for 2025 were $67.589 billion, an increase of $2.780 billion, or 4 percent.",
          "売上高: 67589000000 USD / 比較値: 64809000000 / YoY: 4.3%"
        ],
        sourceGateEvidenceSlots: {
          confirmedMetricMovement: {
            metricName: "純利益",
            currentValue: "88.8億ドル",
            comparisonValue: "107.9億ドル",
            changePct: "-17.7%"
          }
        },
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("売上高は約675.9億ドル");
    expect(response.answer).toContain("純利益は88.8億ドル");
    expect(response.answer).toContain("一時的か構造的かは、このfilingだけでは断定できません");
    expect(response.answer).toContain("価格実現");
    expect(response.answer).toContain("製造コスト");
    expect(response.answer).toContain("コスト");
    expect(response.answer).toContain("関税");
    expect(response.answer).toContain("新興国");
    expect(response.answer).toContain("Construction Industries");
    expect(response.answer).not.toContain("678.9億ドル");
    expect(response.answer).not.toContain("88.82百万ドル");
    expect(response.answer).not.toContain("一時的というより");
    expect(response.answer).not.toContain("price realization");
    expect(response.answer).not.toContain("manufacturing cost");
    expect(response.answer).not.toContain("tariffs");
    expect(response.answer).not.toContain("developing economies");
    expect(response.answer).not.toMatch(/\bcost\b/i);
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining([
      "cat_q06_revenue_unit_corrected_from_source",
      "cat_q06_net_income_unit_corrected_from_source",
      "cat_q06_temporality_wording_softened"
    ]));
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
    expect(response.debug?.sourceIdsValid).toBe(true);
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("adds a cautious CAT Q06 temporality caveat when the answer omits temporary-versus-structural framing", async () => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "売上高・営業利益・純利益: 2025年は売上高675億ドル、営業利益111.5億ドル、純利益88.8億ドル。価格実現と製造コストの不利要因が利益を押し下げました。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("一時要因か構造的変化かは断定できません");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["cat_q06_temporality_caveat_added"]));
    expect(response.debug?.sourceIdsValid).toBe(true);
  });

  it("removes raw XBRL tags and mixed driver wording from final answers", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "売上成長、または減収の主な要因は？",
      response: {
        answer: "RevenueFromContractWithCustomerExcludingAssessedTax は増加しましたが、会社固有の売上driverは十分に特定できていません。具体的なdriverを見るには追加確認が必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_driver",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("売上高");
    expect(response.answer).toContain("売上要因");
    expect(response.answer).toContain("具体的な要因");
    expect(response.answer).not.toContain("RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(response.answer).not.toContain("driver");
  });

  it("rewrites liquidity/debt answers that start as generic risk summaries", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "資金繰りや負債に懸念はある？",
      response: {
        answer: "主要リスク: 金融市場の変動、規制、顧客データ保護が業績に影響する可能性があります。影響: 資金繰りや負債に関する懸念として、金利変動が流動性に影響します。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("キャッシュフロー計算書");
    expect(response.answer).toContain("満期スケジュール");
    expect(response.debug?.fallbackCategory).toBe("source_insufficient");
    expect(response.debug?.fallbackUserReason).toBe("liquidity_sources_missing");
    expect(response.answer).not.toMatch(/^主要リスク/);
    expect(response.answer).not.toContain("顧客データ保護");
  });

  it("rewrites generic watch-point answers with malformed raw USD text", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "次回決算で見るべきポイントを3つに絞って",
      response: {
        answer: "次回決算で見るべきポイントは次の3点です。1) 売上高の成長率、2) 純利益の成長、3) コスト構造とキャッシュフロー。これらは379,600,000 USD（前年同468,?）に裏付けられます。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "watch_points",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("会社固有のポイント");
    expect(response.answer).toContain("セグメント実績");
    expect(response.answer).toContain("キャッシュフロー・流動性");
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
    expect(response.debug?.fallbackUserReason).toBe("generic_watch_points");
    expect(response.answer).not.toContain("379,600,000 USD");
    expect(response.answer).not.toContain("前年同468,?");
  });

  it("replaces generic watch-point lists when no company-specific signal is present", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "次回決算で見るべきポイントを3つに絞って",
      response: {
        answer: "次回決算で見るべきポイントは三つです。 1) 売上高の推移と成長要因、2) 純利益の推移とドライバ、3) コスト構造や支出の動向。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "watch_points",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("会社固有のポイント");
    expect(response.answer).toContain("セグメント実績");
    expect(response.answer).toContain("売上説明");
    expect(response.answer).toContain("キャッシュフロー・流動性");
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
    expect(response.debug?.fallbackUserReason).toBe("generic_watch_points");
    expect(response.answer).not.toContain("純利益の推移");
  });

  it("replaces BDX-like universal watch-point lists even without malformed metrics", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "次回決算で見るべきポイントを3つに絞って",
      response: {
        answer: "次回決算で見るべきポイントは次の3つです。1) 売上高の推移とYoYの伸び率、需要の動向を確認。2) 営業利益と利益率の推移、コスト構造の改善を評価。3) 純利益の成長要因と季節性・非経常項目の影響を把握。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "watch_points",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("会社固有のポイント");
    expect(response.answer).toContain("一般的な売上・利益・コストだけでは");
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
    expect(response.debug?.fallbackUserReason).toBe("generic_watch_points");
    expect(response.answer).not.toContain("営業利益と利益率の推移");
  });

  it("keeps company-specific watch-point answers", async () => {
    const filing = makeFiling();
    const answer = "次回決算では、1) Alarisの出荷再開による医療機器需要、2) Life Sciencesの診断需要、3) Medication Management Solutionsの受注と在庫正常化を確認します。";
    const response = await finalizeChatResponse({
      filing,
      question: "次回決算で見るべきポイントを3つに絞って",
      response: {
        answer,
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "watch_points",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("Alaris");
    expect(response.answer).toContain("Life Sciences");
    expect(response.answer).toContain("Medication Management Solutions");
    expect(response.answer).not.toContain("会社固有のポイントを3つに絞るには不足");
  });

  it("does not answer management-emphasis questions with revenue-only metrics", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "経営陣が強調している論点は？",
      response: {
        answer: "売上高は1,437.6億ドルで、前年同期比15.7%増です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "mda_summary",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("経営陣が強調している論点");
    expect(response.answer).toContain("MD&A");
    expect(response.answer).toContain("業績説明");
    expect(response.answer).toContain("セグメント実績");
    expect(response.answer).toContain("見通し・リスク");
    expect(response.answer).toContain("売上高だけでは");
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
    expect(response.debug?.fallbackUserReason).toBe("answer_too_metric_only");
    expect(response.answer).not.toBe("売上高は1,437.6億ドルで、前年同期比15.7%増です。");
  });

  it("keeps normal revenue snapshot metrics", async () => {
    const filing = makeFiling();
    const answer = "売上高は1,437.6億ドルで、前年同期比15.7%増です。";
    const response = await finalizeChatResponse({
      filing,
      question: "売上高はどうだった？",
      response: {
        answer,
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_snapshot",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toBe(answer);
  });

  it("removes bank-specific cash-flow wording from non-bank answers", async () => {
    const filing = makeFiling({ ticker: "AAPL", companyName: "Apple Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFが減った理由は？",
      response: {
        answer: "営業CFは売上高ではなく、運転資本、貸出・預金、信用損失、deposit baseの増減にも大きく振れます。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "deterministic",
      debug: {
        questionIntent: "cash_flow",
        responsePath: "deterministic",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: false,
        geminiSucceeded: false,
        schemaValid: true
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("営業CFは、運転資本");
    expect(response.answer).toContain("キャッシュフロー計算書");
    expect(response.answer).not.toMatch(/貸出|預金|信用損失|deposit base/i);
    expect(response.debug?.fallbackCategory).toBe("sanitation_guard");
    expect(response.debug?.fallbackUserReason).toBe("wrong_sector_wording");
  });

  it("keeps bank-specific cash-flow wording for financial filings", async () => {
    const filing = makeFiling({ ticker: "JPM", companyName: "JPMorgan Chase & Co." });
    const answer = "金融機関の営業CFは、貸出・預金や信用損失の増減にも大きく振れます。";
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFはどう見る？",
      response: {
        answer,
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "deterministic",
      debug: {
        questionIntent: "cash_flow",
        responsePath: "deterministic",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: false,
        geminiSucceeded: false,
        schemaValid: true
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toBe(answer);
    expect(response.answer).toContain("貸出・預金");
    expect(response.answer).toContain("信用損失");
  });

  it("guards malformed comma-decimal currency strings", async () => {
    const filing = makeFiling({ ticker: "AAPL", companyName: "Apple Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "売上高はどうだった？",
      response: {
        answer: "売上高は143,7.6億ドルで、前年同期比15.7%増です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_snapshot",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("売上高の数値表示");
    expect(response.answer).not.toContain("143,7.6億ドル");
    expect(response.answer).not.toContain("143.7.6億ドル");
    expect(response.debug?.fallbackCategory).toBe("sanitation_guard");
    expect(response.debug?.fallbackUserReason).toBe("malformed_currency_detected");
  });

  it("removes minor English and Chinese-looking leakage from final answers", async () => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "前年同期比は？",
      response: {
        answer: "前年同period比では影響は較為小さいです。debug fallback schemaも表示しません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_snapshot",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("前年同期比");
    expect(response.answer).toContain("比較的小さい");
    expect(response.answer).toContain("診断");
    expect(response.answer).toContain("代替回答");
    expect(response.answer).toContain("形式");
    expect(response.answer).not.toContain("period");
    expect(response.answer).not.toContain("較為小さい");
    expect(response.answer).not.toContain("debug");
    expect(response.answer).not.toContain("fallback");
    expect(response.answer).not.toContain("schema");
  });

  it("rewrites unsupported operating-margin growth wording conservatively", async () => {
    const filing = makeFiling({ ticker: "WMT", companyName: "Walmart Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "営業利益率は改善した？",
      response: {
        answer: "営業利益率は前年同期比で約1.6%増です。eコマース改善が主因です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "margin_snapshot",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("営業利益は前年同期比で約1.6%増");
    expect(response.answer).toContain("営業利益率の変化要因は、選択された資料だけでは断定しません");
    expect(response.answer).not.toContain("営業利益率は前年同期比で約1.6%増");
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
  });

  it("keeps investment-advice phrases blocked in final answers", async () => {
    const filing = makeFiling({ ticker: "AAPL", companyName: "Apple Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "この株は買うべき？",
      response: {
        answer: "業績が強いので買うべきです。目標株価は200ドルで、割安です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "investment_view",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("投資判断や株価の断定はしません");
    expect(response.answer).not.toMatch(/買うべき|目標株価|割安です/);
  });

  it("does not treat buyback wording as investment advice", async () => {
    const filing = makeFiling({ ticker: "AAPL", companyName: "Apple Inc." });
    const answer = "資本配分では、自社株買いです。投資判断の推奨ではありません。";
    const response = await finalizeChatResponse({
      filing,
      question: "資本配分は？",
      response: {
        answer,
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "capital_allocation",
        responsePath: "openai",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toBe(answer);
    expect(response.debug?.fallbackCategory).toBe("none");
  });
});

function makeFiling(overrides: Partial<Pick<FilingCacheRecord, "ticker" | "companyName">> = {}): FilingCacheRecord {
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
    ticker: overrides.ticker ?? "MS",
    companyName: overrides.companyName ?? "Morgan Stanley",
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
