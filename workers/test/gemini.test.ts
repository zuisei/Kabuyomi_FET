import { afterEach, describe, expect, it, vi } from "vitest";
import { generateChatAnswer, generateQuoteTranslation, generateSummary } from "../src/clients/gemini";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_TRANSLATION_MODEL,
  resolveGeminiModel,
  resolveGeminiTranslationModel
} from "../src/clients/gemini/request";

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
    expect(response.answer).toContain("どの事業が押したかまでは");
    expect(response.answer).not.toContain("分かりません");
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
    expect(response.answer).toBe("この決算資料の範囲では確認できません。");
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
