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

  it("passes JPM-Q03-like revenue driver only with period-specific bank narrative plus revenue metric", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [revenueMetric(182_447_000_000, 177_556_000_000, 2.8)], [
      source(
        "S1",
        "md_a",
        "Total net revenue was $182.4 billion for fiscal 2025, up 3% compared with the prior year. The increase was driven by higher net interest income, noninterest income, markets revenue and investment banking fees, partially offset by lower card services revenue."
      ),
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

    expect(result.sourceSufficient).toBe(true);
    expect(result.identifiedDrivers[0]?.category).toBe("bank_revenue_driver");
    expect(result.failureLabels).not.toContain("revenue_driver_evidence_too_generic");
  });

  it("rejects generic business and properties text even when it mentions revenue", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [revenueMetric(680_985_000_000, 648_125_000_000, 5.1)], [
      source(
        "S1",
        "md_a",
        "Item 2. Properties. Walmart opened its first store decades ago and has a large store footprint. Revenue information and available information can be found on the corporate website."
      ),
      metricSource("S9", "売上高: 680985000000 USD / 比較値: 648125000000 / YoY: 5.1%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の主な要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.identifiedDrivers).toHaveLength(0);
    expect(result.failureLabels).toEqual(expect.arrayContaining([
      "selected_properties_not_revenue_driver",
      "selected_business_description_not_period_driver",
      "revenue_driver_evidence_too_generic",
      "source_gate_failed"
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

  it("does not treat business-description fallback text as a recovered Q04 driver", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [revenueMetric(713_163_000_000, 680_985_000_000, 4.7)], [
      source(
        "S3",
        "md_a",
        "Comparable sales were driven by growth in transactions and unit volumes, with strong sales in grocery and health and wellness."
      ),
      metricSource("S9", "売上高: 713163000000 USD / 比較値: 680985000000 / YoY: 4.7%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上高が変化した要因は一時的ですか？",
      previousAnswer: "本文では、our ability to leverage our store and club footprint to expand customer access が売上変化の要因として説明されています。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.followupTargetFound).toBe(false);
    expect(result.sourceSufficient).toBe(false);
    expect(result.failureLabels).toContain("missing_followup_target_driver");
  });

  it("passes Q04 when a recovered Q03 driver has source-backed recurring demand evidence", () => {
    const filing = makeFiling("AAPL", "Apple Inc.", [revenueMetric(111_184_000_000, 95_359_000_000, 16.6)], [
      source(
        "S3",
        "md_a",
        "Net sales increased due to higher Services revenue and product launches. Services revenue growth reflected continued strength in the installed base, while macroeconomic conditions and tariffs remain uncertain."
      ),
      metricSource("S9", "売上高: 111184000000 USD / 比較値: 95359000000 / YoY: 16.6%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "前問で挙げた売上高の要因（Services）は一時的ですか？継続性と不明点を分けて説明してください。",
      previousAnswer: "主な要因として Services revenue と製品ローンチが寄与しています。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(true);
    expect(result.followupTargetFound).toBe(true);
    expect(result.failureLabels).not.toContain("missing_durability_context");
  });

  it("keeps Q04 as revenue-driver durability even when prior driver text mentions margin pressure", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [revenueMetric(182_447_000_000, 177_556_000_000, 2.8)], [
      source(
        "S3",
        "md_a",
        "Net interest income was up 3%, driven by higher Markets net interest income, higher revolving balances in Card Services and higher wholesale deposit balances. These factors were largely offset by deposit margin compression and the impact of lower rates."
      ),
      metricSource("S9", "売上高: 182447000000 USD / 比較値: 177556000000 / YoY: 2.8%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "前問で挙げた売上高の要因（net interest income、deposits）は一時的ですか？",
      previousAnswer: "NII と deposits が寄与しましたが、deposit margin compression と lower rates が相殺しました。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(true);
    expect(result.identifiedDrivers[0]?.category).toBe("bank_driver_durability_followup");
    expect(result.failureLabels).not.toContain("margin_driver_slots_empty");
  });

  it("fails Q04 safely when the Q03 driver is recovered but durability evidence is absent", () => {
    const filing = makeFiling("CAT", "Caterpillar Inc.", [revenueMetric(67_589_000_000, 64_809_000_000, 4.3)], [
      source(
        "S3",
        "md_a",
        "Total sales and revenues increased 4 percent. The increase reflected higher sales volume, partially offset by unfavorable price realization."
      ),
      metricSource("S9", "売上高: 67589000000 USD / 比較値: 64809000000 / YoY: 4.3%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "前問で挙げた売上高の要因（volume、pricing）は一時的ですか？",
      previousAnswer: "売上増加は販売量と価格実現が要因です。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.followupTargetFound).toBe(true);
    expect(result.failureLabels).toEqual(expect.arrayContaining([
      "missing_durability_context",
      "driver_supported_but_durability_unclear",
      "source_gate_failed"
    ]));
  });

  it("fails Q04 safely when no prior Q03 driver was recovered", () => {
    const filing = makeFiling("XOM", "Exxon Mobil Corp", [revenueMetric(332_238_000_000, 349_585_000_000, -5.0)], [
      source(
        "S3",
        "md_a",
        "Commodity prices over the long term will continue to be driven by market supply and demand and general economic activities."
      ),
      metricSource("S9", "売上高: 332238000000 USD / 比較値: 349585000000 / YoY: -5.0%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "前問では売上高の具体的なdriverが十分に特定できていません。売上高の一時要因と継続要因を説明してください。",
      previousAnswer: "会社固有の売上要因は十分に特定できていません。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.followupTargetFound).toBe(false);
    expect(result.failureLabels).toEqual(expect.arrayContaining([
      "missing_followup_target_driver",
      "followup_target_empty",
      "source_gate_failed"
    ]));
  });

  it("does not pass generic risk or outlook text alone as Q04 durability evidence", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [revenueMetric(713_163_000_000, 680_985_000_000, 4.7)], [
      source(
        "S3",
        "md_a",
        "Forward-looking statements involve risks and uncertainties. The company strategy is to serve customers through stores and digital channels over the long term."
      ),
      metricSource("S9", "売上高: 713163000000 USD / 比較値: 680985000000 / YoY: 4.7%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "前問で挙げた売上高の要因（eCommerce、membership）は一時的ですか？",
      previousAnswer: "eCommerce と membership が寄与しています。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.failureLabels).toEqual(expect.arrayContaining([
      "driver_slots_empty",
      "durability_context_too_generic",
      "source_gate_failed"
    ]));
  });

  it("recognizes sector-specific Q04 durability only when the source backs it", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [revenueMetric(713_163_000_000, 680_985_000_000, 4.7)], [
      source(
        "S3",
        "md_a",
        "Comparable sales were driven by growth in transactions and unit volumes. Walmart US eCommerce sales growth reflects continued strength in customer and Walmart+ member engagement with omnichannel offerings."
      ),
      metricSource("S9", "売上高: 713163000000 USD / 比較値: 680985000000 / YoY: 4.7%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "前問で挙げた売上高の要因（既存店売上、eCommerce、membership）は一時的ですか？",
      previousAnswer: "既存店売上、eCommerce、membership が寄与しています。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(true);
    expect(result.identifiedDrivers[0]?.category).toContain("retail");
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

  it("passes revenue driver with MD&A revenue narrative and revenue XBRL", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [revenueMetric(680_000_000_000, 660_000_000_000, 3.0)], [
      source("S3", "md_a", "Net sales increased primarily due to comparable sales growth, higher traffic and stronger e-commerce sales in Walmart U.S. segment results."),
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

    expect(result.sourceSufficient).toBe(true);
    expect(result.missingSourceTypes).toEqual([]);
    expect(result.failureLabels).not.toContain("source_gate_failed");
  });

  it("passes JPM-like revenue driver evidence when net interest and noninterest revenue are supported", () => {
    const filing = makeFiling("JPM", "JPMorgan Chase & Co.", [revenueMetric(182_447_000_000, 177_556_000_000, 2.8)], [
      source("CTX1", "md_a", "Total net revenue was $182.4 billion, up 3%, reflecting net interest income of $95.4 billion, up 3%, driven by higher Markets net interest income and higher revolving balances in Card Services. Noninterest revenue was $87.0 billion, up 2%, reflecting higher Markets noninterest revenue and higher investment banking fees."),
      metricSource("S9", "売上高: 182447000000 USD / 比較値: 177556000000 / YoY: 2.8%")
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
    expect(result.identifiedDrivers[0]?.category).toContain("bank");
  });

  it("passes XOM-like revenue driver evidence when commodity and refining context are supported", () => {
    const filing = makeFiling("XOM", "Exxon Mobil Corp", [revenueMetric(332_238_000_000, 349_585_000_000, -5.0)], [
      source("CTX1", "md_a", "Sales and other operating revenue decreased as record crude demand was met by increasing industry supply, resulting in modestly lower prices, while industry refining margins improved and production volumes increased in the Permian."),
      metricSource("S9", "売上高: 332238000000 USD / 比較値: 349585000000 / YoY: -5.0%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "減収の主な要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(true);
    expect(result.identifiedDrivers[0]?.category).toContain("energy");
  });

  it("passes energy revenue driver evidence when current-period crude price and production volumes explain revenue", () => {
    const filing = makeFiling("XOM", "Exxon Mobil Corp", [revenueMetric(332_238_000_000, 349_585_000_000, -5.0)], [
      source(
        "S1",
        "md_a",
        "Sales and other operating revenue decreased 5% in fiscal 2025 compared with 2024, primarily due to lower crude prices and weaker natural gas price realizations, partially offset by higher production volumes in upstream operations."
      ),
      metricSource("S9", "売上高: 332238000000 USD / 比較値: 349585000000 / YoY: -5.0%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "減収の主な要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(true);
    expect(result.failureLabels).not.toContain("energy_revenue_driver_context_too_broad");
    expect(result.identifiedDrivers[0]?.category).toContain("energy");
  });

  it("rejects long-term commodity outlook alone as energy revenue driver evidence", () => {
    const filing = makeFiling("XOM", "Exxon Mobil Corp", [revenueMetric(332_238_000_000, 349_585_000_000, -5.0)], [
      source(
        "S1",
        "md_a",
        "In 2025, crude prices remained within the 10-year historical range while robust demand helped move natural gas price above the top of the 10-year range. ExxonMobil believes prices over the long term will continue to be driven by market supply and demand, general economic activities, technology advances, consumer preference and government policies."
      ),
      metricSource("S9", "売上高: 332238000000 USD / 比較値: 349585000000 / YoY: -5.0%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "減収の主な要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.identifiedDrivers).toHaveLength(0);
    expect(result.failureLabels).toEqual(expect.arrayContaining([
      "energy_revenue_driver_context_too_broad",
      "missing_energy_period_result_driver",
      "source_gate_failed"
    ]));
  });

  it("rejects reserve and production-sharing mechanics alone as energy revenue driver evidence", () => {
    const filing = makeFiling("XOM", "Exxon Mobil Corp", [revenueMetric(332_238_000_000, 349_585_000_000, -5.0)], [
      source(
        "S1",
        "md_a",
        "Proved reserves require management funding commitments and support infrastructure. Price effects on production sharing contracts and changes in capital investment timing can vary depending on the oil and gas price environment."
      ),
      metricSource("S9", "売上高: 332238000000 USD / 比較値: 349585000000 / YoY: -5.0%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "減収の主な要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.identifiedDrivers).toHaveLength(0);
    expect(result.failureLabels).toEqual(expect.arrayContaining([
      "energy_reserve_context_not_revenue_driver",
      "energy_revenue_driver_context_too_broad",
      "missing_energy_period_result_driver",
      "source_gate_failed"
    ]));
  });

  it("passes CAT-like revenue driver evidence when sales volume and price realization are supported", () => {
    const filing = makeFiling("CAT", "Caterpillar Inc.", [revenueMetric(67_589_000_000, 64_809_000_000, 4.3)], [
      source("CTX1", "md_a", "Total sales and revenues increased 4 percent compared with 2024. The increase reflected higher sales volume, partially offset by unfavorable price realization, and higher sales volume was primarily driven by higher sales of equipment to end users and healthy backlog."),
      metricSource("S9", "売上高: 67589000000 USD / 比較値: 64809000000 / YoY: 4.3%")
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
    expect(result.identifiedDrivers[0]?.category).toContain("industrial");
  });

  it("passes WMT-like revenue driver evidence when comparable sales traffic ticket and eCommerce are supported", () => {
    const filing = makeFiling("WMT", "Walmart Inc.", [revenueMetric(713_163_000_000, 680_985_000_000, 4.7)], [
      source("CTX1", "md_a", "Walmart U.S. comparable sales increased 4.3%. Comparable sales were driven by growth in average ticket and transactions, reflected growth in unit volumes, and eCommerce sales positively contributed to comparable sales through customer and Walmart+ member engagement."),
      metricSource("S9", "売上高: 713163000000 USD / 比較値: 680985000000 / YoY: 4.7%")
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
    expect(result.identifiedDrivers[0]?.category).toContain("retail");
  });

  it("keeps revenue driver fallback for XBRL-only source packs", () => {
    const filing = makeFiling("AAPL", "Apple Inc.", [revenueMetric(111_184_000_000, 95_359_000_000, 16.6)], [
      metricSource("S9", "売上高: 111184000000 USD / 比較値: 95359000000 / YoY: 16.6%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長、または減収の主な要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.failureLabels).toEqual(expect.arrayContaining(["retrieval_overfocused_xbrl", "driver_slots_empty", "source_gate_failed"]));
    expect(result.missingSourceTypes).toEqual(expect.arrayContaining(["MD&A revenue discussion", "segment/revenue context"]));
  });

  it("does not pass generic boilerplate as revenue driver evidence", () => {
    const filing = makeFiling("AAPL", "Apple Inc.", [revenueMetric(111_184_000_000, 95_359_000_000, 16.6)], [
      source("S3", "md_a", "Table of Contents. The following table presents revenue as a percentage of total net sales. See our website for additional information."),
      metricSource("S9", "売上高: 111184000000 USD / 比較値: 95359000000 / YoY: 16.6%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "売上成長の要因は？",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.sourceSufficient).toBe(false);
    expect(result.identifiedDrivers).toHaveLength(0);
    expect(result.failureLabels).toContain("source_relevance_low");
  });

  it("does not discard substantive revenue-driver text solely because a context window contains table-of-contents noise", () => {
    const filing = makeFiling("CAT", "Caterpillar Inc.", [revenueMetric(64_800_000_000, 67_100_000_000, -3.4)], [
      source("CTX1", "md_a", "Table of Contents. Sales decreased primarily due to lower sales volume and unfavorable price realization, partially offset by stronger services demand in segment results."),
      metricSource("S9", "売上高: 64800000000 USD / 比較値: 67100000000 / YoY: -3.4%")
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "減収の主な要因は？",
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
    expect(fallback.answer.answer).toContain("会社固有の売上要因は十分に特定できていません");
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
    expect(result.modelResponse.qualityControl?.fallbackKind).not.toBe("legacy_template");
    expect(result.modelResponse.qualityControl?.evidenceFallbackUsed).toBe(true);
    expect(result.modelResponse.retryDiagnostics?.retryAttempted).toBe(false);
    expect(result.modelResponse.answer).toContain("会社固有の売上要因は十分に特定できていません");
  });

  it("replaces local revenue-driver legacy fallback with evidence_slot for RKLB-like hard intents", async () => {
    const filing = makeFiling("RKLB", "Rocket Lab USA, Inc.", [revenueMetric(436_200_000, 244_600_000, 78.3)], [
      metricSource("S9", "売上高: 436200000 USD / 比較値: 244600000 / YoY: 78.3%"),
      source("S10", "md_a", "Revenue increased due to growth in launch services and space systems customer demand.")
    ]);

    const result = await buildValidatedModelAnswer({
      filing,
      question: "売上なんでこうなったん？",
      env: { LLM_PROVIDER: "disabled" } as Env,
      questionIntent: "yoy_change",
      timings: createChatTimingTracker()
    });

    expect(result.modelResponse.qualityControl?.sourceGateApplied).toBe(true);
    expect(result.modelResponse.qualityControl?.fallbackKind).not.toBe("legacy_template");
    expect(result.modelResponse.qualityControl?.evidenceFallbackUsed).toBe(true);
    expect(result.modelResponse.answer).not.toContain("銀行では");
    expect(result.modelResponse.answer).not.toContain("net interest income");
    expect(result.modelResponse.answer).not.toContain("noninterest income");
    expect(result.modelResponse.answer).not.toContain("預金・貸出");
  });

  it("keeps AAPL-like revenue follow-up handoff as driver durability when product and services evidence exists", () => {
    const filing = makeFiling("AAPL", "Apple Inc.", [
      revenueMetric(143_756_000_000, 124_300_000_000, 15.7)
    ], [
      metricSource("S9", "売上高: 143756000000 USD / 比較値: 124300000000 / YoY: 15.7%"),
      source(
        "S1",
        "md_a",
        "Services revenue increased due to customer growth and the installed base, while product introductions and channel inventory can significantly impact net sales. Foreign exchange and tariffs may affect future net sales."
      )
    ]);

    const result = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent: "yoy_change",
      question: "前問で挙げた売上高の要因（product mix、Services、foreign exchange、demand）は一時的ですか？継続性と不明点を分けて説明してください。",
      previousAnswer:
        "本文で説明されている要因: 主な要因は製品とサービスの売上構成の変化と需要、マクロ経済条件・関税等の影響。サービスは売上高の増加とサービスの構成の違いが寄与。市場環境として為替などが影響。",
      selectedSources: filing.sourceChunks,
      metrics: filing.metrics
    });

    expect(result.hardIntent).toBe("driver_durability_followup");
    expect(result.followupTargetFound).toBe(true);
    expect(result.sourceSufficient).toBe(true);
    expect(result.failureLabels).not.toContain("followup_target_empty");
    expect(result.failureLabels).not.toContain("margin_driver_slots_empty");
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
