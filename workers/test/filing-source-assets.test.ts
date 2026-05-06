import { describe, expect, it } from "vitest";
import type { FilingReference, MetricSnapshot } from "../src/env";
import { buildSourceChunks, hasStrongRevenueDriverSource } from "../src/lib/filings/ingest";
import { deriveSourceSectionFamily } from "../src/lib/chat/source-family";

describe("revenue driver source assets", () => {
  it("creates a JPM-like revenue driver source from net interest and noninterest revenue discussion", () => {
    const chunks = buildSourceChunks(filing("JPM", "JPMorgan Chase & Co."), genericMda(), [revenueMetric()], {
      revenueDriverSearchText: [
        "Total net revenue was $182.4 billion for fiscal 2025, up 3% compared with the prior year.",
        "The increase was driven by higher net interest income, noninterest income, markets revenue and investment banking fees, partially offset by lower card services revenue."
      ].join(" ")
    });

    expect(chunks[0]?.sectionTitle).toBe("Revenue driver discussion");
    expect(chunks[0]?.text).toMatch(/net interest income|noninterest income|investment banking fees/i);
    expect(hasStrongRevenueDriverSource(chunks[0]!)).toBe(true);
    expect(deriveSourceSectionFamily(chunks[0]!)).toBe("revenue_discussion");
    expect(sourceIdsAreValid(chunks)).toBe(true);
  });

  it("creates a CAT-like revenue driver source from sales volume, price realization and backlog discussion", () => {
    const chunks = buildSourceChunks(filing("CAT", "Caterpillar Inc."), genericMda(), [revenueMetric()], {
      revenueDriverSearchText:
        "Sales and revenues increased 6% in fiscal 2025 compared with the prior year, primarily due to higher sales volume and favorable price realization. Backlog and dealer inventory also supported equipment to end users in Construction Industries."
    });

    expect(chunks[0]?.sectionTitle).toBe("Revenue driver discussion");
    expect(chunks[0]?.text).toMatch(/sales volume|price realization|backlog/i);
    expect(hasStrongRevenueDriverSource(chunks[0]!)).toBe(true);
    expect(sourceIdsAreValid(chunks)).toBe(true);
  });

  it("prefers WMT current-period comparable sales evidence over generic footprint history", () => {
    const chunks = buildSourceChunks(filing("WMT", "Walmart Inc."), genericMda(), [revenueMetric()], {
      revenueDriverSearchText: [
        "We opened our first store decades ago and have a large store footprint across many markets.",
        "Net sales increased 5% in fiscal 2025 compared with last year, driven by Walmart U.S. comparable sales growth, higher traffic, improved average ticket, eCommerce growth and membership income."
      ].join("\n\n")
    });

    expect(chunks[0]?.text).toMatch(/comparable sales|traffic|eCommerce|membership/i);
    expect(chunks[0]?.text).not.toMatch(/first store|store footprint/i);
    expect(hasStrongRevenueDriverSource(chunks[0]!)).toBe(true);
  });

  it("prefers XOM period revenue evidence over broad risk and market context", () => {
    const chunks = buildSourceChunks(filing("XOM", "Exxon Mobil Corporation"), genericMda(), [revenueMetric()], {
      revenueDriverSearchText: [
        "Commodity prices may be volatile and future market conditions could reduce demand for crude oil.",
        "Sales and other operating revenue increased 4% in fiscal 2025 compared with the prior year, reflecting higher commodity prices, stronger production volumes, upstream results and improved refining margins."
      ].join("\n\n")
    });

    expect(chunks[0]?.text).toMatch(/commodity prices|production volumes|refining margins/i);
    expect(chunks[0]?.text).not.toMatch(/may be volatile/i);
    expect(hasStrongRevenueDriverSource(chunks[0]!)).toBe(true);
  });

  it("creates an energy source when current-period crude price and production impact revenue", () => {
    const chunks = buildSourceChunks(filing("XOM", "Exxon Mobil Corporation"), genericMda(), [revenueMetric()], {
      revenueDriverSearchText:
        "Sales and other operating revenue decreased 5% in fiscal 2025 compared with the prior year, primarily due to lower crude prices and weaker natural gas price realizations, partially offset by higher production volumes in upstream operations."
    });

    expect(chunks[0]?.sectionTitle).toBe("Revenue driver discussion");
    expect(chunks[0]?.text).toMatch(/crude prices|natural gas price|production volumes/i);
    expect(hasStrongRevenueDriverSource(chunks[0]!)).toBe(true);
    expect(sourceIdsAreValid(chunks)).toBe(true);
  });

  it("creates an energy source when refining and downstream margins affect current-period results", () => {
    const chunks = buildSourceChunks(filing("XOM", "Exxon Mobil Corporation"), genericMda(), [revenueMetric()], {
      revenueDriverSearchText:
        "Energy products sales and downstream earnings increased in fiscal 2025 compared with the prior year, reflecting higher refining margins and stronger refinery utilization, partly offset by lower chemical margins."
    });

    expect(chunks[0]?.sectionTitle).toBe("Revenue driver discussion");
    expect(chunks[0]?.text).toMatch(/downstream earnings|refining margins|chemical margins/i);
    expect(hasStrongRevenueDriverSource(chunks[0]!)).toBe(true);
  });

  it("does not classify long-term commodity outlook as energy revenue-driver evidence", () => {
    const chunks = buildSourceChunks(filing("XOM", "Exxon Mobil Corporation"), genericMda(), [revenueMetric()], {
      revenueDriverSearchText:
        "In 2025, crude prices remained within the 10-year historical range while robust demand helped move natural gas prices higher. ExxonMobil believes prices over the long term will continue to be driven by market supply and demand, general economic activities, technology advances, consumer preference and government policies."
    });

    expect(chunks.some(hasStrongRevenueDriverSource)).toBe(false);
    expect(chunks[0]?.sectionTitle).not.toBe("Revenue driver discussion");
  });

  it("does not classify reserves disclosure as energy revenue-driver evidence", () => {
    const chunks = buildSourceChunks(filing("XOM", "Exxon Mobil Corporation"), genericMda(), [revenueMetric()], {
      revenueDriverSearchText:
        "Proved reserves require significant funding commitments and support infrastructure. Production-sharing contract mechanics and long-term oil and gas price assumptions can affect reserve estimates but do not describe current-period revenue results."
    });

    expect(chunks.some(hasStrongRevenueDriverSource)).toBe(false);
    expect(chunks[0]?.sectionTitle).not.toBe("Revenue driver discussion");
  });

  it("does not classify Item 2 Properties as revenue driver evidence", () => {
    const chunks = buildSourceChunks(filing("JPM", "JPMorgan Chase & Co."), genericMda(), [revenueMetric()], {
      revenueDriverSearchText:
        "Item 2. Properties. JPMorgan Chase's headquarters are located in New York. Office locations and square footage are described below, and revenue information is available on the corporate website."
    });

    expect(chunks.some(hasStrongRevenueDriverSource)).toBe(false);
    expect(chunks[0]?.sectionTitle).not.toBe("Revenue driver discussion");
    expect(sourceIdsAreValid(chunks)).toBe(true);
  });

  it("keeps old MD&A/XBRL-only records compatible when no driver evidence is available", () => {
    const chunks = buildSourceChunks(filing("CAT", "Caterpillar Inc."), genericMda(), [revenueMetric()]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.sectionType === "md_a")).toBe(true);
    expect(chunks.some((chunk) => chunk.sectionType === "xbrl_metric")).toBe(true);
    expect(chunks.some(hasStrongRevenueDriverSource)).toBe(false);
    expect(sourceIdsAreValid(chunks)).toBe(true);
  });

  it("derives margin and cost source families from profitability discussion text", () => {
    const grossMarginSource = source(
      "Gross margin improved because product mix shifted toward services, partially offset by higher operating expenses."
    );
    const costSource = source(
      "Operating expenses increased due to higher SG&A, R&D, labor costs and restructuring charges.",
      "Item 7"
    );

    expect(deriveSourceSectionFamily(grossMarginSource)).toBe("margin_discussion");
    expect(deriveSourceSectionFamily(costSource)).toBe("cost_discussion");
  });

  it("derives sector-specific margin source families", () => {
    expect(
      deriveSourceSectionFamily(source("Provision for credit losses and noninterest expense affected segment profitability and efficiency ratio."))
    ).toBe("bank_profitability_discussion");
    expect(
      deriveSourceSectionFamily(source("Refining margins and chemical margins decreased, reducing downstream earnings and operating profit."))
    ).toBe("energy_margin_discussion");
    expect(
      deriveSourceSectionFamily(source("Gross margin rate increased because markdowns and shrink improved while inventory costs declined."))
    ).toBe("retail_margin_discussion");
    expect(
      deriveSourceSectionFamily(source("Segment operating profit declined as price realization was offset by higher manufacturing costs."))
    ).toBe("industrial_margin_discussion");
  });
});

function filing(ticker: string, companyName: string): FilingReference {
  return {
    cik: "0000000000",
    ticker,
    companyName,
    exchange: "NYSE",
    formType: "10-K",
    accessionNumber: "0000000000-26-000001",
    primaryDocument: "filing.htm",
    filedAt: "2026-02-01",
    periodOfReport: "2025-12-31"
  };
}

function revenueMetric(): MetricSnapshot {
  return {
    logicalName: "revenue",
    tagUsed: "Revenue",
    value: 120,
    unit: "USD",
    periodEnd: "2025-12-31",
    comparisonValue: 100,
    yoyPercent: 20
  };
}

function genericMda(): string {
  return "Management discusses results of operations and financial condition. The company operates through reportable segments and monitors demand across markets.";
}

function sourceIdsAreValid(chunks: { sourceId: string }[]): boolean {
  const ids = chunks.map((chunk) => chunk.sourceId);
  return ids.length === new Set(ids).size && ids.every((id, index) => id === `S${index + 1}`);
}

function source(text: string, sectionTitle = "Profitability context") {
  return {
    sourceId: "S1",
    sectionType: "md_a" as const,
    sectionTitle,
    sourceLabel: `10-K ${sectionTitle}`,
    text,
    startOffset: 0,
    endOffset: text.length,
    sortOrder: 1
  };
}
