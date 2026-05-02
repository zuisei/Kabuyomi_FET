import { describe, expect, it } from "vitest";
import { generateChatAnswer } from "../src/clients/gemini";
import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../src/env";
import { formatMetricValue } from "../src/lib/metrics";

describe("non-hard deterministic fallback cleanup", () => {
  it("names missing liquidity and debt sources without saying there is no concern", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "資金繰りや負債に懸念はある？",
      questionIntent: "cash_flow",
      filing: makeFiling({
        ticker: "NET",
        companyName: "Cloudflare, Inc.",
        metrics: [metric("operatingCashFlow", 100, 50, 100)],
        sources: [
          xbrl("S1", "営業キャッシュフロー", "営業CF: 100 USD / 比較値: 50 / YoY: 100.0%"),
          md("S2", "Risk Factors", "Forward-looking statements and general risk factors may affect the company.")
        ]
      })
    });

    expect(response.answer).toContain("Balance Sheet");
    expect(response.answer).toContain("Debt Note");
    expect(response.answer).toContain("Liquidity MD&A");
    expect(response.answer).toContain("Cash Flow Statement");
    expect(response.answer).toContain("懸念の有無は断定しません");
    expect(response.answer).not.toContain("懸念はありません");
  });

  it("keeps irrelevant risk snippets from becoming a risk summary", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "この filing で重要なリスクは？",
      questionIntent: "risk_factors",
      filing: makeFiling({
        sources: [
          md("S1", "Accounting Policy", "Critical accounting estimates and recently issued financial reporting standards.")
        ]
      })
    });

    expect(response.answer).toContain("filing固有の重要リスクを十分に絞れません");
    expect(response.answer).toContain("リスク要因セクション");
    expect(response.answer).toContain("MD&Aのリスク説明");
    expect(response.answer).not.toContain("景気や需要の不確実性");
  });

  it("returns source/KPI watch points when concrete drivers are missing", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "次回決算で見るべきポイントを3つに絞って",
      questionIntent: "mda_summary",
      filing: makeFiling({
        metrics: [metric("revenue", 120, 100, 20)],
        sources: [xbrl("S1", "売上高", "売上高: 120 USD / 比較値: 100 / YoY: 20.0%")]
      })
    });

    expect(response.answer).toContain("1) セグメント別実績");
    expect(response.answer).toContain("2) 売上driverの説明");
    expect(response.answer).toContain("3) 資金繰りまたはリスクの説明");
    expect(response.answer).toContain("具体的なdriverはこのsourceだけでは特定しません");
  });

  it("does not explain business model from revenue metrics only", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "この会社は何で儲けている？",
      questionIntent: "business_overview",
      filing: makeFiling({
        metrics: [metric("revenue", 120, 100, 20)],
        sources: [xbrl("S1", "売上高", "売上高: 120 USD / 比較値: 100 / YoY: 20.0%")]
      })
    });

    expect(response.answer).toContain("事業内容や収益内訳");
    expect(response.answer).toContain("Business");
    expect(response.answer).toContain("Segment Information");
    expect(response.answer).toContain("Revenue Note");
    expect(response.answer).not.toContain("儲けています");
  });

  it("formats USD amounts consistently in Japanese fallback units", () => {
    expect(formatMetricValue(2_900_000_000, "USD")).toBe("29億ドル");
    expect(formatMetricValue(1_040_000_000, "USD")).toBe("10.4億ドル");
    expect(formatMetricValue(443_300_000, "USD")).toBe("4.4億ドル");
    expect(formatMetricValue(79_200_000, "USD")).toBe("79.2百万ドル");
  });

  it("does not answer segment strength from company-level revenue only", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "どのセグメントや地域が伸びた？弱かった部分は？",
      questionIntent: "segment_analysis",
      filing: makeFiling({
        metrics: [metric("revenue", 120, 100, 20)],
        sources: [xbrl("S1", "売上高", "売上高: 120 USD / 比較値: 100 / YoY: 20.0%")]
      })
    });

    expect(response.answer).toContain("全社売上の増減は確認できます");
    expect(response.answer).toContain("セグメント・地域別の強弱");
    expect(response.answer).toContain("Segment results");
    expect(response.answer).toContain("Geographic revenue");
    expect(response.answer).toContain("Product/category revenue");
  });

  it("does not treat margin movement as a margin driver", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "利益率が改善、または悪化した理由は？",
      questionIntent: "margin_profitability",
      filing: makeFiling({
        metrics: [metric("operatingIncome", 90, 100, -10)],
        sources: [xbrl("S1", "営業利益", "営業利益: 90 USD / 比較値: 100 / YoY: -10.0%")]
      })
    });

    expect(response.answer).toContain("利益率の方向は確認できます");
    expect(response.answer).toContain("具体的なdriverは十分に特定できません");
    expect(response.answer).toContain("コスト");
    expect(response.answer).toContain("segment margin");
  });

  it("does not treat YoY as previous filing comparison", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "前回決算との差は？",
      questionIntent: "historical_comparison",
      filing: makeFiling({
        metrics: [metric("revenue", 120, 100, 20)],
        sources: [xbrl("S1", "売上高", "売上高: 120 USD / 比較値: 100 / YoY: 20.0%")]
      })
    });

    expect(response.answer).toContain("前年同期比の増減は確認できます");
    expect(response.answer).toContain("previous filing evidence");
    expect(response.answer).not.toContain("前回決算との差は20.0%");
  });

  it("does not use retail checklist terms for biotech revenue-driver fallback", async () => {
    const response = await generateChatAnswer({} as never, {
      question: "売上成長、または減収の主な要因は？",
      questionIntent: "yoy_change",
      filing: makeFiling({
        ticker: "ALNY",
        companyName: "Alnylam Pharmaceuticals, Inc.",
        metrics: [metric("revenue", 1_250_000_000, 501_000_000, 149.3)],
        sources: [
          xbrl("S1", "売上高", "売上高: 1250000000 USD / 比較値: 501000000 / YoY: 149.3%"),
          md("S2", "Revenue context", "The company develops RNAi therapeutics and earns product and collaboration revenue from pharmaceutical products.")
        ]
      })
    });

    expect(response.answer).not.toContain("既存店");
    expect(response.answer).not.toContain("traffic");
    expect(response.answer).not.toContain("ticket");
    expect(response.answer).toMatch(/製品別売上|提携収入|ロイヤリティ|売上driver|会社固有/);
  });
});

function makeFiling({
  ticker = "TEST",
  companyName = "Test Corp",
  metrics = [],
  sources = []
}: {
  ticker?: string;
  companyName?: string;
  metrics?: MetricSnapshot[];
  sources?: SourceChunkRecord[];
}): FilingCacheRecord {
  return {
    filingKey: `v1:${ticker}:test`,
    ticker,
    companyName,
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: sources.map((source) => source.text).join("\n"),
    mdaTokenCount: 0,
    metrics,
    sourceChunks: sources,
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}

function metric(logicalName: MetricSnapshot["logicalName"], value: number, comparisonValue: number, yoyPercent: number): MetricSnapshot {
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

function xbrl(sourceId: string, label: string, text: string): SourceChunkRecord {
  return {
    sourceId,
    sectionType: "xbrl_metric",
    sectionTitle: label,
    sourceLabel: `XBRL ${label}`,
    text,
    startOffset: 0,
    endOffset: 0,
    tagName: label,
    sortOrder: Number(sourceId.replace(/\D/g, "")) || 1
  };
}

function md(sourceId: string, label: string, text: string): SourceChunkRecord {
  return {
    sourceId,
    sectionType: "md_a",
    sectionTitle: label,
    sourceLabel: label,
    text,
    startOffset: 0,
    endOffset: text.length,
    sortOrder: Number(sourceId.replace(/\D/g, "")) || 1
  };
}
