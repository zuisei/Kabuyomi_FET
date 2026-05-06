import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../../env";
import { buildChatFactualPack, type ChatFactualPack } from "./context-factual-pack";
import { findMetricSourceChunk, selectIntentMetrics } from "./context-metrics";
import {
  businessContextPattern,
  isAccountingEstimateRiskDistractor,
  revenueDriverPattern,
  riskContextPattern
} from "./context-patterns";
import {
  contextProfile,
  resolveContentMode,
  shouldLeadWithDriverNarrative,
  shouldLeadWithMetrics,
  type ChatContextPackMode,
  type ContextProfile
} from "./context-profile";
import {
  assessNarrativeQuality,
  isLowSignalBoilerplate,
  isOverlappingSupplement,
  narrativeQualityScore,
  normalizeForDedup,
  normalizeWhitespace,
  shouldRejectNarrativeSource,
  type NarrativeQuality
} from "./context-quality";
import type { QuestionIntent } from "./intent";

export type { ChatContextPackMode } from "./context-profile";
export { resolveContentMode } from "./context-profile";

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

interface RankedSource {
  chunk: SourceChunkRecord;
  score: number;
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
  if (shouldLeadWithDriverNarrative(questionIntent)) {
    return [...sourceChunks].sort((a, b) => sourceOrderScore(b, questionIntent) - sourceOrderScore(a, questionIntent));
  }

  if (
    questionIntent === "margin_profitability" ||
    questionIntent === "cash_flow" ||
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
  const intentScore = intentSourceScore(source, questionIntent);
  score += Math.min(80, Math.floor(intentScore / 3));
  if (questionIntent === "yoy_change" || questionIntent === "mda_summary") {
    score += Math.min(70, Math.max(-70, revenueDriverWindowQualityScore(source.text)));
  }
  return score;
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
        [/comparable sales|comparable store sales|same-store sales|comp sales|transactions?|traffic|ticket|pricing|price realization|realizations?|rate increase|volume|sales volume|occupancy|leasing|renewal|new stores?|store openings?|ecommerce|e-commerce|membership income|advertising|inventory|gross margin|tariff|foreign exchange|currency|fuel|weather|customer demand|end-market demand|commodity|crude oil|natural gas|refining margins?|upstream|downstream|chemical margins?|production volumes?|net interest income|noninterest income|provision for credit losses|deposits?|loans?|assets under management|backlog|dealer inventory|machinery|construction industries|resource industries|energy and transportation/i, 85],
        [/increase|decrease|higher|lower|compared|year over year|net sales|operating income|net income|demand|growth/i, 55]
      ]) + driverSpecificityScore(haystack);
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
  const dedupSources = shouldLeadWithDriverNarrative(questionIntent)
    ? [...selected.values()]
    : [...selected.values(), ...filing.sourceChunks];
  const existingTexts = dedupSources
    .filter((chunk) => isSubstantiveDedupSource(chunk, questionIntent))
    .map((chunk) => normalizeForDedup(chunk.text))
    .filter((existing) => existing.length >= (shouldLeadWithDriverNarrative(questionIntent) ? 80 : 160));
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

    const clippedWindow = shouldLeadWithDriverNarrative(questionIntent)
      ? clipToRevenueDriverExcerpt(window, profile.sourceExcerptChars)
      : clipToSourceExcerpt(window, profile.sourceExcerptChars);
    if (
      shouldLeadWithDriverNarrative(questionIntent) &&
      (revenueDriverWindowQualityScore(clippedWindow) < 20 || !hasConcreteRevenueDriverWindow(clippedWindow))
    ) {
      diagnostics.rejectedLowTextQualityCount += 1;
      continue;
    }
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
  const priorityPattern = supplementalPriorityPattern(questionIntent);
  const priorityMatches = priorityPattern ? [...text.matchAll(priorityPattern)].slice(0, 80) : [];
  const fallbackMatches = [...text.matchAll(pattern)].slice(0, shouldLeadWithDriverNarrative(questionIntent) ? 140 : 40);
  const seenMatchIndexes = new Set<number>();
  const windows = [
    ...priorityMatches.map((match) => {
      seenMatchIndexes.add(match.index ?? -1);
      return extractFocusedWindow(text, match.index ?? 0, windowChars);
    }),
    ...fallbackMatches
      .filter((match) => !seenMatchIndexes.has(match.index ?? -1))
      .map((match) => extractWindow(text, match.index ?? 0, windowChars))
  ];

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
    if (
      shouldLeadWithDriverNarrative(questionIntent) &&
      (revenueDriverWindowQualityScore(window) < 20 || !hasConcreteRevenueDriverWindow(window))
    ) {
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

function supplementalPriorityPattern(questionIntent: QuestionIntent): RegExp | null {
  if (questionIntent !== "yoy_change" && questionIntent !== "mda_summary") {
    return null;
  }
  return /total net revenue|sales and revenues|net sales|revenue was|revenues were|revenue increased|revenue decreased|net sales increased|net sales decreased|driven by|primarily due to|reflected|reflecting|partially offset|offset by|net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|commodity prices?|crude demand|natural gas prices?|production volumes?|refining margins?|chemical margins?|sales volume|price realization|backlog|dealer inventory|equipment to end users|comparable sales|average ticket|transactions?|traffic|ecommerce|e-commerce|membership income|unit volumes/gi;
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
      return /primarily due to|driven by|attributable to|resulted from|because of|reflecting|benefited from|partially offset|offset by|comparable sales|comparable store sales|same-store sales|comp sales|transactions?|traffic|ticket|pricing|price realization|realizations?|rate increase|volume|sales volume|occupancy|leasing|renewal|new stores?|store openings?|ecommerce|e-commerce|membership income|tariff|foreign exchange|currency|fuel|weather|customer demand|end-market demand|commodity|crude oil|natural gas|refining margins?|subscription revenue|annual recurring revenue|\barr\b|new customers?|existing customers?|additional modules?|module adoption|management'?s discussion|results of operations|net sales|gross margin|operating income|demand|expenses?|cash flow/gi;
    case "margin_profitability":
      return /margin|gross profit|operating income|net income|profitability|cost|pricing|expenses?/gi;
    case "cash_flow":
      return /cash flow|liquidity|capital resources|operating activities|repurchase|dividend|capital allocation/gi;
    case "yoy_change":
    case "historical_comparison":
    case "unknown":
      return /primarily due to|driven by|attributable to|resulted from|because of|reflecting|benefited from|partially offset|offset by|comparable sales|comparable store sales|same-store sales|comp sales|transactions?|traffic|ticket|pricing|price realization|realizations?|rate increase|volume|sales volume|occupancy|leasing|renewal|new stores?|store openings?|ecommerce|e-commerce|membership income|advertising|inventory|gross margin|tariff|foreign exchange|currency|fuel|weather|customer demand|end-market demand|commodity|crude oil|natural gas|refining margins?|upstream|downstream|chemical margins?|production volumes?|net interest income|noninterest income|provision for credit losses|deposits?|loans?|assets under management|backlog|dealer inventory|machinery|construction industries|resource industries|energy and transportation|subscription revenue|annual recurring revenue|\barr\b|new customers?|existing customers?|additional modules?|module adoption|sales and revenues|increase|decrease|higher|lower|compared|net sales|operating income|net income|growth|demand/gi;
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
      return questionIntent === "yoy_change" ? "Segment and revenue context" : "Filing context";
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

function extractFocusedWindow(text: string, center: number, size: number): string {
  const before = Math.floor(size * 0.25);
  let start = Math.max(0, center - before);
  let end = Math.min(text.length, start + size);
  if (end - start < size) {
    start = Math.max(0, end - size);
  }
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

function clipToRevenueDriverExcerpt(text: string, maxChars: number): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const pattern = supplementalPriorityPattern("yoy_change");
  const match = pattern ? pattern.exec(normalized) : null;
  pattern && (pattern.lastIndex = 0);
  if (!match || match.index == null) {
    return clipToSourceExcerpt(normalized, maxChars);
  }

  const half = Math.floor(maxChars / 2);
  let start = Math.max(0, match.index - half);
  let end = Math.min(normalized.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }
  const startBoundary = normalized.lastIndexOf(". ", start);
  if (startBoundary > 0 && match.index - startBoundary < maxChars) {
    start = startBoundary + 2;
  }
  const endBoundary = normalized.indexOf(". ", end);
  if (endBoundary > match.index && endBoundary - match.index < maxChars) {
    end = endBoundary + 1;
  }
  return normalized.slice(start, end).trim();
}

function supplementalWindowScore(text: string, questionIntent: QuestionIntent): number {
  const base = intentSourceScore(
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
  return questionIntent === "yoy_change" || questionIntent === "mda_summary"
    ? base + driverSpecificityScore(text) + revenueDriverWindowQualityScore(text)
    : base;
}

function revenueDriverWindowQualityScore(text: string): number {
  const haystack = text.toLowerCase();
  const hasCausalLanguage = /driven by|primarily due to|reflected|reflecting|partially offset|offset by|largely offset|resulting in/.test(haystack);
  const hasConcreteSectorKpi =
    /net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|card services|commodity prices?|crude|natural gas|production volumes?|refining margins?|chemical margins?|upstream|downstream|sales volume|price realization|backlog|dealer inventory|equipment to end users|construction industries|resource industries|power & energy|comparable sales|transactions?|traffic|ticket|ecommerce|e-commerce|membership|average ticket|unit volumes/.test(haystack);
  let score = 0;
  if (/(total net revenue|net sales|sales and revenues|sales|revenue).{0,220}(up|down|increased|decreased|growth|decline|higher|lower|compared)/.test(haystack)) {
    score += 45;
  }
  if (/(up|down|increased|decreased|growth|decline|higher|lower).{0,220}(total net revenue|net sales|sales and revenues|sales|revenue)/.test(haystack)) {
    score += 35;
  }
  if (hasCausalLanguage) {
    score += 45;
  }
  if (/net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|card services/.test(haystack)) {
    score += 35;
  }
  if (/commodity prices?|crude|natural gas|production volumes?|refining margins?|chemical margins?|upstream|downstream/.test(haystack)) {
    score += 35;
  }
  if (/sales volume|price realization|backlog|dealer inventory|equipment to end users|construction industries|resource industries|power & energy/.test(haystack)) {
    score += 35;
  }
  if (/comparable sales|transactions?|traffic|ticket|ecommerce|e-commerce|membership|average ticket|unit volumes/.test(haystack)) {
    score += 35;
  }
  if (/risk factors?|forward-looking statements?|available information|properties|website/.test(haystack) && !/driven by|primarily due to|reflected|reflecting|total net revenue|net sales|sales and revenues/.test(haystack)) {
    score -= 80;
  }
  if (!hasCausalLanguage && !hasConcreteSectorKpi) {
    score -= 120;
  }
  return score;
}

function hasConcreteRevenueDriverWindow(text: string): boolean {
  const haystack = text.toLowerCase();
  const hasRevenueMovement =
    /(total net revenue|net sales|sales and revenues|sales|revenue|comparable sales).{0,220}(up|down|increased|decreased|growth|decline|higher|lower|compared)|(?:up|down|increased|decreased|growth|decline|higher|lower).{0,220}(total net revenue|net sales|sales and revenues|sales|revenue|comparable sales)/.test(haystack);
  const hasCausalLanguage = /driven by|primarily due to|reflected|reflecting|partially offset|offset by|resulting in/.test(haystack);
  const hasBankEvidence = /net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|card services/.test(haystack);
  const hasEnergyEvidence = /commodity prices?|crude demand|natural gas prices?|production volumes?|refining margins?|chemical margins?|upstream|downstream/.test(haystack);
  const hasIndustrialEvidence = /sales volume|price realization|backlog|dealer inventory|equipment to end users|construction industries|resource industries|power & energy/.test(haystack);
  const hasRetailEvidence = /comparable sales|transactions?|traffic|average ticket|ecommerce|e-commerce|membership|unit volumes/.test(haystack);
  const hasSectorEvidence = hasBankEvidence || hasEnergyEvidence || hasIndustrialEvidence || hasRetailEvidence;

  return (hasRevenueMovement && (hasCausalLanguage || hasSectorEvidence)) || (hasCausalLanguage && hasSectorEvidence);
}

function driverSpecificityScore(text: string): number {
  const haystack = text.toLowerCase();
  let score = 0;
  if (/primarily due to|driven by|attributable to|resulted from|because of|reflecting|benefited from/.test(haystack)) {
    score += 90;
  }
  if (/partially offset|offset by/.test(haystack)) {
    score += 35;
  }
  if (/comparable sales|comparable store sales|same-store sales|comp sales|transactions?|traffic|ticket|ecommerce|e-commerce|membership income/.test(haystack)) {
    score += 55;
  }
  if (/price realization|realizations?|pricing|rate increase|sales volume|\bvolume\b|foreign exchange|currency/.test(haystack)) {
    score += 50;
  }
  if (/commodity|crude oil|natural gas|refining margins?|fuel|weather/.test(haystack)) {
    score += 45;
  }
  if (/net interest income|noninterest income|provision for credit losses|deposits?|loans?|assets under management/.test(haystack)) {
    score += 55;
  }
  if (/backlog|dealer inventory|machinery|construction industries|resource industries|energy and transportation/.test(haystack)) {
    score += 50;
  }
  if (/inventory|gross margin|advertising|membership income|ecommerce|e-commerce/.test(haystack)) {
    score += 45;
  }
  if (/sales and revenues|net sales|revenue|sales/.test(haystack) && /increase|decrease|higher|lower|growth|decline|compared/.test(haystack)) {
    score += 30;
  }
  if (/customer demand|end-market demand|market demand|new customers?|existing customers?|additional modules?|module adoption|annual recurring revenue|\barr\b|subscription revenue/.test(haystack)) {
    score += 45;
  }
  if (/customer-centric experience|our stores|our brands|we operate|we provide|we offer/.test(haystack) && !/primarily due to|driven by|attributable to|resulted from|because of|partially offset|offset by/.test(haystack)) {
    score -= 30;
  }
  return score;
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
    const clipped = shouldLeadWithDriverNarrative(questionIntent)
      ? clipToRevenueDriverExcerpt(chunk.text, profile.sourceExcerptChars)
      : clipToSourceExcerpt(chunk.text, profile.sourceExcerptChars);
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

function scoreMatches(haystack: string, entries: Array<[RegExp, number]>): number {
  return entries.reduce((score, [pattern, value]) => (pattern.test(haystack) ? score + value : score), 0);
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
