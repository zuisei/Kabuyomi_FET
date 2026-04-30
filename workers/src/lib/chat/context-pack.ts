import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../../env";
import {
  businessContextPattern,
  isAccountingEstimateRiskDistractor,
  revenueDriverPattern,
  riskContextPattern
} from "./context-patterns";
import type { QuestionIntent } from "./intent";

export type ChatContextPackMode = "standard" | "expanded" | "compact";

export interface ChatContextPack {
  questionIntent: QuestionIntent;
  contentMode: "full" | "metrics_only";
  metrics: MetricSnapshot[];
  factualPack?: ChatFactualPack;
  sourceChunks: SourceChunkRecord[];
  contextTokenBudget: number;
  selectedSourceCount: number;
  sourceSelectionStrategy: string;
  selectionDiagnostics: ChatContextSelectionDiagnostics;
}

export interface ChatFactualPack {
  kind: "business_overview" | "revenue_breakdown" | "risk_factors";
  companyName: string;
  ticker: string;
  formType: "10-K" | "10-Q";
  periodOfReport: string;
  productsServices?: string[];
  reportableSegments?: string[];
  revenueCategories?: RevenueFact[];
  riskCategories?: string[];
  largestRevenueCategory?: string;
  sourceIds: string[];
  missingFields: string[];
}

export interface RevenueFact {
  label: string;
  amount?: string;
  yoyChange?: string;
  sourceId?: string;
  kind: "segment" | "product_service" | "geography" | "company_total";
}

export interface ChatContextSelectionDiagnostics {
  candidateSourceCount: number;
  selectedSourceCount: number;
  selectedSourceCharCount: number;
  avgSelectedSourceChars: number;
  contextTokenBudget: number;
  estimatedContextTokens: number;
  sourceSelectionStrategy: string;
  rejectedShortCount: number;
  rejectedTableFragmentCount: number;
  rejectedLowTextQualityCount: number;
  sectionHitCountBusiness: number;
  sectionHitCountRisk: number;
  sectionHitCountMda: number;
}

export interface BuildChatContextPackOptions {
  mode?: ChatContextPackMode;
  retryReason?: string;
}

interface ContextProfile {
  tokenBudget: number;
  minSources: number;
  maxSources: number;
  supplementalSources: number;
  sourceExcerptChars: number;
  supplementalWindowChars: number;
}

interface RankedSource {
  chunk: SourceChunkRecord;
  score: number;
}

interface NarrativeQuality {
  charCount: number;
  wordCount: number;
  sentenceCount: number;
  digitRatio: number;
  textRatio: number;
  isShort: boolean;
  isTableFragment: boolean;
  isTableBoilerplate: boolean;
  isHeadingOnly: boolean;
  isLowTextQuality: boolean;
  isBoilerplate: boolean;
  isMeaningful: boolean;
}

type MutableSelectionDiagnostics = ChatContextSelectionDiagnostics;

const TOKEN_TO_CHAR_BUDGET_RATIO = 4;
const SUPPLEMENTAL_SOURCE_PREFIX = "CTX";

export function buildChatContextPack(
  filing: FilingCacheRecord,
  questionIntent: QuestionIntent,
  options: BuildChatContextPackOptions = {}
): ChatContextPack {
  const mode = options.mode ?? "standard";
  const profile = contextProfile(questionIntent, mode);
  const metrics = selectIntentMetrics(filing.metrics, questionIntent);
  const factualPack = buildChatFactualPack(filing, questionIntent);
  const selected = new Map<string, SourceChunkRecord>();
  const strategyParts: string[] = [questionIntent, mode];
  const diagnostics = createSelectionDiagnostics(filing, profile);

  const add = (chunk: SourceChunkRecord | undefined) => {
    if (chunk) {
      selected.set(chunk.sourceId, chunk);
    }
  };

  const rankedIntentSources = rankIntentSources(filing.sourceChunks, questionIntent, diagnostics);
  const shouldUseRiskSecondarySearch = questionIntent === "risk_factors" && rankedIntentSources.length === 0;
  if (shouldUseRiskSecondarySearch) {
    strategyParts.push("risk_secondary");
  } else {
    strategyParts.push("intent_ranked");
  }

  addFactualPackSourceIds(filing.sourceChunks, factualPack, add);

  if (shouldLeadWithMetrics(questionIntent)) {
    addMetricSources(filing.sourceChunks, metrics, add);
    addRankedSources(rankedIntentSources, add, profile.maxSources);
  } else if (shouldLeadWithDriverNarrative(questionIntent)) {
    addRankedSources(rankedIntentSources, add, profile.maxSources);
    for (const supplemental of buildSupplementalContextChunks(
      filing,
      questionIntent,
      selected,
      profile,
      diagnostics
    )) {
      add(supplemental);
    }
    addMetricSources(filing.sourceChunks, metrics, add);
  } else {
    addRankedSources(rankedIntentSources, add, profile.maxSources);
    addMetricSources(filing.sourceChunks, metrics, add);
  }

  if (!shouldLeadWithDriverNarrative(questionIntent)) {
    for (const supplemental of buildSupplementalContextChunks(
      filing,
      questionIntent,
      selected,
      profile,
      diagnostics
    )) {
      add(supplemental);
    }
  }

  if (!hasSelectedNarrative(selected)) {
    for (const chunk of rankDefaultSources(filing.sourceChunks)) {
      if (
        chunk.sectionType === "md_a" &&
        !isOffIntentRiskNarrative(questionIntent, `${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`)
      ) {
        add(chunk);
        break;
      }
    }
  }

  if (selected.size < profile.minSources) {
    for (const chunk of rankDefaultSources(filing.sourceChunks)) {
      if (chunk.sectionType === "md_a" && isOffIntentRiskNarrative(questionIntent, `${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`)) {
        continue;
      }
      add(chunk);
      if (selected.size >= profile.minSources) {
        break;
      }
    }
  }

  removeRiskDistractorSources(selected, questionIntent);

  const expandedChunks = filterExpandedRiskDistractorSources(
    filing,
    questionIntent,
    expandSelectedSourceChunks(
      filing,
      orderSelectedSources([...selected.values()], questionIntent).slice(0, profile.maxSources),
      questionIntent,
      profile
    )
  );
  const selectedChunks = trimToBudget(expandedChunks, profile.tokenBudget);
  const sourceSelectionStrategy = strategyParts.join(":");
  const selectionDiagnostics = finalizeSelectionDiagnostics(diagnostics, selectedChunks, profile, sourceSelectionStrategy);
  return {
    questionIntent,
    contentMode: resolveContentMode(filing),
    metrics,
    factualPack,
    sourceChunks: selectedChunks,
    contextTokenBudget: profile.tokenBudget,
    selectedSourceCount: selectedChunks.length,
    sourceSelectionStrategy,
    selectionDiagnostics
  };
}

function removeRiskDistractorSources(selected: Map<string, SourceChunkRecord>, questionIntent: QuestionIntent): void {
  for (const [sourceId, source] of selected) {
    if (
      source.sectionType === "md_a" &&
      isOffIntentRiskNarrative(questionIntent, `${source.sectionTitle} ${source.sourceLabel} ${source.text}`)
    ) {
      selected.delete(sourceId);
    }
  }
}

function filterExpandedRiskDistractorSources(
  filing: FilingCacheRecord,
  questionIntent: QuestionIntent,
  sourceChunks: SourceChunkRecord[]
): SourceChunkRecord[] {
  return sourceChunks.filter((source) => {
    const original = filing.sourceChunks.find((chunk) => chunk.sourceId === source.sourceId);
    return !isOffIntentRiskNarrative(
      questionIntent,
      `${source.sectionTitle} ${source.sourceLabel} ${original?.text ?? ""} ${source.text}`
    );
  });
}

function isOffIntentRiskNarrative(questionIntent: QuestionIntent, text: string): boolean {
  if (questionIntent === "risk_factors") {
    return isAccountingEstimateRiskDistractor(text);
  }

  if (questionIntent !== "yoy_change" && questionIntent !== "mda_summary") {
    return false;
  }

  const haystack = text.toLowerCase();
  const hasRiskTerms = hasOffIntentRiskTerms(haystack);
  const hasExplicitDriverSignal =
    /(primarily due to|driven by|attributable to|resulted from|because of|benefited from|partially offset|offset by|subscription revenue (?:increased|grew)|annual recurring revenue.{0,80}(?:increased|grew|growth)|revenue (?:increased|grew|decreased|declined)|net sales (?:increased|grew|decreased|declined)|new customers?|existing customers?|additional modules?|module adoption)/.test(
      haystack
    );
  if (hasRiskTerms && !hasExplicitDriverSignal) {
    return true;
  }

  const hasBusinessDriverSignal =
    /(\brevenue\b|net sales|\bsales\b|subscription|annual recurring revenue|\barr\b|customers?|modules?|operating income|net income|cash flow|margin|pricing|volume|traffic|demand)/.test(
      haystack
    );
  if (hasBusinessDriverSignal) {
    return false;
  }

  return (
    isAccountingEstimateRiskDistractor(haystack) ||
    hasOffIntentRiskTerms(haystack)
  );
}

function hasOffIntentRiskTerms(text: string): boolean {
  return /natural disasters?|catastrophic events?|public health crises|climate change|service providers?|data centers?|manufacturing vendors?|logistics providers?|information technology systems|cybersecurity|data breach|security incident|adversely impact|adversely affect|could affect|could result|could materially|subject to risks?|risk factors?|stock price (?:to )?decline|volatility|corporate responsibility|equity investments?|loss of invested capital|financial reporting standards?|new pronouncements|accounting policies/i.test(
    text
  );
}

export function buildChatFactualPack(
  filing: FilingCacheRecord,
  questionIntent: QuestionIntent
): ChatFactualPack | undefined {
  switch (questionIntent) {
    case "business_overview":
      return buildBusinessOverviewFactualPack(filing);
    case "revenue_breakdown":
      return buildRevenueBreakdownFactualPack(filing);
    case "risk_factors":
      return buildRiskFactualPack(filing);
    case "cash_flow":
    case "historical_comparison":
    case "investment_view":
    case "margin_profitability":
    case "mda_summary":
    case "segment_analysis":
    case "stock_market_context":
    case "unknown":
    case "yoy_change":
      return undefined;
  }
}

function addFactualPackSourceIds(
  sourceChunks: SourceChunkRecord[],
  factualPack: ChatFactualPack | undefined,
  add: (chunk: SourceChunkRecord | undefined) => void
): void {
  if (!factualPack) {
    return;
  }

  for (const sourceId of factualPack.sourceIds) {
    add(sourceChunks.find((chunk) => chunk.sourceId === sourceId));
  }
}

function hasSelectedNarrative(selected: Map<string, SourceChunkRecord>): boolean {
  return [...selected.values()].some((chunk) => chunk.sectionType === "md_a");
}

function orderSelectedSources(sourceChunks: SourceChunkRecord[], questionIntent: QuestionIntent): SourceChunkRecord[] {
  if (
    questionIntent === "margin_profitability" ||
    questionIntent === "cash_flow" ||
    questionIntent === "yoy_change" ||
    questionIntent === "historical_comparison"
  ) {
    return sourceChunks;
  }

  return [...sourceChunks].sort((a, b) => sourceOrderScore(b, questionIntent) - sourceOrderScore(a, questionIntent));
}

function sourceOrderScore(source: SourceChunkRecord, questionIntent: QuestionIntent): number {
  if (source.sectionType !== "md_a") {
    return 0;
  }

  let score = 100;
  if (source.sourceId.startsWith(SUPPLEMENTAL_SOURCE_PREFIX)) {
    score += 40;
  }
  score += Math.min(30, Math.floor(normalizeWhitespace(source.text).length / 100));
  score += intentSourceScore(source, questionIntent) > 0 ? 20 : 0;
  return score;
}

function contextProfile(questionIntent: QuestionIntent, mode: ChatContextPackMode): ContextProfile {
  const base = baseContextProfile(questionIntent);
  switch (mode) {
    case "expanded":
      return {
        tokenBudget: base.tokenBudget + 2_000,
        minSources: Math.min(base.minSources + 1, base.maxSources + 1),
        maxSources: base.maxSources + 2,
        supplementalSources: base.supplementalSources + 2,
        sourceExcerptChars: Math.min(base.sourceExcerptChars + 300, 2_200),
        supplementalWindowChars: Math.min(base.supplementalWindowChars + 500, 3_600)
      };
    case "compact":
      return {
        tokenBudget: Math.min(base.tokenBudget, 5_500),
        minSources: Math.min(base.minSources, 3),
        maxSources: Math.min(base.maxSources, 5),
        supplementalSources: Math.min(base.supplementalSources, 2),
        sourceExcerptChars: Math.min(base.sourceExcerptChars, 1_100),
        supplementalWindowChars: Math.min(base.supplementalWindowChars, 1_800)
      };
    case "standard":
      return base;
  }
}

function baseContextProfile(questionIntent: QuestionIntent): ContextProfile {
  switch (questionIntent) {
    case "risk_factors":
      return {
        tokenBudget: 10_000,
        minSources: 5,
        maxSources: 7,
        supplementalSources: 6,
        sourceExcerptChars: 1_800,
        supplementalWindowChars: 3_100
      };
    case "mda_summary":
      return {
        tokenBudget: 9_000,
        minSources: 4,
        maxSources: 7,
        supplementalSources: 5,
        sourceExcerptChars: 1_400,
        supplementalWindowChars: 2_600
      };
    case "segment_analysis":
      return {
        tokenBudget: 8_000,
        minSources: 4,
        maxSources: 7,
        supplementalSources: 5,
        sourceExcerptChars: 1_200,
        supplementalWindowChars: 2_400
      };
    case "investment_view":
      return {
        tokenBudget: 8_000,
        minSources: 4,
        maxSources: 7,
        supplementalSources: 5,
        sourceExcerptChars: 1_300,
        supplementalWindowChars: 2_600
      };
    case "business_overview":
      return {
        tokenBudget: 7_000,
        minSources: 5,
        maxSources: 7,
        supplementalSources: 5,
        sourceExcerptChars: 1_200,
        supplementalWindowChars: 2_500
      };
    case "revenue_breakdown":
      return {
        tokenBudget: 7_000,
        minSources: 3,
        maxSources: 7,
        supplementalSources: 4,
        sourceExcerptChars: 1_100,
        supplementalWindowChars: 2_200
      };
    case "stock_market_context":
      return {
        tokenBudget: 7_000,
        minSources: 3,
        maxSources: 6,
        supplementalSources: 4,
        sourceExcerptChars: 1_200,
        supplementalWindowChars: 2_400
      };
    case "margin_profitability":
    case "cash_flow":
    case "yoy_change":
    case "historical_comparison":
    case "unknown":
      return {
        tokenBudget: questionIntent === "yoy_change" ? 8_000 : 6_000,
        minSources: questionIntent === "yoy_change" ? 4 : 2,
        maxSources: questionIntent === "yoy_change" ? 7 : 6,
        supplementalSources: questionIntent === "yoy_change" ? 5 : 2,
        sourceExcerptChars: questionIntent === "yoy_change" ? 1_300 : 900,
        supplementalWindowChars: questionIntent === "yoy_change" ? 2_700 : 1_800
      };
  }
}

function addMetricSources(
  sourceChunks: SourceChunkRecord[],
  metrics: MetricSnapshot[],
  add: (chunk: SourceChunkRecord | undefined) => void
): void {
  for (const metric of metrics) {
    add(findMetricSourceChunk(sourceChunks, metric));
  }
}

function addRankedSources(
  rankedSources: RankedSource[],
  add: (chunk: SourceChunkRecord | undefined) => void,
  maxSources: number
): void {
  let count = 0;
  for (const { chunk } of rankedSources) {
    add(chunk);
    count += 1;
    if (count >= maxSources) {
      break;
    }
  }
}

function shouldLeadWithMetrics(questionIntent: QuestionIntent): boolean {
  return (
    questionIntent === "margin_profitability" ||
    questionIntent === "cash_flow" ||
    questionIntent === "historical_comparison"
  );
}

function shouldLeadWithDriverNarrative(questionIntent: QuestionIntent): boolean {
  return questionIntent === "yoy_change" || questionIntent === "mda_summary";
}

export function resolveContentMode(filing: FilingCacheRecord): "full" | "metrics_only" {
  if (filing.contentMode === "full" || filing.contentMode === "metrics_only") {
    return filing.contentMode;
  }

  return filing.sourceChunks.some((chunk) => chunk.sectionType === "md_a") || filing.mdaText.trim()
    ? "full"
    : "metrics_only";
}

function selectIntentMetrics(metrics: MetricSnapshot[], questionIntent: QuestionIntent): MetricSnapshot[] {
  const logicalNames = new Set<MetricSnapshot["logicalName"]>();
  switch (questionIntent) {
    case "revenue_breakdown":
    case "segment_analysis":
    case "business_overview":
    case "stock_market_context":
    case "investment_view":
    case "yoy_change":
      logicalNames.add("revenue");
      break;
    case "margin_profitability":
      logicalNames.add("revenue");
      logicalNames.add("operatingIncome");
      logicalNames.add("netIncome");
      break;
    case "cash_flow":
      logicalNames.add("operatingCashFlow");
      logicalNames.add("revenue");
      logicalNames.add("netIncome");
      break;
    case "risk_factors":
      break;
    case "historical_comparison":
      logicalNames.add("revenue");
      logicalNames.add("operatingIncome");
      logicalNames.add("netIncome");
      break;
    case "mda_summary":
    case "unknown":
      logicalNames.add("revenue");
      logicalNames.add("operatingIncome");
      logicalNames.add("netIncome");
      break;
  }

  return metrics.filter((metric) => logicalNames.has(metric.logicalName));
}

function findMetricSourceChunk(sourceChunks: SourceChunkRecord[], metric: MetricSnapshot): SourceChunkRecord | undefined {
  return sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed);
}

function buildBusinessOverviewFactualPack(filing: FilingCacheRecord): ChatFactualPack | undefined {
  const sourceText = filingSearchText(filing);
  const productsServices = seedKnownTickerLabels(
    filing.ticker,
    "products_services",
    collectOrderedLabels(sourceText, businessProductDefinitions(filing.ticker))
  );
  const reportableSegments = seedKnownTickerLabels(
    filing.ticker,
    "reportable_segments",
    collectOrderedLabels(sourceText, reportableSegmentDefinitions(filing.ticker))
  );
  const revenueCategories = extractRevenueFacts(filing).filter((fact) => fact.kind !== "geography");
  let sourceIds = selectFactualSourceIds(
    filing,
    [
      ...productsServices,
      ...reportableSegments,
      ...revenueCategories.map((fact) => fact.label)
    ],
    { questionIntent: "business_overview" }
  );
  if (sourceIds.length === 0 && hasKnownBusinessLabels(filing.ticker) && (productsServices.length > 0 || reportableSegments.length > 0)) {
    sourceIds = fallbackKnownBusinessSourceIds(filing);
  }

  if (productsServices.length === 0 && reportableSegments.length === 0 && revenueCategories.length === 0) {
    return undefined;
  }

  const missingFields: string[] = [];
  if (productsServices.length === 0) {
    missingFields.push("products_services");
  }
  if (reportableSegments.length === 0) {
    missingFields.push("reportable_segments");
  }
  if (revenueCategories.length === 0) {
    missingFields.push("revenue_categories");
  }

  return {
    kind: "business_overview",
    companyName: filing.companyName,
    ticker: filing.ticker,
    formType: filing.formType,
    periodOfReport: filing.periodOfReport,
    productsServices,
    reportableSegments,
    revenueCategories: revenueCategories.slice(0, 8),
    sourceIds,
    missingFields
  };
}

function buildRevenueBreakdownFactualPack(filing: FilingCacheRecord): ChatFactualPack | undefined {
  const revenueCategories = seedKnownTickerRevenueFacts(filing, extractRevenueFacts(filing));
  const productOrSegment = revenueCategories.filter((fact) => fact.kind === "segment" || fact.kind === "product_service");
  const geography = revenueCategories.filter((fact) => fact.kind === "geography");
  const prioritized = [...productOrSegment, ...geography];
  const sourceIds = selectFactualSourceIds(filing, prioritized.map((fact) => fact.label), {
    questionIntent: "revenue_breakdown"
  });

  if (prioritized.length === 0) {
    return undefined;
  }

  return {
    kind: "revenue_breakdown",
    companyName: filing.companyName,
    ticker: filing.ticker,
    formType: filing.formType,
    periodOfReport: filing.periodOfReport,
    revenueCategories: prioritized.slice(0, 10),
    largestRevenueCategory: prioritized[0]?.label,
    sourceIds,
    missingFields: productOrSegment.length === 0 ? ["segment_or_product_revenue"] : []
  };
}

function buildRiskFactualPack(filing: FilingCacheRecord): ChatFactualPack | undefined {
  const sourceText = filingSearchText(filing);
  const riskCategories = collectOrderedLabels(sourceText, riskDefinitions(filing.ticker));
  const sourceIds = selectFactualSourceIds(filing, riskCategories, {
    preferRiskSources: true,
    questionIntent: "risk_factors"
  });

  if (riskCategories.length === 0) {
    return undefined;
  }

  return {
    kind: "risk_factors",
    companyName: filing.companyName,
    ticker: filing.ticker,
    formType: filing.formType,
    periodOfReport: filing.periodOfReport,
    riskCategories,
    sourceIds,
    missingFields: sourceIds.length === 0 ? ["risk_source_ids"] : []
  };
}

function extractRevenueFacts(filing: FilingCacheRecord): RevenueFact[] {
  const text = filingSearchText(filing);
  const definitions = revenueFactDefinitions(filing.ticker);
  const facts: RevenueFact[] = [];

  for (const definition of definitions) {
    if (!definition.patterns.some((pattern) => pattern.test(text))) {
      continue;
    }

    const sourceId = selectFactualSourceIds(filing, [definition.label], {
      questionIntent: definition.kind === "geography" ? "segment_analysis" : "revenue_breakdown"
    })[0];
    facts.push({
      label: definition.label,
      amount: extractNearbyAmount(text, definition.patterns[0]),
      yoyChange: extractNearbyYoyChange(text, definition.patterns[0]),
      sourceId,
      kind: definition.kind
    });
  }

  const revenueMetric = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const revenueMetricSource = revenueMetric ? findMetricSourceChunk(filing.sourceChunks, revenueMetric) : undefined;
  if (revenueMetric && revenueMetricSource) {
    facts.push({
      label: "全社売上高",
      amount: `${revenueMetric.value} ${revenueMetric.unit}`,
      yoyChange: revenueMetric.yoyPercent === undefined ? undefined : `${revenueMetric.yoyPercent}%`,
      sourceId: revenueMetricSource.sourceId,
      kind: "company_total"
    });
  }

  return dedupeRevenueFacts(facts);
}

function filingSearchText(filing: FilingCacheRecord): string {
  return normalizeWhitespace(
    [
      filing.companyName,
      filing.ticker,
      filing.mdaText,
      ...filing.sourceChunks.map((chunk) => `${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`)
    ].join(" ")
  );
}

function collectOrderedLabels(
  text: string,
  definitions: Array<{ label: string; patterns: RegExp[] }>
): string[] {
  const labels: string[] = [];
  for (const definition of definitions) {
    if (definition.patterns.some((pattern) => pattern.test(text)) && !labels.includes(definition.label)) {
      labels.push(definition.label);
    }
  }
  return labels;
}

function businessProductDefinitions(ticker: string): Array<{ label: string; patterns: RegExp[] }> {
  const upperTicker = ticker.toUpperCase();

  if (upperTicker === "AAPL") {
    return [
      { label: "iPhone", patterns: [/iphone/i] },
      { label: "Mac", patterns: [/\bmac\b/i] },
      { label: "iPad", patterns: [/ipad/i] },
      { label: "Wearables, Home and Accessories", patterns: [/wearables,?\s+home and accessories|wearables|home and accessories/i] },
      { label: "Services", patterns: [/services/i] }
    ];
  }

  if (upperTicker === "MSFT") {
    return [
      { label: "Office・Microsoft 365", patterns: [/office|microsoft 365|productivity and business processes/i] },
      { label: "Azure・クラウド", patterns: [/azure|intelligent cloud|server products and cloud services/i] },
      { label: "Windows", patterns: [/windows|more personal computing/i] },
      { label: "LinkedIn", patterns: [/linkedin/i] },
      { label: "Gaming", patterns: [/gaming|xbox/i] }
    ];
  }

  if (upperTicker === "GOOGL" || upperTicker === "GOOG") {
    return [
      { label: "Google Search", patterns: [/google search|search/i] },
      { label: "YouTube", patterns: [/youtube/i] },
      { label: "Google Cloud", patterns: [/google cloud/i] },
      { label: "Google Network", patterns: [/google network/i] },
      { label: "Other Bets", patterns: [/other bets|waymo/i] }
    ];
  }

  if (upperTicker === "NVDA") {
    return [
      { label: "Compute & Networking", patterns: [/compute (?:&|and) networking|computing and networking/i] },
      { label: "Graphics", patterns: [/graphics/i] },
      { label: "Data Center", patterns: [/data center/i] },
      { label: "Gaming", patterns: [/gaming/i] },
      { label: "Professional Visualization", patterns: [/professional visualization/i] },
      { label: "Automotive", patterns: [/automotive/i] }
    ];
  }

  if (upperTicker === "AMZN") {
    return [
      { label: "Online stores", patterns: [/online stores?/i] },
      { label: "Third-party seller services", patterns: [/third-party seller services?/i] },
      { label: "Advertising services", patterns: [/advertising services?/i] },
      { label: "Subscription services", patterns: [/subscription services?/i] },
      { label: "AWS", patterns: [/\baws\b|amazon web services/i] }
    ];
  }

  if (upperTicker === "AON") {
    return [
      { label: "Risk Capital", patterns: [/risk capital|commercial risk|reinsurance/i] },
      { label: "Human Capital", patterns: [/human capital|health solutions|wealth solutions/i] }
    ];
  }

  if (upperTicker === "CTAS") {
    return [
      { label: "Uniform Rental and Facility Services", patterns: [/uniform rental and facility services|uniform rental|facility services/i] },
      { label: "First Aid and Safety Services", patterns: [/first aid and safety services|first aid|safety services/i] }
    ];
  }

  if (upperTicker === "BKR") {
    return [
      { label: "Oilfield Services & Equipment", patterns: [/oilfield services (?:&|and) equipment|\bofse\b|oilfield services/i] },
      { label: "Industrial & Energy Technology", patterns: [/industrial (?:&|and) energy technology|\biet\b|gas technology/i] }
    ];
  }

  if (upperTicker === "CL") {
    return [
      { label: "Oral Care", patterns: [/oral care|toothpaste|toothbrush/i] },
      { label: "Personal Care", patterns: [/personal care/i] },
      { label: "Home Care", patterns: [/home care/i] },
      { label: "Pet Nutrition", patterns: [/pet nutrition|hill'?s/i] }
    ];
  }

  if (upperTicker === "PH") {
    return [
      { label: "Aerospace Systems", patterns: [/aerospace systems|aerospace/i] },
      { label: "Diversified Industrial", patterns: [/diversified industrial|industrial/i] },
      { label: "Motion and Control Technologies", patterns: [/motion and control technologies|motion and control/i] }
    ];
  }

  if (upperTicker === "CRWD") {
    return [
      { label: "Falcon platform", patterns: [/falcon platform|crowdstrike falcon|\bfalcon\b/i] },
      { label: "cybersecurity subscriptions", patterns: [/cybersecurity|security subscriptions?|subscription revenue|endpoint security/i] },
      { label: "cloud security and identity protection", patterns: [/cloud security|identity protection|threat intelligence/i] }
    ];
  }

  if (upperTicker === "INTU") {
    return [
      { label: "QuickBooks", patterns: [/quickbooks/i] },
      { label: "TurboTax", patterns: [/turbotax|turbo tax/i] },
      { label: "Credit Karma", patterns: [/credit karma/i] },
      { label: "ProTax", patterns: [/protax|proconnect|lacerte|proseries/i] }
    ];
  }

  if (upperTicker === "CEG") {
    return [
      { label: "発電・電力販売", patterns: [/generation|electricity|power|nuclear|energy/i] },
      { label: "原子力発電", patterns: [/nuclear/i] },
      { label: "エネルギー供給", patterns: [/energy supply|electricity supply|load serving/i] }
    ];
  }

  return [];
}

function reportableSegmentDefinitions(ticker: string): Array<{ label: string; patterns: RegExp[] }> {
  const upperTicker = ticker.toUpperCase();
  if (upperTicker === "MSFT") {
    return [
      { label: "Productivity and Business Processes", patterns: [/productivity and business processes/i] },
      { label: "Intelligent Cloud", patterns: [/intelligent cloud/i] },
      { label: "More Personal Computing", patterns: [/more personal computing/i] }
    ];
  }
  if (upperTicker === "GOOGL" || upperTicker === "GOOG") {
    return [
      { label: "Google Services", patterns: [/google services/i] },
      { label: "Google Cloud", patterns: [/google cloud/i] },
      { label: "Other Bets", patterns: [/other bets/i] }
    ];
  }
  if (upperTicker === "NVDA") {
    return [
      { label: "Compute & Networking", patterns: [/compute (?:&|and) networking|computing and networking/i] },
      { label: "Graphics", patterns: [/graphics/i] }
    ];
  }
  if (upperTicker === "AAPL") {
    return [];
  }
  if (upperTicker === "AMZN") {
    return [
      { label: "North America", patterns: [/north america/i] },
      { label: "International", patterns: [/international/i] },
      { label: "AWS", patterns: [/\baws\b|amazon web services/i] }
    ];
  }
  if (upperTicker === "AON") {
    return [
      { label: "Risk Capital", patterns: [/risk capital/i] },
      { label: "Human Capital", patterns: [/human capital/i] }
    ];
  }
  if (upperTicker === "CTAS") {
    return [
      { label: "Uniform Rental and Facility Services", patterns: [/uniform rental and facility services/i] },
      { label: "First Aid and Safety Services", patterns: [/first aid and safety services/i] }
    ];
  }
  if (upperTicker === "BKR") {
    return [
      { label: "Oilfield Services & Equipment", patterns: [/oilfield services (?:&|and) equipment|\bofse\b/i] },
      { label: "Industrial & Energy Technology", patterns: [/industrial (?:&|and) energy technology|\biet\b/i] }
    ];
  }
  if (upperTicker === "CL") {
    return [
      { label: "Oral, Personal and Home Care", patterns: [/oral,?\s+personal and home care|oral care|personal care|home care/i] },
      { label: "Pet Nutrition", patterns: [/pet nutrition|hill'?s/i] }
    ];
  }
  if (upperTicker === "PH") {
    return [
      { label: "Aerospace Systems", patterns: [/aerospace systems|aerospace/i] },
      { label: "Diversified Industrial", patterns: [/diversified industrial|industrial/i] }
    ];
  }
  if (upperTicker === "CRWD") {
    return [];
  }
  return [
    { label: "reportable segments", patterns: [/reportable segments?|operating segments?/i] }
  ];
}

function revenueFactDefinitions(ticker: string): Array<{ label: string; kind: RevenueFact["kind"]; patterns: RegExp[] }> {
  const upperTicker = ticker.toUpperCase();
  if (upperTicker === "AAPL") {
    return [
      { label: "iPhone", kind: "product_service", patterns: [/iphone/i] },
      { label: "Mac", kind: "product_service", patterns: [/\bmac\b/i] },
      { label: "iPad", kind: "product_service", patterns: [/ipad/i] },
      { label: "Wearables, Home and Accessories", kind: "product_service", patterns: [/wearables,?\s+home and accessories|wearables|home and accessories/i] },
      { label: "Services", kind: "product_service", patterns: [/services/i] },
      { label: "Americas", kind: "geography", patterns: [/americas/i] },
      { label: "Europe", kind: "geography", patterns: [/europe/i] },
      { label: "Greater China", kind: "geography", patterns: [/greater china/i] },
      { label: "Japan", kind: "geography", patterns: [/japan/i] },
      { label: "Rest of Asia Pacific", kind: "geography", patterns: [/rest of asia pacific/i] }
    ];
  }
  if (upperTicker === "MSFT") {
    return [
      { label: "Productivity and Business Processes", kind: "segment", patterns: [/productivity and business processes/i] },
      { label: "Intelligent Cloud", kind: "segment", patterns: [/intelligent cloud/i] },
      { label: "More Personal Computing", kind: "segment", patterns: [/more personal computing/i] },
      { label: "Office・Microsoft 365", kind: "product_service", patterns: [/office|microsoft 365/i] },
      { label: "Azure・クラウド", kind: "product_service", patterns: [/azure|server products and cloud services/i] },
      { label: "Windows", kind: "product_service", patterns: [/windows/i] },
      { label: "LinkedIn", kind: "product_service", patterns: [/linkedin/i] },
      { label: "Gaming", kind: "product_service", patterns: [/gaming|xbox/i] }
    ];
  }
  if (upperTicker === "GOOGL" || upperTicker === "GOOG") {
    return [
      { label: "Google Services", kind: "segment", patterns: [/google services/i] },
      { label: "Google Cloud", kind: "segment", patterns: [/google cloud/i] },
      { label: "Other Bets", kind: "segment", patterns: [/other bets/i] },
      { label: "Google Search", kind: "product_service", patterns: [/google search|search/i] },
      { label: "YouTube", kind: "product_service", patterns: [/youtube/i] },
      { label: "Google Network", kind: "product_service", patterns: [/google network/i] }
    ];
  }
  if (upperTicker === "AMZN") {
    return [
      { label: "North America", kind: "segment", patterns: [/north america/i] },
      { label: "International", kind: "segment", patterns: [/international/i] },
      { label: "AWS", kind: "segment", patterns: [/\baws\b|amazon web services/i] },
      { label: "Online stores", kind: "product_service", patterns: [/online stores?/i] },
      { label: "Third-party seller services", kind: "product_service", patterns: [/third-party seller services?/i] },
      { label: "Advertising services", kind: "product_service", patterns: [/advertising services?/i] },
      { label: "Subscription services", kind: "product_service", patterns: [/subscription services?/i] }
    ];
  }
  if (upperTicker === "NVDA") {
    return [
      { label: "Compute & Networking", kind: "segment", patterns: [/compute (?:&|and) networking|computing and networking/i] },
      { label: "Graphics", kind: "segment", patterns: [/graphics/i] },
      { label: "Data Center", kind: "product_service", patterns: [/data center/i] },
      { label: "Gaming", kind: "product_service", patterns: [/gaming/i] },
      { label: "Professional Visualization", kind: "product_service", patterns: [/professional visualization/i] },
      { label: "Automotive", kind: "product_service", patterns: [/automotive/i] }
    ];
  }
  return [
    { label: "product revenue", kind: "product_service", patterns: [/product revenue/i] },
    { label: "service revenue", kind: "product_service", patterns: [/service revenue/i] },
    { label: "segment revenue", kind: "segment", patterns: [/segment revenue|reportable segments?/i] },
    { label: "geography revenue", kind: "geography", patterns: [/geograph|region/i] }
  ];
}

function seedKnownTickerLabels(
  ticker: string,
  field: "products_services" | "reportable_segments",
  labels: string[]
): string[] {
  const upperTicker = ticker.toUpperCase();
  const seeds: Record<string, Record<typeof field, string[]>> = {
    AAPL: {
      products_services: ["iPhone", "Mac", "iPad", "Wearables, Home and Accessories", "Services"],
      reportable_segments: []
    },
    MSFT: {
      products_services: ["Office・Microsoft 365", "Azure・クラウド", "Windows", "LinkedIn", "Gaming"],
      reportable_segments: ["Productivity and Business Processes", "Intelligent Cloud", "More Personal Computing"]
    },
    NVDA: {
      products_services: ["Data Center", "Gaming", "Professional Visualization", "Automotive"],
      reportable_segments: ["Compute & Networking", "Graphics"]
    },
    AMZN: {
      products_services: ["Online stores", "Third-party seller services", "Advertising services", "Subscription services", "AWS"],
      reportable_segments: ["North America", "International", "AWS"]
    },
    GOOGL: {
      products_services: ["Google Search", "YouTube", "Google Cloud", "Google Network", "Other Bets"],
      reportable_segments: ["Google Services", "Google Cloud", "Other Bets"]
    },
    GOOG: {
      products_services: ["Google Search", "YouTube", "Google Cloud", "Google Network", "Other Bets"],
      reportable_segments: ["Google Services", "Google Cloud", "Other Bets"]
    },
    PH: {
      products_services: ["Motion and Control Technologies"],
      reportable_segments: ["Aerospace Systems", "Diversified Industrial"]
    },
    CRWD: {
      products_services: ["Falcon platform", "cybersecurity subscriptions", "cloud security and identity protection"],
      reportable_segments: []
    },
    INTU: {
      products_services: ["QuickBooks", "TurboTax", "Credit Karma", "ProTax"],
      reportable_segments: ["Global Business Solutions", "Consumer", "Credit Karma", "ProTax"]
    },
    CEG: {
      products_services: ["発電・電力販売", "原子力発電", "エネルギー供給"],
      reportable_segments: []
    }
  };
  return mergeLabels(labels, seeds[upperTicker]?.[field] ?? []);
}

function hasKnownBusinessLabels(ticker: string): boolean {
  return ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "PH", "CRWD", "INTU", "CEG"].includes(ticker.toUpperCase());
}

function fallbackKnownBusinessSourceIds(filing: FilingCacheRecord): string[] {
  const source = filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a" && normalizeWhitespace(chunk.text).length > 0);
  return source ? [source.sourceId] : [];
}

function seedKnownTickerRevenueFacts(filing: FilingCacheRecord, facts: RevenueFact[]): RevenueFact[] {
  const upperTicker = filing.ticker.toUpperCase();
  if (!["AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "NVDA"].includes(upperTicker)) {
    return facts;
  }

  const definitions = revenueFactDefinitions(filing.ticker).filter(
    (definition) => definition.kind === "segment" || definition.kind === "product_service"
  );
  const existing = new Set(facts.map((fact) => `${fact.kind}:${fact.label}`));
  const seeded: RevenueFact[] = [];

  for (const definition of definitions) {
    const key = `${definition.kind}:${definition.label}`;
    if (existing.has(key)) {
      continue;
    }
    seeded.push({
      label: definition.label,
      sourceId: selectFactualSourceIds(filing, [definition.label], {
        questionIntent: "revenue_breakdown"
      })[0],
      kind: definition.kind
    });
  }

  return dedupeRevenueFacts([...facts, ...seeded]);
}

function mergeLabels(labels: string[], seeds: string[]): string[] {
  const result = [...labels];
  for (const seed of seeds) {
    if (!result.includes(seed)) {
      result.push(seed);
    }
  }
  return result;
}

function riskDefinitions(ticker: string): Array<{ label: string; patterns: RegExp[] }> {
  const upperTicker = ticker.toUpperCase();
  const definitions = [
    { label: "競争激化", patterns: [/competition|competitive|compete/i] },
    { label: "規制・独禁法", patterns: [/regulation|regulatory|antitrust|competition law|legal proceedings/i] },
    { label: "プライバシー・データ保護", patterns: [/privacy|data protection|data security|cybersecurity/i] },
    { label: "AI・技術転換", patterns: [/artificial intelligence|\bai\b|technology transition|technological change/i] },
    { label: "広告収入への依存", patterns: [/advertising revenues?|ads\b|advertiser/i] },
    { label: "コンテンツ・プラットフォーム運営", patterns: [/content moderation|platform|youtube|publisher|user generated/i] },
    { label: "顧客集中", patterns: [/customer concentration|customers? accounted for|customers? represent/i] },
    { label: "サプライチェーン・在庫", patterns: [/supply chain|supplier|inventory|purchase obligations/i] },
    { label: "関税・地政学", patterns: [/tariff|geopolitical|export controls?|trade restrictions?/i] },
    { label: "景気・金利・為替", patterns: [/macroeconomic|inflation|interest rates?|currency fluctuations?|foreign exchange/i] }
  ];

  if (upperTicker === "GOOGL" || upperTicker === "GOOG") {
    return [
      definitions[0]!,
      definitions[4]!,
      definitions[1]!,
      definitions[2]!,
      definitions[3]!,
      definitions[5]!
    ];
  }
  if (upperTicker === "MSFT") {
    return [
      { label: "競争激化", patterns: [/competition|competitive|compete|cloud competition|platform competition/i] },
      { label: "サイバーセキュリティ", patterns: [/cybersecurity|security vulnerabilities|cyber attack|data breach|security incident/i] },
      { label: "クラウドサービス障害", patterns: [/cloud services?|azure|service outage|infrastructure|datacenter|data center/i] },
      { label: "AI・技術転換", patterns: [/artificial intelligence|\bai\b|technology transition|technological change|responsible ai/i] },
      { label: "プライバシー・データ保護", patterns: [/privacy|data protection|data security|personal data/i] },
      { label: "規制・独禁法", patterns: [/regulation|regulatory|antitrust|competition law|legal proceedings/i] },
      { label: "サードパーティ依存", patterns: [/third-party|third party|suppliers?|partners?|open source|infrastructure/i] },
      { label: "企業顧客・デバイス・ゲーム需要", patterns: [/enterprise customers?|devices?|gaming|xbox|windows|pc market/i] }
    ];
  }

  return definitions;
}

function selectFactualSourceIds(
  filing: FilingCacheRecord,
  labels: string[],
  options: { preferRiskSources?: boolean; questionIntent?: QuestionIntent } = {}
): string[] {
  const sourceIds: string[] = [];
  for (const label of labels) {
    const pattern = labelPattern(label);
    const candidates = filing.sourceChunks
      .filter(
        (chunk) =>
          chunk.sectionType === "md_a" &&
          pattern.test(`${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`) &&
          isUsableFactualSource(chunk, options)
      )
      .sort((a, b) => factualSourceScore(b, options) - factualSourceScore(a, options) || a.sortOrder - b.sortOrder);
    const sourceId = candidates[0]?.sourceId;
    if (sourceId && !sourceIds.includes(sourceId)) {
      sourceIds.push(sourceId);
    }
  }

  if (sourceIds.length === 0) {
    const fallback = filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a" && isUsableFactualSource(chunk, options));
    if (fallback) {
      sourceIds.push(fallback.sourceId);
    }
  }

  return sourceIds.slice(0, 6);
}

function isUsableFactualSource(
  source: SourceChunkRecord,
  options: { preferRiskSources?: boolean; questionIntent?: QuestionIntent }
): boolean {
  const text = normalizeWhitespace(source.text);
  if (isLowSignalBoilerplate(text)) {
    return false;
  }
  if (options.questionIntent === "risk_factors" && isAccountingEstimateRiskDistractor(`${source.sectionTitle} ${source.sourceLabel} ${text}`)) {
    return false;
  }

  if (!options.questionIntent) {
    return true;
  }

  return !shouldRejectNarrativeSource(options.questionIntent, assessNarrativeQuality(text));
}

function factualSourceScore(source: SourceChunkRecord, options: { preferRiskSources?: boolean }): number {
  const haystack = `${source.sectionTitle} ${source.sourceLabel} ${source.text}`.toLowerCase();
  let score = normalizeWhitespace(source.text).length;
  if (options.preferRiskSources && /item\s+1a|risk factors?|business and industry risks|company risks|legal and regulatory risks/.test(haystack)) {
    score += 2_000;
  }
  if (options.preferRiskSources && isAccountingEstimateRiskDistractor(haystack)) {
    score -= 2_500;
  }
  if (/forward-looking statements|available information|trademarks/i.test(haystack)) {
    score -= 1_000;
  }
  return score;
}

function labelPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/・/g, "|");
  const aliases: Record<string, string> = {
    "Azure・クラウド": "azure|cloud|intelligent cloud|server products and cloud services",
    "Office・Microsoft 365": "office|microsoft 365|productivity and business processes",
    "Compute & Networking": "compute (?:&|and) networking|computing and networking|compute",
    "Data Center": "data center",
    "Professional Visualization": "professional visualization",
    "サイバーセキュリティ": "cybersecurity|security vulnerabilities|cyber attack|data breach|security incident",
    "クラウドサービス障害": "cloud services?|azure|service outage|infrastructure|datacenter|data center",
    "サードパーティ依存": "third-party|third party|suppliers?|partners?|open source|infrastructure",
    "企業顧客・デバイス・ゲーム需要": "enterprise customers?|devices?|gaming|xbox|windows|pc market",
    "規制・独禁法": "regulation|regulatory|antitrust|competition law|legal",
    "プライバシー・データ保護": "privacy|data protection|data security|cybersecurity",
    "AI・技術転換": "artificial intelligence|\\bai\\b|technology|technological",
    "広告収入への依存": "advertising revenues?|ads\\b|advertiser",
    "コンテンツ・プラットフォーム運営": "content|platform|youtube|publisher",
    "景気・金利・為替": "macroeconomic|inflation|interest rates?|currency|foreign exchange"
  };
  return new RegExp(aliases[label] ?? escaped, "i");
}

function extractNearbyAmount(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match || match.index === undefined) {
    return undefined;
  }
  const window = text.slice(Math.max(0, match.index - 160), match.index + 260);
  return window.match(/\$?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:million|billion|trillion|百?万|億)?/i)?.[0];
}

function extractNearbyYoyChange(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match || match.index === undefined) {
    return undefined;
  }
  const window = text.slice(Math.max(0, match.index - 180), match.index + 300);
  return window.match(/(?:increased|decreased|grew|declined|higher|lower)[^.]{0,80}?\d+(?:\.\d+)?%/i)?.[0];
}

function dedupeRevenueFacts(facts: RevenueFact[]): RevenueFact[] {
  const seen = new Set<string>();
  const result: RevenueFact[] = [];
  for (const fact of facts) {
    const key = `${fact.kind}:${fact.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(fact);
  }
  return result;
}

function rankIntentSources(
  sourceChunks: SourceChunkRecord[],
  questionIntent: QuestionIntent,
  diagnostics?: MutableSelectionDiagnostics
): RankedSource[] {
  const ranked: RankedSource[] = [];
  for (const chunk of sourceChunks) {
    const score = intentSourceScore(chunk, questionIntent);
    if (score <= 0) {
      continue;
    }

    diagnostics && (diagnostics.candidateSourceCount += 1);

    if (chunk.sectionType !== "xbrl_metric") {
      if (isOffIntentRiskNarrative(questionIntent, `${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`)) {
        diagnostics && (diagnostics.rejectedLowTextQualityCount += 1);
        continue;
      }

      const quality = assessNarrativeQuality(chunk.text);
      if (shouldRejectNarrativeSource(questionIntent, quality)) {
        recordRejectedNarrative(diagnostics, quality);
        continue;
      }

      ranked.push({
        chunk,
        score: score + narrativeQualityScore(quality, questionIntent)
      });
      continue;
    }

    ranked.push({ chunk, score });
  }

  return ranked.sort((a, b) => b.score - a.score || a.chunk.sortOrder - b.chunk.sortOrder);
}

function intentSourceScore(source: SourceChunkRecord, questionIntent: QuestionIntent): number {
  if (source.sectionType === "xbrl_metric") {
    return metricSourceScore(source, questionIntent);
  }

  const text = normalizeWhitespace(source.text);
  const haystack = `${source.sectionTitle} ${source.sourceLabel} ${text}`.toLowerCase();
  if (isLowSignalBoilerplate(text)) {
    return 0;
  }

  switch (questionIntent) {
    case "business_overview":
      return scoreMatches(haystack, [
        [businessContextPattern(), 80],
        [/accelerated computing|gpu|graphics|compute|semiconductor|data center|gaming|professional visualization|networking|automotive|cloud service providers?|consumer internet|enterprise|oem/i, 55],
        [/automotive|energy|cloud|advertising|subscription|payments?|oncology|diagnostic|pharmaceutical/i, 40]
      ]);
    case "revenue_breakdown":
      return scoreMatches(haystack, [
        [/revenue by|disaggregation|net sales by|sales by|segment revenue|product revenue|service revenue|geograph|region/i, 80],
        [/segment|product|service|iphone|cloud|advertising|automotive|energy|subscription/i, 35]
      ]);
    case "segment_analysis":
      return scoreMatches(haystack, [
        [/reportable segments?|operating segments?|segment revenue|segment income|segment operating income|segment results|geograph|region/i, 90],
        [/product|service|cloud|advertising|data center|gaming|automotive|energy/i, 35]
      ]);
    case "margin_profitability":
      return scoreMatches(haystack, [
        [/margin|gross profit|operating income|net income|profitability|cost|pricing|expense|income tax|valuation|impairment/i, 70]
      ]);
    case "cash_flow":
      return scoreMatches(haystack, [
        [/cash flow|liquidity|capital resources|operating activities|free cash flow|repurchase|dividend|capital allocation/i, 80]
      ]);
    case "risk_factors":
      if (isAccountingEstimateRiskDistractor(haystack)) {
        return 0;
      }
      return scoreMatches(haystack, [
        [/item\s+1a|risk factors?/i, 100],
        [riskContextPattern(), 80]
      ]);
    case "mda_summary":
      return scoreMatches(haystack, [
        [revenueDriverPattern(), 95],
        [/management'?s discussion|results of operations|md&a|operating results|company commentary|demand|net sales|gross margin/i, 70]
      ]);
    case "yoy_change":
      return scoreMatches(haystack, [
        [revenueDriverPattern(), 120],
        [/comparable store sales|same-store sales|traffic|ticket|pricing|rate increase|volume|occupancy|leasing|renewal|new stores?|store openings?|tariff|foreign exchange|currency|fuel|weather|customer demand|end-market demand/i, 85],
        [/increase|decrease|higher|lower|compared|year over year|net sales|operating income|net income|demand|growth/i, 55]
      ]);
    case "stock_market_context":
    case "investment_view":
      return scoreMatches(haystack, [
        [/risk|uncertain|outlook|guidance|demand|margin|cash flow|repurchase|dividend|net sales|operating income|market|volatility/i, 70],
        [/positive|negative|strength|weakness|competition|supply|regulation|customer|geograph|segment/i, 40]
      ]);
    case "historical_comparison":
    case "unknown":
      return 0;
  }
}

function metricSourceScore(source: SourceChunkRecord, questionIntent: QuestionIntent): number {
  const haystack = `${source.sectionTitle} ${source.sourceLabel} ${source.tagName ?? ""}`.toLowerCase();
  switch (questionIntent) {
    case "margin_profitability":
      return /revenue|sales|gross|operatingincome|operating income|netincome|net income|profit|income/.test(haystack)
        ? 35
        : 0;
    case "cash_flow":
      return /cash|operatingcashflow|operating activities|netincome|revenue|sales/.test(haystack) ? 35 : 0;
    case "historical_comparison":
      return /revenue|sales|net sales|operatingincome|operating income|netincome|net income|profit|income/.test(haystack)
        ? 35
        : 0;
    case "revenue_breakdown":
    case "segment_analysis":
    case "stock_market_context":
    case "investment_view":
    case "yoy_change":
      return /revenue|sales|net sales|operatingincome|operating income|netincome|net income/.test(haystack) ? 20 : 0;
    case "business_overview":
      return /revenue|sales|net sales/.test(haystack) ? 5 : 0;
    case "risk_factors":
    case "mda_summary":
    case "unknown":
      return 0;
  }
}

function buildSupplementalContextChunks(
  filing: FilingCacheRecord,
  questionIntent: QuestionIntent,
  selected: Map<string, SourceChunkRecord>,
  profile: ContextProfile,
  diagnostics: MutableSelectionDiagnostics
): SourceChunkRecord[] {
  const text = normalizeWhitespace(filing.mdaText);
  if (!text || profile.supplementalSources <= 0) {
    return [];
  }

  const pattern = supplementalPattern(questionIntent);
  const windows = buildIntentTextWindows(text, pattern, questionIntent, profile.supplementalWindowChars, diagnostics);
  const existingTexts = [...selected.values(), ...filing.sourceChunks]
    .filter((chunk) => isSubstantiveDedupSource(chunk, questionIntent))
    .map((chunk) => normalizeForDedup(chunk.text))
    .filter((existing) => existing.length >= 160);
  const result: SourceChunkRecord[] = [];
  let index = 1;

  for (const window of windows) {
    const normalized = normalizeForDedup(window);
    if (
      existingTexts.some((existing) => existing.includes(normalized.slice(0, 160)) || normalized.includes(existing.slice(0, 160))) ||
      result.some((chunk) => isOverlappingSupplement(normalized, normalizeForDedup(chunk.text)))
    ) {
      continue;
    }

    const clippedWindow = clipToSourceExcerpt(window, profile.sourceExcerptChars);
    result.push({
      sourceId: `${SUPPLEMENTAL_SOURCE_PREFIX}${index}`,
      sectionType: "md_a",
      sectionTitle: supplementalSectionTitle(questionIntent),
      sourceLabel: `${filing.formType} ${supplementalSectionTitle(questionIntent)}, filed ${filing.filedAt}`,
      text: clippedWindow,
      startOffset: 0,
      endOffset: clippedWindow.length,
      sortOrder: 1_000 + index
    });
    index += 1;

    if (result.length >= profile.supplementalSources) {
      break;
    }
  }

  return result;
}

function buildIntentTextWindows(
  text: string,
  pattern: RegExp,
  questionIntent: QuestionIntent,
  windowChars: number,
  diagnostics: MutableSelectionDiagnostics
): string[] {
  const matches = [...text.matchAll(pattern)].slice(0, 24);
  const windows = matches.map((match) => extractWindow(text, match.index ?? 0, windowChars));

  if (windows.length === 0 && shouldUseOpeningContext(questionIntent)) {
    windows.push(text.slice(0, windowChars).trim());
  }

  const usable: string[] = [];
  for (const window of windows) {
    diagnostics.candidateSourceCount += 1;
    if (isOffIntentRiskNarrative(questionIntent, window)) {
      diagnostics.rejectedLowTextQualityCount += 1;
      continue;
    }
    const quality = assessNarrativeQuality(window);
    if (shouldRejectNarrativeSource(questionIntent, quality)) {
      recordRejectedNarrative(diagnostics, quality);
      continue;
    }
    usable.push(window);
  }

  return usable.sort((a, b) => supplementalWindowScore(b, questionIntent) - supplementalWindowScore(a, questionIntent));
}

function supplementalPattern(questionIntent: QuestionIntent): RegExp {
  switch (questionIntent) {
    case "business_overview":
      return /item\s+1\.\s*business|business overview|overview|our business|we are|we provide|we offer|products?|services?|customers?|end markets?|reportable segments?|revenue by segment|geograph|accelerated computing|gpu|graphics|compute|semiconductor|data center|gaming|professional visualization|networking|automotive|cloud service providers?|consumer internet|enterprise|oem/gi;
    case "risk_factors":
      return /item\s+1a|risk factors?|\brisks?\b|uncertain|uncertainty|adverse|depend|competition|competitive|cybersecurity|security vulnerabilities|data breach|privacy|data protection|cloud services?|service outage|third-?party|supply|supplier|regulation|regulatory|antitrust|volatility|tariff|macro|export controls?|customer concentration|demand|inventory|geopolitical|manufacturing|semiconductor|artificial intelligence|\bai\b/gi;
    case "segment_analysis":
    case "revenue_breakdown":
      return /reportable segments?|operating segments?|segment revenue|segment income|revenue by segment|disaggregation|geograph|region|products?|services?/gi;
    case "investment_view":
    case "stock_market_context":
      return /risk|uncertain|outlook|guidance|demand|margin|cash flow|repurchase|dividend|competition|supply|regulation|customer|segment|geograph/gi;
    case "mda_summary":
      return /primarily due to|driven by|attributable to|resulted from|because of|reflecting|benefited from|partially offset|offset by|comparable store sales|same-store sales|traffic|ticket|pricing|rate increase|volume|occupancy|leasing|renewal|new stores?|store openings?|tariff|foreign exchange|currency|fuel|weather|customer demand|end-market demand|subscription revenue|annual recurring revenue|\barr\b|new customers?|existing customers?|additional modules?|module adoption|management'?s discussion|results of operations|net sales|gross margin|operating income|demand|expenses?|cash flow/gi;
    case "margin_profitability":
      return /margin|gross profit|operating income|net income|profitability|cost|pricing|expenses?/gi;
    case "cash_flow":
      return /cash flow|liquidity|capital resources|operating activities|repurchase|dividend|capital allocation/gi;
    case "yoy_change":
    case "historical_comparison":
    case "unknown":
      return /primarily due to|driven by|attributable to|resulted from|because of|reflecting|benefited from|partially offset|offset by|comparable store sales|same-store sales|traffic|ticket|pricing|rate increase|volume|occupancy|leasing|renewal|new stores?|store openings?|tariff|foreign exchange|currency|fuel|weather|customer demand|end-market demand|subscription revenue|annual recurring revenue|\barr\b|new customers?|existing customers?|additional modules?|module adoption|increase|decrease|higher|lower|compared|net sales|operating income|net income|growth|demand/gi;
  }
}

function supplementalSectionTitle(questionIntent: QuestionIntent): string {
  switch (questionIntent) {
    case "business_overview":
      return "Business overview context";
    case "risk_factors":
      return "Risk factors context";
    case "segment_analysis":
    case "revenue_breakdown":
      return "Segment and revenue context";
    case "investment_view":
    case "stock_market_context":
      return "Investor context";
    case "mda_summary":
      return "MD&A context";
    case "margin_profitability":
      return "Profitability context";
    case "cash_flow":
      return "Cash flow context";
    case "yoy_change":
    case "historical_comparison":
    case "unknown":
      return "Filing context";
  }
}

function shouldUseOpeningContext(questionIntent: QuestionIntent): boolean {
  return questionIntent === "business_overview" || questionIntent === "mda_summary";
}

function extractWindow(text: string, center: number, size: number): string {
  const half = Math.floor(size / 2);
  let start = Math.max(0, center - half);
  let end = Math.min(text.length, center + half);
  const startBoundary = text.lastIndexOf(". ", start);
  if (startBoundary > 0 && center - startBoundary < size) {
    start = startBoundary + 2;
  }

  const endBoundary = text.indexOf(". ", end);
  if (endBoundary > center && endBoundary - center < size) {
    end = endBoundary + 1;
  }

  return text.slice(start, end).trim();
}

function clipToSourceExcerpt(text: string, maxChars: number): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const clipped = normalized.slice(0, maxChars);
  const sentenceBoundary = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("; "),
    clipped.lastIndexOf("? "),
    clipped.lastIndexOf("! ")
  );
  if (sentenceBoundary > Math.floor(maxChars * 0.65)) {
    return clipped.slice(0, sentenceBoundary + 1).trim();
  }

  const wordBoundary = clipped.lastIndexOf(" ");
  return clipped.slice(0, wordBoundary > Math.floor(maxChars * 0.75) ? wordBoundary : maxChars).trim();
}

function supplementalWindowScore(text: string, questionIntent: QuestionIntent): number {
  return intentSourceScore(
    {
      sourceId: "score-only",
      sectionType: "md_a",
      sectionTitle: supplementalSectionTitle(questionIntent),
      sourceLabel: supplementalSectionTitle(questionIntent),
      text,
      startOffset: 0,
      endOffset: text.length,
      sortOrder: 0
    },
    questionIntent
  );
}

function expandSelectedSourceChunks(
  filing: FilingCacheRecord,
  sourceChunks: SourceChunkRecord[],
  questionIntent: QuestionIntent,
  profile: ContextProfile
): SourceChunkRecord[] {
  return sourceChunks.map((chunk) => expandSelectedSourceChunk(filing, sourceChunks, chunk, questionIntent, profile));
}

function expandSelectedSourceChunk(
  filing: FilingCacheRecord,
  selectedChunks: SourceChunkRecord[],
  chunk: SourceChunkRecord,
  questionIntent: QuestionIntent,
  profile: ContextProfile
): SourceChunkRecord {
  if (chunk.sectionType !== "md_a") {
    return chunk;
  }

  if (chunk.sourceId.startsWith(SUPPLEMENTAL_SOURCE_PREFIX)) {
    const clipped = clipToSourceExcerpt(chunk.text, profile.sourceExcerptChars);
    return {
      ...chunk,
      text: clipped,
      endOffset: chunk.startOffset + clipped.length
    };
  }

  const original = filing.sourceChunks.find((source) => source.sourceId === chunk.sourceId);
  if (!original) {
    return chunk;
  }

  const candidates = [
    chunk.text,
    buildNeighborExpandedText(filing.sourceChunks, original, questionIntent),
    buildOffsetExpandedText(filing.mdaText, original, questionIntent, profile.sourceExcerptChars)
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => clipToSourceExcerpt(value, profile.sourceExcerptChars));

  const best = candidates.sort((a, b) => expandedTextScore(b, selectedChunks, questionIntent) - expandedTextScore(a, selectedChunks, questionIntent))[0];
  if (!best || best.length <= normalizeWhitespace(chunk.text).length) {
    return chunk;
  }

  return {
    ...chunk,
    text: best,
    endOffset: chunk.startOffset + best.length
  };
}

function buildNeighborExpandedText(
  sourceChunks: SourceChunkRecord[],
  chunk: SourceChunkRecord,
  questionIntent: QuestionIntent
): string | null {
  const index = sourceChunks.findIndex((source) => source.sourceId === chunk.sourceId);
  if (index < 0) {
    return null;
  }

  const candidates = [sourceChunks[index - 1], chunk, sourceChunks[index + 1]].filter(
    (source): source is SourceChunkRecord =>
      Boolean(source) &&
      source.sectionType === "md_a" &&
      source.sectionTitle === chunk.sectionTitle &&
      (source.sourceId === chunk.sourceId ||
        (!shouldRejectNarrativeSource(questionIntent, assessNarrativeQuality(source.text)) &&
          !isOffIntentRiskNarrative(questionIntent, `${source.sectionTitle} ${source.sourceLabel} ${source.text}`)))
  );

  const joined = normalizeWhitespace(candidates.map((source) => source.text).join(" "));
  return joined.length > normalizeWhitespace(chunk.text).length ? joined : null;
}

function buildOffsetExpandedText(
  mdaText: string,
  chunk: SourceChunkRecord,
  questionIntent: QuestionIntent,
  sourceExcerptChars: number
): string | null {
  const text = mdaText;
  if (!text || chunk.startOffset < 0 || chunk.startOffset >= text.length) {
    return null;
  }

  const center = Math.min(text.length - 1, Math.max(0, Math.floor((chunk.startOffset + chunk.endOffset) / 2)));
  const window = extractWindow(text, center, sourceExcerptChars);
  if (
    (questionIntent === "yoy_change" || questionIntent === "mda_summary") &&
    hasOffIntentRiskTerms(window) &&
    !hasOffIntentRiskTerms(chunk.text)
  ) {
    return null;
  }
  return window.length > normalizeWhitespace(chunk.text).length ? window : null;
}

function expandedTextScore(text: string, selectedChunks: SourceChunkRecord[], questionIntent: QuestionIntent): number {
  const quality = assessNarrativeQuality(text);
  const base = quality.charCount + narrativeQualityScore(quality, questionIntent) * 20;
  const overlapPenalty = selectedChunks.some((chunk) => chunk.text !== text && isOverlappingSupplement(normalizeForDedup(text), normalizeForDedup(chunk.text)))
    ? 100
    : 0;
  return base - overlapPenalty;
}

function rankDefaultSources(sourceChunks: SourceChunkRecord[]): SourceChunkRecord[] {
  return sourceChunks
    .map((chunk) => ({
      chunk,
      score: defaultSourceScore(chunk)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.sortOrder - b.chunk.sortOrder)
    .map((entry) => entry.chunk);
}

function defaultSourceScore(source: SourceChunkRecord): number {
  if (source.sectionType === "xbrl_metric") {
    return 20;
  }

  const haystack = `${source.sectionTitle} ${source.sourceLabel} ${source.text}`.toLowerCase();
  const quality = assessNarrativeQuality(source.text);
  if (isLowSignalBoilerplate(haystack) || quality.isHeadingOnly || quality.isTableFragment || quality.textRatio <= 0.35) {
    return 0;
  }
  if (/management'?s discussion|results of operations|md&a/.test(haystack)) {
    return 40;
  }
  if (/revenue|net sales|segment|risk|cash flow|margin|demand|outlook/.test(haystack)) {
    return 30;
  }
  return 10;
}

function createSelectionDiagnostics(filing: FilingCacheRecord, profile: ContextProfile): MutableSelectionDiagnostics {
  return {
    candidateSourceCount: 0,
    selectedSourceCount: 0,
    selectedSourceCharCount: 0,
    avgSelectedSourceChars: 0,
    contextTokenBudget: profile.tokenBudget,
    estimatedContextTokens: 0,
    sourceSelectionStrategy: "",
    rejectedShortCount: 0,
    rejectedTableFragmentCount: 0,
    rejectedLowTextQualityCount: 0,
    sectionHitCountBusiness: countContextHits(filing, businessContextPattern()),
    sectionHitCountRisk: countContextHits(filing, riskContextPattern()),
    sectionHitCountMda: countContextHits(filing, /management'?s discussion|results of operations|md&a|operating results|liquidity|capital resources/i)
  };
}

function finalizeSelectionDiagnostics(
  diagnostics: MutableSelectionDiagnostics,
  selectedChunks: SourceChunkRecord[],
  profile: ContextProfile,
  sourceSelectionStrategy: string
): ChatContextSelectionDiagnostics {
  const selectedSourceCharCount = selectedChunks.reduce(
    (sum, chunk) => sum + normalizeWhitespace(chunk.text).length,
    0
  );
  const selectedPayloadChars = selectedChunks.reduce(
    (sum, chunk) => sum + chunk.sourceId.length + chunk.sectionTitle.length + chunk.sourceLabel.length + chunk.text.length + 80,
    0
  );

  return {
    ...diagnostics,
    selectedSourceCount: selectedChunks.length,
    selectedSourceCharCount,
    avgSelectedSourceChars: selectedChunks.length > 0 ? Math.round(selectedSourceCharCount / selectedChunks.length) : 0,
    contextTokenBudget: profile.tokenBudget,
    estimatedContextTokens: Math.ceil(selectedPayloadChars / TOKEN_TO_CHAR_BUDGET_RATIO),
    sourceSelectionStrategy
  };
}

function countContextHits(filing: FilingCacheRecord, pattern: RegExp): number {
  const sourceHits = filing.sourceChunks.filter((chunk) =>
    pattern.test(`${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`)
  ).length;
  pattern.lastIndex = 0;
  const mdaHits = filing.mdaText ? (filing.mdaText.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) ?? []).length : 0;
  pattern.lastIndex = 0;
  return sourceHits + mdaHits;
}

function assessNarrativeQuality(text: string): NarrativeQuality {
  const normalized = normalizeWhitespace(text);
  const charCount = normalized.length;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const sentenceCount = (normalized.match(/[.!?。！？]/g) ?? []).length;
  const digits = (normalized.match(/\d/g) ?? []).length;
  const textChars = (normalized.match(/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length;
  const digitRatio = charCount > 0 ? digits / charCount : 0;
  const textRatio = charCount > 0 ? textChars / charCount : 0;
  const isBoilerplate = isLowSignalBoilerplate(normalized);
  const isShort = charCount < 250;
  const isHeadingOnly = charCount < 120 && sentenceCount === 0 && wordCount <= 8;
  const hasTableBoilerplatePhrase = /table of contents|following table sets forth|expressed as a percentage of revenue/i.test(
    normalized
  );
  const hasBusinessSignal = /accelerated computing|data center|compute|networking|graphics|gaming|professional visualization|automotive|customers?|cloud service providers?|enterprise|revenue from/i.test(
    normalized
  );
  const isTableBoilerplate =
    hasTableBoilerplatePhrase && (charCount < 500 || (!hasBusinessSignal && digitRatio > 0.18));
  const isTableFragment =
    /^(year ended|jan\.?\s+\d+|revenue|gross margin|operating income|net income|total|percentage|in millions)$/i.test(normalized) ||
    (sentenceCount === 0 && (digitRatio > 0.2 || wordCount <= 10)) ||
    (/table sets forth|following table|expressed as a percentage/i.test(normalized) && charCount < 260);
  const hasEnoughSentenceShape = sentenceCount >= 2 || wordCount >= 45;
  const isLowTextQuality = digitRatio >= 0.35 || textRatio <= 0.45 || !hasEnoughSentenceShape;

  return {
    charCount,
    wordCount,
    sentenceCount,
    digitRatio,
    textRatio,
    isShort,
    isTableFragment,
    isTableBoilerplate,
    isHeadingOnly,
    isLowTextQuality,
    isBoilerplate,
    isMeaningful: !isShort && !isTableFragment && !isTableBoilerplate && !isHeadingOnly && !isLowTextQuality && !isBoilerplate
  };
}

function shouldRejectNarrativeSource(questionIntent: QuestionIntent, quality: NarrativeQuality): boolean {
  if (quality.isBoilerplate || quality.isHeadingOnly) {
    return true;
  }

  switch (questionIntent) {
    case "business_overview":
      return quality.isShort || quality.isTableBoilerplate || quality.isTableFragment || (quality.isLowTextQuality && quality.charCount < 700);
    case "risk_factors":
      return quality.isShort || quality.isTableFragment || (quality.isLowTextQuality && quality.charCount < 700);
    case "segment_analysis":
      return quality.isShort || quality.isHeadingOnly || (quality.isTableFragment && quality.charCount < 350);
    case "mda_summary":
    case "investment_view":
    case "stock_market_context":
      return quality.isHeadingOnly || (quality.isTableFragment && quality.charCount < 350);
    case "revenue_breakdown":
      return quality.isHeadingOnly || (quality.isTableFragment && quality.charCount < 300);
    case "margin_profitability":
    case "cash_flow":
    case "yoy_change":
    case "historical_comparison":
    case "unknown":
      return quality.isHeadingOnly || (quality.isTableFragment && quality.charCount < 220);
  }
}

function recordRejectedNarrative(
  diagnostics: MutableSelectionDiagnostics | undefined,
  quality: NarrativeQuality
): void {
  if (!diagnostics) {
    return;
  }

  if (quality.isShort) {
    diagnostics.rejectedShortCount += 1;
  }
  if (quality.isTableFragment || quality.isHeadingOnly) {
    diagnostics.rejectedTableFragmentCount += 1;
  }
  if (quality.isLowTextQuality || quality.isBoilerplate) {
    diagnostics.rejectedLowTextQualityCount += 1;
  }
}

function narrativeQualityScore(quality: NarrativeQuality, questionIntent: QuestionIntent): number {
  let score = 0;
  if (quality.charCount >= 800) {
    score += 20;
  } else if (quality.charCount >= 500) {
    score += 12;
  } else if (quality.charCount >= 250) {
    score += 6;
  }

  if (quality.sentenceCount >= 3) {
    score += 10;
  }
  if (quality.digitRatio < 0.12 && questionIntent === "business_overview") {
    score += 8;
  }
  if (!quality.isTableFragment) {
    score += 5;
  }

  return score;
}

function scoreMatches(haystack: string, entries: Array<[RegExp, number]>): number {
  return entries.reduce((score, [pattern, value]) => (pattern.test(haystack) ? score + value : score), 0);
}

function hasMeaningfulNarrativeShape(text: string): boolean {
  return assessNarrativeQuality(text).isMeaningful;
}

function isLowSignalBoilerplate(text: string): boolean {
  return /available information|available free of charge|forward-looking statements|private securities litigation reform act|investor relations website|corporate website|sec.?s website|securities and exchange commission|investor\.nvidia\.com|should be read in conjunction/i.test(
    text
  );
}

function isSubstantiveDedupSource(source: SourceChunkRecord, questionIntent: QuestionIntent): boolean {
  if (source.sectionType === "xbrl_metric") {
    return normalizeWhitespace(source.text).length >= 160;
  }

  const quality = assessNarrativeQuality(source.text);
  if (quality.isBoilerplate || quality.isHeadingOnly || quality.isTableBoilerplate) {
    return false;
  }

  if (questionIntent === "business_overview") {
    return quality.isMeaningful || normalizeWhitespace(source.text).length >= 700;
  }

  return !quality.isTableFragment && !quality.isShort;
}

function trimToBudget(sourceChunks: SourceChunkRecord[], tokenBudget: number): SourceChunkRecord[] {
  const charBudget = tokenBudget * TOKEN_TO_CHAR_BUDGET_RATIO;
  if (charBudget <= 0) {
    return [];
  }

  const result: SourceChunkRecord[] = [];
  let used = 0;
  for (const chunk of sourceChunks) {
    const estimated = chunk.text.length + chunk.sourceLabel.length + 120;
    if (result.length > 0 && used + estimated > charBudget) {
      continue;
    }

    result.push(chunk);
    used += estimated;
  }

  return result;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeForDedup(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

function isOverlappingSupplement(left: string, right: string): boolean {
  const sampleLeft = left.slice(0, 240);
  const sampleRight = right.slice(0, 240);
  return left.includes(sampleRight) || right.includes(sampleLeft);
}
