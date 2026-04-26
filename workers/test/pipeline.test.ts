import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChatResponse } from "../src/lib/pipeline";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function findLogEvent(logSpy: { mock: { calls: unknown[][] } }, event: string): Record<string, unknown> {
  const payload = logSpy.mock.calls
    .map(([line]) => (typeof line === "string" ? JSON.parse(line) as Record<string, unknown> : null))
    .find((entry): entry is Record<string, unknown> => entry?.event === event);

  expect(payload).toBeDefined();
  return payload!;
}

describe("buildChatResponse", () => {
  it("answers deterministically when a margin deterioration premise is contradicted by metrics", async () => {
    const filing = makeTestFiling();

    const response = await buildChatResponse(filing, "今期の利益率悪化の主因は？", {} as never);

    expect(response.answer).toContain("利益率悪化は確認できません");
    expect(response.answer).toContain("営業利益率");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S12", "S10"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("answers deterministically when asked whether margins improved", async () => {
    const filing = makeTestFiling();

    const response = await buildChatResponse(filing, "利益率は改善した？", {} as never);

    expect(response.answer).toContain("利益率は改善しています");
    expect(response.answer).toContain("営業利益率");
    expect(response.answer).toContain("純利益率");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S12", "S10"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("answers common change-overview prompts with the biggest filing-backed differences first", async () => {
    const filing = makeTestFiling();

    const response = await buildChatResponse(filing, "前回決算との違いは？", {} as never);

    expect(response.answer).toContain("数字で目立つのは");
    expect(response.answer).toContain("営業利益は 508.5億ドル");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("前年同期比");
    expect(response.sources.length).toBeGreaterThanOrEqual(2);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("keeps cash-flow cause follow-ups anchored to operating cash flow", async () => {
    const filing = makeCashFlowFiling();

    const response = await buildChatResponse(
      filing,
      "営業CFが変化した理由は？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("営業CFは -676.3億ドル");
    expect(response.answer).toContain("営業CFは売上高ではなく");
    expect(response.answer).toContain("減少理由の内訳は断定できません");
    expect(response.answer).not.toContain("売上高は");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S11"]);
    expect(response.responsePath).toBe("deterministic");
  });

  it("keeps revenue-driver questions conversational even without model output", async () => {
    const filing = makeTestFiling();

    const response = await buildChatResponse(
      filing,
      "どの変化が売上成長を支えた？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("15.7%増");
    expect(response.answer).toContain("iPhone");
    expect(response.answer).toContain("本文で名前が出ている地域・製品は伸びの候補");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
    expect(response.sources.every((source) => source.sourceUrl === filing.primaryDocumentUrl)).toBe(true);
  });

  it("answers revenue sector questions deterministically with business buckets", async () => {
    const filing = makeRevenueBreakdownFiling();

    const response = await buildChatResponse(
      filing,
      "売上のセクターは？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("売上の主な区分は");
    expect(response.answer).toContain("車両販売・関連サービス");
    expect(response.answer).toContain("サービス・その他");
    expect(response.answer).toContain("自動車リース");
    expect(response.answer).toContain("エネルギー生成・蓄電");
    expect(response.answer).not.toContain("利息収入");
    expect(response.answer).not.toContain("規制クレジット");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S2", "S4"]);
    expect(response.responsePath).toBe("deterministic");
  });

  it("answers company-overview prompts with business lines instead of revenue metrics", async () => {
    const filing = makeBusinessOverviewFiling();

    const response = await buildChatResponse(
      filing,
      "この企業はなんの企業？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("Guardant Health, Inc.は");
    expect(response.answer).toContain("がん領域の精密医療");
    expect(response.answer).toContain("がん検査・診断");
    expect(response.answer).toContain("製薬会社向けサービス");
    expect(response.answer).not.toContain("売上高は");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S2"]);
    expect(response.responsePath).toBe("deterministic");
  });

  it("lets Gemini answer business-overview prompts when it stays filing-grounded", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const filing = makeBusinessOverviewFiling();
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
                        "Guardant Healthは、がんの血液検査と精密医療を手がける会社です。患者や医療機関向けの検査に加えて、製薬会社の臨床研究も支援しています。",
                      sourceIds: ["S2"]
                    })
                  }
                ]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 1200,
            candidatesTokenCount: 80,
            totalTokenCount: 1280
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await buildChatResponse(
      filing,
      "この企業はなんの企業？",
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("がんの血液検査と精密医療");
    expect(response.answer).toContain("製薬会社の臨床研究");
    expect(response.answer).not.toContain("売上高は");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S2"]);
    expect(response.responsePath).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const llmUsage = findLogEvent(logSpy, "llm_usage");
    expect(llmUsage).toMatchObject({
      aiTask: "chat",
      model: "gemma-4-31b-it",
      route: "/v1/chat",
      ticker: filing.ticker,
      filingKey: filing.filingKey,
      responsePath: "gemini",
      promptTokenCount: 1200,
      candidatesTokenCount: 80,
      totalTokenCount: 1280,
      latencyMs: expect.any(Number)
    });
    expect(JSON.stringify(llmUsage)).not.toContain("この企業はなんの企業");
  });

  it("recovers business-overview prompts when remote output starts without a subject", async () => {
    const filing = makeBusinessOverviewFiling();
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        answer: "は、がんの血液検査と精密医療を手がける会社です。患者や医療機関向けの検査も提供しています。",
                        sourceIds: ["S2"]
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
    vi.stubGlobal("fetch", fetchMock);

    const response = await buildChatResponse(
      filing,
      "この企業はなんの企業？",
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("Guardant Health, Inc.は");
    expect(response.answer).not.toMatch(/^は、/);
    expect(response.responsePath).toBe("deterministic");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers business-overview prompts to deterministic filing context when remote output is weak", async () => {
    const filing = makeSparseAppleOverviewFiling();
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
                        "提出資料の本文では「The Company has historically experienced higher net sales...」という文脈で説明されています。",
                      sourceIds: ["S8"]
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

    const response = await buildChatResponse(
      filing,
      "この企業はなんの企業？",
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("Apple Inc.は");
    expect(response.answer).toContain("iPhone");
    expect(response.answer).toContain("Services");
    expect(response.answer).not.toContain("historically experienced higher net sales");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S8"]);
    expect(response.responsePath).toBe("deterministic");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses revenue buckets for broad what-company prompts when business buckets are available", async () => {
    const filing = makeRevenueBreakdownFiling();

    const response = await buildChatResponse(
      filing,
      "この企業って何の会社？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("Tesla, Inc.は");
    expect(response.answer).toContain("車両販売・関連サービス");
    expect(response.answer).toContain("サービス・その他");
    expect(response.answer).toContain("エネルギー生成・蓄電");
    expect(response.answer).not.toContain("売上高は");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S2", "S4"]);
    expect(response.responsePath).toBe("deterministic");
  });

  it("falls back to cash-source business lines when the filing lacks a clean revenue table chunk", async () => {
    const filing = makeRevenueBreakdownCashFallbackFiling();

    const response = await buildChatResponse(
      filing,
      "売上のセクターは？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("売上の主な区分は");
    expect(response.answer).toContain("車両販売・関連サービス");
    expect(response.answer).toContain("自動車リース");
    expect(response.answer).toContain("エネルギー生成・蓄電");
    expect(response.answer).not.toContain("利息収入");
    expect(response.answer).not.toContain("規制クレジット");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S2", "S4"]);
    expect(response.responsePath).toBe("deterministic");
  });

  it("anchors red-ink cause questions on profit evidence instead of revenue", async () => {
    const filing = makeLossFiling();

    const response = await buildChatResponse(
      filing,
      "赤字の原因は？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("純利益は -38.5億ドル");
    expect(response.answer).toContain("デジタル資産の評価損益");
    expect(response.answer).not.toContain("売上高は 4.8億ドル");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S10", "S2"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("uses D1-backed history only for trend-style questions", async () => {
    const filing = makeTestFiling();
    const env = makeHistoryEnv({
      metricRows: [
        {
          filingKey: "v3:0000320193:000032019326000006",
          ticker: "AAPL",
          formType: "10-Q",
          filedAt: "2026-01-30",
          periodOfReport: "2025-12-27",
          periodEnd: "2025-12-27",
          logicalName: "revenue",
          value: 143756000000,
          unit: "USD",
          yoyPercent: 15.7,
          sourceId: "S9",
          primaryDocumentUrl: "https://historical.example.com/aapl-q"
        },
        {
          filingKey: "v3:0000320193:000032019325000111",
          ticker: "AAPL",
          formType: "10-Q",
          filedAt: "2024-01-29",
          periodOfReport: "2023-12-30",
          periodEnd: "2023-12-30",
          logicalName: "revenue",
          value: 119580000000,
          unit: "USD",
          yoyPercent: 2.1,
          sourceId: "S9",
          primaryDocumentUrl: "https://historical.example.com/aapl-q"
        }
      ]
    });

    const response = await buildChatResponse(
      filing,
      "この3年の売上推移は？",
      env as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("この3年の四半期提出資料ベース");
    expect(response.answer).toContain("2023-12-30");
    expect(response.answer).toContain("2025-12-27");
    expect(response.sources.every((source) => source.sourceKind === "historical_filing")).toBe(true);
    expect(response.sources.every((source) => source.sourceUrl === "https://historical.example.com/aapl-q")).toBe(true);
  });

  it("degrades to the latest filing with a reason when historical storage is temporarily unavailable", async () => {
    const filing = makeTestFiling();

    const response = await buildChatResponse(
      filing,
      "この3年の売上推移は？",
      {
        DB: {
          prepare() {
            throw new Error("D1 unavailable");
          },
          batch: vi.fn()
        },
        FILINGS_BUCKET: {
          get: vi.fn(),
          put: vi.fn(),
          head: vi.fn()
        }
      } as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("今回は3年比較を完了できません");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("前年同期比 15.7%増");
    expect(response.answer).not.toContain("D1 unavailable");
    expect(response.responsePath).toBe("fallback");
    expect(response.sources.length).toBe(1);
    expect(response.sources[0]?.sourceKind).toBe("sec_filing");
  });

  it("queues historical hydration in waitUntil and returns a fallback immediately", async () => {
    const filing = makeTestFiling();
    const historyEnv = makeHistoryEnv({ metricRows: [] });
    const cache = new Map<string, unknown>([
      [
        "tickers_snapshot",
        {
          updatedAt: "2026-04-15T00:00:00.000Z",
          items: [
            {
              ticker: "AAPL",
              companyName: "Apple Inc.",
              cik: "0000320193",
              exchange: "Nasdaq"
            }
          ]
        }
      ]
    ]);
    const scheduled: Promise<unknown>[] = [];

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? ""));
      if (body.cik !== "0000320193") {
        throw new Error(`Unexpected fetch body: ${JSON.stringify(body)}`);
      }

      return new Response(JSON.stringify({
        name: "Apple Inc.",
        filings: {
          recent: {
            form: ["10-Q", "10-Q", "10-Q"],
            accessionNumber: [
              "0000320193-26-000057",
              "0000320193-25-000093",
              "0000320193-24-000091"
            ],
            primaryDocument: ["a10q.htm", "prior10q.htm", "older10q.htm"],
            filingDate: ["2026-02-03", "2025-05-02", "2024-05-03"],
            reportDate: ["2025-12-28", "2024-12-29", "2023-12-30"]
          }
        }
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await buildChatResponse(
      filing,
      "この3年の売上推移は？",
      {
        ...historyEnv,
        KABUYOMI_CACHE: {
          get: async (key: string) => cache.get(key),
          put: async (key: string, value: unknown) => {
            cache.set(key, value);
          }
        },
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_FETCHER_SHARED_SECRET: "secret"
      } as never,
      { webSupplementEnabled: false },
      {
        executionContext: {
          waitUntil(promise: Promise<unknown>) {
            scheduled.push(promise);
          }
        }
      }
    );

    expect(response.answer).toContain("バックグラウンドで準備中");
    expect(response.responsePath).toBe("fallback");
    expect(scheduled).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await scheduled[0];

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not tell the user to retry later when historical hydration has no comparable candidates", async () => {
    const filing = makeTestFiling();
    const historyEnv = makeHistoryEnv({ metricRows: [] });
    const cache = new Map<string, unknown>([
      [
        "tickers_snapshot",
        {
          updatedAt: "2026-04-15T00:00:00.000Z",
          items: [
            {
              ticker: "AAPL",
              companyName: "Apple Inc.",
              cik: "0000320193",
              exchange: "Nasdaq"
            }
          ]
        }
      ]
    ]);
    const scheduled: Promise<unknown>[] = [];

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        name: "Apple Inc.",
        filings: {
          recent: {
            form: ["10-Q"],
            accessionNumber: ["0000320193-26-000006"],
            primaryDocument: ["a10q.htm"],
            filingDate: ["2026-01-30"],
            reportDate: ["2025-12-27"]
          }
        }
      }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await buildChatResponse(
      filing,
      "この3年の売上推移は？",
      {
        ...historyEnv,
        KABUYOMI_CACHE: {
          get: async (key: string) => cache.get(key),
          put: async (key: string, value: unknown) => {
            cache.set(key, value);
          }
        },
        SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
        SEC_FETCHER_SHARED_SECRET: "secret"
      } as never,
      { webSupplementEnabled: false },
      {
        executionContext: {
          waitUntil(promise: Promise<unknown>) {
            scheduled.push(promise);
          }
        }
      }
    );

    expect(response.answer).not.toContain("バックグラウンドで準備中");
    expect(response.answer).not.toContain("少し時間を置いて");
    expect(response.answer).toContain("比較対象の過去年の決算資料が不足");
    expect(response.responsePath).toBe("fallback");
    expect(scheduled).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains why the stock can rise despite uncertainty by separating risks from strengths", async () => {
    const filing = makeMarketContrastFiling();

    const response = await buildChatResponse(
      filing,
      "なんでこんな不確実な決算なのに株価上げてるの？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("たしかに、提出資料では");
    expect(response.answer).toContain("関税や追加措置の不確実さ");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("営業利益は 508.5億ドル");
    expect(response.answer).toContain("不確実さはあるが、足元の業績や需要は想定より強い");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S6", "S9", "S12", "S8"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("answers broad recent stock-context questions by leading with the filing limit", async () => {
    const filing = makeMarketContrastFiling();

    const response = await buildChatResponse(
      filing,
      "最近株の調子は？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("今回の決算から見ると、足元はやや強めです");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("営業利益は 508.5億ドル");
    expect(response.answer).toContain("実際の株価推移や決算後ニュースをこの決算の数字と並べる");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S12", "S6"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("appends a trusted web supplement for broader revenue-driver questions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fbusiness%2Fapple-earnings">Apple forecasts strong sales growth as iPhone demand rebounds</a>
            <a class="result__snippet">Jan 29 (Reuters) - Apple forecast higher-than-expected revenue growth, powered by strong demand for its iPhones and services growth as China rebounds.</a>
          `
        } as Response;
      }

      if (url === "https://www.reuters.com/business/apple-earnings") {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <html>
              <head>
                <meta name="description" content="Apple forecast higher-than-expected revenue growth, powered by strong demand for its iPhones and services growth as China rebounds.">
                <title>Apple forecasts strong sales growth as iPhone demand rebounds</title>
              </head>
            </html>
          `
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "どの変化が売上成長を支えた？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("外部補足では Reuters が");
    expect(response.answer).toContain("iPhone需要");
    expect(response.answer).toContain("サービス事業の伸び");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7", "W1"]);
    expect(response.sources[0]?.sourceKind).toBe("sec_filing");
    expect(response.sources[1]?.sourceKind).toBe("sec_filing");
    expect(response.sources[2]?.sourceKind).toBe("web_supplement");
    expect(response.sources[0]?.sourceUrl).toBe(filing.primaryDocumentUrl);
    expect(response.sources[1]?.sourceUrl).toBe(filing.primaryDocumentUrl);
    expect(response.sources[2]?.sourceUrl).toBe("https://www.reuters.com/business/apple-earnings");
    expect(response.sources[2]?.sourceStrength).toBe("supplement_article");
    expect(response.sources[2]?.sourceLabel).toContain("External supplement");
    expect(response.sources[2]?.excerpt).not.toContain("Search snippet:");
  });

  it("still appends a web supplement when Gemini returns a terse filing-only answer", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        return {
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
        } as Response;
      }

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fbusiness%2Fapple-earnings">Apple forecasts strong sales growth as iPhone demand rebounds</a>
            <a class="result__snippet">Jan 29 (Reuters) - Apple forecast higher-than-expected revenue growth, powered by strong demand for its iPhones and services growth as China rebounds.</a>
          `
        } as Response;
      }

      if (url === "https://www.reuters.com/business/apple-earnings") {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <html>
              <head>
                <meta property="og:description" content="Apple forecast higher-than-expected revenue growth, powered by strong demand for its iPhones and services growth as China rebounds.">
                <title>Apple forecasts strong sales growth as iPhone demand rebounds</title>
              </head>
            </html>
          `
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeDriverRichFiling();
    const response = await buildChatResponse(
      filing,
      "どの変化が売上成長を支えた？",
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: true }
    );

    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7", "W1"]);
    expect(response.answer).toContain("外部補足では Reuters が");
  });

  it("replaces weak model citations with a stronger filing-backed local fallback", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        return {
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
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeDriverRichFiling();
    const response = await buildChatResponse(
      filing,
      "どの変化が売上成長を支えた？",
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("iPhone");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
  });

  it("recovers durability follow-ups when Gemini answers with metrics and boilerplate", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        return {
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
                          "売上高は 1,437.6億ドルで、前年同期比 15.7%増です。提出資料の一般的な注意書きや案内文が中心で、材料としては弱めです。",
                        sourceIds: ["S9", "S3"]
                      })
                    }
                  ]
                }
              }
            ]
          })
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeDriverRichFiling();
    const response = await buildChatResponse(
      filing,
      "その要因は一時的？",
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(response.responsePath).toBe("fallback");
    expect(response.answer).toContain("一時的");
    expect(response.answer).toContain("断定");
    expect(response.answer).toContain("iPhone");
    expect(response.answer).not.toContain("一般的な注意書き");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S7", "S9"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("recovers to filing-first fallback when Gemini returns only invalid sourceIds", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        answer: "会社見通しは強そうです。",
                        sourceIds: ["BAD1"]
                      })
                    }
                  ]
                }
              }
            ],
            usageMetadata: {
              promptTokenCount: 1500,
              candidatesTokenCount: 95,
              totalTokenCount: 1595
            }
          })
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const question = "ガイダンスや今後の見通しは強い？";
    const response = await buildChatResponse(
      filing,
      question,
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(response.responsePath).toBe("fallback");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("見通しの強さは、会社の需要コメントやリスクの言い方");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const llmUsage = findLogEvent(logSpy, "llm_usage");
    expect(llmUsage).toMatchObject({
      aiTask: "chat",
      model: "gemma-4-31b-it",
      route: "/v1/chat",
      ticker: filing.ticker,
      filingKey: filing.filingKey,
      responsePath: "fallback",
      promptTokenCount: 1500,
      candidatesTokenCount: 95,
      totalTokenCount: 1595,
      latencyMs: expect.any(Number)
    });
    expect(JSON.stringify(llmUsage)).not.toContain("ガイダンスや今後の見通し");

    const decision = findLogEvent(logSpy, "chat_path_decision");
    expect(decision).toMatchObject({
      ticker: filing.ticker,
      filingKey: filing.filingKey,
      questionIntent: "mda_summary",
      responsePath: "fallback",
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason: "invalid_source_id",
      schemaValid: true,
      sourceIdsValid: false,
      sourceCount: 2,
      promptTokenCount: 3000,
      candidatesTokenCount: 190,
      totalTokenCount: 3190,
      latencyMs: expect.any(Number),
      contentMode: "full",
      retryAttempt: 1,
      retryReason: "invalid_source_id",
      finalFallbackReason: "invalid_source_id"
    });
    expect(JSON.stringify(decision)).not.toContain("ガイダンスや今後の見通し");
    const contextSelection = findLogEvent(logSpy, "chat_context_selection");
    expect(contextSelection).toMatchObject({
      ticker: filing.ticker,
      filingKey: filing.filingKey,
      questionIntent: "mda_summary",
      candidateSourceCount: expect.any(Number),
      selectedSourceCount: expect.any(Number),
      selectedSourceCharCount: expect.any(Number),
      avgSelectedSourceChars: expect.any(Number),
      contextTokenBudget: expect.any(Number),
      estimatedContextTokens: expect.any(Number),
      rejectedShortCount: expect.any(Number),
      rejectedTableFragmentCount: expect.any(Number),
      rejectedLowTextQualityCount: expect.any(Number),
      sectionHitCountBusiness: expect.any(Number),
      sectionHitCountRisk: expect.any(Number),
      sectionHitCountMda: expect.any(Number)
    });
    expect(JSON.stringify(contextSelection)).not.toContain("ガイダンスや今後の見通し");
    expect(logSpy.mock.calls.map(([line]) => String(line)).join("\n")).not.toContain(question);
  });

  it("repairs a schema_invalid chat response once when the retry returns valid JSON", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        callCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify(
                        callCount === 1
                          ? {
                              unsupported: "shape"
                            }
                          : {
                              answer: "売上増は、本文ではiPhoneとServicesの売上増が支えたと説明されています。",
                              sourceIds: ["S7"]
                            }
                      )
                    }
                  ]
                }
              }
            ],
            usageMetadata: {
              promptTokenCount: callCount === 1 ? 1000 : 1200,
              candidatesTokenCount: callCount === 1 ? 20 : 60,
              totalTokenCount: callCount === 1 ? 1020 : 1260
            }
          })
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const question = "ガイダンスや今後の見通しは強い？";
    const response = await buildChatResponse(
      filing,
      question,
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.responsePath).toBe("gemini");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S7"]);

    const decision = findLogEvent(logSpy, "chat_path_decision");
    expect(decision).toMatchObject({
      responsePath: "gemini",
      fallbackReason: null,
      finalFallbackReason: null,
      schemaValid: true,
      sourceIdsValid: true,
      retryAttempt: 1,
      retryReason: "schema_invalid",
      promptTokenCount: 2200,
      candidatesTokenCount: 80,
      totalTokenCount: 2280
    });
    expect(logSpy.mock.calls.map(([line]) => String(line)).join("\n")).not.toContain(question);
  });

  it("logs schema_invalid and stops after one repair retry when Gemini keeps returning an unusable chat schema", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        unsupported: "shape"
                      })
                    }
                  ]
                }
              }
            ],
            usageMetadata: {
              promptTokenCount: 1420,
              candidatesTokenCount: 12,
              totalTokenCount: 1432
            }
          })
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const question = "ガイダンスや今後の見通しは強い？";
    const response = await buildChatResponse(
      filing,
      question,
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(response.responsePath).toBe("fallback");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const decision = findLogEvent(logSpy, "chat_path_decision");
    expect(decision).toMatchObject({
      questionIntent: "mda_summary",
      responsePath: "fallback",
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason: "schema_invalid",
      schemaValid: false,
      sourceIdsValid: true,
      sourceCount: 2,
      promptTokenCount: 2840,
      candidatesTokenCount: 24,
      totalTokenCount: 2864,
      retryAttempt: 1,
      retryReason: "schema_invalid",
      finalFallbackReason: "schema_invalid"
    });
    expect(JSON.stringify(decision)).not.toContain("ガイダンスや今後の見通し");
    expect(logSpy.mock.calls.map(([line]) => String(line)).join("\n")).not.toContain(question);
  });

  it("preserves the gemini response path when a remote answer returns valid filing sources", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        answer: "売上の伸びは iPhone とサービスが主因です。",
                        sourceIds: ["S9", "S7"]
                      })
                    }
                  ]
                }
              }
            ]
          })
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "ガイダンスや今後の見通しは強い？",
      { GEMINI_API_KEY: "test-key" } as never,
      { webSupplementEnabled: false }
    );

    expect(response.responsePath).toBe("gemini");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("appends investor-style outlook context for guidance questions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fbusiness%2Fapple-guidance">Apple forecasts strong sales growth as iPhone demand rebounds</a>
            <a class="result__snippet">Jan 29 (Reuters) - Apple forecast higher-than-expected revenue growth for the March quarter, powered by strong demand for its iPhones and a rebound in China.</a>
          `
        } as Response;
      }

      if (url === "https://www.reuters.com/business/apple-guidance") {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <html>
              <head>
                <meta name="description" content="Apple forecast higher-than-expected revenue growth for the March quarter, powered by strong demand for its iPhones and a rebound in China.">
                <title>Apple forecasts strong sales growth as iPhone demand rebounds</title>
              </head>
            </html>
          `
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "ガイダンスや今後の見通しは強い？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.answer).toContain("見通しの強さは、会社の需要コメントやリスクの言い方");
    expect(response.answer).toContain("外部補足では Reuters が");
    expect(response.answer).toContain("会社見通し");
    expect(response.sources.map((source) => source.sourceKind)).toEqual(["sec_filing", "sec_filing", "web_supplement"]);
    expect(response.sources.at(-1)?.sourceStrength).toBe("supplement_article");
  });

  it("keeps despite-style stock questions filing-grounded when only weak snippets are available", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fbusiness%2Fapple-earnings">Apple forecasts strong sales growth as iPhone demand rebounds</a>
            <a class="result__snippet">Jan 29 (Reuters) - Apple forecast higher-than-expected revenue growth for the March quarter, powered by strong demand for its iPhones and a rebound in China.</a>
          `
        } as Response;
      }

      if (url === "https://www.reuters.com/business/apple-earnings") {
        return {
          ok: false,
          status: 401,
          text: async () => ""
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeMarketContrastFiling();
    const response = await buildChatResponse(
      filing,
      "なんでこんな不確実な決算なのに株価上げてるの？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.answer).toContain("たしかに、提出資料では");
    expect(response.answer).not.toContain("検索 snippet の弱い外部補足では Reuters が");
    expect(response.sources.map((source) => source.sourceKind)).toEqual([
      "sec_filing",
      "sec_filing",
      "sec_filing",
      "sec_filing"
    ]);
  });

  it("uses Reuters-style stock reaction context for broad recent stock questions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fbusiness%2Fapple-shares-rise-after-earnings">Apple shares rise after earnings as iPhone demand stays strong</a>
            <a class="result__snippet">Jan 29 (Reuters) - Apple shares rose 3.2% after earnings as investors focused on stronger-than-expected demand and upbeat outlook.</a>
          `
        } as Response;
      }

      if (url === "https://www.reuters.com/business/apple-shares-rise-after-earnings") {
        return {
          ok: false,
          status: 401,
          text: async () => ""
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "最近株の調子は？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.answer).toContain("外部報道ベースでは、決算後に株価は 3.2% 上昇で反応しています");
    expect(response.answer).toContain("反応チャート:");
    expect(response.answer).toContain("↗ 3.2%");
    expect(response.answer).toContain("今回の決算から見ると、足元はやや強めです");
    expect(response.answer).not.toContain("実際の株価推移や決算後ニュースをこの決算の数字と並べる");
    expect(response.answer).toContain("値動き自体は検索 snippet ベースの弱い外部補足で、なぜそう見られたかの整理は今回の決算資料に基づいています");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S12", "W1"]);
    expect(response.sources.at(-1)?.sourceKind).toBe("web_supplement");
    expect(response.sources.at(-1)?.sourceStrength).toBe("supplement_snippet");
  });

  it("drops official investor-relations filler for broad recent stock questions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Finvestor.apple.com%2Fnewsroom%2Fquarterly-results">Apple investor relations quarterly results</a>
            <a class="result__snippet">Investor Relations newsroom with Apple quarterly results and press release.</a>
          `
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "最近株の調子は？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S12"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    expect(requestedUrls).not.toContain("https://investor.apple.com/newsroom/quarterly-results");
  });

  it("ignores generic market-data pages and keeps only filing evidence when no credible article is found", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fcompany%2Faapl.o">Apple Inc profile</a>
            <a class="result__snippet">Find the latest company profile, stock price and latest news for Apple.</a>
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.cnbc.com%2Fquotes%2FAAPL">AAPL stock quote</a>
            <a class="result__snippet">Real-time quote and market data for Apple shares.</a>
          `
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "なんで株価が動いてるの？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    expect(requestedUrls).not.toContain("https://www.reuters.com/company/aapl.o");
    expect(requestedUrls).not.toContain("https://www.cnbc.com/quotes/AAPL");
  });

  it("prefers a Reuters earnings article over a generic Reuters company page", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fcompany%2Faapl.o">Apple Inc profile</a>
            <a class="result__snippet">Company profile and latest market data for Apple.</a>
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fbusiness%2Fapple-earnings">Apple forecasts strong sales growth as iPhone demand rebounds</a>
            <a class="result__snippet">Jan 29 (Reuters) - Apple forecast higher-than-expected revenue growth, powered by strong demand for its iPhones and services growth as China rebounds.</a>
          `
        } as Response;
      }

      if (url === "https://www.reuters.com/business/apple-earnings") {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <html>
              <head>
                <meta name="description" content="Apple forecast higher-than-expected revenue growth, powered by strong demand for its iPhones and services growth as China rebounds.">
                <title>Apple forecasts strong sales growth as iPhone demand rebounds</title>
              </head>
            </html>
          `
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "どの変化が売上成長を支えた？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.answer).toContain("外部補足では Reuters が");
    expect(response.answer).toContain("iPhone需要");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7", "W1"]);
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    );
    expect(requestedUrls).not.toContain("https://www.reuters.com/company/aapl.o");
  });

  it("rejects a generic official newsroom page for driver questions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.apple.com%2Fnewsroom%2F2026%2F01%2Fapple-reports-first-quarter-results%2F">Apple reports first quarter results - Apple</a>
            <a class="result__snippet">Apple today announced financial results for its fiscal 2026 first quarter ended December 27, 2025.</a>
          `
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "どの変化が売上成長を支えた？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("skips web supplementation when the remote flag is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "どの変化が売上成長を支えた？",
      {} as never,
      { webSupplementEnabled: false }
    );

    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not search for supplements when the filing answer is already exact and sufficient", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const filing = makeTestFiling();
    const response = await buildChatResponse(
      filing,
      "利益率は改善した？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.answer).toContain("利益率は改善しています");
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function makeTestFiling() {
  return {
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
    extractorVersion: "v3",
    promptVersion: "v1",
    generatedAt: "2026-04-14T00:00:00.000Z",
    summary: { verdict: "", highlights: [], changes: [] },
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 143756000000,
        unit: "USD",
        periodEnd: "2025-12-27",
        comparisonValue: 124300000000,
        yoyPercent: 15.7
      },
      {
        logicalName: "operatingIncome",
        tagUsed: "OperatingIncomeLoss",
        value: 50852000000,
        unit: "USD",
        periodEnd: "2025-12-27",
        comparisonValue: 42832000000,
        yoyPercent: 18.7
      },
      {
        logicalName: "netIncome",
        tagUsed: "NetIncomeLoss",
        value: 42097000000,
        unit: "USD",
        periodEnd: "2025-12-27",
        comparisonValue: 36330000000,
        yoyPercent: 15.9
      }
    ],
    sourceChunks: [
      {
        sourceId: "S7",
        sectionType: "md_a",
        sectionTitle: "Part I, Item 2",
        sourceLabel: "10-Q Part I Item 2, filed 2026-01-30",
        text: "Americas net sales increased during the first quarter primarily due to higher net sales of iPhone and Services.",
        startOffset: 0,
        endOffset: 120,
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
      },
      {
        sourceId: "S10",
        sectionType: "xbrl_metric",
        sectionTitle: "純利益",
        sourceLabel: "XBRL 純利益 (NetIncomeLoss)",
        text: "純利益: 42097000000 USD / 比較値: 36330000000 / YoY: 15.9%",
        startOffset: 0,
        endOffset: 0,
        tagName: "NetIncomeLoss",
        sortOrder: 10
      },
      {
        sourceId: "S12",
        sectionType: "xbrl_metric",
        sectionTitle: "営業利益",
        sourceLabel: "XBRL 営業利益 (OperatingIncomeLoss)",
        text: "営業利益: 50852000000 USD / 比較値: 42832000000 / YoY: 18.7%",
        startOffset: 0,
        endOffset: 0,
        tagName: "OperatingIncomeLoss",
        sortOrder: 12
      }
    ]
  } as any;
}

function makeCashFlowFiling() {
  return {
    filingKey: "v3:0001729678:000172967826000001",
    ticker: "C",
    companyName: "Citigroup Inc.",
    cik: "0000831001",
    formType: "10-Q",
    filedAt: "2026-01-30",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/c",
    mdaText: "",
    mdaTokenCount: 0,
    extractorVersion: "v3",
    promptVersion: "v1",
    generatedAt: "2026-04-14T00:00:00.000Z",
    summary: { verdict: "", highlights: [], changes: [] },
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 85230000000,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 80710000000,
        yoyPercent: 5.6
      },
      {
        logicalName: "operatingCashFlow",
        tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: -67632000000,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 47000000000,
        yoyPercent: -243.9
      }
    ],
    sourceChunks: [
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
        text: "売上高: 85230000000 USD / 比較値: 80710000000 / YoY: 5.6%",
        startOffset: 0,
        endOffset: 0,
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sortOrder: 9
      },
      {
        sourceId: "S11",
        sectionType: "xbrl_metric",
        sectionTitle: "営業CF",
        sourceLabel: "XBRL 営業CF (NetCashProvidedByUsedInOperatingActivities)",
        text: "営業CF: -67632000000 USD / 比較値: 47000000000 / YoY: -243.9%",
        startOffset: 0,
        endOffset: 0,
        tagName: "NetCashProvidedByUsedInOperatingActivities",
        sortOrder: 11
      }
    ]
  } as any;
}

function makeDriverRichFiling() {
  const base = makeTestFiling() as any;
  return {
    ...base,
    sourceChunks: [
      {
        sourceId: "S3",
        sectionType: "md_a",
        sectionTitle: "Part I, Item 2",
        sourceLabel: "10-Q Part I Item 2, filed 2026-01-30",
        text: "Available Information The Company periodically provides certain information for investors on its corporate website and investor relations website.",
        startOffset: 0,
        endOffset: 120,
        sortOrder: 3
      },
      {
        sourceId: "S7",
        sectionType: "md_a",
        sectionTitle: "Part I, Item 2",
        sourceLabel: "10-Q Part I Item 2, filed 2026-01-30",
        text: "Americas net sales increased during the first quarter primarily due to higher net sales of iPhone and Services.",
        startOffset: 121,
        endOffset: 240,
        sortOrder: 7
      },
      ...base.sourceChunks
    ]
  } as any;
}

function makeLossFiling() {
  return {
    filingKey: "v3:0001599999:000159999926000001",
    ticker: "LOSS",
    companyName: "Lossy Corp",
    cik: "0001599999",
    formType: "10-K",
    filedAt: "2026-02-05",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/loss",
    mdaText: "",
    mdaTokenCount: 0,
    extractorVersion: "v3",
    promptVersion: "v1",
    generatedAt: "2026-04-14T00:00:00.000Z",
    summary: { verdict: "", highlights: [], changes: [] },
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
    sourceChunks: [
      {
        sourceId: "S2",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7, filed 2026-02-05",
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
  } as any;
}

function makeRevenueBreakdownFiling() {
  return {
    filingKey: "v3:0001318605:000131860526000001",
    ticker: "TSLA",
    companyName: "Tesla, Inc.",
    cik: "0001318605",
    formType: "10-K",
    filedAt: "2026-01-29",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/tsla",
    mdaText: "",
    mdaTokenCount: 0,
    extractorVersion: "v3",
    promptVersion: "v1",
    generatedAt: "2026-04-14T00:00:00.000Z",
    summary: { verdict: "", highlights: [], changes: [] },
    metrics: [],
    sourceChunks: [
      {
        sourceId: "S2",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7, filed 2026-01-29",
        text: "Revenue by automotive sales, services and other, and automotive leasing remained the core of the business.",
        startOffset: 0,
        endOffset: 108,
        sortOrder: 2
      },
      {
        sourceId: "S3",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7, filed 2026-01-29",
        text: "Our operating cash inflows also included sales of regulatory credits and interest income on our cash and investments portfolio.",
        startOffset: 109,
        endOffset: 236,
        sortOrder: 3
      },
      {
        sourceId: "S4",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7, filed 2026-01-29",
        text: "Energy generation and storage revenue increased during the year.",
        startOffset: 237,
        endOffset: 302,
        sortOrder: 4
      }
    ]
  } as any;
}

function makeBusinessOverviewFiling() {
  return {
    filingKey: "v3:0001576280:000157628026000001",
    ticker: "GH",
    companyName: "Guardant Health, Inc.",
    cik: "0001576280",
    formType: "10-K",
    filedAt: "2026-02-20",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/gh",
    mdaText: "",
    mdaTokenCount: 0,
    extractorVersion: "v3",
    promptVersion: "v1",
    generatedAt: "2026-04-24T00:00:00.000Z",
    summary: { verdict: "", highlights: [], changes: [] },
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 508000000,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 476500000,
        yoyPercent: 6.6
      }
    ],
    sourceChunks: [
      {
        sourceId: "S2",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7, filed 2026-02-20",
        text: "Guardant Health is a leading precision oncology company focused on helping conquer cancer globally through proprietary blood-based tests, vast data sets and advanced analytics. The company serves patients, healthcare providers and biopharmaceutical companies through screening, recurrence monitoring and therapy selection products.",
        startOffset: 0,
        endOffset: 320,
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
  } as any;
}

function makeSparseAppleOverviewFiling() {
  const base = makeTestFiling() as any;
  return {
    ...base,
    sourceChunks: [
      {
        sourceId: "S8",
        sectionType: "md_a",
        sectionTitle: "Part I, Item 2",
        sourceLabel: "10-Q Part I Item 2, filed 2026-01-30",
        text: "The Company has historically experienced higher net sales in its first quarter compared to other quarters in its fiscal year due in part to seasonal holiday demand. Additionally, new product and service introductions can significantly impact net sales, cost of sales and operating expenses.",
        startOffset: 0,
        endOffset: 275,
        sortOrder: 8
      },
      ...base.sourceChunks.filter((chunk: { sectionType: string }) => chunk.sectionType === "xbrl_metric")
    ]
  } as any;
}

function makeRevenueBreakdownCashFallbackFiling() {
  return {
    filingKey: "v3:0001318605:000131860526000002",
    ticker: "TSLA",
    companyName: "Tesla, Inc.",
    cik: "0001318605",
    formType: "10-K",
    filedAt: "2026-01-29",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/tsla",
    mdaText: "",
    mdaTokenCount: 0,
    extractorVersion: "v3",
    promptVersion: "v1",
    generatedAt: "2026-04-14T00:00:00.000Z",
    summary: { verdict: "", highlights: [], changes: [] },
    metrics: [],
    sourceChunks: [
      {
        sourceId: "S2",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7, filed 2026-01-29",
        text: "Sources and Conditions of Liquidity Our sources to fund our material cash requirements are predominantly from our deliveries and servicing of new and used vehicles, deployments and servicing of our energy storage products, interest income, and proceeds from debt facilities and equity offerings, when applicable.",
        startOffset: 0,
        endOffset: 302,
        sortOrder: 2
      },
      {
        sourceId: "S4",
        sectionType: "md_a",
        sectionTitle: "Item 7",
        sourceLabel: "10-K Item 7, filed 2026-01-29",
        text: "Our operating cash inflows include cash from vehicle sales and related servicing, sales of energy generation and storage products, customer lease and financing payments, sales of regulatory credits and interest income on our cash and investments portfolio.",
        startOffset: 303,
        endOffset: 562,
        sortOrder: 4
      }
    ]
  } as any;
}

function makeMarketContrastFiling() {
  return {
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
    extractorVersion: "v3",
    promptVersion: "v1",
    generatedAt: "2026-04-14T00:00:00.000Z",
    summary: { verdict: "", highlights: [], changes: [] },
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 143756000000,
        unit: "USD",
        periodEnd: "2025-12-27",
        comparisonValue: 124300000000,
        yoyPercent: 15.7
      },
      {
        logicalName: "operatingIncome",
        tagUsed: "OperatingIncomeLoss",
        value: 50852000000,
        unit: "USD",
        periodEnd: "2025-12-27",
        comparisonValue: 42832000000,
        yoyPercent: 18.7
      }
    ],
    sourceChunks: [
      {
        sourceId: "S6",
        sectionType: "md_a",
        sectionTitle: "Part I, Item 2",
        sourceLabel: "10-Q Part I Item 2, filed 2026-01-30",
        text: "Tariffs and other measures that are applied to the Company’s products or their components can have a material adverse impact on the Company’s business, results of operations and financial condition, including impacting the Company’s supply chain, pricing and gross margin.",
        startOffset: 0,
        endOffset: 220,
        sortOrder: 6
      },
      {
        sourceId: "S8",
        sectionType: "md_a",
        sectionTitle: "Part I, Item 2",
        sourceLabel: "10-Q Part I Item 2, filed 2026-01-30",
        text: "Greater China net sales increased during the first quarter of 2026 compared to the same quarter in 2025 due to higher net sales of iPhone. Japan net sales increased primarily due to higher net sales of iPhone and iPad. Rest of Asia Pacific net sales increased primarily due to higher net sales of iPhone and Services.",
        startOffset: 221,
        endOffset: 520,
        sortOrder: 8
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
      },
      {
        sourceId: "S12",
        sectionType: "xbrl_metric",
        sectionTitle: "営業利益",
        sourceLabel: "XBRL 営業利益 (OperatingIncomeLoss)",
        text: "営業利益: 50852000000 USD / 比較値: 42832000000 / YoY: 18.7%",
        startOffset: 0,
        endOffset: 0,
        tagName: "OperatingIncomeLoss",
        sortOrder: 12
      }
    ]
  } as any;
}

function makeHistoryEnv({
  metricRows,
  segmentRows = []
}: {
  metricRows: any[];
  segmentRows?: any[];
}) {
  const prepare = vi.fn((sql: string) => ({
    bind: (...values: unknown[]) => ({
      first: async () => {
        if (sql.includes("SELECT filing_key FROM filings WHERE filing_key")) {
          return null;
        }
        return null;
      },
      all: async () => {
        if (sql.includes("FROM metric_history")) {
          return { results: metricRows };
        }
        if (sql.includes("FROM segment_highlights")) {
          return { results: segmentRows };
        }
        return { results: [] };
      },
      run: async () => ({ results: [], success: true, meta: { changes: 1 }, values })
    })
  }));

  return {
    DB: {
      prepare,
      batch: vi.fn().mockResolvedValue([])
    },
    FILINGS_BUCKET: {
      head: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined)
    }
  };
}
