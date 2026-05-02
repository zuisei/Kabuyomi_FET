import { describe, expect, it } from "vitest";
import type { Env, FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../src/env";
import { buildEvidenceFallbackAnswer, hasBannedPhrase, joinMissingSourceLabels } from "../src/lib/chat/evidence-fallback";
import { extractEvidenceSlots } from "../src/lib/chat/evidence-slots";
import { buildValidatedModelAnswer } from "../src/lib/chat/model-attempt";
import { evaluateSourceGate } from "../src/lib/chat/source-gate";
import { createChatTimingTracker } from "../src/lib/chat/timing";

describe("hard-intent source gate", () => {
  it("rejects JPM-Q03-like revenue driver when only revenue movement is selected", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [revenueMetric(182_447_000_000, 177_556_000_000, 2.8)], [
      metricSource("S9", "売上高: 182447000000 USD / 比較値: 177556000000 / YoY: 2.8%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceGateApplied).toBe(true);
    expect(result.sourceSufficient).toBe(false);
    expect(result.failureLabels).toEqual(expect.arrayContaining([
      "source_gate_failed",
      "sector_required_source_missing",
      "driver_slots_empty"
    ]));
    expect(result.missingSourceTypes).toEqual(expect.arrayContaining([
      "net interest income discussion",
      "noninterest income discussion",
      "provision for credit losses discussion",
      "segment results"
    ]));
  });

  it("rejects JPM-Q06-like margin durability when the prior answer only calculated movement", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [
      metric("netIncome", 57_000_000_000, 58_000_000_000, -1.7)
    ], [
      metricSource("S12", "純利益: 57000000000 USD / 比較値: 58000000000 / YoY: -1.7%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "margin_profitability",
      question: "これは一時要因？それとも構造的な変化？",
      previousAnswer: "純利益率は32.9%から31.3%へ低下しています。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.followupTargetFound).toBe(false);
    expect(result.failureLabels).toContain("margin_driver_slots_empty");
    expect(result.missingSourceTypes).toEqual(expect.arrayContaining([
      "provision for credit losses discussion",
      "noninterest expense discussion",
      "segment profitability"
    ]));
  });

  it("uses industrial missing-source requirements for CAT-Q06-like margin durability", () => {
    const filing = makeFiling("CAT", "Caterpillar Inc.", [
      metric("operatingIncome", 12_000_000_000, 13_000_000_000, -7.7)
    ], [
      metricSource("S12", "営業利益: 12000000000 USD / 比較値: 13000000000 / YoY: -7.7%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "margin_profitability",
      question: "これは一時要因？それとも構造的な変化？",
      previousAnswer: "営業利益率は低下しています。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.missingSourceTypes.join(" ")).toMatch(/price-cost spread|manufacturing cost|SG&A\/R&D|segment margin/);
  });

  it("does not treat generic CAT demand text as a margin driver", () => {
    const filing = makeFiling("CAT", "Caterpillar Inc.", [
      metric("operatingIncome", 11_151_000_000, 13_072_000_000, -14.7)
    ], [
      metricSource("S12", "営業利益: 11151000000 USD / 比較値: 13072000000 / YoY: -14.7%"),
      source("S4", "md_a", "The nature of customer demand for construction machinery varies around the world. Customers in developing economies often prioritize purchase price in making their investment decisions.")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "margin_profitability",
      question: "これは一時要因？それとも構造的な変化？",
      previousAnswer: "営業利益率は20.2%から16.5%へ低下しています。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.followupTargetFound).toBe(false);
    expect(result.identifiedDrivers).toHaveLength(0);
    expect(result.failureLabels).toContain("margin_driver_slots_empty");
  });

  it("rejects raw English risk fragments as margin driver evidence", () => {
    const filing = makeFiling("KLAC", "KLA Corporation", [
      metric("operatingIncome", 1_200_000_000, 1_300_000_000, -7.7)
    ], [
      metricSource("S12", "営業利益: 1200000000 USD / 比較値: 1300000000 / YoY: -7.7%"),
      source("S4", "md_a", "s; • Risks related to tax and regulatory compliance audits; • Any change in t...")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "margin_profitability",
      question: "これは一時要因？それとも構造的な変化？",
      previousAnswer: "営業利益率は低下しています。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });
    const slots = extractEvidenceSlots({ filing, sources: filing.sourceChunks, sourceGateResult: result });

    expect(result.sourceSufficient).toBe(false);
    expect(slots.marginDrivers).toHaveLength(0);
    expect(slots.failureLabels).toEqual(expect.arrayContaining(["margin_driver_slots_empty"]));
  });

  it("does not treat raw English previous answers as follow-up targets", () => {
    const filing = makeFiling("MS", "Morgan Stanley", [revenueMetric(10_000_000_000, 9_000_000_000, 11.1)], [
      source("S4", "md_a", "Operating within the financial services industry on a global basis presents, among other things, significant risks...")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "その要因は一時的？それとも続きそう？",
      previousAnswer: "前問のdriverは、Operating within the financial services industry on a global basis presents, ...です。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.followupTargetFound).toBe(false);
    expect(result.sourceSufficient).toBe(false);
    expect(result.failureLabels).toEqual(expect.arrayContaining(["followup_target_empty", "driver_slots_empty"]));
  });

  it("classifies WMT as retail, not bank", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [revenueMetric(680_000_000_000, 660_000_000_000, 3.0)], [
      metricSource("S9", "売上高: 680000000000 USD / 比較値: 660000000000 / YoY: 3.0%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.missingSourceTypes).toEqual(expect.arrayContaining([
      "comparable sales discussion",
      "traffic and ticket discussion",
      "eCommerce discussion"
    ]));
    expect(result.missingSourceTypes.join(" ")).not.toMatch(/net interest|noninterest|provision/);
  });

  it("accepts AAPL product-launch context only when the excerpt supports it", () => {
    const filing = makeFiling("AAPL", "Apple Inc.", [revenueMetric(100_000_000_000, 95_000_000_000, 5.3)], [
      source("S3", "md_a", "Net sales increased due to product launches and higher Services revenue across geographic segments."),
      metricSource("S9", "売上高: 100000000000 USD / 比較値: 95000000000 / YoY: 5.3%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(true);
    expect(result.identifiedDrivers.length).toBeGreaterThan(0);
  });
});

describe("evidence-slot fallback", () => {
  it("uses the shared USD amount formatter for evidence-slot metric movement", () => {
    const cases: Array<[number, string]> = [
      [2_900_000_000, "29億ドル"],
      [1_040_000_000, "10.4億ドル"],
      [443_300_000, "4.4億ドル"],
      [79_200_000, "79.2百万ドル"]
    ];

    for (const [value, expected] of cases) {
      const filing = makeFiling("SWKS", "Skyworks Solutions, Inc.", [revenueMetric(value, value - 1_000_000, 1.2)], [
        metricSource("S9", `売上高: ${value} USD / 比較値: ${value - 1_000_000} / YoY: 1.2%`)
      ]);
      const gate = evaluateSourceGate({
        ticker: filing.ticker,
        companyName: filing.companyName,
        questionIntent: "yoy_change",
        question: "売上成長の主な要因は？",
        selectedSources: filing.sourceChunks,
        metrics: filing.metrics
      });
      const slots = extractEvidenceSlots({ filing, sources: filing.sourceChunks, sourceGateResult: gate });
      expect(slots.confirmedMetricMovement?.currentValue).toBe(expected);
    }
  });

  it("dedupes missing source labels before rendering evidence fallback text", () => {
    const rendered = joinMissingSourceLabels([
      "MD&A",
      "MD&A driver discussion",
      "segment results",
      "revenue discussion",
      "MD&A revenue discussion",
      "profitability discussion"
    ]);

    expect(rendered).toBe("MD&A、segment results、revenue discussion、profitability discussion");
    expect(rendered).not.toContain("MD&AとMD&A");
  });

  it("generates a safe JPM evidence fallback without inventing drivers", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [revenueMetric(182_447_000_000, 177_556_000_000, 2.8)], [
      metricSource("S9", "売上高: 182447000000 USD / 比較値: 177556000000 / YoY: 2.8%")
    ]);
    const gate = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });
    const slots = extractEvidenceSlots({ filing, sources: filing.sourceChunks, sourceGateResult: gate });
    const fallback = buildEvidenceFallbackAnswer({
      sourceGateResult: gate,
      evidenceSlots: slots,
      selectedSources: filing.sourceChunks,
      fallbackReason: "low_quality_answer"
    });

    expect(fallback.answer.answer).toContain("売上高は");
    expect(fallback.answer.answer).toContain("net interest income");
    expect(fallback.answer.answer).toContain("noninterest income");
    expect(fallback.answer.answer).toContain("provision");
    expect(fallback.answer.answer).toContain("segment results");
    expect(fallback.answer.answer).toContain("会社固有の売上driverは十分に特定できていません");
    expect(fallback.answer.answer).not.toContain("MD&AとMD&A");
    expect(fallback.answer.answer).not.toContain("主因はnet interest income");
    expect(hasBannedPhrase(fallback.answer.answer)).toBe(false);
  });

  it("keeps banned generic phrases out of generated evidence fallback", () => {
    const badPhrases = [
      "本文に説明があります",
      "本文全体と数字を並べると見えてきます",
      "本文の要因説明と並べると判断しやすくなります",
      "価格、数量、需要、コスト、mixを見るべきです"
    ];

    for (const phrase of badPhrases) {
      expect(hasBannedPhrase(phrase)).toBe(true);
    }
  });

  it("returns evidence fallback from the runtime path for source-insufficient hard intents", async () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [revenueMetric(182_447_000_000, 177_556_000_000, 2.8)], [
      metricSource("S9", "売上高: 182447000000 USD / 比較値: 177556000000 / YoY: 2.8%")
    ]);

    const result = await buildValidatedModelAnswer({
      filing,
      question: "売上成長の主な要因は？",
      env: {} as Env,
      questionIntent: "yoy_change",
      timings: createChatTimingTracker()
    });

    expect(result.modelResponse.qualityControl?.sourceGateApplied).toBe(true);
    expect(result.modelResponse.qualityControl?.sourceGateSufficient).toBe(false);
    expect(result.modelResponse.qualityControl?.evidenceFallbackUsed).toBe(true);
    expect(result.modelResponse.qualityControl?.fallbackKind).toBe("evidence_slot");
    expect(result.modelResponse.retryDiagnostics?.retryAttempted).toBe(false);
    expect(result.modelResponse.answer).toContain("会社固有の売上driverは十分に特定できていません");
  });

  it("does not apply the source gate to non-hard intents", async () => {
    const filing = makeFiling("AAPL", "Apple Inc.", [], [
      source("S1", "md_a", "Apple designs and sells products and services.")
    ]);

    const result = await buildValidatedModelAnswer({
      filing,
      question: "何の会社？",
      env: {} as Env,
      questionIntent: "business_overview",
      timings: createChatTimingTracker()
    });

    expect(result.modelResponse.qualityControl?.sourceGateApplied).toBeUndefined();
  });
});

function revenueMetric(value: number, comparisonValue: number, yoyPercent: number): MetricSnapshot {
  return metric("revenue", value, comparisonValue, yoyPercent);
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
