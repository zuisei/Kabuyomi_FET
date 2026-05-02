import type { FilingCacheRecord, SourceChunkRecord } from "../../env";
import { isUnsafeDriverEvidence } from "./evidence-text-quality";
import type { EvidenceDriver, EvidenceFact, HardFinancialIntent, SourceGateResult, SourceGateSector } from "./source-gate";
import { normalizeSector } from "./source-gate";

export type EvidenceSlots = {
  confirmedMetricMovement?: {
    metricName: string;
    currentValue?: string;
    comparisonValue?: string;
    changePct?: string;
    comparisonBasis?: string;
    sourceIds: string[];
  };
  companyExplainedDrivers: EvidenceDriver[];
  segmentOrBusinessSignals: EvidenceFact[];
  marginDrivers: EvidenceDriver[];
  durabilityEvidence: {
    likelyTemporary: EvidenceFact[];
    potentiallyDurable: EvidenceFact[];
    uncertain: EvidenceFact[];
  };
  sectorSpecificNextIndicators: string[];
  unknowns: string[];
  sourceLimitations: string[];
  failureLabels: string[];
};

export function extractEvidenceSlots({
  filing,
  sources,
  sourceGateResult
}: {
  filing: FilingCacheRecord;
  sources: SourceChunkRecord[];
  sourceGateResult: SourceGateResult;
}): EvidenceSlots {
  const sector = normalizeSector(null, filing.ticker, filing.companyName);
  const hardIntent = sourceGateResult.hardIntent;
  const confirmedMetricMovement = extractMetricMovement(filing, sources, hardIntent);
  const filteredDrivers = filterSafeDrivers(sourceGateResult.identifiedDrivers, sources, hardIntent, sector);
  const companyExplainedDrivers = hardIntent === "revenue_driver" || hardIntent === "driver_durability_followup"
    ? filteredDrivers.safe
    : [];
  const marginDrivers = hardIntent === "margin_durability_followup" ? filteredDrivers.safe : [];
  const sourceLimitations = sourceGateResult.missingSourceTypes.length > 0
    ? [`不足しているsource type: ${sourceGateResult.missingSourceTypes.join(", ")}`]
    : [];
  if (filteredDrivers.rejected > 0) {
    sourceLimitations.push("関連しそうな記述はありますが、driverとして要約できる十分な説明ではありません。");
  }
  const unknowns: string[] = [];

  if (hardIntent === "revenue_driver" && companyExplainedDrivers.length === 0) {
    unknowns.push("会社が説明する具体的な売上driverは、選択sourceからは十分に特定されていません。");
  }
  if (hardIntent === "driver_durability_followup" && !sourceGateResult.followupTargetFound) {
    unknowns.push("前問の具体的な売上driverが十分に特定されていません。");
  }
  if (hardIntent === "margin_durability_followup" && marginDrivers.length === 0) {
    unknowns.push("利益率変化の具体的なdriverは、選択sourceからは十分に特定されていません。");
  }

  const durabilityEvidence = extractDurabilityEvidence(sources, sourceGateResult);
  return {
    confirmedMetricMovement,
    companyExplainedDrivers,
    segmentOrBusinessSignals: extractSegmentSignals(sources, sector),
    marginDrivers,
    durabilityEvidence,
    sectorSpecificNextIndicators: nextIndicatorsForSector(sector),
    unknowns,
    sourceLimitations,
    failureLabels: [
      ...sourceGateResult.failureLabels,
      ...(filteredDrivers.rejected > 0 ? ["raw_english_excerpt", "driver_evidence_fragmentary"] : []),
      ...(filteredDrivers.rejected > 0 && sourceGateResult.sourceSufficient ? ["source_gate_false_positive"] : []),
      ...(companyExplainedDrivers.length === 0 && hardIntent !== "margin_durability_followup" ? ["driver_slots_empty"] : []),
      ...(marginDrivers.length === 0 && hardIntent === "margin_durability_followup" ? ["margin_driver_slots_empty"] : []),
      ...(sourceLimitations.length > 0 ? ["fallback_slot_incomplete"] : [])
    ]
  };
}

function filterSafeDrivers(
  drivers: EvidenceDriver[],
  sources: SourceChunkRecord[],
  hardIntent: HardFinancialIntent | null,
  sector: SourceGateSector
): { safe: EvidenceDriver[]; rejected: number } {
  if (!hardIntent) {
    return { safe: drivers, rejected: 0 };
  }

  let rejected = 0;
  const safe = drivers.filter((driver) => {
    const source = sources.find((candidate) => driver.sourceIds.includes(candidate.sourceId));
    const candidate = source ?? {
      text: driver.driver,
      sourceLabel: "",
      sectionType: "md_a" as const
    };
    const unsafe = isUnsafeDriverEvidence(candidate, hardIntent, sector);
    if (unsafe) {
      rejected += 1;
    }
    return !unsafe;
  });
  return { safe, rejected };
}

export function nextIndicatorsForSector(sector: SourceGateSector): string[] {
  switch (sector) {
    case "bank":
      return ["net interest income", "noninterest income", "provision for credit losses", "deposits", "credit quality", "segment results"];
    case "capital_markets":
      return ["investment banking", "trading", "asset management", "wealth management", "net interest income", "segment results"];
    case "energy":
      return ["commodity prices", "production volume", "upstream results", "refining margin", "chemical margin", "segment results"];
    case "oilfield_services":
      return ["drilling activity", "completion activity", "North America activity", "international activity", "oilfield services margins", "segment results"];
    case "industrial":
      return ["price realization", "sales volume", "orders", "backlog", "manufacturing cost", "SG&A", "R&D", "segment operating profit"];
    case "retail":
      return ["comparable sales", "traffic", "ticket", "eCommerce", "membership income", "advertising", "inventory", "gross margin", "segment results"];
    case "consumer_staples":
      return ["pricing", "volume", "foreign exchange", "organic sales", "gross margin", "commodity costs", "segment results"];
    case "auto":
      return ["deliveries", "vehicle pricing", "automotive gross margin", "production volume", "energy revenue", "segment results"];
    case "technology":
      return ["product revenue", "services revenue", "geographic revenue", "product launches", "channel inventory", "installed base", "gross margin"];
    case "software":
      return ["subscription revenue", "usage", "customers", "RPO", "deferred revenue", "retention", "gross margin"];
    case "semiconductor_equipment":
      return ["orders", "backlog", "wafer fab equipment demand", "China exposure", "customer demand", "gross margin"];
    case "healthcare_medtech":
      return ["procedure volume", "installed base", "systems placements", "instruments/accessories revenue", "recurring revenue", "gross margin"];
    case "reit":
      return ["occupancy", "same-store NOI", "senior housing", "medical office", "debt maturities", "interest rates"];
    case "media":
      return ["advertising revenue", "affiliate revenue", "retransmission", "content costs", "distribution revenue", "segment results"];
    case "utility":
      return ["rate cases", "regulated returns", "fuel cost", "load growth", "capex", "interest expense"];
    case "mining":
      return ["copper price", "gold price", "production volume", "unit costs", "mining operations", "commodity cycle"];
    case "general":
      return ["MD&A", "segment results", "revenue discussion", "profitability discussion"];
  }
}

function extractMetricMovement(
  filing: FilingCacheRecord,
  sources: SourceChunkRecord[],
  hardIntent: HardFinancialIntent | null
): EvidenceSlots["confirmedMetricMovement"] {
  const wanted = hardIntent === "margin_durability_followup"
    ? filing.metrics.find((metric) => metric.logicalName === "netIncome" || metric.logicalName === "operatingIncome")
    : filing.metrics.find((metric) => metric.logicalName === "revenue");
  if (!wanted) {
    return undefined;
  }
  const metricSourceIds = sources
    .filter((source) => source.sectionType === "xbrl_metric" || /xbrl/i.test(source.sourceLabel))
    .map((source) => source.sourceId);
  return {
    metricName: metricDisplayName(wanted.logicalName),
    currentValue: formatMetricValue(wanted.value, wanted.unit),
    comparisonValue: typeof wanted.comparisonValue === "number" ? formatMetricValue(wanted.comparisonValue, wanted.unit) : undefined,
    changePct: typeof wanted.yoyPercent === "number" ? `${wanted.yoyPercent.toFixed(1)}%` : undefined,
    comparisonBasis: typeof wanted.yoyPercent === "number" ? "前年同期比" : undefined,
    sourceIds: metricSourceIds
  };
}

function extractSegmentSignals(sources: SourceChunkRecord[], sector: SourceGateSector): EvidenceFact[] {
  const pattern = sector === "retail"
    ? /(walmart u\.s\.|walmart international|sam'?s club|segment|comparable sales|traffic|ticket)/i
    : /(segment|geographic|product|service|business|部門|地域|製品)/i;
  return sources
    .filter((source) => source.sectionType !== "xbrl_metric" && pattern.test(source.text))
    .slice(0, 2)
    .map((source) => ({
      fact: source.text.slice(0, 180).replace(/\s+/g, " ").trim(),
      sourceIds: [source.sourceId],
      confidence: "medium"
    }));
}

function extractDurabilityEvidence(
  sources: SourceChunkRecord[],
  sourceGateResult: SourceGateResult
): EvidenceSlots["durabilityEvidence"] {
  const likelyTemporary: EvidenceFact[] = [];
  const potentiallyDurable: EvidenceFact[] = [];
  for (const source of sources) {
    if (source.sectionType === "xbrl_metric") {
      continue;
    }
    const text = source.text;
    if (/(one-time|temporary|transitory|seasonal|一時|一過性)/i.test(text)) {
      likelyTemporary.push({ fact: text.slice(0, 180).replace(/\s+/g, " ").trim(), sourceIds: [source.sourceId], confidence: "medium" });
    }
    if (/(recurring|continue|sustain|installed base|subscription|backlog|membership|継続|持続)/i.test(text)) {
      potentiallyDurable.push({ fact: text.slice(0, 180).replace(/\s+/g, " ").trim(), sourceIds: [source.sourceId], confidence: "medium" });
    }
  }
  const uncertain = sourceGateResult.sourceSufficient
    ? []
    : [{
        fact: sourceGateResult.reason,
        sourceIds: [],
        confidence: "high" as const
      }];
  return { likelyTemporary, potentiallyDurable, uncertain };
}

function metricDisplayName(logicalName: string): string {
  switch (logicalName) {
    case "revenue":
      return "売上高";
    case "netIncome":
      return "純利益";
    case "operatingIncome":
      return "営業利益";
    case "operatingCashFlow":
      return "営業キャッシュフロー";
    default:
      return logicalName;
  }
}

function formatMetricValue(value: number, unit: string): string {
  if (unit === "USD" && Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}億ドル`;
  }
  if (unit === "USD" && Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}百万ドル`;
  }
  return `${value.toLocaleString("en-US")} ${unit}`;
}
