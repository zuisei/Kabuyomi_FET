import type { MetricSnapshot, SourceChunkRecord } from "../../env";
import { hasStrongRevenueDriverSource } from "../filings/ingest";
import { isUnsafeDriverEvidence } from "./evidence-text-quality";
import type { QuestionIntent } from "./intent";
import { hasRevenueDriverSignal, hasSegmentRevenueSignal } from "./source-family";

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

export type SourceGateSector =
  | "bank"
  | "capital_markets"
  | "energy"
  | "oilfield_services"
  | "industrial"
  | "retail"
  | "consumer_staples"
  | "auto"
  | "technology"
  | "software"
  | "semiconductor_equipment"
  | "healthcare_medtech"
  | "reit"
  | "media"
  | "utility"
  | "mining"
  | "general";

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
  const hasStrongRevenueDriverEvidence = hardIntent === "revenue_driver"
    ? input.selectedSources.some(hasStrongRevenueDriverSource)
    : false;
  const revenueCoverage = hardIntent === "revenue_driver"
    ? analyzeRevenueDriverCoverage(input.metrics ?? [], input.selectedSources, drivers.length > 0, hasStrongRevenueDriverEvidence)
    : null;
  const priorDriverFound = hasConcretePriorDriver(input.previousAnswer ?? "", hardIntent);
  const followupTargetFound = hardIntent === "revenue_driver" ? null : priorDriverFound || drivers.length > 0;
  const missingSourceTypes = missingSourceTypesFor(sector, hardIntent, {
    hasMetricMovement: revenueCoverage?.hasRevenueMetric ?? knownFacts.length > 0,
    hasDrivers: drivers.length > 0,
    hasRevenueDiscussion: revenueCoverage?.hasRevenueDiscussion ?? drivers.length > 0,
    hasSegmentRevenueContext: revenueCoverage?.hasSegmentRevenueContext ?? false
  });
  const failureLabels = new Set<string>();

  const hasOnlyMetrics = input.selectedSources.length > 0 && input.selectedSources.every(isMetricSource);
  if (hasOnlyMetrics) {
    failureLabels.add("retrieval_overfocused_xbrl");
    if (hardIntent === "revenue_driver") {
      failureLabels.add("xbrl_only_revenue_driver");
    }
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

  if (hardIntent === "revenue_driver") {
    addRevenueDriverQualityFailureLabels(input.selectedSources, drivers.length > 0, hasStrongRevenueDriverEvidence, failureLabels);
  }

  const sourceSufficient = hardIntent === "revenue_driver"
    ? Boolean(revenueCoverage?.hasRevenueMetric) && drivers.length > 0 && hasStrongRevenueDriverEvidence
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
  if (tickerKey === "NET") return "software";
  if (tickerKey === "KLAC") return "semiconductor_equipment";
  if (tickerKey === "MS") return "capital_markets";
  if (tickerKey === "ISRG") return "healthcare_medtech";
  if (tickerKey === "HAL") return "oilfield_services";
  if (tickerKey === "DE") return "industrial";
  if (tickerKey === "TSLA") return "auto";
  if (tickerKey === "CL") return "consumer_staples";
  if (tickerKey === "VTR") return "reit";
  if (tickerKey === "FOXA") return "media";
  if (tickerKey === "AEP") return "utility";
  if (tickerKey === "FCX") return "mining";

  const haystack = `${sector ?? ""} ${companyName}`.toLowerCase();
  if (/capital markets|broker|wealth|asset management|investment banking|trading|morgan stanley/.test(haystack)) return "capital_markets";
  if (/bank|financial|jpmorgan|card/.test(haystack)) return "bank";
  if (/oilfield|halliburton|drilling|completion/.test(haystack)) return "oilfield_services";
  if (/energy|oil|gas|exxon|upstream|downstream|refining/.test(haystack)) return "energy";
  if (/semiconductor|wafer|kla|equipment/.test(haystack)) return "semiconductor_equipment";
  if (/software|cloudflare|subscription|cloud|saas/.test(haystack)) return "software";
  if (/healthcare|medical|medtech|surgical|intuitive/.test(haystack)) return "healthcare_medtech";
  if (/reit|real estate|senior housing|medical office|ventas/.test(haystack)) return "reit";
  if (/media|broadcast|affiliate|advertising|fox/.test(haystack)) return "media";
  if (/utility|regulated|electric|american electric|rate case/.test(haystack)) return "utility";
  if (/mining|copper|gold|freeport|materials/.test(haystack)) return "mining";
  if (/auto|automotive|tesla|vehicle/.test(haystack)) return "auto";
  if (/consumer staples|organic sales|colgate|household|pet nutrition/.test(haystack)) return "consumer_staples";
  if (/industrial|machinery|caterpillar|manufacturing|deere|agriculture/.test(haystack)) return "industrial";
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
    if (
      isMetricSource(source) ||
      isBoilerplateSource(source) ||
      isUnsafeDriverEvidence(source, hardIntent, sector) ||
      (hardIntent === "revenue_driver" && !hasStrongRevenueDriverSource(source))
    ) {
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
    capital_markets: /(compensation expense|noninterest expense|investment banking|trading|wealth management|asset management|segment profitability|pre-tax margin)/i,
    energy: /(refining margin|chemical margin|upstream earnings|downstream earnings|costs?|impairment|restructuring|segment earnings|margin)/i,
    oilfield_services: /(oilfield services margins?|drilling activity|completion activity|north america margin|international margin|segment operating income|costs?)/i,
    industrial: /(price-cost|manufacturing cost|sga|sg&a|r&d|volume leverage|restructuring|segment operating profit|operating margin|profit margin)/i,
    retail: /(gross margin|inventory|markdown|shrink|wage|fulfillment cost|operating expense|membership income|advertising income|segment operating income)/i,
    consumer_staples: /(gross margin|commodity costs?|input costs?|pricing|volume|foreign exchange|advertising expense|organic sales)/i,
    auto: /(automotive gross margin|pricing|production cost|deliveries|warranty|restructuring|average selling price)/i,
    technology: /(gross margin|product margin|services margin|operating expense|r&d|research and development|channel inventory|mix|pricing|one-time|impairment)/i,
    software: /(gross margin|operating margin|sales and marketing|r&d|research and development|infrastructure costs?|usage|subscription)/i,
    semiconductor_equipment: /(gross margin|operating expenses?|backlog|orders|customer demand|china|restructuring)/i,
    healthcare_medtech: /(gross margin|procedure volume|systems placements|instruments|accessories|operating expense|installed base)/i,
    reit: /(net operating income|\bnoi\b|occupancy|same-store|interest expense|operating expenses?|segment margin)/i,
    media: /(content costs?|sports rights|advertising revenue|affiliate fees|operating expense|segment ebitda)/i,
    utility: /(fuel cost|operating expenses?|rate case|regulated returns|interest expense|capex|capital expenditures)/i,
    mining: /(unit costs?|copper price|gold price|production volume|mining costs?|operating margin)/i,
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
    capital_markets: /(investment banking|trading|asset management|wealth management|institutional securities|advisory|underwriting|net interest income|segment results)/i,
    energy: /(commodity prices|crude oil|natural gas|production volume|upstream|downstream|refining margin|chemical margin|product mix|segment results)/i,
    oilfield_services: /(drilling activity|completion activity|oilfield services|north america|international activity|customer spending|segment results|oilfield services margins?)/i,
    industrial: /(price realization|sales volume|orders|backlog|dealer inventory|manufacturing cost|supply chain|price-cost|segment operating profit|segment results)/i,
    retail: /(comparable sales|comp sales|traffic|ticket|ecommerce|e-commerce|membership|advertising|inventory|gross margin|walmart u\.s\.|walmart international|sam'?s club|segment results)/i,
    consumer_staples: /(pricing|volume|foreign exchange|organic sales|gross margin|commodity costs?|input costs?|oral care|pet nutrition|segment results)/i,
    auto: /(deliveries|vehicle pricing|automotive gross margin|production volume|average selling price|energy generation|services revenue|segment results)/i,
    technology: /((net sales|revenue|sales).{0,160}(iphone|mac|ipad|wearables|services|geographic|product revenue|services revenue|channel inventory)|(iphone|mac|ipad|wearables|services).{0,100}(net sales|revenue|sales)|installed base|channel inventory|unit demand|gross margin)/i,
    software: /(subscription revenue|usage|customers?|rpo|remaining performance obligations|deferred revenue|retention|expansion|customer growth)/i,
    semiconductor_equipment: /(orders|backlog|wafer fab equipment|customer demand|china|semiconductor equipment|segment results)/i,
    healthcare_medtech: /(procedure volume|installed base|systems placements|instruments|accessories|recurring revenue|healthcare utilization|segment results)/i,
    reit: /(occupancy|same-store|net operating income|\bnoi\b|senior housing|medical office|rental revenue|segment results)/i,
    media: /(advertising revenue|affiliate revenue|retransmission|subscriber|content costs?|distribution|segment results)/i,
    utility: /(rate case|regulated returns|fuel cost|load growth|weather|regulated operations|capex|capital expenditures)/i,
    mining: /(copper price|gold price|production volume|unit costs?|mining operations|commodity prices|segment results)/i,
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
  state: {
    hasMetricMovement: boolean;
    hasDrivers: boolean;
    hasRevenueDiscussion?: boolean;
    hasSegmentRevenueContext?: boolean;
  }
): string[] {
  if (state.hasDrivers && (hardIntent !== "revenue_driver" || state.hasMetricMovement)) {
    return [];
  }
  if (hardIntent === "revenue_driver") {
    const missing = [];
    if (!state.hasMetricMovement) missing.push("revenue metric");
    if (!state.hasRevenueDiscussion) missing.push("MD&A revenue discussion");
    if (!state.hasSegmentRevenueContext) missing.push("segment/revenue context");
    return missing.length > 0 ? [...missing, ...baseMissingSourceTypes(sector, hardIntent)] : baseMissingSourceTypes(sector, hardIntent);
  }
  return baseMissingSourceTypes(sector, hardIntent);
}

function baseMissingSourceTypes(sector: SourceGateSector, hardIntent: HardFinancialIntent): string[] {
  const base: Record<SourceGateSector, string[]> = {
    bank: hardIntent === "margin_durability_followup"
      ? ["net interest margin discussion", "provision for credit losses discussion", "noninterest expense discussion", "segment profitability"]
      : ["net interest income discussion", "noninterest income discussion", "provision for credit losses discussion", "segment results"],
    capital_markets: hardIntent === "margin_durability_followup"
      ? ["compensation expense discussion", "noninterest expense discussion", "segment profitability", "trading or investment banking profitability"]
      : ["investment banking revenue discussion", "trading revenue discussion", "wealth management revenue discussion", "segment results"],
    energy: ["commodity price discussion", "production volume discussion", "upstream/downstream segment results", "refining or chemical margin discussion"],
    oilfield_services: ["drilling activity discussion", "completion activity discussion", "North America/international activity", "oilfield services segment results"],
    industrial: hardIntent === "margin_durability_followup"
      ? ["price-cost spread discussion", "manufacturing cost discussion", "SG&A/R&D discussion", "segment margin"]
      : ["price realization discussion", "sales volume discussion", "orders or backlog discussion", "segment results"],
    retail: ["comparable sales discussion", "traffic and ticket discussion", "eCommerce discussion", "membership or advertising discussion", "gross margin or segment results"],
    consumer_staples: ["pricing discussion", "volume discussion", "foreign exchange discussion", "organic sales or gross margin discussion"],
    auto: ["deliveries discussion", "vehicle pricing discussion", "automotive gross margin discussion", "production volume or segment results"],
    technology: ["product revenue discussion", "services revenue discussion", "geographic revenue discussion", "product launch or channel inventory discussion"],
    software: ["subscription revenue discussion", "usage or customer growth discussion", "RPO or deferred revenue discussion", "retention or expansion discussion"],
    semiconductor_equipment: ["orders or backlog discussion", "wafer fab equipment demand discussion", "China exposure discussion", "segment results"],
    healthcare_medtech: ["procedure volume discussion", "installed base discussion", "systems placements discussion", "recurring instruments/accessories revenue"],
    reit: ["occupancy discussion", "same-store NOI discussion", "senior housing or medical office results", "debt maturity or interest rate discussion"],
    media: ["advertising revenue discussion", "affiliate or retransmission revenue discussion", "content cost discussion", "segment results"],
    utility: ["rate case discussion", "regulated returns discussion", "fuel cost discussion", "load growth or weather discussion"],
    mining: ["copper price discussion", "gold price discussion", "production volume discussion", "unit cost or mining operations discussion"],
    general: ["MD&A driver discussion", "segment results", "revenue or profitability discussion"]
  };
  return base[sector];
}

function analyzeRevenueDriverCoverage(
  metrics: MetricSnapshot[],
  sources: SourceChunkRecord[],
  hasDrivers: boolean,
  hasStrongRevenueDriverEvidence = false
): { hasRevenueMetric: boolean; hasRevenueDiscussion: boolean; hasSegmentRevenueContext: boolean } {
  const hasRevenueMetric = metrics.some((metric) => metric.logicalName === "revenue") ||
    sources.some((source) => isMetricSource(source) && /(売上|revenue|sales|net interest income|noninterest income)/i.test(source.text));
  const narrativeSources = sources.filter((source) => !isMetricSource(source) && !isBoilerplateSource(source));
  return {
    hasRevenueMetric,
    hasRevenueDiscussion: hasStrongRevenueDriverEvidence || hasDrivers || narrativeSources.some(hasRevenueDriverSignal),
    hasSegmentRevenueContext: narrativeSources.some(hasSegmentRevenueSignal)
  };
}

function addRevenueDriverQualityFailureLabels(
  sources: SourceChunkRecord[],
  hasDrivers: boolean,
  hasStrongRevenueDriverEvidence: boolean,
  failureLabels: Set<string>
): void {
  const narrativeSources = sources.filter((source) => !isMetricSource(source));
  const narrativeText = narrativeSources.map((source) => source.text).join(" ");
  if (/item\s+2\.?\s+properties|headquarters|office locations?|square footage/i.test(narrativeText)) {
    failureLabels.add("selected_properties_not_revenue_driver");
  }
  if (
    /(business description|opened our first|began our first international|store footprint|remodeling existing locations|available information|corporate website|history)/i.test(narrativeText)
  ) {
    failureLabels.add("selected_business_description_not_period_driver");
  }
  if (narrativeSources.length > 0 && (!hasDrivers || !hasStrongRevenueDriverEvidence)) {
    failureLabels.add("revenue_driver_evidence_too_generic");
  }
  if (!hasStrongRevenueDriverEvidence) {
    failureLabels.add("missing_revenue_driver_narrative");
  }
  if (!narrativeSources.some(hasSegmentRevenueSignal)) {
    failureLabels.add("missing_segment_revenue_context");
  }
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
    capital_markets: "investment banking trading wealth management segment results",
    energy: "commodity prices production volume segment results",
    oilfield_services: "drilling activity completion activity oilfield services segment results",
    industrial: "price realization sales volume backlog segment results",
    retail: "comparable sales traffic ticket eCommerce gross margin",
    consumer_staples: "pricing volume foreign exchange organic sales gross margin",
    auto: "deliveries pricing automotive gross margin production volume",
    technology: "product revenue services revenue geographic revenue",
    software: "subscription revenue usage customers RPO deferred revenue",
    semiconductor_equipment: "orders backlog wafer fab equipment customer demand",
    healthcare_medtech: "procedure volume installed base systems placements recurring revenue",
    reit: "occupancy same-store NOI segment results",
    media: "advertising revenue affiliate revenue retransmission segment results",
    utility: "rate case regulated returns fuel cost load growth",
    mining: "copper price gold price production volume unit costs",
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
  if (hasRevenueDriverSignal(source)) {
    return false;
  }
  return /(investor relations website|available information|forward-looking statements|properties|website|http|www\.|trademark|table of contents)/i.test(
    source.text
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
