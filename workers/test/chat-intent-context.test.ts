import { describe, expect, it } from "vitest";
import type { FilingCacheRecord } from "../src/env";
import { buildChatContextPack } from "../src/lib/chat/context-pack";
import { classifyQuestionIntent } from "../src/lib/chat/intent";

describe("chat question intent and context packing", () => {
  it("classifies risk questions and prioritizes risk context", () => {
    const filing = makeIntentFiling();
    const intent = classifyQuestionIntent("この会社の一番大きいリスクは？");
    const context = buildChatContextPack(filing, intent);

    expect(intent).toBe("risk_factors");
    expect(context.sourceChunks[0]?.sourceId).toBe("S3");
    expect(context.sourceChunks[0]?.text).toContain("supply chain");
  });

  it("selects metrics context for margin questions", () => {
    const filing = makeIntentFiling();
    const intent = classifyQuestionIntent("利益率はどう？");
    const context = buildChatContextPack(filing, intent);

    expect(intent).toBe("margin_profitability");
    expect(context.metrics.map((metric) => metric.logicalName)).toEqual(["revenue", "operatingIncome", "netIncome"]);
    expect(context.sourceChunks.slice(0, 3).map((chunk) => chunk.sourceId)).toEqual(["S9", "S10", "S11"]);
  });

  it("keeps numeric metric context for previous-filing comparison questions", () => {
    const filing = makeIntentFiling();
    const intent = classifyQuestionIntent("前回決算との違いは？");
    const context = buildChatContextPack(filing, intent);

    expect(intent).toBe("historical_comparison");
    expect(context.metrics.map((metric) => metric.logicalName)).toEqual(["revenue", "operatingIncome", "netIncome"]);
    expect(context.sourceChunks.slice(0, 3).map((chunk) => chunk.sourceId)).toEqual(["S9", "S10", "S11"]);
  });

  it("classifies short cause and durability follow-ups as MD&A-style context requests", () => {
    const filing = makeIntentFiling();

    expect(classifyQuestionIntent("なぜ？")).toBe("mda_summary");
    expect(classifyQuestionIntent("その要因は一時的？")).toBe("mda_summary");
    expect(classifyQuestionIntent("売上高はなぜ伸びた？")).toBe("yoy_change");
    expect(classifyQuestionIntent("売上高が変化した理由は？")).toBe("yoy_change");

    const context = buildChatContextPack(filing, classifyQuestionIntent("その要因は一時的？"));
    expect(context.sourceSelectionStrategy).toContain("mda_summary");
    expect(context.contextTokenBudget).toBeGreaterThanOrEqual(9_000);
    expect(context.sourceChunks.some((chunk) => chunk.sectionType === "md_a")).toBe(true);

    expect(classifyQuestionIntent("営業CFが変化した理由は？")).toBe("cash_flow");
    expect(classifyQuestionIntent("利益率が悪化した理由は？")).toBe("margin_profitability");
  });

  it("prioritizes meaningful business narrative over numeric-only chunks", () => {
    const filing = {
      ...makeIntentFiling(),
      sourceChunks: [
        {
          sourceId: "S1",
          sectionType: "md_a" as const,
          sectionTitle: "Item 7",
          sourceLabel: "10-K Item 7",
          text: "Data Center 2026 2025 2024 39 42 41 100 200 300",
          startOffset: 0,
          endOffset: 40,
          sortOrder: 1
        },
        {
          sourceId: "S2",
          sectionType: "md_a" as const,
          sectionTitle: "Item 7",
          sourceLabel: "10-K Item 7",
          text:
            "Our business provides data center computing platforms, software, networking products and services to cloud service providers, consumer internet companies, enterprises and other end markets. We also sell products for gaming, professional visualization and automotive use cases, so this paragraph describes the company rather than a numeric table fragment.",
          startOffset: 41,
          endOffset: 370,
          sortOrder: 2
        },
        ...makeIntentFiling().sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric")
      ]
    };
    const context = buildChatContextPack(filing, "business_overview");

    expect(context.sourceChunks[0]?.sourceId).toBe("S2");
    expect(context.sourceChunks[0]?.text).toContain("data center computing platforms");
    expect(context.sourceChunks.map((chunk) => chunk.sourceId)).not.toContain("S1");
    expect(context.selectionDiagnostics.rejectedShortCount).toBeGreaterThan(0);
    expect(context.contextTokenBudget).toBeGreaterThanOrEqual(7_000);
  });

  it("expands selected business chunks with same-section neighboring context", () => {
    const selectedText =
      "Our business provides data center computing platforms, software, networking products and services to cloud service providers, consumer internet companies, enterprises and other end markets. These offerings are used for accelerated computing and artificial intelligence workloads across multiple industries.";
    const filing = {
      ...makeIntentFiling(),
      mdaText: [
        "We sell computing platforms to cloud service providers and enterprise customers. This opening context describes who uses the products and why the market matters.",
        selectedText,
        "The same section also describes gaming, professional visualization, automotive and networking products. This neighboring context makes the source useful as a business overview rather than a single isolated sentence."
      ].join("\n\n"),
      sourceChunks: [
        {
          sourceId: "S1",
          sectionType: "md_a" as const,
          sectionTitle: "Item 1",
          sourceLabel: "10-K Item 1",
          text:
            "We sell computing platforms to cloud service providers and enterprise customers. This opening context describes who uses the products and why the market matters.",
          startOffset: 0,
          endOffset: 145,
          sortOrder: 1
        },
        {
          sourceId: "S2",
          sectionType: "md_a" as const,
          sectionTitle: "Item 1",
          sourceLabel: "10-K Item 1",
          text: selectedText,
          startOffset: 147,
          endOffset: 147 + selectedText.length,
          sortOrder: 2
        },
        {
          sourceId: "S3",
          sectionType: "md_a" as const,
          sectionTitle: "Item 1",
          sourceLabel: "10-K Item 1",
          text:
            "The same section also describes gaming, professional visualization, automotive and networking products. This neighboring context makes the source useful as a business overview rather than a single isolated sentence.",
          startOffset: 147 + selectedText.length + 2,
          endOffset: 147 + selectedText.length + 190,
          sortOrder: 3
        },
        ...makeIntentFiling().sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric")
      ]
    };

    const context = buildChatContextPack(filing, "business_overview");
    const selected = context.sourceChunks.find((chunk) => chunk.sourceId === "S2");

    expect(selected?.text.length).toBeGreaterThan(selectedText.length);
    expect(selected?.text).toContain("cloud service providers and enterprise customers");
    expect(selected?.text).toContain("professional visualization");
    expect(context.selectionDiagnostics.selectedSourceCharCount).toBeGreaterThan(selectedText.length);
    expect(context.selectionDiagnostics.avgSelectedSourceChars).toBeGreaterThan(120);
  });

  it("does not let tiny table fragments suppress supplemental business windows", () => {
    const filing = {
      ...makeIntentFiling(),
      mdaText:
        "NVIDIA designs accelerated computing platforms for data center, gaming, professional visualization, automotive and networking markets. Its products include graphics processing units, systems, software and services used by cloud service providers, enterprises, consumer internet companies and other customers. This business description is much more useful than a standalone table cell.",
      sourceChunks: [
        {
          sourceId: "S1",
          sectionType: "md_a" as const,
          sectionTitle: "Item 7",
          sourceLabel: "10-K Item 7",
          text: "39",
          startOffset: 0,
          endOffset: 2,
          sortOrder: 1
        },
        ...makeIntentFiling().sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric")
      ]
    };

    const context = buildChatContextPack(filing, "business_overview");

    expect(context.sourceChunks.some((chunk) => chunk.sourceId.startsWith("CTX"))).toBe(true);
    expect(context.sourceChunks[0]?.text).toContain("accelerated computing platforms");
    expect(context.selectionDiagnostics.selectedSourceCharCount).toBeGreaterThan(300);
  });

  it("keeps substantive business windows even when they contain table-of-contents noise", () => {
    const filing = {
      ...makeIntentFiling(),
      mdaText:
        "39 Table of Contents The following table sets forth certain items expressed as a percentage of revenue. Reportable Segments Revenue by Reportable Segments shows Compute & Networking and Graphics. Compute & Networking revenue increased due to the major platform shifts to accelerated computing and AI. Revenue from Data Center computing grew because of demand for the Blackwell computing platform. Revenue from Data Center networking grew with Ethernet, InfiniBand and NVLink compute fabric. Graphics revenue was driven by Blackwell architecture, and the filing also describes customers such as cloud service providers, enterprises, AI model makers and system integrators.",
      sourceChunks: [
        {
          sourceId: "S1",
          sectionType: "md_a" as const,
          sectionTitle: "Item 7",
          sourceLabel: "10-K Item 7",
          text: "39",
          startOffset: 0,
          endOffset: 2,
          sortOrder: 1
        },
        {
          sourceId: "S2",
          sectionType: "md_a" as const,
          sectionTitle: "Item 7",
          sourceLabel: "10-K Item 7",
          text:
            "The following table sets forth, for the periods indicated, certain items in our statements of income expressed as a percentage of revenue.",
          startOffset: 3,
          endOffset: 140,
          sortOrder: 2
        },
        ...makeIntentFiling().sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric")
      ]
    };

    const context = buildChatContextPack(filing, "business_overview");

    expect(context.sourceChunks[0]?.sourceId).toMatch(/^CTX/);
    expect(context.sourceChunks[0]?.text).toContain("accelerated computing and AI");
    expect(context.sourceChunks[0]?.text).toContain("cloud service providers");
    expect(context.selectionDiagnostics.selectedSourceCharCount).toBeGreaterThan(500);
  });

  it("runs a risk secondary search when no source chunk directly matches risk factors", () => {
    const filing = {
      ...makeIntentFiling(),
      mdaText:
        "The company faces risks and uncertainties related to supply availability, competition, customer demand, regulation, export controls, inventory timing and adverse macroeconomic conditions. These risks could affect revenue, margins and operating results if they materialize. Management also notes that customer concentration and geopolitical limits can change demand patterns quickly, so investors should not treat recent growth as guaranteed.",
      sourceChunks: [
        {
          sourceId: "S1",
          sectionType: "md_a" as const,
          sectionTitle: "Item 7",
          sourceLabel: "10-K Item 7",
          text: "Revenue increased due to higher demand for cloud services across existing customers.",
          startOffset: 0,
          endOffset: 80,
          sortOrder: 1
        },
        ...makeIntentFiling().sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric")
      ]
    };
    const context = buildChatContextPack(filing, "risk_factors");

    expect(context.sourceSelectionStrategy).toContain("risk_secondary");
    expect(context.sourceChunks[0]?.sourceId).toMatch(/^CTX/);
    expect(context.sourceChunks[0]?.text).toContain("risks and uncertainties");
    expect(context.contextTokenBudget).toBeGreaterThanOrEqual(10_000);
  });

  it("prioritizes MD&A driver context before metrics for YoY follow-up questions", () => {
    const driverText =
      "Net sales increased compared with the prior year primarily due to comparable store sales growth, new store openings, and stronger customer traffic. The improvement was partially offset by higher tariff costs and freight expense, so this paragraph explains the revenue driver rather than only repeating the XBRL revenue number.";
    const filing = {
      ...makeIntentFiling(),
      mdaText: [
        "The following table sets forth selected financial data and percentages of revenue.",
        driverText,
        "Operating income changed because merchandise margin and occupancy costs moved in different directions."
      ].join(" "),
      sourceChunks: [
        {
          sourceId: "S1",
          sectionType: "md_a" as const,
          sectionTitle: "Part I, Item 2",
          sourceLabel: "10-Q Part I Item 2",
          text: "The following table sets forth selected financial data and percentages of revenue.",
          startOffset: 0,
          endOffset: 78,
          sortOrder: 1
        },
        {
          sourceId: "S2",
          sectionType: "md_a" as const,
          sectionTitle: "Part I, Item 2",
          sourceLabel: "10-Q Part I Item 2",
          text: driverText,
          startOffset: 79,
          endOffset: 79 + driverText.length,
          sortOrder: 2
        },
        ...makeIntentFiling().sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric")
      ]
    };

    const context = buildChatContextPack(filing, "yoy_change");

    expect(context.contextTokenBudget).toBeGreaterThanOrEqual(8_000);
    expect(context.sourceChunks[0]?.sourceId).toBe("S2");
    expect(context.sourceChunks[0]?.text).toContain("primarily due to comparable store sales growth");
    expect(context.sourceChunks.findIndex((chunk) => chunk.sourceId === "S2")).toBeLessThan(
      context.sourceChunks.findIndex((chunk) => chunk.sourceId === "S9")
    );
    expect(context.selectionDiagnostics.selectedSourceCharCount).toBeGreaterThan(driverText.length);
  });

  it("filters disaster risk windows out of revenue-growth context", () => {
    const riskText =
      "Natural disasters and other catastrophic events such as public health crises could affect our personnel, data centers, service providers, manufacturing vendors, and logistics providers. Climate change could increase the frequency or severity of these events, which could affect revenue timing.";
    const driverText =
      "Subscription revenue increased primarily due to new customers, expansion within existing customers, and additional module adoption on the Falcon platform. Annual recurring revenue continued to grow as customers adopted cloud security and identity protection modules.";
    const filing = {
      ...makeIntentFiling(),
      ticker: "CRWD",
      companyName: "CrowdStrike Holdings, Inc.",
      mdaText: [riskText, driverText].join(" "),
      sourceChunks: [
        {
          sourceId: "S1",
          sectionType: "md_a" as const,
          sectionTitle: "Item 7",
          sourceLabel: "10-K Item 7",
          text: riskText,
          startOffset: 0,
          endOffset: riskText.length,
          sortOrder: 1
        },
        {
          sourceId: "S2",
          sectionType: "md_a" as const,
          sectionTitle: "Item 7",
          sourceLabel: "10-K Item 7",
          text: driverText,
          startOffset: riskText.length + 1,
          endOffset: riskText.length + 1 + driverText.length,
          sortOrder: 2
        },
        ...makeIntentFiling().sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric")
      ]
    };

    const context = buildChatContextPack(filing, "yoy_change");

    expect(context.sourceChunks.map((chunk) => chunk.sourceId)).toContain("S2");
    expect(context.sourceChunks.map((chunk) => chunk.sourceId)).not.toContain("S1");
    expect(context.sourceChunks.some((chunk) => chunk.text.includes("Natural disasters"))).toBe(false);
    expect(context.sourceChunks[0]?.text).toContain("Subscription revenue increased");
  });

  it("classifies investor-style pros and cons prompts as investment_view", () => {
    expect(classifyQuestionIntent("投資家目線で良い点と悪い点は？")).toBe("investment_view");
    expect(classifyQuestionIntent("bull bearで強みと弱みを見て")).toBe("investment_view");
  });
});

function makeIntentFiling(): FilingCacheRecord {
  return {
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
        tagUsed: "Revenue",
        value: 1000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 900,
        yoyPercent: 11.1
      },
      {
        logicalName: "operatingIncome",
        tagUsed: "OperatingIncomeLoss",
        value: 180,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 150,
        yoyPercent: 20
      },
      {
        logicalName: "netIncome",
        tagUsed: "NetIncomeLoss",
        value: 120,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 100,
        yoyPercent: 20
      }
    ],
    sourceChunks: [
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Part I, Item 2",
        sourceLabel: "10-Q Part I Item 2",
        text: "Revenue increased due to higher demand for cloud services.",
        startOffset: 0,
        endOffset: 57,
        sortOrder: 1
      },
      {
        sourceId: "S3",
        sectionType: "md_a",
        sectionTitle: "Risk Factors",
        sourceLabel: "10-Q Risk Factors",
        text:
          "The company faces supply chain uncertainty and regulatory risk that could adversely affect margins, revenue timing and customer commitments. These risks include dependence on a small group of suppliers, competition for manufacturing capacity and changes in export control rules. If those conditions worsen, operating results could be materially and adversely affected.",
        startOffset: 58,
        endOffset: 390,
        sortOrder: 3
      },
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (Revenue)",
        text: "売上高: 1000 USD / 比較値: 900 / YoY: 11.1%",
        startOffset: 0,
        endOffset: 0,
        tagName: "Revenue",
        sortOrder: 9
      },
      {
        sourceId: "S10",
        sectionType: "xbrl_metric",
        sectionTitle: "営業利益",
        sourceLabel: "XBRL 営業利益 (OperatingIncomeLoss)",
        text: "営業利益: 180 USD / 比較値: 150 / YoY: 20.0%",
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
        text: "純利益: 120 USD / 比較値: 100 / YoY: 20.0%",
        startOffset: 0,
        endOffset: 0,
        tagName: "NetIncomeLoss",
        sortOrder: 11
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-14T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}
