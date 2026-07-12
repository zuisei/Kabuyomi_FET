import { describe, expect, it } from "vitest";
import { buildFinancialDisplayValues, canonicalValueFromDisplay, preferredFinancialDisplay } from "../src/lib/financial-number-format";
import { extractMaterialNumericClaims } from "../src/lib/chat/material-numeric-claims";
import { validateNumericAlignment } from "../src/lib/chat/numeric-alignment";
import { buildVerifiedFinancialFacts } from "../src/lib/chat/verified-financial-facts";
import type { FilingCacheRecord } from "../src/env";

function filing(): FilingCacheRecord {
  return {
    filingKey: "v6:aapl:q1", ticker: "AAPL", companyName: "Apple Inc.", cik: "0000320193",
    formType: "10-Q", filedAt: "2026-01-30", periodOfReport: "2025-12-27",
    primaryDocumentUrl: "https://www.sec.gov/Archives/aapl.htm", mdaText: "", mdaTokenCount: 0,
    metrics: [
      { logicalName: "revenue", tagUsed: "Revenue", value: 143_756_000_000, comparisonValue: 124_300_000_000,
        unit: "USD", periodStart: "2025-09-28", periodEnd: "2025-12-27", comparisonPeriodEnd: "2024-12-28", periodKind: "quarter" },
      { logicalName: "netIncome", tagUsed: "NetIncomeLoss", value: -3_848_000_000, comparisonValue: 2_965_000_000,
        unit: "USD", periodStart: "2025-09-28", periodEnd: "2025-12-27", comparisonPeriodEnd: "2024-12-28", periodKind: "quarter" },
      { logicalName: "epsBasic", tagUsed: "EarningsPerShareBasic", value: 2.18, comparisonValue: 1.64,
        unit: "USD/shares", periodStart: "2025-09-28", periodEnd: "2025-12-27", comparisonPeriodEnd: "2024-12-28", periodKind: "quarter" }
    ],
    sourceChunks: [
      { sourceId: "S1", sectionType: "xbrl_metric", sectionTitle: "Revenue", sourceLabel: "XBRL Revenue",
        text: "Revenue 143756000000 USD", startOffset: 0, endOffset: 30, tagName: "Revenue", sortOrder: 1 },
      { sourceId: "S2", sectionType: "xbrl_metric", sectionTitle: "Net income", sourceLabel: "XBRL Net income",
        text: "Net income -3848000000 USD", startOffset: 31, endOffset: 60, tagName: "NetIncomeLoss", sortOrder: 2 },
      { sourceId: "S3", sectionType: "xbrl_metric", sectionTitle: "EPS", sourceLabel: "XBRL EPS",
        text: "EPS 2.18 USD/shares", startOffset: 61, endOffset: 82, tagName: "EarningsPerShareBasic", sortOrder: 3 }
    ],
    summary: { verdict: "", highlights: [], changes: [] }, generatedAt: "2026-01-30T00:00:00Z",
    extractorVersion: "v6", promptVersion: "v1"
  };
}

describe("verified financial numeric alignment", () => {
  it("centralizes million, billion, and oku conversions with deterministic aliases", () => {
    const displays = buildFinancialDisplayValues(143_756_000_000, "USD");
    expect(displays.find((item) => item.displayUnit === "million")?.value).toBe(143_756);
    expect(displays.find((item) => item.displayUnit === "billion")?.value).toBe(143.756);
    expect(displays.find((item) => item.displayUnit === "oku")?.aliases).toContain("1,437.56億ドル");
    expect(preferredFinancialDisplay(143_756_000_000, "USD").ja).toBe("1,437.6億ドル");
    expect(canonicalValueFromDisplay(1_437.56, "oku")).toBe(143_756_000_000);
  });

  it("permanently repairs the r54 AAPL Q05 tenfold magnitude error", () => {
    const facts = buildVerifiedFinancialFacts(filing());
    const result = validateNumericAlignment({ answer: "売上高は143.8億ドルです。", facts, citedSourceIds: ["S1"] });
    expect(result.status).toBe("repaired");
    expect(result.answer).toContain("売上高は1,437.6億ドル");
    expect(result.labels).toContain("unit_mismatch");
  });

  it("handles negative parentheses and percentage direction", () => {
    const claims = extractMaterialNumericClaims("純損失は(38.48億ドル)、前年同期比229.8%減です。");
    expect(claims[0]).toMatchObject({ negative: true, semanticLabel: "netIncome" });
    expect(claims[0]?.canonicalValue).toBeCloseTo(-3_848_000_000, 2);
    expect(claims[1]).toMatchObject({ canonicalValue: -229.8, negative: true });
  });

  it("repairs current/prior swaps and blocks unsupported material numbers", () => {
    const facts = buildVerifiedFinancialFacts(filing());
    const swapped = validateNumericAlignment({
      answer: "当期の売上高は1,243億ドルです。", facts, citedSourceIds: ["S1"]
    });
    expect(swapped.status).toBe("repaired");
    expect(swapped.labels).toContain("period_mismatch");
    const unsupported = validateNumericAlignment({
      answer: "営業利益は999億ドルです。", facts, citedSourceIds: ["S1"]
    });
    expect(unsupported.status).toBe("blocked");
    expect(unsupported.labels).toContain("unsupported_numeric_claim");
  });

  it("keeps quarter and annual facts distinct", () => {
    const base = filing();
    const annual = buildVerifiedFinancialFacts({ ...base, formType: "10-K", periodOfReport: "2025-09-27",
      metrics: base.metrics.map((metric) => ({ ...metric, periodKind: "annual" as const, periodEnd: "2025-09-27" })) });
    const result = validateNumericAlignment({ answer: "当四半期の売上高は1,437.6億ドルです。", facts: annual, citedSourceIds: ["S1"] });
    expect(result.status).toBe("repaired");
    expect(result.labels).toContain("period_mismatch");
  });

  it("extracts bare EPS/share/ratio claims and does not let them bypass alignment", () => {
    const claims = extractMaterialNumericClaims("EPSは21.8、発行済株式数は1.2 billion shares、PERは25倍です。");
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "number", semanticLabel: "epsBasic", canonicalValue: 21.8, unit: "number/shares" }),
      expect.objectContaining({ kind: "number", semanticLabel: "sharesOutstanding", canonicalValue: 1_200_000_000, unit: "shares" }),
      expect.objectContaining({ kind: "number", semanticLabel: "priceEarningsRatio", canonicalValue: 25, unit: "ratio" })
    ]));

    const result = validateNumericAlignment({
      answer: "EPSは21.8です。",
      facts: buildVerifiedFinancialFacts(filing()),
      citedSourceIds: ["S3"]
    });
    expect(result.status).toBe("blocked");
    expect(result.labels).toContain("material_numeric_error");
  });

  it("keeps margin semantics distinct from income and repairs currency mismatches", () => {
    const margin = extractMaterialNumericClaims("営業利益率は12.5%、純利益率は8.2%です。");
    expect(margin[0]).toMatchObject({ semanticLabel: "operatingMargin" });
    expect(margin[1]).toMatchObject({ semanticLabel: "netMargin" });

    const mismatch = validateNumericAlignment({
      answer: "売上高は1,437.6億円です。",
      facts: buildVerifiedFinancialFacts(filing()),
      citedSourceIds: ["S1"]
    });
    expect(mismatch.status).toBe("repaired");
    expect(mismatch.labels).toContain("currency_mismatch");
    expect(mismatch.answer).toContain("1,437.6億ドル");
  });

  it("does not promote untyped narrative numbers into verified financial facts", () => {
    const base = filing();
    const facts = buildVerifiedFinancialFacts({
      ...base,
      sourceChunks: [
        ...base.sourceChunks,
        { sourceId: "S4", sectionType: "md_a", sectionTitle: "MD&A", sourceLabel: "Narrative",
          text: "営業利益率は99.9%でした。", startOffset: 83, endOffset: 101, sortOrder: 4 }
      ]
    });
    expect(facts.some((fact) => fact.sourceId === "S4")).toBe(false);
    const result = validateNumericAlignment({ answer: "営業利益率は99.9%です。", facts, citedSourceIds: ["S4"] });
    expect(result.status).toBe("blocked");
  });

  it("uses typed two-filing Q07 facts and blocks unsupported previous-filing numbers", () => {
    const facts = buildVerifiedFinancialFacts(filing(), {
      metrics: [],
      sourceChunks: [],
      additionalSources: [
        {
          sourceId: "v6:0000320193:current:S1",
          sourceLabel: "10-Q filed 2026-01-30 · period 2025-12-27",
          text: "売上高: 1,437.6億ドル (2025-12-27)",
          sourceUrl: "https://example.com/current",
          historicalFinancialFact: {
            filingKey: "v6:0000320193:current",
            formType: "10-Q",
            logicalName: "revenue",
            tagUsed: "Revenue",
            value: 143_756_000_000,
            unit: "USD",
            periodStart: "2025-09-28",
            periodEnd: "2025-12-27",
            periodKind: "quarter",
            fiscalYear: 2026,
            fiscalQuarter: "Q1",
            role: "current"
          }
        },
        {
          sourceId: "v6:0000320193:prior:S1",
          sourceLabel: "10-Q filed 2025-08-01 · period 2025-06-28",
          text: "売上高: 1,300億ドル (2025-06-28)",
          sourceUrl: "https://example.com/prior",
          historicalFinancialFact: {
            filingKey: "v6:0000320193:prior",
            formType: "10-Q",
            logicalName: "revenue",
            tagUsed: "Revenue",
            value: 130_000_000_000,
            unit: "USD",
            periodStart: "2025-03-30",
            periodEnd: "2025-06-28",
            periodKind: "quarter",
            fiscalYear: 2025,
            fiscalQuarter: "Q3",
            role: "comparison"
          }
        }
      ]
    });
    expect(facts.map((fact) => fact.sourceId)).toEqual(expect.arrayContaining([
      "v6:0000320193:current:S1",
      "v6:0000320193:prior:S1"
    ]));

    const unsupported = validateNumericAlignment({
      answer: "2025-12-27の売上高は9,999億ドルで、前回比10.6%増です。",
      facts,
      citedSourceIds: ["v6:0000320193:current:S1", "v6:0000320193:prior:S1"]
    });
    expect(unsupported.status).toBe("blocked");
    expect(unsupported.labels).toContain("unsupported_numeric_claim");
  });

  it("matches a current operating-cash-flow derived percentage exactly once", () => {
    const base = filing();
    const cashFiling: FilingCacheRecord = {
      ...base,
      ticker: "CAT",
      metrics: [{
        logicalName: "operatingCashFlow",
        tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: 1_870_000_000,
        comparisonValue: 1_289_000_000,
        unit: "USD",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        comparisonPeriodEnd: "2025-03-31",
        periodKind: "quarter",
        yoyPercent: 138.9
      }],
      sourceChunks: [{
        sourceId: "S13",
        sectionType: "xbrl_metric",
        sectionTitle: "営業CF",
        sourceLabel: "XBRL 営業CF",
        text: "営業CF: 1870000000 USD / 比較値: 1289000000 / YoY: 45.1%",
        startOffset: 0,
        endOffset: 64,
        tagName: "NetCashProvidedByUsedInOperatingActivities",
        sortOrder: 1
      }]
    };

    const result = validateNumericAlignment({
      answer: "営業CFは前年同期比45.1%増です。",
      facts: buildVerifiedFinancialFacts(cashFiling),
      citedSourceIds: ["S13"]
    });

    expect(result.status).toBe("passed");
    expect(result.claimCount).toBe(1);
    expect(result.verifiedClaimCount).toBe(1);
    expect(result.blockedClaimCount).toBe(0);
  });

  it("does not extract calendar dates, fiscal periods, or durations as financial claims", () => {
    const claims = extractMaterialNumericClaims(
      "2026年3月31日、2025年6月期、9か月間、Q1の売上高は1,437.6億ドルです。"
    );

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      kind: "currency",
      semanticLabel: "revenue",
      canonicalValue: 143_760_000_000
    });
  });

  it("treats a value after a year-over-year growth phrase as current", () => {
    const claims = extractMaterialNumericClaims(
      "売上高は前年度比16.6%増の1,111.8億ドルです。"
    );
    const amount = claims.find((claim) => claim.kind === "currency");

    expect(amount).toMatchObject({ semanticLabel: "revenue", periodRole: "current" });
  });

  it("treats a value before a parenthetical year-over-year growth phrase as current", () => {
    const claims = extractMaterialNumericClaims(
      "主要数値は売上高440.6億ドル（前年同期比85.2%増）です。"
    );
    const amount = claims.find((claim) => claim.kind === "currency");

    expect(amount).toMatchObject({ semanticLabel: "revenue", periodRole: "current" });
  });

  it("repairs a comparison-period amount mislabeled as the current value before a YoY annotation", () => {
    const base = filing();
    const nvda: FilingCacheRecord = {
      ...base,
      ticker: "NVDA",
      metrics: [{
        logicalName: "revenue", tagUsed: "Revenues", value: 81_615_000_000,
        comparisonValue: 44_062_000_000, unit: "USD",
        periodStart: "2026-01-26", periodEnd: "2026-04-26", periodKind: "quarter",
        comparisonPeriodStart: "2025-01-27", comparisonPeriodEnd: "2025-04-27",
        comparisonPeriodKind: "quarter", yoyPercent: 85.2
      }],
      sourceChunks: [
        { ...base.sourceChunks[0]!, sourceId: "CUR", tagName: "Revenues", text: "Revenue 81615000000 USD" },
        { ...base.sourceChunks[0]!, sourceId: "PRIOR", tagName: "Revenues", metricRole: "comparison",
          text: "Revenue comparison 44062000000 USD", sourceLabel: "XBRL revenue comparison" }
      ]
    };
    const result = validateNumericAlignment({
      answer: "主要数値は売上高440.6億ドル（前年同期比85.2%増）です。",
      facts: buildVerifiedFinancialFacts(nvda),
      citedSourceIds: ["CUR", "PRIOR"]
    });

    expect(result.status).toBe("repaired");
    expect(result.answer).toContain("816.2億ドル");
    expect(result.claimBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticLabel: "revenue", role: "current", outcome: "repaired" })
    ]));
  });

  it("carries a revenue label to an explicitly marked comparison amount", () => {
    const claims = extractMaterialNumericClaims(
      "四半期売上高は198億ドル、前年同期は12.7億ドルです。"
    ).filter((claim) => claim.kind === "currency");

    expect(claims[1]).toMatchObject({ semanticLabel: "revenue", periodRole: "comparison" });
  });

  it("honors trailing period markers and blocks the r64 repeated-current margin surface", () => {
    const base = filing();
    const xom: FilingCacheRecord = {
      ...base,
      ticker: "XOM",
      metrics: [
        {
          logicalName: "revenue", tagUsed: "Revenues", value: 85_138_000_000, comparisonValue: 83_130_000_000,
          unit: "USD", periodStart: "2026-01-01", periodEnd: "2026-03-31",
          comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", periodKind: "quarter",
          comparisonPeriodKind: "quarter", fiscalYear: 2026, fiscalQuarter: "Q1",
          comparisonFiscalYear: 2025, comparisonFiscalQuarter: "Q1"
        },
        {
          logicalName: "netIncome", tagUsed: "NetIncomeLoss", value: 4_183_000_000, comparisonValue: 7_713_000_000,
          unit: "USD", periodStart: "2026-01-01", periodEnd: "2026-03-31",
          comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", periodKind: "quarter",
          comparisonPeriodKind: "quarter", fiscalYear: 2026, fiscalQuarter: "Q1",
          comparisonFiscalYear: 2025, comparisonFiscalQuarter: "Q1"
        }
      ],
      sourceChunks: [
        { sourceId: "S9", sectionType: "xbrl_metric", sectionTitle: "売上高", sourceLabel: "XBRL 売上高",
          text: "売上高: 85138000000 USD / 比較値: 83130000000", startOffset: 0, endOffset: 49,
          tagName: "Revenues", sortOrder: 1 },
        { sourceId: "S10", sectionType: "xbrl_metric", sectionTitle: "純利益", sourceLabel: "XBRL 純利益",
          text: "純利益: 4183000000 USD / 比較値: 7713000000", startOffset: 50, endOffset: 95,
          tagName: "NetIncomeLoss", sortOrder: 2 }
      ]
    };
    const answer = "純利益率は4.91%（今期）対4.91%増（前期）で低下しています。";
    const claims = extractMaterialNumericClaims(answer);

    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticLabel: "netMargin", periodRole: "current" }),
      expect.objectContaining({ semanticLabel: "netMargin", periodRole: "comparison" })
    ]));

    const result = validateNumericAlignment({
      answer,
      facts: buildVerifiedFinancialFacts(xom),
      citedSourceIds: ["S9", "S10"]
    });
    expect(result.status).toBe("blocked");
    expect(result.labels).toContain("period_mismatch");
  });

  it("repairs only an unambiguous comparison-unit mismatch and reaches a clean fixed point", () => {
    const base = filing();
    const lly: FilingCacheRecord = {
      ...base,
      ticker: "LLY",
      metrics: [{
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 19_799_000_000,
        comparisonValue: 12_729_000_000,
        unit: "USD",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        comparisonPeriodEnd: "2025-03-31",
        periodKind: "quarter",
        yoyPercent: 138.9
      }],
      sourceChunks: [{
        sourceId: "S9", sectionType: "xbrl_metric", sectionTitle: "売上高", sourceLabel: "XBRL 売上高",
        text: "売上高: 19799000000 USD / 比較値: 12729000000 / YoY: 55.5%",
        startOffset: 0, endOffset: 70, tagName: "Revenues", sortOrder: 1
      }]
    };
    const facts = buildVerifiedFinancialFacts(lly);
    const repaired = validateNumericAlignment({
      answer: "四半期売上高は198億ドル、前年同期は12.7億ドルです。",
      facts,
      citedSourceIds: ["S9"]
    });

    expect(repaired.status).toBe("repaired");
    expect(repaired.answer).toContain("前年同期は127.3億ドル");
    const fixedPoint = validateNumericAlignment({
      answer: repaired.answer,
      facts,
      citedSourceIds: ["S9", ...repaired.requiredSourceIds]
    });
    expect(fixedPoint.status).toBe("passed");
    expect(fixedPoint.blockedClaimCount).toBe(0);
  });

  it("requires both current and prior filing sources for a derived YoY claim", () => {
    const base = filing();
    const distinctSources: FilingCacheRecord = {
      ...base,
      metrics: [{
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 100_000_000_000,
        unit: "USD",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        periodKind: "quarter",
        comparisonValue: 90_000_000_000,
        comparisonTagUsed: "Revenues",
        comparisonPeriodStart: "2025-01-01",
        comparisonPeriodEnd: "2025-03-31",
        comparisonPeriodKind: "quarter",
        comparisonSourceUrl: "https://example.com/prior",
        comparisonAccessionNumber: "prior-accession",
        yoyPercent: 11.1111111111
      }],
      sourceChunks: [
        {
          sourceId: "CUR", sectionType: "xbrl_metric", sectionTitle: "売上高", sourceLabel: "current revenue",
          text: "売上高 100000000000 USD", startOffset: 0, endOffset: 24, tagName: "Revenues",
          metricRole: "current", sourceUrl: "https://example.com/current", sortOrder: 1
        },
        {
          sourceId: "PRIOR", sectionType: "xbrl_metric", sectionTitle: "売上高（比較期）", sourceLabel: "prior revenue",
          text: "売上高 90000000000 USD", startOffset: 0, endOffset: 23, tagName: "Revenues",
          metricRole: "comparison", sourceUrl: "https://example.com/prior", sortOrder: 2
        }
      ]
    };
    const facts = buildVerifiedFinancialFacts(distinctSources);
    const current = facts.find((fact) => fact.semanticLabel === "revenue" && fact.role === "current");
    const comparison = facts.find((fact) => fact.semanticLabel === "revenue" && fact.role === "comparison");

    expect(current).toMatchObject({ sourceId: "CUR", sourceUrl: "https://example.com/current" });
    expect(comparison).toMatchObject({ sourceId: "PRIOR", sourceUrl: "https://example.com/prior", concept: "Revenues" });

    const repaired = validateNumericAlignment({
      answer: "売上高は前年同期比11.1%増です。",
      facts,
      citedSourceIds: ["CUR"]
    });
    expect(repaired.status).toBe("repaired");
    expect(repaired.requiredSourceIds).toContain("PRIOR");

    const fixedPoint = validateNumericAlignment({
      answer: repaired.answer,
      facts,
      citedSourceIds: ["CUR", "PRIOR"]
    });
    expect(fixedPoint.status).toBe("passed");
  });

  it("does not reuse a roleless current chunk for a distinct comparison filing", () => {
    const base = filing();
    const legacyCache: FilingCacheRecord = {
      ...base,
      metrics: [{
        logicalName: "revenue", tagUsed: "Revenue", value: 100_000_000_000, comparisonValue: 90_000_000_000,
        unit: "USD", periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter",
        comparisonPeriodStart: "2025-01-01", comparisonPeriodEnd: "2025-03-31", comparisonPeriodKind: "quarter",
        comparisonSourceUrl: "https://example.com/prior"
      }],
      sourceChunks: [{
        sourceId: "LEGACY_CURRENT", sectionType: "xbrl_metric", sectionTitle: "Revenue", sourceLabel: "legacy current revenue",
        text: "Revenue 100000000000 USD", startOffset: 0, endOffset: 24, tagName: "Revenue",
        sourceUrl: "https://example.com/current", sortOrder: 1
      }]
    };
    const facts = buildVerifiedFinancialFacts(legacyCache);
    const current = facts.find((fact) => fact.semanticLabel === "revenue" && fact.role === "current");
    const comparison = facts.find((fact) => fact.semanticLabel === "revenue" && fact.role === "comparison");

    expect(current).toMatchObject({ sourceId: "LEGACY_CURRENT", sourceUrl: "https://example.com/current" });
    expect(comparison?.sourceId).not.toBe("LEGACY_CURRENT");
    expect(comparison?.sourceUrl).toBe("https://example.com/prior");
  });

  it("blocks material margin errors instead of replacing them with an unrelated intended fact", () => {
    const base = filing();
    const mu: FilingCacheRecord = {
      ...base,
      ticker: "MU",
      metrics: [
        { logicalName: "revenue", tagUsed: "Revenue", value: 41_456_000_000, comparisonValue: 9_301_000_000,
          unit: "USD", periodStart: "2026-03-01", periodEnd: "2026-05-28", comparisonPeriodEnd: "2025-05-29", periodKind: "quarter" },
        { logicalName: "operatingIncome", tagUsed: "OperatingIncomeLoss", value: 33_318_000_000, comparisonValue: 1_540_000_000,
          unit: "USD", periodStart: "2026-03-01", periodEnd: "2026-05-28", comparisonPeriodEnd: "2025-05-29", periodKind: "quarter" }
      ],
      sourceChunks: [
        { sourceId: "S9", sectionType: "xbrl_metric", sectionTitle: "売上高", sourceLabel: "XBRL 売上高",
          text: "売上高 41456000000 USD", startOffset: 0, endOffset: 25, tagName: "Revenue", sortOrder: 1 },
        { sourceId: "S10", sectionType: "xbrl_metric", sectionTitle: "営業利益", sourceLabel: "XBRL 営業利益",
          text: "営業利益 33318000000 USD", startOffset: 26, endOffset: 52, tagName: "OperatingIncomeLoss", sortOrder: 2 }
      ]
    };
    const result = validateNumericAlignment({
      answer: "営業利益率は23.32%です。",
      facts: buildVerifiedFinancialFacts(mu),
      citedSourceIds: ["S9", "S10"]
    });

    expect(result.status).toBe("blocked");
    expect(result.labels).toContain("material_numeric_error");
    expect(result.answer).not.toContain("23.32%");
  });

  it("blocks unsupported unlabeled currency amounts when typed facts exist", () => {
    const result = validateNumericAlignment({
      answer: "債務返済は約21億ドルです。",
      facts: buildVerifiedFinancialFacts(filing()),
      citedSourceIds: ["S1"]
    });
    expect(result.status).toBe("blocked");
    expect(result.labels).toContain("unsupported_numeric_claim");
  });

  it("does not bind generic short- or long-term debt claims to narrow debt portions", () => {
    const base = filing();
    const debtFiling: FilingCacheRecord = {
      ...base,
      metrics: [
        { logicalName: "currentDebt", tagUsed: "LongTermDebtCurrent", value: 5_000_000_000,
          unit: "USD", periodEnd: "2025-12-27", periodKind: "instant" },
        { logicalName: "longTermDebt", tagUsed: "LongTermDebtNoncurrent", value: 10_000_000_000,
          unit: "USD", periodEnd: "2025-12-27", periodKind: "instant" }
      ],
      sourceChunks: [
        { sourceId: "D1", sectionType: "xbrl_metric", sectionTitle: "Current portion of long-term debt",
          sourceLabel: "XBRL current portion of long-term debt", text: "LongTermDebtCurrent 5000000000 USD",
          startOffset: 0, endOffset: 35, tagName: "LongTermDebtCurrent", sortOrder: 1 },
        { sourceId: "D2", sectionType: "xbrl_metric", sectionTitle: "Long-term debt, noncurrent",
          sourceLabel: "XBRL long-term debt, noncurrent", text: "LongTermDebtNoncurrent 10000000000 USD",
          startOffset: 36, endOffset: 75, tagName: "LongTermDebtNoncurrent", sortOrder: 2 }
      ]
    };
    const facts = buildVerifiedFinancialFacts(debtFiling);

    expect(validateNumericAlignment({
      answer: "1年内返済予定の長期債務は50億ドルです。長期債務（非流動）は100億ドルです。",
      facts,
      citedSourceIds: ["D1", "D2"]
    }).status).toBe("passed");
    expect(validateNumericAlignment({
      answer: "短期債務は50億ドルです。",
      facts,
      citedSourceIds: ["D1"]
    }).status).toBe("blocked");
    expect(validateNumericAlignment({
      answer: "長期債務は100億ドルです。",
      facts,
      citedSourceIds: ["D2"]
    }).status).toBe("blocked");
  });

  it("blocks material financial claims when no typed facts exist", () => {
    const result = validateNumericAlignment({
      answer: "売上高は816.2億ドルで、前年同期比85.2%増です。",
      facts: [],
      citedSourceIds: []
    });
    expect(result.status).toBe("blocked");
    expect(result.blockedClaimCount).toBe(2);
    expect(result.labels).toContain("unsupported_numeric_claim");
  });

  it("blocks ordinary growth percentages across a negative-to-positive sign crossing", () => {
    const base = filing();
    const crossing: FilingCacheRecord = {
      ...base,
      ticker: "KO",
      metrics: [{
        logicalName: "operatingCashFlow",
        tagUsed: "NetCashProvidedByUsedInOperatingActivities",
        value: 1_000_000_000,
        comparisonValue: -2_570_000_000,
        unit: "USD",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        comparisonPeriodEnd: "2025-03-31",
        periodKind: "quarter",
        yoyPercent: 138.9
      }],
      sourceChunks: [{
        sourceId: "S13", sectionType: "xbrl_metric", sectionTitle: "営業CF", sourceLabel: "XBRL 営業CF",
        text: "営業CF 1000000000 USD / 比較値 -2570000000", startOffset: 0, endOffset: 48,
        tagName: "NetCashProvidedByUsedInOperatingActivities", sortOrder: 1
      }]
    };
    const facts = buildVerifiedFinancialFacts(crossing);
    expect(facts.find((fact) => fact.semanticLabel === "operatingCashFlow" && fact.role === "current")?.derivedPercentage).toBeUndefined();
    const result = validateNumericAlignment({
      answer: "営業CFは前年同期比138.9%増です。",
      facts,
      citedSourceIds: ["S13"]
    });

    expect(result.status).toBe("blocked");
    expect(result.answer).not.toContain("138.9%増");
  });

  it("blocks swapped explicit date anchors and exposes the rejected fact binding", () => {
    const result = validateNumericAlignment({
      answer: "当期（2024-12-28）の売上高は1,437.6億ドルで、前年同期（2025-12-27）の売上高は1,243億ドルです。",
      facts: buildVerifiedFinancialFacts(filing()),
      citedSourceIds: ["S1"]
    });

    expect(result.status).toBe("blocked");
    expect(result.labels).toContain("period_mismatch");
    expect(result.claimBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticLabel: "revenue", role: "current", periodEnd: "2025-12-27", outcome: "blocked" })
    ]));
  });

  it("blocks a segment-scoped amount from binding to a company-total revenue fact", () => {
    const result = validateNumericAlignment({
      answer: "AWS売上高は1,437.6億ドルです。",
      facts: buildVerifiedFinancialFacts({ ...filing(), ticker: "AMZN", companyName: "Amazon.com, Inc." }),
      citedSourceIds: ["S1"]
    });

    expect(result.status).toBe("blocked");
    expect(result.claimBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticLabel: "revenue", scope: "company_total", outcome: "blocked" })
    ]));
  });

  it("does not accept an equal-valued company metric under the wrong semantic identity", () => {
    const result = validateNumericAlignment({
      answer: "営業利益は1,437.6億ドルです。",
      facts: buildVerifiedFinancialFacts(filing()),
      citedSourceIds: ["S1"]
    });

    expect(result.status).toBe("blocked");
    expect(result.labels).toContain("unsupported_numeric_claim");
    expect(result.matchedFactIds).not.toEqual(expect.arrayContaining([expect.stringContaining("Revenue")]));
  });

  it("blocks current/comparison role collapse when the same current value is repeated", () => {
    const result = validateNumericAlignment({
      answer: "当期の売上高は1,437.6億ドルで、前年同期の売上高も1,437.6億ドルです。",
      facts: buildVerifiedFinancialFacts(filing()),
      citedSourceIds: ["S1"]
    });

    expect(result.status).toBe("blocked");
    expect(result.labels).toContain("period_mismatch");
  });

  it("does not derive a margin from numerator and denominator with incompatible fiscal durations", () => {
    const base = filing();
    const incompatible: FilingCacheRecord = {
      ...base,
      metrics: [
        { logicalName: "revenue", tagUsed: "Revenue", value: 100_000_000_000, unit: "USD",
          periodStart: "2026-01-01", periodEnd: "2026-03-31", periodKind: "quarter", fiscalYear: 2026, fiscalQuarter: "Q1" },
        { logicalName: "operatingIncome", tagUsed: "OperatingIncomeLoss", value: 20_000_000_000, unit: "USD",
          periodStart: "2025-10-01", periodEnd: "2026-03-31", periodKind: "year_to_date", fiscalYear: 2026, fiscalQuarter: "Q2" }
      ],
      sourceChunks: [
        { ...base.sourceChunks[0]!, sourceId: "S1", tagName: "Revenue", text: "Revenue 100000000000 USD" },
        { ...base.sourceChunks[1]!, sourceId: "S4", tagName: "OperatingIncomeLoss", text: "Operating income 20000000000 USD" }
      ]
    };
    const facts = buildVerifiedFinancialFacts(incompatible);
    expect(facts.some((fact) => fact.semanticLabel === "operatingMargin")).toBe(false);

    const result = validateNumericAlignment({
      answer: "営業利益率は20.0%です。",
      facts,
      citedSourceIds: ["S1", "S4"]
    });
    expect(result.status).toBe("blocked");
  });
});
