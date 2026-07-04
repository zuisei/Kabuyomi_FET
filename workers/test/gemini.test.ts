import { afterEach, describe, expect, it, vi } from "vitest";
import { generateChatAnswer, generateQuoteTranslation, generateSummary } from "../src/clients/gemini";
import {
  classifyGeminiError,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_TRANSLATION_MODEL,
  GeminiApiRequestError,
  resolveGeminiModel,
  resolveGeminiTranslationModel
} from "../src/clients/gemini/request";
import { buildDeterministicMetricAnswer } from "../src/lib/chat/deterministic";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveGeminiModel", () => {
  it("falls back to the repo default when GEMINI_MODEL is unset", () => {
    expect(resolveGeminiModel({} as never)).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("normalizes Google model resource prefixes", () => {
    expect(resolveGeminiModel({ GEMINI_MODEL: "models/gemini-2.5-flash" } as never)).toBe("gemini-2.5-flash");
  });
});

describe("resolveGeminiTranslationModel", () => {
  it("falls back to the repo default when GEMINI_TRANSLATION_MODEL is unset", () => {
    expect(resolveGeminiTranslationModel({} as never)).toBe(DEFAULT_GEMINI_TRANSLATION_MODEL);
  });
});

describe("Gemini API error classification", () => {
  it("classifies rate limit errors", () => {
    const diagnostics = classifyGeminiError(new GeminiApiRequestError("rate limit", {
      geminiApiErrorKind: "rate_limit",
      geminiApiErrorStatus: 429,
      geminiApiErrorCode: "RESOURCE_EXHAUSTED",
      geminiApiErrorMessageSample: "quota exceeded",
      geminiApiErrorRetryable: true,
      geminiErrorOccurredBeforeResponse: false
    }));

    expect(diagnostics.geminiApiErrorKind).toBe("rate_limit");
    expect(diagnostics.geminiApiErrorStatus).toBe(429);
    expect(diagnostics.geminiApiErrorRetryable).toBe(true);
  });

  it("classifies auth and provider errors", () => {
    const auth = classifyGeminiError(new GeminiApiRequestError("auth", {
      geminiApiErrorKind: "auth_error",
      geminiApiErrorStatus: 403,
      geminiApiErrorCode: "PERMISSION_DENIED",
      geminiApiErrorMessageSample: "invalid api key",
      geminiApiErrorRetryable: false,
      geminiErrorOccurredBeforeResponse: false
    }));
    const server = classifyGeminiError(new GeminiApiRequestError("server", {
      geminiApiErrorKind: "provider_server_error",
      geminiApiErrorStatus: 503,
      geminiApiErrorCode: "UNAVAILABLE",
      geminiApiErrorMessageSample: "unavailable",
      geminiApiErrorRetryable: true,
      geminiErrorOccurredBeforeResponse: false
    }));

    expect(auth.geminiApiErrorKind).toBe("auth_error");
    expect(server.geminiApiErrorKind).toBe("provider_server_error");
  });

  it("classifies unknown error shapes without leaking long messages", () => {
    const diagnostics = classifyGeminiError(new Error("x".repeat(500)));

    expect(diagnostics.geminiApiErrorKind).toBe("unknown");
    expect(diagnostics.geminiApiErrorMessageSample?.length).toBeLessThanOrEqual(180);
  });
});

describe("Gemini quote translation fallback", () => {
  it("falls back to the general model when the dedicated translation model is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: "translation model busy",
              status: "UNAVAILABLE"
            }
          }),
          { status: 503, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: "translation model busy",
              status: "UNAVAILABLE"
            }
          }),
          { status: 503, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "{\"translatedText\":\"売上高は前年同期比で増加しました。\"}" }]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateQuoteTranslation(
      {
        GEMINI_API_KEY: "test-key",
        GEMINI_MODEL: "gemma-4-31b-it"
      } as never,
      {
        text: "Revenue increased year over year.",
        targetLanguage: "ja"
      }
    );

    expect(response).toEqual({
      translatedText: "売上高は前年同期比で増加しました。",
      modelName: "gemma-4-26b-a4b-it"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent"
    );
  });
});

describe("Gemini summary fallback", () => {
  it("falls back after a single timed out summary request", async () => {
    const fetchMock = vi.fn().mockImplementation((_, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateSummary(
      {
        GEMINI_API_KEY: "test-key",
        GEMINI_TIMEOUT_MS: "1"
      } as never,
      {
        filingKey: "v3:0000000000:000000000000000999",
        ticker: "TEST",
        companyName: "Test Corp",
        formType: "10-K",
        filedAt: "2026-02-10",
        periodOfReport: "2025-12-31",
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "Revenues",
            value: 100,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 80,
            yoyPercent: 25
          }
        ],
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text: "Revenue improved because enterprise demand remained strong.",
            startOffset: 0,
            endOffset: 57,
            sortOrder: 1
          },
          {
            sourceId: "S2",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (Revenues)",
            text: "売上高: 100 USD / 比較値: 80 / YoY: 25.0%",
            startOffset: 0,
            endOffset: 0,
            tagName: "Revenues",
            sortOrder: 2
          }
        ]
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.provider).toBe("fallback");
    expect(response.summary.verdict).toContain("Test Corp");
  });
});

describe("Gemini local chat fallback", () => {
  it("translates pricing drivers instead of leaking partial English fragments", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "前回決算との違いは？",
      filing: {
        filingKey: "v1:0000021665:000002166526000006",
        ticker: "CL",
        companyName: "COLGATE PALMOLIVE CO",
        cik: "0000021665",
        formType: "10-K",
        filedAt: "2026-02-23",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 20101000000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 20094000000,
            yoyPercent: 0.03
          }
        ],
        sourceChunks: [
          {
            sourceId: "S3",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text:
              "Net sales increased primarily due to net selling price increases of 2.0%, partially offset by volume declines of 0.4% and negative foreign exchange of 0.3%.",
            startOffset: 0,
            endOffset: 112,
            sortOrder: 3
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 20101000000 USD / 比較値: 20094000000 / YoY: 0.03%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ],
        summary: { verdict: "", highlights: [], changes: [] },
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1"
      }
    });

    expect(response.answer).toContain("販売価格の引き上げ（2.0%）");
    expect(response.answer).toContain("販売数量の減少（0.4%）");
    expect(response.answer).toContain("為替のマイナス影響（0.3%）");
    expect(response.answer).not.toContain("net selling price increases of 2");
    expect(response.sourceIds).toContain("S3");
  });

  it("translates generic reportable-segment driver fragments", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "売上成長の要因は？",
      filing: {
        filingKey: "v1:0000064040:000006404026000024",
        ticker: "SPGI",
        companyName: "S&P Global Inc.",
        cik: "0000064040",
        formType: "10-Q",
        filedAt: "2026-04-28",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 4171000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 3777000000,
            yoyPercent: 10.4
          }
        ],
        sourceChunks: [
          {
            sourceId: "S3",
            sectionType: "md_a",
            sectionTitle: "Item 2",
            sourceLabel: "10-Q Item 2",
            text: "Revenue increased 10% primarily due to increases at all of our reportable segments.",
            startOffset: 0,
            endOffset: 84,
            sortOrder: 3
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 4171000000 USD / 比較値: 3777000000 / YoY: 10.4%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ],
        summary: { verdict: "", highlights: [], changes: [] },
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1"
      }
    });

    expect(response.answer).toContain("全報告セグメントでの増収");
    expect(response.answer).not.toContain("increases at all of our reportable segments");
    expect(response.sourceIds).toContain("S3");
  });

  it("keeps known CRWD business fallback from drifting into generic data-center wording", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "何の会社？",
      filing: {
        filingKey: "v6:0001535527:000153552726000010",
        ticker: "CRWD",
        companyName: "CrowdStrike Holdings, Inc.",
        cik: "0001535527",
        formType: "10-K",
        filedAt: "2026-03-05",
        periodOfReport: "2026-01-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        sourceChunks: [
          {
            sourceId: "S3",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text:
              "CrowdStrike provides the Falcon platform for cybersecurity subscriptions, cloud security, identity protection and threat intelligence. The company applies artificial intelligence to security workflows.",
            startOffset: 0,
            endOffset: 190,
            sortOrder: 3
          }
        ],
        summary: { verdict: "", highlights: [], changes: [] },
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1"
      }
    });

    expect(response.answer).toContain("Falcon platform");
    expect(response.answer).toContain("サイバーセキュリティ");
    expect(response.answer).not.toContain("アクセラレーテッドコンピューティング");
    expect(response.answer).not.toContain("データセンター向けコンピューティング");
  });

  it("explains CRWD subscription revenue drivers instead of giving navigational fallback text", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "売上成長の要因は？",
      filing: makeCrowdstrikeSubscriptionGrowthFiling()
    });

    expect(response.answer).toContain("売上高は");
    expect(response.answer).toContain("新規顧客・新規契約の増加");
    expect(response.answer).toContain("既存顧客への追加導入・利用拡大");
    expect(response.answer).toContain("サブスクリプション型の継続収益");
    expect(response.answer).not.toContain("本文全体と数字を並べると");
    expect(response.answer).not.toContain("伸びの候補として見ます");
    expect(response.sourceIds).toEqual(expect.arrayContaining(["S3", "S9"]));
  });

  it("treats CRWD subscription growth durability as recurring rather than a next-step answer", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "その要因は一時的？",
      filing: makeCrowdstrikeSubscriptionGrowthFiling()
    });

    expect(response.answer).toContain("サブスクリプション型の継続収益");
    expect(response.answer).toContain("一回限りだけの要因とは見にくい");
    expect(response.answer).toContain("顧客維持・追加導入・サブスクリプション拡大が続くか");
    expect(response.answer).not.toContain("次に見るなら");
    expect(response.sourceIds).toEqual(expect.arrayContaining(["S3", "S9"]));
  });

  it("does not present profit metrics as revenue-growth drivers when revenue context is missing", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "売上成長の要因は？",
      filing: makeCrowdstrikeMissingRevenueDriverFiling()
    });

    expect(response.answer).toContain("売上成長の要因は");
    expect(response.answer).toContain("売上高指標や要因説明が不足");
    expect(response.answer).toContain("純利益や営業利益の数字");
    expect(response.answer).not.toContain("本文全体と数字を並べると");
    expect(response.answer).not.toContain("伸びの候補として見ます");
    expect(response.sourceIds).toEqual(["S9"]);
  });

  it("does not label generic platform language as Falcon for non-CRWD revenue drivers", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "売上成長の要因は？",
      filing: makeIntuitPlatformGrowthFiling()
    });

    expect(response.answer).toContain("プラットフォーム利用の拡大");
    expect(response.answer).not.toContain("Falcon");
    expect(response.sourceIds).toEqual(expect.arrayContaining(["S2", "S9"]));
  });

  it("uses known CEG business context instead of mapping AI acronym glossary text to Nvidia-like business", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "何の会社？",
      filing: makeConstellationAcronymGlossaryFiling()
    });

    expect(response.answer).toContain("発電・電力販売");
    expect(response.answer).toContain("エネルギー会社");
    expect(response.answer).not.toContain("アクセラレーテッドコンピューティング");
  });

  it("uses CEG risk-factor context instead of returning no-source fallback", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "リスクは？",
      filing: makeConstellationRiskContextFiling()
    });

    expect(response.answer).toContain("リスク");
    expect(response.answer).toMatch(/発電|電力|規制|市場価格/);
    expect(response.answer).not.toBe("この決算資料の範囲では確認できません。");
    expect(response.sourceIds).toEqual(["CTX1"]);
  });

  it("does not map non-utility energy wording to power-company risk fallback", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "リスクは？",
      filing: makeSecurityRiskWithEnergyWordingFiling()
    });

    expect(response.answer).toContain("リスク");
    expect(response.answer).not.toContain("発電・電力事業");
    expect(response.answer).not.toContain("市場価格や需要変動");
    expect(response.sourceIds).toEqual(["CTX1"]);
  });

  it("does not cite heading-only MD&A text for durability follow-ups", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "その要因は一時的？",
      filing: makeConstellationHeadingOnlyDurabilityFiling()
    });

    expect(response.answer).toContain("本文に売上変化の要因説明がない");
    expect(response.answer).toContain("売上高は 255.3億ドル");
    expect(response.answer).not.toContain("この要因に近い説明があります");
    expect(response.sourceIds).toEqual(["S9"]);
  });

  it("summarizes RevPAR durability context instead of generic nearby-explanation text", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "その要因は一時的？",
      filing: makeMarriottRevparDurabilityFiling()
    });

    expect(response.answer).toContain("RevPAR");
    expect(response.answer).toContain("稼働率");
    expect(response.answer).toContain("旅行需要");
    expect(response.answer).not.toContain("この要因に近い説明があります");
    expect(response.sourceIds).toEqual(expect.arrayContaining(["S7", "S9"]));
  });

  it("translates Synopsys acquisition and product-group growth drivers in durability fallback", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "その要因は一時的？",
      filing: makeSynopsysDurabilityFiling()
    });

    expect(response.answer).toContain("大半の製品グループと地域での増収");
    expect(response.answer).toContain("Ansys買収による約885百万ドルの寄与");
    expect(response.answer).not.toContain("revenue growth across");
    expect(response.answer).not.toContain("geographies");
  });

  it("builds balanced investor-view fallback from metrics instead of a single vague sentence", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "投資家目線で良い点と悪い点は？",
      filing: makeInvestorViewFallbackFiling()
    });

    expect(response.answer).toContain("良い点");
    expect(response.answer).toContain("悪い点・注意点");
    expect(response.answer).toContain("売上はプラス材料");
    expect(response.answer).toContain("営業CFは注意材料");
    expect(response.answer).not.toContain("本文全体と数字を並べると");
    expect(response.sourceIds).toEqual(expect.arrayContaining(["S9", "S12"]));
  });

  it("adds context when deterministic margin answer says deterioration is not present", () => {
    const result = buildDeterministicMetricAnswer(makeAdpMarginImprovementFiling(), "利益率が悪化した理由は？");

    expect(result?.response.answer).toContain("利益率悪化は確認できません");
    expect(result?.response.answer).toContain("悪化要因を探すより改善が続くか");
    expect(result?.response.answer.length).toBeGreaterThan(80);
  });

  it("answers margin cause questions with source-backed margin drivers", () => {
    const result = buildDeterministicMetricAnswer(makeMarginDriverPatternFiling(), "利益率が改善、または悪化した理由は？");

    expect(result?.strategy).toBe("margin_snapshot");
    expect(result?.response.answer).toContain("営業利益率");
    expect(result?.response.answer).toContain("本文で確認できる利益率・利益要因");
    expect(result?.response.answer).toContain("粗利率・粗利益の改善");
    expect(result?.response.answer).toContain("営業費用・原価の増加");
    expect(result?.response.answer).toContain("一時要因か構造的変化か");
    expect(result?.response.sources.map((source) => source.sourceId)).toEqual(expect.arrayContaining(["S9", "S10", "S1"]));
  });

  it("extracts source-backed revenue drivers from common MD&A wording", () => {
    const filing = makeRevenueDriverPatternFiling();
    const result = buildDeterministicMetricAnswer(filing, "売上成長、または減収の主な要因は？");

    expect(result?.strategy).toBe("revenue_drivers");
    expect(result?.response.answer).toContain("売上高は");
    expect(result?.response.answer).toContain("取引件数と販売数量の増加");
    expect(result?.response.answer).toContain("販売数量の増加");
    expect(result?.response.answer).toContain("アドバイザリーとその他サービスの成長");
    expect(result?.response.answer).toContain("純利息収入");
    expect(result?.response.answer).toContain("カード事業のリボ残高増");
    expect(result?.response.answer).toContain("非利息収入");
    expect(result?.response.answer).toContain("投資銀行手数料増");
    expect(result?.response.sources.map((source) => source.sourceId)).toEqual(expect.arrayContaining(["S9", "S1", "S2", "S3", "S4", "S5"]));
  });

  it("answers core business and revenue templates with ticker-specific fallback context", () => {
    const filing = makeKnownTickerRevenueAxisFiling();

    const business = buildDeterministicMetricAnswer(filing, "この会社は何で儲けている？");
    expect(business?.strategy).toBe("business_overview");
    expect(business?.response.answer).toContain("クラウド");
    expect(business?.response.answer).toContain("Microsoft 365");

    const snapshot = buildDeterministicMetricAnswer(filing, "直近決算の売上はどうだった？");
    expect(snapshot?.strategy).toBe("revenue_breakdown");
    expect(snapshot?.response.answer).toContain("売上高は");
    expect(snapshot?.response.answer).toContain("売上構造を見る軸");
    expect(snapshot?.response.answer).toContain("LinkedIn");
    expect(snapshot?.response.answer).not.toContain("売上高の増減は確認できますが");

    const segment = buildDeterministicMetricAnswer(filing, "どのセグメントや地域が伸びた？弱かった部分は？");
    expect(segment?.strategy).toBe("revenue_breakdown");
    expect(segment?.response.answer).toContain("セグメント・製品別に見る軸");
    expect(segment?.response.answer).toContain("ゲーム");
    expect(segment?.response.answer).not.toContain("会社固有の売上の柱までは特定できません");
    expect(segment?.response.sources.map((source) => source.sourceId)).toEqual(expect.arrayContaining(["S9", "S1"]));
  });

  it("skips untranslated revenue-driver fragments in deterministic revenue snapshots", () => {
    const filing = makeUntranslatedRevenueDriverFiling();
    const result = buildDeterministicMetricAnswer(filing, "直近決算の売上はどうだった？");

    expect(result?.strategy).toBe("revenue_breakdown");
    expect(result?.response.answer).toContain("売上高は");
    expect(result?.response.answer).toContain("売上構造を見る軸");
    expect(result?.response.answer).not.toContain("several factors");
    expect(result?.response.answer).not.toContain("payment processing");
    expect(result?.response.answer).not.toContain("fulfillment");
  });

  it("softens revenue-breakdown limitation wording in remote Gemini answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        answer:
                          "ADPの主な売上区分は、給与計算や人事管理などのHCMプラットフォーム、リタイアメントサービス、およびPEOサービスです。具体的にどの区分が最大であるかや、それぞれの詳細な売上額などの内訳は、この資料だけでは確認できません。",
                        sourceIds: ["CTX1"]
                      })
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "売上の柱は？",
      filing: makeAdpRevenueBreakdownFiling()
    });

    expect(response.answer).toContain("上記のサービス群が売上構造を見る軸");
    expect(response.answer).not.toContain("この資料だけでは確認できません");
  });

  it("softens common revenue-breakdown refusal endings across service and marketplace answers", async () => {
    const examples = [
      {
        raw:
          "DoorDashの主な売上区分は地域別で管理されていますが、事業内容としては地域の料理配送物流が現在最大のカテゴリーとなっています。具体的な製品やサービスごとの売上内訳については、この資料だけでは確認できません。",
        expected: "上記の事業内容を売上の柱として見るのが近い"
      },
      {
        raw:
          "CINTAS CORPの主な売上区分は、ユニフォームのレンタルおよび販売、およびそれに付随するビジネスサービスです。売上の具体的な内訳や変化の方向については、この資料だけでは確認できません。",
        expected: "上記の事業区分が売上構造を見る軸"
      },
      {
        raw:
          "Fortinetの主な売上区分は、地域別の売上高に分かれています。特に、FortiGuardなどのセキュリティサブスクリプションとFortiCareのテクニカルサポートサービスからの収益が重要な柱となっています。具体的な製品やサービスごとの売上内訳や、それぞれの成長率などの詳細な数値は、この資料だけでは確認できません。",
        expected: "上記のサービス区分が売上構造を見る軸"
      },
      {
        raw:
          "Airbnbは、宿泊施設や体験、サービスの提供を仲介するグローバルなマーケットプレイスを運営しています。売上の具体的な内訳については、この資料では地域別の売上高などの地理的な区分のみが記載されており、製品やサービスごとの詳細な売上構成は確認できません。",
        expected: "上記の宿泊・体験・サービス領域が売上構造を見る軸"
      }
    ];

    for (const example of examples) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          answer: example.raw,
                          sourceIds: ["CTX1"]
                        })
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );

      const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
        question: "売上の柱は？",
        filing: makeAdpRevenueBreakdownFiling()
      });

      expect(response.answer).toContain(example.expected);
      expect(response.answer).not.toContain("この資料だけでは確認できません");
      expect(response.answer).not.toContain("詳細な売上構成は確認できません");
    }
  });

  it("keeps pricing-driver durability fallback in Japanese", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "売上高が変化した要因は一時的ですか？",
      filing: {
        filingKey: "v1:0000021665:000002166526000006",
        ticker: "CL",
        companyName: "COLGATE PALMOLIVE CO",
        cik: "0000021665",
        formType: "10-K",
        filedAt: "2026-02-23",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 20382000000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 20101000000,
            yoyPercent: 1.4
          }
        ],
        sourceChunks: [
          {
            sourceId: "S3",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text:
              "Net sales increased primarily due to net selling price increases of 2.1%, partially offset by volume declines of 0.4% and negative foreign exchange of 0.3%.",
            startOffset: 0,
            endOffset: 112,
            sortOrder: 3
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 20382000000 USD / 比較値: 20101000000 / YoY: 1.4%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ],
        summary: { verdict: "", highlights: [], changes: [] },
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1"
      }
    });

    expect(response.answer).toContain("一時的");
    expect(response.answer).toContain("販売価格の引き上げ（2.1%）");
    expect(response.answer).toContain("販売数量の減少（0.4%）");
    expect(response.answer).toContain("為替のマイナス影響（0.3%）");
    expect(response.answer).not.toContain("net selling price increases");
    expect(response.sourceIds).toContain("S3");
  });

  it("strips markdown emphasis and inline source citations from model answers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer:
                        "Teslaの売上区分は **車両販売・関連サービス**、**エネルギー生成・蓄電**、**その他** です。[S2, S4]",
                      sourceIds: ["S2", "S4"]
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateChatAnswer(
      {
        GEMINI_API_KEY: "test-key"
      } as never,
      {
        question: "売上のセクターは？",
        filing: {
          filingKey: "v1:0000000000:000000000000000999",
          ticker: "TSLA",
          companyName: "Tesla, Inc.",
          cik: "0001318605",
          formType: "10-K",
          filedAt: "2026-01-29",
          periodOfReport: "2025-12-31",
          primaryDocumentUrl: "https://example.com",
          mdaText: "",
          mdaTokenCount: 0,
          metrics: [],
          generatedAt: "2026-04-14T00:00:00.000Z",
          extractorVersion: "v1",
          promptVersion: "v1",
          summary: { verdict: "", highlights: [], changes: [] },
          sourceChunks: [
            {
              sourceId: "S2",
              sectionType: "md_a",
              sectionTitle: "Item 7",
              sourceLabel: "10-K Item 7",
              text: "Automotive sales remained the largest revenue line.",
              startOffset: 0,
              endOffset: 48,
              sortOrder: 2
            },
            {
              sourceId: "S4",
              sectionType: "md_a",
              sectionTitle: "Item 7",
              sourceLabel: "10-K Item 7",
              text: "Energy generation and storage revenue increased year over year.",
              startOffset: 49,
              endOffset: 110,
              sortOrder: 4
            }
          ]
        }
      }
    );

    expect(response.answer).toBe("Teslaの売上区分は 車両販売・関連サービス、エネルギー生成・蓄電、その他 です。");
    expect(response.sourceIds).toEqual(["S2", "S4"]);
  });

  it("uses deterministic generation settings for remote chat requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "売上高は 1,000ドル です。",
                      sourceIds: ["S1"]
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateChatAnswer(
      {
        GEMINI_API_KEY: "test-key"
      } as never,
      {
        question: "売上高は？",
        filing: {
          filingKey: "v1:0000000000:000000000000001000",
          ticker: "TEST",
          companyName: "Test Corp",
          cik: "0000000000",
          formType: "10-Q",
          filedAt: "2026-04-14",
          periodOfReport: "2026-03-31",
          primaryDocumentUrl: "https://example.com",
          mdaText: "",
          mdaTokenCount: 0,
          metrics: [],
          generatedAt: "2026-04-14T00:00:00.000Z",
          extractorVersion: "v1",
          promptVersion: "v1",
          summary: { verdict: "", highlights: [], changes: [] },
          sourceChunks: [
            {
              sourceId: "S1",
              sectionType: "xbrl_metric",
              sectionTitle: "売上高",
              sourceLabel: "XBRL 売上高 (Revenue)",
              text: "売上高: 1000 USD",
              startOffset: 0,
              endOffset: 0,
              tagName: "Revenue",
              sortOrder: 1
            }
          ]
        }
      }
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig).toMatchObject({
      temperature: 0,
      topP: 0.1,
      topK: 1,
      candidateCount: 1,
      responseMimeType: "application/json"
    });
    expect(body.generationConfig.responseJsonSchema).toBeTruthy();
  });

  it("recovers company-overview model answers that lead with revenue instead of business", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer:
                        "売上高は 50.8 億ドルで、前年同期比 6.6%増です。提出資料の一般的な注意書きや案内文が中心で、材料としては弱めです。",
                      sourceIds: ["S9"]
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateChatAnswer(
      {
        GEMINI_API_KEY: "test-key"
      } as never,
      {
        question: "この企業はなんの企業？",
        filing: {
          filingKey: "v1:0001576280:000157628026000001",
          ticker: "GH",
          companyName: "Guardant Health, Inc.",
          cik: "0001576280",
          formType: "10-K",
          filedAt: "2026-02-20",
          periodOfReport: "2025-12-31",
          primaryDocumentUrl: "https://example.com",
          mdaText: "",
          mdaTokenCount: 0,
          metrics: [],
          generatedAt: "2026-04-24T00:00:00.000Z",
          extractorVersion: "v1",
          promptVersion: "v1",
          summary: { verdict: "", highlights: [], changes: [] },
          sourceChunks: [
            {
              sourceId: "S2",
              sectionType: "md_a",
              sectionTitle: "Item 7",
              sourceLabel: "10-K Item 7",
              text: "Guardant Health is a leading precision oncology company focused on helping conquer cancer globally through proprietary blood-based tests, vast data sets and advanced analytics. The company serves patients, healthcare providers and biopharmaceutical companies.",
              startOffset: 0,
              endOffset: 260,
              sortOrder: 2
            },
            {
              sourceId: "S9",
              sectionType: "xbrl_metric",
              sectionTitle: "売上高",
              sourceLabel: "XBRL 売上高 (Revenues)",
              text: "売上高: 508000000 USD / 比較値: 476500000 / YoY: 6.6%",
              startOffset: 0,
              endOffset: 0,
              tagName: "Revenues",
              sortOrder: 9
            }
          ]
        }
      }
    );

    expect(response.answer).toContain("Guardant Health, Inc.は");
    expect(response.answer).toContain("がん領域の精密医療");
    expect(response.answer).toContain("血液検査・分子診断");
    expect(response.answer).not.toContain("売上高は 50.8");
    expect(response.sourceIds).toEqual(["S2"]);
    expect(response.usedRemoteModel).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses substantive business context even when the excerpt contains table-of-contents noise", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "NVDA 何の会社？",
      filing: {
        filingKey: "v6:0001045810:000104581026000021",
        ticker: "NVDA",
        companyName: "NVIDIA CORP",
        cik: "0001045810",
        formType: "10-K",
        filedAt: "2026-02-25",
        periodOfReport: "2026-01-25",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        generatedAt: "2026-04-25T00:00:00.000Z",
        extractorVersion: "v6",
        promptVersion: "v2",
        summary: { verdict: "", highlights: [], changes: [] },
        sourceChunks: [
          {
            sourceId: "CTX1",
            sectionType: "md_a",
            sectionTitle: "Business overview context",
            sourceLabel: "10-K Business overview context",
            text:
              "39 Table of Contents The following table sets forth certain items expressed as a percentage of revenue. Compute & Networking revenue increased due to the major platform shifts to accelerated computing and AI. Revenue from Data Center computing grew because of demand for the Blackwell computing platform. Revenue from Data Center networking grew with Ethernet, InfiniBand and NVLink compute fabric. Graphics revenue was driven by Blackwell architecture. Customers include cloud service providers, enterprises, AI model makers and system integrators.",
            startOffset: 0,
            endOffset: 560,
            sortOrder: 1
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["CTX1"]);
    expect(response.answer).toContain("NVIDIA CORPは");
    expect(response.answer).toContain("AI向けアクセラレーテッドコンピューティング");
    expect(response.answer).toContain("データセンター向けコンピューティング");
  });

  it("accepts NVDA-style business overview answers that cite context-pack sources", async () => {
    const answer = "NVIDIAは、AI向けGPU、データセンター向けコンピューティング、ネットワーキング製品を提供する会社です。";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ answer, sourceIds: ["CTX1"] }) }]
              }
            }
          ]
        })
      })
    );

    const contextSource = {
      sourceId: "CTX1",
      sectionType: "md_a" as const,
      sectionTitle: "Business overview context",
      sourceLabel: "10-K Business overview context",
      text:
        "Compute & Networking revenue increased due to accelerated computing and AI. Revenue from Data Center computing grew because of demand for Blackwell. Customers include cloud service providers and enterprises.",
      startOffset: 0,
      endOffset: 190,
      sortOrder: 1
    };
    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "NVDA 何の会社？",
      questionIntent: "business_overview",
      contextPack: {
        questionIntent: "business_overview",
        contentMode: "full",
        metrics: [],
        sourceChunks: [contextSource],
        contextTokenBudget: 7000,
        selectedSourceCount: 1,
        sourceSelectionStrategy: "business_overview:standard:intent_ranked",
        selectionDiagnostics: {
          candidateSourceCount: 1,
          selectedSourceCount: 1,
          selectedSourceCharCount: contextSource.text.length,
          avgSelectedSourceChars: contextSource.text.length,
          contextTokenBudget: 7000,
          estimatedContextTokens: 80,
          sourceSelectionStrategy: "business_overview:standard:intent_ranked",
          rejectedShortCount: 0,
          rejectedTableFragmentCount: 0,
          rejectedLowTextQualityCount: 0,
          sectionHitCountBusiness: 1,
          sectionHitCountRisk: 0,
          sectionHitCountMda: 0
        }
      },
      filing: {
        filingKey: "v6:0001045810:000104581026000021",
        ticker: "NVDA",
        companyName: "NVIDIA CORP",
        cik: "0001045810",
        formType: "10-K",
        filedAt: "2026-02-25",
        periodOfReport: "2026-01-25",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        generatedAt: "2026-04-25T00:00:00.000Z",
        extractorVersion: "v6",
        promptVersion: "v2",
        summary: { verdict: "", highlights: [], changes: [] },
        sourceChunks: []
      }
    });

    expect(response.answer).toBe(answer);
    expect(response.sourceIds).toEqual(["CTX1"]);
    expect(response.fallbackReason).toBeUndefined();
  });

  it("matches Japanese questions against source text without whitespace tokenization", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "利益率悪化の主因は？",
      filing: {
        filingKey: "v1:0000000000:000000000000000000",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "利益率悪化の主因は部材コストの上昇と販促費の増加でした。",
            startOffset: 0,
            endOffset: 31,
            sortOrder: 1
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S1"]);
    expect(response.answer).toContain("利益率悪化");
  });

  it("explains what is visible from metrics when asked about growth drivers", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "どの変化が売上成長を支えた？",
      filing: {
        filingKey: "v1:0000000000:000000000000000001",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143756000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 124300000000,
            yoyPercent: 15.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9"]);
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("15.7%増");
    expect(response.answer).toContain("売上変化の直接要因は明示されていません");
    expect(response.answer).not.toContain("分かりません");
  });

  it("uses MD&A driver language for revenue-driver fallback answers", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "売上成長の主な要因は？",
      filing: {
        filingKey: "v1:0000000000:000000000000000101",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-K",
        filedAt: "2026-04-14",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "Revenues",
            value: 67590000000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 64820000000,
            yoyPercent: 4.3
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: { verdict: "", highlights: [], changes: [] },
        sourceChunks: [
          {
            sourceId: "S4",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text: "Sales and revenues increased compared with the prior year, primarily due to higher sales volume and favorable price realization.",
            startOffset: 0,
            endOffset: 124,
            sortOrder: 4
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (Revenues)",
            text: "売上高: 67590000000 USD / 比較値: 64820000000 / YoY: 4.3%",
            startOffset: 0,
            endOffset: 0,
            tagName: "Revenues",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S4"]);
    expect(response.answer).toContain("売上高は 675.9億ドル");
    expect(response.answer).toContain("販売数量の増加");
    expect(response.answer).toContain("価格実現の改善");
    expect(response.answer).not.toContain("直接要因は明示されていません");
  });

  it("recovers remote revenue-driver refusals when driver context is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer:
                        "売上高は前年比4.7%増加しました。売上成長の具体的な要因については、提出資料の本文中で説明されていません。",
                      sourceIds: ["S4"]
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "売上成長の主な要因は？",
      filing: {
        filingKey: "v1:0000000000:000000000000000103",
        ticker: "WMT",
        companyName: "Walmart Inc.",
        cik: "0000000000",
        formType: "10-K",
        filedAt: "2026-04-14",
        periodOfReport: "2026-01-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "Revenues",
            value: 713163000000,
            unit: "USD",
            periodEnd: "2026-01-31",
            comparisonValue: 680985000000,
            yoyPercent: 4.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: { verdict: "", highlights: [], changes: [] },
        sourceChunks: [
          {
            sourceId: "S4",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text:
              "Net sales increased across Walmart U.S., Walmart International and Sam's Club. The discussion also references comparable sales, ecommerce, membership income, traffic and average ticket as sales drivers.",
            startOffset: 0,
            endOffset: 196,
            sortOrder: 4
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (Revenues)",
            text: "売上高: 713163000000 USD / 比較値: 680985000000 / YoY: 4.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "Revenues",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.fallbackReason).toBe("low_quality_answer");
    expect(response.answer).toContain("売上高は 7,131.6億ドル");
    expect(response.answer).toContain("既存店売上");
    expect(response.answer).toContain("Walmart U.S.");
    expect(response.answer).not.toContain("説明されていません");
    expect(response.sourceIds).toEqual(expect.arrayContaining(["S4", "S9"]));
  });

  it("keeps durability fallback focused on the selected driver instead of a generic next-step answer", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "その要因は一時的？それとも続きそう？",
      filing: {
        filingKey: "v1:0000000000:000000000000000102",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-K",
        filedAt: "2026-04-14",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "Revenues",
            value: 713160000000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 681420000000,
            yoyPercent: 4.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: { verdict: "", highlights: [], changes: [] },
        sourceChunks: [
          {
            sourceId: "CTX1",
            sectionType: "md_a",
            sectionTitle: "Filing context",
            sourceLabel: "10-K Filing context",
            text: "Net sales increased primarily due to higher comparable sales, eCommerce sales growth and membership income, partially offset by currency headwinds.",
            startOffset: 0,
            endOffset: 147,
            sortOrder: 1
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (Revenues)",
            text: "売上高: 713160000000 USD / 比較値: 681420000000 / YoY: 4.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "Revenues",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["CTX1", "S9"]);
    expect(response.answer).toContain("既存店売上の増加");
    expect(response.answer).toContain("eコマース売上");
    expect(response.answer).toContain("価格、数量、需要、コスト、mix");
    expect(response.answer).not.toContain("提出資料の本文に、この要因に近い説明があります");
  });

  it("summarizes margin fallback causes from profitability context", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "利益率が悪化した理由は？",
      filing: {
        filingKey: "v1:0000000000:000000000000000103",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-K",
        filedAt: "2026-04-14",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "operatingIncome",
            tagUsed: "OperatingIncomeLoss",
            value: 29830000000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 29360000000,
            yoyPercent: 1.6
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: { verdict: "", highlights: [], changes: [] },
        sourceChunks: [
          {
            sourceId: "CTX2",
            sectionType: "md_a",
            sectionTitle: "Profitability context",
            sourceLabel: "10-K Profitability context",
            text: "Gross margin was pressured by product mix, higher merchandise costs, inventory shrink and increased operating expenses.",
            startOffset: 0,
            endOffset: 112,
            sortOrder: 2
          },
          {
            sourceId: "S12",
            sectionType: "xbrl_metric",
            sectionTitle: "営業利益",
            sourceLabel: "XBRL 営業利益 (OperatingIncomeLoss)",
            text: "営業利益: 29830000000 USD / 比較値: 29360000000 / YoY: 1.6%",
            startOffset: 0,
            endOffset: 0,
            tagName: "OperatingIncomeLoss",
            sortOrder: 12
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S12", "CTX2"]);
    expect(response.answer).toContain("営業利益は 298.3億ドル");
    expect(response.answer).toContain("商品構成・事業構成");
    expect(response.answer).toContain("在庫・ロス");
    expect(response.answer).not.toContain("本文全体と数字を並べる");
  });

  it("treats red-ink cause questions as profit questions instead of revenue questions", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "赤字の原因は？",
      filing: {
        filingKey: "v1:0000000000:000000000000000001",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-K",
        filedAt: "2026-04-14",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "Revenues",
            value: 480000000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 466000000,
            yoyPercent: 3.0
          },
          {
            logicalName: "netIncome",
            tagUsed: "NetIncomeLoss",
            value: -3848152000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 2965190000,
            yoyPercent: -229.8
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S2",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text: "Net loss was primarily due to a $5.9 billion unrealized fair value loss on digital assets, partially offset by operating income from the software business.",
            startOffset: 0,
            endOffset: 151,
            sortOrder: 2
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (Revenues)",
            text: "売上高: 480000000 USD / 比較値: 466000000 / YoY: 3.0%",
            startOffset: 0,
            endOffset: 0,
            tagName: "Revenues",
            sortOrder: 9
          },
          {
            sourceId: "S10",
            sectionType: "xbrl_metric",
            sectionTitle: "純利益",
            sourceLabel: "XBRL 純利益 (NetIncomeLoss)",
            text: "純利益: -3848152000 USD / 比較値: 2965190000 / YoY: -229.8%",
            startOffset: 0,
            endOffset: 0,
            tagName: "NetIncomeLoss",
            sortOrder: 10
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S10", "S2"]);
    expect(response.answer).toContain("純利益は -38.5億ドル");
    expect(response.answer).toContain("デジタル資産の評価損益");
    expect(response.answer).not.toContain("売上高は 4.8億ドル");
  });

  it("returns closest filing facts for broader stock-price questions", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "この先株価は上がる？",
      filing: {
        filingKey: "v1:0000000000:000000000000000002",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143756000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 124300000000,
            yoyPercent: 15.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Demand remained resilient across several customer groups despite a volatile macro environment.",
            startOffset: 0,
            endOffset: 87,
            sortOrder: 1
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S1"]);
    expect(response.answer).toContain("買いかどうかはここでは決めず");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("株価推移、決算後ニュース、会社見通し");
  });

  it("treats broad recent stock-context questions as context requests, not raw metric prompts", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "最近株の調子は？",
      filing: {
        filingKey: "v1:0000000000:000000000000000002",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143756000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 124300000000,
            yoyPercent: 15.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Demand remained resilient across several customer groups despite a volatile macro environment.",
            startOffset: 0,
            endOffset: 87,
            sortOrder: 1
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S1"]);
    expect(response.answer).toContain("今回の決算から見ると、足元はやや強めです");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("実際の株価推移や決算後ニュース");
  });

  it("uses cash flow as the anchor for capital-allocation style questions", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "キャッシュ創出と株主還元はどう見る？",
      filing: {
        filingKey: "v1:0000000000:000000000000000003",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "operatingCashFlow",
            tagUsed: "NetCashProvidedByUsedInOperatingActivities",
            value: 31200000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 28100000000,
            yoyPercent: 11.0
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S11",
            sectionType: "xbrl_metric",
            sectionTitle: "営業CF",
            sourceLabel: "XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities)",
            text: "営業CF: 31200000000 USD / 比較値: 28100000000 / YoY: 11.0%",
            startOffset: 0,
            endOffset: 0,
            tagName: "NetCashProvidedByUsedInOperatingActivities",
            sortOrder: 11
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S11"]);
    expect(response.answer).toContain("営業CFは 312億ドル");
    expect(response.answer).toContain("営業キャッシュフロー、手元資金、配当・自社株買いの実行額");
  });

  it("understands plain Japanese cash-generation questions", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "お金はちゃんと稼げてる？",
      filing: {
        filingKey: "v1:0000000000:000000000000000004",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "operatingCashFlow",
            tagUsed: "NetCashProvidedByUsedInOperatingActivities",
            value: 31200000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 28100000000,
            yoyPercent: 11.0
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v1",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S11",
            sectionType: "xbrl_metric",
            sectionTitle: "営業CF",
            sourceLabel: "XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities)",
            text: "営業CF: 31200000000 USD / 比較値: 28100000000 / YoY: 11.0%",
            startOffset: 0,
            endOffset: 0,
            tagName: "NetCashProvidedByUsedInOperatingActivities",
            sortOrder: 11
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S11"]);
    expect(response.answer).toContain("営業CFは 312億ドル");
  });

  it("normalizes Gemini responses that use sources objects instead of sourceIds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "利益率悪化の主因は部材コスト上昇です。",
                      sources: [{ sourceId: "S1" }]
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "利益率悪化の主因は？",
      filing: {
        filingKey: "v2:0000000000:000000000000000000",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v2",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "利益率悪化の主因は部材コストの上昇と販促費の増加でした。",
            startOffset: 0,
            endOffset: 31,
            sortOrder: 1
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S1"]);
    expect(response.answer).toContain("利益率悪化");
  });

  it("accepts explicit unsupported answers without sourceIds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "この決算資料の範囲では確認できません。",
                      sourceIds: []
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "利益率悪化の主因は？",
      filing: {
        filingKey: "v2:0000000000:000000000000000000",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v2",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: []
      }
    });

    expect(response.sourceIds).toEqual([]);
    expect(response.answer).toContain("利益率の方向は確認できます");
    expect(response.answer).toContain("具体的な要因は十分に特定できません");
    expect(response.answer).not.toBe("この決算資料の範囲では確認できません。");
  });

  it("recovers to closest filing facts when Gemini declines a broader question", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "この決算資料の範囲では確認できません。",
                      sourceIds: []
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "この先株価は上がる？",
      filing: {
        filingKey: "v2:0000000000:000000000000000003",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143756000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 124300000000,
            yoyPercent: 15.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v2",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Demand remained resilient across several customer groups despite a volatile macro environment.",
            startOffset: 0,
            endOffset: 87,
            sortOrder: 1
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S1"]);
    expect(response.answer).toContain("買いかどうかはここでは決めず");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
  });

  it("recovers when Gemini declines with a soft unsupported answer and no sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "この決算資料の範囲では確認できません。外部情報が必要です。",
                      sourceIds: []
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "この先株価は上がる？",
      filing: {
        filingKey: "v2:0000000000:000000000000000005",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143756000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 124300000000,
            yoyPercent: 15.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v2",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S7",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Demand remained resilient across several customer groups despite a volatile macro environment.",
            startOffset: 0,
            endOffset: 87,
            sortOrder: 1
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S7"]);
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).not.toContain("確認できません");
  });

  it("recovers metric-only guidance answers into filing-first context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "売上高は 1,437.6億ドル で、前年同期比 15.7%増 です。",
                      sourceIds: ["S9"]
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "ガイダンスや今後の見通しは強い？",
      filing: {
        filingKey: "v2:0000000000:000000000000000004",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143756000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 124300000000,
            yoyPercent: 15.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v2",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S7",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Demand remained resilient across several customer groups despite a volatile macro environment.",
            startOffset: 0,
            endOffset: 87,
            sortOrder: 1
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S7"]);
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("見通しの強さは、会社の需要コメントやリスクの言い方");
  });

  it("recovers revenue-only remote answers when the user asked about red-ink causes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer:
                        "売上高は 4.8億ドル で、前年比 3.0%増 です。提出資料の一般的な注意書きや案内文で、この論点の深掘りには向きません。",
                      sourceIds: ["S9", "S3"]
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "赤字の原因は？",
      filing: {
        filingKey: "v2:0000000000:000000000000000004",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-K",
        filedAt: "2026-04-14",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "Revenues",
            value: 480000000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 466000000,
            yoyPercent: 3.0
          },
          {
            logicalName: "netIncome",
            tagUsed: "NetIncomeLoss",
            value: -3848152000,
            unit: "USD",
            periodEnd: "2025-12-31",
            comparisonValue: 2965190000,
            yoyPercent: -229.8
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v2",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S2",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text: "Net loss was primarily due to a $5.9 billion unrealized fair value loss on digital assets, partially offset by operating income from the software business.",
            startOffset: 0,
            endOffset: 151,
            sortOrder: 2
          },
          {
            sourceId: "S3",
            sectionType: "md_a",
            sectionTitle: "Item 7",
            sourceLabel: "10-K Item 7",
            text: "Available Information The Company periodically provides certain information for investors on its corporate website and investor relations website.",
            startOffset: 152,
            endOffset: 290,
            sortOrder: 3
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (Revenues)",
            text: "売上高: 480000000 USD / 比較値: 466000000 / YoY: 3.0%",
            startOffset: 0,
            endOffset: 0,
            tagName: "Revenues",
            sortOrder: 9
          },
          {
            sourceId: "S10",
            sectionType: "xbrl_metric",
            sectionTitle: "純利益",
            sourceLabel: "XBRL 純利益 (NetIncomeLoss)",
            text: "純利益: -3848152000 USD / 比較値: 2965190000 / YoY: -229.8%",
            startOffset: 0,
            endOffset: 0,
            tagName: "NetIncomeLoss",
            sortOrder: 10
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S10", "S2"]);
    expect(response.answer).toContain("純利益は -38.5億ドル");
    expect(response.answer).toContain("デジタル資産の評価損益");
    expect(response.answer).not.toContain("売上高は 4.8億ドル");
  });

  it("falls back locally when Gemini times out", async () => {
    const fetchMock = vi.fn().mockImplementation((_, init?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateChatAnswer(
      {
        GEMINI_API_KEY: "test-key",
        GEMINI_TIMEOUT_MS: "1"
      } as never,
      {
        question: "関税の影響をどう説明している？",
        filing: {
          filingKey: "v3:0000320193:000032019326000006",
          ticker: "AAPL",
          companyName: "Apple Inc.",
          cik: "0000320193",
          formType: "10-Q",
          filedAt: "2026-01-30",
          periodOfReport: "2025-12-27",
          primaryDocumentUrl: "https://example.com",
          mdaText: "",
          mdaTokenCount: 0,
          metrics: [],
          generatedAt: "2026-04-14T00:00:00.000Z",
          extractorVersion: "v3",
          promptVersion: "v1",
          summary: {
            verdict: "",
            highlights: [],
            changes: []
          },
          sourceChunks: [
            {
              sourceId: "S6",
              sectionType: "md_a",
              sectionTitle: "Part I, Item 2",
              sourceLabel: "10-Q Part I Item 2",
              text: "Tariffs and other measures can have a material adverse impact on the company’s business, supply chain, pricing, and gross margin.",
              startOffset: 0,
              endOffset: 120,
              sortOrder: 1
            }
          ]
        }
      }
    );

    expect(response.sourceIds).toEqual(["S6"]);
    expect(response.answer).toContain("関税");
    expect(response.answer).toContain("サプライチェーン");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers from low-signal narrative citations on broader driver questions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer:
                        "売上高は増えています。関連記述では SEC と investor relations website について触れています。",
                      sourceIds: ["S9", "S3"]
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "どの変化が売上成長を支えた？",
      filing: {
        filingKey: "v3:0000000000:000000000000000005",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143756000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 124300000000,
            yoyPercent: 15.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v3",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S3",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Available Information The Company periodically provides certain information for investors on its corporate website and investor relations website.",
            startOffset: 0,
            endOffset: 120,
            sortOrder: 3
          },
          {
            sourceId: "S7",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Americas net sales increased primarily due to higher net sales of iPhone and Services.",
            startOffset: 121,
            endOffset: 220,
            sortOrder: 7
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S7"]);
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("iPhone");
  });

  it("falls back to filing-backed Japanese when Gemini answer is polluted by English boilerplate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer:
                        "売上高は 194.4億ドル で、前年比 8.5%増 です。 Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations. Investors are cautioned not to place undue reliance on these forward-looking statements.",
                      sourceIds: ["S9", "S1"]
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "前回決算との違いは？",
      filing: {
        filingKey: "v2:0000000000:000000000000000099",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 19443000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 17919000000,
            yoyPercent: 8.5
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v2",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Demand remained resilient across several customer groups despite a volatile macro environment.",
            startOffset: 0,
            endOffset: 87,
            sortOrder: 1
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 19443000000 USD / 比較値: 17919000000 / YoY: 8.5%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S1"]);
    expect(response.answer).toContain("売上高は 194.4億ドル");
    expect(response.answer).not.toContain("Management's Discussion");
    expect(response.answer).not.toContain("forward-looking");
  });

  it("recovers locally when Gemini answers a recent stock-context question with metrics only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "売上高は 1,437.6億ドル で、前年同期比 15.7%増 です。",
                      sourceIds: ["S9"]
                    })
                  }
                ]
              }
            }
          ]
        })
      })
    );

    const response = await generateChatAnswer({ GEMINI_API_KEY: "test-key" } as never, {
      question: "最近株の調子は？",
      filing: {
        filingKey: "v3:0000000000:000000000000000006",
        ticker: "TEST",
        companyName: "Test Corp",
        cik: "0000000000",
        formType: "10-Q",
        filedAt: "2026-04-14",
        periodOfReport: "2026-03-31",
        primaryDocumentUrl: "https://example.com",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [
          {
            logicalName: "revenue",
            tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
            value: 143756000000,
            unit: "USD",
            periodEnd: "2026-03-31",
            comparisonValue: 124300000000,
            yoyPercent: 15.7
          }
        ],
        generatedAt: "2026-04-14T00:00:00.000Z",
        extractorVersion: "v3",
        promptVersion: "v1",
        summary: {
          verdict: "",
          highlights: [],
          changes: []
        },
        sourceChunks: [
          {
            sourceId: "S1",
            sectionType: "md_a",
            sectionTitle: "Part I, Item 2",
            sourceLabel: "10-Q Part I Item 2",
            text: "Demand remained resilient across several customer groups despite a volatile macro environment.",
            startOffset: 0,
            endOffset: 87,
            sortOrder: 1
          },
          {
            sourceId: "S9",
            sectionType: "xbrl_metric",
            sectionTitle: "売上高",
            sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
            text: "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%",
            startOffset: 0,
            endOffset: 0,
            tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
            sortOrder: 9
          }
        ]
      }
    });

    expect(response.sourceIds).toEqual(["S9", "S1"]);
    expect(response.answer).toContain("今回の決算から見ると、足元はやや強めです");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
  });
});

function makeCrowdstrikeSubscriptionGrowthFiling() {
  return {
    filingKey: "v6:0001535527:000153552726000010",
    ticker: "CRWD",
    companyName: "CrowdStrike Holdings, Inc.",
    cik: "0001535527",
    formType: "10-K",
    filedAt: "2026-03-05",
    periodOfReport: "2026-01-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 3953000000,
        unit: "USD",
        periodEnd: "2026-01-31",
        comparisonValue: 3056000000,
        yoyPercent: 29.4
      }
    ],
    sourceChunks: [
      {
        sourceId: "S3",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7",
        text:
          "Subscription revenue increased primarily due to new customers, expansion within existing customers, and additional module adoption on the Falcon platform. Annual recurring revenue continued to grow with customer adoption of cloud security, identity protection and threat intelligence modules.",
        startOffset: 0,
        endOffset: 285,
        sortOrder: 3
      },
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
        text: "売上高: 3953000000 USD / 比較値: 3056000000 / YoY: 29.4%",
        startOffset: 0,
        endOffset: 0,
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sortOrder: 9
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeCrowdstrikeMissingRevenueDriverFiling() {
  const filing = makeCrowdstrikeSubscriptionGrowthFiling();
  return {
    ...filing,
    metrics: [
      {
        logicalName: "netIncome",
        tagUsed: "NetIncomeLoss",
        value: -162502000,
        unit: "USD",
        periodEnd: "2026-01-31",
        comparisonValue: -15241000,
        yoyPercent: -966.2
      },
      {
        logicalName: "operatingIncome",
        tagUsed: "OperatingIncomeLoss",
        value: -293292000,
        unit: "USD",
        periodEnd: "2026-01-31",
        comparisonValue: -116400000,
        yoyPercent: -152
      }
    ],
    sourceChunks: [
      {
        sourceId: "S2",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7",
        text:
          "Additionally, we regularly monitor our compliance with applicable financial reporting standards and review new pronouncements and drafts thereof that are relevant to us. Such changes may require us to change accounting policies.",
        startOffset: 0,
        endOffset: 220,
        sortOrder: 2
      },
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "純利益",
        sourceLabel: "XBRL 純利益 (NetIncomeLoss)",
        text: "純利益: -162502000 USD / 比較値: -15241000 / YoY: -966.2%",
        startOffset: 0,
        endOffset: 0,
        tagName: "NetIncomeLoss",
        sortOrder: 9
      },
      {
        sourceId: "S11",
        sectionType: "xbrl_metric",
        sectionTitle: "営業利益",
        sourceLabel: "XBRL 営業利益 (OperatingIncomeLoss)",
        text: "営業利益: -293292000 USD / 比較値: -116400000 / YoY: -152.0%",
        startOffset: 0,
        endOffset: 0,
        tagName: "OperatingIncomeLoss",
        sortOrder: 11
      }
    ]
  } as any;
}

function makeIntuitPlatformGrowthFiling() {
  return {
    filingKey: "v6:0000896878:000089687826000014",
    ticker: "INTU",
    companyName: "INTUIT INC.",
    cik: "0000896878",
    formType: "10-Q",
    filedAt: "2026-02-26",
    periodOfReport: "2026-01-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 4651000000,
        unit: "USD",
        periodEnd: "2026-01-31",
        comparisonValue: 3963000000,
        yoyPercent: 17.4
      }
    ],
    sourceChunks: [
      {
        sourceId: "S2",
        sectionType: "md_a",
        sectionTitle: "Item 2",
        sourceLabel: "10-Q Item 2",
        text:
          "Revenue increased due to customers adopting more platform services and broader workflows across our business and tax offerings.",
        startOffset: 0,
        endOffset: 130,
        sortOrder: 2
      },
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (Revenues)",
        text: "売上高: 4651000000 USD / 比較値: 3963000000 / YoY: 17.4%",
        startOffset: 0,
        endOffset: 0,
        tagName: "Revenues",
        sortOrder: 9
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeConstellationAcronymGlossaryFiling() {
  return {
    filingKey: "v6:0001868275:000186827526000032",
    ticker: "CEG",
    companyName: "Constellation Energy Corp",
    cik: "0001868275",
    formType: "10-K",
    filedAt: "2026-02-24",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: [
      {
        sourceId: "CTX2",
        sectionType: "md_a",
        sectionTitle: "Business overview context",
        sourceLabel: "10-K Business overview context",
        text:
          "AESO Alberta Electric Systems Operator AI Artificial Intelligence AOCI Accumulated Other Comprehensive Income ARO Asset Retirement Obligation. Constellation Energy operates generation assets and sells electricity to customers.",
        startOffset: 0,
        endOffset: 220,
        sortOrder: 2
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeConstellationRiskContextFiling() {
  return {
    filingKey: "v6:0001868275:000186827526000032",
    ticker: "CEG",
    companyName: "Constellation Energy Corp",
    cik: "0001868275",
    formType: "10-K",
    filedAt: "2026-02-24",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: [
      {
        sourceId: "CTX1",
        sectionType: "md_a",
        sectionTitle: "Risk factors context",
        sourceLabel: "10-K Risk factors context",
        text:
          "Our business is subject to risks related to nuclear generation operations, power and capacity market prices, regulation, electricity demand, supply constraints and geopolitical uncertainty. These risks may adversely affect our results of operations.",
        startOffset: 0,
        endOffset: 245,
        sortOrder: 1
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeSecurityRiskWithEnergyWordingFiling() {
  return {
    filingKey: "v6:0001262039:000126203926000001",
    ticker: "FTNT",
    companyName: "Fortinet Inc.",
    cik: "0001262039",
    formType: "10-K",
    filedAt: "2026-02-20",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: [
      {
        sourceId: "CTX1",
        sectionType: "md_a",
        sectionTitle: "Risk factors context",
        sourceLabel: "10-K Risk factors context",
        text:
          "Our business is subject to risks from cybersecurity threats, security vulnerabilities, competition, regulation, supply constraints, and higher energy consumption in data centers.",
        startOffset: 0,
        endOffset: 165,
        sortOrder: 1
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeConstellationHeadingOnlyDurabilityFiling() {
  return {
    filingKey: "v6:0001868275:000186827526000032",
    ticker: "CEG",
    companyName: "Constellation Energy Corp",
    cik: "0001868275",
    formType: "10-K",
    filedAt: "2026-02-24",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 25533000000,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 23568000000,
        yoyPercent: 8.3
      }
    ],
    sourceChunks: [
      {
        sourceId: "S2",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7",
        text: "MANAGEMENT’S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS",
        startOffset: 0,
        endOffset: 86,
        sortOrder: 2
      },
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (Revenues)",
        text: "売上高: 25533000000 USD / 比較値: 23568000000 / YoY: 8.3%",
        startOffset: 0,
        endOffset: 0,
        tagName: "Revenues",
        sortOrder: 9
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeInvestorViewFallbackFiling() {
  return {
    filingKey: "v6:test",
    ticker: "TEST",
    companyName: "TEST CO",
    cik: "0000000000",
    formType: "10-Q",
    filedAt: "2026-04-30",
    periodOfReport: "2026-03-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 1000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 900,
        yoyPercent: 11.1
      },
      {
        logicalName: "operatingCashFlow",
        tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: 80,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 120,
        yoyPercent: -33.3
      }
    ],
    sourceChunks: [
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (Revenues)",
        text: "売上高: 1000 USD / 比較値: 900 / YoY: 11.1%",
        startOffset: 0,
        endOffset: 0,
        tagName: "Revenues",
        sortOrder: 9
      },
      {
        sourceId: "S12",
        sectionType: "xbrl_metric",
        sectionTitle: "営業CF",
        sourceLabel: "XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities)",
        text: "営業CF: 80 USD / 比較値: 120 / YoY: -33.3%",
        startOffset: 0,
        endOffset: 0,
        tagName: "NetCashProvidedByUsedInOperatingActivities",
        sortOrder: 12
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeMarriottRevparDurabilityFiling() {
  return {
    filingKey: "v6:0001048286:000104828626000010",
    ticker: "MAR",
    companyName: "MARRIOTT INTERNATIONAL INC",
    cik: "0001048286",
    formType: "10-K",
    filedAt: "2026-02-10",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 26186000000,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 25100000000,
        yoyPercent: 4.3
      }
    ],
    sourceChunks: [
      {
        sourceId: "S7",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7",
        text:
          "We believe Revenue per Available Room (RevPAR), which we calculate by dividing property level room revenue by total rooms available for the period, is a meaningful indicator of our performance because it measures occupancy and average daily rate across our lodging properties.",
        startOffset: 0,
        endOffset: 285,
        sortOrder: 7
      },
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (Revenues)",
        text: "売上高: 26186000000 USD / 比較値: 25100000000 / YoY: 4.3%",
        startOffset: 0,
        endOffset: 0,
        tagName: "Revenues",
        sortOrder: 9
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeSynopsysDurabilityFiling() {
  return {
    filingKey: "v6:0000883241:000088324126000020",
    ticker: "SNPS",
    companyName: "SYNOPSYS INC",
    cik: "0000883241",
    formType: "10-Q",
    filedAt: "2026-02-25",
    periodOfReport: "2026-01-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 2408798000,
        unit: "USD",
        periodEnd: "2026-01-31",
        comparisonValue: 1455315000,
        yoyPercent: 65.5
      }
    ],
    sourceChunks: [
      {
        sourceId: "S7",
        sectionType: "md_a",
        sectionTitle: "Part I Item 2",
        sourceLabel: "10-Q Part I Item 2",
        text:
          "For the first quarter of fiscal 2026, revenue growth was primarily due to revenue growth across a majority of product groups and geographies and Ansys' contribution of $885 million.",
        startOffset: 0,
        endOffset: 178,
        sortOrder: 7
      },
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
        text: "売上高: 2408798000 USD / 比較値: 1455315000 / YoY: 65.5%",
        startOffset: 0,
        endOffset: 0,
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sortOrder: 9
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeAdpMarginImprovementFiling() {
  return {
    filingKey: "v6:0000008670:000000867026000010",
    ticker: "ADP",
    companyName: "AUTOMATIC DATA PROCESSING, INC.",
    cik: "0000008670",
    formType: "10-Q",
    filedAt: "2026-01-29",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 5359300000,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 5048400000,
        yoyPercent: 6.2
      },
      {
        logicalName: "netIncome",
        tagUsed: "NetIncomeLoss",
        value: 1062000000,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 963200000,
        yoyPercent: 10.3
      }
    ],
    sourceChunks: [
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
        text: "売上高: 5359300000 USD / 比較値: 5048400000 / YoY: 6.2%",
        startOffset: 0,
        endOffset: 0,
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sortOrder: 9
      },
      {
        sourceId: "S10",
        sectionType: "xbrl_metric",
        sectionTitle: "純利益",
        sourceLabel: "XBRL 純利益 (NetIncomeLoss)",
        text: "純利益: 1062000000 USD / 比較値: 963200000 / YoY: 10.3%",
        startOffset: 0,
        endOffset: 0,
        tagName: "NetIncomeLoss",
        sortOrder: 10
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeMarginDriverPatternFiling() {
  return {
    filingKey: "v6:0000000000:000000000000000002",
    ticker: "MRG",
    companyName: "Margin Pattern Corp",
    cik: "0000000000",
    formType: "10-Q",
    filedAt: "2026-04-30",
    periodOfReport: "2026-03-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 12000000000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 10000000000,
        yoyPercent: 20
      },
      {
        logicalName: "operatingIncome",
        tagUsed: "OperatingIncomeLoss",
        value: 3000000000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 2200000000,
        yoyPercent: 36.4
      },
      {
        logicalName: "netIncome",
        tagUsed: "NetIncomeLoss",
        value: 2500000000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 2000000000,
        yoyPercent: 25
      }
    ],
    sourceChunks: [
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
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
        sourceLabel: "XBRL 営業利益 (OperatingIncomeLoss)",
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
        sourceLabel: "XBRL 純利益 (NetIncomeLoss)",
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
        text:
          "Gross margin improved due to favorable price mix and lower manufacturing costs. Operating expenses increased due to higher research and development expenses and marketing, selling, and administrative expenses.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 1
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-30T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeRevenueDriverPatternFiling() {
  return {
    filingKey: "v6:0000000000:000000000000000001",
    ticker: "DRV",
    companyName: "Driver Pattern Corp",
    cik: "0000000000",
    formType: "10-Q",
    filedAt: "2026-04-30",
    periodOfReport: "2026-03-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 11230000000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 9594000000,
        yoyPercent: 17.1
      }
    ],
    sourceChunks: [
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (Revenues)",
        text: "売上高: 11230000000 USD / 比較値: 9594000000 / YoY: 17.1%",
        startOffset: 0,
        endOffset: 0,
        tagName: "Revenues",
        sortOrder: 9
      },
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Revenue driver discussion",
        sourceLabel: "10-Q Revenue driver discussion",
        text: "Comparable sales in fiscal 2025 were driven by growth in transactions and unit volumes, with strong sales in grocery and health and wellness.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 1
      },
      {
        sourceId: "S2",
        sectionType: "md_a",
        sectionTitle: "Revenue driver discussion",
        sourceLabel: "10-Q Revenue driver discussion",
        text: "Revenue increased for the three months ended March 31, 2026, driven primarily by increased volume, partially offset by lower realized prices.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 2
      },
      {
        sourceId: "S3",
        sectionType: "md_a",
        sectionTitle: "Revenue driver discussion",
        sourceLabel: "10-Q Revenue driver discussion",
        text: "Other revenue increased over the prior-year period primarily due to growth in Advisory and Other Services and select pricing modifications.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 3
      },
      {
        sourceId: "S4",
        sectionType: "md_a",
        sectionTitle: "Revenue driver discussion",
        sourceLabel: "10-K Revenue driver discussion",
        text: "Net interest income (“NII”) of $95.4 billion, up 3%, driven by higher Markets net interest income, higher revolving balances in Card Services, higher wholesale deposit balances, and the impact of investment securities activity.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 4
      },
      {
        sourceId: "S5",
        sectionType: "md_a",
        sectionTitle: "Revenue driver discussion",
        sourceLabel: "10-K Revenue driver discussion",
        text: "Noninterest revenue (“NIR”) was $87.0 billion, up 2%, reflecting higher Markets noninterest revenue, higher asset management fees in AWM and CCB, higher Payments fees, higher investment banking fees, and a $588 million First Republic-related gain recorded in the first quarter of 2025.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 5
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-30T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeKnownTickerRevenueAxisFiling() {
  return {
    filingKey: "v6:0000789019:000078901926000001",
    ticker: "MSFT",
    companyName: "MICROSOFT CORP",
    cik: "0000789019",
    formType: "10-Q",
    filedAt: "2026-04-24",
    periodOfReport: "2026-03-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 81270000000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 69630000000,
        yoyPercent: 16.7
      }
    ],
    sourceChunks: [
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
        text: "売上高: 81270000000 USD / 比較値: 69630000000 / YoY: 16.7%",
        startOffset: 0,
        endOffset: 0,
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sortOrder: 9
      },
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Management discussion",
        sourceLabel: "10-Q Management discussion",
        text: "Management discusses cloud demand, productivity software, LinkedIn and gaming, but this excerpt does not contain a full revenue table.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 1
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-30T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeUntranslatedRevenueDriverFiling() {
  return {
    filingKey: "v6:0001018724:000101872426000001",
    ticker: "AMZN",
    companyName: "AMAZON COM INC",
    cik: "0001018724",
    formType: "10-Q",
    filedAt: "2026-04-30",
    periodOfReport: "2026-03-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 181520000000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 155820000000,
        yoyPercent: 16.6
      }
    ],
    sourceChunks: [
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
        text: "売上高: 181520000000 USD / 比較値: 155820000000 / YoY: 16.6%",
        startOffset: 0,
        endOffset: 0,
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sortOrder: 9
      },
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Revenue driver discussion",
        sourceLabel: "10-Q Revenue driver discussion",
        text:
          "Revenue increased due to several factors, such as payment processing and related transaction costs, our level of productivity and accuracy, changes in volume, size, and weight of units received and fulfilled.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 1
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-30T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}

function makeAdpRevenueBreakdownFiling() {
  return {
    ...makeAdpMarginImprovementFiling(),
    sourceChunks: [
      {
        sourceId: "CTX1",
        sectionType: "md_a",
        sectionTitle: "Segment and revenue context",
        sourceLabel: "10-Q Segment and revenue context",
        text:
          "ADP provides HCM platforms, payroll, retirement services and PEO services to employers. These services are the main business lines discussed in the filing.",
        startOffset: 0,
        endOffset: 150,
        sortOrder: 1
      }
    ]
  } as any;
}
