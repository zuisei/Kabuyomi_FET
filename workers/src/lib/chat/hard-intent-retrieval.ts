import type { FilingCacheRecord, SourceChunkRecord } from "../../env";
import type { ChatContextPack } from "./context-pack";
import type { HardFinancialIntent, SourceGateResult, SourceGateSector } from "./source-gate";

export type HardIntentRetrievalMode = "off" | "diagnostic" | "active";

export type HardIntentRetrievalQuery = {
  query: string;
  purpose: string;
  missingSourceTypes: string[];
  priority: number;
};

export type HardIntentRetrievalPlan = {
  shouldRetryRetrieval: boolean;
  queries: HardIntentRetrievalQuery[];
  maxExtraSources: number;
  maxExtraChars: number;
  reason: string;
};

export type HardIntentRetrievalInput = {
  ticker: string;
  companyName?: string;
  sector: SourceGateSector;
  questionIntent: string;
  question: string;
  rewrittenQuestion?: string;
  previousQuestion?: string;
  previousAnswer?: string;
  conversationContext?: string;
  sourceGateResult: SourceGateResult;
  sourceGateMissingSourceTypes?: string[];
  selectedSourceLabels?: string[];
  selectedSourceIds?: string[];
  selectedSources?: SourceChunkRecord[];
  filingKey?: string;
  filingType?: string;
};

export type HardIntentRetrievalApplication = {
  contextPack: ChatContextPack;
  addedSources: SourceChunkRecord[];
  outcome: "improved" | "no_improvement" | "not_used";
};

export type HardIntentSourceCoverage = {
  hasMdaRevenueDiscussion: boolean;
  hasProfitabilityDiscussion: boolean;
  hasSegmentResults: boolean;
  hasGeographicOrProductRevenue: boolean;
  hasLiquidityOrDebtWindow: boolean;
  hasRiskFactorsWindow: boolean;
  hasSectorKpiWindow: boolean;
  sectorKpiHits: string[];
  missingCoverage: string[];
  coverageScore: number;
  reason: string;
};

const MAX_EXTRA_SOURCES = 3;
const MAX_EXTRA_CHARS = 3_000;
const HARD_CONTEXT_PREFIX = "HARDCTX";

export function resolveHardIntentRetrievalMode(raw?: string | null): HardIntentRetrievalMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "off" || normalized === "diagnostic" || normalized === "active") {
    return normalized;
  }
  return "diagnostic";
}

export function buildHardIntentRetrievalPlan(input: HardIntentRetrievalInput): HardIntentRetrievalPlan {
  const hardIntent = input.sourceGateResult.hardIntent;
  if (!hardIntent || input.sourceGateResult.sourceSufficient) {
    return {
      shouldRetryRetrieval: false,
      queries: [],
      maxExtraSources: MAX_EXTRA_SOURCES,
      maxExtraChars: MAX_EXTRA_CHARS,
      reason: "Hard-intent retrieval is not needed."
    };
  }

  const missingSourceTypes = input.sourceGateMissingSourceTypes?.length
    ? input.sourceGateMissingSourceTypes
    : inferMissingSourceTypes(input.sector, hardIntent);
  const templates = queryTemplatesFor(input.ticker, input.companyName, input.sector, hardIntent, missingSourceTypes, input.previousAnswer);
  const queries = dedupeQueries(templates).slice(0, 3).map((query, index) => ({
    query,
    purpose: purposeFor(input.sector, hardIntent, missingSourceTypes),
    missingSourceTypes,
    priority: index + 1
  }));

  return {
    shouldRetryRetrieval: queries.length > 0,
    queries,
    maxExtraSources: MAX_EXTRA_SOURCES,
    maxExtraChars: MAX_EXTRA_CHARS,
    reason: queries.length > 0
      ? "Source gate found missing hard-intent driver evidence, so one targeted filing-source retrieval is recommended."
      : "No deterministic hard-intent retrieval query could be built."
  };
}

export function applyHardIntentRetrievalPlan(
  filing: FilingCacheRecord,
  contextPack: ChatContextPack,
  plan: HardIntentRetrievalPlan,
  hardIntent: HardFinancialIntent
): HardIntentRetrievalApplication {
  if (!plan.shouldRetryRetrieval || plan.queries.length === 0) {
    return {
      contextPack,
      addedSources: [],
      outcome: "not_used"
    };
  }

  const selectedIds = new Set(contextPack.sourceChunks.map((source) => source.sourceId));
  const candidateSources = rankSourceChunkCandidates(filing.sourceChunks, plan, hardIntent)
    .filter((source) => !selectedIds.has(source.sourceId))
    .slice(0, plan.maxExtraSources);

  const existingTexts = new Set([
    ...contextPack.sourceChunks.map((source) => normalizeForDedup(source.text)),
    ...candidateSources.map((source) => normalizeForDedup(source.text))
  ]);
  const windowSources = buildMdaWindowCandidates(filing, plan, hardIntent, existingTexts)
    .slice(0, Math.max(0, plan.maxExtraSources - candidateSources.length));

  const addedSources = [...candidateSources, ...windowSources];
  if (addedSources.length === 0) {
    return {
      contextPack: withRetrievalDiagnostics(contextPack, contextPack.sourceChunks, "hard_intent_targeted_retrieval:no_sources"),
      addedSources: [],
      outcome: "no_improvement"
    };
  }

  const merged = [...addedSources, ...contextPack.sourceChunks];
  const trimmed = trimSourcesByChars(dedupeSources(merged), contextPack.contextTokenBudget * 4);
  const addedIds = new Set(addedSources.map((source) => source.sourceId));
  const keptAddedSources = trimmed.filter((source) => addedIds.has(source.sourceId));
  const nextPack: ChatContextPack = {
    ...contextPack,
    sourceChunks: trimmed,
    selectedSourceCount: trimmed.length,
    sourceSelectionStrategy: `${contextPack.sourceSelectionStrategy}:hard_intent_targeted_retrieval`,
    selectionDiagnostics: {
      ...contextPack.selectionDiagnostics,
      candidateSourceCount: contextPack.selectionDiagnostics.candidateSourceCount + addedSources.length,
      selectedSourceCount: trimmed.length,
      selectedSourceCharCount: trimmed.reduce((sum, source) => sum + source.text.length, 0),
      avgSelectedSourceChars: trimmed.length > 0
        ? Math.round(trimmed.reduce((sum, source) => sum + source.text.length, 0) / trimmed.length)
        : 0,
      estimatedContextTokens: Math.ceil(trimmed.reduce((sum, source) => sum + source.text.length, 0) / 4),
      sourceSelectionStrategy: `${contextPack.sourceSelectionStrategy}:hard_intent_targeted_retrieval`
    }
  };

  return {
    contextPack: nextPack,
    addedSources: keptAddedSources,
    outcome: keptAddedSources.length > 0 ? "improved" : "no_improvement"
  };
}

export function analyzeHardIntentSourceCoverage({
  filing,
  sector,
  questionIntent,
  sourceGateMissingSourceTypes,
  selectedSourceLabels,
  selectedSourceIds
}: {
  filing: FilingCacheRecord;
  sector: SourceGateSector;
  questionIntent: string;
  sourceGateMissingSourceTypes: string[];
  selectedSourceLabels?: string[];
  selectedSourceIds?: string[];
}): HardIntentSourceCoverage {
  const selectedIds = new Set(selectedSourceIds ?? []);
  const selectedLabels = new Set((selectedSourceLabels ?? []).map((label) => label.toLowerCase()));
  const candidateTexts = [
    filing.mdaText,
    ...filing.sourceChunks
      .filter((source) => selectedIds.size === 0 || selectedIds.has(source.sourceId) || selectedLabels.has(source.sourceLabel.toLowerCase()))
      .map((source) => `${source.sectionTitle} ${source.sourceLabel} ${source.text}`)
  ];
  const fullText = normalize(candidateTexts.join("\n"));
  const allSourceText = normalize([
    filing.mdaText,
    ...filing.sourceChunks.map((source) => `${source.sectionTitle} ${source.sourceLabel} ${source.text}`)
  ].join("\n"));
  const hasMdaRevenueDiscussion = /management.?s discussion|md&a|results of operations/.test(allSourceText) &&
    /revenue|net sales|sales/.test(allSourceText);
  const hasProfitabilityDiscussion = /gross margin|operating margin|operating income|profitability|cost of revenue|operating expenses?|noninterest expense|provision/.test(allSourceText);
  const hasSegmentResults = /segment results|reportable segments?|operating segments?|segment revenue|segment operating income|business segments?/.test(allSourceText);
  const hasGeographicOrProductRevenue = /geographic|region|product revenue|services revenue|product sales|category revenue|international revenue/.test(allSourceText);
  const hasLiquidityOrDebtWindow = /liquidity|debt|borrowings?|maturit|cash flow|credit facilit|deposits|capital ratios?/.test(allSourceText);
  const hasRiskFactorsWindow = /risk factors?|market risk|credit risk|operational risk/.test(allSourceText);
  const sectorKpiHits = sectorKpiTermsFor(sector).filter((term) => allSourceText.includes(term.toLowerCase()));
  const hasSectorKpiWindow = sectorKpiHits.length > 0;
  const missingCoverage = new Set<string>();

  if (!hasMdaRevenueDiscussion) missingCoverage.add("MD&A revenue discussion");
  if (!hasSegmentResults && sourceGateMissingSourceTypes.some((type) => /segment/i.test(type))) missingCoverage.add("segment results");
  if (!hasSectorKpiWindow) missingCoverage.add(`${sector} sector KPI window`);
  if (questionIntent.includes("margin") && !hasProfitabilityDiscussion) missingCoverage.add("profitability or margin discussion");
  if (sourceGateMissingSourceTypes.some((type) => /geographic|product|revenue note/i.test(type)) && !hasGeographicOrProductRevenue) {
    missingCoverage.add("geographic or product revenue");
  }
  if (sourceGateMissingSourceTypes.some((type) => /liquidity|debt|cash/i.test(type)) && !hasLiquidityOrDebtWindow) {
    missingCoverage.add("liquidity or debt window");
  }
  if (/risk/i.test(questionIntent) && !hasRiskFactorsWindow) {
    missingCoverage.add("risk factors window");
  }

  let coverageScore = 0;
  if (hasMdaRevenueDiscussion) coverageScore += 25;
  if (hasProfitabilityDiscussion) coverageScore += 15;
  if (hasSegmentResults) coverageScore += 20;
  if (hasGeographicOrProductRevenue) coverageScore += 10;
  if (hasSectorKpiWindow) coverageScore += Math.min(25, 8 + sectorKpiHits.length * 3);
  if (fullText.length > 0 && selectedIds.size > 0) coverageScore += 5;
  coverageScore = Math.min(100, coverageScore);

  return {
    hasMdaRevenueDiscussion,
    hasProfitabilityDiscussion,
    hasSegmentResults,
    hasGeographicOrProductRevenue,
    hasLiquidityOrDebtWindow,
    hasRiskFactorsWindow,
    hasSectorKpiWindow,
    sectorKpiHits,
    missingCoverage: [...missingCoverage],
    coverageScore,
    reason: coverageScore >= 60
      ? "Available filing source asset appears to contain some hard-intent evidence windows."
      : "Available filing source asset appears thin for the missing hard-intent evidence windows."
  };
}

function queryTemplatesFor(
  ticker: string,
  companyName: string | undefined,
  sector: SourceGateSector,
  hardIntent: HardFinancialIntent,
  missingSourceTypes: string[],
  previousAnswer?: string
): string[] {
  if (hardIntent === "driver_durability_followup") {
    const priorDriverTerms = extractPriorDriverTerms(previousAnswer ?? "");
    if (priorDriverTerms.length > 0) {
      return [
        `${ticker} ${priorDriverTerms.join(" ")} outlook risk demand seasonality trend`,
        `${ticker} ${priorDriverTerms.join(" ")} orders backlog demand trend MD&A`,
        ...revenueDriverQueries(ticker, companyName, sector)
      ];
    }
    return revenueDriverQueries(ticker, companyName, sector);
  }

  if (hardIntent === "margin_durability_followup") {
    return marginDurabilityQueries(ticker, sector, missingSourceTypes);
  }

  return revenueDriverQueries(ticker, companyName, sector);
}

function revenueDriverQueries(ticker: string, companyName: string | undefined, sector: SourceGateSector): string[] {
  const issuer = ticker || companyName || "";
  const templates: Record<SourceGateSector, string[]> = {
    bank: [
      `${issuer} net interest income noninterest income provision for credit losses segment results MD&A`,
      `${issuer} revenue drivers net interest income noninterest income annual report`,
      `${issuer} Consumer Wealth Investment Banking Trading segment revenue`
    ],
    capital_markets: [
      `${issuer} investment banking trading asset management wealth management net interest income`,
      `${issuer} institutional securities wealth management segment results revenue drivers`,
      `${issuer} advisory underwriting trading wealth management revenue MD&A`
    ],
    energy: [
      `${issuer} commodity prices production volumes upstream downstream refining margin segment results`,
      `${issuer} revenue drivers crude oil natural gas production refining chemical margins`
    ],
    oilfield_services: [
      `${issuer} drilling activity completion activity international North America oilfield services revenue drivers`,
      `${issuer} segment results revenue drivers oilfield services margins`
    ],
    industrial: [
      `${issuer} price realization sales volume orders backlog dealer inventory segment results`,
      `${issuer} revenue drivers price volume backlog manufacturing cost MD&A`
    ],
    retail: [
      `${issuer} comparable sales traffic ticket eCommerce membership advertising gross margin segment results`,
      `${issuer} sales drivers comparable sales traffic ticket inventory MD&A`
    ],
    consumer_staples: [
      `${issuer} pricing volume foreign exchange gross margin organic sales`,
      `${issuer} sales drivers pricing volume organic sales gross margin MD&A`,
      `${issuer} segment results pricing volume foreign exchange`
    ],
    auto: [
      `${issuer} deliveries pricing automotive gross margin production volume revenue drivers`,
      `${issuer} segment results revenue drivers deliveries average selling price energy services`
    ],
    technology: [
      `${issuer} product revenue services revenue geographic revenue customer growth MD&A`,
      `${issuer} revenue drivers product launches services geographic revenue channel inventory`
    ],
    software: [
      `${issuer} subscription revenue usage customers RPO deferred revenue revenue drivers`,
      `${issuer} revenue drivers customers usage retention expansion`
    ],
    semiconductor_equipment: [
      `${issuer} orders backlog wafer fab equipment demand China revenue drivers segment results`,
      `${issuer} semiconductor equipment revenue drivers backlog customer demand MD&A`
    ],
    healthcare_medtech: [
      `${issuer} procedure volume installed base systems placements instruments accessories revenue drivers`,
      `${issuer} healthcare utilization systems placements recurring revenue MD&A`
    ],
    reit: [
      `${issuer} occupancy same-store NOI rent senior housing medical office debt maturities`,
      `${issuer} segment results NOI occupancy revenue drivers MD&A`,
      `${issuer} net operating income occupancy same-store growth rental revenue`
    ],
    media: [
      `${issuer} advertising revenue affiliate revenue retransmission subscriber content costs segment results`,
      `${issuer} revenue drivers advertising affiliate fees distribution MD&A`
    ],
    utility: [
      `${issuer} rate case regulated returns fuel cost load growth capex revenue drivers`,
      `${issuer} utility revenue drivers rates weather load growth regulated operations`
    ],
    mining: [
      `${issuer} copper price gold price production volume unit costs mining operations revenue drivers`,
      `${issuer} commodity prices production volumes segment results MD&A`
    ],
    general: [
      `${issuer} revenue drivers segment results MD&A`,
      `${issuer} management discussion revenue drivers segment results`
    ]
  };
  return templates[sector] ?? templates.general;
}

function marginDurabilityQueries(ticker: string, sector: SourceGateSector, missingSourceTypes: string[]): string[] {
  const sectorTerms: Record<SourceGateSector, string> = {
    bank: "net interest margin provision noninterest expense compensation expense credit quality segment profitability",
    capital_markets: "compensation expense noninterest expense trading investment banking wealth management margin",
    energy: "upstream earnings downstream refining margin chemical margin costs impairment restructuring",
    oilfield_services: "oilfield services margins completion activity drilling activity costs segment operating income",
    industrial: "price-cost spread manufacturing cost SG&A R&D volume leverage restructuring segment operating profit",
    retail: "gross margin inventory markdown shrink wage fulfillment cost operating expense",
    consumer_staples: "gross margin commodity input costs pricing volume foreign exchange advertising expense",
    auto: "automotive gross margin pricing production cost volume warranty restructuring",
    technology: "gross margin product margin services margin operating expense R&D channel inventory mix pricing",
    software: "gross margin operating margin sales and marketing R&D usage infrastructure costs",
    semiconductor_equipment: "gross margin operating expenses customer demand backlog China restructuring",
    healthcare_medtech: "gross margin procedure volume systems placements instruments accessories operating expense",
    reit: "NOI occupancy interest expense operating expenses same-store growth debt maturities",
    media: "content costs sports rights advertising revenue affiliate fees operating expense segment EBITDA",
    utility: "fuel cost operating expenses rate case regulated returns interest expense capex",
    mining: "unit costs copper price gold price production volume mining costs operating margin",
    general: "gross margin operating margin operating expenses cost pricing mix restructuring impairment provision segment margin"
  };
  const missing = missingSourceTypes.slice(0, 3).join(" ");
  const terms = sectorTerms[sector] ?? sectorTerms.general;
  return [
    `${ticker} gross margin operating margin operating expenses cost pricing mix segment margin`,
    `${ticker} ${terms} MD&A`,
    `${ticker} margin profitability drivers ${missing}`.trim()
  ];
}

function sectorKpiTermsFor(sector: SourceGateSector): string[] {
  const terms: Record<SourceGateSector, string[]> = {
    bank: ["net interest income", "noninterest income", "provision", "deposits", "loans", "credit quality", "segment results"],
    capital_markets: ["investment banking", "trading", "asset management", "wealth management", "institutional securities"],
    energy: ["commodity prices", "production volumes", "upstream", "downstream", "refining margin", "chemical margin"],
    oilfield_services: ["drilling activity", "completion activity", "north america", "international", "oilfield services"],
    industrial: ["price realization", "sales volume", "orders", "backlog", "dealer inventory"],
    retail: ["comparable sales", "traffic", "ticket", "ecommerce", "membership", "gross margin"],
    consumer_staples: ["pricing", "volume", "foreign exchange", "organic sales", "gross margin"],
    auto: ["deliveries", "pricing", "automotive gross margin", "production volume", "average selling price"],
    technology: ["product revenue", "services revenue", "geographic revenue", "product launches", "channel inventory"],
    software: ["subscription revenue", "rpo", "deferred revenue", "customers", "usage", "retention"],
    semiconductor_equipment: ["orders", "backlog", "wafer fab equipment", "customer demand", "china"],
    healthcare_medtech: ["procedure volume", "installed base", "systems placements", "instruments", "accessories"],
    reit: ["occupancy", "same-store noi", "rent", "ffo", "debt maturities"],
    media: ["advertising revenue", "affiliate revenue", "retransmission", "subscriber", "content costs"],
    utility: ["rate case", "regulated returns", "fuel cost", "load growth", "capex"],
    mining: ["copper price", "gold price", "production volume", "unit costs", "mining operations"],
    general: ["segment results", "revenue drivers", "gross margin", "operating expenses"]
  };
  return terms[sector] ?? terms.general;
}

function rankSourceChunkCandidates(
  sources: SourceChunkRecord[],
  plan: HardIntentRetrievalPlan,
  hardIntent: HardFinancialIntent
): SourceChunkRecord[] {
  return sources
    .map((source) => ({ source, score: sourceScore(source, plan, hardIntent) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.source.sortOrder - b.source.sortOrder)
    .map((entry) => entry.source);
}

function sourceScore(source: SourceChunkRecord, plan: HardIntentRetrievalPlan, hardIntent: HardFinancialIntent): number {
  if (source.sectionType === "xbrl_metric") {
    return 0;
  }
  const haystack = normalize(`${source.sectionTitle} ${source.sourceLabel} ${source.text}`);
  if (isWeakHardIntentSource(haystack)) {
    return 0;
  }

  let score = 0;
  for (const query of plan.queries) {
    const terms = significantTerms(query.query);
    const hits = terms.filter((term) => haystack.includes(term)).length;
    score += hits * 12 + phraseHits(haystack, query.query) * 25;
  }

  if (/management.?s discussion|md&a|results of operations/.test(haystack)) score += 45;
  if (/segment results|reportable segments?|operating segments?|segment revenue|segment operating income/.test(haystack)) score += 40;
  if (/revenue|net sales|sales|gross margin|operating margin|operating income/.test(haystack)) score += 20;
  if (/primarily due to|driven by|attributable to|resulted from|because|reflecting|offset by/.test(haystack)) score += 35;
  if (hardIntent === "margin_durability_followup" && /cost|expense|margin|pricing|mix|volume|provision|restructuring|impairment/.test(haystack)) score += 35;
  return score;
}

function buildMdaWindowCandidates(
  filing: FilingCacheRecord,
  plan: HardIntentRetrievalPlan,
  hardIntent: HardFinancialIntent,
  existingTexts: Set<string>
): SourceChunkRecord[] {
  const text = normalizeWhitespace(filing.mdaText);
  if (!text) {
    return [];
  }
  const windows: Array<{ text: string; score: number }> = [];
  for (const query of plan.queries) {
    for (const term of significantTerms(query.query).slice(0, 12)) {
      const index = text.toLowerCase().indexOf(term);
      if (index < 0) {
        continue;
      }
      const window = extractWindow(text, index, 1_100);
      const normalized = normalizeForDedup(window);
      if (!window || existingTexts.has(normalized) || isWeakHardIntentSource(normalize(window))) {
        continue;
      }
      windows.push({ text: window, score: sourceScore(windowToSource(window, filing, 0), plan, hardIntent) });
      existingTexts.add(normalized);
    }
  }

  return windows
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXTRA_SOURCES)
    .map((window, index) => windowToSource(window.text, filing, index + 1));
}

function windowToSource(text: string, filing: FilingCacheRecord, index: number): SourceChunkRecord {
  return {
    sourceId: `${HARD_CONTEXT_PREFIX}${index}`,
    sectionType: "md_a",
    sectionTitle: "Hard intent targeted MD&A context",
    sourceLabel: `${filing.formType} hard-intent targeted MD&A context, filed ${filing.filedAt}`,
    text,
    startOffset: 0,
    endOffset: text.length,
    sortOrder: 900 + index
  };
}

function inferMissingSourceTypes(sector: SourceGateSector, hardIntent: HardFinancialIntent): string[] {
  if (hardIntent === "margin_durability_followup") {
    return ["margin driver discussion", "cost discussion", "segment margin"];
  }
  return revenueDriverQueries("", undefined, sector)[0]
    .split(/\s+/)
    .filter((term) => term.length > 4)
    .slice(0, 5)
    .map((term) => `${term} discussion`);
}

function purposeFor(sector: SourceGateSector, hardIntent: HardFinancialIntent, missingSourceTypes: string[]): string {
  const intent = hardIntent === "margin_durability_followup"
    ? "Find concrete margin driver and durability evidence."
    : hardIntent === "driver_durability_followup"
      ? "Find prior revenue driver and durability evidence."
      : "Find company-specific revenue driver evidence.";
  return `${intent} Missing: ${missingSourceTypes.slice(0, 4).join(", ") || sector}.`;
}

function extractPriorDriverTerms(previousAnswer: string): string[] {
  const allowed = [
    "net interest income",
    "noninterest income",
    "comparable sales",
    "traffic",
    "ticket",
    "ecommerce",
    "commodity prices",
    "production volume",
    "price realization",
    "backlog",
    "orders",
    "subscription revenue",
    "gross margin",
    "occupancy",
    "NOI"
  ];
  const normalized = normalize(previousAnswer);
  return allowed.filter((term) => normalized.includes(term.toLowerCase())).slice(0, 4);
}

function isWeakHardIntentSource(text: string): boolean {
  return /risk factors?|forward-looking statements?|properties|website|table of contents|revenue recognition|accounting polic|available information/.test(text) &&
    !/primarily due to|driven by|attributable to|resulted from|because|segment results|net interest income|comparable sales|production volume|gross margin/.test(text);
}

function significantTerms(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .map((term) => term.replace(/[^a-z0-9&.-]/g, ""))
    .filter((term) => term.length >= 4 && !STOP_TERMS.has(term))
    .slice(0, 18);
}

const STOP_TERMS = new Set(["with", "from", "and", "the", "for", "annual", "report", "md&a", "drivers"]);

function phraseHits(haystack: string, query: string): number {
  const phrases = query.match(/[A-Za-z][A-Za-z& -]{8,}/g) ?? [];
  return phrases.filter((phrase) => haystack.includes(normalize(phrase))).length;
}

function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const normalized = query.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function dedupeSources(sources: SourceChunkRecord[]): SourceChunkRecord[] {
  const byId = new Map<string, SourceChunkRecord>();
  for (const source of sources) {
    if (!byId.has(source.sourceId)) {
      byId.set(source.sourceId, source);
    }
  }
  return [...byId.values()];
}

function trimSourcesByChars(sources: SourceChunkRecord[], maxChars: number): SourceChunkRecord[] {
  const result: SourceChunkRecord[] = [];
  let used = 0;
  for (const source of sources) {
    const remaining = maxChars - used;
    if (remaining <= 0) {
      break;
    }
    if (source.text.length <= remaining) {
      result.push(source);
      used += source.text.length;
      continue;
    }
    if (remaining >= 500) {
      result.push({
        ...source,
        text: source.text.slice(0, remaining).trim(),
        endOffset: source.startOffset + remaining
      });
      break;
    }
  }
  return result;
}

function withRetrievalDiagnostics(contextPack: ChatContextPack, sourceChunks: SourceChunkRecord[], suffix: string): ChatContextPack {
  return {
    ...contextPack,
    sourceChunks,
    selectedSourceCount: sourceChunks.length,
    sourceSelectionStrategy: `${contextPack.sourceSelectionStrategy}:${suffix}`
  };
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForDedup(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, " ").trim();
}
