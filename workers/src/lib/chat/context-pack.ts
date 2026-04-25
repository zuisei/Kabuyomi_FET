import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../../env";
import type { QuestionIntent } from "./intent";

export type ChatContextPackMode = "standard" | "expanded" | "compact";

export interface ChatContextPack {
  questionIntent: QuestionIntent;
  contentMode: "full" | "metrics_only";
  metrics: MetricSnapshot[];
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

  if (shouldLeadWithMetrics(questionIntent)) {
    addMetricSources(filing.sourceChunks, metrics, add);
    addRankedSources(rankedIntentSources, add, profile.maxSources);
  } else {
    addRankedSources(rankedIntentSources, add, profile.maxSources);
    addMetricSources(filing.sourceChunks, metrics, add);
  }

  for (const supplemental of buildSupplementalContextChunks(
    filing,
    questionIntent,
    selected,
    profile,
    diagnostics
  )) {
    add(supplemental);
  }

  if (!hasSelectedNarrative(selected)) {
    for (const chunk of rankDefaultSources(filing.sourceChunks)) {
      if (chunk.sectionType === "md_a") {
        add(chunk);
        break;
      }
    }
  }

  if (selected.size < profile.minSources) {
    for (const chunk of rankDefaultSources(filing.sourceChunks)) {
      add(chunk);
      if (selected.size >= profile.minSources) {
        break;
      }
    }
  }

  const expandedChunks = expandSelectedSourceChunks(
    filing,
    orderSelectedSources([...selected.values()], questionIntent).slice(0, profile.maxSources),
    questionIntent,
    profile
  );
  const selectedChunks = trimToBudget(expandedChunks, profile.tokenBudget);
  const sourceSelectionStrategy = strategyParts.join(":");
  const selectionDiagnostics = finalizeSelectionDiagnostics(diagnostics, selectedChunks, profile, sourceSelectionStrategy);
  return {
    questionIntent,
    contentMode: resolveContentMode(filing),
    metrics,
    sourceChunks: selectedChunks,
    contextTokenBudget: profile.tokenBudget,
    selectedSourceCount: selectedChunks.length,
    sourceSelectionStrategy,
    selectionDiagnostics
  };
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
        tokenBudget: 6_000,
        minSources: 2,
        maxSources: 6,
        supplementalSources: 2,
        sourceExcerptChars: 900,
        supplementalWindowChars: 1_800
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
    questionIntent === "yoy_change" ||
    questionIntent === "historical_comparison"
  );
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
    case "historical_comparison":
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
        [/accelerated computing|artificial intelligence|\bai\b|gpu|graphics|compute|semiconductor|data center|gaming|professional visualization|networking|automotive|cloud service providers?|consumer internet|enterprise|oem/i, 55],
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
      return scoreMatches(haystack, [
        [/item\s+1a|risk factors?/i, 100],
        [riskContextPattern(), 80]
      ]);
    case "mda_summary":
      return scoreMatches(haystack, [
        [/management'?s discussion|results of operations|md&a|operating results|company commentary|demand|net sales|gross margin/i, 70]
      ]);
    case "yoy_change":
      return scoreMatches(haystack, [
        [/increase|decrease|higher|lower|compared|year over year|net sales|operating income|net income|demand|growth/i, 60]
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
    case "historical_comparison":
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
      return /item\s+1\.\s*business|business overview|overview|our business|we are|we provide|we offer|products?|services?|customers?|end markets?|reportable segments?|revenue by segment|geograph|accelerated computing|artificial intelligence|\bai\b|gpu|graphics|compute|semiconductor|data center|gaming|professional visualization|networking|automotive|cloud service providers?|consumer internet|enterprise|oem/gi;
    case "risk_factors":
      return /item\s+1a|risk factors?|\brisks?\b|uncertain|uncertainty|adverse|depend|competition|supply|supplier|regulation|regulatory|volatility|tariff|macro|export controls?|customer concentration|demand|inventory|geopolitical|manufacturing|semiconductor|artificial intelligence|\bai\b/gi;
    case "segment_analysis":
    case "revenue_breakdown":
      return /reportable segments?|operating segments?|segment revenue|segment income|revenue by segment|disaggregation|geograph|region|products?|services?/gi;
    case "investment_view":
    case "stock_market_context":
      return /risk|uncertain|outlook|guidance|demand|margin|cash flow|repurchase|dividend|competition|supply|regulation|customer|segment|geograph/gi;
    case "mda_summary":
      return /management'?s discussion|results of operations|net sales|gross margin|operating income|demand|expenses?|cash flow/gi;
    case "margin_profitability":
      return /margin|gross profit|operating income|net income|profitability|cost|pricing|expenses?/gi;
    case "cash_flow":
      return /cash flow|liquidity|capital resources|operating activities|repurchase|dividend|capital allocation/gi;
    case "yoy_change":
    case "historical_comparison":
    case "unknown":
      return /increase|decrease|higher|lower|compared|net sales|operating income|net income|growth|demand/gi;
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
    buildOffsetExpandedText(filing.mdaText, original, profile.sourceExcerptChars)
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
      (source.sourceId === chunk.sourceId || !shouldRejectNarrativeSource(questionIntent, assessNarrativeQuality(source.text)))
  );

  const joined = normalizeWhitespace(candidates.map((source) => source.text).join(" "));
  return joined.length > normalizeWhitespace(chunk.text).length ? joined : null;
}

function buildOffsetExpandedText(mdaText: string, chunk: SourceChunkRecord, sourceExcerptChars: number): string | null {
  const text = mdaText;
  if (!text || chunk.startOffset < 0 || chunk.startOffset >= text.length) {
    return null;
  }

  const center = Math.min(text.length - 1, Math.max(0, Math.floor((chunk.startOffset + chunk.endOffset) / 2)));
  const window = extractWindow(text, center, sourceExcerptChars);
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

function businessContextPattern(): RegExp {
  return /item\s+1\.\s*business|business overview|overview|our business|we are|we provide|we offer|products?|services?|customers?|end markets?|reportable segments?|geograph|revenue by|disaggregation|accelerated computing|artificial intelligence|\bai\b|gpu|graphics|compute|semiconductor|data center|gaming|professional visualization|networking|automotive|cloud service providers?|consumer internet|enterprise|oem/i;
}

function riskContextPattern(): RegExp {
  return /item\s+1a|risk factors?|\brisks?\b|uncertain|uncertainty|adverse|depend|competition|supply|supplier|regulation|regulatory|volatility|tariff|macro|export controls?|customer concentration|demand|inventory|geopolitical|manufacturing|semiconductor|artificial intelligence|\bai\b/i;
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
  const hasBusinessSignal = /accelerated computing|artificial intelligence|\bai\b|data center|compute|networking|graphics|gaming|professional visualization|automotive|customers?|cloud service providers?|enterprise|revenue from/i.test(
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
