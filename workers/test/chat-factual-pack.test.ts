import { describe, expect, it } from "vitest";
import { buildChatPrompt } from "../src/clients/gemini/prompts";
import { buildChatContextPack } from "../src/lib/chat/context-pack";

describe("chat Q3-lite factual packs", () => {
  it("builds an AAPL business pack with product and service categories", () => {
    const filing = makeFactualPackFiling({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      text:
        "Net sales by category include iPhone, Mac, iPad, Wearables, Home and Accessories, and Services. Apple sells smartphones, personal computers, tablets, wearables and accessories, and provides services including advertising, AppleCare, cloud services, digital content, and payment services. These products and services are sold to consumers, small and mid-sized businesses, education, enterprise, and government customers through direct and indirect distribution channels."
    });

    const contextPack = buildChatContextPack(filing, "business_overview");

    expect(contextPack.factualPack).toMatchObject({
      kind: "business_overview",
      productsServices: ["iPhone", "Mac", "iPad", "Wearables, Home and Accessories", "Services"]
    });
    expect(contextPack.factualPack?.sourceIds).toContain("S1");
  });

  it("builds an MSFT business pack with reportable segments", () => {
    const filing = makeFactualPackFiling({
      ticker: "MSFT",
      companyName: "Microsoft Corp",
      text:
        "We report our financial performance based on the following reportable segments: Productivity and Business Processes, Intelligent Cloud, and More Personal Computing. Products and services include Office, Microsoft 365, LinkedIn, Azure, Windows, and Gaming."
    });

    const contextPack = buildChatContextPack(filing, "business_overview");

    expect(contextPack.factualPack?.reportableSegments).toEqual([
      "Productivity and Business Processes",
      "Intelligent Cloud",
      "More Personal Computing"
    ]);
    expect(contextPack.factualPack?.productsServices).toEqual([
      "Office・Microsoft 365",
      "Azure・クラウド",
      "Windows",
      "LinkedIn",
      "Gaming"
    ]);
  });

  it("prioritizes segment and product revenue over geography in revenue packs", () => {
    const filing = makeFactualPackFiling({
      ticker: "MSFT",
      companyName: "Microsoft Corp",
      text:
        "Revenue by segment includes Productivity and Business Processes, Intelligent Cloud, and More Personal Computing. Revenue by geography includes United States and other countries. Azure and other cloud services revenue increased."
    });

    const contextPack = buildChatContextPack(filing, "revenue_breakdown");
    const categories = contextPack.factualPack?.revenueCategories ?? [];

    expect(categories.slice(0, 3).map((category) => category.label)).toEqual([
      "Productivity and Business Processes",
      "Intelligent Cloud",
      "More Personal Computing"
    ]);
    expect(categories.slice(0, 3).every((category) => category.kind === "segment")).toBe(true);
  });

  it("selects GOOGL risk-specific candidates before generic business context", () => {
    const filing = makeFactualPackFiling({
      ticker: "GOOGL",
      companyName: "Alphabet Inc.",
      text: "Our mission is to organize the world's information and make it universally accessible and useful.",
      extraSources: [
        {
          sourceId: "R1",
          sectionType: "md_a",
          sectionTitle: "Item 1A. Risk Factors",
          sourceLabel: "10-K Item 1A Risk Factors",
          text:
            "Our businesses face intense competition. Advertising revenues may decline if advertisers reduce spending. We are subject to regulatory and antitrust investigations, privacy and data protection risks, and risks from rapid advances in artificial intelligence and platform content moderation.",
          startOffset: 0,
          endOffset: 350,
          sortOrder: 2
        }
      ]
    });

    const contextPack = buildChatContextPack(filing, "risk_factors");

    expect(contextPack.factualPack?.riskCategories).toEqual([
      "競争激化",
      "広告収入への依存",
      "規制・独禁法",
      "プライバシー・データ保護",
      "AI・技術転換",
      "コンテンツ・プラットフォーム運営"
    ]);
    expect(contextPack.factualPack?.sourceIds).toContain("R1");
    expect(contextPack.sourceChunks.map((source) => source.sourceId)).toContain("R1");
  });

  it("puts the factual pack and source guard instructions into the chat prompt", () => {
    const filing = makeFactualPackFiling({
      ticker: "MSFT",
      companyName: "Microsoft Corp",
      text:
        "Revenue by segment includes Productivity and Business Processes, Intelligent Cloud, and More Personal Computing. Azure and other cloud services revenue increased."
    });
    const contextPack = buildChatContextPack(filing, "revenue_breakdown");

    const prompt = buildChatPrompt({
      filing,
      question: "売上の柱は？",
      questionIntent: "revenue_breakdown",
      contextPack
    });

    expect(prompt).toContain("Factual pack:");
    expect(prompt).toContain("use the Factual pack before using raw source excerpts");
    expect(prompt).toContain("Productivity and Business Processes");
    expect(prompt).toContain("Return valid sourceIds from the provided Sources list only.");
  });
});

function makeFactualPackFiling({
  ticker,
  companyName,
  text,
  extraSources = []
}: {
  ticker: string;
  companyName: string;
  text: string;
  extraSources?: any[];
}) {
  return {
    filingKey: `v6:test:${ticker}`,
    ticker,
    companyName,
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-02-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/filing",
    mdaText: `${text} ${extraSources.map((source) => source.text).join(" ")}`,
    mdaTokenCount: 200,
    extractorVersion: "v6",
    promptVersion: "v1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    summary: { verdict: "", highlights: [], changes: [] },
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 1000,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 900,
        yoyPercent: 11.1
      }
    ],
    sourceChunks: [
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Business",
        sourceLabel: "10-K Business",
        text,
        startOffset: 0,
        endOffset: text.length,
        sortOrder: 1
      },
      {
        sourceId: "M1",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高",
        text: "売上高: 1000 USD / 比較値: 900 / YoY: 11.1%",
        startOffset: 0,
        endOffset: 0,
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sortOrder: 9
      },
      ...extraSources
    ]
  } as any;
}
