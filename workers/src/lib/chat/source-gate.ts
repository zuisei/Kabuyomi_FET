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

type DriverDurabilitySourceQuality = {
  hasStrongDriverEvidence: boolean;
  hasSpecificDurabilityEvidence: boolean;
  metricOnlyContext: boolean;
  tableHeavyContext: boolean;
  durabilityEvidenceTooGeneric: boolean;
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
  const explicitFollowupTargetFound = hasConcreteFollowupTarget(input.question, hardIntent);
  const followupTargetFound = hardIntent === "revenue_driver"
    ? null
    : hardIntent === "driver_durability_followup"
      ? priorDriverFound || explicitFollowupTargetFound
      : priorDriverFound || explicitFollowupTargetFound || drivers.length > 0;
  const hasDurabilityContext = hardIntent === "driver_durability_followup" || hardIntent === "margin_durability_followup"
    ? hasDurabilityEvidence(input.selectedSources, sector, hardIntent)
    : false;
  const driverDurabilityQuality = hardIntent === "driver_durability_followup"
    ? analyzeDriverDurabilitySourceQuality(input.selectedSources, drivers, sector)
    : null;
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
    failureLabels.add("missing_followup_target_driver");
  }

  if (hasLowRelevanceSources(input.selectedSources)) {
    failureLabels.add("source_relevance_low");
  }

  if (hardIntent === "revenue_driver") {
    addRevenueDriverQualityFailureLabels(input.selectedSources, sector, drivers.length > 0, hasStrongRevenueDriverEvidence, failureLabels);
  }
  if (hardIntent === "driver_durability_followup") {
    addDriverDurabilityFailureLabels(input.selectedSources, followupTargetFound, drivers.length > 0, hasDurabilityContext, failureLabels);
    addDriverDurabilitySourceQualityFailureLabels(driverDurabilityQuality, failureLabels);
  }

  const sourceSufficient = hardIntent === "revenue_driver"
    ? Boolean(revenueCoverage?.hasRevenueMetric) && drivers.length > 0 && hasStrongRevenueDriverEvidence
    : hardIntent === "driver_durability_followup"
      ? Boolean(followupTargetFound) &&
        drivers.length > 0 &&
        Boolean(driverDurabilityQuality?.hasStrongDriverEvidence) &&
        Boolean(driverDurabilityQuality?.hasSpecificDurabilityEvidence) &&
        !Boolean(driverDurabilityQuality?.metricOnlyContext) &&
        !Boolean(driverDurabilityQuality?.tableHeavyContext)
      : Boolean(followupTargetFound) && drivers.length > 0 && hasDurabilityContext;

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
  const normalizedQuestion = question.replace(/\s+/g, "").toLowerCase();
  const normalized = `${question} ${previousAnswer}`.replace(/\s+/g, "").toLowerCase();
  const asksDurability = /(一時|一過性|継続|続く|構造|temporary|transitory|recurring|sustain|continue)/.test(normalized);
  const asksRevenueDriver = /(売上|収益|sales|revenue)/.test(normalized) && /(主因|要因|原因|理由|なぜ|driver|cause|why|伸び|増収|減収)/.test(normalized);
  const asksMargin = /(利益率|マージン|粗利|営業利益率|純利益率|margin|profitability|採算)/.test(normalizedQuestion);

  if (asksDurability && (asksMargin || questionIntent === "margin_profitability")) {
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
  sector: SourceGateSector,
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
  if (sector === "energy") {
    addEnergyRevenueDriverFailureLabels(narrativeText, hasStrongRevenueDriverEvidence, failureLabels);
  }
}

function addEnergyRevenueDriverFailureLabels(
  narrativeText: string,
  hasStrongRevenueDriverEvidence: boolean,
  failureLabels: Set<string>
): void {
  if (!narrativeText.trim()) {
    failureLabels.add("energy_xbrl_only");
    return;
  }
  if (/(proved reserves?|reserve disclosures?)/i.test(narrativeText)) {
    failureLabels.add("energy_reserve_context_not_revenue_driver");
  }
  if (
    /(long[- ]term|over the long term|market supply and demand|general economic activities|levels of prosperity|technology advances|consumer preference|government policies|production sharing contracts?|price effects on production sharing contracts|energy transition|risk factors?)/i.test(narrativeText)
  ) {
    failureLabels.add("energy_revenue_driver_context_too_broad");
  }
  if (!hasStrongRevenueDriverEvidence) {
    failureLabels.add("missing_energy_period_result_driver");
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
    /(具体的なdriverが十分に特定|十分に特定できていません|特定できていません|会社固有の売上要因は十分|要因.*不足|主因.*断定|増収だった.*点まで|利益率.*方向.* known)/i.test(text) ||
    /(前問のdriverは、|利益率driverとして確認できるのは、)\s*[A-Za-z]/.test(text) ||
    /(?:\.{3}|…|•\s*[A-Za-z]|Item\s+7|Part\s+I\.\s*Item|Risk Factors|Results of Operations)/i.test(text) ||
    /our ability to leverage|store and club footprint|business description|available information|corporate website/i.test(text) ||
    /価格、数量、需要、コスト、mix|segment composition|セグメント構成.*軸/i.test(text)
  ) {
    return false;
  }
  return hardIntent === "margin_durability_followup"
    ? /(cost|expense|margin|provision|price|mix|volume|impairment|restructuring|費用|コスト|価格|数量|引当|減損|一時費用|sg&a|r&d)/i.test(text)
    : /(due to|driven by|because|price|pricing|volume|mix|segment|traffic|ticket|ecommerce|services|installed base|net interest|nii|noninterest|nir|markets revenue|investment banking|commodity|production|backlog|orders|要因|主因|価格|価格実現|数量|販売量|品目構成|セグメント|既存店|トラフィック|客数|客単価|サービス|受注|商品価格|金利収入|非金利収入)/i.test(text);
}

function hasConcreteFollowupTarget(question: string, hardIntent: HardFinancialIntent): boolean {
  const text = normalizeText(question);
  if (!text || !/(一時|一過性|継続|続き|構造|temporary|transitory|continue|continued|sustain|recurring)/i.test(text)) {
    return false;
  }
  if (hardIntent === "margin_durability_followup") {
    return /(gross margin|operating margin|margin|cost|expense|pricing|mix|volume|利益率|粗利|営業利益率|費用|コスト|価格|数量)/i.test(text);
  }
  return /(net interest income|nii|noninterest income|noninterest revenue|nir|markets revenue|investment banking|card services|deposits?|services revenue|installed base|iphone|mac|ipad|wearables|foreign exchange|tariff|commodity|crude|natural gas|production volume|refining margin|sales volume|price realization|dealer inventor|backlog|comparable sales|transactions?|traffic|ticket|ecommerce|membership|売上高の要因（[^）]{3,})/i.test(text);
}

function hasDurabilityEvidence(
  sources: SourceChunkRecord[],
  sector: SourceGateSector,
  hardIntent: HardFinancialIntent
): boolean {
  return sources.some((source) => {
    const text = normalizeText(source.text);
    if (isMetricSource(source) || isUnsafeDriverEvidence(source, hardIntent, sector)) {
      return false;
    }
    if (hardIntent !== "driver_durability_followup") {
      return /(temporary|transitory|one-time|recurring|seasonal|sustain|continue|demand|risk|outlook|継続|一時|一過性|構造)/i.test(text) ||
        matchedDriverCategory(text, sector, hardIntent) !== null;
    }
    return hasDriverDurabilitySignal(text, sector);
  });
}

function hasDriverDurabilitySignal(text: string, sector: SourceGateSector): boolean {
  const common =
    /(temporary|transitory|one-time|seasonal|recurring|continue|continued|sustain|expected|expects|outlook|guidance|trend|uncertain|uncertainty|risk|sensitivity|headwind|tailwind|normalize|normalization|継続|一時|一過性|構造|見通し|不確実|感応度)/i;
  const sectorPatterns: Record<SourceGateSector, RegExp> = {
    bank: /(deposit margin compression|lower rates?|higher rates?|interest rate sensitivity|credit normalization|card balances|revolving balances|investment banking fees|markets revenue|cyclical|wholesale deposit balances|net interest income excluding markets|flat when compared)/i,
    capital_markets: /(investment banking fees|trading revenue|markets revenue|asset management fees|wealth management|cyclical|advisory|underwriting|client activity)/i,
    energy: /(commodity price sensitivity|crude prices?|natural gas prices?|production volumes?|refining margins?|chemical margins?|upstream|downstream|price realizations?|outlook|expected)/i,
    oilfield_services: /(customer spending|drilling activity|completion activity|north america activity|international activity|outlook|expected|backlog)/i,
    industrial: /(backlog|orders|dealer inventor(?:y|ies)|stronger sales|expected|expects|end-market demand|inventory to increase)/i,
    retail: /(continued strength|ecommerce|e-commerce|membership|member engagement|omnichannel|grocery|health and wellness|expected|expects)/i,
    consumer_staples: /(organic sales|pricing|volume|foreign exchange|commodity costs?|input costs?|continued|expected|outlook)/i,
    auto: /(deliveries|production volume|vehicle pricing|average selling price|automotive gross margin|expected|outlook|demand)/i,
    technology: /(services revenue|installed base|product introduction|product launch|channel inventory|macroeconomic conditions|tariff|foreign exchange|component pricing|recurring|continue|expected|outlook)/i,
    software: /(subscription|recurring|rpo|remaining performance obligations|deferred revenue|retention|usage|customers?|expected|outlook)/i,
    semiconductor_equipment: /(orders|backlog|customer demand|china|wafer fab equipment|expected|outlook|demand)/i,
    healthcare_medtech: /(procedure volume|installed base|recurring|instruments|accessories|systems placements|expected|outlook)/i,
    reit: /(occupancy|same-store|noi|interest rates?|lease|renewal|expected|outlook)/i,
    media: /(advertising revenue|affiliate revenue|subscriber|distribution|sports rights|cyclical|expected|outlook)/i,
    utility: /(rate case|regulated returns|load growth|weather|fuel cost|expected|outlook|capex)/i,
    mining: /(copper price|gold price|production volume|unit cost|commodity price|expected|outlook)/i,
    general: /(recurring|continue|continued|sustain|expected|outlook|backlog|orders|risk|uncertain|temporary|one-time)/i
  };
  return common.test(text) || sectorPatterns[sector].test(text);
}

function analyzeDriverDurabilitySourceQuality(
  sources: SourceChunkRecord[],
  drivers: EvidenceDriver[],
  sector: SourceGateSector
): DriverDurabilitySourceQuality {
  const narrativeSources = sources.filter((source) => !isMetricSource(source));
  const driverSourceIds = new Set(drivers.flatMap((driver) => driver.sourceIds));
  const driverSources = narrativeSources.filter((source) => driverSourceIds.has(source.sourceId));
  const tableHeavyDriverSources = driverSources.filter(isQ04MetricOrTableHeavySource);
  const strongDriverSources = driverSources.filter((source) =>
    !isQ04MetricOrTableHeavySource(source) &&
    !isQ04GenericDurabilityContext(source.text) &&
    hasQ04ConcreteDriverSignal(source.text, sector)
  );
  const specificDurabilitySources = narrativeSources.filter((source) =>
    !isQ04MetricOrTableHeavySource(source) &&
    hasSpecificQ04DurabilitySignal(source.text, sector)
  );
  const genericDurabilitySources = narrativeSources.filter((source) =>
    !isQ04MetricOrTableHeavySource(source) &&
    hasDriverDurabilitySignal(normalizeText(source.text), sector) &&
    !hasSpecificQ04DurabilitySignal(source.text, sector)
  );

  return {
    hasStrongDriverEvidence: strongDriverSources.length > 0,
    hasSpecificDurabilityEvidence: specificDurabilitySources.length > 0,
    metricOnlyContext: narrativeSources.length === 0,
    tableHeavyContext: tableHeavyDriverSources.length > 0 || (
      narrativeSources.length > 0 &&
      narrativeSources.filter(isQ04MetricOrTableHeavySource).length >= Math.ceil(narrativeSources.length / 2)
    ),
    durabilityEvidenceTooGeneric: genericDurabilitySources.length > 0 && specificDurabilitySources.length === 0
  };
}

function addDriverDurabilitySourceQualityFailureLabels(
  quality: DriverDurabilitySourceQuality | null,
  failureLabels: Set<string>
): void {
  if (!quality) {
    return;
  }
  if (quality.metricOnlyContext) {
    failureLabels.add("q04_metric_only_context");
  }
  if (quality.tableHeavyContext) {
    failureLabels.add("q04_table_heavy_context");
  }
  if (!quality.hasStrongDriverEvidence) {
    failureLabels.add("q04_driver_evidence_too_generic");
  }
  if (!quality.hasSpecificDurabilityEvidence) {
    failureLabels.add("durability_context_missing");
  }
  if (quality.durabilityEvidenceTooGeneric) {
    failureLabels.add("q04_durability_evidence_too_generic");
  }
}

function isQ04MetricOrTableHeavySource(source: SourceChunkRecord): boolean {
  if (isMetricSource(source)) {
    return true;
  }
  const text = normalizeText(`${source.sectionTitle} ${source.sourceLabel} ${source.text}`);
  const numberTokens = text.match(/\$?\d[\d,.%]*/g)?.length ?? 0;
  const hasTableCue =
    /\b(?:three months ended|year ended|gross margin percentage|dollars in millions|percentage of total net sales|total gross margin|operating expenses?)\b/i.test(text) ||
    /\|\s*q[1-4]\s+20\d{2}\s+form\s+10-[qk]\s+\|/i.test(text);
  const isProductMarginTable =
    /(products?|services).{0,80}gross margin/i.test(text) &&
    !/(increased|decreased|primarily due|driven by|attributable to|resulted from|because|expected|outlook|continue|continued)/i.test(text);
  return (hasTableCue && numberTokens >= 8) || isProductMarginTable;
}

function isQ04GenericDurabilityContext(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    /(forward-looking statements|private securities litigation reform act|current expectations of future events|assumptions and other factors|available information|corporate website|business description|opened our first|store footprint|properties)/i.test(normalized) ||
    (/(macroeconomic conditions|tariff|foreign exchange|currency fluctuations|interest rates?|inflation|component pricing)/i.test(normalized) &&
      !/(net sales|revenue|sales|services revenue|product revenue|iphone|mac|ipad|wearables|installed base|channel inventory).{0,180}(macroeconomic|tariff|foreign exchange|currency|inflation|interest|component pricing)|(?:macroeconomic|tariff|foreign exchange|currency|inflation|interest|component pricing).{0,180}(net sales|revenue|sales|services revenue|product revenue|iphone|mac|ipad|wearables|installed base|channel inventory)/i.test(normalized))
  );
}

function hasQ04ConcreteDriverSignal(text: string, sector: SourceGateSector): boolean {
  const normalized = normalizeText(text);
  if (isQ04GenericDurabilityContext(normalized)) {
    return false;
  }
  const common =
    /(primarily due to|driven by|attributable to|resulted from|because|reflect(?:ed|ing)|sales and revenues|net sales|revenue increased|revenue decreased|higher sales|lower sales|comparable sales|transactions?|traffic|ticket|ecommerce|e-commerce|membership|sales volume|price realization|net interest income|noninterest income|commodity prices?|production volume|refining margins?|services revenue|installed base|channel inventory|product introductions?|foreign exchange|tariff)/i;
  return common.test(normalized) || matchedDriverCategory(normalized, sector, "driver_durability_followup") !== null;
}

function hasSpecificQ04DurabilitySignal(text: string, sector: SourceGateSector): boolean {
  const normalized = normalizeText(text);
  if (isQ04MetricOrTableText(normalized) || isQ04GenericDurabilityContext(normalized)) {
    return false;
  }
  const common =
    /(continue|continued|recurring|expected|expects|outlook|guidance|trend|uncertain|uncertainty|risk|headwind|tailwind|seasonal|one-time|temporary|transitory|normalization|感応度|見通し|不確実|一時|継続)/i;
  const sectorSpecific: Record<SourceGateSector, RegExp> = {
    bank: /(deposit margin compression|lower rates?|higher rates?|interest rate sensitivity|card balances|revolving balances|investment banking fees|markets revenue|cyclical|wholesale deposit balances|flat when compared)/i,
    capital_markets: /(investment banking fees|trading revenue|markets revenue|asset management fees|client activity|cyclical|advisory|underwriting)/i,
    energy: /(commodity price sensitivity|crude prices?|natural gas prices?|production volumes?|refining margins?|chemical margins?|upstream|downstream|outlook|expected)/i,
    oilfield_services: /(customer spending|drilling activity|completion activity|north america activity|international activity|outlook|expected|backlog)/i,
    industrial: /(backlog|orders|dealer inventor(?:y|ies)|stronger sales|expected|expects|end-market demand|inventory to increase)/i,
    retail: /(continued strength|ecommerce|e-commerce|membership|member engagement|omnichannel|grocery|health and wellness|expected|expects|transactions?|unit volumes?)/i,
    consumer_staples: /(organic sales|pricing|volume|foreign exchange|commodity costs?|input costs?|continued|expected|outlook)/i,
    auto: /(deliveries|production volume|vehicle pricing|average selling price|automotive gross margin|expected|outlook|demand)/i,
    technology: /(services revenue|installed base|product introduction|product launch|channel inventory|macroeconomic conditions|tariff|foreign exchange|component pricing|recurring|continue|expected|outlook)/i,
    software: /(subscription|recurring|rpo|remaining performance obligations|deferred revenue|retention|usage|customers?|expected|outlook)/i,
    semiconductor_equipment: /(orders|backlog|customer demand|china|wafer fab equipment|expected|outlook|demand)/i,
    healthcare_medtech: /(procedure volume|installed base|recurring|instruments|accessories|systems placements|expected|outlook)/i,
    reit: /(occupancy|same-store|noi|interest rates?|lease|renewal|expected|outlook)/i,
    media: /(advertising revenue|affiliate revenue|subscriber|distribution|sports rights|cyclical|expected|outlook)/i,
    utility: /(rate case|regulated returns|load growth|weather|fuel cost|expected|outlook|capex)/i,
    mining: /(copper price|gold price|production volume|unit cost|commodity price|expected|outlook)/i,
    general: /(recurring|continue|continued|sustain|expected|outlook|backlog|orders|risk|uncertain|temporary|one-time)/i
  };
  return common.test(normalized) || sectorSpecific[sector].test(normalized);
}

function isQ04MetricOrTableText(text: string): boolean {
  return (
    /\b(?:three months ended|year ended|gross margin percentage|dollars in millions|percentage of total net sales|total gross margin|operating expenses?)\b/i.test(text) ||
    /(products?|services).{0,80}gross margin/i.test(text)
  ) && !/(primarily due to|driven by|expected|outlook|continue|continued|risk|uncertain)/i.test(text);
}

function addDriverDurabilityFailureLabels(
  sources: SourceChunkRecord[],
  followupTargetFound: boolean | null,
  hasDrivers: boolean,
  hasDurabilityContext: boolean,
  failureLabels: Set<string>
): void {
  const narrativeText = sources.filter((source) => !isMetricSource(source)).map((source) => source.text).join(" ");
  if (!followupTargetFound) {
    failureLabels.add("missing_followup_target_driver");
  }
  if (!hasDurabilityContext) {
    failureLabels.add("missing_durability_context");
    failureLabels.add("durability_context_missing");
  }
  if (followupTargetFound && hasDrivers && !hasDurabilityContext) {
    failureLabels.add("driver_supported_but_durability_unclear");
  }
  if (
    narrativeText.trim() &&
    /(risk factors?|forward-looking statements?|long[- ]term|strategy|history|available information|properties|website|market supply and demand|general economic activities)/i.test(narrativeText) &&
    !hasDurabilityContext
  ) {
    failureLabels.add("durability_context_too_generic");
  }
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
