import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord, VerifiedFinancialFact } from "../../env";
import { isBoilerplateOrRiskOnly } from "./evidence-text-quality";
import { filingSegmentVocabulary } from "./context-factual-pack";
import { buildChatFactualPack, type ChatFactualPack } from "./context-factual-pack";
import { findMetricSourceChunks, selectIntentMetrics } from "./context-metrics";
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
import { buildVerifiedFinancialFacts } from "./verified-financial-facts";

export type { ChatContextPackMode } from "./context-profile";
export { resolveContentMode } from "./context-profile";

export interface ChatContextPack {
  questionIntent: QuestionIntent;
  contentMode: "full" | "metrics_only";
  metrics: MetricSnapshot[];
  verifiedFacts: VerifiedFinancialFact[];
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
  /**
   * 質問文。会社固有の区分(AWS、iPhone …)を名指ししているとき、その語を含む
   * チャンクを先頭に確保するために使う。Apple の reportable segment は地域なので、
   * segment_analysis の順位付けだけでは iPhone の製品別記述が入らず、モデルが
   * 「製品別内訳は示されていない」と答えていた(2026-08-22 実機レビュー)。
   */
  question?: string;
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

  // 名指しされた区分の本文を最優先で確保する。順位付けの前に入れるので、
  // 予算の端で落ちない。最大3チャンク(同じ語が出る表・注記を全部入れない)。
  const focusPatterns = options.question
    ? filingSegmentVocabulary(filing.ticker).filter((pattern) => pattern.test(options.question!.toLowerCase()))
    : [];
  if (focusPatterns.length > 0) {
    strategyParts.push("segment_focus");
    // 索引済みチャンクには製品別の段落が無いことがある(AAPL は地域別段落にしか
    // iPhone が出ない)。MD&A 全文から名指し語の周辺を窓で切る。
    for (const chunk of buildSegmentFocusChunks(filing, focusPatterns, profile)) add(chunk);
  }

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
    // business_overview はプロファイルに supplementalSources: 5 を持ちながら、
    // 窓切り出しが driver 系の分岐にしか無く一度も使われていなかった。索引済み
    // チャンクが利益率・売上要因の抜粋しか持たない会社(MA)では、事業説明が
    // 文脈に入らず source gate で落ち、モデルが呼ばれもしなかった
    // (2026-08-22 実機レビュー)。Overview の自己紹介文を優先パターンで窓に取る。
    if (questionIntent === "business_overview") {
      const supplementals = buildSupplementalContextChunks(filing, questionIntent, selected, profile, diagnostics);
      // 診断: 窓が何本できたか・MD&A 本文が何字あるか(strategy 文字列に載せる)。
      strategyParts.push(`overview_windows=${supplementals.length}`, `mda_chars=${filing.mdaText?.length ?? 0}`);
      for (const supplemental of supplementals) add(supplemental);
      // MD&A の冒頭は会社の自己紹介であることが多い(「Mastercard is a technology
      // company in the global payments industry…」)。短い MD&A では通常の窓が
      // 選択済み抜粋と重なって全滅するので、冒頭だけは重複判定を免除して入れる。
      const head = buildOverviewHeadWindow(filing, profile);
      if (head && !selected.has(head.sourceId)) {
        strategyParts.push("overview_head");
        add(head);
      }
    }
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

  const expandedChunks = filterRevenueDriverDistractorSources(
    questionIntent,
    filing,
    filterExpandedRiskDistractorSources(
      filing,
      questionIntent,
      expandSelectedSourceChunks(
        filing,
        orderSelectedSources([...selected.values()], questionIntent).slice(0, profile.maxSources),
        questionIntent,
        profile
      )
    )
  );
  const selectedChunks = trimToBudget(expandedChunks, profile.tokenBudget);
  const sourceSelectionStrategy = strategyParts.join(":");
  const selectionDiagnostics = finalizeSelectionDiagnostics(diagnostics, selectedChunks, profile, sourceSelectionStrategy);
  const verifiedFacts = buildVerifiedFinancialFacts(filing, {
    metrics,
    sourceChunks: selectedChunks
  });
  return {
    questionIntent,
    contentMode: resolveContentMode(filing),
    metrics,
    verifiedFacts,
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

function filterRevenueDriverDistractorSources(
  questionIntent: QuestionIntent,
  filing: FilingCacheRecord,
  sourceChunks: SourceChunkRecord[]
): SourceChunkRecord[] {
  if (!shouldLeadWithDriverNarrative(questionIntent)) {
    return sourceChunks;
  }

  const concreteNarrativeCount = sourceChunks.filter((source) =>
    source.sectionType === "md_a" && isConcreteRevenueDriverSource(source)
  ).length;
  if (concreteNarrativeCount < 2) {
    return sourceChunks;
  }

  return sourceChunks.filter((source) => {
    if (source.sectionType !== "md_a" || isConcreteRevenueDriverSource(source)) {
      return true;
    }
    const original = filing.sourceChunks.find((chunk) => chunk.sourceId === source.sourceId);
    const text = `${source.sectionTitle} ${source.sourceLabel} ${source.text} ${original?.text ?? ""}`;
    return !isRevenueDriverBusinessDistractor(text);
  }).map((source) => {
    if (source.sectionType !== "md_a") {
      return source;
    }
    const cleanedText = removeRevenueDriverDistractorSentences(source.text);
    return cleanedText === source.text
      ? source
      : {
        ...source,
        text: cleanedText,
        endOffset: source.startOffset + cleanedText.length
      };
  });
}

function isConcreteRevenueDriverSource(source: SourceChunkRecord): boolean {
  if (isRevenueDriverBusinessDistractor(`${source.sectionTitle} ${source.sourceLabel} ${source.text}`)) {
    return false;
  }
  return hasConcreteRevenueDriverWindow(source.text) && revenueDriverWindowQualityScore(source.text) >= 45;
}

function isRevenueDriverBusinessDistractor(text: string): boolean {
  const haystack = text.toLowerCase();
  if (hasCurrentPeriodDriverSignal(haystack)) {
    return false;
  }

  return hasRevenueDriverBusinessDistractorCue(haystack);
}

function hasRevenueDriverBusinessDistractorCue(text: string): boolean {
  const haystack = text.toLowerCase();
  return /(item\s+2\.?\s+properties|headquarters|office locations?|opened our first|began our first|store footprint|available information|corporate website|business description|history|table of contents|item\s+7a\s+quantitative|item\s+8\s+financial statements)/i.test(haystack) ||
    /(financial subsidiaries|below-market interest rate programs|broad array of financial merchandising programs|primarily responsible for supporting customers|majority of machine sales|nature of customer demand|developing economies)/i.test(haystack) ||
    /(opening new stores and clubs|remodeling existing locations|physical footprint|technology, automation, and our associates|customer experience|omnichannel capabilities|broader set of offerings|site-to-store|pickup or delivery services at over|locations globally|seasonal aspects of operations|suppliers, supply chain and distribution|highest sales volume.*fourth quarter)/i.test(haystack) ||
    (/we operate|we provide|we offer|customer experience|omnichannel capabilities|physical footprint/i.test(haystack));
}

function hasCurrentPeriodDriverSignal(text: string): boolean {
  return /driven by|primarily due to|attributable to|resulted from|reflected|reflecting|partially offset|offset by|total net revenue|net sales|sales and revenues|comparable sales|sales volume|price realization|transactions?|average ticket|unit volumes?|ecommerce sales|member engagement|expected stronger sales|dealer inventor/i.test(text);
}

function isOffIntentRiskNarrative(questionIntent: QuestionIntent, text: string): boolean {
  if (questionIntent === "risk_factors") {
    return isAccountingEstimateRiskDistractor(text);
  }

  if (questionIntent === "margin_profitability") {
    const haystack = text.toLowerCase();
    const hasSpecificMarginResult =
      /(gross margin|operating margin|profit margin|gross profit|operating income|segment operating income|segment operating profit|cost of sales|cost of revenue|operating expenses?|noninterest expense|provision for credit losses|price realization|manufacturing cost|markdown|shrink|refining margins?|chemical margins?).{0,220}(increased|decreased|improved|declined|higher|lower|driven by|due to|reflecting|partially offset|offset by)/i.test(haystack) ||
      /(increased|decreased|improved|declined|higher|lower|driven by|due to|reflecting|partially offset|offset by).{0,220}(gross margin|operating margin|profit margin|gross profit|operating income|segment operating income|segment operating profit|cost of sales|cost of revenue|operating expenses?|noninterest expense|provision for credit losses|price realization|manufacturing cost|markdown|shrink|refining margins?|chemical margins?)/i.test(haystack);
    if (hasOffIntentRiskTerms(haystack) && !hasSpecificMarginResult) {
      return true;
    }
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
    questionIntent === "liquidity_debt" ||
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
    for (const source of findMetricSourceChunks(sourceChunks, metric)) {
      add(source);
    }
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
    case "liquidity_debt":
      return scoreMatches(haystack, [
        [/liquidity|capital resources|cash flow|operating activities|cash and cash equivalents|debt|borrowings?|maturit|credit facilit|revolver|commercial paper|notes payable|capital lease|finance lease/i, 95],
        [/repurchase|dividend|capital allocation|working capital|cash requirements/i, 45]
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
    case "liquidity_debt":
      return /cash|operatingcashflow|operating activities|debt|borrowings?|maturit|liabilities|credit/.test(haystack) ? 35 : 0;
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

const SEGMENT_FOCUS_SOURCE_PREFIX = `${SUPPLEMENTAL_SOURCE_PREFIX}F`;
const OVERVIEW_HEAD_SOURCE_ID = `${SUPPLEMENTAL_SOURCE_PREFIX}H1`;

function buildOverviewHeadWindow(filing: FilingCacheRecord, profile: ContextProfile): SourceChunkRecord | null {
  const text = normalizeWhitespace(filing.mdaText);
  if (text.length < 200) return null;
  // MD&A はしばしば forward-looking statements の注記で始まる。定型段落を
  // 600 字ずつ読み飛ばし、最初の非定型窓(会社の自己紹介が来る位置)を取る。
  let head: string | null = null;
  for (let offset = 0; offset < Math.min(text.length, 6_000); offset += 600) {
    const candidate = clipToSourceExcerpt(text.slice(offset, offset + 1_800), Math.max(profile.sourceExcerptChars, 1_200));
    if (candidate.length < 200) break;
    if (!isBoilerplateOrRiskOnly(candidate, "", "md_a")) {
      head = candidate;
      break;
    }
  }
  if (!head) return null;
  return {
    sourceId: OVERVIEW_HEAD_SOURCE_ID,
    sectionType: "md_a",
    sectionTitle: "Business overview (MD&A opening)",
    sourceLabel: `${filing.formType} Business overview (MD&A opening), filed ${filing.filedAt}`,
    text: head,
    startOffset: 0,
    endOffset: head.length,
    sortOrder: 800
  };
}

/// 質問が名指しした区分(AWS、iPhone …)の周辺を MD&A 全文から切り出す。
/// 当期の増減を述べる窓(increased / decreased / % を含む)を優先し、
/// safe-harbor 等の定型段落は除く。最大3窓。ID は CTX の系譜(CTXF1…)なので、
/// 既存の「補足ソース」扱いがそのまま効く。
function buildSegmentFocusChunks(
  filing: FilingCacheRecord,
  focusPatterns: RegExp[],
  profile: ContextProfile
): SourceChunkRecord[] {
  const text = normalizeWhitespace(filing.mdaText);
  if (!text) return [];
  const windowChars = Math.max(600, Math.min(profile.supplementalWindowChars, 1_400));
  const candidates: Array<{ start: number; text: string; resultLike: boolean }> = [];
  for (const pattern of focusPatterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of [...text.matchAll(global)].slice(0, 40)) {
      const index = match.index ?? 0;
      const start = Math.max(0, index - Math.floor(windowChars / 3));
      const window = text.slice(start, start + windowChars);
      if (isBoilerplateOrRiskOnly(window, "", "md_a")) continue;
      candidates.push({
        start,
        text: window,
        resultLike: /(increased|decreased|grew|declined|\d+(?:\.\d+)?\s*%)/i.test(window)
      });
    }
  }
  candidates.sort((left, right) => Number(right.resultLike) - Number(left.resultLike) || left.start - right.start);
  const result: SourceChunkRecord[] = [];
  for (const candidate of candidates) {
    if (result.some((chunk) => Math.abs((chunk.startOffset ?? 0) - candidate.start) < windowChars / 2)) continue;
    const clipped = clipToSourceExcerpt(candidate.text, profile.sourceExcerptChars);
    result.push({
      sourceId: `${SEGMENT_FOCUS_SOURCE_PREFIX}${result.length + 1}`,
      sectionType: "md_a",
      sectionTitle: "Segment focus",
      sourceLabel: `${filing.formType} Segment focus, filed ${filing.filedAt}`,
      text: clipped,
      startOffset: candidate.start,
      endOffset: candidate.start + clipped.length,
      sortOrder: 900 + result.length
    });
    if (result.length >= 3) break;
  }
  return result;
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
  // 索引済みチャンクは同じ MD&A の抜粋なので、2,500 字の窓は必ずどれかの先頭 160 字を
  // 含む。filing.sourceChunks 全体と重複判定すると窓が全滅する — business_overview の
  // 窓が一度も出なかった理由(2026-08-22)。選択済みソースとだけ比較する。
  const dedupSources = shouldLeadWithDriverNarrative(questionIntent) || questionIntent === "business_overview"
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
  if (questionIntent === "business_overview") {
    // 「何の会社か」に答える文は MD&A の Overview にある自己紹介文
    // ("Mastercard is a technology company in the global payments industry…")。
    // 汎用パターン(products / services / customers)は本文のどこにでも当たるので、
    // その前にこの形の文を優先して窓に取る。無いと MA のように利益率・売上要因の
    // 抜粋だけが文脈になり、モデルが事業を語れず low-quality 判定で落ちる
    // (2026-08-22 実機レビュー)。
    return /\b(?:is|are) (?:a|an|the) (?:leading |global |diversified |technology |multinational |premier |world's )?(?:company|provider|corporation|bank|holding company|financial services|technology company)|we are (?:a|an|the) |our mission|we operate (?:in|through|as)|we generate (?:revenue|net sales|income)|we earn (?:revenue|fees|income)|our (?:principal|primary|core) (?:business|products|services|activities)|our business consists|we (?:design|develop|manufacture|market|sell|provide|offer) /gi;
  }
  if (questionIntent !== "yoy_change" && questionIntent !== "mda_summary") {
    return null;
  }
  return /automotive sales revenue|services and other revenue|total net revenue|sales and revenues|net sales|revenue was|revenues were|revenue increased|revenue decreased|net sales increased|net sales decreased|google services revenues?|google cloud revenues?|youtube ads revenues?|subscriptions?, platforms?, and devices revenues?|aws sales|north america sales|business unit revenue increased|driven by|primarily due to|reflected|reflecting|partially offset|offset by|net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|commodity prices?|crude demand|natural gas prices?|production volumes?|refining margins?|chemical margins?|sales volume|price realization|average selling prices?|bit shipments?|cash deliveries|backlog|dealer inventory|equipment to end users|comparable sales|average ticket|transactions?|traffic|ecommerce|e-commerce|membership income|unit volumes/gi;
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
    case "liquidity_debt":
      return /liquidity|capital resources|cash flow|operating activities|cash and cash equivalents|debt|borrowings?|maturit|credit facilit|revolver|commercial paper|notes payable|cash requirements|working capital/gi;
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
    case "liquidity_debt":
      return "Cash flow / liquidity context";
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
  if (normalized.length <= maxChars && !hasRevenueDriverBusinessDistractorCue(normalized)) {
    return normalized;
  }

  const pattern = supplementalPriorityPattern("yoy_change");
  const match = bestRevenueDriverFocusMatch(normalized, pattern, maxChars);
  pattern && (pattern.lastIndex = 0);
  if (match == null) {
    return clipToSourceExcerpt(normalized, maxChars);
  }

  const shouldAvoidDistractorLead = hasRevenueDriverBusinessDistractorCue(normalized);
  const half = Math.floor(maxChars / 2);
  let start = shouldAvoidDistractorLead
    ? Math.max(0, normalized.lastIndexOf(". ", match - 1) + 2)
    : Math.max(0, match - half);
  let end = Math.min(normalized.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }
  const startBoundary = normalized.lastIndexOf(". ", start);
  if (!shouldAvoidDistractorLead && startBoundary > 0 && match - startBoundary < maxChars) {
    start = startBoundary + 2;
  }
  const endBoundary = normalized.indexOf(". ", end);
  if (endBoundary > match && endBoundary - match < maxChars) {
    end = endBoundary + 1;
  }
  return removeRevenueDriverDistractorSentences(normalized.slice(start, end).trim());
}

function bestRevenueDriverFocusMatch(text: string, pattern: RegExp | null, maxChars: number): number | null {
  if (!pattern) {
    return null;
  }

  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) {
    return null;
  }

  const scored = matches
    .filter((match) => match.index != null && !isRevenueDriverBusinessDistractor(sentenceAround(text, match.index)))
    .map((match) => {
      const index = match.index ?? 0;
      const window = extractFocusedWindow(text, index, maxChars);
      const score = revenueDriverWindowQualityScore(window) + driverSpecificityScore(window) -
        (hasRevenueDriverBusinessDistractorCue(window) ? 60 : 0);
      return { index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored[0]?.index ?? matches[0]?.index ?? null;
}

function sentenceAround(text: string, index: number | undefined): string {
  const center = Math.max(0, index ?? 0);
  const start = Math.max(0, text.lastIndexOf(". ", center - 1) + 2);
  const endBoundary = text.indexOf(". ", center);
  const end = endBoundary === -1 ? text.length : endBoundary + 1;
  return text.slice(start, end);
}

function removeRevenueDriverDistractorSentences(text: string): string {
  if (!hasRevenueDriverBusinessDistractorCue(text)) {
    return text;
  }

  const sentences = text.split(/(?<=\.)\s+/).filter((sentence) => sentence.trim().length > 0);
  const kept = sentences.filter((sentence) =>
    !hasRevenueDriverBusinessDistractorCue(sentence) ||
    (hasConcreteRevenueDriverWindow(sentence) && !isRevenueDriverBusinessDistractor(sentence))
  );
  if (kept.length === 0 || kept.length === sentences.length) {
    return text;
  }
  return kept.join(" ").trim();
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
  const hasRevenueCausalLink = hasRevenueCausalRelationship(haystack);
  const hasConcreteSectorKpi =
    /net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|card services|commodity prices?|crude|natural gas|production volumes?|refining margins?|chemical margins?|upstream|downstream|sales volume|price realization|average selling prices?|bit shipments?|cash deliveries|automotive sales|services and other revenue|backlog|dealer inventory|equipment to end users|construction industries|resource industries|power & energy|comparable sales|transactions?|traffic|ticket|ecommerce|e-commerce|membership|average ticket|unit volumes|google services|google cloud|youtube ads|paid subscriptions?|customer usage|unit sales/.test(haystack);
  let score = 0;
  if (/(total net revenue|net sales|sales and revenues|sales|revenue).{0,220}(up|down|increased|decreased|growth|decline|higher|lower|compared)/.test(haystack)) {
    score += 45;
  }
  if (/(up|down|increased|decreased|growth|decline|higher|lower).{0,220}(total net revenue|net sales|sales and revenues|sales|revenue)/.test(haystack)) {
    score += 35;
  }
  if (hasRevenueCausalLink) {
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
  if (/automotive sales|services and other revenue|cash deliveries|average selling prices?|sales mix|used vehicle sales volume|supercharging|insurance business revenue/.test(haystack)) {
    score += 45;
  }
  if (/google services|google cloud|youtube ads|paid subscriptions?|aws sales|customer usage|unit sales|third-party sellers?|bit shipments?/.test(haystack)) {
    score += 45;
  }
  if (/(?:cash provided by operating activities|operating cash flows?|capital expenditures?|technology and infrastructure costs?|fulfillment costs?|operating expenses?|net income|earnings driver analysis).{0,220}(?:driven by|primarily due to|reflecting)/.test(haystack) && !hasRevenueCausalLink) {
    score -= 180;
  }
  // could differ materially / safe harbor / cautionary: 「forward-looking statements」の語を
  // 含まない safe-harbor 段落が文脈パックの先頭に選ばれていた(2026-08-22 実機レビュー)。
  if (/risk factors?|forward-looking statements?|could differ materially|safe harbor|cautionary statements?|available information|properties|website/.test(haystack) && !/driven by|primarily due to|reflected|reflecting|total net revenue|net sales|sales and revenues/.test(haystack)) {
    score -= 80;
  }
  if (isBroadEnergyContextWithoutPeriodResult(haystack)) {
    score -= 140;
  }
  if (!hasRevenueCausalLink && !hasConcreteSectorKpi) {
    score -= 120;
  }
  return score;
}

function hasConcreteRevenueDriverWindow(text: string): boolean {
  const haystack = text.toLowerCase();
  const hasRevenueMovement =
    /(total net revenue|net sales|sales and revenues|sales|revenue|comparable sales).{0,220}(up|down|increased|decreased|growth|decline|higher|lower|compared)|(?:up|down|increased|decreased|growth|decline|higher|lower).{0,220}(total net revenue|net sales|sales and revenues|sales|revenue|comparable sales)/.test(haystack);
  const hasBankEvidence = /net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|card services/.test(haystack);
  const hasEnergyEvidence = /commodity prices?|crude demand|natural gas prices?|production volumes?|refining margins?|chemical margins?|upstream|downstream/.test(haystack);
  const hasIndustrialEvidence = /sales volume|price realization|backlog|dealer inventory|equipment to end users|construction industries|resource industries|power & energy/.test(haystack);
  const hasRetailEvidence = /comparable sales|transactions?|traffic|average ticket|ecommerce|e-commerce|membership|unit volumes/.test(haystack);
  const hasAutoEvidence = /automotive sales|services and other revenue|cash deliveries|average selling prices?|sales mix|used vehicle sales volume|supercharging|insurance business revenue/.test(haystack);
  const hasTechnologyEvidence = /google services|google cloud|youtube ads|paid subscriptions?|aws sales|customer usage|unit sales|third-party sellers?|average selling prices?|bit shipments?/.test(haystack);
  const hasSectorEvidence = hasBankEvidence || hasEnergyEvidence || hasIndustrialEvidence || hasRetailEvidence || hasAutoEvidence || hasTechnologyEvidence;

  if (hasEnergyEvidence && !hasCurrentPeriodEnergyResultContext(haystack)) {
    return false;
  }

  const hasRevenueCausalLink = hasRevenueCausalRelationship(haystack);
  return (hasRevenueMovement && (hasRevenueCausalLink || hasSectorEvidence)) || (hasRevenueCausalLink && hasSectorEvidence);
}

function hasRevenueCausalRelationship(text: string): boolean {
  const subject = "(?:total net revenue|total revenues?|net sales|sales and revenues|automotive sales revenue|services and other revenue|google services revenues?|google cloud revenues?|youtube ads revenues?|aws sales|north america sales|business unit revenue|comparable sales|net interest income|noninterest revenue)";
  const movement = "(?:increased|decreased|grew|growth|higher|lower|up|down)";
  const cause = "(?:driven by|primarily due to|due to|reflecting|attributable to|positively contributed|partially offset)";
  return new RegExp(`${subject}.{0,300}${movement}.{0,260}${cause}`, "i").test(text) ||
    new RegExp(`${subject}.{0,300}${cause}.{0,260}${movement}`, "i").test(text) ||
    new RegExp(`${movement}.{0,180}${subject}.{0,260}${cause}`, "i").test(text);
}

function hasCurrentPeriodEnergyResultContext(text: string): boolean {
  const hasEnergyResultMetric =
    /(sales and other operating revenue|revenue|sales|earnings|operating results?|upstream earnings|downstream earnings|energy products sales).{0,240}(increase|decrease|up|down|higher|lower|decline|growth|compared|affected|impact|reflected|reflecting|driven|due to|resulting)/.test(text) ||
    /(increase|decrease|up|down|higher|lower|decline|growth|compared|affected|impact|reflected|reflecting|driven|due to|resulting).{0,240}(sales and other operating revenue|revenue|sales|earnings|operating results?|upstream earnings|downstream earnings|energy products sales)/.test(text);
  const hasCurrentPeriodCue = /(202[0-9]|fiscal|year ended|three months ended|quarter|current year|compared with|compared to|%)/.test(text);
  const hasEnergyDriver = /(crude prices?|oil prices?|brent|natural gas prices?|production volumes?|liquids?|gas production|refining margins?|refinery margins?|chemical margins?|upstream|downstream|volume\/mix|volume mix|price mix)/.test(text);
  const hasStrongEnergyResultExplanation = hasEnergyResultMetric && hasEnergyDriver;
  return (hasCurrentPeriodCue || hasStrongEnergyResultExplanation) && hasEnergyResultMetric && hasEnergyDriver && !isBroadEnergyContextWithoutPeriodResult(text);
}

function isBroadEnergyContextWithoutPeriodResult(text: string): boolean {
  return /(proved reserves?|reserve disclosures?|long[- ]term|over the long term|market supply and demand|general economic activities|levels of prosperity|technology advances|consumer preference|government policies|production sharing contracts?|price effects on production sharing contracts|energy transition|risk factors?)/.test(text) &&
    !/(sales and other operating revenue|revenue|sales|earnings|operating results?).{0,240}(increase|decrease|up|down|higher|lower|decline|growth|affected|impact|reflected|reflecting|driven|due to|resulting)/.test(text);
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
  if (/automotive sales|cash deliveries|average selling prices?|services and other revenue|used vehicle sales volume|supercharging|insurance business revenue/.test(haystack)) {
    score += 55;
  }
  if (/google services|google cloud|youtube ads|paid subscriptions?|aws sales|customer usage|unit sales|third-party sellers?|bit shipments?/.test(haystack)) {
    score += 55;
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
          !isOffIntentRiskNarrative(questionIntent, `${source.sectionTitle} ${source.sourceLabel} ${source.text}`) &&
          !(shouldLeadWithDriverNarrative(questionIntent) && isRevenueDriverBusinessDistractor(source.text))))
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
  if (
    shouldLeadWithDriverNarrative(questionIntent) &&
    hasRevenueDriverBusinessDistractorCue(window) &&
    !hasRevenueDriverBusinessDistractorCue(chunk.text)
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
