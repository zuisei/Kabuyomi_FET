import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChatResponse } from "../src/lib/pipeline";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    expect(response.answer).toContain("どの要因がいちばん効いたかを厳密に切り分けるには追加情報が必要です");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
    expect(response.sources.every((source) => source.sourceUrl === filing.primaryDocumentUrl)).toBe(true);
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

    expect(response.answer).toContain("今回の決算資料だけで見ると、足元はやや強めです");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("営業利益は 508.5億ドル");
    expect(response.answer).toContain("株の強弱をみるには");
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
      "どの変化が売上成長を支えた？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("検索 snippet の弱い外部補足では Reuters が");
    expect(response.answer).toContain("iPhone需要");
    expect(response.answer).toContain("サービス事業の伸び");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7", "W1"]);
    expect(response.sources[0]?.sourceKind).toBe("sec_filing");
    expect(response.sources[1]?.sourceKind).toBe("sec_filing");
    expect(response.sources[2]?.sourceKind).toBe("web_supplement");
    expect(response.sources[0]?.sourceUrl).toBe(filing.primaryDocumentUrl);
    expect(response.sources[1]?.sourceUrl).toBe(filing.primaryDocumentUrl);
    expect(response.sources[2]?.sourceUrl).toBe("https://www.reuters.com/business/apple-earnings");
    expect(response.sources[2]?.sourceStrength).toBe("supplement_snippet");
    expect(response.sources[2]?.sourceLabel).toContain("Weak external supplement");
    expect(response.sources[2]?.excerpt).toContain("Search snippet:");
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
          ok: false,
          status: 401,
          text: async () => ""
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
    expect(response.answer).toContain("検索 snippet の弱い外部補足では Reuters が");
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

  it("recovers to filing-first fallback when Gemini returns only invalid sourceIds", async () => {
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

    expect(response.responsePath).toBe("fallback");
    expect(response.answer).toContain("売上高は 1,437.6億ドル");
    expect(response.answer).toContain("この先を言い切ることはできません");
    expect(response.sources.map((source) => source.sourceId)).toEqual(["S9", "S7"]);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
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
      "ガイダンスや今後の見通しは強い？",
      {} as never,
      { webSupplementEnabled: true }
    );

    expect(response.answer).toContain("この先を言い切ることはできません");
    expect(response.answer).toContain("検索 snippet の弱い外部補足では Reuters が");
    expect(response.answer).toContain("会社見通し");
    expect(response.sources.map((source) => source.sourceKind)).toEqual(["sec_filing", "sec_filing", "web_supplement"]);
    expect(response.sources.at(-1)?.sourceStrength).toBe("supplement_snippet");
  });

  it("adds a contrastive market explanation from web supplements for despite-style stock questions", async () => {
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

    expect(response.answer).toContain("検索 snippet の弱い外部補足では Reuters が");
    expect(response.answer).toContain("会社見通し");
    expect(response.sources.at(-1)?.sourceKind).toBe("web_supplement");
    expect(response.sources.at(-1)?.sourceStrength).toBe("supplement_snippet");
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
    expect(response.answer).toContain("今回の決算資料だけで見ると、足元はやや強めです");
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
