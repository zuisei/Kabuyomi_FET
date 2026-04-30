import { describe, expect, it } from "vitest";
import { buildChatPrompt } from "../src/clients/gemini/prompts";
import { buildChatFactualPack } from "../src/lib/chat/context-factual-pack";
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

  it("exposes factual-pack construction outside context-pack orchestration", () => {
    const filing = makeFactualPackFiling({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      text:
        "Net sales by category include iPhone, Mac, iPad, Wearables, Home and Accessories, and Services."
    });

    const factualPack = buildChatFactualPack(filing, "business_overview");

    expect(factualPack).toMatchObject({
      kind: "business_overview",
      productsServices: ["iPhone", "Mac", "iPad", "Wearables, Home and Accessories", "Services"]
    });
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

  it("does not infer generic AI or cloud business lines for Cintas", () => {
    const filing = makeFactualPackFiling({
      ticker: "CTAS",
      companyName: "CINTAS CORP",
      text:
        "Cintas classifies its businesses into Uniform Rental and Facility Services and First Aid and Safety Services. Revenue increased due to new customers, penetration of existing customers, price increases, and retention. We use information technology and cloud systems to support operations."
    });

    const contextPack = buildChatContextPack(filing, "business_overview");

    expect(contextPack.factualPack?.productsServices).toEqual([
      "Uniform Rental and Facility Services",
      "First Aid and Safety Services"
    ]);
    expect(contextPack.factualPack?.productsServices).not.toContain("クラウドサービス");
    expect(contextPack.factualPack?.productsServices).not.toContain("AI・データセンター向け計算基盤");
  });

  it("uses Baker Hughes energy segments instead of generic AI compute labels", () => {
    const filing = makeFactualPackFiling({
      ticker: "BKR",
      companyName: "Baker Hughes Co",
      text:
        "Baker Hughes reports Oilfield Services & Equipment and Industrial & Energy Technology. IET includes Gas Technology Equipment and Gas Technology Services. The filing discusses artificial intelligence and data center demand only as market context."
    });

    const contextPack = buildChatContextPack(filing, "business_overview");

    expect(contextPack.factualPack?.productsServices).toEqual([
      "Oilfield Services & Equipment",
      "Industrial & Energy Technology"
    ]);
    expect(contextPack.factualPack?.productsServices).not.toContain("AI・データセンター向け計算基盤");
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

  it("prefers MSFT risk sources over goodwill accounting notes", () => {
    const filing = makeFactualPackFiling({
      ticker: "MSFT",
      companyName: "Microsoft Corp",
      text:
        "Goodwill We allocate goodwill to reporting units and evaluate reporting units on an annual basis. Changes in business conditions, legal factors, or competition may require impairment testing of reporting units and fair value estimates.",
      extraSources: [
        {
          sourceId: "R1",
          sectionType: "md_a",
          sectionTitle: "Item 1A. Risk Factors",
          sourceLabel: "10-K Item 1A Risk Factors",
          text:
            "Our cloud services, software platforms, devices, and gaming businesses face intense competition. Cybersecurity incidents, data breaches, privacy and data protection rules, artificial intelligence services, antitrust and other regulation, reliance on third-party infrastructure, and enterprise customer demand could materially affect revenue, margins, operations, and our ability to grow across Azure, Microsoft 365, Windows, LinkedIn, and Gaming.",
          startOffset: 0,
          endOffset: 430,
          sortOrder: 2
        }
      ]
    });

    const contextPack = buildChatContextPack(filing, "risk_factors");

    expect(contextPack.factualPack?.riskCategories).toEqual([
      "競争激化",
      "サイバーセキュリティ",
      "クラウドサービス障害",
      "AI・技術転換",
      "プライバシー・データ保護",
      "規制・独禁法",
      "サードパーティ依存",
      "企業顧客・デバイス・ゲーム需要"
    ]);
    expect(contextPack.factualPack?.sourceIds).toContain("R1");
    expect(contextPack.sourceChunks[0]?.sourceId).toBe("R1");
    expect(contextPack.sourceChunks.map((source) => source.sourceId)).not.toContain("S1");
  });

  it("does not keep MSFT goodwill estimate notes as the only risk source", () => {
    const filing = makeFactualPackFiling({
      ticker: "MSFT",
      companyName: "Microsoft Corp",
      text:
        "This analysis requires significant judgments, including estimation of future cash flows, estimation of the long-term rate of growth for our business, and estimation of useful lives. Competition and legal factors may affect fair value estimates."
    });

    const contextPack = buildChatContextPack(filing, "risk_factors");

    expect(contextPack.sourceChunks.map((source) => source.sourceId)).not.toContain("S1");
    expect(contextPack.factualPack?.missingFields).toContain("risk_source_ids");
  });

  it("builds an NVDA revenue pack with concrete segment and product categories", () => {
    const filing = makeFactualPackFiling({
      ticker: "NVDA",
      companyName: "NVIDIA Corp",
      text:
        "Revenue by reportable segment includes Compute & Networking and Graphics. Revenue from Data Center computing grew due to demand for accelerated computing platforms. Gaming, Professional Visualization, and Automotive are also product market platforms described in the filing."
    });

    const contextPack = buildChatContextPack(filing, "revenue_breakdown");
    const categories = contextPack.factualPack?.revenueCategories ?? [];

    expect(categories.slice(0, 2).map((category) => category.label)).toEqual(["Compute & Networking", "Graphics"]);
    expect(categories.map((category) => category.label)).toEqual(
      expect.arrayContaining(["Data Center", "Gaming", "Professional Visualization", "Automotive"])
    );
    expect(categories.every((category) => category.label !== "segment revenue" && category.label !== "geography revenue")).toBe(true);
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
