import { describe, expect, it } from "vitest";
import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../src/env";
import { buildChatContextPack } from "../src/lib/chat/context-pack";
import {
  analyzeHardIntentSourceCoverage,
  applyHardIntentRetrievalPlan,
  buildHardIntentRetrievalPlan,
  resolveHardIntentRetrievalMode
} from "../src/lib/chat/hard-intent-retrieval";
import { evaluateSourceGate, normalizeSector, type SourceGateSector } from "../src/lib/chat/source-gate";

describe("hard-intent targeted retrieval query builder", () => {
  const cases: Array<[string, string, SourceGateSector, RegExp]> = [
    ["JPM", "JPMorgan Chase & Co.", "bank", /net interest income.*noninterest income|provision for credit losses/],
    ["MS", "Morgan Stanley", "capital_markets", /investment banking|trading|wealth management/],
    ["WMT", "Walmart Inc.", "retail", /comparable sales|traffic|ticket|eCommerce/],
    ["XOM", "Exxon Mobil Corporation", "energy", /commodity prices|production volumes|upstream|refining/],
    ["HAL", "Halliburton Company", "oilfield_services", /drilling activity|completion activity|oilfield services/],
    ["DE", "Deere & Company", "industrial", /price realization|sales volume|backlog|dealer inventory/],
    ["NET", "Cloudflare, Inc.", "software", /subscription revenue|usage|RPO|deferred revenue/],
    ["KLAC", "KLA Corporation", "semiconductor_equipment", /orders|backlog|wafer fab equipment/],
    ["ISRG", "Intuitive Surgical, Inc.", "healthcare_medtech", /procedure volume|installed base|systems placements/],
    ["VTR", "Ventas, Inc.", "reit", /occupancy|NOI|same-store/],
    ["FOXA", "Fox Corporation", "media", /advertising revenue|affiliate revenue|retransmission/],
    ["AEP", "American Electric Power Company, Inc.", "utility", /rate case|regulated returns|fuel cost|load growth/],
    ["FCX", "Freeport-McMoRan Inc.", "mining", /copper price|production volume|unit costs/]
  ];

  for (const [ticker, companyName, sector, expected] of cases) {
    it(`builds sector-specific revenue-driver queries for ${ticker}`, () => {
      const gate = insufficientGate(ticker, companyName);
      const plan = buildHardIntentRetrievalPlan({
        ticker,
        companyName,
        sector,
        questionIntent: "yoy_change",
        question: "売上成長、または減収の主な要因は？",
        sourceGateResult: gate,
        sourceGateMissingSourceTypes: gate.missingSourceTypes
      });

      expect(plan.shouldRetryRetrieval).toBe(true);
      expect(plan.queries.length).toBeLessThanOrEqual(3);
      expect(plan.queries.map((query) => query.query).join(" ")).toMatch(expected);
    });
  }

  it("maps missing source types into sector-aware query terms", () => {
    const gate = {
      ...insufficientGate("WMT", "Walmart Inc."),
      missingSourceTypes: ["segment results", "comparable sales discussion"]
    };
    const retailPlan = buildHardIntentRetrievalPlan({
      ticker: "WMT",
      companyName: "Walmart Inc.",
      sector: "retail",
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      sourceGateResult: gate,
      sourceGateMissingSourceTypes: gate.missingSourceTypes
    });

    const text = retailPlan.queries.map((query) => query.query).join(" ");
    expect(text).toMatch(/segment results|comparable sales|traffic|ticket/);
    expect(text).not.toMatch(/net interest income|provision for credit losses/);
  });

  it("keeps hard-intent retrieval to one bounded plan", () => {
    const gate = insufficientGate("JPM", "JPMorgan Chase & Co.");
    const plan = buildHardIntentRetrievalPlan({
      ticker: "JPM",
      companyName: "JPMorgan Chase & Co.",
      sector: "bank",
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      sourceGateResult: gate,
      sourceGateMissingSourceTypes: gate.missingSourceTypes
    });

    expect(plan.queries.length).toBeLessThanOrEqual(3);
    expect(plan.maxExtraSources).toBe(3);
    expect(plan.maxExtraChars).toBe(3000);
  });
});

describe("hard-intent targeted retrieval source selection", () => {
  it("adds MD&A revenue driver evidence ahead of XBRL-only context", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [
      metric("revenue", 182_447_000_000, 177_556_000_000, 2.8)
    ], [
      metricSource("S9", "売上高: 182447000000 USD / 比較値: 177556000000 / YoY: 2.8%"),
      source("S1", "md_a", "Item 1A Risk Factors. Operating within the financial services industry presents risks."),
      source("S2", "md_a", "Revenue increased primarily due to higher net interest income and noninterest income, partially offset by provision for credit losses. Segment results improved in Consumer & Community Banking.")
    ]);
    const basePack = buildChatContextPack(filing, "yoy_change");
    const gate = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      selectedSources: [filing.sourceChunks[0]],
      metrics: filing.metrics
    });
    const plan = buildHardIntentRetrievalPlan({
      ticker: filing.ticker,
      companyName: filing.companyName,
      sector: normalizeSector(null, filing.ticker, filing.companyName),
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      sourceGateResult: gate,
      sourceGateMissingSourceTypes: gate.missingSourceTypes,
      selectedSourceLabels: basePack.sourceChunks.map((source) => source.sourceLabel),
      selectedSourceIds: basePack.sourceChunks.map((source) => source.sourceId),
      selectedSources: basePack.sourceChunks
    });

    const result = applyHardIntentRetrievalPlan(filing, {
      ...basePack,
      sourceChunks: [filing.sourceChunks[0]]
    }, plan, "revenue_driver");

    expect(result.outcome).toBe("improved");
    expect(result.addedSources.map((source) => source.sourceId)).toContain("S2");
    expect(result.addedSources.map((source) => source.sourceId)).not.toContain("S1");
    expect(result.contextPack.sourceChunks[0].sourceId).toBe("S2");
  });

  it("preserves evidence fallback path when targeted retrieval cannot add sufficient sources", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [
      metric("revenue", 182_447_000_000, 177_556_000_000, 2.8)
    ], [
      metricSource("S9", "売上高: 182447000000 USD / 比較値: 177556000000 / YoY: 2.8%"),
      source("S1", "md_a", "Item 1A Risk Factors. Operating within the financial services industry presents risks.")
    ]);
    const basePack = buildChatContextPack(filing, "yoy_change");
    const gate = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      selectedSources: basePack.sourceChunks,
      metrics: filing.metrics
    });
    const plan = buildHardIntentRetrievalPlan({
      ticker: filing.ticker,
      companyName: filing.companyName,
      sector: "bank",
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      sourceGateResult: gate,
      sourceGateMissingSourceTypes: gate.missingSourceTypes
    });

    const result = applyHardIntentRetrievalPlan(filing, basePack, plan, "revenue_driver");
    const secondGate = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      selectedSources: result.contextPack.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.outcome).toBe("no_improvement");
    expect(secondGate.sourceSufficient).toBe(false);
    expect(secondGate.failureLabels).toContain("source_gate_failed");
  });
});

describe("hard-intent retrieval mode and source coverage diagnostics", () => {
  it("normalizes retrieval modes and defaults to diagnostic", () => {
    expect(resolveHardIntentRetrievalMode("off")).toBe("off");
    expect(resolveHardIntentRetrievalMode("diagnostic")).toBe("diagnostic");
    expect(resolveHardIntentRetrievalMode("active")).toBe("active");
    expect(resolveHardIntentRetrievalMode(undefined)).toBe("diagnostic");
    expect(resolveHardIntentRetrievalMode("unknown")).toBe("diagnostic");
  });

  it("detects bank sector KPI coverage", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [], [
      source("S2", "md_a", "Management's discussion of results of operations said net interest income and noninterest income increased. Provision for credit losses and deposits were discussed in segment results.")
    ]);
    const coverage = analyzeHardIntentSourceCoverage({
      filing,
      sector: "bank",
      questionIntent: "yoy_change",
      sourceGateMissingSourceTypes: ["net interest income discussion", "segment results"],
      selectedSourceIds: ["S2"],
      selectedSourceLabels: ["10-K Item 7 S2"]
    });

    expect(coverage.hasMdaRevenueDiscussion).toBe(false);
    expect(coverage.hasSegmentResults).toBe(true);
    expect(coverage.hasSectorKpiWindow).toBe(true);
    expect(coverage.sectorKpiHits).toEqual(expect.arrayContaining(["net interest income", "noninterest income", "provision", "deposits", "segment results"]));
  });

  it("marks XBRL-only source pools as low coverage", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [metric("revenue", 100, 90, 11.1)], [
      metricSource("S9", "売上高: 100 USD / 比較値: 90 / YoY: 11.1%")
    ]);
    const coverage = analyzeHardIntentSourceCoverage({
      filing,
      sector: "retail",
      questionIntent: "yoy_change",
      sourceGateMissingSourceTypes: ["comparable sales discussion", "segment results"],
      selectedSourceIds: ["S9"],
      selectedSourceLabels: ["XBRL S9"]
    });

    expect(coverage.coverageScore).toBeLessThan(45);
    expect(coverage.hasSectorKpiWindow).toBe(false);
    expect(coverage.missingCoverage).toEqual(expect.arrayContaining(["MD&A revenue discussion", "segment results", "retail sector KPI window"]));
  });

  it("does not count generic risk text as sector KPI coverage", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [], [
      source("S1", "md_a", "Item 1A Risk Factors. Our business is subject to economic conditions, competition and regulatory risks.")
    ]);
    const coverage = analyzeHardIntentSourceCoverage({
      filing,
      sector: "retail",
      questionIntent: "yoy_change",
      sourceGateMissingSourceTypes: ["comparable sales discussion"],
      selectedSourceIds: ["S1"],
      selectedSourceLabels: ["10-K Risk S1"]
    });

    expect(coverage.hasRiskFactorsWindow).toBe(true);
    expect(coverage.hasSectorKpiWindow).toBe(false);
    expect(coverage.sectorKpiHits).toHaveLength(0);
  });
});

function insufficientGate(ticker: string, companyName: string) {
  const filing = makeFiling(ticker, companyName, [metric("revenue", 100, 90, 11.1)], [
    metricSource("S9", "売上高: 100 USD / 比較値: 90 / YoY: 11.1%")
  ]);
  return evaluateSourceGate({
    ticker,
    companyName,
    questionIntent: "yoy_change",
    question: "売上成長の主な要因は？",
    selectedSources: filing.sourceChunks,
    metrics: filing.metrics
  });
}

function metric(
  logicalName: MetricSnapshot["logicalName"],
  value: number,
  comparisonValue: number,
  yoyPercent: number
): MetricSnapshot {
  return {
    logicalName,
    tagUsed: logicalName,
    value,
    unit: "USD",
    periodEnd: "2025-12-31",
    comparisonValue,
    yoyPercent
  };
}

function metricSource(sourceId: string, text: string): SourceChunkRecord {
  return source(sourceId, "xbrl_metric", text);
}

function source(sourceId: string, sectionType: SourceChunkRecord["sectionType"], text: string): SourceChunkRecord {
  return {
    sourceId,
    sectionType,
    sectionTitle: sectionType === "xbrl_metric" ? "XBRL" : "Item 7",
    sourceLabel: sectionType === "xbrl_metric" ? `XBRL ${sourceId}` : `10-K Item 7 ${sourceId}`,
    text,
    startOffset: 0,
    endOffset: text.length,
    sortOrder: Number(sourceId.replace(/\D/g, "")) || 1
  };
}

function makeFiling(
  ticker: string,
  companyName: string,
  metrics: MetricSnapshot[],
  sourceChunks: SourceChunkRecord[]
): FilingCacheRecord {
  return {
    filingKey: `v1:0000000000:${ticker}`,
    ticker,
    companyName,
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/filing",
    mdaText: "",
    mdaTokenCount: 0,
    metrics,
    sourceChunks,
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}
