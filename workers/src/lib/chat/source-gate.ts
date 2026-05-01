import type { MetricSnapshot, SourceChunkRecord } from "../../env";
import { isUnsafeDriverEvidence } from "./evidence-text-quality";
import type { QuestionIntent } from "./intent";

export type SourceGateConfidence = "high" | "medium" | "low";
export type HardFinancialIntent = "revenue_driver" | "driver_durability_followup" | "margin_durability_followup";

export type EvidenceFact = {
  fact: string;
  sourceIds: string[];
  confidence?: SourceGateConfidence;
};

export type EvidenceDriver = {
  driver: string;
  category: string;
  sourceIds: string[];
  confidence: SourceGateConfidence;
};

export type SourceGateResult = {
  sourceGateApplied: boolean;
  hardIntent: HardFinancialIntent | null;
  sourceSufficient: boolean;
  confidence: SourceGateConfidence;
  followupTargetFound: boolean | null;
  knownFacts: EvidenceFact[];
  identifiedDrivers: EvidenceDriver[];
  missingSourceTypes: string[];
  retrievalRetryRecommended: boolean;
  retrievalQueries: string[];
  fallbackRecommendedIfRetryFails: boolean;
  failureLabels: string[];
  reason: string;
};

export type SourceGateSector = "bank" | "energy" | "industrial" | "retail" | "technology" | "general";

export type SourceGateInput = {
  ticker: string;
  companyName?: string;
  sector?: SourceGateSector | string | null;
  questionIntent: QuestionIntent;
  question: string;
  previousQuestion?: string;
  previousAnswer?: string;
  conversationContext?: string;
  selectedSources: SourceChunkRecord[];
  metrics?: MetricSnapshot[];
  extractedDriverCandidates?: EvidenceDriver[];
};

const EMPTY_RESULT: SourceGateResult = {
  sourceGateApplied: false,
  hardIntent: null,
  sourceSufficient: true,
  confidence: "high",
  followupTargetFound: null,
  knownFacts: [],
  identifiedDrivers: [],
  missingSourceTypes: [],
  retrievalRetryRecommended: false,
  retrievalQueries: [],
  fallbackRecommendedIfRetryFails: false,
  failureLabels: [],
  reason: "Source gate does not apply to this intent."
};

export function evaluateSourceGate(input: SourceGateInput): SourceGateResult {
  const hardIntent = resolveHardFinancialIntent(input.questionIntent, input.question, input.previousAnswer);
  if (!hardIntent) {
    return EMPTY_RESULT;
  }

  const sector = normalizeSector(input.sector, input.ticker, input.companyName);
  const knownFacts = extractKnownMetricFacts(input.metrics ?? [], input.selectedSources);
  const drivers = extractSupportedDrivers(input.selectedSources, sector, hardIntent);
  const priorDriverFound = hasConcretePriorDriver(input.previousAnswer ?? "", hardIntent);
  const followupTargetFound = hardIntent === "revenue_driver" ? null : priorDriverFound || drivers.length > 0;
  const missingSourceTypes = missingSourceTypesFor(sector, hardIntent, {
    hasMetricMovement: knownFacts.length > 0,
    hasDrivers: drivers.length > 0
  });
  const failureLabels = new Set<string>();

  const hasOnlyMetrics = input.selectedSources.length > 0 && input.selectedSources.every(isMetricSource);
  if (hasOnlyMetrics) {
    failureLabels.add("retrieval_overfocused_xbrl");
  }

  if (drivers.length === 0) {
    failureLabels.add(hardIntent === "margin_durability_followup" ? "margin_driver_slots_empty" : "driver_slots_empty");
  }

  if (missingSourceTypes.length > 0) {
    failureLabels.add("sector_required_source_missing");
  }

  if (hardIntent !== "revenue_driver" && !followupTargetFound) {
    failureLabels.add("followup_target_empty");
  }

  if (hasLowRelevanceSources(input.selectedSources)) {
    failureLabels.add("source_relevance_low");
  }

  const sourceSufficient = hardIntent === "revenue_driver"
    ? knownFacts.length > 0 && drivers.length > 0
    : Boolean(followupTargetFound) && drivers.length > 0 && hasDurabilityEvidence(input.selectedSources, sector, hardIntent);

  if (!sourceSufficient) {
    failureLabels.add("source_gate_failed");
  }

  return {
    sourceGateApplied: true,
    hardIntent,
    sourceSufficient,
    confidence: sourceSufficient ? "medium" : "high",
    followupTargetFound,
    knownFacts,
    identifiedDrivers: drivers,
    missingSourceTypes,
    retrievalRetryRecommended: !sourceSufficient,
    retrievalQueries: !sourceSufficient ? retrievalQueriesFor(input.ticker, sector, hardIntent, missingSourceTypes) : [],
    fallbackRecommendedIfRetryFails: !sourceSufficient,
    failureLabels: [...failureLabels],
    reason: sourceSufficient
      ? "Selected sources include metric movement and company-specific evidence for the hard intent."
      : "Selected sources do not provide enough company-specific evidence for the hard intent."
  };
}

export function resolveHardFinancialIntent(
  questionIntent: QuestionIntent,
  question: string,
  previousAnswer = ""
): HardFinancialIntent | null {
  const normalized = `${question} ${previousAnswer}`.replace(/\s+/g, "").toLowerCase();
  const asksDurability = /(一時|一過性|継続|続く|構造|temporary|transitory|recurring|sustain|continue)/.test(normalized);
  const asksRevenueDriver = /(売上|収益|sales|revenue)/.test(normalized) && /(主因|要因|原因|理由|なぜ|driver|cause|why|伸び|増収|減収)/.test(normalized);
  const asksMargin = /(利益率|マージン|粗利|営業利益率|純利益率|margin|profitability|採算)/.test(normalized);

  if (asksDurability && asksMargin) {
    return "margin_durability_followup";
  }

  if (asksDurability) {
    return "driver_durability_followup";
  }

  if (asksRevenueDriver || questionIntent === "yoy_change") {
    return "revenue_driver";
  }

  return null;
}

export function normalizeSector(
  sector: SourceGateInput["sector"],
  ticker: string,
  companyName = ""
): SourceGateSector {
  const tickerKey = ticker.toUpperCase();
  if (tickerKey === "AAPL") return "technology";
  if (tickerKey === "JPM") return "bank";
  if (tickerKey === "XOM") return "energy";
  if (tickerKey === "CAT") return "industrial";
  if (tickerKey === "WMT") return "retail";

  const haystack = `${sector ?? ""} ${companyName}`.toLowerCase();
  if (/bank|financial|jpmorgan|card|wealth|asset management/.test(haystack)) return "bank";
  if (/energy|oil|gas|exxon|upstream|downstream|refining/.test(haystack)) return "energy";
  if (/industrial|machinery|caterpillar|manufacturing/.test(haystack)) return "industrial";
  if (/retail|walmart|commerce|store|club/.test(haystack)) return "retail";
  if (/technology|software|apple|semiconductor|services/.test(haystack)) return "technology";
  return "general";
}

function extractKnownMetricFacts(metrics: MetricSnapshot[], sources: SourceChunkRecord[]): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  const sourceIds = sources.filter((source) => isMetricSource(source)).map((source) => source.sourceId);
  for (const metric of metrics) {
    if (metric.logicalName !== "revenue" && metric.logicalName !== "netIncome" && metric.logicalName !== "operatingIncome") {
      continue;
    }
    const direction = typeof metric.yoyPercent === "number"
      ? metric.yoyPercent >= 0
        ? "increased"
        : "decreased"
      : "was reported";
    const pct = typeof metric.yoyPercent === "number" ? ` ${Math.abs(metric.yoyPercent).toFixed(1)}% year over year` : "";
    facts.push({
      fact: `${metric.logicalName} ${direction}${pct}.`,
      sourceIds,
      confidence: "high"
    });
  }
  return facts.slice(0, 2);
}

function extractSupportedDrivers(
  sources: SourceChunkRecord[],
  sector: SourceGateSector,
  hardIntent: HardFinancialIntent
): EvidenceDriver[] {
  const drivers: EvidenceDriver[] = [];
  for (const source of sources) {
    if (isMetricSource(source) || isBoilerplateSource(source) || isUnsafeDriverEvidence(source, hardIntent, sector)) {
      continue;
    }
    const text = normalizeText(source.text);
    const category = matchedDriverCategory(text, sector, hardIntent);
    if (!category) {
      continue;
    }
    drivers.push({
      driver: source.text.slice(0, 220).replace(/\s+/g, " ").trim(),
      category,
      sourceIds: [source.sourceId],
      confidence: "medium"
    });
  }
  return drivers.slice(0, 4);
}

function matchedDriverCategory(
  text: string,
  sector: SourceGateSector,
  hardIntent: HardFinancialIntent
): string | null {
  const commonRevenue = /(increase|decrease|growth|decline|higher|lower|primarily due|driven by|attributable to|because|resulted from|net sales|revenue).{0,120}(price|volume|mix|demand|customer|product|service|segment|geographic|foreign exchange|launch)/i;
  const commonMargin = /(margin|profitability|gross profit|operating income|expense|sga|sg&a|r&d|tax|impairment|restructuring|one-time|provision|credit loss|price-cost|manufacturing cost)/i;
  const marginPatterns: Record<SourceGateSector, RegExp> = {
    bank: /(net interest margin|provision for credit losses|noninterest expense|compensation expense|credit quality|funding costs|segment profitability|efficiency ratio)/i,
    energy: /(refining margin|chemical margin|upstream earnings|downstream earnings|costs?|impairment|restructuring|segment earnings|margin)/i,
    industrial: /(price-cost|manufacturing cost|sga|sg&a|r&d|volume leverage|restructuring|segment operating profit|operating margin|profit margin)/i,
    retail: /(gross margin|inventory|markdown|shrink|wage|fulfillment cost|operating expense|membership income|advertising income|segment operating income)/i,
    technology: /(gross margin|product margin|services margin|operating expense|r&d|research and development|channel inventory|mix|pricing|one-time|impairment)/i,
    general: commonMargin
  };
  if (hardIntent === "margin_durability_followup") {
    if (marginPatterns[sector].test(text) || (sector === "general" && commonMargin.test(text))) {
      return `${sector}_margin_driver`;
    }
    return null;
  }

  const patterns: Record<SourceGateSector, RegExp> = {
    bank: /(net interest income|noninterest income|provision for credit losses|segment results|loans|deposits|markets revenue|card revenue|banking fees|asset management fees|net interest margin|noninterest expense|credit quality|funding costs)/i,
    energy: /(commodity prices|crude oil|natural gas|production volume|upstream|downstream|refining margin|chemical margin|product mix|segment results)/i,
    industrial: /(price realization|sales volume|orders|backlog|dealer inventory|manufacturing cost|supply chain|price-cost|segment operating profit|segment results)/i,
    retail: /(comparable sales|comp sales|traffic|ticket|ecommerce|e-commerce|membership|advertising|inventory|gross margin|walmart u\.s\.|walmart international|sam'?s club|segment results)/i,
    technology: /(product revenue|services revenue|geographic revenue|installed base|channel inventory|product launches|unit demand|gross margin|iphone|mac|ipad|wearables|services)/i,
    general: /(segment results|revenue discussion|pricing|volume|mix|orders|backlog|gross margin|operating expenses)/i
  };

  if (patterns[sector].test(text)) {
    return `${sector}_${hardIntent}`;
  }
  if (commonRevenue.test(text)) {
    return "revenue_driver";
  }
  return null;
}

function missingSourceTypesFor(
  sector: SourceGateSector,
  hardIntent: HardFinancialIntent,
  state: { hasMetricMovement: boolean; hasDrivers: boolean }
): string[] {
  if (state.hasDrivers && (hardIntent !== "revenue_driver" || state.hasMetricMovement)) {
    return [];
  }
  const base: Record<SourceGateSector, string[]> = {
    bank: hardIntent === "margin_durability_followup"
      ? ["net interest margin discussion", "provision for credit losses discussion", "noninterest expense discussion", "segment profitability"]
      : ["net interest income discussion", "noninterest income discussion", "provision for credit losses discussion", "segment results"],
    energy: ["commodity price discussion", "production volume discussion", "upstream/downstream segment results", "refining or chemical margin discussion"],
    industrial: hardIntent === "margin_durability_followup"
      ? ["price-cost spread discussion", "manufacturing cost discussion", "SG&A/R&D discussion", "segment margin"]
      : ["price realization discussion", "sales volume discussion", "orders or backlog discussion", "segment results"],
    retail: ["comparable sales discussion", "traffic and ticket discussion", "eCommerce discussion", "membership or advertising discussion", "gross margin or segment results"],
    technology: ["product revenue discussion", "services revenue discussion", "geographic revenue discussion", "product launch or channel inventory discussion"],
    general: ["MD&A driver discussion", "segment results", "revenue or profitability discussion"]
  };
  return base[sector];
}

function retrievalQueriesFor(
  ticker: string,
  sector: SourceGateSector,
  hardIntent: HardFinancialIntent,
  missingSourceTypes: string[]
): string[] {
  const term = missingSourceTypes.slice(0, 3).join(" ");
  const intentTerm = hardIntent === "margin_durability_followup" ? "margin profitability MD&A" : "revenue drivers MD&A";
  const sectorTerm = {
    bank: "net interest income noninterest income provision segment results",
    energy: "commodity prices production volume segment results",
    industrial: "price realization sales volume backlog segment results",
    retail: "comparable sales traffic ticket eCommerce gross margin",
    technology: "product revenue services revenue geographic revenue",
    general: "segment results management discussion"
  }[sector];
  return [
    `${ticker} ${sectorTerm} MD&A`,
    `${ticker} ${intentTerm} ${term}`.trim(),
    `${ticker} management discussion ${sectorTerm}`
  ].map((query) => query.replace(/\s+/g, " ").trim()).slice(0, 3);
}

function hasConcretePriorDriver(previousAnswer: string, hardIntent: HardFinancialIntent): boolean {
  const text = normalizeText(previousAnswer);
  if (
    !text ||
    /(具体的なdriverが十分に特定|要因.*不足|主因.*断定|増収だった.*点まで|利益率.*方向.* known)/i.test(text) ||
    /(前問のdriverは、|利益率driverとして確認できるのは、)\s*[A-Za-z]/.test(text) ||
    /(?:\.{3}|…|•\s*[A-Za-z]|Item\s+7|Part\s+I\.\s*Item|Risk Factors|Results of Operations)/i.test(text) ||
    /価格、数量、需要、コスト、mix|segment composition|セグメント構成.*軸/i.test(text)
  ) {
    return false;
  }
  return hardIntent === "margin_durability_followup"
    ? /(cost|expense|margin|provision|price|mix|volume|impairment|restructuring|費用|コスト|価格|数量|引当|減損|一時費用|sg&a|r&d)/i.test(text)
    : /(due to|driven by|because|price|volume|mix|segment|traffic|ticket|ecommerce|net interest|noninterest|commodity|production|backlog|orders|要因|主因|価格|数量|セグメント|既存店|トラフィック|受注|商品価格)/i.test(text);
}

function hasDurabilityEvidence(
  sources: SourceChunkRecord[],
  sector: SourceGateSector,
  hardIntent: HardFinancialIntent
): boolean {
  return sources.some((source) => {
    const text = normalizeText(source.text);
    return !isMetricSource(source) && !isUnsafeDriverEvidence(source, hardIntent, sector) && (
      /(temporary|transitory|one-time|recurring|seasonal|sustain|continue|demand|risk|outlook|継続|一時|一過性|構造)/i.test(text) ||
      matchedDriverCategory(text, sector, hardIntent) !== null
    );
  });
}

function hasLowRelevanceSources(sources: SourceChunkRecord[]): boolean {
  return sources.length > 0 && sources.every((source) => isMetricSource(source) || isBoilerplateSource(source));
}

function isMetricSource(source: SourceChunkRecord): boolean {
  return source.sectionType === "xbrl_metric" || /xbrl/i.test(source.sourceLabel);
}

function isBoilerplateSource(source: SourceChunkRecord): boolean {
  return /(investor relations website|available information|forward-looking statements|properties|website|http|www\.|trademark|table of contents)/i.test(
    source.text
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
