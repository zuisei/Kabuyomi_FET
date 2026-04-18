import { afterEach, describe, expect, it, vi } from "vitest";
import { generateChatAnswer } from "../src/clients/gemini";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Gemini local chat fallback", () => {
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
    expect(response.answer).toContain("どの事業や地域が売上高を押し上げたかまでは分かりません");
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
    expect(response.answer).toContain("株価の方向や買いかどうかは");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("まず決算書で確認できる変化");
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
    expect(response.answer).toContain("filingベースで見ると、足元はやや強めです");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("株価推移や決算後ニュースを別で見るのが安全です");
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
    expect(response.answer).toContain("配当や自社株買いが十分か");
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
                      answer: "この filing の提供コンテキストでは確認できません。",
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
    expect(response.answer).toBe("この filing の提供コンテキストでは確認できません。");
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
                      answer: "この filing の提供コンテキストでは確認できません。",
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
    expect(response.answer).toContain("株価の方向や買いかどうかは");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
  });

  it("falls back locally when Gemini times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_, init?: RequestInit) => {
        return new Promise((_, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      })
    );

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
    expect(response.answer).toContain("filingベースで見ると、足元はやや強めです");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
  });
});
