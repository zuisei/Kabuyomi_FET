import type { MetricSnapshot, SourceChunkRecord } from "../../env";
import { hasStrongRevenueDriverSource } from "../filings/ingest";
import { isUnsafeDriverEvidence } from "./evidence-text-quality";
import type { QuestionIntent } from "./intent";
import { hasRevenueDriverSignal, hasSegmentRevenueSignal } from "./source-family";

export type SourceGateConfidence = "high" | "medium" | "low";
export type HardFinancialIntent = "business_model" | "revenue_driver" | "driver_durability_followup" | "margin_durability_followup";

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

type MarginDurabilitySourceQuality = {
  hasSpecificMarginDriverEvidence: boolean;
  hasSpecificDurabilityEvidence: boolean;
  metricOnlyContext: boolean;
  tableHeavyContext: boolean;
  marginEvidenceTooGeneric: boolean;
  revenueOnlyContext: boolean;
  genericIndustrialContext: boolean;
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
  const drivers = hardIntent === "business_model"
    ? extractBusinessModelDrivers(input.selectedSources, sector)
    : extractSupportedDrivers(input.selectedSources, sector, hardIntent);
  const businessModelCoverage = hardIntent === "business_model"
    ? analyzeBusinessModelCoverage(input.selectedSources, drivers.length > 0)
    : null;
  const hasStrongRevenueDriverEvidence = hardIntent === "revenue_driver"
    ? input.selectedSources.some(hasStrongRevenueDriverSource)
    : false;
  const revenueCoverage = hardIntent === "revenue_driver"
    ? analyzeRevenueDriverCoverage(
        input.metrics ?? [],
        input.selectedSources,
        drivers.length > 0,
        hasStrongRevenueDriverEvidence,
        sector
      )
    : null;
  const priorDriverFound = hasConcretePriorDriver(input.previousAnswer ?? "", hardIntent);
  const sourceRecoveredTargetBlocked = blocksSourceRecoveredFollowupTarget(input.previousAnswer ?? "");
  const explicitFollowupTargetFound = hasConcreteFollowupTarget(input.question, hardIntent);
  const driverDurabilityQuality = hardIntent === "driver_durability_followup"
    ? analyzeDriverDurabilitySourceQuality(input.selectedSources, drivers, sector)
    : null;
  const followupTargetFound = hardIntent === "revenue_driver"
    ? null
    : hardIntent === "driver_durability_followup"
      ? priorDriverFound || explicitFollowupTargetFound || (drivers.length > 0 && !sourceRecoveredTargetBlocked)
      : priorDriverFound || explicitFollowupTargetFound || drivers.length > 0;
  const hasDurabilityContext = hardIntent === "driver_durability_followup" || hardIntent === "margin_durability_followup"
    ? hasDurabilityEvidence(input.selectedSources, sector, hardIntent)
    : false;
  const marginDurabilityQuality = hardIntent === "margin_durability_followup"
    ? analyzeMarginDurabilitySourceQuality(input.selectedSources, drivers, sector)
    : null;
  const missingSourceTypes = missingSourceTypesFor(sector, hardIntent, {
    hasMetricMovement: revenueCoverage?.hasRevenueMetric ?? knownFacts.length > 0,
    hasDrivers: drivers.length > 0,
    hasRevenueDiscussion: revenueCoverage?.hasRevenueDiscussion ?? drivers.length > 0,
    hasSegmentRevenueContext: revenueCoverage?.hasSegmentRevenueContext ?? businessModelCoverage?.hasSegmentOrRevenueContext ?? false,
    hasBusinessDescription: businessModelCoverage?.hasBusinessDescription ?? false
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

  if (
    hardIntent !== "business_model" &&
    hardIntent !== "revenue_driver" &&
    !followupTargetFound
  ) {
    failureLabels.add("followup_target_empty");
    failureLabels.add("missing_followup_target_driver");
  }

  if (hasLowRelevanceSources(input.selectedSources)) {
    failureLabels.add("source_relevance_low");
  }

  if (hardIntent === "revenue_driver") {
    addRevenueDriverQualityFailureLabels(input.selectedSources, sector, drivers.length > 0, hasStrongRevenueDriverEvidence, failureLabels);
  }
  if (hardIntent === "business_model" && !businessModelCoverage?.hasBusinessModelEvidence) {
    failureLabels.add("business_model_sources_missing");
  }
  if (hardIntent === "driver_durability_followup") {
    addDriverDurabilityFailureLabels(input.selectedSources, followupTargetFound, drivers.length > 0, hasDurabilityContext, failureLabels);
    addDriverDurabilitySourceQualityFailureLabels(driverDurabilityQuality, failureLabels);
  }
  if (hardIntent === "margin_durability_followup") {
    addMarginDurabilitySourceQualityFailureLabels(marginDurabilityQuality, failureLabels);
  }

  const sourceSufficient = hardIntent === "business_model"
    ? Boolean(businessModelCoverage?.hasBusinessModelEvidence)
    : hardIntent === "revenue_driver"
      ? Boolean(revenueCoverage?.hasRevenueMetric) && drivers.length > 0 && hasStrongRevenueDriverEvidence
      : hardIntent === "driver_durability_followup"
      ? Boolean(followupTargetFound) &&
        drivers.length > 0 &&
        Boolean(driverDurabilityQuality?.hasStrongDriverEvidence) &&
        Boolean(driverDurabilityQuality?.hasSpecificDurabilityEvidence) &&
        !Boolean(driverDurabilityQuality?.metricOnlyContext) &&
        !Boolean(driverDurabilityQuality?.tableHeavyContext)
      : Boolean(followupTargetFound) && drivers.length > 0 && hasDurabilityContext;
  const marginSourceSufficient = hardIntent === "margin_durability_followup"
    ? Boolean(followupTargetFound) &&
      drivers.length > 0 &&
      hasDurabilityContext &&
      Boolean(marginDurabilityQuality?.hasSpecificMarginDriverEvidence) &&
      Boolean(marginDurabilityQuality?.hasSpecificDurabilityEvidence) &&
      !Boolean(marginDurabilityQuality?.metricOnlyContext) &&
      !Boolean(marginDurabilityQuality?.tableHeavyContext)
    : sourceSufficient;
  const finalSourceSufficient = hardIntent === "margin_durability_followup" ? marginSourceSufficient : sourceSufficient;

  const explicitPriorDriverInsufficiency = !finalSourceSufficient && priorDriverFound && (
    hardIntent === "driver_durability_followup"
      ? hasRevenueFollowupTargetEvidence(input.selectedSources)
      : hardIntent === "margin_durability_followup"
        ? hasMarginFollowupTargetEvidence(input.selectedSources)
        : false
  );
  if (explicitPriorDriverInsufficiency) {
    failureLabels.clear();
    if (hardIntent === "margin_durability_followup") {
      failureLabels.add("missing_margin_durability_context");
    } else {
      failureLabels.add("missing_durability_context");
      failureLabels.add("durability_context_missing");
    }
  }

  if (!finalSourceSufficient) {
    failureLabels.add("source_gate_failed");
  }

  return {
    sourceGateApplied: true,
    hardIntent,
    sourceSufficient: finalSourceSufficient,
    confidence: finalSourceSufficient ? "medium" : "high",
    followupTargetFound,
    knownFacts,
    identifiedDrivers: drivers,
    missingSourceTypes,
    retrievalRetryRecommended: !finalSourceSufficient,
    retrievalQueries: !finalSourceSufficient ? retrievalQueriesFor(input.ticker, sector, hardIntent, missingSourceTypes) : [],
    fallbackRecommendedIfRetryFails: !finalSourceSufficient,
    failureLabels: [...failureLabels],
    reason: finalSourceSufficient
      ? "Selected sources include metric movement and company-specific evidence for the hard intent."
      : "Selected sources do not provide enough company-specific evidence for the hard intent."
  };
}

function blocksSourceRecoveredFollowupTarget(previousAnswer: string): boolean {
  const text = normalizeText(previousAnswer);
  return /our ability to leverage|store and club footprint|business description|available information|corporate website|前問の具体的な.*十分に特定|会社固有の売上要因.*特定でき/i.test(text) ||
    /(?:\.{3}|…|•\s*[A-Za-z]|Item\s+7|Part\s+I\.\s*Item|Risk Factors)/i.test(text);
}

function hasRevenueFollowupTargetEvidence(sources: SourceChunkRecord[]): boolean {
  return sources.some((source) => {
    if (isMetricSource(source)) return false;
    const text = normalizeText(source.text);
    const numericTokens = text.match(/\$?\d[\d,.%]*/g)?.length ?? 0;
    return /(?:products and services performance|sales by category|net sales by category)/i.test(text) &&
      /(?:net sales|revenue)/i.test(text) &&
      numericTokens >= 6;
  });
}

function hasMarginFollowupTargetEvidence(sources: SourceChunkRecord[]): boolean {
  return sources.some((source) => {
    if (isMetricSource(source)) return false;
    const text = normalizeText(source.text);
    return /(?:gross margin|operating margin|profit margin|gross profit|operating income)/i.test(text) &&
      /(?:due to|driven by|reflecting|improved|declined|average selling prices?|favorable mix|manufacturing cost reductions?)/i.test(text);
  });
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
  const asksBusinessModel = questionIntent === "business_overview" ||
    /(何屋|なに屋|何で稼|なにで稼|何で儲|なにで儲|儲けている|儲けてる|稼いでる|稼いでん|なんの会社|何の会社|どんな会社|何してる|何をしてる|事業内容|収益源|businessmodel|whatdoes.*companydo|whatbusiness)/.test(normalizedQuestion);

  if (asksDurability && (asksMargin || questionIntent === "margin_profitability")) {
    return "margin_durability_followup";
  }

  if (asksDurability) {
    return "driver_durability_followup";
  }

  if (asksRevenueDriver || questionIntent === "yoy_change") {
    return "revenue_driver";
  }

  if (asksBusinessModel) {
    return "business_model";
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
  // \bcard\b, not bare "card": the unbounded form matched "mastercard", so MA was
  // classified as a bank and then required net-interest-income and provision-for-
  // credit-losses discussion that its filings do not contain, failing the source
  // gate every time. V, the same business, was already "general". Card revenue /
  // card services still match.
  if (/bank|financial|jpmorgan|\bcard\b/.test(haystack)) return "bank";
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

function extractBusinessModelDrivers(
  sources: SourceChunkRecord[],
  sector: SourceGateSector
): EvidenceDriver[] {
  const drivers: EvidenceDriver[] = [];
  for (const source of sources) {
    if (isMetricSource(source) || isBoilerplateSource(source)) {
      continue;
    }
    const text = normalizeText(`${source.sourceLabel} ${source.text}`);
    if (!hasBusinessModelEvidenceText(text, sector)) {
      continue;
    }
    drivers.push({
      driver: source.text.slice(0, 220).replace(/\s+/g, " ").trim(),
      category: `${sector}_business_model`,
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
  const commonRevenue = /(increase|decrease|growth|grew|decline|higher|lower|primarily due|driven by|attributable to|because|resulted from|net sales|revenue|sales).{0,160}(price|volume|mix|demand|customer|product|service|cloud|subscription|revenue per user|seats?|copilot|unit case|segment|geographic|foreign exchange|launch)/i;
  const commonMargin = /(margin|profitability|gross profit|operating income|expense|sga|sg&a|r&d|tax|impairment|restructuring|one-time|provision|credit loss|price-cost|manufacturing cost|cost of sales|cost of revenues?|price\/mix|price mix|pricing|foreign exchange|tariff|commodity cost|input cost|markdown|shrink|fulfillment|labor|advertising income|membership income|depreciation|traffic acquisition costs?|\btac\b|content acquisition|employee compensation|personnel|marketing|professional fees|litigation)/i;
  const marginPatterns: Record<SourceGateSector, RegExp> = {
    bank: /(net interest margin|deposit margin compression|lower rates?|rate sensitivity|provision for credit losses|credit loss expense|net charge-offs?|noninterest expense|compensation expense|credit quality|funding costs|segment profitability|efficiency ratio)/i,
    capital_markets: /(compensation expense|noninterest expense|investment banking|trading|wealth management|asset management|segment profitability|pre-tax margin)/i,
    energy: /(refining margin|chemical margin|upstream earnings|downstream earnings|upstream spending|capital expenditures?|depreciation|depletion|costs?|impairment|restructuring|segment earnings|margin)/i,
    oilfield_services: /(oilfield services margins?|drilling activity|completion activity|north america margin|international margin|segment operating income|costs?)/i,
    industrial: /(price-cost|manufacturing cost|cost absorption|material costs?|sga|sg&a|r&d|volume leverage|restructuring|warranty|quality costs?|segment operating profit|operating margin|profit margin)/i,
    retail: /(gross margin|inventory|markdown|shrink|wage|labor|fulfillment cost|operating expense|membership income|advertising income|price\/mix|price mix|pricing|segment operating income)/i,
    consumer_staples: /(gross margin|commodity costs?|input costs?|pricing|volume|foreign exchange|advertising expense|organic sales)/i,
    auto: /(automotive gross margin|pricing|production cost|deliveries|warranty|restructuring|average selling price)/i,
    technology: /(gross margin|product margin|services margin|cost of sales|cost of revenues?|operating expense|r&d|research and development|channel inventory|product mix|price-cost|pricing|tariff|foreign exchange|one-time|impairment|depreciation|traffic acquisition costs?|\btac\b|content acquisition|employee compensation)/i,
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
    if (
      !isQ06RevenueOnlyMarginContext(text, sector) &&
      !isQ06GenericMarginContext(text, sector) &&
      (marginPatterns[sector].test(text) || (sector === "general" && commonMargin.test(text)))
    ) {
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
    general: /(segment results|revenue discussion|pricing|volume|unit case volume|mix|orders|backlog|cloud revenue|subscription(?:s)? revenue|revenue per user|seats?|copilot|gross margin|operating income|costs?|cost of revenues?|operating expenses|depreciation|traffic acquisition costs?|\btac\b|content acquisition|employee compensation|personnel|marketing|professional fees|litigation provision)/i
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
    hasBusinessDescription?: boolean;
  }
): string[] {
  if (hardIntent === "business_model") {
    const missing = [];
    if (!state.hasBusinessDescription) missing.push("business description");
    if (!state.hasSegmentRevenueContext) missing.push("segment/revenue context");
    if (!state.hasDrivers) missing.push("product/service/customer/revenue mechanism evidence");
    return missing.length > 0 ? missing : baseMissingSourceTypes(sector, hardIntent);
  }
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
  if (hardIntent === "business_model") {
    return ["business description", "segment/revenue context", "revenue breakdown", "MD&A business discussion"];
  }
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
  hasStrongRevenueDriverEvidence = false,
  sector: SourceGateSector = "general"
): { hasRevenueMetric: boolean; hasRevenueDiscussion: boolean; hasSegmentRevenueContext: boolean } {
  const narrativeSources = sources.filter((source) => !isMetricSource(source) && !isBoilerplateSource(source));
  const hasBankRevenueMovement = (sector === "bank" || sector === "capital_markets") &&
    narrativeSources.some((source) => hasPeriodSpecificBankRevenueMovement(source.text));
  const hasRevenueMetric = metrics.some((metric) => metric.logicalName === "revenue") ||
    sources.some((source) => isMetricSource(source) && /(売上|revenue|sales|net interest income|noninterest income)/i.test(source.text)) ||
    hasBankRevenueMovement;
  return {
    hasRevenueMetric,
    hasRevenueDiscussion: hasStrongRevenueDriverEvidence || hasDrivers || narrativeSources.some(hasRevenueDriverSignal),
    hasSegmentRevenueContext: narrativeSources.some(hasSegmentRevenueSignal)
  };
}

function hasPeriodSpecificBankRevenueMovement(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  const hasRevenueComponent = /(?:total\s+net\s+revenue|net\s+interest\s+income|noninterest\s+(?:revenue|income)|markets\s+revenue)/i.test(normalized);
  const hasMovement = /(?:up|down|increase(?:d)?|decrease(?:d)?|grew|declined|compared|\d+(?:\.\d+)?\s*%)/i.test(normalized);
  const hasPeriod = /(?:20\d{2}|quarter|three\s+months|six\s+months|fiscal|prior\s+year|year-over-year|(?:up|down)\s+\d+(?:\.\d+)?\s*%)/i.test(normalized);
  return hasRevenueComponent && hasMovement && hasPeriod;
}

function analyzeBusinessModelCoverage(
  sources: SourceChunkRecord[],
  hasDrivers: boolean
): { hasBusinessDescription: boolean; hasSegmentOrRevenueContext: boolean; hasBusinessModelEvidence: boolean } {
  const narrativeSources = sources.filter((source) => !isMetricSource(source) && !isBoilerplateSource(source));
  const haystack = narrativeSources.map((source) => `${source.sourceLabel} ${source.text}`).join(" ");
  const hasBusinessDescription = /(business|overview|company|products?|services?|事業|製品|サービス|会社|segment information)/i.test(haystack);
  const hasSegmentOrRevenueContext = narrativeSources.some((source) => {
    const text = `${source.sourceLabel} ${source.text}`;
    return hasSegmentRevenueSignal(source) || /(segment|revenue|net sales|sales by|product line|service line|売上|セグメント|内訳)/i.test(text);
  });
  return {
    hasBusinessDescription,
    hasSegmentOrRevenueContext,
    hasBusinessModelEvidence: hasDrivers && (hasBusinessDescription || hasSegmentOrRevenueContext)
  };
}

function hasBusinessModelEvidenceText(text: string, sector: SourceGateSector): boolean {
  const businessLine = /(products?|services?|segments?|customers?|end[- ]markets?|revenue|net sales|sales|manufactures?|designs?|sells?|provides?|operates?|retail|stores?|membership|subscription|fees?|interest income|loans?|deposits?|製品|サービス|顧客|需要|向け|販売|提供|運営|手数料|金利|貸出|預金|店舗|会員|売上|収益|事業)/i;
  const sectorSpecific: Record<SourceGateSector, RegExp> = {
    bank: /(net interest income|noninterest income|loans?|deposits?|card|banking|asset management|investment banking|markets)/i,
    capital_markets: /(investment banking|trading|wealth management|asset management|advisory|underwriting)/i,
    energy: /(upstream|downstream|crude|natural gas|refining|chemical|production|commodity)/i,
    oilfield_services: /(drilling|completion|oilfield services|customer spending|north america|international)/i,
    industrial: /(construction industries|resource industries|energy & transportation|machinery|equipment|dealer|end users?)/i,
    retail: /(walmart u\.s\.|sam'?s club|stores?|ecommerce|e-commerce|membership|grocery|health and wellness|general merchandise)/i,
    consumer_staples: /(oral care|personal care|pet nutrition|home care|organic sales)/i,
    auto: /(vehicles?|automotive|deliveries|energy generation|services)/i,
    technology: /(iphone|mac|ipad|wearables|services|products?|installed base|app store|applecare|cloud services)/i,
    software: /(subscription|customers?|usage|rpo|deferred revenue|cloud|saas)/i,
    semiconductor_equipment: /(wafer fab|semiconductor equipment|orders|backlog|customer demand)/i,
    healthcare_medtech: /(procedure volume|installed base|systems placements|instruments|accessories|recurring)/i,
    reit: /(occupancy|same-store|senior housing|medical office|rental revenue|noi)/i,
    media: /(advertising|affiliate|retransmission|subscriber|content|distribution)/i,
    utility: /(regulated|electric|rate case|load|customers?|fuel cost)/i,
    mining: /(copper|gold|production volume|mining|commodity)/i,
    general: businessLine
  };
  return businessLine.test(text) && sectorSpecific[sector].test(text);
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
  const intentTerm = hardIntent === "business_model"
    ? "business description products services revenue breakdown"
    : hardIntent === "margin_durability_followup" ? "margin profitability MD&A" : "revenue drivers MD&A";
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
  const hasConcreteRevenueDriver = hasPriorRevenueDriverTerms(text);
  if (
    !text ||
    (/(具体的なdriverが十分に特定|十分に特定できていません|特定できていません|会社固有の売上要因は十分|要因.*不足|主因.*断定|増収だった.*点まで|利益率.*方向.* known)/i.test(text) && !hasConcreteRevenueDriver) ||
    /(前問のdriverは、|利益率driverとして確認できるのは、)\s*[A-Za-z]/.test(text) ||
    /(?:\.{3}|…|•\s*[A-Za-z]|Item\s+7|Part\s+I\.\s*Item|Risk Factors|Results of Operations)/i.test(text) ||
    /our ability to leverage|store and club footprint|business description|available information|corporate website/i.test(text) ||
    /価格、数量、需要、コスト、mix|segment composition|セグメント構成.*軸/i.test(text)
  ) {
    return false;
  }
  return hardIntent === "margin_durability_followup"
    ? hasPriorMarginDriverTerms(text)
    : hasConcreteRevenueDriver;
}

function hasConcreteFollowupTarget(question: string, hardIntent: HardFinancialIntent): boolean {
  const text = normalizeText(question);
  if (!text || !/(一時|一過性|継続|続き|構造|temporary|transitory|continue|continued|sustain|recurring)/i.test(text)) {
    return false;
  }
  if (hardIntent === "margin_durability_followup") {
    return /(利益率|粗利|営業利益率|純利益率|マージン|margin|profitability)/i.test(text) && hasPriorMarginDriverTerms(text);
  }
  return /(net interest income|nii|noninterest income|noninterest revenue|nir|markets revenue|investment banking|card services|deposits?|services revenue|installed base|iphone|mac|ipad|wearables|foreign exchange|tariff|commodity|crude|natural gas|production volume|refining margin|sales volume|price realization|dealer inventor|backlog|comparable sales|transactions?|traffic|ticket|ecommerce|membership|売上高の要因（[^）]{3,}|地域別売上|製品カテゴリ|サービス売上|販売量|販売数量|出荷量|価格実現|既存店|客数|客単価)/i.test(text);
}

function hasPriorMarginDriverTerms(text: string): boolean {
  return /(gross margin|operating margin|profit margin|net margin|margin rate|cost of sales|cost of revenues?|cost of revenue|operating expenses?|noninterest expense|compensation expense|provision for credit losses|credit loss expense|efficiency ratio|deposit margin compression|net interest margin|gross profit|operating income|segment operating profit|manufacturing costs?|cost absorption|price-cost|volume leverage|markdowns?|shrink|inventory|fulfillment costs?|labor costs?|wage|refining margins?|chemical margins?|depreciation|depletion|impairment|restructuring|traffic acquisition costs?|\btac\b|content acquisition|employee compensation|personnel|marketing|professional fees|litigation|sg&a|sga|r&d|research and development|粗利|販管費|営業費用|費用|コスト|引当|減損|一時費用|交通獲得コスト|トラフィック獲得コスト|コンテンツ調達費|人件費|訴訟引当|専門家費用|マーケティング費)/i.test(text);
}

function hasPriorRevenueDriverTerms(text: string): boolean {
  return /(due to|driven by|because|price|pricing|volume|mix|segment|traffic|ticket|ecommerce|services|installed base|data center|accelerated computing|\bai\b|blackwell|compute|networking|supply constraint|customer mix|cloud|copilot|revenue per user|seats grew|microsoft 365|net interest|nii|noninterest|nir|markets revenue|investment banking|commodity|production|backlog|orders|demand|価格|価格実現|数量|販売量|販売数量|出荷量|品目構成|製品構成|製品カテゴリ|地域別売上|地域別|セグメント|既存店|トラフィック|客数|客単価|サービス|サービス売上|受注|商品価格|金利収入|非金利収入|データセンター|加速型計算|顧客構成|供給制約|需要|需給|ブラックウェル|ネットワーク|クラウド|製品カテゴリ|製品|コパイロット)/i.test(text);
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
    /(temporary|transitory|one-time|seasonal|recurring|continue|continued|sustain|expected|expects|outlook|guidance|trend|uncertain|uncertainty|risk|sensitivity|headwind|tailwind|normalize|normalization|cloud revenue|revenue per user|copilot|seats grew|strong demand|unit case volume growth|demand for our products|average selling prices?|bit shipments?|favorable mix|product mix|manufacturing cost reductions?|customer usage|unit sales|継続|一時|一過性|構造|見通し|不確実|感応度)/i;
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
    semiconductor_equipment: /(orders|backlog|customer demand|china|wafer fab equipment|expected|outlook|demand|average selling prices?|bit shipments?|favorable mix|product mix)/i,
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
  const tableHeavyDominates =
    narrativeSources.length > 0 &&
    narrativeSources.filter(isQ04MetricOrTableHeavySource).length >= Math.ceil(narrativeSources.length / 2);
  const hasNonTableSourceBackedDurability =
    strongDriverSources.length > 0 &&
    specificDurabilitySources.length > 0;

  return {
    hasStrongDriverEvidence: strongDriverSources.length > 0,
    hasSpecificDurabilityEvidence: specificDurabilitySources.length > 0,
    metricOnlyContext: narrativeSources.length === 0,
    tableHeavyContext: (tableHeavyDriverSources.length > 0 || tableHeavyDominates) && !hasNonTableSourceBackedDurability,
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

function analyzeMarginDurabilitySourceQuality(
  sources: SourceChunkRecord[],
  drivers: EvidenceDriver[],
  sector: SourceGateSector
): MarginDurabilitySourceQuality {
  const narrativeSources = sources.filter((source) => !isMetricSource(source));
  const driverSourceIds = new Set(drivers.flatMap((driver) => driver.sourceIds));
  const driverSources = narrativeSources.filter((source) => driverSourceIds.has(source.sourceId));
  const tableHeavyDriverSources = driverSources.filter(isQ06MetricOrTableHeavySource);
  const specificMarginDriverSources = driverSources.filter((source) =>
    !isQ06MetricOrTableHeavySource(source) &&
    !isQ06GenericMarginContext(source.text, sector) &&
    hasQ06ConcreteMarginDriverSignal(source.text, sector)
  );
  const specificDurabilitySources = narrativeSources.filter((source) =>
    !isQ06MetricOrTableHeavySource(source) &&
    !isQ06GenericMarginContext(source.text, sector) &&
    hasSpecificQ06MarginDurabilitySignal(source.text, sector)
  );
  const genericMarginSources = narrativeSources.filter((source) =>
    !isQ06MetricOrTableHeavySource(source) &&
    matchedDriverCategory(normalizeText(source.text), sector, "margin_durability_followup") !== null &&
    !hasQ06ConcreteMarginDriverSignal(source.text, sector)
  );
  const revenueOnlySources = narrativeSources.filter((source) => isQ06RevenueOnlyMarginContext(source.text, sector));
  const hasNonTableSourceBackedMargin =
    specificMarginDriverSources.length > 0 && specificDurabilitySources.length > 0;

  return {
    hasSpecificMarginDriverEvidence: specificMarginDriverSources.length > 0,
    hasSpecificDurabilityEvidence: specificDurabilitySources.length > 0,
    metricOnlyContext: narrativeSources.length === 0,
    tableHeavyContext: !hasNonTableSourceBackedMargin && (tableHeavyDriverSources.length > 0 || (
      narrativeSources.length > 0 &&
      narrativeSources.filter(isQ06MetricOrTableHeavySource).length >= Math.ceil(narrativeSources.length / 2)
    )),
    marginEvidenceTooGeneric: genericMarginSources.length > 0 && specificMarginDriverSources.length === 0,
    revenueOnlyContext: revenueOnlySources.length > 0 && specificMarginDriverSources.length === 0,
    genericIndustrialContext: sector === "industrial" &&
      narrativeSources.some((source) => isQ06GenericMarginContext(source.text, sector)) &&
      specificMarginDriverSources.length === 0
  };
}

function addMarginDurabilitySourceQualityFailureLabels(
  quality: MarginDurabilitySourceQuality | null,
  failureLabels: Set<string>
): void {
  if (!quality) {
    return;
  }
  if (quality.metricOnlyContext) {
    failureLabels.add("margin_context_xbrl_only");
  }
  if (quality.tableHeavyContext) {
    failureLabels.add("margin_context_table_heavy");
  }
  if (!quality.hasSpecificMarginDriverEvidence) {
    failureLabels.add("missing_margin_driver_evidence");
  }
  if (!quality.hasSpecificDurabilityEvidence) {
    failureLabels.add("missing_margin_durability_context");
  }
  if (quality.marginEvidenceTooGeneric) {
    failureLabels.add("margin_durability_evidence_too_generic");
  }
  if (quality.revenueOnlyContext) {
    failureLabels.add("q06_margin_context_revenue_only");
  }
  if (quality.genericIndustrialContext) {
    failureLabels.add("q06_margin_context_generic_industrial");
  }
}

function isQ06MetricOrTableHeavySource(source: SourceChunkRecord): boolean {
  if (isMetricSource(source)) {
    return true;
  }
  const text = normalizeText(`${source.sectionTitle} ${source.sourceLabel} ${source.text}`);
  const numberTokens = text.match(/\$?\d[\d,.%]*/g)?.length ?? 0;
  const hasTableCue =
    /\b(?:three months ended|year ended|gross margin percentage|gross margin|operating margin|operating expenses?|dollars in millions|percentage of total net sales|total gross margin)\b/i.test(text) ||
    /\|\s*q[1-4]\s+20\d{2}\s+form\s+10-[qk]\s+\|/i.test(text);
  const hasNarrativeCause = /(primarily due to|driven by|attributable to|resulted from|because|reflect(?:ed|ing)|partially offset|offset by|expected|outlook|continue|continued|risk|uncertain|one-time|temporary|restructuring|impairment)/i.test(text);
  return hasTableCue && numberTokens >= 8 && !hasNarrativeCause;
}

function isQ06GenericMarginContext(text: string, sector: SourceGateSector): boolean {
  const normalized = normalizeText(text);
  if (/(forward-looking statements|business description|properties|opened our first|store footprint|corporate website|available information)/i.test(normalized)) {
    return true;
  }
  if (sector === "industrial" && /customers? in developing economies.*purchase price|product portfolio includes|construction machinery varies around the world|owning and operating costs over the lifetime/i.test(normalized)) {
    return true;
  }
  if (sector === "technology" && /(tariff|foreign exchange|component pricing|macroeconomic conditions)/i.test(normalized) &&
    !/(gross margin|operating margin|cost of sales|operating expense|net sales|products gross margin|services gross margin)/i.test(normalized)) {
    return true;
  }
  return false;
}

function isQ06RevenueOnlyMarginContext(text: string, sector: SourceGateSector): boolean {
  const normalized = normalizeText(text);
  const revenueOnly =
    /(net sales|sales and revenues|revenue|comparable sales|transactions?|traffic|ticket|ecommerce|e-commerce|membership engagement|sales volume|equipment to end users|demand|unit volumes?)/i.test(normalized) &&
    !/(gross margin|operating margin|profit margin|gross profit|operating income|segment operating profit|cost of sales|cost of revenues?|cost of revenue|operating expenses?|noninterest expense|provision for credit losses|credit loss expense|efficiency ratio|deposit margin compression|manufacturing costs?|cost absorption|price-cost|price\/mix|price mix|pricing|commodity costs?|input costs?|volume leverage|markdowns?|shrink|inventory|fulfillment costs?|labor costs?|wage|advertising income|membership income|refining margins?|chemical margins?|depreciation|depletion|impairment|restructuring|tariff|foreign exchange|traffic acquisition costs?|\btac\b|content acquisition|employee compensation|personnel|marketing|professional fees|litigation)/i.test(normalized);
  if (revenueOnly) {
    return true;
  }
  if (sector === "industrial" && /(sales and revenues|sales volume|price realization|equipment to end users)/i.test(normalized) &&
    !/(margin|profit|cost|expense|price-cost|manufacturing|volume leverage|cost absorption|segment operating)/i.test(normalized)) {
    return true;
  }
  if (sector === "retail" && /(comparable sales|transactions?|traffic|ticket|ecommerce|e-commerce|membership engagement|unit volumes?)/i.test(normalized) &&
    !/(gross margin|markdown|shrink|inventory|fuel|fulfillment|operating expense|wage|labor|advertising income|membership income|price\/mix|price mix|pricing|segment operating)/i.test(normalized)) {
    return true;
  }
  if (sector === "bank" && /(net interest income|noninterest income|nii|nir|markets revenue|investment banking fees|asset management fees|payments fees)/i.test(normalized) &&
    !/(net interest margin|deposit margin compression|provision|credit loss|noninterest expense|compensation expense|efficiency ratio|profitability|margin)/i.test(normalized)) {
    return true;
  }
  return false;
}

function hasQ06ConcreteMarginDriverSignal(text: string, sector: SourceGateSector): boolean {
  const normalized = normalizeText(text);
  if (isQ06MetricOrTableText(normalized) || isQ06GenericMarginContext(normalized, sector) || isQ06RevenueOnlyMarginContext(normalized, sector)) {
    return false;
  }
  const common =
    /(gross margin|operating margin|profit margin|gross profit|operating income|cost of sales|cost of revenues?|cost of revenue|costs?|expenses?|operating expenses?|pricing|price realization|price\/mix|price mix|mix|volume|sales volume|input costs?|commodity costs?|manufacturing cost|sg&a|r&d|research and development|provision|credit losses?|impairment|restructuring|depreciation|depletion|tariff|foreign exchange|inventory|markdown|shrink|fulfillment|fuel|labor|wage|advertising income|membership income|traffic acquisition costs?|\btac\b|content acquisition|employee compensation|personnel|marketing|professional fees|litigation)/i;
  const sectorSpecific: Record<SourceGateSector, RegExp> = {
    bank: /(net interest margin|deposit margin compression|provision for credit losses|noninterest expense|compensation expense|efficiency ratio|credit quality|funding costs)/i,
    capital_markets: /(compensation expense|noninterest expense|pre-tax margin|segment profitability|trading|investment banking|asset management)/i,
    energy: /(depreciation|depletion|upstream spending|capital expenditures?|refining margins?|chemical margins?|upstream earnings|downstream earnings|impairment|restructuring|costs?)/i,
    oilfield_services: /(oilfield services margins?|north america margin|international margin|segment operating income|costs?|drilling activity|completion activity)/i,
    industrial: /(price-cost|manufacturing cost|price realization|sales volume|volume leverage|sg&a|r&d|segment operating profit|operating margin|dealer inventory)/i,
    retail: /(gross margin|inventory|markdown|shrink|wage|labor|fulfillment cost|operating expense|membership income|advertising income|price\/mix|price mix|pricing|segment operating income|fuel)/i,
    consumer_staples: /(gross margin|commodity costs?|input costs?|pricing|volume|foreign exchange|advertising expense|organic sales)/i,
    auto: /(automotive gross margin|pricing|production cost|warranty|deliveries|average selling price|restructuring)/i,
    technology: /(gross margin|product margin|services margin|cost of sales|cost of revenues?|operating expense|r&d|research and development|channel inventory|mix|pricing|tariff|foreign exchange|component pricing|depreciation|traffic acquisition costs?|\btac\b|content acquisition|employee compensation)/i,
    software: /(gross margin|operating margin|sales and marketing|r&d|research and development|infrastructure costs?|usage|subscription)/i,
    semiconductor_equipment: /(gross margin|operating expenses?|backlog|orders|customer demand|china|restructuring)/i,
    healthcare_medtech: /(gross margin|procedure volume|systems placements|instruments|accessories|operating expense|installed base)/i,
    reit: /(net operating income|\bnoi\b|occupancy|same-store|interest expense|operating expenses?|segment margin)/i,
    media: /(content costs?|sports rights|advertising revenue|affiliate fees|operating expense|segment ebitda)/i,
    utility: /(fuel cost|operating expenses?|rate case|regulated returns|interest expense|capex|capital expenditures)/i,
    mining: /(unit costs?|copper price|gold price|production volume|mining costs?|operating margin)/i,
    general: common
  };
  return common.test(normalized) || sectorSpecific[sector].test(normalized);
}

function hasSpecificQ06MarginDurabilitySignal(text: string, sector: SourceGateSector): boolean {
  const normalized = normalizeText(text);
  if (isQ06MetricOrTableText(normalized) || isQ06GenericMarginContext(normalized, sector) || isQ06RevenueOnlyMarginContext(normalized, sector)) {
    return false;
  }
  const common =
    /(temporary|transitory|one-time|recurring|continue|continued|expected|expects|outlook|guidance|trend|uncertain|uncertainty|risk|headwind|tailwind|seasonal|normalization|structural|restructuring|impairment|depreciation|depletion|capital expenditures?|tariff|foreign exchange|fuel|inventory|cost pressure|price\/mix|price mix|pricing|commodity costs?|input costs?|markdown|shrink|fulfillment|labor|wage|advertising income|membership income|cost of revenues?|traffic acquisition costs?|\btac\b|content acquisition|employee compensation|personnel|marketing|professional fees|litigation provision)/i;
  const sectorSpecific: Record<SourceGateSector, RegExp> = {
    bank: /(deposit margin compression|lower rates?|higher rates?|interest rate sensitivity|credit normalization|provision for credit losses|funding costs|efficiency ratio)/i,
    capital_markets: /(cyclical|client activity|compensation expense|trading revenue|investment banking fees|markets revenue)/i,
    energy: /(depreciation|depletion|upstream spending|capital expenditures?|commodity price sensitivity|refining margins?|chemical margins?|impairment|restructuring|outlook|expected)/i,
    oilfield_services: /(customer spending|drilling activity|completion activity|north america activity|international activity|outlook|expected|costs?)/i,
    industrial: /(dealer inventor(?:y|ies)|backlog|orders|expected|expects|stronger sales|manufacturing cost|end-market demand)/i,
    retail: /(continued strength|inventory|markdown|shrink|wage|fulfillment cost|membership|advertising|fuel|expected|expects|transactions?|unit volumes?)/i,
    consumer_staples: /(commodity costs?|input costs?|pricing|volume|foreign exchange|continued|expected|outlook)/i,
    auto: /(deliveries|production volume|vehicle pricing|average selling price|automotive gross margin|expected|outlook|demand)/i,
    technology: /(services margin|product margin|channel inventory|tariff|foreign exchange|component pricing|product launch|expected|outlook|recurring|cost of revenues?|depreciation|traffic acquisition costs?|\btac\b|content acquisition|employee compensation)/i,
    software: /(subscription|recurring|infrastructure costs?|usage|customers?|expected|outlook)/i,
    semiconductor_equipment: /(orders|backlog|customer demand|china|expected|outlook|restructuring)/i,
    healthcare_medtech: /(procedure volume|installed base|recurring|systems placements|expected|outlook)/i,
    reit: /(occupancy|same-store|noi|interest rates?|lease|renewal|expected|outlook)/i,
    media: /(content costs?|sports rights|advertising|subscriber|cyclical|expected|outlook)/i,
    utility: /(rate case|regulated returns|load growth|weather|fuel cost|expected|outlook|capex)/i,
    mining: /(copper price|gold price|production volume|unit cost|commodity price|expected|outlook)/i,
    general: /(temporary|one-time|recurring|continue|continued|expected|outlook|risk|uncertain|restructuring|impairment)/
  };
  return common.test(normalized) || sectorSpecific[sector].test(normalized);
}

function isQ06MetricOrTableText(text: string): boolean {
  return (
    /\b(?:three months ended|year ended|gross margin percentage|dollars in millions|percentage of total net sales|total gross margin|operating expenses?)\b/i.test(text) ||
    /(products?|services).{0,80}gross margin/i.test(text)
  ) && !/(primarily due to|driven by|attributable to|resulted from|because|reflect(?:ed|ing)|expected|outlook|continue|continued|risk|uncertain|temporary|one-time|restructuring|impairment)/i.test(text);
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
  const hasNarrativeCause =
    /(primarily due to|driven by|attributable to|resulted from|because|reflect(?:ed|ing)|partially offset|offset by|expected|outlook|continue|continued|risk|uncertain|one-time|temporary)/i.test(text);
  const isProductMarginTable =
    /(products?|services).{0,80}gross margin/i.test(text) &&
    !/(increased|decreased|primarily due|driven by|attributable to|resulted from|because|expected|outlook|continue|continued)/i.test(text);
  return (hasTableCue && numberTokens >= 8 && !hasNarrativeCause) || isProductMarginTable;
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
    /(primarily due to|driven by|attributable to|resulted from|because|reflect(?:ed|ing)|sales and revenues|net sales|revenue increased|revenue decreased|higher sales|lower sales|comparable sales|transactions?|traffic|ticket|ecommerce|e-commerce|membership|sales volume|price realization|net interest income|noninterest income|commodity prices?|production volume|refining margins?|services revenue|cloud revenue|subscription(?:s)? revenue|revenue per user|unit case volume|installed base|channel inventory|product introductions?|foreign exchange|tariff)/i;
  return common.test(normalized) || matchedDriverCategory(normalized, sector, "driver_durability_followup") !== null;
}

function hasSpecificQ04DurabilitySignal(text: string, sector: SourceGateSector): boolean {
  const normalized = normalizeText(text);
  if (isQ04MetricOrTableText(normalized) || isQ04GenericDurabilityContext(normalized)) {
    return false;
  }
  const common =
    /(continue|continued|recurring|expected|expects|outlook|guidance|trend|uncertain|uncertainty|risk|headwind|tailwind|seasonal|one-time|temporary|transitory|normalization|subscription(?:s)? revenue|cloud revenue|revenue per user|copilot|seats grew|strong demand|unit case volume growth|long-term growth rate|competitive environment|average selling prices?|bit shipments?|favorable mix|product mix|manufacturing cost reductions?|customer usage|unit sales|感応度|見通し|不確実|一時|継続)/i;
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
    semiconductor_equipment: /(orders|backlog|customer demand|china|wafer fab equipment|expected|outlook|demand|average selling prices?|bit shipments?|favorable mix|product mix)/i,
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
  ) && !/(primarily due to|driven by|attributable to|resulted from|because|reflect(?:ed|ing)|partially offset|offset by|expected|outlook|continue|continued|risk|uncertain|one-time|temporary)/i.test(text);
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
  if (/(unit case volume|demand for our products|cloud revenue|revenue per user|seats grew|driven by|primarily due|attributable to)/i.test(source.text)) {
    return false;
  }
  return /(investor relations website|available information|forward-looking statements|properties|website|http|www\.|trademark|table of contents)/i.test(
    source.text
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
