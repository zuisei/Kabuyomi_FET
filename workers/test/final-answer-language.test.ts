import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Env, FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../src/env";
import {
  buildJapaneseLanguageGuardFallback,
  buildJapaneseLanguageGuardRepair,
  checkFinalAnswerJapaneseOnly
} from "../src/lib/chat/final-answer-language";
import { joinMissingSourceLabels } from "../src/lib/chat/evidence-fallback";
import { finalizeChatResponse, sanitizeFinalUserFacingAnswer } from "../src/lib/chat/response-finalizer";
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

  it("rejects short hybrid English/Japanese business fragments", () => {
    const examples = [
      "利益率はProfitability contextを見ます。",
      "price-コスト spread discussion が必要です。",
      "Re資料 Industries の説明です。",
      "higher 稼働率 expense が要因です。",
      "un価格実現が影響しました。",
      "geography revenue が中心です。",
      "segment revenue が最大です。"
    ];

    for (const answer of examples) {
      expect(checkFinalAnswerJapaneseOnly(answer).labels).toEqual(expect.arrayContaining([
        "hybrid_english_business_phrase",
        "final_answer_language_violation"
      ]));
    }
  });

  it("humanizes internal revenue coverage labels before fallback answers reach users", () => {
    expect(joinMissingSourceLabels([
      "segment results",
      "product revenue discussion",
      "services revenue discussion",
      "geographic revenue discussion",
      "product launch or channel inventory discussion",
      "price-cost spread discussion",
      "manufacturing cost discussion",
      "vehicle pricing discussion",
      "automotive gross margin discussion",
      "refining or chemical margin discussion"
    ])).toBe("セグメント実績、製品別売上、サービス売上、地域別売上、新製品投入や販売チャネル在庫、価格とコスト・製造コスト、車両価格、自動車粗利益率、精製・化学マージン");

    const fallback = buildJapaneseLanguageGuardFallback({
      questionIntent: "revenue_driver",
      missingSourceTypes: ["product revenue", "services revenue", "geographic revenue"]
    });
    expect(fallback).toContain("売上要因");
    expect(fallback).toContain("追いきれません");
    expect(fallback).toContain("次に見るなら");
    expect(fallback).not.toContain("driver");
    expect(fallback).not.toContain("追加確認");
    expect(fallback).not.toContain("product revenue");
    expect(fallback).not.toContain("services revenue");
    expect(fallback).not.toContain("geographic revenue");
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
    expect(repair).toContain("販売店在庫");
    expect(repair).toContain("継続性は断定できません");
    expect(repair).not.toContain("Total sales and revenues");
    expect(repair).not.toContain("stronger sales and revenues");
    expect(checkFinalAnswerJapaneseOnly(repair ?? "").ok).toBe(true);
  });

  it("does not label generic demand as DRAM or NAND demand in durability repairs", () => {
    const repair = buildJapaneseLanguageGuardRepair({
      question: "その要因は一時的？それとも続きそう？",
      questionIntent: "driver_durability_followup",
      sourceGateSufficient: true,
      selectedSourceExcerpts: [
        "Revenue increased for the three months ended March 31, 2026, driven primarily by increased volume, partially offset by lower realized prices.",
        "Revenue of Mounjaro increased 59 percent in the U.S., reflecting strong demand, partially offset by lower realized prices."
      ]
    });

    expect(repair).toContain("販売数量");
    expect(repair).toContain("需要");
    expect(repair).not.toContain("DRAM・NAND需要");
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

  it("repairs durability follow-ups from concrete selected excerpts even when source gate is insufficient", () => {
    const repair = buildJapaneseLanguageGuardRepair({
      question: "その要因は一時的？それとも続きそう？",
      questionIntent: "driver_durability_followup",
      sourceGateSufficient: false,
      selectedSourceExcerpts: [
        "Comparable sales increased due to traffic, ticket and eCommerce growth, partially offset by lower fuel prices."
      ]
    });

    expect(repair).toContain("売上要因候補");
    expect(repair).toContain("比較可能売上");
    expect(repair).toContain("客数");
    expect(repair).toContain("客単価");
    expect(repair).toContain("EC売上");
    expect(repair).toContain("断定しません");
    expect(repair).not.toContain("Comparable sales");
    expect(repair).not.toContain("eCommerce");
    expect(checkFinalAnswerJapaneseOnly(repair ?? "").ok).toBe(true);
  });

  it("repairs margin durability language violations from concrete cost excerpts", () => {
    const repair = buildJapaneseLanguageGuardRepair({
      question: "これは一時要因？それとも構造的な変化？",
      questionIntent: "margin_durability_followup",
      sourceGateSufficient: true,
      selectedSourceExcerpts: [
        "Total operating expense increased primarily due to higher expenses related to refinery sales to third parties, salaries and related costs and aircraft fuel costs.",
        "Total operating cost per available seat mile increased, while non-fuel unit cost also increased."
      ]
    });

    expect(repair).toContain("利益率要因候補");
    expect(repair).toContain("営業費用");
    expect(repair).toContain("燃料費");
    expect(repair).toContain("人件費");
    expect(repair).toContain("単位コスト");
    expect(repair).toContain("一時要因か構造的変化かは断定しません");
    expect(repair).not.toContain("Total operating expense");
    expect(repair).not.toContain("aircraft fuel");
    expect(checkFinalAnswerJapaneseOnly(repair ?? "").ok).toBe(true);
  });

  it("repairs risk summary language violations from selected source excerpts", () => {
    const repair = buildJapaneseLanguageGuardRepair({
      question: "この filing で重要なリスクは？",
      questionIntent: "risk_factors",
      selectedSourceExcerpts: [
        "Management's discussion and analysis on pages 146-149 includes a discussion of cybersecurity risk.",
        "The Firm may incur costs in connection with excess properties, premises or facilities."
      ]
    });

    expect(repair).toContain("サイバーセキュリティ");
    expect(repair).toContain("不動産・施設コスト");
    expect(repair).toContain("重要度や影響額までは断定しません");
    expect(repair).not.toContain("Management's discussion");
    expect(repair).not.toContain("excess properties");
    expect(checkFinalAnswerJapaneseOnly(repair ?? "").ok).toBe(true);
  });

  it("does not repair risk summaries when selected excerpts lack risk signals", () => {
    const repair = buildJapaneseLanguageGuardRepair({
      questionIntent: "risk_factors",
      selectedSourceExcerpts: [
        "Net sales increased because of higher volume and favorable pricing."
      ]
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
    expect(response.debug?.languageGuardOk).toBe(true);
    expect(response.debug?.languageGuardFallbackUsed).toBe(false);
    expect(response.debug?.languageGuardFallbackKind).toBeNull();
    expect(response.debug?.languageGuardViolationLabels).toEqual([]);
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
      "final_answer_language_violation",
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
    expect(response.answer).toContain("EC");
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

  /**
   * Previously the repair for this fixture came from buildWmtDurabilitySynthesis,
   * a constant paragraph naming 既存店売上 / EC / 会員利用 / 燃料価格 that fired on
   * any Walmart-like filing and then claimed a `source_backed` label. The
   * generic synthesis now handles it: every driver it names is a label read out
   * of the evidence text, so the assertions below check the labels against the
   * evidence rather than against a stored paragraph.
   */
  it("repairs WMT Q04 post-gate underanswers from labels found in the retail durability evidence", async () => {
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

    expect(response.answer).toContain("継続性は断定できません");
    // transactions / average ticket, grocery, unit volumes — all present in the
    // evidence driver text above.
    expect(response.answer).toContain("取引件数・客単価");
    expect(response.answer).toContain("食品・一般商品");
    expect(response.answer).toContain("販売数量");
    // The evidence says nothing about fuel. The deleted constant paragraph
    // asserted it anyway, for every Walmart-like filing.
    expect(response.answer).not.toContain("燃料価格");
    expect(response.answer).not.toContain("継続的に高まり");
    expect(response.answer).not.toContain("持続的に伸びる");
    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q04_generic_durability_source_backed_repair"]));
    expect(response.debug?.sourceRepairLabels ?? []).not.toContain("q04_retail_durability_source_backed_repair");
    expect(response.debug?.sourceIdsValid).toBe(true);
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("repairs generic source-gate-passed Q04 underanswers from driver durability evidence", async () => {
    const filing = makeFiling({ ticker: "V", companyName: "Visa Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "売上高は 112.3億ドル で、前年同期比 17.1%増 です。全社売上の増減は確認できますが、セグメント・地域別の強弱はこの資料では十分に分解できません。確認すべき箇所は、セグメント実績、地域別売上、製品・カテゴリ別売上です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        evidenceFallbackUsed: true,
        fallbackUserReason: "revenue_driver_sources_missing",
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
              category: "general_driver_durability_followup",
              driver: "Other revenue increased primarily due to growth in Advisory and Other Services and select pricing modifications. Client incentives will vary based on future performance expectations and payments volume.",
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
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.sourceRepairLabels).toContain("q04_generic_durability_source_backed_repair");
    expect(response.answer).toContain("提出資料だけでは継続性は断定できません");
    expect(response.answer).toContain("決済額・処理件数・国際取引量");
    expect(response.answer).toContain("アドバイザリー・付加価値サービス");
    expect(response.answer).not.toContain("販売数量");
    expect(response.answer).not.toContain("受注残や受注の確認材料");
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  /**
   * The comma-grouped-amount half of this test is unchanged: 1,099億ドル must not
   * trip the malformed-currency guard. The repair half changed — the platform
   * synthesis it used to assert was a constant paragraph gated on an Alphabet
   * name match, so the answer is now built from evidence labels instead.
   */
  it("repairs GOOGL Q04 from evidence labels without rejecting valid comma-grouped amounts", async () => {
    const baseFiling = makeFiling({ ticker: "GOOGL", companyName: "Alphabet Inc." });
    const sourceTexts = [
      "YouTube ads revenues increased, driven by direct response and brand advertising. Advertising results can vary with advertiser competition, device mix, and seasonal fluctuations.",
      "Google subscriptions, platforms, and devices revenues increased primarily due to growth in paid subscriptions across YouTube services and Google One.",
      "Google Search revenues were favorably affected by changes in foreign currency exchange rates, while Google Cloud revenues increased."
    ];
    const narrativeSources: SourceChunkRecord[] = sourceTexts.map((text, index) => ({
      sourceId: `CTX${index + 1}`,
      sectionType: "md_a",
      sectionTitle: "Segment and revenue context",
      sourceLabel: "10-Q Segment and revenue context",
      text,
      startOffset: 0,
      endOffset: text.length,
      sortOrder: index + 2
    }));
    const filing = withTypedMetrics({
      ...baseFiling,
      sourceChunks: [...baseFiling.sourceChunks, ...narrativeSources]
    }, [{
      logicalName: "revenue", tagUsed: "Revenues", value: 109_900_000_000, comparisonValue: 90_230_000_000,
      unit: "USD", periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
      comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", comparisonPeriodKind: "quarter"
    }]);
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "売上高は 1,099億ドル で、前年同期比 21.8%増 です。全社売上の増減は確認できますが、セグメント・地域別の強弱はこの資料では十分に分解できません。確認すべき箇所は、セグメント実績、地域別売上、製品・カテゴリ別売上です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        evidenceFallbackUsed: true,
        fallbackUserReason: "revenue_driver_sources_missing",
        lowQualityReason: "durability_missing_assessment",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        selectedSourceIds: narrativeSources.map((source) => source.sourceId),
        selectedSourceLabels: narrativeSources.map((source) => source.sourceLabel),
        selectedSourceExcerpts: sourceTexts,
        sourceGateEvidenceSlots: {
          companyExplainedDrivers: narrativeSources.map((source) => ({
            category: "general_driver_durability_followup",
            driver: source.text,
            sourceIds: [source.sourceId],
            confidence: "high"
          }))
        },
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("継続性は断定できません");
    // Read out of the evidence: "advertiser competition", "brand advertising".
    expect(response.answer).toContain("広告需要");
    // buildGoogleDurabilitySynthesis used to close every Alphabet-like answer
    // with 「次回は、Googleサービス、Google Cloud、YouTube広告、有料サブスクリプション
    // の成長率を…」 regardless of which of those the evidence mentioned.
    expect(response.answer).not.toContain("Googleサービス");
    // Was "openai". With no platform synthesis to repair the model answer with,
    // the deterministic answer is served instead — a routing change worth
    // pinning rather than leaving unasserted.
    expect(response.responsePath).toBe("deterministic");
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.guardLabels ?? []).not.toContain("malformed_currency_detected");
    expect(response.debug?.sourceRepairLabels ?? []).not.toContain("q04_platform_durability_source_backed_repair");
    expect(response.sources.map((source) => source.sourceId)).toEqual(expect.arrayContaining(["CTX1", "CTX2"]));
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  /**
   * The repair still has to be substantive and still has to name the NII/NIR
   * drivers — that part of the protection is unchanged. What changed is where
   * the words come from: buildJpmDurabilitySynthesis supplied two stored
   * paragraphs of banking commentary to any JPMorgan-like filing, so the
   * assertions now pin driver labels inferred from the evidence text.
   */
  it("repairs JPM Q04 post-gate underanswers from labels found in the NII and NIR evidence", async () => {
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

    expect(response.answer).toContain("継続性は断定できません");
    // Both read out of the evidence drivers above ("Net interest income",
    // "Noninterest revenue", "investment banking", "Markets").
    expect(response.answer).toContain("純利息収入");
    expect(response.answer).toContain("非利息収入・投資銀行・市場業務");
    // buildJpmDurabilitySynthesis wrote these clauses itself. They are plausible
    // banking commentary, but the filing was never consulted for them and the
    // repair label claimed they were source-backed.
    expect(response.answer).not.toContain("継続性は金利環境次第");
    expect(response.answer).not.toContain("市場関連収益や一時利益は変動しやすい");
    expect(response.answer).not.toContain("カード事業のリボ残高");
    expect(response.answer).not.toContain("今後も伸びる");
    expect(response.answer).not.toContain("買うべき");
    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.sourceRepairLabels ?? []).not.toContain("q04_bank_durability_source_backed_repair");
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

  it("uses the previous answer to avoid losing Q04 follow-up drivers when source gate is insufficient", async () => {
    const filing = makeFiling({ ticker: "AAPL", companyName: "Apple Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "前問の具体的な要因が十分に特定できていません。そのため、選択された資料だけで一時要因か継続要因かは分類しません。判断には、経営陣による業績説明、製品別売上、サービス売上、地域別売上の追加確認が必要です。",
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
        followupPreviousAnswer: "本文の要因としては Americas、Europe、Greater China、Rest of Asia Pacific など地域別での Net Sales の増加が挙げられ、iPhone と Services の寄与割合や関税影響の確認が必要です。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("前問で挙がっていた売上要因候補");
    expect(response.answer).toContain("地域別売上");
    expect(response.answer).toContain("iPhone");
    expect(response.answer).toContain("サービス売上");
    expect(response.answer).toContain("一時要因か継続要因かは断定しません");
    expect(response.answer).not.toContain("前問の具体的な要因が十分に特定");
    expect(response.responsePath).toBe("deterministic");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.sourceGateSufficient).toBe(false);
    expect(response.debug?.sourceGateFailureLabels).toEqual(["durability_context_missing", "source_gate_failed"]);
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining([
      "q04_previous_answer_driver_candidate_repair",
      "hard_intent_explicit_insufficiency_repair"
    ]));
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("preserves concrete Q03 retail drivers even when the Q04 model answer looks complete", async () => {
    const filing = makeFiling({ ticker: "WMT", companyName: "Walmart Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "継続性は断定できません。地域別売上と製品カテゴリを次期も確認する必要があります。",
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
        followupPreviousAnswer: "提出資料では、既存店売上は取引件数の増加、客単価の上昇、食品と一般商品の好調が押し上げ要因と説明しています。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("取引件数・客単価");
    expect(response.answer).toContain("食品・一般商品");
    expect(response.answer).not.toContain("地域別売上");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q04_previous_answer_driver_candidate_repair"]));
  });

  it("rebuilds a one-line Q04 non-answer from filing-backed NVIDIA drivers", async () => {
    const base = makeFiling({ ticker: "NVDA", companyName: "NVIDIA CORP" });
    const driverText = "Data Center revenue increased due to strong demand for Blackwell products.";
    const filing = withTypedMetrics({
      ...base,
      sourceChunks: [
        ...base.sourceChunks,
        {
          ...base.sourceChunks[0],
          sourceId: "NVDA-DRIVER",
          sectionType: "md_a" as const,
          sourceLabel: "10-Q Revenue driver discussion",
          text: driverText,
          startOffset: 0,
          endOffset: driverText.length,
          sortOrder: 99
        }
      ]
    }, [{
      logicalName: "revenue", tagUsed: "Revenues", value: 81_620_000_000,
      comparisonValue: 44_070_000_000, unit: "USD",
      periodStart: "2026-01-27", periodEnd: "2026-04-26", periodKind: "quarter",
      comparisonPeriodStart: "2025-01-27", comparisonPeriodEnd: "2025-04-27", comparisonPeriodKind: "quarter"
    }]);
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "要因が一時的かどうかは判断できません。",
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
        sourceGateSufficient: false,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("売上要因候補");
    expect(response.answer).not.toBe("要因が一時的かどうかは判断できません。");
    expect(response.sources.map((source) => source.sourceId)).toContain("MX1");
  });

  it("does not reuse a previous Q03 answer that mistook tax or expenses for revenue drivers", async () => {
    const filing = makeFiling({ ticker: "MU", companyName: "Micron Technology, Inc." });
    const answer = "前問の具体的な要因が十分に特定できていません。そのため、選択された資料だけで一時要因か継続要因かは分類しません。判断には、経営陣による業績説明、セグメント実績、売上説明の追加確認が必要です。";
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
        followupPreviousAnswer: "本文では、higher noncurrent income taxes payable related to the implementation of Pillar Two が売上変化の要因として説明されています。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toBe(answer);
    expect(response.debug?.sourceRepairLabels ?? []).not.toContain("q04_previous_answer_driver_candidate_repair");
  });

  it("uses the previous answer to avoid losing Q06 margin follow-up drivers when source gate is insufficient", async () => {
    const baseFiling = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const profitabilityText = "Profit increased due to higher sales volume and favorable price realization, partially offset by unfavorable manufacturing costs, higher tariff costs, and higher compensation expenses.";
    const profitabilitySource: SourceChunkRecord = {
      sourceId: "S4",
      sectionType: "md_a",
      sectionTitle: "Profitability context",
      sourceLabel: "10-Q Profitability context",
      text: profitabilityText,
      startOffset: 0,
      endOffset: profitabilityText.length,
      sortOrder: 4
    };
    const filing = { ...baseFiling, sourceChunks: [...baseFiling.sourceChunks, profitabilitySource] };
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "前問の具体的な利益率要因が十分に特定できていません。そのため、選択された資料だけで一時要因か構造的変化かは分類しません。判断には、利益率、原価、価格とコストの追加確認が必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        followupPreviousAnswer: "利益率要因としては、出荷量増加、price realizationの不利、manufacturing cost悪化、cost pressure、tariffs が挙がっています。",
        selectedSourceIds: ["S4"],
        selectedSourceLabels: [profitabilitySource.sourceLabel],
        selectedSourceExcerpts: [profitabilityText],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("前問で挙がっていた利益率要因候補");
    expect(response.answer).toContain("販売数量・出荷量");
    expect(response.answer).toContain("価格・ミックス");
    expect(response.answer).toContain("製造コスト");
    expect(response.answer).toContain("関税");
    expect(response.answer).toContain("一時要因か構造的変化かは断定しません");
    expect(response.answer).not.toContain("前問の具体的な利益率要因が十分に特定");
    expect(response.responsePath).toBe("deterministic");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.sourceGateFailureLabels).toEqual(["missing_margin_durability_context", "source_gate_failed"]);
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining([
      "q06_previous_answer_margin_candidate_repair",
      "hard_intent_explicit_insufficiency_repair"
    ]));
    expect(response.sources.map((source) => source.sourceId)).toContain("S4");
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("does not infer price mix from the standard Q05 caution sentence", async () => {
    const filing = makeFiling({ ticker: "GOOGL", companyName: "Alphabet Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "利益率改善の要因は複数あり、現状の提出資料だけでは継続性を断定できません。",
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
        sourceGateApplied: true,
        sourceGateSufficient: true,
        followupPreviousAnswer: "本文で確認できる利益率・利益要因は、人件費・報酬費の増加、減価償却費の増加、営業費用・原価の増加です。一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("人件費");
    expect(response.answer).toContain("減価償却費");
    expect(response.answer).toContain("営業費用・原価");
    expect(response.answer).not.toContain("価格・ミックス");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q06_previous_answer_margin_candidate_repair"]));
  });

  it("rebuilds generic backlog-style Q06 wording from filing-backed margin factors", async () => {
    const base = makeFiling({ ticker: "LLY", companyName: "Eli Lilly and Company" });
    const marginText = "Gross margin was affected by lower realized prices, while research and development and marketing expenses increased and acquired IPR&D expense decreased.";
    const filing = withTypedMetrics({
      ...base,
      sourceChunks: [
        ...base.sourceChunks,
        {
          ...base.sourceChunks[0],
          sourceId: "LLY-MARGIN",
          sectionType: "md_a" as const,
          sourceLabel: "10-Q Margin and profitability discussion",
          text: marginText,
          startOffset: 0,
          endOffset: marginText.length,
          sortOrder: 99
        }
      ]
    }, [
      {
        logicalName: "revenue", tagUsed: "Revenues", value: 19_800_000_000,
        comparisonValue: 12_730_000_000, unit: "USD",
        periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
        comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", comparisonPeriodKind: "quarter"
      },
      {
        logicalName: "netIncome", tagUsed: "NetIncomeLoss", value: 7_400_000_000,
        comparisonValue: 2_760_000_000, unit: "USD",
        periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
        comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", comparisonPeriodKind: "quarter"
      }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "判断にはバックログ・契約条件等の追加情報が必要です。",
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

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("利益率要因候補");
    expect(response.answer).not.toContain("バックログ");
    expect(response.sources.map((source) => source.sourceId)).toContain("LLY-MARGIN");
  });

  it("keeps XOM segment movements separate from unproven price and volume checks in Q04", async () => {
    const filing = makeFiling({ ticker: "XOM", companyName: "Exxon Mobil Corporation" });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "前問の具体的な要因が十分に特定できていません。そのため、選択された資料だけで一時要因か継続要因かは分類しません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        followupPreviousAnswer: "一番大きい変化: 売上高の前年比+2.4%増。主要数値: 売上高は851.4億ドル、前年同期は831.3億ドル。本文で説明されている要因: セグメント別ではEnergy Productsが最大の正の寄与、Upstreamが最大のマイナス寄与、Chemical Productsが増加、Specialty Productsはほぼ横ばい。これらのブリッジは価格・生産量・商品市場・為替・費用の因果関係を確定するものではない。追加確認が必要な点: 売上の増減を直接説明する具体的な要因（価格変動、販売量、製品ミックス、原材料コスト等）は本文のブリッジだけでは特定できない。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("Energy Productsの売上増加");
    expect(response.answer).toContain("Upstreamの売上減少");
    expect(response.answer).toContain("Chemical Productsの売上増加");
    expect(response.answer).not.toContain("価格・ミックス");
    expect(response.answer).not.toContain("販売数量・出荷量");
    expect(response.responsePath).toBe("deterministic");
    expect(response.debug?.fallbackReason).toBeNull();
  });

  it("repairs JPM Q03 language leakage from source-backed NII and NIR evidence", async () => {
    const filing = makeFiling({ ticker: "JPM", companyName: "JPMorgan Chase & Co." });
    const nii = "Net interest income was $25.4 billion, up 9%, driven by higher Markets net interest income, higher deposit balances, and higher revolving balances in Card Services, partially offset by lower rates.";
    const nir = "Noninterest revenue was $24.5 billion, up 11%, driven by higher asset management fees, higher investment banking fees, higher Markets noninterest revenue, and higher Payments fees. These increases were partially offset by the absence of the $588 million First Republic-related gain recorded in the prior year.";
    const response = await finalizeChatResponse({
      filing,
      question: "売上成長、または減収の主な要因は？",
      response: {
        answer: "最大の変化はNoninterest revenueです。要因はinvestment banking feesとMarkets revenueです。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "revenue_driver",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        lowQualityReason: "contextual_reasoning_metric_only",
        sourceIdsValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        selectedSourceIds: ["JPM-NII", "JPM-NIR"],
        selectedSourceLabels: ["10-Q revenue drivers", "10-Q revenue drivers"],
        selectedSourceExcerpts: [nii, nir],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.answer).toContain("純利息収入");
    expect(response.answer).toContain("資産運用手数料");
    expect(response.answer).toContain("前年に計上した買収関連利益");
    expect(response.answer).not.toMatch(/Noninterest|Markets|fees|First Republic/);
    expect(response.sources.map((source) => source.sourceId)).toEqual(expect.arrayContaining(["JPM-NII", "JPM-NIR"]));
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("promotes an explicit source-backed Q04 insufficiency response out of fallback taxonomy", async () => {
    const filing = makeFiling({ ticker: "TSLA", companyName: "Tesla, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "前問の具体的な要因が十分に特定できていません。そのため、選択された資料だけで一時要因か継続要因かは分類しません。判断には、納車台数、車両価格、生産量の追加確認が必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        evidenceFallbackUsed: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceIdsValid: true,
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
  });

  it("reuses concrete TSLA Q03 drivers when a source-gate-passed Q04 model answer misses durability", async () => {
    const filing = makeFiling({ ticker: "TSLA", companyName: "Tesla, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "売上高は増加しましたが、セグメント別の強弱は十分に分解できません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        lowQualityReason: "durability_missing_assessment",
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceIdsValid: true,
        followupPreviousAnswer: "サービス・その他売上は中古車販売数量、有償整備・修理、有料充電、保険の増加、自動車販売売上は納車台数、平均販売価格、販売構成が主な説明要因です。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.answer).toContain("サービス売上");
    expect(response.answer).toContain("販売数量・出荷量");
    expect(response.answer).toContain("価格・ミックス");
    expect(response.answer).toContain("一時要因か継続要因かは断定しません");
    expect(response.debug?.lowQualityReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
  });

  it("prefers the source-backed previous Q05 drivers over a generic gross-margin language repair", async () => {
    const filing = makeFiling({ ticker: "MU", companyName: "Micron Technology, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "前問の具体的な利益率要因が十分に特定できていません。そのため、一時要因か構造的変化かは分類しません。",
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
        sourceGateApplied: true,
        sourceGateSufficient: true,
        followupPreviousAnswer: "改善の要因は平均販売価格の上昇、製造コストの低減、製品ミックスの有利化です。",
        selectedSourceExcerpts: [
          "Our consolidated gross margin percentage improved compared with the prior-year quarter."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.answer).toContain("価格・ミックス");
    expect(response.answer).toContain("原価・営業コスト");
    expect(response.answer).toContain("一時要因か構造的変化かは断定しません");
    expect(response.answer).not.toContain("前問の具体的な利益率要因が十分に特定");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q06_previous_answer_margin_candidate_repair"]));
  });

  it("recovers a blocked margin-number answer with a typed deterministic margin response", async () => {
    const filing = {
      ...makeFiling({ ticker: "AAPL", companyName: "Apple Inc." }),
      metrics: [
        {
          logicalName: "revenue",
          tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
          value: 12_000_000_000,
          unit: "USD",
          periodEnd: "2026-03-31",
          comparisonValue: 10_000_000_000,
          yoyPercent: 20
        },
        {
          logicalName: "operatingIncome",
          tagUsed: "OperatingIncomeLoss",
          value: 3_000_000_000,
          unit: "USD",
          periodEnd: "2026-03-31",
          comparisonValue: 2_200_000_000,
          yoyPercent: 36.4
        },
        {
          logicalName: "netIncome",
          tagUsed: "NetIncomeLoss",
          value: 2_500_000_000,
          unit: "USD",
          periodEnd: "2026-03-31",
          comparisonValue: 2_000_000_000,
          yoyPercent: 25
        }
      ],
      sourceChunks: [
        {
          sourceId: "S9",
          sectionType: "xbrl_metric",
          sectionTitle: "売上高",
          sourceLabel: "XBRL 売上高",
          text: "売上高: 12000000000 USD / 比較値: 10000000000 / YoY: 20.0%",
          startOffset: 0,
          endOffset: 0,
          tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
          sortOrder: 9
        },
        {
          sourceId: "S10",
          sectionType: "xbrl_metric",
          sectionTitle: "営業利益",
          sourceLabel: "XBRL 営業利益",
          text: "営業利益: 3000000000 USD / 比較値: 2200000000 / YoY: 36.4%",
          startOffset: 0,
          endOffset: 0,
          tagName: "OperatingIncomeLoss",
          sortOrder: 10
        },
        {
          sourceId: "S11",
          sectionType: "xbrl_metric",
          sectionTitle: "純利益",
          sourceLabel: "XBRL 純利益",
          text: "純利益: 2500000000 USD / 比較値: 2000000000 / YoY: 25.0%",
          startOffset: 0,
          endOffset: 0,
          tagName: "NetIncomeLoss",
          sortOrder: 11
        },
        {
          sourceId: "S1",
          sectionType: "md_a",
          sectionTitle: "Margin and profitability discussion",
          sourceLabel: "10-Q Margin and profitability discussion",
          text: "Gross margin improved due to favorable price mix and lower manufacturing costs.",
          startOffset: 0,
          endOffset: 0,
          sortOrder: 1
        }
      ]
    } as FilingCacheRecord;
    const response = await finalizeChatResponse({
      filing,
      question: "利益率が改善、または悪化した理由は？",
      response: {
        answer: "純利益は16億ドル千万ドルです。営業利益率は約4.2%（前四半期比上昇）で、Margin and 利益率・採算性の説明が要因です。",
        sources: [sourceToEvidence(filing.sourceChunks[0]), sourceToEvidence(filing.sourceChunks[3])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "margin_profitability",
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

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("営業利益率");
    expect(response.answer).not.toContain("億ドル千万ドル");
    expect(response.answer).not.toContain("前四半期比");
    expect(response.answer).not.toContain("Margin and");
    expect(response.answer).not.toContain("このfiling");
    expect(response.debug?.numericAlignmentClaimBindings?.filter((binding) => binding.semanticLabel === "operatingMargin").map((binding) => binding.role)).toEqual(["comparison", "current"]);
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.sourceRepairLabels).toContain("margin_driver_deterministic_recovery");
    expect(response.debug?.numericAlignmentStatus).not.toBe("blocked");
  });

  it("recovers a blocked liquidity number with a substantive verified cash-flow answer", async () => {
    const base = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const cashSource: SourceChunkRecord = {
      sourceId: "S13",
      sectionType: "xbrl_metric",
      sectionTitle: "営業CF",
      sourceLabel: "XBRL 営業CF",
      text: "営業CF: 1870000000 USD / 比較値: 1289000000 / YoY: 45.1%",
      startOffset: 46,
      endOffset: 110,
      tagName: "NetCashProvidedByUsedInOperatingActivities",
      sortOrder: 13
    };
    const filing: FilingCacheRecord = {
      ...base,
      metrics: [{
        logicalName: "operatingCashFlow",
        tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: 1_870_000_000,
        comparisonValue: 1_289_000_000,
        unit: "USD",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        comparisonPeriodEnd: "2025-03-31",
        periodKind: "quarter"
      }],
      sourceChunks: [...base.sourceChunks, cashSource]
    };
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFを踏まえて、資金繰りや負債に懸念はある？",
      response: {
        answer: "営業CFは18.7億ドルですが、純利息収入は99.9%改善したため負債への懸念はありません。",
        sources: [sourceToEvidence(cashSource)]
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

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("営業CFは18.7億ドル");
    expect(response.answer).toContain("1年内返済予定の長期債務");
    expect(response.answer).toContain("返済期限");
    expect(response.answer).toContain("流動性の説明");
    expect(response.answer).not.toContain("99.9%");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.sourceRepairLabels).toContain("numeric_alignment_deterministic_recovery");
    expect(response.debug?.numericAlignmentStatus).toBe("passed");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("passed");
    expect(response.debug?.numericAlignmentFinalSurfaceAnswerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(response.debug?.semanticQualityLabels).toContain("q10_semantic_complete");
    expect(response.sources.map((source) => source.sourceId)).toContain("S13");
  });

  it("hashes the exact display-formatted repaired numeric answer", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "HASH", companyName: "Final Surface Corp." }), [{
      logicalName: "revenue",
      tagUsed: "Revenues",
      value: 143_756_000_000,
      unit: "USD",
      periodStart: "2025-10-01",
      periodEnd: "2025-12-31",
      periodKind: "quarter"
    }]);
    const response = await finalizeChatResponse({
      filing,
      question: "売上高はいくら？",
      response: {
        answer: "売上高は143.8億ドルです。これは提出資料で確認できる会社全体の売上高であり、特定の事業や地域だけを示す数値ではありません。数値の評価には、同じ対象期間の費用構造や利益率も合わせて確認する必要があります。前年同期との比較や増減要因は、この売上高だけから断定せず、管理層による業績説明とセグメント情報を追加で確認します。したがって、ここでは提出資料で型付き数値として確認できる売上高の提示にとどめます。",
        sources: [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!)]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_snapshot", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.debug?.numericAlignmentStatus).toBe("repaired");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("passed");
    expect(response.answer).toContain("売上高は1,437.6億ドル");
    expect(response.answer).toContain("\n\n");
    expect(response.debug?.numericAlignmentFinalSurfaceAnswerHash).toBe(
      createHash("sha256").update(response.answer).digest("hex")
    );
  });

  it("recovers the r64 MSFT liquidity block from all four typed positions", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "MSFT", companyName: "Microsoft Corp." }), [
      {
        logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: 127_494_000_000, comparisonValue: 93_515_000_000, unit: "USD",
        periodStart: "2025-07-01", periodEnd: "2026-03-31", comparisonPeriodStart: "2024-07-01",
        comparisonPeriodEnd: "2025-03-31", periodKind: "year_to_date", comparisonPeriodKind: "year_to_date"
      },
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue",
        value: 32_105_000_000, unit: "USD", periodEnd: "2026-03-31", periodKind: "instant" },
      { logicalName: "currentDebt", tagUsed: "LongTermDebtCurrent",
        value: 8_839_000_000, unit: "USD", periodEnd: "2026-03-31", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent",
        value: 31_423_000_000, unit: "USD", periodEnd: "2026-03-31", periodKind: "instant" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "資金繰りや負債に懸念はある？",
      response: {
        answer: "営業CFは1,274.94億ドルです。現金及び現金同等物は321.05億ドルです。1年内返済予定の長期債務は88.39億ドルです。長期債務（非流動）は314.23億ドルです。未確認の短期借入は999.9億ドルであり、資金繰りには問題があります。",
        sources: ["MX1", "MX2", "MX3", "MX4"].map((sourceId) =>
          sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === sourceId)!)
        )
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.debug?.numericAlignmentInitialStatus).toBe("blocked");
    expect(response.debug?.numericAlignmentStatus).toBe("passed");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("passed");
    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("現金及び現金同等物は321.1億ドル");
    expect(response.answer).toContain("1年内返済予定の長期債務は88.4億ドル");
    expect(response.answer).toContain("長期債務（非流動）は314.2億ドル");
    expect(response.answer).toContain("営業CFは1,274.9億ドル");
    expect(response.answer).toContain("返済期限と借換条件を確認する必要があります");
    expect(response.answer).not.toContain("999.9億ドル");
    expect(response.debug?.semanticQualityLabels).toContain("q10_semantic_complete");
    expect(response.debug?.sourceRepairLabels).toContain("numeric_alignment_deterministic_recovery");
  });

  it("preserves the prior filing URL when adding a transitive comparison citation", async () => {
    const filing: FilingCacheRecord = {
      ...makeFiling({ ticker: "URL", companyName: "Provenance Test Corp." }),
      primaryDocumentUrl: "https://example.com/current",
      metrics: [{
        logicalName: "revenue", tagUsed: "Revenues", value: 100_000_000_000, comparisonValue: 90_000_000_000,
        unit: "USD", periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
        comparisonTagUsed: "Revenues", comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31",
        comparisonPeriodKind: "quarter", comparisonSourceUrl: "https://example.com/prior", yoyPercent: 11.1111111111
      }],
      sourceChunks: [
        { sourceId: "CUR", sectionType: "xbrl_metric", sectionTitle: "売上高", sourceLabel: "current revenue",
          text: "売上高 100000000000 USD", startOffset: 0, endOffset: 24, tagName: "Revenues",
          metricRole: "current", sourceUrl: "https://example.com/current", sortOrder: 1 },
        { sourceId: "PRIOR", sectionType: "xbrl_metric", sectionTitle: "売上高（比較期）", sourceLabel: "prior revenue",
          text: "売上高 90000000000 USD", startOffset: 0, endOffset: 23, tagName: "Revenues",
          metricRole: "comparison", sourceUrl: "https://example.com/prior", sortOrder: 2 }
      ]
    };
    const response = await finalizeChatResponse({
      filing,
      question: "売上高の前年同期比は？",
      response: {
        answer: "売上高は前年同期比11.1%増です。",
        sources: [sourceToEvidence(filing.sourceChunks[0]!)]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_snapshot", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.debug?.numericAlignmentStatus).toBe("repaired");
    expect(response.sources.find((source) => source.sourceId === "PRIOR")?.sourceUrl).toBe("https://example.com/prior");
  });

  it("does not infer liquidity safety from cash and only one known debt component", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "SAFE", companyName: "Safety Test Corp." }), [
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue", value: 120_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent", value: 50_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "現金と負債を踏まえて、資金繰りに懸念はある？",
      response: {
        answer: "現金及び現金同等物は1,200億ドルです。純利息収入は99.9%改善しました。資金繰りや負債への懸念は全くありません。",
        sources: [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!), sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX2")!)]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("1年内返済予定の長期債務を確認できません");
    expect(response.answer).toContain("十分に比較できない");
    expect(response.answer).not.toContain("手元資金が上回っています");
    expect(response.answer).not.toContain("懸念は全くありません");
    expect(response.answer).not.toContain("99.9%");
    expect(response.debug?.numericAlignmentStatus).not.toBe("blocked");
  });

  it("removes false liquidity reassurance even when every displayed number is correct", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "SAFE2", companyName: "Safety Guard Corp." }), [
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue", value: 120_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent", value: 50_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "現金と負債を踏まえて、資金繰りに懸念はある？",
      response: {
        answer: "現金及び現金同等物は1,200億ドルです。長期債務（非流動）は500億ドルです。資金繰りや負債への懸念はありません。",
        sources: [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!), sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX2")!)]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.debug?.numericAlignmentInitialStatus).toBe("passed");
    expect(response.answer).toContain("1年内返済予定の長期債務を確認できません");
    expect(response.answer).toContain("十分に比較できない");
    expect(response.answer).not.toContain("懸念はありません");
    expect(response.debug?.sourceRepairLabels).toContain("liquidity_conclusion_deterministic_recovery");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("passed");
  });

  it("rebuilds a plain Q10 concern conclusion but preserves explicit uncertainty", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "CONCERN", companyName: "Concern Guard Corp." }), [
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue", value: 120_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent", value: 50_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" }
    ]);
    const common = {
      filing,
      question: "現金と負債を踏まえて、資金繰りに懸念はある？",
      responsePath: "openai" as const,
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai" as const, fallbackReason: null, sourceIdsValid: true,
        contentMode: "full" as const, geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai" as const, modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    };
    const sources = [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!), sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX2")!)];
    const definitive = await finalizeChatResponse({
      ...common,
      response: {
        answer: "現金及び現金同等物は1,200億ドルです。長期債務（非流動）は500億ドルです。資金繰りには懸念があります。",
        sources
      }
    });
    const cautious = await finalizeChatResponse({
      ...common,
      timings: createChatTimingTracker(),
      response: {
        answer: "現金及び現金同等物は1,200億ドルです。長期債務（非流動）は500億ドルです。資金繰りへの懸念の有無は、この資料だけでは断定できません。",
        sources
      }
    });

    expect(definitive.debug?.numericAlignmentInitialStatus).toBe("passed");
    expect(definitive.answer).toContain("1年内返済予定の長期債務を確認できません");
    expect(definitive.answer).not.toContain("懸念があります");
    expect(definitive.debug?.sourceRepairLabels).toContain("liquidity_conclusion_deterministic_recovery");
    expect(cautious.answer).toContain("資金繰りへの懸念は断定しません");
    expect(cautious.debug?.sourceRepairLabels).not.toContain("liquidity_conclusion_deterministic_recovery");
    expect(cautious.debug?.sourceRepairLabels).toContain("q10_semantic_deterministic_recovery");
  });

  it("rebuilds the r65 WMT low-concern answer and removes the leaked English qualifier", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "WMT", companyName: "Walmart Inc." }), [
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue",
        value: 10_729_000_000, unit: "USD", periodEnd: "2026-04-30", periodKind: "instant" },
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: 4_738_000_000, comparisonValue: 5_411_000_000, unit: "USD",
        periodStart: "2026-02-01", periodEnd: "2026-04-30", periodKind: "quarter",
        comparisonPeriodStart: "2025-02-01", comparisonPeriodEnd: "2025-04-30", comparisonPeriodKind: "quarter" },
      { logicalName: "currentDebt", tagUsed: "LongTermDebtCurrent",
        value: 3_896_000_000, unit: "USD", periodEnd: "2026-04-30", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent",
        value: 36_887_000_000, unit: "USD", periodEnd: "2026-04-30", periodKind: "instant" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "資金繰りや負債に懸念はある？",
      response: {
        answer: "現金及び現金同等物は約107.3億ドル、営業CFは約47.4億ドル/四半期と健全な規模です。一方、1年内返済予定の長期債務は約39億ドル、長期債務（非流動）は約368.9億ドルと負債は sizable に存在します。\n\n資金繰りの懸念は資料上は限定的に見えるが、現金対負債の関係だけで判断するには不足しており、追加の資金繰り・負債の償還スケジュール分析が必要です。",
        sources: ["MX1", "MX2", "MX3", "MX4"].map((sourceId) =>
          sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === sourceId)!)
        )
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("現金及び現金同等物は107.3億ドル");
    expect(response.answer).toContain("長期債務（非流動）は368.9億ドル");
    expect(response.answer).toContain("この3項目だけで資金繰り悪化を断定しません");
    expect(response.answer).not.toContain("限定的に見える");
    expect(response.answer).not.toContain("健全な規模");
    expect(response.answer).not.toContain("sizable");
    expect(response.debug?.sourceRepairLabels).toContain("liquidity_conclusion_deterministic_recovery");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("passed");
  });

  it("rebuilds the r65 GOOGL implied no-concern answer from typed liquidity positions", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "GOOGL", companyName: "Alphabet Inc." }), [
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue",
        value: 38_063_000_000, unit: "USD", periodEnd: "2026-03-31", periodKind: "instant" },
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: 45_790_000_000, comparisonValue: 36_150_000_000, unit: "USD",
        periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
        comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", comparisonPeriodKind: "quarter" },
      { logicalName: "currentDebt", tagUsed: "LongTermDebtCurrent",
        value: 1_998_000_000, unit: "USD", periodEnd: "2026-03-31", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent",
        value: 77_501_000_000, unit: "USD", periodEnd: "2026-03-31", periodKind: "instant" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "資金繰りや負債に懸念はある？",
      response: {
        answer: "現金及び現金同等物は380.6億ドルと多額で、営業CFは457.9億ドルと前年同期比26.7%増。1年内返済予定の長期債務は20億ドル、長期債務（非流動）は775.01億ドルと比較的高い水準。\n\n資金繰りの懸念は直ちには示されていませんが、負債の大きさや未開始のリース関連支払を含む長期債務は注視点です。情報としては、現金や営業CFの規模と借入の満期・構成が示されていますが、資金繰りの総合的な見通しを判断するにはキャッシュフローの詳細なスケジュールや融資契約の条件が不足しています。",
        sources: ["MX1", "MX2", "MX3", "MX4"].map((sourceId) =>
          sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === sourceId)!)
        )
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("現金及び現金同等物は380.6億ドル");
    expect(response.answer).toContain("長期債務（非流動）は775億ドル");
    expect(response.answer).toContain("返済期限と借換条件を確認する必要があります");
    expect(response.answer).toContain("この3項目だけで資金繰り悪化を断定しません");
    expect(response.answer).not.toContain("直ちには示されていません");
    expect(response.debug?.sourceRepairLabels).toContain("liquidity_conclusion_deterministic_recovery");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("passed");
  });

  it("routes common implied Q10 reassurance variants but retains explicit uncertainty", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "Q10PHRASE", companyName: "Q10 Phrase Corp." }), [
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue",
        value: 120_000_000_000, unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "currentDebt", tagUsed: "LongTermDebtCurrent",
        value: 10_000_000_000, unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent",
        value: 40_000_000_000, unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: 30_000_000_000, unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual" }
    ]);
    const sources = ["MX1", "MX2", "MX3", "MX4"].map((sourceId) =>
      sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === sourceId)!)
    );
    const common = {
      filing,
      question: "資金繰りや負債に懸念はある？",
      responsePath: "openai" as const,
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai" as const, fallbackReason: null, sourceIdsValid: true,
        contentMode: "full" as const, geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai" as const, modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      includeWebSupplement: false
    };
    const impliedReassurances = [
      "現金及び現金同等物は1,200億ドルです。資料上、資金繰りの懸念は限定的とみられます。",
      "現金及び現金同等物は1,200億ドルです。現時点で資金繰りの問題は確認されていません。",
      "現金及び現金同等物は1,200億ドルです。流動性への不安は当面見当たりません。",
      "現金及び現金同等物は1,200億ドル、営業CFは300億ドルと健全な規模です。",
      "資金繰りの懸念は特定の不足は示されず現金余力と安定した現金創出があります。"
    ];

    for (const answer of impliedReassurances) {
      const response = await finalizeChatResponse({
        ...common,
        timings: createChatTimingTracker(),
        response: { answer, sources }
      });
      expect(response.responsePath, answer).toBe("deterministic");
      expect(response.debug?.sourceRepairLabels, answer).toContain("liquidity_conclusion_deterministic_recovery");
    }

    const cautious = await finalizeChatResponse({
      ...common,
      timings: createChatTimingTracker(),
      response: {
        answer: "現金及び現金同等物は1,200億ドルです。1年内返済予定の長期債務は100億ドルです。長期債務（非流動）は400億ドルです。資金繰りへの懸念が限定的かどうかは、この資料だけでは判断できません。",
        sources
      }
    });
    expect(cautious.answer).toContain("資金繰り懸念がないとは断定しません");
    expect(cautious.debug?.sourceRepairLabels).not.toContain("liquidity_conclusion_deterministic_recovery");
    expect(cautious.debug?.sourceRepairLabels).toContain("q10_semantic_deterministic_recovery");
  });

  it("describes equal cash and confirmed debt portions as equal, not greater", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "EQUAL", companyName: "Equality Guard Corp." }), [
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue", value: 12_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "currentDebt", tagUsed: "LongTermDebtCurrent", value: 3_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent", value: 9_000_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "現金と負債を踏まえて、資金繰りに懸念はある？",
      response: {
        answer: "現金及び現金同等物は120億ドルです。1年内返済予定の長期債務は30億ドルです。長期債務（非流動）は90億ドルです。資金繰りは危機的です。",
        sources: ["MX1", "MX2", "MX3"].map((sourceId) => sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === sourceId)!))
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.debug?.numericAlignmentInitialStatus).toBe("passed");
    expect(response.answer).toContain("合計は手元資金と同額です");
    expect(response.answer).not.toContain("手元資金が上回っています");
    expect(response.answer).not.toContain("危機的です");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("passed");
  });

  it("rebuilds an incomplete cautious Q10 answer from the available typed positions", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "Q10SEM", companyName: "Q10 Semantic Corp." }), [
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue", value: 4_070_000_000,
        unit: "USD", periodEnd: "2025-12-31", periodKind: "instant" },
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities", value: 1_870_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-03-31", periodKind: "quarter" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "現金と負債を踏まえて、資金繰りに懸念はある？",
      response: {
        answer: "現金及び現金同等物は40.7億ドル、営業CFは18.7億ドルです。負債の満期情報は資料に直接記載されていません。資金繰りの懸念は判断できません。",
        sources: ["MX1", "MX2"].map((sourceId) => sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === sourceId)!))
      },
      responsePath: "openai",
      debug: {
        questionIntent: "liquidity_debt", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("1年内返済予定の長期債務・長期債務（非流動）を確認できません");
    expect(response.debug?.semanticQualityLabels).toContain("q10_semantic_complete");
    expect(response.debug?.sourceRepairLabels).toContain("q10_semantic_deterministic_recovery");
  });

  it("keeps pure cash-generation recovery on Q09 semantics after a numeric block", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "CASH", companyName: "Cash Test Corp." }), [
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities", value: 8_000_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-03-31", periodKind: "quarter", fiscalYear: 2025, fiscalQuarter: "Q1" },
      { logicalName: "netIncome", tagUsed: "NetIncomeLoss", value: 5_000_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-03-31", periodKind: "quarter", fiscalYear: 2025, fiscalQuarter: "Q1" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFの現金創出力はどう見る？",
      response: {
        answer: "営業CFは999.9億ドルです。資金繰りや負債への懸念はありません。",
        sources: [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!)]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "cash_flow", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("営業CF");
    expect(response.answer).toContain("同じ対象期間の純利益");
    expect(response.answer).toContain("運転資本");
    expect(response.answer).toContain("設備投資");
    expect(response.answer).not.toContain("短期債務");
    expect(response.answer).not.toContain("資金繰りや負債への懸念はありません");
    expect(response.debug?.numericAlignmentStatus).not.toBe("blocked");
  });

  it("rebuilds a generic Q09 fallback when typed cash-flow evidence is available", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "Q09SEM", companyName: "Q09 Semantic Corp." }), [
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities", value: 8_000_000_000,
        comparisonValue: 6_000_000_000, unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-03-31",
        comparisonPeriodStart: "2024-01-01", comparisonPeriodEnd: "2024-03-31", periodKind: "quarter",
        comparisonPeriodKind: "quarter", fiscalYear: 2025, fiscalQuarter: "Q1",
        comparisonFiscalYear: 2024, comparisonFiscalQuarter: "Q1" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFの現金創出力はどう見る？",
      response: {
        answer: "選択された資料だけでは、この質問に直接答えるための具体的な説明を十分に確認できません。",
        sources: [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!)]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "cash_flow", responsePath: "fallback", fallbackReason: "low_quality_answer", sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("営業CFは");
    expect(response.answer).toContain("運転資本");
    expect(response.answer).toContain("設備投資");
    expect(response.debug?.semanticQualityLabels).toContain("q09_semantic_complete");
    expect(response.debug?.sourceRepairLabels).toContain("q09_semantic_deterministic_recovery");
  });

  it("rebuilds a definitive Q09 health conclusion even when the OCF amount is correct", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "CASH2", companyName: "Cash Health Corp." }), [
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities", value: 8_000_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-03-31", periodKind: "quarter", fiscalYear: 2025, fiscalQuarter: "Q1" },
      { logicalName: "netIncome", tagUsed: "NetIncomeLoss", value: 5_000_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-03-31", periodKind: "quarter", fiscalYear: 2025, fiscalQuarter: "Q1" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFの現金創出力はどう見る？",
      response: {
        answer: "営業CFは80億ドルでプラスなので、現金創出力は健全です。",
        sources: [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!)]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "cash_flow", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.debug?.numericAlignmentInitialStatus).toBe("passed");
    expect(response.answer).toContain("健全性を断定しません");
    expect(response.answer).not.toContain("現金創出力は健全です");
    expect(response.debug?.sourceRepairLabels).toContain("cash_flow_conclusion_deterministic_recovery");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("passed");
  });

  it("uses explicit Q09 insufficiency without typed OCF and preserves cautious wording", async () => {
    const filing = makeFiling({ ticker: "NOOCF", companyName: "No OCF Corp.", sourceText: "Management discussed working capital without a typed operating cash flow fact." });
    const common = {
      filing,
      question: "営業CFの現金創出力はどう見る？",
      responsePath: "openai" as const,
      debug: {
        questionIntent: "cash_flow", responsePath: "openai" as const, fallbackReason: null, sourceIdsValid: true,
        contentMode: "full" as const, geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai" as const, modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      includeWebSupplement: false
    };
    const sources = [sourceToEvidence(filing.sourceChunks[0]!)];
    const definitive = await finalizeChatResponse({
      ...common,
      timings: createChatTimingTracker(),
      response: { answer: "現金創出力は弱いです。", sources }
    });
    const cautious = await finalizeChatResponse({
      ...common,
      timings: createChatTimingTracker(),
      response: { answer: "現金創出力の健全性は、この資料だけでは断定しません。", sources }
    });

    expect(definitive.answer).toContain("営業CFを型付き数値として確認できない");
    expect(definitive.answer).not.toContain("現金創出力は弱いです");
    expect(definitive.debug?.sourceRepairLabels).toContain("cash_flow_conclusion_deterministic_recovery");
    expect(cautious.answer).toContain("健全性は、この資料だけでは断定しません");
    expect(cautious.debug?.sourceRepairLabels).not.toContain("cash_flow_conclusion_deterministic_recovery");
  });

  it("keeps a valid 100% decline label when positive operating cash flow reaches zero", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "ZERO", companyName: "Zero Cash Flow Corp." }), [
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities", value: 0,
        comparisonValue: 1_000_000_000, unit: "USD", periodStart: "2026-01-01", periodEnd: "2026-03-31",
        comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", periodKind: "quarter",
        comparisonPeriodKind: "quarter", fiscalYear: 2026, fiscalQuarter: "Q1",
        comparisonFiscalYear: 2025, comparisonFiscalQuarter: "Q1" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFは健全？現金創出力をどう見る？",
      response: {
        answer: "営業CFは0ドルで、前年同期の10億ドルから100%減です。同じ対象期間の純利益は確認できないため、純利益との対応は判断できません。運転資本の増減は確認が必要です。設備投資も確認し、フリーCFの余力を見ます。",
        sources: [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!)]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "cash_flow", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("100%減");
    expect(response.debug?.semanticQualityLabels).toContain("q09_sign_safe");
  });

  it("lets explicit debt wording override a stale cash-flow intent in mixed Q09/Q10 recovery", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "MIX", companyName: "Mixed Intent Corp." }), [
      { logicalName: "operatingCashFlow", tagUsed: "NetCashProvidedByUsedInOperatingActivities", value: 8_000_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-03-31", periodKind: "quarter" },
      { logicalName: "cashAndCashEquivalents", tagUsed: "CashAndCashEquivalentsAtCarryingValue", value: 20_000_000_000,
        unit: "USD", periodEnd: "2025-03-31", periodKind: "instant" },
      { logicalName: "currentDebt", tagUsed: "LongTermDebtCurrent", value: 3_000_000_000,
        unit: "USD", periodEnd: "2025-03-31", periodKind: "instant" },
      { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent", value: 9_000_000_000,
        unit: "USD", periodEnd: "2025-03-31", periodKind: "instant" }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFと現金、負債を踏まえて資金繰りは？",
      response: {
        answer: "営業CFは999.9億ドルです。資金繰りへの懸念は全くありません。",
        sources: [sourceToEvidence(filing.sourceChunks.find((source) => source.sourceId === "MX1")!)]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "cash_flow", responsePath: "openai", fallbackReason: null, sourceIdsValid: true,
        contentMode: "full", geminiCalled: true, geminiSucceeded: true, schemaValid: true,
        modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("1年内返済予定の長期債務");
    expect(response.answer).toContain("長期債務（非流動）");
    expect(response.answer).toContain("この3項目だけから直ちに資金繰り懸念がないとは断定しません");
    expect(response.answer).toContain("コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません");
    expect(response.answer).not.toContain("懸念は全くありません");
    expect(response.debug?.numericAlignmentStatus).not.toBe("blocked");
  });

  it("rebuilds margin answers when operating and net margin directions diverge", async () => {
    const base = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const filing: FilingCacheRecord = {
      ...base,
      metrics: [
        { logicalName: "revenue", tagUsed: "Revenues", value: 17_415_000_000, comparisonValue: 14_249_000_000,
          unit: "USD", periodEnd: "2026-03-31", comparisonPeriodEnd: "2025-03-31", periodKind: "quarter" },
        { logicalName: "operatingIncome", tagUsed: "OperatingIncomeLoss", value: 3_083_000_000, comparisonValue: 2_579_000_000,
          unit: "USD", periodEnd: "2026-03-31", comparisonPeriodEnd: "2025-03-31", periodKind: "quarter" },
        { logicalName: "netIncome", tagUsed: "NetIncomeLoss", value: 2_543_000_000, comparisonValue: 2_009_000_000,
          unit: "USD", periodEnd: "2026-03-31", comparisonPeriodEnd: "2025-03-31", periodKind: "quarter" }
      ],
      sourceChunks: [
        { sourceId: "S9", sectionType: "xbrl_metric", sectionTitle: "売上高", sourceLabel: "XBRL 売上高",
          text: "売上高 17415000000 USD", startOffset: 0, endOffset: 25, tagName: "Revenues", sortOrder: 9 },
        { sourceId: "S10", sectionType: "xbrl_metric", sectionTitle: "営業利益", sourceLabel: "XBRL 営業利益",
          text: "営業利益 3083000000 USD", startOffset: 26, endOffset: 51, tagName: "OperatingIncomeLoss", sortOrder: 10 },
        { sourceId: "S11", sectionType: "xbrl_metric", sectionTitle: "純利益", sourceLabel: "XBRL 純利益",
          text: "純利益 2543000000 USD", startOffset: 52, endOffset: 75, tagName: "NetIncomeLoss", sortOrder: 11 },
        { sourceId: "S5", sectionType: "md_a", sectionTitle: "Margin discussion", sourceLabel: "10-Q Margin discussion",
          text: "Operating expenses increased due to unfavorable manufacturing costs and higher SG&A and R&D expenses.",
          startOffset: 76, endOffset: 175, sortOrder: 5 }
      ]
    };
    const response = await finalizeChatResponse({
      filing,
      question: "利益率が改善、または悪化した理由は？",
      response: {
        answer: "営業利益率は17.7%、純利益率は14.6%です。利益率は改善しており、費用構造の改善が要因です。",
        sources: filing.sourceChunks.map(sourceToEvidence)
      },
      responsePath: "openai",
      debug: {
        questionIntent: "margin_profitability", responsePath: "openai", fallbackReason: null,
        sourceIdsValid: true, contentMode: "full", geminiCalled: true, geminiSucceeded: true,
        schemaValid: true, modelProvider: "openai", modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("利益率は項目ごとに方向が分かれています");
    expect(response.answer).toMatch(/営業利益率[^。]*低下/);
    expect(response.answer).toMatch(/純利益率[^。]*改善/);
    expect(response.answer).toContain("研究開発・販管費の増加");
    expect(response.debug?.sourceRepairLabels).toContain("split_margin_direction_deterministic_recovery");
  });

  it("uses previous Q06 margin drivers when source gate passed but the fallback answer lost them", async () => {
    const filing = makeFiling({ ticker: "JPM", companyName: "JPMorgan Chase & Co." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "純利益は 570.5億ドル で、前年同期比 2.4%減 です。利益率の方向は確認できますが、改善/悪化の具体的な要因は十分に特定できません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackUserReason: "margin_driver_sources_missing",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        followupPreviousAnswer: "利益率の変化要因としては、非利息費用が4%増加（人件費・ブローカレッジ費用・マーケティング支出の増加など）と、信用損失引当金の変動や市場関連の収益の要因が挙げられています。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.answer).toContain("前問で挙がっていた利益率要因候補");
    expect(response.answer).toContain("人件費");
    expect(response.answer).toContain("販売管理費");
    expect(response.answer).toContain("信用損失引当");
    expect(response.answer).not.toContain("訴訟費用・引当");
    expect(response.answer).toContain("一時要因か構造的変化かは断定しません");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q06_previous_answer_margin_candidate_repair"]));
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("extracts baseline-style sector revenue drivers from the previous answer for Q04 follow-ups", async () => {
    const cases = [
      {
        ticker: "XOM",
        previousAnswer: "本文で説明されている要因: 原油価格は10年平均レンジ内、需要が堅調でも市場価格要因と供給動向が影響。上流投資増加やPioneer買収の影響も言及。",
        expected: ["資源価格", "需給環境", "買収影響"]
      },
      {
        ticker: "LLY",
        previousAnswer: "売上は主に量の増加によって押し上げられ、実現価格の低下で部分的に相殺。Mounjaro と Zepbound による需要拡大が主な推進要因。",
        expected: ["販売数量・出荷量", "価格・ミックス", "製品カテゴリ成長"]
      },
      {
        ticker: "KO",
        previousAnswer: "ボトリング投資およびコーヒー・水・スポーツ飲料などのカテゴリ成長を含むボリューム拡大が売上増の要因で、unit case volume の成長が主要指標です。",
        expected: ["販売数量・出荷量", "製品カテゴリ成長", "ボトリング投資"]
      }
    ] as const;

    for (const testCase of cases) {
      const filing = makeFiling({ ticker: testCase.ticker });
      const response = await finalizeChatResponse({
        filing,
        question: "その要因は一時的？それとも続きそう？",
        response: {
          answer: "前問の具体的な要因を十分に特定できていないため、この資料だけで一時要因か継続要因かは分類しません。判断には、経営陣による業績説明、セグメント実績、売上説明の追加確認が必要です。",
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
          followupPreviousAnswer: testCase.previousAnswer,
          modelProvider: "openai",
          modelName: "gpt-5-nano"
        },
        env: {} as Env,
        config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
        timings: createChatTimingTracker(),
        includeWebSupplement: false
      });

      expect(response.answer).toContain("前問で挙がっていた売上要因候補");
      for (const expected of testCase.expected) {
        expect(response.answer).toContain(expected);
      }
      expect(response.answer).not.toContain("前問の具体的な要因を十分に特定");
      expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q04_previous_answer_driver_candidate_repair"]));
      expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
    }
  });

  it("extracts baseline-style airline margin drivers from the previous answer for Q06 follow-ups", async () => {
    const filing = makeFiling({ ticker: "DAL", companyName: "Delta Air Lines, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "利益率の方向は確認できますが、具体的な利益率要因は十分に特定できません。そのため、この資料だけで一時要因か構造的変化かは分類しません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        followupPreviousAnswer: "本文では、原価・人件費・燃料費などのコスト、販管費・開発費などの営業費用が利益率や利益の動きを見る材料として出ています。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("前問で挙がっていた利益率要因候補");
    expect(response.answer).toContain("営業費用・原価");
    expect(response.answer).toContain("人件費");
    expect(response.answer).toContain("燃料費");
    expect(response.answer).toContain("販売管理費");
    expect(response.answer).not.toContain("具体的な利益率要因は十分に特定できません");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q06_previous_answer_margin_candidate_repair"]));
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("does not reuse a previous Q06 answer that only points to tax mechanics", async () => {
    const filing = makeFiling({ ticker: "MU", companyName: "Micron Technology, Inc." });
    const answer = "前問の具体的な利益率要因が十分に特定できていません。そのため、選択された資料だけで一時要因か構造的変化かは分類しません。";
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer,
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        followupPreviousAnswer: "前問では Pillar Two と noncurrent income taxes payable の増加が主な説明でした。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toBe(answer);
    expect(response.debug?.sourceRepairLabels ?? []).not.toContain("q06_previous_answer_margin_candidate_repair");
  });

  it("uses ad-platform cost drivers from the previous Q06 answer", async () => {
    const filing = makeFiling({ ticker: "GOOGL", companyName: "Alphabet Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "確認できているのは、純利益が625.8億ドル、前年同期比81.2%という点です。ただし、利益率変化の具体的な要因は十分に特定できていません。そのため、選択された資料だけで一時要因か構造的変化かは分類しません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        followupPreviousAnswer: "改善/悪化の要因としては、売上総利益を含むコストの増加（減価償却費、TAC、コンテンツ調達費、従業員報酬など）も同時に発生していることが挙げられ、これが営業利益の伸びを抑制する要因となっています。",
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.answer).toContain("前問で挙がっていた利益率要因候補");
    expect(response.answer).toContain("原価・営業コスト");
    expect(response.answer).toContain("減価償却費");
    expect(response.answer).toContain("トラフィック獲得コスト");
    expect(response.answer).toContain("コンテンツ調達費");
    expect(response.answer).toContain("人件費");
    expect(response.debug?.sourceRepairLabels).toEqual(expect.arrayContaining(["q06_previous_answer_margin_candidate_repair"]));
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("classifies source-insufficient Q06 fallbacks as margin-driver missing rather than revenue-driver missing", async () => {
    const filing = makeFiling({ ticker: "KO", companyName: "The Coca-Cola Company" });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "営業利益は 43.6億ドル で、前年同期比 19.1%増です。利益率の方向は確認できますが、改善/悪化の具体的な要因は十分に特定できません。判断には、コスト、mix、pricing、営業費用、provision、restructuring、impairment、segment margin の説明が必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        sourceGateMissingSourceTypes: ["margin discussion", "cost discussion", "segment margin"],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackCategory).toBe("source_insufficient");
    expect(response.debug?.fallbackUserReason).toBe("margin_driver_sources_missing");
    expect(response.debug?.fallbackUserReason).not.toBe("revenue_driver_sources_missing");
    expect(response.debug?.missingEvidenceLabelsJa).toEqual(expect.arrayContaining(["利益率・採算性の説明"]));
    expect(response.answer).not.toMatch(/\bmix\b|pricing|provision|restructuring|impairment|segment margin/i);
  });

  it("keeps source-insufficient Q03 fallbacks classified as revenue-driver missing", async () => {
    const filing = makeFiling({ ticker: "MSFT", companyName: "Microsoft Corp" });
    const response = await finalizeChatResponse({
      filing,
      question: "売上成長、または減収の主な要因は？",
      response: {
        answer: "売上高は812.7億ドルで、前年同期比16.7%です。ただし、この資料だけだと会社固有の売上要因までは追いきれません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "yoy_change",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: false,
        sourceGateMissingSourceTypes: ["profitability discussion", "segment margin"],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackUserReason).toBe("revenue_driver_sources_missing");
    expect(response.debug?.fallbackUserReason).not.toBe("margin_driver_sources_missing");
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
    const filing = withTypedMetrics(makeFiling(), [{
      logicalName: "revenue", tagUsed: "Revenue", value: 1_040_000_000, comparisonValue: 1_073_271_414,
      unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual",
      comparisonPeriodStart: "2024-01-01", comparisonPeriodEnd: "2024-12-31", comparisonPeriodKind: "annual"
    }]);
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

  it("replaces generic revenue-breakdown category labels with a source-insufficient answer", async () => {
    const filing = makeFiling({ ticker: "KO", companyName: "The Coca-Cola Company" });
    const response = await finalizeChatResponse({
      filing,
      question: "直近決算の売上はどうだった？",
      response: {
        answer: "主な売上区分: 厳密な内訳は資料中で「geography revenue」として区分されています。大きい区分: geography revenue が最大の売上区分です。変化の方向: YoYで約12.1%増加しています。",
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

    expect(response.responsePath).toBe("fallback");
    expect(response.answer).toContain("会社固有の売上の柱");
    expect(response.answer).toContain("分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません");
    expect(response.answer).not.toContain("geography revenue");
    expect(response.debug?.fallbackCategory).toBe("source_insufficient");
    expect(response.debug?.fallbackUserReason).toBe("revenue_breakdown_sources_missing");
    expect(response.debug?.guardLabels).toEqual(expect.arrayContaining(["revenue_breakdown_generic_category_only"]));
  });

  it("replaces baseline-style total-revenue-only breakdown answers", async () => {
    const examples = [
      {
        ticker: "MU",
        question: "直近決算の売上はどうだった？",
        questionIntent: "revenue_snapshot",
        answer: "主な売上区分: 売上高。大きい区分: なし（区分別の内訳は本資料には記載されていません）。変化があればその方向: YoYで約345.72%増となっています。"
      },
      {
        ticker: "MSFT",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_driver",
        answer: "主な売上区分: 売上高。大きい区分: セグメント別内訳は資料内で具体のセグメント名は示されていません。変化の方向: YoYで売上高は16.7%増。"
      },
      {
        ticker: "TSLA",
        question: "直近決算の売上はどうだった？",
        questionIntent: "revenue_snapshot",
        answer: "主な売上区分: 売上高は 0.9億ドル。大きい区分: 総売上高（Revenues）として公開。変化: YoY -2.9% 増減。この資料だけでは分からない内訳: 売上の製品別・地域別の内訳は提供データに含まれていません。"
      },
      {
        ticker: "LLY",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_driver",
        answer: "主な売上区分: セグメント別の売上は公表された全体売上高に関する言及のみで、個別セグメント別の数値は本資料からは読み取れません。大きい区分: 大きな区分の内訳は明示されていません。"
      },
      {
        ticker: "MSFT",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_driver",
        answer: "主な売上区分: セグメント別の売上高の内訳は本文の要約には示されていません。 大きい区分としては売上高全体が前年比16.7%増の812.7億ドルとなっていますが、どのセグメントや地域が伸びたかの内訳はこの資料だけでは分かりません。"
      },
      {
        ticker: "JPM",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_driver",
        answer: "主な売上区分: 売上高全体は前年度比2.8%増。 大きい区分や地域別の内訳は本資料の提供情報では不明。 変化の方向としては全体の成長は緩やか、ただしセグメント別の寄与度や地域別の詳細は分からない。 この資料だけでは分からない内訳: セグメント別の売上や地域別の内訳、各セグメントの成長率。"
      },
      {
        ticker: "V",
        question: "直近決算の売上はどうだった？",
        questionIntent: "revenue_snapshot",
        answer: "主な売上区分は service revenue が最大。 大きい区分としてはサービス売上が主力。 直近の売上は前年比で17.1%増の112.3億ドル。 この資料だけでは内訳の詳細な区分は分からない。"
      },
      {
        ticker: "V",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_driver",
        answer: "セグメント別の内訳情報は本文で明示されていません。 大きい区分として売上高は全体で112.3億ドル、前年同期比17.1%増です。 変化の方向としては価値付加サービスが3ヶ月・6ヶ月ベースで増加、全体の伸びは取引量や処理件数の拡大が要因と説明されていますが、地域別や具体的セグメント別の伸び弱さはこの資料単体では分かりません。"
      },
      {
        ticker: "MSFT",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_driver",
        answer: "主な売上区分: セグメント別売上高は公表値として全体売上高は812.7億ドル、前年同期比で増加。大きい区分についてはセグメント別内訳は本資料には記載なし。変化の方向としては前年比増加が示唆されるが、セグメント別の成長ドライバーや地域別の内訳は本資料では不明瞭。この資料だけでは分からない内訳: セグメント別の売上構成比、地域別の寄与、各大区分の個別成長率。"
      },
      {
        ticker: "TSLA",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_analysis",
        answer: "主な売上区分: 売上高全体の内訳は提示されていません。 大きい区分: セグメント別の内訳は本資料には記載なし。 変化の方向: 全体売上高は前年比-2.9%減、規模の大きい区分の伸び/縮みは不明。 この資料だけでは分からない内訳: セグメント別、地域別の成長・不振の内訳は示されていません。"
      },
      {
        ticker: "LLY",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_driver",
        answer: "主な売上区分は不明。 大きい区分や具体的なセグメント別の伸びの方向性は、提供された資料内のセグメント別売上の内訳情報が示されていません。 この資料だけでは分からない内訳。"
      },
      {
        ticker: "V",
        question: "どのセグメントや地域が伸びた？弱かった部分は？",
        questionIntent: "segment_driver",
        answer: "主な売上区分: 売上高全体を回答として扱います。 大きい区分としては支払い関連サービス全般が中心です。 変化の方向: 売上高は前年比で増加（YoY +17.1%）しています。 この資料だけでは分からない内訳: セグメント別の具体的な売上成長寄与（例：地域別、仕組み別の内訳）は明示されていません。"
      }
    ] as const;

    for (const example of examples) {
      const filing = makeFiling({ ticker: example.ticker });
      const response = await finalizeChatResponse({
        filing,
        question: example.question,
        response: {
          answer: example.answer,
          sources: [sourceToEvidence(filing.sourceChunks[0])]
        },
        responsePath: "openai",
        debug: {
          questionIntent: example.questionIntent,
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

      expect(response.responsePath).toBe("fallback");
      expect(response.answer).toContain("会社固有の売上の柱");
      expect(response.debug?.fallbackUserReason).toBe("revenue_breakdown_sources_missing");
      expect(response.debug?.guardLabels).toContain("revenue_breakdown_generic_category_only");
    }
  });

  it("does not downgrade revenue-breakdown answers with concrete company categories", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "どの売上区分が伸びてる？",
      response: {
        answer: "主な売上区分は Google Services と Google Cloud。大きい区分は Google Services で、YouTube ads は成長、Google Network は減少です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "segment_driver",
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
    expect(response.answer).toContain("Googleサービス");
    expect(response.debug?.fallbackUserReason).not.toBe("revenue_breakdown_sources_missing");
    expect(response.debug?.guardLabels ?? []).not.toContain("revenue_breakdown_generic_category_only");
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

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.sourceIdsValid).toBe(true);
    expect(response.debug?.fallbackKind).toBe("low_quality");
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
    expect(response.debug?.fallbackUserReason).toBe("answer_too_metric_only");
    expect(response.debug?.modelProvider).toBe("openai");
    expect(response.answer).toContain("この会社の収益源");
    expect(response.answer).toContain("それだけでは");
    expect(response.answer).not.toContain("source");
    expect(response.answer).not.toMatch(/^(この会社は)?主に?売上/);
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("rewrites generic product-or-service business-model answers", async () => {
    const filing = makeFiling({ ticker: "MSFT", companyName: "Microsoft Corp" });
    const response = await finalizeChatResponse({
      filing,
      question: "この会社は何で儲けている？",
      response: {
        answer: "主な収益源は顧客との契約に基づく売上高で、製品やサービスの提供を通じて収益を上げています。",
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

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackUserReason).toBe("business_model_sources_missing");
    expect(response.answer).toContain("事業内容");
    expect(response.answer).not.toContain("製品やサービスの提供");
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

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackKind).toBe("low_quality");
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
    const filing = withTypedMetrics(makeFiling(), [{
      logicalName: "revenue", tagUsed: "Revenue", value: 601_800_000,
      unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual"
    }]);
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

  it("replaces a generic Q03 under-answer when filing-backed revenue drivers exist", async () => {
    const base = makeFiling({ ticker: "NVDA", companyName: "NVIDIA CORP" });
    const driverText = "Revenue growth in the first quarter was driven by data center products for accelerated computing and AI solutions. Blackwell continued to account for the majority of our system shipments.";
    const filing = withTypedMetrics({
      ...base,
      sourceChunks: [
        ...base.sourceChunks,
        {
          ...base.sourceChunks[0],
          sourceId: "NVDA-Q03-DRIVER",
          sectionType: "md_a" as const,
          sourceLabel: "10-Q Revenue driver discussion",
          text: driverText,
          startOffset: 0,
          endOffset: driverText.length,
          sortOrder: 99
        }
      ]
    }, [{
      logicalName: "revenue", tagUsed: "Revenues", value: 81_615_000_000,
      comparisonValue: 44_062_000_000, unit: "USD",
      periodStart: "2026-01-26", periodEnd: "2026-04-26", periodKind: "quarter",
      comparisonPeriodStart: "2025-01-27", comparisonPeriodEnd: "2025-04-27",
      comparisonPeriodKind: "quarter", yoyPercent: 85.2
    }]);
    const response = await finalizeChatResponse({
      filing,
      question: "売上成長、または減収の主な要因は？",
      response: {
        answer: "追加確認としてはマージンや費用構造の影響、長期的な需要動向の持続性の評価が不足している。",
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

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("データセンター向けAI製品");
    expect(response.answer).not.toContain("評価が不足");
  });

  it("does not treat taxes or expenses as revenue drivers", async () => {
    const filing = makeFiling({ ticker: "MU", companyName: "Micron Technology, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "売上成長、または減収の主な要因は？",
      response: {
        answer: "売上高は414.6億ドルで、前年同期比345.7%増です。本文では、higher noncurrent income taxes payable related to the implementation of Pillar Two が売上変化の要因として説明されています。",
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

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackCategory).toBe("source_insufficient");
    expect(response.debug?.fallbackUserReason).toBe("revenue_driver_sources_missing");
    expect(response.debug?.guardLabels).toContain("revenue_driver_non_revenue_cause_removed");
    expect(response.answer).toContain("売上の増減は確認できます");
    expect(response.answer).toContain("売上以外の損益項目だけでは、売上要因として扱いません");
    expect(response.answer).not.toContain("Pillar Two");
    expect(response.answer).not.toContain("income taxes payable");
  });

  it("does not treat JPM expense wording or Google TAC as revenue drivers", async () => {
    const cases = [
      {
        ticker: "JPM",
        answer: "売上高は 1,824.5億ドル で、前年同期比 2.8%増 です。本文では、higher brokerage expenseとdistribution fees、higher auto lease depreciationとcontinued investments in technologyとmarketing、as well as higher 稼働率 expense が売上変化の要因として説明されています。",
        forbidden: /brokerage|distribution fees|auto lease depreciation|technology|marketing|稼働率 expense|ブローカー費用|流通費用|オートリース減価償却|技術投資|マーケティング費用/
      },
      {
        ticker: "GOOGL",
        answer: "売上高は 1,099億ドル で、前年同期比 21.8%増 です。本文では、an increase in revenues、partially offset by an increase in TAC が売上変化の要因として説明されています。",
        forbidden: /traffic acquisition|トラフィック獲得|partially offset|一部相殺/
      }
    ] as const;

    for (const testCase of cases) {
      const filing = makeFiling({ ticker: testCase.ticker });
      const response = await finalizeChatResponse({
        filing,
        question: "売上成長、または減収の主な要因は？",
        response: {
          answer: testCase.answer,
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

      expect(response.responsePath).toBe("fallback");
      expect(response.debug?.fallbackUserReason).toBe("revenue_driver_sources_missing");
      expect(response.debug?.guardLabels).toContain("revenue_driver_non_revenue_cause_removed");
      expect(response.answer).toContain("売上以外の損益項目だけでは、売上要因として扱いません");
      expect(response.answer).not.toMatch(testCase.forbidden);
    }
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
    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
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

  it("repairs raw-English risk answers using selected excerpts before falling back", async () => {
    const filing = makeFiling();
    const response = await finalizeChatResponse({
      filing,
      question: "この filing で重要なリスクは？",
      response: {
        answer: "Part I. Item 1A Risk Factors states that cybersecurity risk and costs related to excess properties, premises or facilities may affect results.",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "risk_factors",
        responsePath: "openai",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceExcerpts: [
          "Management's discussion and analysis on pages 146-149 includes a discussion of cybersecurity risk.",
          "The Firm may incur costs in connection with excess properties, premises or facilities."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackKind).not.toBe("language_guard_fallback");
    expect(response.debug?.languageGuardOk).toBe(true);
    expect(response.debug?.finalAnswerLanguageLabels).toContain("answer_repaired_to_japanese");
    expect(response.debug?.sourceRepairLabels).toContain("language_guard_source_backed_repair");
    expect(response.answer).toContain("サイバーセキュリティ");
    expect(response.answer).toContain("不動産・施設コスト");
    expect(response.answer).not.toContain("cybersecurity risk");
    expect(response.answer).not.toContain("excess properties");
  });

  it("repairs raw-English margin durability answers using selected cost excerpts", async () => {
    const filing = makeFiling({ ticker: "DAL", companyName: "Delta Air Lines, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "利益率要因として確認できるのは、Operating expense increased primarily due to refinery sales to third parties, salaries and aircraft fuel costs...です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "openai",
        fallbackReason: "low_quality_answer",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceExcerpts: [
          "Total operating expense increased primarily due to higher expenses related to refinery sales to third parties, salaries and related costs and aircraft fuel costs.",
          "Total operating cost per available seat mile increased, while non-fuel unit cost also increased."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackKind).not.toBe("language_guard_fallback");
    expect(response.debug?.languageGuardOk).toBe(true);
    expect(response.debug?.finalAnswerLanguageLabels).toContain("answer_repaired_to_japanese");
    expect(response.answer).toContain("利益率要因候補");
    expect(response.answer).toContain("営業費用");
    expect(response.answer).toContain("燃料費");
    expect(response.answer).toContain("一時要因か構造的変化かは断定しません");
    expect(response.answer).not.toContain("Operating expense");
    expect(response.answer).not.toContain("aircraft fuel");
  });

  it("promotes a TSLA Q04 selected-narrative repair when the source gate was not applied", async () => {
    const filing = makeFiling({ ticker: "TSLA", companyName: "Tesla, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "The selected filing excerpts do not establish whether the driver is temporary or durable.",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "low_quality",
        lowQualityReason: "revenue_driver_declined_despite_context",
        sourceIdsValid: true,
        sourceGateApplied: false,
        sourceGateSufficient: null,
        selectedSourceIds: ["TSLA-SERVICES"],
        selectedSourceLabels: ["10-Q services revenue discussion"],
        selectedSourceExcerpts: [
          "Services and other revenue increased primarily due to increases in used vehicle sales volume, non-warranty maintenance services and collision revenue, paid Supercharging sessions and automotive insurance business revenue."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.answer).toContain("売上要因候補");
    expect(response.answer).toContain("販売数量");
    expect(response.answer).toContain("一時要因か継続要因かは断定しません");
    expect(response.sources.map((source) => source.sourceId)).toContain("TSLA-SERVICES");
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("accepts source-gate-passed Q06 evidence fallback as source-backed answer", async () => {
    const filing = makeFiling({ ticker: "NVDA", companyName: "NVIDIA Corporation" });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "利益率要因として確認できるのは、在庫評価、価格、製造コストです。一時要因か構造的変化かは、このfilingだけでは断定しません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        evidenceFallbackUsed: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceExcerpts: [
          "Cost of revenue includes manufacturing support costs, inventory provisions, tariffs and shipping costs."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.fallbackKindSource).toBeUndefined();
  });

  it("accepts source-backed Q06 answers even when runtime intent stayed margin profitability", async () => {
    const filing = makeFiling({ ticker: "DAL", companyName: "Delta Air Lines, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "前問の利益率要因候補として確認できるのは、営業費用、燃料費、人件費、単位コストです。ただし、選択された抜粋だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、営業費用、燃料費、人件費、単位コストです。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_profitability",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackUserReason: "margin_driver_sources_missing",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        evidenceFallbackUsed: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceExcerpts: [
          "Total operating expense increased primarily due to salaries and related costs and aircraft fuel costs.",
          "Total operating cost per available seat mile increased, while non-fuel unit cost also increased."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
  });

  it("recovers generic margin durability fallbacks when runtime intent stayed margin profitability", async () => {
    const filing = withTypedMetrics(makeFiling({
      ticker: "MARGIN",
      companyName: "Margin Recovery Corp.",
      sourceText: "Selling, general and administrative expenses increased, driven by higher employee compensation and research and development expenses."
    }), [
      {
        logicalName: "revenue", tagUsed: "Revenues", value: 22_387_000_000,
        comparisonValue: 19_335_000_000, unit: "USD",
        periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
        comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", comparisonPeriodKind: "quarter"
      },
      {
        logicalName: "operatingIncome", tagUsed: "OperatingIncomeLoss", value: 941_000_000,
        comparisonValue: 399_000_000, unit: "USD",
        periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
        comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", comparisonPeriodKind: "quarter"
      },
      {
        logicalName: "netIncome", tagUsed: "NetIncomeLoss", value: 477_000_000,
        comparisonValue: 409_000_000, unit: "USD",
        periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
        comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", comparisonPeriodKind: "quarter"
      }
    ]);
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "利益率の方向は確認できますが、具体的な利益率要因は十分に特定できません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "margin_profitability",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "low_quality",
        lowQualityReason: "profit_cause_revenue_only",
        sourceIdsValid: true,
        sourceGateApplied: false,
        sourceGateSufficient: null,
        selectedSourceSectionFamilies: ["margin_discussion", "xbrl_metric"],
        selectedSourceExcerpts: filing.sourceChunks.map((source) => source.text),
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.answer).toContain("利益率要因候補");
    expect(response.answer).toContain("人件費");
    expect(response.answer).toContain("一時要因か構造的変化かは断定できません");
    expect(response.answer).not.toMatch(/純利益率[^。]*%増/u);

    const contaminatedResponse = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "一時的とは断定しにくいです。Microsoft 365 E5とcontinued Microsoft 365 Commercial seat growth が売上変化の要因として説明されています。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "deterministic",
      debug: {
        questionIntent: "margin_profitability",
        responsePath: "deterministic",
        fallbackReason: null,
        sourceIdsValid: true,
        sourceGateApplied: false,
        sourceGateSufficient: null,
        selectedSourceSectionFamilies: ["revenue_discussion", "margin_discussion", "xbrl_metric"],
        selectedSourceExcerpts: filing.sourceChunks.map((source) => source.text),
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(contaminatedResponse.responsePath).toBe("deterministic");
    expect(contaminatedResponse.debug?.fallbackKind).toBe("none");
    expect(contaminatedResponse.answer).toContain("利益率要因候補");
    expect(contaminatedResponse.answer).toContain("人件費");
    expect(contaminatedResponse.answer).not.toContain("売上変化の要因");
    expect(contaminatedResponse.answer).not.toContain("continued Microsoft");
  });

  it("keeps explicit revenue-driver durability intent ahead of incidental margin excerpts", async () => {
    const filing = makeFiling({
      ticker: "INDUSTRIAL",
      companyName: "Industrial Revenue Corp.",
      sourceText: "Manufacturing costs and selling, general and administrative expenses increased during the period."
    });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "継続性は断定できません。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "low_quality",
        sourceIdsValid: true,
        sourceGateApplied: false,
        sourceGateSufficient: null,
        followupPreviousAnswer: "全社売上は販売数量の増加と価格実現の改善が主な説明要因です。",
        selectedSourceSectionFamilies: ["margin_discussion"],
        selectedSourceExcerpts: filing.sourceChunks.map((source) => source.text),
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("deterministic");
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.answer).toContain("売上要因候補");
    expect(response.answer).toContain("販売数量");
    expect(response.answer).toContain("価格・ミックス");
    expect(response.answer).not.toContain("利益率要因候補");

    const previousAnswer = "全社売上は販売数量の増加と価格実現の改善が主な説明要因です。";
    const misclassifiedResponse = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: previousAnswer,
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "deterministic",
      debug: {
        questionIntent: "yoy_change",
        responsePath: "deterministic",
        fallbackReason: null,
        sourceIdsValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        followupPreviousAnswer: previousAnswer,
        selectedSourceSectionFamilies: ["revenue_discussion", "margin_discussion"],
        selectedSourceExcerpts: [
          "Sales volume increased and favorable price realization contributed to higher revenue.",
          filing.sourceChunks[0]!.text
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(misclassifiedResponse.responsePath).not.toBe("fallback");
    expect(misclassifiedResponse.debug?.fallbackKind).toBe("none");
    expect(misclassifiedResponse.answer).toContain("売上要因");
    expect(misclassifiedResponse.answer).toMatch(/一時要因か継続要因か|継続性/u);
    expect(misclassifiedResponse.answer).not.toBe(previousAnswer);
    expect(misclassifiedResponse.answer).not.toContain("利益率要因候補");

    const insufficientPreviousAnswer = "売上高は増加しましたが、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明は確認できません。";
    const selectedEvidenceRecovery = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "利益率要因候補として、製造コストと人件費を確認する必要があります。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "deterministic",
      debug: {
        questionIntent: "yoy_change",
        responsePath: "deterministic",
        fallbackReason: null,
        sourceIdsValid: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        followupPreviousAnswer: insufficientPreviousAnswer,
        selectedSourceSectionFamilies: ["revenue_discussion", "margin_discussion"],
        selectedSourceExcerpts: [
          "Revenue increased, driven by higher pricing and unit volume, partially offset by foreign exchange.",
          filing.sourceChunks[0]!.text
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(selectedEvidenceRecovery.responsePath).not.toBe("fallback");
    expect(selectedEvidenceRecovery.debug?.fallbackKind).toBe("none");
    expect(selectedEvidenceRecovery.answer).toMatch(/売上要因|価格|販売数量/u);
    expect(selectedEvidenceRecovery.answer).toMatch(/一時要因か継続要因か|継続性/u);
    expect(selectedEvidenceRecovery.answer).not.toContain("利益率要因候補");
  });

  it("accepts source-gate-passed hard follow-up answers inferred from the question text", async () => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも継続しそう？",
      response: {
        answer: "前問の売上要因は、販売数量、価格実現、エンドユーザー向け機械販売、ディーラー在庫 に関する説明が中心です。提出資料には次期の販売数量や価格実現への見通しも示されていますが、これだけで継続性は断定しません。次に見るべき指標は、販売数量、価格実現、エンドユーザー向け機械販売、ディーラー在庫です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        evidenceFallbackUsed: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceExcerpts: [
          "Sales volume, price realization, end user demand and dealer inventory were discussed."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
  });

  it("does not accept source-gate-passed hard follow-up answers with no substantive driver", async () => {
    const filing = makeFiling({ ticker: "KO", companyName: "The Coca-Cola Company" });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "営業利益は 43.6億ドル で、前年同期比 19.1%増 です。利益率の方向は確認できますが、改善/悪化の具体的な要因は十分に特定できません。判断には、コスト、構成、価格改定、営業費用、引当、構造改革費用、減損、セグメント利益率 の説明が必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        evidenceFallbackUsed: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceExcerpts: [
          "The selected excerpt is a general filing introduction and does not discuss operating performance."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackKind).toBe("evidence_slot");
  });

  it("repairs source-gate-passed Q06 under-answers from margin driver evidence slots", async () => {
    const filing = makeFiling({ ticker: "KO", companyName: "The Coca-Cola Company" });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "営業利益は 43.6億ドル で、前年同期比 19.1%増 です。利益率の方向は確認できますが、改善/悪化の具体的な要因は十分に特定できません。判断には、コスト、構成、価格改定、営業費用、引当、構造改革費用、減損、セグメント利益率 の説明が必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        evidenceFallbackUsed: true,
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceGateEvidenceSlots: {
          confirmedMetricMovement: {
            metricName: "純利益",
            currentValue: "39.2億ドル",
            comparisonValue: "33.3億ドル",
            changePct: "17.8%",
            comparisonBasis: "前年同期比",
            sourceIds: ["S9"]
          },
          companyExplainedDrivers: [],
          segmentOrBusinessSignals: [
            {
              fact: "Operating income increased primarily driven by concentrate sales volume, favorable price/mix and lower operating expenses, partially offset by marketing spending and commodity costs.",
              sourceIds: ["S5"],
              confidence: "medium"
            }
          ],
          marginDriverCount: 3,
          unknowns: [],
          sourceLimitations: [],
          failureLabels: []
        },
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceExcerpts: [
          "Operating income increased primarily driven by concentrate sales volume, favorable price/mix and lower operating expenses, partially offset by marketing spending and commodity costs."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.fallbackKind).toBe("none");
    expect(response.debug?.sourceRepairLabels).toContain("q06_source_backed_followup_repair");
    expect(response.answer).toContain("利益率要因候補");
    expect(response.answer).toContain("営業費用");
    expect(response.answer).toContain("価格・単価");
  });

  it("repairs generic margin durability follow-ups when selected context is margin evidence", async () => {
    const filing = makeFiling({ ticker: "AAPL", companyName: "Apple Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "これは一時要因？それとも構造的な変化？",
      response: {
        answer: "一時的とは断定しにくいです。本文では、higher net sales of Pro models が売上変化の要因として説明されています。価格、数量、需要、コスト、mixのような営業要因は次回も確認する論点です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "risk_factors",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        lowQualityReason: "profit_cause_revenue_only",
        sourceIdsValid: true,
        contentMode: "full",
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        selectedSourceSectionFamilies: ["margin_discussion", "cost_discussion"],
        selectedSourceLabels: ["10-Q Margin and profitability discussion"],
        selectedSourceExcerpts: [
          "Gross margin changed due to product mix, cost of sales, foreign exchange and tariff exposure."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("fallback");
    expect(response.debug?.fallbackReason).toBeTruthy();
    expect(response.debug?.languageGuardOk).toBe(true);
    expect(response.debug?.sourceRepairLabels).toContain("language_guard_source_backed_repair");
    expect(response.debug?.sourceGateSufficient).not.toBe(true);
    expect(response.answer).toContain("利益率要因候補");
    expect(response.answer).toContain("製品・顧客ミックス");
    expect(response.answer).not.toMatch(/higher net sales|mix|foreign exchange|tariff/i);
  });

  it("repairs MU-style average-selling-price and bit-shipment durability follow-ups", async () => {
    const filing = makeFiling({ ticker: "MU", companyName: "Micron Technology, Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "前問の要因は、3 % Other operating income expense net 15 — % 26 — % 56 1 %です。継続性の判断には追加確認が必要です。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "fallback",
      debug: {
        questionIntent: "yoy_change",
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
              category: "semiconductor_equipment_driver_durability_followup",
              driver: "Revenue increased primarily due to increases in average selling prices and bit shipments, with favorable mix and manufacturing cost reductions.",
              sourceIds: ["S1"],
              confidence: "medium"
            }
          ],
          segmentOrBusinessSignals: []
        },
        selectedSourceExcerpts: [
          "AEBU revenue increased 71%, primarily due to increases in average selling prices and bit shipments. Gross margins improved due to favorable mix and manufacturing cost reductions."
        ],
        modelProvider: "openai",
        modelName: "gpt-5-nano"
      },
      env: {} as Env,
      config: { ...DEFAULT_REMOTE_CONFIG, webSupplementEnabled: false },
      timings: createChatTimingTracker(),
      includeWebSupplement: false
    });

    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackReason).toBeNull();
    expect(response.debug?.languageGuardOk).toBe(true);
    expect(response.debug?.sourceRepairLabels).toContain("language_guard_source_backed_repair");
    expect(response.answer).toContain("平均販売価格");
    expect(response.answer).toContain("出荷量");
    expect(response.answer).not.toMatch(/Other operating|average selling prices|bit shipments/i);
  });

  it("normalizes raw USD and comma-decimal currency strings", () => {
    const normalized = sanitizeFinalUserFacingAnswer(
      "売上高 601,0億ドル、参考値は379,600,000 USDです。前年同468,? は比較値として不明です。"
    );
    expect(normalized).toContain("601.0億ドル");
    expect(normalized).toContain("3.8億ドル");
    expect(normalized).toContain("前年同期の比較値");
    expect(normalized).not.toContain("601,0億ドル");
    expect(normalized).not.toContain("379,600,000 USD");
    expect(normalized).not.toContain("前年同468,?");
  });

  it.each([
    ["現金は第一 quarter に増加しました。資金繰りは負債注記と合わせて確認が必要です。", "現金は第1四半期に増加しました。"],
    ["現金はfirst quarter of 2025に増加しました。資金繰りは負債注記と合わせて確認が必要です。", "現金は2025年第1四半期に増加しました。"],
    ["現金はfiscal 2025 second quarterに増加しました。資金繰りは負債注記と合わせて確認が必要です。", "現金は2025年第2四半期に増加しました。"],
    ["現金はthird quarterからfourth quarterにかけて増加しました。資金繰りは負債注記と合わせて確認が必要です。", "現金は第3四半期から第4四半期にかけて増加しました。"]
  ])("normalizes mixed or English quarter wording in user-visible answers", async (rawAnswer, expected) => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "資金繰りや負債に懸念はある？",
      response: {
        answer: rawAnswer,
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

    expect(response.responsePath).toBe("openai");
    expect(response.answer).toContain(expected);
    expect(response.answer).not.toMatch(/\b(?:first|second|third|fourth|quarter|quarters)\b/i);
  });

  it.each([
    [
      "総Liabilitiesと長期 debt、Deposits、短期 borrowingsをliquidity managementとmaturity profileで確認します。",
      "総負債と長期債務、預金、短期借入を流動性管理と満期構成で確認します。"
    ],
    [
      "平均 selling priceとdurability、backlog、foreseeable futureを確認します。",
      "平均販売価格と継続性、受注残、予見可能な将来を確認します。"
    ],
    [
      "Productivity and Business Processesとsenior unsecured notes outstandingを確認します。",
      "生産性・ビジネスプロセスと発行済み無担保シニア債を確認します。"
    ],
    [
      "Services and other revenueとcost of services and other revenue、Stock-based compensationを確認します。",
      "サービス・その他売上とサービス・その他売上原価、株式報酬を確認します。"
    ],
    [
      "実 realized prices、refinery sales、debt repaymentsを確認します。",
      "実現価格、製油所売上、債務返済を確認します。"
    ],
    [
      "distribution fees、SG&A/R&D discussion、unit case volumeを確認します。",
      "流通費用、販管費・研究開発費の説明、ユニットケース販売数量を確認します。"
    ]
  ])("normalizes ordinary financial English without changing product names", (rawAnswer, expected) => {
    expect(sanitizeFinalUserFacingAnswer(rawAnswer)).toContain(expected);
  });

  it("preserves exact proper names containing Services", () => {
    const rawAnswer = "主な事業はUniform Rental and Facility ServicesとFirst Aid and Safety Servicesです。";

    expect(sanitizeFinalUserFacingAnswer(rawAnswer)).toBe(rawAnswer);
  });

  it.each([
    ["売上高は$81.62Bです。", "売上高は816.2億ドルです。"],
    ["現金は$50.3Bです。", "現金は503.0億ドルです。"],
    ["債務返済は約$2.1十億です。", "債務返済は約21.0億ドルです。"],
    ["資本支出は250억 USDです。", "資本支出は250億ドルです。"],
    ["現金は5.3名 billionドルです。", "現金は53.0億ドルです。"],
    ["純利益は4.8億ドル万ドルです。", "純利益は4.8億ドルです。"],
    ["営業CFは47.4億ドル-Qです。", "営業CFは47.4億ドルです。"]
  ])("normalizes malformed and mixed-script financial units", (rawAnswer, expected) => {
    const normalized = sanitizeFinalUserFacingAnswer(rawAnswer);
    expect(normalized).toContain(expected);
    expect(normalized).not.toMatch(/億ドル(?:万ドル|\s*[Bb]|-Q)|[$＄]\s*\d|억|名\s*billion/i);
  });

  it("normalizes mixed CJK USD units without emitting malformed currency labels", async () => {
    const filing = makeFiling({ ticker: "JPM", companyName: "JPMorgan Chase & Co." });
    const response = await finalizeChatResponse({
      filing,
      question: "その要因は一時的？それとも続きそう？",
      response: {
        answer: "売上高 1,824억4700万 USD、総売上高は 7131.63 亿 USD、WMT売上高7131.63亿美元、比較値680.985亿美元、2025年売上高67.589十億 USD、7.9十億ドルの影響、現金等は13.8 млрдドル、純利益は57億ドルです。短期债務の maturities と2026年第1四半期の在庫増加が1兆円超の規模と seasonality に依存します。",
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
    const normalized = sanitizeFinalUserFacingAnswer("売上高 1,824억4700万 USD、総売上高は 7131.63 亿 USD、WMT売上高7131.63亿美元、比較値680.985亿美元、2025年売上高67.589十億 USD、7.9十億ドルの影響、現金等は13.8 млрдドル、純利益は57億ドルです。短期债务の maturities と2026年第1四半期の在庫増加が1兆円超の規模と seasonality に依存します。");
    expect(normalized).toContain("1824.5億ドル");
    expect(normalized).toContain("7131.6億ドル");
    expect(normalized).toContain("681.0億ドル");
    expect(normalized).toContain("675.9億ドル");
    expect(normalized).toContain("79.0億ドル");
    expect(normalized).toContain("138.0億ドル");
    expect(normalized).toContain("短期債務の 満期");
    expect(normalized).toContain("金額規模");
    expect(normalized).toContain("季節性");
    expect(normalized).not.toMatch(/억|млрд|债務|亿|美元|十億 USD|十億ドル|兆円/u);
    expect(response.debug?.numericAlignmentInitialStatus).toBe("blocked");
    expect(response.debug?.numericAlignmentFinalSurfaceStatus).toBe("not_applicable");
  });

  it("normalizes malformed currency lexically but blocks unsupported final amounts", async () => {
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

    expect(sanitizeFinalUserFacingAnswer("1.0億 USD")).toBe("1.0億ドル");
    expect(response.answer).not.toContain("1.0億ドル");
    expect(response.debug?.numericAlignmentStatus).toBe("blocked");
    expect(response.debug?.fallbackUserReason).toBe("numeric_alignment_failed");
    expect(response.debug?.guardLabels).not.toContain("malformed_currency_detected");
  });

  it("cleans CAT Q06 finance terms and suspicious million-dollar net income units", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." }), [
      { logicalName: "revenue", tagUsed: "Revenues", value: 67_589_000_000, comparisonValue: 64_809_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual",
        comparisonPeriodStart: "2024-01-01", comparisonPeriodEnd: "2024-12-31", comparisonPeriodKind: "annual" },
      { logicalName: "operatingIncome", tagUsed: "OperatingIncomeLoss", value: 11_151_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual" },
      { logicalName: "netIncome", tagUsed: "NetIncomeLoss", value: 8_882_000_000, comparisonValue: 10_790_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual",
        comparisonPeriodStart: "2024-01-01", comparisonPeriodEnd: "2024-12-31", comparisonPeriodKind: "annual" }
    ]);
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
    expect(response.answer).toContain("一時的か構造的かは、この提出資料だけでは断定できません");
    expect(response.answer).toContain("価格実現");
    expect(response.answer).toContain("製造コスト");
    expect(response.answer).toContain("コスト");
    expect(response.answer).toContain("関税");
    expect(response.answer).toContain("新興国");
    expect(response.answer).toContain("建設機械");
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
    expect(response.responsePath).toBe("openai");
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
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
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
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
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
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
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
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
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
    expect(response.answer).not.toBe("売上高は1,437.6億ドルで、前年同期比15.7%増です。");
  });

  it("keeps normal revenue snapshot metrics", async () => {
    const filing = withTypedMetrics(makeFiling(), [{
      logicalName: "revenue", tagUsed: "Revenue", value: 143_756_000_000, comparisonValue: 124_300_000_000,
      unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual",
      comparisonPeriodStart: "2024-01-01", comparisonPeriodEnd: "2024-12-31", comparisonPeriodKind: "annual"
    }]);
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

  it("normalizes English revenue labels without corrupting Resource Industries", async () => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "セグメント別の売上は？",
      response: {
        answer: "主な売上区分は Construction Industries と Resource Industries です。Geography revenue と segment revenue も確認できます。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "revenue_breakdown",
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
    expect(response.answer).toContain("建設機械");
    expect(response.answer).toContain("資源産業");
    expect(response.answer).toContain("地域別売上");
    expect(response.answer).toContain("セグメント別売上");
    expect(response.answer).not.toContain("Re資料");
    expect(response.answer).not.toContain("Geography revenue");
    expect(response.answer).not.toContain("segment revenue");
  });

  it("normalizes baseline CAT mixed source and revenue wording", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." }), [{
      logicalName: "revenue", tagUsed: "Revenues", value: 67_589_000_000,
      unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual"
    }]);
    const response = await finalizeChatResponse({
      filing,
      question: "どのセグメントや地域が伸びた？弱かった部分は？",
      response: {
        answer: "主な売上区分は Construction Industries と Re資料 Industries の2つです。今期の売上は 67.589 billion USD で、内訳として分かる範囲は全体 Revenue の増加率とセグメントの説明のみです。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "segment_driver",
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

    expect(response.answer).toContain("建設機械");
    expect(response.answer).toContain("資源産業");
    expect(response.answer).toContain("675.9億ドル");
    expect(response.answer).toContain("全体売上");
    expect(response.answer).not.toContain("Re資料");
    expect(response.answer).not.toContain("billion USD");
    expect(response.answer).not.toContain("Revenue");
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("normalizes common hybrid English/Japanese driver wording in final answers", async () => {
    const filing = makeFiling({ ticker: "JPM", companyName: "JPMorgan Chase & Co." });
    const response = await finalizeChatResponse({
      filing,
      question: "利益率に影響した費用項目は？",
      response: {
        answer: "本文では、higher brokerage expenseとdistribution fees、higher auto lease depreciationとcontinued investments in technologyとmarketing、as well as higher 稼働率 expense が利益率に影響した項目として説明されています。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "margin_driver",
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

    expect(response.answer).toContain("ブローカー費用の増加");
    expect(response.answer).toContain("流通費用");
    expect(response.answer).toContain("オートリース減価償却の増加");
    expect(response.answer).toContain("継続的な技術投資");
    expect(response.answer).toContain("稼働関連費用の増加");
    expect(response.answer).not.toMatch(/higher|distribution fees|continued investments in technology|expense/i);
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
  });

  it("normalizes source-label discussion phrases that leak into margin durability fallbacks", async () => {
    const filing = makeFiling({ ticker: "CAT", companyName: "Caterpillar Inc." });
    const response = await finalizeChatResponse({
      filing,
      question: "この説明を整えて",
      response: {
        answer: "判断には、sales volume、price-コスト spread discussion、製造コスト discussion、SG&A/R&D discussion、セグメント実績、価格実現 の説明が必要です。",
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

    expect(response.answer).toContain("販売数量");
    expect(response.answer).toContain("価格とコスト差の説明");
    expect(response.answer).toContain("製造コストの説明");
    expect(response.answer).toContain("販管費・研究開発費の説明");
    expect(response.answer).not.toMatch(/sales volume|price-コスト|discussion|SG&A\/R&D/i);
    expect(checkFinalAnswerJapaneseOnly(response.answer).ok).toBe(true);
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
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
  });

  it("does not treat non-bank filings as financial just because source text mentions financial statements", async () => {
    const filing = makeFiling({
      ticker: "CAT",
      companyName: "Caterpillar Inc.",
      sourceText: "Management discusses financial statements, customer financing subsidiaries, loans to dealers, and cash provided by operating activities."
    });
    const response = await finalizeChatResponse({
      filing,
      question: "営業CFはどう見る？",
      response: {
        answer: "営業CFはプラスですが、金融機関ではdeposit base、loan book、net interest incomeも合わせて見る必要があります。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "cash_flow",
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

    expect(response.answer).toContain("営業CFは、運転資本");
    expect(response.answer).not.toMatch(/金融機関|deposit base|loan book|net interest income/i);
    expect(response.debug?.fallbackCategory).toBe("none");
    expect(response.debug?.fallbackUserReason).toBe("none");
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

    // What this test guards is that the malformed amount never reaches the user.
    // It used to be replaced by 「売上構造を見る軸は、…」 out of
    // TICKER_REVENUE_BREAKDOWNS — a constant AAPL breakdown with this filing's
    // chunks attached as sources. With no constant to fall back on, the answer
    // is the honest insufficiency statement instead.
    expect(response.answer).not.toContain("143,7.6億ドル");
    expect(response.answer).not.toContain("143.7.6億ドル");
    expect(response.answer).toContain("未確認の数値は表示しません");
    expect(response.answer).not.toContain("売上構造を見る軸");
    // Was "deterministic": the deterministic layer had a constant AAPL breakdown
    // to serve in place of the blocked answer. It has nothing to serve now, so
    // the guarded insufficiency answer is the fallback path's.
    expect(response.responsePath).toBe("fallback");
    // Was "none", because the constant breakdown stood in for the blocked answer
    // and the response came out looking clean. The guard did fire, and the debug
    // metadata now says so.
    expect(response.debug?.fallbackCategory).toBe("answer_quality_guard");
    expect(response.debug?.fallbackUserReason).toBe("numeric_alignment_failed");
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

  it("normalizes Coca-Cola margin wording that mixes short English labels", async () => {
    const filing = makeFiling({ ticker: "KO", companyName: "The Coca-Cola Company" });
    const response = await finalizeChatResponse({
      filing,
      question: "利益率が改善、または悪化した理由は？",
      response: {
        answer: "改善/悪化の要因としては、地域別の販売量増加（ concentrate 販売数量 の増加）、価格/構成の有利、外国為替の影響が寄与しています。North America では販売量増、Bottling Investments は unit case volume 増加と re franchising の影響もありました。",
        sources: [sourceToEvidence(filing.sourceChunks[0])]
      },
      responsePath: "openai",
      debug: {
        questionIntent: "margin_driver",
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

    expect(response.answer).toContain("原液販売数量");
    expect(response.answer).toContain("北米");
    expect(response.answer).toContain("ボトリング投資");
    expect(response.answer).toContain("ユニットケース販売数量");
    expect(response.answer).toContain("再フランチャイズ化");
    expect(response.answer).not.toMatch(/concentrate|North America|Bottling Investments|unit case volume|re franchising/i);
  });

  it("rewrites unsupported operating-margin growth wording conservatively", async () => {
    const filing = withTypedMetrics(makeFiling({ ticker: "WMT", companyName: "Walmart Inc." }), [
      { logicalName: "revenue", tagUsed: "Revenue", value: 100_000_000_000, comparisonValue: 95_000_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual",
        comparisonPeriodStart: "2024-01-01", comparisonPeriodEnd: "2024-12-31", comparisonPeriodKind: "annual" },
      { logicalName: "operatingIncome", tagUsed: "OperatingIncomeLoss", value: 10_160_000_000, comparisonValue: 10_000_000_000,
        unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", periodKind: "annual",
        comparisonPeriodStart: "2024-01-01", comparisonPeriodEnd: "2024-12-31", comparisonPeriodKind: "annual" }
    ]);
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

    expect(response.responsePath).toBe("deterministic");
    expect(response.answer).toContain("営業利益率");
    expect(response.answer).not.toContain("営業利益率は前年同期比で約1.6%増");
    expect(response.answer).not.toContain("eコマース改善が主因");
    expect(response.debug?.sourceRepairLabels).toContain("margin_driver_deterministic_recovery");
    expect(response.debug?.fallbackCategory).toBe("none");
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

function makeFiling(overrides: Partial<Pick<FilingCacheRecord, "ticker" | "companyName">> & { sourceText?: string } = {}): FilingCacheRecord {
  const chunk: SourceChunkRecord = {
    sourceId: "S1",
    sectionType: "md_a",
    sectionTitle: "Item 7",
    sourceLabel: "10-K Item 7",
    text: overrides.sourceText ?? "Liquidity discussion mentions cash and debt.",
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

function withTypedMetrics(filing: FilingCacheRecord, metrics: MetricSnapshot[]): FilingCacheRecord {
  const labelByMetric: Record<MetricSnapshot["logicalName"], string> = {
    revenue: "売上高",
    netIncome: "純利益",
    epsBasic: "1株利益",
    operatingIncome: "営業利益",
    operatingCashFlow: "営業CF",
    cashAndCashEquivalents: "現金及び現金同等物",
    currentDebt: "1年内返済予定の長期債務",
    longTermDebt: "長期債務（非流動）"
  };
  const metricSources: SourceChunkRecord[] = metrics.map((metric, index) => ({
    sourceId: `MX${index + 1}`,
    sectionType: "xbrl_metric",
    sectionTitle: labelByMetric[metric.logicalName],
    sourceLabel: `XBRL ${labelByMetric[metric.logicalName]}`,
    text: `${labelByMetric[metric.logicalName]}: ${metric.value} ${metric.unit}${metric.comparisonValue === undefined ? "" : ` / 比較値: ${metric.comparisonValue}`}`,
    startOffset: 0,
    endOffset: 0,
    tagName: metric.tagUsed,
    sortOrder: 100 + index
  }));
  return { ...filing, metrics, sourceChunks: [...filing.sourceChunks, ...metricSources] };
}
