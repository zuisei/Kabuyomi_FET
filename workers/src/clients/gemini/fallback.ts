import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../../env";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../../lib/metrics";
import { analyzeQuestion, wantsNarrativeDepth, type QuestionProfile } from "./fallback-question";
import type { ChatPromptInput, GeminiChatAnswer } from "./types";

export function localChatFallback(input: ChatPromptInput): GeminiChatAnswer {
  const profile = analyzeQuestion(input.question);
  const sourceChunks = fallbackSourceChunks(input);
  const metric = selectRelevantMetric(input.filing, profile);
  const metricSourceId = metric ? findMetricSourceId(sourceChunks, metric) : undefined;
  const narrative = selectRelevantNarrative(sourceChunks, profile, metricSourceId);
  const nonHardFallback = buildNonHardFallbackIfNeeded(input, profile, sourceChunks, metric, metricSourceId, narrative);

  if (profile.asksBusinessOverview) {
    if (narrative) {
      return {
        answer: summarizeBusinessNarrativeEvidence(narrative, input.filing.companyName),
        sourceIds: [narrative.sourceId]
      };
    }

    return nonHardFallback ?? buildNonHardFallbackAnswer(input, "business_model", metric, metricSourceId, sourceChunks);
  }

  if (profile.asksInvestmentView) {
    const investmentView = buildInvestmentViewFallbackAnswer(input.filing, sourceChunks, narrative);
    if (investmentView) {
      return investmentView;
    }
  }

  if (nonHardFallback && shouldPreferNonHardFallback(input, profile, narrative)) {
    return nonHardFallback;
  }

  if (profile.asksStockPrice || profile.asksRecommendation || profile.asksMarketReaction || profile.asksStockContext) {
    const closest = buildClosestContextFallbackAnswer(metric, metricSourceId, narrative, profile);
    if (closest) {
      return closest;
    }
  }

  if (profile.asksRevenue && profile.asksCause && !metric) {
    const driverSentence = narrative ? summarizeRevenueDriverNarrative(narrative) : null;
    if (driverSentence) {
      return {
        answer: `売上高の直接指標はこの context では確認できませんが、本文では ${driverSentence}`,
        sourceIds: [narrative!.sourceId]
      };
    }

    const nearestMetricSource = sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.text.trim());
    if (nearestMetricSource) {
      return {
        answer: "売上成長の要因は、この資料から直接確認できる売上高指標や要因説明が不足しているため断定できません。純利益や営業利益の数字はありますが、売上成長の主因としては使わない方が安全です。",
        sourceIds: [nearestMetricSource.sourceId]
      };
    }

    return nonHardFallback ?? buildNonHardFallbackAnswer(input, "revenue_driver", metric, metricSourceId, sourceChunks);
  }

  if (profile.asksDurability) {
    const durability = buildDurabilityFallbackAnswer(input.filing, sourceChunks, profile);
    if (durability) {
      return durability;
    }
  }

  if (profile.asksRisk) {
    if (narrative) {
      return buildNarrativeFallbackAnswer(narrative, profile);
    }

    return nonHardFallback ?? buildNonHardFallbackAnswer(input, "risk_summary", metric, metricSourceId, sourceChunks);
  }

  if (profile.asksRegion || profile.asksProductMix) {
    const segment = buildSegmentDriverFallbackAnswer(input.filing, sourceChunks, metric, metricSourceId, narrative);
    if (segment) {
      return segment;
    }
    return nonHardFallback ?? buildNonHardFallbackAnswer(input, "segment_driver", metric, metricSourceId, sourceChunks);
  }

  if (metric && metricSourceId) {
    return buildMetricFallbackAnswer(input.filing, metric, metricSourceId, narrative, profile);
  }

  if (narrative) {
    return buildNarrativeFallbackAnswer(narrative, profile);
  }

  const anchorSource = selectFallbackAnchorSource(sourceChunks);
  if (!anchorSource) {
    return nonHardFallback ?? buildNonHardFallbackAnswer(input, "unknown", metric, metricSourceId, sourceChunks);
  }

  return nonHardFallback ?? buildNonHardFallbackAnswer(input, "unknown", metric, metricSourceId, [anchorSource]);
}

export function recoverBroaderFallbackIfNeeded(
  input: ChatPromptInput,
  response: GeminiChatAnswer
): GeminiChatAnswer {
  const hasLocalFallbackSources = fallbackSourceChunks(input).length > 0;
  if (!hasLocalFallbackSources) {
    return response;
  }

  if (response.sourceIds.length === 0 && isUnavailableOnlyAnswer(response.answer)) {
    return localChatFallback(input);
  }

  const profile = analyzeQuestion(input.question);
  const sourceChunks = fallbackSourceChunks(input);
  const narratives = response.sourceIds
    .map((sourceId) => sourceChunks.find((chunk) => chunk.sourceId == sourceId && chunk.sectionType === "md_a"))
    .filter((chunk): chunk is SourceChunkRecord => Boolean(chunk));

  if (narratives.length > 0 && narratives.every(isLowSignalNarrative) && wantsNarrativeDepth(profile)) {
    return localChatFallback(input);
  }

  return response;
}

function selectRelevantMetric(filing: FilingCacheRecord, profile: QuestionProfile): MetricSnapshot | undefined {
  if (profile.asksBusinessOverview) {
    return undefined;
  }

  if (profile.asksCashFlow || profile.asksCapitalAllocation) {
    return filing.metrics.find((metric) => metric.logicalName === "operatingCashFlow");
  }

  if (profile.asksProfitability) {
    return (
      filing.metrics.find((metric) => metric.logicalName === "operatingIncome") ??
      filing.metrics.find((metric) => metric.logicalName === "netIncome")
    );
  }

  if (profile.asksProfit) {
    return (
      filing.metrics.find((metric) => metric.logicalName === "netIncome") ??
      filing.metrics.find((metric) => metric.logicalName === "operatingIncome") ??
      filing.metrics.find((metric) => metric.logicalName === "epsBasic")
    );
  }

  if (
    profile.asksRevenue ||
    profile.asksStockPrice ||
    profile.asksRecommendation ||
    profile.asksInvestmentView ||
    profile.asksStockContext ||
    profile.asksGuidance ||
    profile.asksForecast
  ) {
    return filing.metrics.find((metric) => metric.logicalName === "revenue");
  }

  return filing.metrics[0];
}

function selectRelevantNarrative(
  sourceChunks: SourceChunkRecord[],
  profile: QuestionProfile,
  metricSourceId?: string
): SourceChunkRecord | undefined {
  const riskFallbackNarrative = profile.asksRisk
    ? selectRiskFallbackNarrative(sourceChunks, metricSourceId)
    : undefined;
  const narratives = sourceChunks.filter(
    (chunk) => chunk.sectionType === "md_a" && chunk.sourceId !== metricSourceId && !isLowSignalNarrative(chunk)
  );

  const findNarrative = (pattern: RegExp) => narratives.find((chunk) => pattern.test(chunk.text.toLowerCase()));
  const driverNarrative =
    findNarrative(revenueDriverNarrativePattern()) ??
    findNarrative(/iphone|services|cloud|ads|americas|china|japan|asia|higher net sales|demand/) ??
    narratives[0];
  const profitNarrative = findNarrative(
    /net loss|net income|loss due to|loss was primarily due to|fair value|impairment|digital asset|bitcoin|interest expense|operating expenses|selling, general and administrative|research and development|income tax|valuation allowance/
  );
  const marginNarrative = findNarrative(
    /margin|pricing|gross margin|profitability|cost|inflation|component|supply chain|販促|コスト/
  );
  const riskNarrative = findNarrative(/risk|uncertain|uncertainty|macro|tariff|pressure|weakness|slowdown|adverse impact/);
  const guidanceNarrative = findNarrative(/guidance|outlook|forecast|expect|cautious|慎重/);
  const cashFlowNarrative = findNarrative(/cash flow|free cash flow|liquidity|cash generation|operating cash flow/);
  const capitalNarrative = findNarrative(/buyback|share repurchase|repurchase|dividend|capital allocation|capital return|shareholder/);

  if (profile.asksTariff) {
    return findNarrative(/tariff|関税/) ?? riskNarrative;
  }

  if (profile.asksCapitalAllocation) {
    return capitalNarrative ?? cashFlowNarrative ?? driverNarrative;
  }

  if (profile.asksCashFlow) {
    return cashFlowNarrative ?? capitalNarrative ?? driverNarrative;
  }

  if (profile.asksBusinessOverview) {
    return findNarrative(
      /precision oncology|oncology|cancer|tumor|screening|diagnostic|blood[- ]based|liquid biopsy|molecular|biopharmaceutical|revenue by|disaggregation of revenue|vehicle sales|automotive|energy generation and storage|subscription and services|transaction revenue|cloud|advertising|accelerated computing|gpu|data center|compute|networking|graphics|gaming|professional visualization|cloud service providers?|enterprise/
    ) ?? driverNarrative;
  }

  if (profile.asksGuidance || profile.asksForecast) {
    return guidanceNarrative ?? riskNarrative ?? driverNarrative;
  }

  if (profile.asksRisk) {
    return riskFallbackNarrative ?? riskNarrative ?? driverNarrative;
  }

  if (profile.asksDurability) {
    return guidanceNarrative ?? riskNarrative ?? driverNarrative;
  }

  if (profile.asksProfit && profile.asksCause) {
    return profitNarrative ?? marginNarrative ?? riskNarrative ?? driverNarrative;
  }

  if (profile.asksProfit) {
    return profitNarrative ?? marginNarrative ?? driverNarrative;
  }

  if (profile.asksProfitability) {
    return marginNarrative ?? driverNarrative;
  }

  if (profile.asksRevenue || profile.asksCause || profile.asksRegion || profile.asksProductMix) {
    return profile.asksRevenue && profile.asksCause
      ? findNarrative(revenueDriverNarrativePattern()) ??
          findNarrative(/revenue|net sales|sales|segment|region|geograph/) ??
          driverNarrative
      : driverNarrative;
  }

  if (
    profile.asksStockPrice ||
    profile.asksRecommendation ||
    profile.asksInvestmentView ||
    profile.asksStockContext ||
    profile.asksMarketReaction
  ) {
    return riskNarrative ?? driverNarrative ?? findNarrative(/demand/);
  }

  return narratives[0];
}

function selectRiskFallbackNarrative(
  sourceChunks: SourceChunkRecord[],
  metricSourceId?: string
): SourceChunkRecord | undefined {
  const riskCandidates = sourceChunks
    .filter((chunk) => chunk.sectionType === "md_a" && chunk.sourceId !== metricSourceId && chunk.text.trim())
    .filter((chunk) => hasRiskContextLabel(chunk) || hasSubstantiveRiskSignal(chunk));

  return (
    riskCandidates.find((chunk) => hasRiskContextLabel(chunk)) ??
    riskCandidates.find((chunk) => !isAccountingOnlyRiskDistractor(chunk)) ??
    riskCandidates[0]
  );
}

function hasRiskContextLabel(chunk: SourceChunkRecord): boolean {
  return /risk factors?|risk factors context/i.test(`${chunk.sectionTitle ?? ""} ${chunk.sourceLabel ?? ""}`);
}

function hasSubstantiveRiskSignal(chunk: SourceChunkRecord): boolean {
  return /risk|uncertain|uncertainty|adverse|depend|competition|regulation|regulatory|geopolitical|volatility|supply|supplier|demand|market|commodity|nuclear|energy|power|electricity/i.test(
    chunk.text
  );
}

function isAccountingOnlyRiskDistractor(chunk: SourceChunkRecord): boolean {
  return /critical accounting|accounting policies|new pronouncements|financial reporting standards?|estimates/i.test(
    chunk.text
  );
}

type NonHardFallbackIntent =
  | "business_model"
  | "segment_driver"
  | "liquidity_debt"
  | "risk_summary"
  | "watch_points"
  | "margin_driver"
  | "prior_filing_delta"
  | "revenue_driver"
  | "unknown";

function buildNonHardFallbackIfNeeded(
  input: ChatPromptInput,
  profile: QuestionProfile,
  sourceChunks: SourceChunkRecord[],
  metric: MetricSnapshot | undefined,
  metricSourceId: string | undefined,
  narrative: SourceChunkRecord | undefined
): GeminiChatAnswer | null {
  const intent = resolveNonHardFallbackIntent(input, profile);
  if (!intent) {
    return null;
  }

  if (narrative && hasDirectNonHardEvidence(intent, narrative)) {
    return null;
  }

  return buildNonHardFallbackAnswer(input, intent, metric, metricSourceId, sourceChunks);
}

function shouldPreferNonHardFallback(
  input: ChatPromptInput,
  profile: QuestionProfile,
  narrative: SourceChunkRecord | undefined
): boolean {
  const intent = resolveNonHardFallbackIntent(input, profile);
  return Boolean(intent && (!narrative || !hasDirectNonHardEvidence(intent, narrative)));
}

function resolveNonHardFallbackIntent(
  input: ChatPromptInput,
  profile: QuestionProfile
): NonHardFallbackIntent | null {
  const questionIntent = input.questionIntent;
  const normalized = input.question.replace(/\s+/g, "").toLowerCase();

  if (questionIntent === "business_overview" || profile.asksBusinessOverview) {
    return "business_model";
  }
  if (
    questionIntent === "segment_analysis" ||
    questionIntent === "revenue_breakdown" ||
    profile.asksRegion ||
    profile.asksProductMix
  ) {
    return "segment_driver";
  }
  if (
    questionIntent === "cash_flow" ||
    /(資金繰り|負債|債務|借入|流動性|liquidity|debt|maturity|cashflow|cash flow)/.test(normalized)
  ) {
    return "liquidity_debt";
  }
  if (questionIntent === "risk_factors" || profile.asksRisk) {
    return "risk_summary";
  }
  if (/(次回決算|次に見る|見るべき|ポイント|watchpoints?|nextquarter|nextfiling)/.test(normalized)) {
    return "watch_points";
  }
  if (questionIntent === "margin_profitability" || profile.asksProfitability) {
    return "margin_driver";
  }
  if (questionIntent === "historical_comparison" || /(前回決算|前回との差|前期との差|previousfiling|priorfiling)/.test(normalized)) {
    return "prior_filing_delta";
  }
  return null;
}

function hasDirectNonHardEvidence(intent: NonHardFallbackIntent, source: SourceChunkRecord): boolean {
  const text = `${source.sourceLabel ?? ""} ${source.sectionTitle ?? ""} ${source.text}`.toLowerCase();
  if (isLowSignalNarrative(source)) {
    return false;
  }
  switch (intent) {
    case "business_model":
      return /(business|segment|revenue by|products?|services?|customers?|operations|principal activities|主な事業|事業内容)/i.test(text);
    case "segment_driver":
      return /(segment results|reportable segments?|geographic|product revenue|regional|walmart u\.s\.|sam'?s club|upstream|downstream|construction industries)/i.test(text);
    case "liquidity_debt":
      return /(liquidity|debt|borrowings?|maturit|cash and cash equivalents|credit facilit|cash flow|capital resources|deposits|capital ratios?)/i.test(text);
    case "risk_summary":
      return /(risk factors?|material risks?|adverse|uncertainty|competition|regulatory|commodity|credit quality)/i.test(text) &&
        !isAccountingOnlyRiskDistractor(source);
    case "watch_points":
      return /(outlook|guidance|expect|risk|segment results|revenue|margin|liquidity|backlog|orders|traffic|ticket|commodity|deposits)/i.test(text);
    case "margin_driver":
      return /(gross margin|operating margin|cost|pricing|mix|operating expenses|provision|restructuring|impairment|segment margin|sg&a|r&d|利益率|悪化|改善|主因|要因|コスト|販促費|費用)/i.test(text);
    case "prior_filing_delta":
      return /(previous filing|prior filing|prior quarter|sequential|前回|前四半期|前期)/i.test(text) ||
        summarizeRevenueDriverNarrative(source) !== null;
    case "revenue_driver":
    case "unknown":
      return false;
  }
}

function buildNonHardFallbackAnswer(
  input: ChatPromptInput,
  intent: NonHardFallbackIntent,
  metric: MetricSnapshot | undefined,
  metricSourceId: string | undefined,
  sourceChunks: SourceChunkRecord[]
): GeminiChatAnswer {
  const sourceIds = fallbackSourceIds(metricSourceId, sourceChunks);
  const metricObservation = metric && metricSourceId ? buildMetricObservation(metric) : null;
  const missing = missingSourceTypesForNonHard(input, intent);
  const missingText = missing.join("、");

  switch (intent) {
    case "business_model":
      return {
        answer: `選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。`,
        sourceIds
      };
    case "segment_driver":
      return {
        answer: `${metricObservation ? `${metricObservation} ` : ""}全社売上の増減は確認できますが、セグメント・地域別の強弱はこの資料では十分に分解できません。確認すべき箇所は、セグメント実績、地域別売上、製品・カテゴリ別売上、業種固有のセグメントKPIです。`,
        sourceIds
      };
    case "liquidity_debt":
      return {
        answer: `選択された資料だけでは、資金繰りや負債を判断するための現金、負債、流動性、満期、キャッシュフローの説明が不足しています。したがって、懸念の有無は断定しません。確認すべき箇所は、貸借対照表、負債の注記、流動性の説明、キャッシュフロー計算書です。`,
        sourceIds
      };
    case "risk_summary":
      return {
        answer: `この資料だけでは、SEC資料固有の重要リスクを十分に絞れません。確認すべき箇所は、リスク要因セクション、MD&Aのリスク説明、業種固有リスクの説明です。一般的なリスク記述だけから重要リスクは断定しません。`,
        sourceIds
      };
    case "watch_points":
      return {
        answer: `次回見るべき点は、現時点で不足している資料に基づくと、1) セグメント別実績、2) 売上要因の説明、3) 資金繰りまたはリスクの説明です。具体的な要因はこの資料だけでは特定しません。`,
        sourceIds
      };
    case "margin_driver":
      {
        const marginObservation = buildTypedMarginDirectionObservation(input.filing, input.question, sourceChunks);
        if (marginObservation) {
          return {
            answer: `${marginObservation.answer} ただし、改善・悪化の具体的な要因は、選択された資料だけでは十分に特定できません。判断には、コスト、構成、価格改定、営業費用、引当、構造改革費用、減損、セグメント利益率の説明が必要です。`,
            sourceIds: marginObservation.sourceIds
          };
        }
      }
      return {
        answer: `${metricObservation ? `${metricObservation} ` : ""}利益率の方向は確認できますが、改善/悪化の具体的な要因は十分に特定できません。判断には、コスト、mix、pricing、営業費用、provision、restructuring、impairment、segment margin の説明が必要です。`,
        sourceIds
      };
    case "prior_filing_delta":
      return {
        answer: `${metricObservation ? `${metricObservation} ` : ""}前年同期比の増減は確認できますが、前回決算との差分には過去の提出資料との比較が必要です。確認すべき箇所は、前回の提出資料、前回のMD&A、前期のXBRL数値です。`,
        sourceIds
      };
    case "revenue_driver":
      return {
        answer: `${metricObservation ? `${metricObservation} ` : ""}売上の増減は確認できますが、会社固有の売上要因は十分に特定できません。確認すべき箇所は ${missingText} です。`,
        sourceIds
      };
    case "unknown":
      return {
        answer: `選択された資料だけでは、この質問に直接答えるための具体的な説明を十分に確認できません。確認すべき箇所は ${missingText} です。`,
        sourceIds
      };
  }
}

function buildTypedMarginDirectionObservation(
  filing: FilingCacheRecord,
  question: string,
  sourceChunks: SourceChunkRecord[]
): { answer: string; sourceIds: string[] } | null {
  const revenue = filing.metrics.find((candidate) => candidate.logicalName === "revenue");
  const operatingIncome = filing.metrics.find((candidate) => candidate.logicalName === "operatingIncome");
  const netIncome = filing.metrics.find((candidate) => candidate.logicalName === "netIncome");
  if (
    !revenue || !operatingIncome || !netIncome ||
    revenue.value === 0 || revenue.comparisonValue === undefined || revenue.comparisonValue === 0 ||
    operatingIncome.comparisonValue === undefined || netIncome.comparisonValue === undefined ||
    !areMarginInputsCompatible(revenue, operatingIncome) ||
    !areMarginInputsCompatible(revenue, netIncome)
  ) {
    return null;
  }

  const revenueSourceId = findMetricSourceId(sourceChunks, revenue);
  const operatingSourceId = findMetricSourceId(sourceChunks, operatingIncome);
  const netSourceId = findMetricSourceId(sourceChunks, netIncome);
  if (!revenueSourceId || !operatingSourceId || !netSourceId) {
    return null;
  }

  const operatingCurrent = operatingIncome.value / revenue.value * 100;
  const operatingPrior = operatingIncome.comparisonValue / revenue.comparisonValue * 100;
  const netCurrent = netIncome.value / revenue.value * 100;
  const netPrior = netIncome.comparisonValue / revenue.comparisonValue * 100;
  const operatingDirection = operatingCurrent >= operatingPrior ? "改善" : "低下";
  const netDirection = netCurrent >= netPrior ? "改善" : "低下";
  const premise = /悪化/u.test(question) && operatingDirection === "改善" && netDirection === "改善"
    ? "提出資料上、今期の利益率悪化は確認できません。"
    : "提出資料上の利益率の方向を確認すると、";
  const answer = `${premise}営業利益率は前年同期の${operatingPrior.toFixed(1)}%から当期の${operatingCurrent.toFixed(1)}%へ${operatingDirection}し、純利益率は前年同期の${netPrior.toFixed(1)}%から当期の${netCurrent.toFixed(1)}%へ${netDirection}しています。`;
  return {
    answer,
    sourceIds: Array.from(new Set([revenueSourceId, operatingSourceId, netSourceId]))
  };
}

function areMarginInputsCompatible(revenue: MetricSnapshot, profit: MetricSnapshot): boolean {
  if (revenue.unit !== profit.unit || revenue.periodEnd !== profit.periodEnd) {
    return false;
  }
  const comparableFields: Array<keyof MetricSnapshot> = [
    "periodStart",
    "periodKind",
    "fiscalYear",
    "fiscalQuarter",
    "comparisonPeriodStart",
    "comparisonPeriodEnd",
    "comparisonPeriodKind",
    "comparisonFiscalYear",
    "comparisonFiscalQuarter"
  ];
  return comparableFields.every((field) => {
    const left = revenue[field];
    const right = profit[field];
    return left === undefined || right === undefined || left === right;
  });
}

function missingSourceTypesForNonHard(
  input: ChatPromptInput,
  intent: NonHardFallbackIntent
): string[] {
  if (intent === "liquidity_debt" && isBankLike(input.filing)) {
    return ["Balance Sheet", "Debt Note", "Liquidity MD&A", "Cash Flow Statement", "capital", "liquidity", "deposits", "credit quality"];
  }
  switch (intent) {
    case "business_model":
      return ["事業内容", "セグメント情報", "売上内訳", "MD&Aの事業説明"];
    case "segment_driver":
      return ["Segment results", "Geographic revenue", "Product/category revenue", "sector-specific segment KPIs"];
    case "liquidity_debt":
      return ["Balance Sheet", "Debt Note", "Liquidity MD&A", "Cash Flow Statement"];
    case "risk_summary":
      return ["リスク要因セクション", "MD&Aのリスク説明", "業種固有リスクの説明"];
    case "watch_points":
      return ["セグメント別実績", "売上要因の説明", "資金繰りまたはリスクの説明"];
    case "margin_driver":
      return ["cost discussion", "mix", "pricing", "operating expenses", "provision", "restructuring", "impairment", "segment margin"];
    case "prior_filing_delta":
      return ["previous filing evidence", "prior filing MD&A", "prior period XBRL"];
    case "revenue_driver":
      return ["MD&A revenue discussion", "segment results", "revenue discussion", "sector-specific KPIs"];
    case "unknown":
      return ["MD&A", "segment results", "revenue discussion", "業種固有KPI"];
  }
}

function fallbackSourceIds(metricSourceId: string | undefined, sourceChunks: SourceChunkRecord[]): string[] {
  const ids = [
    metricSourceId,
    ...sourceChunks
      .filter((source) => source.sourceId && source.text.trim())
      .map((source) => source.sourceId)
  ].filter((sourceId): sourceId is string => Boolean(sourceId));
  return Array.from(new Set(ids)).slice(0, 2);
}

export function isBankLike(filing: FilingCacheRecord): boolean {
  // This gates the liquidity/funding fallback answer, which talks about deposits
  // and credit quality. The previous version searched ticker + company name +
  // the first 5,000 characters of MD&A for an unbounded
  // /jpm|bank|financial|deposits?|loans?|.../ and so matched almost every filing:
  // "consolidated financial statements" and "financial condition" are boilerplate
  // in every 10-K and 10-Q, and "bank credit facilities" / "term loans" appear in
  // ordinary industrial and consumer filings. Apple and Coca-Cola both came out
  // bank-like, and their funding answers were steered to deposits.
  //
  // Split it: the identity terms have to actually name a bank, and the MD&A terms
  // have to be ones only a bank's MD&A uses.
  const identity = `${filing.ticker} ${filing.companyName}`.toLowerCase();
  if (/\b(?:jpm|bac|wfc|gs|pnc|usb|schw|cof|tfc|jpmorgan|citigroup|bancorp|bank|banking|banc)\b/.test(identity)) {
    return true;
  }

  const mdaText = filing.mdaText.slice(0, 5000).toLowerCase();
  return /\b(?:net interest income|net interest margin|noninterest income|noninterest expense|provision for credit losses|allowance for (?:credit|loan) losses|net charge-offs?|tier 1 capital|common equity tier 1|deposit balances|total deposits|loan portfolio|credit quality)\b/.test(mdaText);
}

function buildMetricFallbackAnswer(
  filing: FilingCacheRecord,
  metric: MetricSnapshot,
  metricSourceId: string,
  narrative: SourceChunkRecord | undefined,
  profile: QuestionProfile
): GeminiChatAnswer {
  if (metric.logicalName === "revenue" && profile.asksRevenue && profile.asksCause) {
    return buildRevenueDriverFallbackAnswer(filing, metric, metricSourceId, narrative);
  }

  const sourceIds = [metricSourceId];
  const parts = [buildMetricObservation(metric)];
  let includedNarrative = false;

  if (metric.logicalName === "revenue" && profile.asksRevenue && !profile.asksCause && !profile.asksDetail) {
    return {
      answer: parts.join(" "),
      sourceIds
    };
  }

  if (narrative) {
    const narrativeContext = buildNarrativeContext(narrative, profile);
    if (!isWeakNarrativeContext(narrativeContext)) {
      sourceIds.push(narrative.sourceId);
      parts.push(narrativeContext);
      includedNarrative = true;
    }
  }

  const nextStep = buildMetricNextStep(profile, includedNarrative);
  if (nextStep) {
    parts.push(nextStep);
  }

  return {
    answer: parts.join(" "),
    sourceIds
  };
}

function buildSegmentDriverFallbackAnswer(
  filing: FilingCacheRecord,
  sourceChunks: SourceChunkRecord[],
  metric: MetricSnapshot | undefined,
  metricSourceId: string | undefined,
  narrative: SourceChunkRecord | undefined
): GeminiChatAnswer | null {
  const segmentNarrative = selectSegmentNarrative(sourceChunks) ?? narrative;
  const sourceIds: string[] = [];
  const parts: string[] = [];

  if (metric?.logicalName === "revenue" && metricSourceId) {
    parts.push(buildMetricObservation(metric));
    sourceIds.push(metricSourceId);
  } else {
    const revenue = filing.metrics.find((entry) => entry.logicalName === "revenue");
    const revenueSourceId = revenue ? findMetricSourceId(sourceChunks, revenue) : undefined;
    if (revenue && revenueSourceId) {
      parts.push(buildMetricObservation(revenue));
      sourceIds.push(revenueSourceId);
    }
  }

  if (segmentNarrative) {
    sourceIds.push(segmentNarrative.sourceId);
    const segmentSignals = summarizeRevenueAdjacentSignals(segmentNarrative.text);
    const directDriver = summarizeRevenueDriverNarrative(segmentNarrative);
    parts.push(
      directDriver ??
        segmentSignals ??
        "セグメント・地域別の強弱は、この抜粋だけでは十分に分解できません。全社売上だけでなく、事業別・地域別売上の表とMD&Aを合わせて見る必要があります。"
    );
  } else {
    parts.push(
      "この context ではセグメント・地域別の強弱を直接示す本文が不足しています。全社売上だけでは、どの部門や地域が伸びたかまでは判断できません。"
    );
  }

  return sourceIds.length > 0
    ? {
        answer: parts.join(" "),
        sourceIds: Array.from(new Set(sourceIds))
      }
    : null;
}

function buildRevenueDriverFallbackAnswer(
  filing: FilingCacheRecord,
  metric: MetricSnapshot,
  metricSourceId: string,
  narrative: SourceChunkRecord | undefined
): GeminiChatAnswer {
  const sourceIds = [metricSourceId];
  const parts = [buildMetricObservation(metric)];
  const driverSentence = narrative ? summarizeRevenueDriverNarrative(narrative) : null;

  if (driverSentence) {
    sourceIds.push(narrative!.sourceId);
    parts.push(driverSentence);
  } else if (narrative && isRevenueAdjacentNarrative(narrative)) {
    sourceIds.push(narrative.sourceId);
    const adjacentSignal = summarizeRevenueAdjacentSignals(narrative.text);
    parts.push(
      adjacentSignal ??
        `本文では、売上区分や地域・セグメントの説明が近い材料です。${sectorRevenueDriverChecklist(filing)}`
    );
  } else if (narrative) {
    sourceIds.push(narrative.sourceId);
    parts.push(
      `選ばれた Item 7 の範囲では、価格・数量・地域・セグメントのどれが主因かまでは薄めです。${sectorRevenueDriverChecklist(filing)}`
    );
  } else {
    parts.push(`ただし、選択された本文だけでは売上変化の直接要因は明示されていません。${sectorRevenueDriverChecklist(filing)}`);
  }

  return {
    answer: parts.join(" "),
    sourceIds: Array.from(new Set(sourceIds))
  };
}

function sectorRevenueDriverChecklist(filing: FilingCacheRecord): string {
  // Content-gated only. This used to carry five identity-gated branches above
  // the text checks (ticker === "AAPL" etc.) that asserted company structure —
  // "iPhone、Services、Mac" — from the ticker alone, whatever the filing said.
  // Same family as the deleted constant-answer tables, in advice clothing. The
  // haystack variants below say the same things when and only when the MD&A
  // actually uses that sector's vocabulary, which is the only gate that keeps
  // the "every statement has a source" claim honest here.
  const haystack = filing.mdaText.slice(0, 8000).toLowerCase();

  if (/net interest income|noninterest income|provision for credit losses|total deposits|loan portfolio|net charge-offs?/.test(haystack)) {
    return "銀行では、net interest income、noninterest income、信用損失引当、預金・貸出残高、投資銀行やマーケット収益を分けて確認する必要があります。";
  }

  if (/exxon|upstream|downstream|chemical|crude oil|natural gas|refining margin/.test(haystack)) {
    return "エネルギーでは、原油・天然ガス価格、upstreamの生産量、refining margin、chemical margin、為替や売却影響を分けて確認する必要があります。";
  }

  if (/caterpillar|construction industries|resource industries|energy and transportation|backlog|dealer inventory/.test(haystack)) {
    return "工業株では、price realization、販売数量、dealer inventory、backlog、Construction/Resource/Energy & Transportation別の強弱を分けて確認する必要があります。";
  }

  if (/walmart|sam'?s club|comparable sales|comp sales|traffic|ticket|membership|ecommerce|e-commerce/.test(haystack)) {
    return "小売では、既存店売上、traffic、ticket、eCommerce、membership/advertising、在庫とgross marginを分けて確認する必要があります。";
  }

  if (/biotech|biopharma|pharmaceutical|drug|therapy|rna|clinical|royalt|collaboration|license/.test(haystack)) {
    return "バイオ医薬では、製品別売上、提携収入、ロイヤリティ、承認済み製品の需要、研究開発や販売体制の変化を分けて確認する必要があります。";
  }

  if (/rocket lab|space|launch|aerospace|satellite/.test(haystack)) {
    return "宇宙・航空関連では、打ち上げサービス、宇宙システム、受注残、ミッション数、顧客需要を分けて確認する必要があります。";
  }

  if (/apple|iphone|mac|ipad|services|wearables|greater china|americas/.test(haystack)) {
    return "Appleのような製品・サービス企業では、iPhone、Services、Mac、地域別売上、為替、製品mixを分けて確認する必要があります。";
  }

  return "次に見るべきなのは、事業別・地域別・製品別の売上説明、価格や数量、顧客需要のどれが増減に効いたかです。";
}


function buildClosestContextFallbackAnswer(
  metric: MetricSnapshot | undefined,
  metricSourceId: string | undefined,
  narrative: SourceChunkRecord | undefined,
  profile: QuestionProfile
): GeminiChatAnswer | null {
  const parts = [profile.asksStockContext ? buildStockContextLeadFromFallback(metric, narrative) : buildClosestContextLead(profile)];
  const sourceIds: string[] = [];

  if (metric && metricSourceId) {
    parts.push(buildMetricObservation(metric));
    sourceIds.push(metricSourceId);
  }

  if (narrative) {
    parts.push(buildNarrativeContext(narrative, profile));
    sourceIds.push(narrative.sourceId);
  }

  parts.push(buildClosestContextLimitation(profile));

  return sourceIds.length > 0
    ? {
        answer: parts.join(" "),
        sourceIds
      }
    : null;
}

function buildInvestmentViewFallbackAnswer(
  filing: FilingCacheRecord,
  sourceChunks: SourceChunkRecord[],
  narrative: SourceChunkRecord | undefined
): GeminiChatAnswer | null {
  const positives: string[] = [];
  const cautions: string[] = [];
  const sourceIds: string[] = [];

  const addMetric = (logicalName: MetricSnapshot["logicalName"], positiveLabel: string, cautionLabel: string) => {
    const metric = filing.metrics.find((entry) => entry.logicalName === logicalName);
    if (!metric) {
      return;
    }
    const sourceId = findMetricSourceId(sourceChunks, metric);
    if (sourceId) {
      sourceIds.push(sourceId);
    }
    const line = buildMetricObservation(metric);
    if ((metric.yoyPercent ?? 0) >= 0) {
      positives.push(`${positiveLabel}: ${line}`);
    } else {
      cautions.push(`${cautionLabel}: ${line}`);
    }
  };

  addMetric("revenue", "売上はプラス材料", "売上は注意材料");
  addMetric("operatingIncome", "営業利益はプラス材料", "営業利益は注意材料");
  addMetric("operatingCashFlow", "営業CFはプラス材料", "営業CFは注意材料");

  if (narrative) {
    sourceIds.push(narrative.sourceId);
    const narrativeText = summarizeNarrativeEvidence(narrative, {
      ...analyzeQuestion("投資家目線で良い点と悪い点は？"),
      asksInvestmentView: true
    });
    if (/risk|uncertain|uncertainty|adverse|リスク|不確実|弱|悪|減|低下|費用|cost|expense/i.test(narrative.text)) {
      cautions.push(narrativeText);
    } else {
      positives.push(narrativeText);
    }
  }

  if (positives.length === 0 && cautions.length === 0) {
    return null;
  }

  const positiveText = positives.length > 0 ? positives.slice(0, 2).join(" ") : "明確なプラス材料はこの抜粋だけでは限定的です。";
  const cautionText = cautions.length > 0 ? cautions.slice(0, 2).join(" ") : "大きな注意材料はこの抜粋だけでは限定的です。";

  return {
    answer: `良い点は、${positiveText} 一方で悪い点・注意点は、${cautionText} なお、この資料だけでは株価評価や将来の市場反応までは断定できません。`,
    sourceIds: Array.from(new Set(sourceIds))
  };
}

function buildNarrativeFallbackAnswer(narrative: SourceChunkRecord, profile: QuestionProfile): GeminiChatAnswer {
  if (profile.asksBusinessOverview) {
    return {
      answer: summarizeBusinessNarrativeEvidence(narrative),
      sourceIds: [narrative.sourceId]
    };
  }

  const limitation = buildNarrativeFallbackLimitation(profile);
  return {
    answer: limitation ? `${summarizeNarrativeEvidence(narrative, profile)} ${limitation}` : summarizeNarrativeEvidence(narrative, profile),
    sourceIds: [narrative.sourceId]
  };
}

function buildDurabilityFallbackAnswer(
  filing: FilingCacheRecord,
  sourceChunks: SourceChunkRecord[],
  profile: QuestionProfile
): GeminiChatAnswer | null {
  const narrative = selectDurabilityNarrative(sourceChunks);
  const metric = selectDurabilityMetric(filing, sourceChunks, profile);
  const metricSourceId = metric ? findMetricSourceId(sourceChunks, metric) : undefined;
  const sourceIds: string[] = [];
  const parts: string[] = [];

  const hasSubscriptionDurabilitySignal = narrative ? hasSubscriptionGrowthSignal(narrative.text) : false;

  if (narrative) {
    sourceIds.push(narrative.sourceId);
    const evidence = summarizeDurabilityEvidence(narrative);
    parts.push(buildDurabilityLead(narrative));
    parts.push(evidence);
    if (isGenericDurabilityEvidence(evidence)) {
      parts.push(
        "前問の要因をこの抜粋から十分に特定できていないため、一時要因か構造変化かも強くは判定しません。次回は同じ要因が売上、利益率、セグメント別実績に続けて出るかを確認するのが妥当です。"
      );
    }
  } else {
    parts.push(buildNoNarrativeDurabilityLead(profile));
  }

  if (metric && metricSourceId) {
    sourceIds.push(metricSourceId);
    parts.push(`${buildMetricObservation(metric)} この数字だけでは継続性は決まりませんが、本文の要因説明と並べると判断しやすくなります。`);
  }

  parts.push(
    hasSubscriptionDurabilitySignal
      ? "したがって、今回の材料は一回限りだけの要因とは見にくいです。顧客維持・追加導入・サブスクリプション拡大が続くかで判断する性質です。"
      : buildDurabilityConclusion(narrative)
  );

  return sourceIds.length > 0
    ? {
        answer: parts.join(" "),
        sourceIds: Array.from(new Set(sourceIds))
      }
    : null;
}

function isGenericDurabilityEvidence(evidence: string): boolean {
  return /この要因に近い説明|この論点に関する説明|本文全体と数字を並べる/.test(evidence);
}

function selectDurabilityMetric(
  filing: FilingCacheRecord,
  sourceChunks: SourceChunkRecord[],
  profile: QuestionProfile
): MetricSnapshot | undefined {
  const haystack = sourceChunks
    .map((chunk) => `${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`)
    .join(" ")
    .toLowerCase();

  if (
    profile.asksProfitability ||
    profile.asksProfit ||
    /profitability context|operating income|net income|gross profit|gross margin|margin|profitability|cost of sales|expense/.test(
      haystack
    )
  ) {
    return (
      filing.metrics.find((metric) => metric.logicalName === "operatingIncome") ??
      filing.metrics.find((metric) => metric.logicalName === "netIncome")
    );
  }

  if (/cash flow|liquidity|operating activities/.test(haystack)) {
    return filing.metrics.find((metric) => metric.logicalName === "operatingCashFlow");
  }

  return selectRelevantMetric(filing, {
    ...profile,
    asksRevenue: profile.asksRevenue || (!profile.asksProfit && !profile.asksProfitability && !profile.asksCashFlow)
  });
}

function buildNoNarrativeDurabilityLead(profile: QuestionProfile): string {
  if (profile.asksRevenue || profile.asksCause) {
    return "本文に売上変化の要因説明がないため、その要因が一時的か継続的かはこの資料だけでは判断できません。";
  }

  return "この決算資料だけでは、その要因が一時的か継続的かは断定できません。";
}

function selectDurabilityNarrative(sourceChunks: SourceChunkRecord[]): SourceChunkRecord | undefined {
  const narratives = sourceChunks.filter(
    (chunk) => chunk.sectionType === "md_a" && chunk.text.trim() && !isLowSignalNarrative(chunk)
  );

  return (
    narratives.find((chunk) =>
      /(one[- ]?time|one[- ]?off|non[- ]recurring|temporary|transitory|continue|continued|ongoing|remain|long[- ]term|sustain|recurring|expect|outlook|forecast|guidance)/i.test(
        chunk.text
      )
    ) ??
    narratives.find((chunk) =>
      /(primarily due to|driven by|helped by|higher net sales|demand|fuel|labor|pricing|cost|margin|capacity|traffic|volume|yield|risk|uncertain|uncertainty|volatility|adverse impact)/i.test(
        chunk.text
      )
    ) ??
    narratives[0]
  );
}

function selectSegmentNarrative(sourceChunks: SourceChunkRecord[]): SourceChunkRecord | undefined {
  const narratives = sourceChunks.filter(
    (chunk) => chunk.sectionType === "md_a" && chunk.text.trim() && !isLowSignalNarrative(chunk)
  );

  return (
    narratives.find((chunk) =>
      /(segment|reportable|geographic|geograph|region|americas|greater china|japan|international|walmart u\.s\.|sam'?s club|construction industries|resource industries|energy & transportation|upstream|energy products|chemical products|specialty products|product|services)/i.test(
        `${chunk.sourceLabel} ${chunk.sectionTitle} ${chunk.text}`
      )
    ) ??
    narratives.find((chunk) => /revenue|sales|net sales/i.test(chunk.text)) ??
    narratives[0]
  );
}

function buildDurabilityLead(narrative: SourceChunkRecord): string {
  const lowered = narrative.text.toLowerCase();

  if (/(one[- ]?time|one[- ]?off|non[- ]recurring|temporary|transitory)/i.test(lowered)) {
    return "一時的な要因として読む材料があります。";
  }

  if (
    /(continue|continued|ongoing|remain|long[- ]term|sustain|recurring|expect|outlook|forecast|guidance|risk|uncertain|uncertainty|volatility|fuel|labor|demand|pricing|cost)/i.test(
      lowered
    )
  ) {
    return "一時的とは断定しにくいです。";
  }

  return "この資料だけでは、一時的か継続的かは断定できません。";
}

function summarizeDurabilityEvidence(source: SourceChunkRecord): string {
  const text = source.text.trim();
  const lowered = text.toLowerCase();

  const pricingDriver = summarizePricingDriver(text);
  if (pricingDriver) {
    return pricingDriver;
  }

  const revenueDriver = summarizeRevenueDriverNarrative(source);
  if (revenueDriver) {
    return revenueDriver;
  }

  const marginDriver = summarizeMarginNarrative(text);
  if (marginDriver) {
    return marginDriver;
  }

  if (/fuel/.test(lowered) && /(price|cost|availability|supply|volatility)/.test(lowered)) {
    return "提出資料では、燃料価格や供給量の変動が業績に大きく影響しうる論点として出ています。";
  }

  const regionalDriver = text.match(/([A-Za-z ]+?)\s+net sales increased[\s\S]*?primarily due to higher net sales of ([^.]+)\./i);
  if (regionalDriver?.[1] && regionalDriver[2]) {
    return `提出資料では、${regionalDriver[1].trim()}の売上増は ${translateDriverList(
      regionalDriver[2]
    )} が主因と説明されています。`;
  }

  const subscriptionGrowth = summarizeSubscriptionDurabilityEvidence(text);
  if (subscriptionGrowth) {
    return subscriptionGrowth;
  }

  if (/revpar|revenue per available room/.test(lowered)) {
    return "提出資料では、RevPAR（販売可能客室あたり売上）をホテル事業の重要指標として扱っています。継続性は稼働率、客室単価、旅行需要が続くかに左右されます。";
  }

  const generalDriver = text.match(/(?:primarily due to|driven by|helped by|powered by)\s+([^.]+)\./i);
  if (generalDriver?.[1]) {
    return `提出資料では、${translateDriverList(generalDriver[1])} が要因として説明されています。`;
  }

  if (/demand/.test(lowered) && /(strong|resilient|healthy|rebound|higher)/.test(lowered)) {
    return "提出資料では、需要の強さや回復が要因として示されています。";
  }

  if (/(risk|uncertain|uncertainty|volatility|adverse impact)/.test(lowered)) {
    return "提出資料では、この論点は業績に影響しうるリスクとして扱われています。";
  }

  return "提出資料の本文に、この要因に近い説明があります。";
}

function buildDurabilityConclusion(narrative: SourceChunkRecord | undefined): string {
  const text = narrative?.text.toLowerCase() ?? "";

  if (/(one[- ]?time|one[- ]?off|non[- ]recurring|temporary|transitory|impairment|restructuring)/.test(text)) {
    return "一回限り・一時費用として明示されている部分は一時性が強い一方、需要、価格、コスト構造が続くなら次期以降も影響します。";
  }

  if (/(price|pricing|net selling price|volume|demand|traffic|ticket|comparable store|same-store|membership|ecommerce|cost|margin|inflation)/.test(text)) {
    return "価格、数量、需要、コスト、mixのような営業要因は一回限りとは言いにくく、次回も同じ方向で出るかを確認する論点です。";
  }

  if (/(commodity|crude|natural gas|refining margin|realization|foreign exchange|currency)/.test(text)) {
    return "資源価格、精製マージン、為替のような外部要因は変動しやすいため、一時か継続かは次期の市況が同じ方向で続くか次第です。";
  }

  return "一回限りの要因として明示されているか、次の期も同じ需要・コスト・リスクが続くかで判断する性質です。";
}

function summarizeSubscriptionDurabilityEvidence(text: string): string | null {
  const lowered = text.toLowerCase();
  if (!/(subscription revenue|annual recurring revenue|\barr\b|recurring revenue|customers?|modules?|platform|falcon)/.test(lowered)) {
    return null;
  }

  if (/(subscription revenue|annual recurring revenue|\barr\b|recurring revenue)/.test(lowered)) {
    return "提出資料では、サブスクリプション型の継続収益や顧客基盤が成長材料として出ています。一回限りだけの要因とは見にくいです。";
  }

  if (/(new customers?|existing customers?|additional modules?|module adoption|platform|falcon)/.test(lowered)) {
    return "提出資料では、新規顧客、既存顧客への追加導入、プラットフォーム利用拡大が材料として出ています。継続性は顧客維持と追加導入が続くかに依存します。";
  }

  return "提出資料では、顧客基盤やプラットフォーム利用が材料として出ています。一時要因だけとは断定しにくいです。";
}

function summarizeBusinessNarrativeEvidence(narrative: SourceChunkRecord, companyName?: string): string {
  const labels: string[] = [];
  const text = narrative.text;
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(text) && !labels.includes(label)) {
      labels.push(label);
    }
  };

  add("がん領域の精密医療", /precision oncology|oncology/i);
  // "screening" / "diagnostic" 単独は腫瘍学の語ではない(半導体・産業機械の提出資料でも
  // 普通に使われる)のに、このラベルは「がん検査」を主張する。近接条件で腫瘍学の語を必須にする。
  // final-answer-language.ts の AWS顧客利用量 と同じ近接イディオム。
  add(
    "がん検査・診断",
    /\b(?:cancer|tumou?rs?)\b[\s\S]{0,200}\b(?:screening|diagnostics?)\b|\b(?:screening|diagnostics?)\b[\s\S]{0,200}\b(?:cancer|tumou?rs?)\b/i
  );
  add("血液検査・分子診断", /blood[- ]based|liquid biopsy|molecular|genomic/i);
  add("製薬会社向けサービス", /biopharmaceutical|pharmaceutical|clinical trial/i);
  add("車両販売・関連サービス", /automotive|vehicle sales|deliveries and servicing/i);
  add("エネルギー生成・蓄電", /energy generation and storage|energy storage/i);
  add("クラウドサービス", /cloud|azure/i);
  add("広告", /advertising|\bads\b/i);
  add("サブスク・サービス", /subscription and services|subscription/i);
  add("AI向けアクセラレーテッドコンピューティング", /accelerated computing|gpu/i);
  add("データセンター向けコンピューティング", /data center|blackwell|gb200|gb300/i);
  add("ネットワーキング", /networking|ethernet|infiniband|nvlink/i);
  add("ゲーミング", /gaming/i);
  add("プロ向け可視化", /professional visualization/i);
  add("自動車向け", /automotive/i);

  if (labels.length > 0) {
    const subject = companyName ? `${companyName}は` : "この会社は";
    return `${subject}、提出資料から見ると、${labels.slice(0, 4).join("、")}を主な事業にする会社です。`;
  }

  return `この会社は、提出資料の本文では「${truncateExcerpt(narrative.text, 120)}」という文脈で説明されています。`;
}

function buildMetricObservation(metric: MetricSnapshot): string {
  const valueText = formatMetricValue(metric.value, metric.unit);

  if (metric.yoyPercent !== undefined) {
    return `${metricLabel(metric.logicalName)}は ${valueText} で、前年同期比 ${formatYoYDelta(metric.yoyPercent)} です。`;
  }

  if (metric.comparisonValue !== undefined) {
    return `${metricLabel(metric.logicalName)}は ${valueText} で、比較値は ${formatMetricValue(metric.comparisonValue, metric.unit)} です。`;
  }

  return `${metricLabel(metric.logicalName)}は ${valueText} です。`;
}

function buildNarrativeContext(narrative: SourceChunkRecord, profile: QuestionProfile): string {
  return summarizeNarrativeEvidence(narrative, profile);
}

function buildMetricNextStep(profile: QuestionProfile, hasNarrative: boolean): string | null {
  if (profile.asksRevenue && (profile.asksCause || profile.asksDetail)) {
    return hasNarrative
      ? "この数字だけを見るより、本文で名前が出ている事業や地域とセットで見る方が自然です。"
      : "数字では売上は伸びていますが、どの事業が押したかまではこの材料だけだと切れません。";
  }

  if (profile.asksProfit && profile.asksCause) {
    return hasNarrative
      ? "利益の動きは、この説明と費用・評価損益・税金の数字を並べると見えてきます。"
      : "利益の悪化幅は見えますが、原因の切り分けには費用や評価損益の説明がもう少し必要です。";
  }

  if (profile.asksRisk || profile.asksTariff) {
    return "ここではまだリスクとしての記載なので、実際に数字へ出たかは次の決算で追う必要があります。";
  }

  if (profile.asksCashFlow && profile.asksCapitalAllocation) {
    return "還元余力を見るなら、営業キャッシュフロー、手元資金、配当・自社株買いの実行額を並べたいところです。";
  }

  if (profile.asksCapitalAllocation) {
    return "方針の強さは、今回の実行額と会社コメントをあわせると見えやすくなります。";
  }

  if (profile.asksCashFlow) {
    return "持続性は、次の期も営業キャッシュフローが同じ方向で出るか次第です。";
  }

  if (profile.asksGuidance || profile.asksForecast) {
    return "見通しの強さは、会社の需要コメントやリスクの言い方がどれだけ前向きかで見たいところです。";
  }

  if (profile.asksProfitability && profile.asksCause) {
    return "利益率の動きは、売上の伸び、コスト、価格、製品構成を順番に見ると整理しやすいです。";
  }

  return null;
}

function buildClosestContextLead(profile: QuestionProfile): string {
  if (profile.asksStockPrice || profile.asksRecommendation) {
    return "買いかどうかはここでは決めず、決算から見える強弱だけ拾います。";
  }

  if (profile.asksMarketReaction) {
    return "株価反応は外部要因も混ざるので、決算側で好感・警戒されそうな材料に絞ります。";
  }

  return "近い材料から見ると、こうです。";
}

function buildClosestContextLimitation(profile: QuestionProfile): string {
  if (profile.asksStockPrice || profile.asksRecommendation) {
    return "実際の判断には、同じ期間の株価推移、決算後ニュース、会社見通しも必要です。";
  }

  if (profile.asksStockContext) {
    return "実際の株価推移や決算後ニュースまで並べると、強弱はもっとはっきりします。";
  }

  if (profile.asksGuidance || profile.asksForecast) {
    return "具体的な見通しや外部予想との比較は、会社コメントや市場予想を追加すると精度が上がります。";
  }

  return "同じ論点の本文や外部データがあると、もう少し絞れます。";
}

function buildNarrativeFallbackLimitation(profile: QuestionProfile): string | null {
  if (
    profile.asksStockPrice ||
    profile.asksRecommendation ||
    profile.asksStockContext ||
    profile.asksMarketReaction
  ) {
    return buildClosestContextLimitation(profile);
  }

  if (profile.asksGuidance || profile.asksForecast) {
    return "数値見通しや市場予想と並べると、強弱はもう少し判断しやすくなります。";
  }

  if (profile.asksRisk || profile.asksTariff) {
    return "実際に業績へ出るかは、次の数字や会社コメントとセットで追うのがよさそうです。";
  }

  if (profile.asksCapitalAllocation) {
    return "還元余力は、手元資金・営業キャッシュフロー・実行額を並べると見やすいです。";
  }

  if (profile.asksRevenue && (profile.asksCause || profile.asksDetail)) {
    return "寄与度の順位までは置かず、本文で名前が出ている要因を伸びの候補として見ます。";
  }

  if (profile.asksProfit && profile.asksCause) {
    return "原因はこの本文説明を軸に、費用・評価損益・税金の数字も合わせて見たいところです。";
  }

  if (profile.asksProfitability && profile.asksCause) {
    return "利益率は、コスト、価格、製品構成のどれが効いたかを順に照らすと整理しやすいです。";
  }

  return null;
}

function buildStockContextLeadFromFallback(
  metric: MetricSnapshot | undefined,
  narrative: SourceChunkRecord | undefined
): string {
  let score = 0;
  const narrativeText = narrative?.text.toLowerCase() ?? "";

  if ((metric?.yoyPercent ?? 0) > 0) {
    score += 1;
  } else if ((metric?.yoyPercent ?? 0) < 0) {
    score -= 1;
  }

  if (/resilient|strong demand|healthy demand|higher net sales|rebound|growth|improv|increase/.test(narrativeText)) {
    score += 1;
  }

  if (/risk|uncertain|uncertainty|macro|slowdown|adverse impact|tariff|pressure|weakness/.test(narrativeText)) {
    score -= 1;
  }

  if (score >= 1) {
    return "今回の決算から見ると、足元はやや強めです。";
  }

  if (score <= -1) {
    return "今回の決算から見ると、足元は慎重寄りです。";
  }

  return "今回の決算から見ると、強弱はまだらです。";
}

function buildTariffNarrativeSentence(source: SourceChunkRecord): string {
  const lowered = source.text.toLowerCase();

  if (/tariff/.test(lowered) && /supply chain/.test(lowered) && /(pricing|margin)/.test(lowered)) {
    return "提出資料では、関税や追加措置がサプライチェーン、値付け、利益率に悪影響を与える可能性があると説明しています。";
  }

  if (/tariff/.test(lowered)) {
    return "提出資料では、関税や追加措置が業績の逆風になる可能性に触れています。";
  }

  return `本文では「${truncateExcerpt(source.text, 150)}」と説明しています。`;
}

function summarizeNarrativeEvidence(source: SourceChunkRecord, profile: QuestionProfile): string {
  const trimmed = source.text.trim();
  if (!trimmed) {
    return "提出資料の本文に、この論点に関する記述があります。";
  }

  if (profile.asksTariff) {
    return buildTariffNarrativeSentence(source);
  }

  const lowered = trimmed.toLowerCase();

  if (
    profile.asksRisk &&
    hasPowerUtilityRiskSignal(lowered)
  ) {
    return "本文では、発電・電力事業、規制、市場価格や需要変動が業績に影響しうるリスクとして扱われています。";
  }

  if (
    /management's discussion|results of operations|our business risks|forward-looking statements|investors are cautioned|available information|investor relations website|corporate website|private securities litigation reform act/.test(
      lowered
    )
  ) {
    return "この提出資料の範囲では、この論点を直接説明する本文は見つかりません。";
  }

  if (/(digital asset|bitcoin)/.test(lowered) && /(fair value|impairment|loss)/.test(lowered)) {
    return "本文では、ビットコインなどデジタル資産の評価損益が利益を大きく動かしたと説明しています。";
  }

  const pricingDriver = summarizePricingDriver(trimmed);
  if (pricingDriver) {
    return pricingDriver;
  }

  const marginDriver = profile.asksProfitability || profile.asksProfit ? summarizeMarginNarrative(trimmed) : null;
  if (marginDriver) {
    return marginDriver;
  }

  if (/(interest expense|debt)/.test(lowered)) {
    return "本文では、支払利息などの金融費用が利益の重荷になった可能性に触れています。";
  }

  if (/(selling, general and administrative|research and development|operating expenses|compensation|expense)/.test(lowered)) {
    return "本文では、販管費や開発費などの費用が利益の重荷になった可能性に触れています。";
  }

  if (/(income tax|tax expense|valuation allowance)/.test(lowered)) {
    return "本文では、税金関連の要因が利益を大きく動かした可能性に触れています。";
  }

  const regionalDrivers = [
    { region: "米州", pattern: /americas[\s\S]*?higher net sales of ([^.]+)\./i },
    { region: "中国", pattern: /greater china[\s\S]*?higher net sales of ([^.]+)\./i },
    { region: "日本", pattern: /japan[\s\S]*?higher net sales of ([^.]+)\./i },
    { region: "アジア太平洋", pattern: /rest of asia pacific[\s\S]*?higher net sales of ([^.]+)\./i }
  ];
  for (const candidate of regionalDrivers) {
    const match = trimmed.match(candidate.pattern);
    if (match?.[1]) {
      return `本文では、${candidate.region}で ${translateDriverList(match[1])} の売上増が主因と説明しています。`;
    }
  }

  if (profile.asksRevenue && (profile.asksCause || profile.asksDetail) && hasSubscriptionGrowthSignal(trimmed)) {
    return summarizeSubscriptionGrowthNarrative(trimmed);
  }

  const generalDriverMatch = trimmed.match(/(?:primarily due to|driven by|helped by|powered by)\s+([^.]+)\./i);
  if (generalDriverMatch?.[1]) {
    return profile.asksProfit && profile.asksCause
      ? `本文では、${translateDriverList(generalDriverMatch[1])} が利益を押し下げた要因と説明しています。`
      : `本文では、${translateDriverList(generalDriverMatch[1])} が主な押し上げ要因と説明しています。`;
  }

  if (/demand remained resilient|strong demand|healthy demand|demand rebound/.test(lowered)) {
    return "本文では、需要は不安定な環境でも底堅く推移したと説明しています。";
  }

  if (/forecast|guidance|outlook|expect/.test(lowered) && /(strong|higher|improv|grow|increase)/.test(lowered)) {
    return "本文では、会社側が先行きの売上や需要に前向きな言及をしています。";
  }

  if (/(margin|pricing|gross margin|profitability)/.test(lowered) && /(cost|pressure|higher|inflation)/.test(lowered)) {
    return "本文では、コスト、価格、商品構成などが利益率に影響した可能性に触れています。";
  }

  if (hasPowerUtilityRiskSignal(lowered)) {
    return "本文では、発電・電力事業、規制、市場価格や需要変動が業績に影響しうるリスクとして扱われています。";
  }

  if (/(risk|uncertain|uncertainty|macro|consumer sentiment|consumer spending|slowdown|adverse impact)/.test(lowered)) {
    return "本文では、景気や需要の不確実性をリスクとして挙げています。";
  }

  if (!containsJapaneseCharacters(trimmed)) {
    return "提出資料の本文に、この論点に関する説明があります。本文全体と数字を並べると、どの要因が強いかを追いやすくなります。";
  }

  const excerpt = truncateExcerpt(trimmed, 140).replace(/^「|」$/g, "");
  return excerpt.match(/[。！？]$/) ? excerpt : `${excerpt}。`;
}

function hasPowerUtilityRiskSignal(text: string): boolean {
  return /(nuclear|generation operations?|power and capacity|electricity demand|commodity|market prices?)/.test(text);
}

function summarizeRevenueDriverNarrative(source: SourceChunkRecord): string | null {
  const text = source.text.trim();
  const lowered = text.toLowerCase();
  if (!text || isProfitOnlyNarrative(source)) {
    return null;
  }

  const regionalDrivers = [
    { region: "米州", pattern: /americas[\s\S]*?(?:net sales|revenue) increased[\s\S]*?primarily due to higher (?:net )?sales of ([^.]+)\./i },
    { region: "中国", pattern: /greater china[\s\S]*?(?:net sales|revenue) increased[\s\S]*?primarily due to higher (?:net )?sales of ([^.]+)\./i },
    { region: "日本", pattern: /japan[\s\S]*?(?:net sales|revenue) increased[\s\S]*?primarily due to higher (?:net )?sales of ([^.]+)\./i },
    { region: "アジア太平洋", pattern: /rest of asia pacific[\s\S]*?(?:net sales|revenue) increased[\s\S]*?primarily due to higher (?:net )?sales of ([^.]+)\./i }
  ];
  for (const candidate of regionalDrivers) {
    const match = text.match(candidate.pattern);
    if (match?.[1]) {
      return `本文では、${candidate.region}の売上増は ${translateDriverList(match[1])} が主因と説明されています。`;
    }
  }

  const pricingDriver = summarizePricingDriver(text);
  if (pricingDriver) {
    return pricingDriver;
  }

  if (hasSubscriptionGrowthSignal(text)) {
    return summarizeSubscriptionGrowthNarrative(text);
  }

  const directPatterns = [
    /(?:net sales|revenue|revenues|sales|sales and revenues|subscription revenue|annual recurring revenue|arr) (?:increased|decreased|grew|declined|were impacted)[^.]{0,260}?(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from|due to)\s+([^.]+)\./i,
    /(?:increase|decrease|growth|decline) (?:was|were)?[^.]{0,120}?(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from|due to)\s+([^.]+)\./i,
    /(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from|due to)\s+([^.]{0,300}?(?:demand|volume|pricing|price realization|traffic|ticket|comparable sales|comparable store|same-store|ecommerce|membership|occupancy|leasing|renewal|new stores?|foreign exchange|currency|customer|customers|sales|revenue|subscription|arr|module|platform|commodity|crude|natural gas|refining margin|realization)[^.]*?)\./i
  ];
  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return `本文では、${translateDriverList(match[1])} が売上変化の要因として説明されています。`;
    }
  }

  if (/(comparable store sales|same-store sales|traffic|ticket)/i.test(text)) {
    return summarizeRevenueAdjacentSignals(text) ?? "本文では、既存店売上、客数、客単価など小売の売上ドライバーに関する説明があります。";
  }

  if (/demand/.test(lowered) && /(strong|resilient|healthy|higher|increase|growth|rebound)/.test(lowered)) {
    return "本文では、需要の強さや回復が売上を支えた可能性のある材料として示されています。";
  }

  return null;
}

function summarizeRevenueAdjacentSignals(text: string): string | null {
  const lowered = text.toLowerCase();
  const signals: string[] = [];

  if (/walmart u\.s\.|walmart international|sam'?s club/.test(lowered)) {
    signals.push("Walmart U.S.・海外・Sam's Club の事業別動向");
  }
  if (/construction industries|resource industries|energy & transportation|financial products/.test(lowered)) {
    signals.push("建機・資源・エネルギー/輸送などの事業別動向");
  }
  if (/upstream|energy products|chemical products|specialty products/.test(lowered)) {
    signals.push("上流、エネルギー製品、化学品などの部門別動向");
  }
  if (/comparable sales|comparable store|same-store/.test(lowered)) {
    signals.push("既存店売上");
  }
  if (/traffic/.test(lowered)) {
    signals.push("来店客数");
  }
  if (/ticket|average ticket/.test(lowered)) {
    signals.push("客単価");
  }
  if (/ecommerce|e-commerce/.test(lowered)) {
    signals.push("eコマース");
  }
  if (/membership/.test(lowered)) {
    signals.push("会員収入・会員基盤");
  }
  if (/sales volume|volume/.test(lowered)) {
    signals.push("販売数量");
  }
  if (/price realization|pricing|net selling price|price increase/.test(lowered)) {
    signals.push("価格");
  }
  if (/crude|natural gas|commodity|realization|refining margin/.test(lowered)) {
    signals.push("資源価格・精製マージン");
  }
  if (/foreign exchange|currency/.test(lowered)) {
    signals.push("為替");
  }
  if (/segment|reportable/.test(lowered)) {
    signals.push("セグメント構成");
  }

  return signals.length > 0
    ? `本文から近い材料としては、${Array.from(new Set(signals)).slice(0, 4).join("、")}が売上変化を見る軸です。`
    : null;
}

function summarizeMarginNarrative(text: string): string | null {
  const lowered = text.toLowerCase();
  const factors: string[] = [];

  if (/gross margin|gross profit/.test(lowered)) {
    factors.push("粗利率・粗利益");
  }
  if (/cost of sales|cost of revenue|costs? of products?|product cost|merchandise cost|input cost|inflation|labor cost|fuel cost/.test(lowered)) {
    factors.push("原価・人件費・燃料費などのコスト");
  }
  if (/operating expense|selling, general and administrative|sg&a|research and development|compensation|advertising|marketing/.test(lowered)) {
    factors.push("販管費・開発費などの営業費用");
  }
  if (/price realization|pricing|net selling price|price increase|markdown|promotion/.test(lowered)) {
    factors.push("価格・値下げ・販促");
  }
  if (/mix|product mix|sales mix|business mix|channel mix/.test(lowered)) {
    factors.push("商品構成・事業構成");
  }
  if (/inventory|shrink/.test(lowered)) {
    factors.push("在庫・ロス");
  }
  if (/impairment|restructuring|one[- ]?time|one[- ]?off|non[- ]recurring/.test(lowered)) {
    factors.push("一時費用・減損・再編費用");
  }
  if (/tax expense|income tax|valuation allowance/.test(lowered)) {
    factors.push("税金関連要因");
  }
  if (/foreign exchange|currency/.test(lowered)) {
    factors.push("為替");
  }

  if (factors.length === 0) {
    return null;
  }

  return `本文では、${Array.from(new Set(factors)).slice(0, 5).join("、")}が利益率や利益の動きを見る材料として出ています。`;
}

function hasSubscriptionGrowthSignal(text: string): boolean {
  return /(subscription revenue|annual recurring revenue|\barr\b|recurring revenue|new customers?|existing customers?|customer adoption|customers adopting|additional modules?|module adoption|platform services?|falcon|endpoint security|cloud security|identity protection|threat intelligence)/i.test(text);
}

function revenueDriverNarrativePattern(): RegExp {
  return /(?:net sales|revenue|revenues|sales|sales and revenues|subscription revenue|annual recurring revenue|\barr\b).{0,260}(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from|due to|demand|volume|pricing|price realization|traffic|ticket|comparable sales|comparable store|same-store|ecommerce|membership|occupancy|leasing|renewal|new stores?|foreign exchange|currency|commodity|crude|natural gas|refining margin|realization|customers?|modules?|platform|subscription)|(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from|due to).{0,260}(?:net sales|revenue|revenues|sales|sales and revenues|subscription revenue|annual recurring revenue|\barr\b|demand|volume|pricing|price realization|traffic|ticket|comparable sales|comparable store|same-store|ecommerce|membership|occupancy|leasing|renewal|new stores?|foreign exchange|currency|commodity|crude|natural gas|refining margin|realization|customers?|modules?|platform|subscription)/i;
}

function summarizeSubscriptionGrowthNarrative(text: string): string {
  const lowered = text.toLowerCase();
  const drivers: string[] = [];

  if (/new customers?|new subscriptions?|new logos?/.test(lowered)) {
    drivers.push("新規顧客・新規契約の増加");
  }
  if (/existing customers?|customer adoption|customers adopting|expansion|upsell|cross-sell|additional modules?|module adoption|more modules/.test(lowered)) {
    drivers.push("既存顧客への追加導入・利用拡大");
  }
  if (/subscription revenue|annual recurring revenue|\barr\b|recurring revenue/.test(lowered)) {
    drivers.push("サブスクリプション型の継続収益");
  }
  if (/falcon|cloud security|identity protection|endpoint security|threat intelligence/.test(lowered)) {
    drivers.push("Falcon platform 周辺サービスの拡大");
  } else if (/platform/.test(lowered)) {
    drivers.push("プラットフォーム利用の拡大");
  }

  if (drivers.length === 0) {
    return "本文では、サブスクリプションや顧客基盤に関する説明が売上成長の材料として確認できます。";
  }

  return `本文では、${Array.from(new Set(drivers)).slice(0, 3).join("、")}が売上成長の材料として確認できます。`;
}

function summarizePricingDriver(text: string): string | null {
  const match = text.match(/net selling price increases? of\s+([0-9]+(?:\.[0-9]+)?%?)/i);
  if (!match?.[1]) {
    return null;
  }

  const offsetText = summarizeOffsetDrivers(text);
  const lead = `本文では、販売価格の引き上げ（${formatPercentText(match[1])}）が売上成長の主因と説明されています。`;

  return offsetText ? `${lead} ただし、${offsetText}が一部相殺しました。` : lead;
}

function summarizeOffsetDrivers(text: string): string | null {
  if (!/partially offset by/i.test(text)) {
    return null;
  }

  const offsets: string[] = [];
  const volumeMatch =
    text.match(/(?:organic\s+)?volume declines? of\s+([0-9]+(?:\.[0-9]+)?%?)/i) ??
    text.match(/lower (?:organic\s+)?volume(?: of)?\s+([0-9]+(?:\.[0-9]+)?%?)/i);
  if (volumeMatch?.[1]) {
    offsets.push(`販売数量の減少（${formatPercentText(volumeMatch[1])}）`);
  } else if (/lower organic volume|organic volume decline|volume decline/i.test(text)) {
    offsets.push("販売数量の減少");
  }

  const fxMatch =
    text.match(/negative foreign exchange(?: impact)? of\s+([0-9]+(?:\.[0-9]+)?%?)/i) ??
    text.match(/foreign exchange(?: impact)?(?: of)?\s+([0-9]+(?:\.[0-9]+)?%?)/i);
  if (fxMatch?.[1]) {
    offsets.push(`為替のマイナス影響（${formatPercentText(fxMatch[1])}）`);
  } else if (/negative foreign exchange|foreign exchange headwind|currency headwind/i.test(text)) {
    offsets.push("為替のマイナス影響");
  }

  return offsets.length > 0 ? offsets.join("と") : null;
}

function formatPercentText(rawValue: string): string {
  const trimmed = rawValue.trim();
  return trimmed.endsWith("%") ? trimmed : `${trimmed}%`;
}

function isRevenueAdjacentNarrative(source: SourceChunkRecord): boolean {
  return /(revenue|net sales|sales|segment|region|geograph|customer|demand|volume|pricing|traffic|ticket|store|occupancy|leasing)/i.test(
    source.text
  ) && !isProfitOnlyNarrative(source);
}

function isProfitOnlyNarrative(source: SourceChunkRecord): boolean {
  const text = source.text.toLowerCase();
  const profitSignals = /interest expense|debt|income tax|tax expense|valuation allowance|net income|net loss|operating income|selling, general and administrative|research and development|operating expenses|fair value|impairment/.test(
    text
  );
  const revenueSignals = /(revenue|net sales|sales|demand|volume|pricing|traffic|ticket|store|occupancy|leasing|customer)/.test(text);
  return profitSignals && !revenueSignals;
}

function selectFallbackAnchorSource(sourceChunks: SourceChunkRecord[]): SourceChunkRecord | undefined {
  const substantiveNarrative = sourceChunks.find(
    (chunk) => chunk.sectionType === "md_a" && chunk.text.trim() && !isLowSignalNarrative(chunk)
  );
  if (substantiveNarrative) {
    return substantiveNarrative;
  }

  const metricSource = sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.text.trim());
  if (metricSource) {
    return metricSource;
  }

  return sourceChunks.find((chunk) => chunk.text.trim());
}

function translateDriverList(raw: string): string {
  return raw
    .replace(/increases? at all of our reportable segments?/gi, "全報告セグメントでの増収")
    .replace(/increases? across all of our reportable segments?/gi, "全報告セグメントでの増収")
    .replace(/higher revenue across all reportable segments?/gi, "全報告セグメントでの増収")
    .replace(/all of our reportable segments?/gi, "全報告セグメント")
    .replace(/reportable segments?/gi, "報告セグメント")
    .replace(/this digital transformation which is contributing to the explosive growth of data/gi, "データ量の急増を伴うデジタル化")
    .replace(/rapid growth of cloud adoption/gi, "クラウド利用の急拡大")
    .replace(/greater demand for IT outsourcing/gi, "ITアウトソーシング需要の拡大")
    .replace(/the strength of our vehicle portfolio/gi, "車種構成の強さ")
    .replace(/including high margin full-size pickup trucks?/gi, "高採算の大型ピックアップトラック")
    .replace(/\bSUVs\b/g, "SUV")
    .replace(/strong consumer demand for our products/gi, "製品への強い消費者需要")
    .replace(/the execution of our core business strategy/gi, "中核事業戦略の実行")
    .replace(/revenue growth across a majority of product groups and geographies/gi, "大半の製品グループと地域での増収")
    .replace(/revenue growth across a majority of product groups/gi, "大半の製品グループでの増収")
    .replace(/geographies/gi, "地域")
    .replace(/Ansys'? contribution of \$?([0-9,.]+)/gi, (_, value: string) => `Ansys買収による約${value}百万ドルの寄与`)
    .replace(/Ansys'? contribution/gi, "Ansys買収による寄与")
    .replace(/comparable store sales growth/gi, "既存店売上の伸び")
    .replace(/comparable sales growth/gi, "既存店売上の伸び")
    .replace(/higher comparable sales/gi, "既存店売上の増加")
    .replace(/comparable sales/gi, "既存店売上")
    .replace(/same-store sales growth/gi, "既存店売上の伸び")
    .replace(/new store openings?/gi, "新規出店")
    .replace(/e-?commerce sales/gi, "eコマース売上")
    .replace(/membership income/gi, "会員収入")
    .replace(/stronger customer traffic/gi, "来店客数の増加")
    .replace(/higher customer traffic/gi, "来店客数の増加")
    .replace(/higher average ticket/gi, "客単価の上昇")
    .replace(/favorable price realization/gi, "価格実現の改善")
    .replace(/price realization/gi, "価格実現")
    .replace(/higher sales volume/gi, "販売数量の増加")
    .replace(/sales volume/gi, "販売数量")
    .replace(/lower crude oil and natural gas realizations/gi, "原油・天然ガス価格の下落")
    .replace(/lower crude oil realizations/gi, "原油価格の下落")
    .replace(/lower natural gas realizations/gi, "天然ガス価格の下落")
    .replace(/crude oil/gi, "原油")
    .replace(/natural gas/gi, "天然ガス")
    .replace(/refining margins?/gi, "精製マージン")
    .replace(/commodity prices?/gi, "商品市況")
    .replace(/realizations?/gi, "実現価格")
    .replace(/sales and revenues/gi, "売上・収益")
    .replace(/(?:organic\s+)?volume declines? of\s+([0-9]+(?:\.[0-9]+)?%?)/gi, (_, value: string) => `販売数量の減少（${formatPercentText(value)}）`)
    .replace(/customer traffic/gi, "来店客数")
    .replace(/average ticket/gi, "客単価")
    .replace(/negative foreign exchange(?: impact)? of\s+([0-9]+(?:\.[0-9]+)?%?)/gi, (_, value: string) => `為替のマイナス影響（${formatPercentText(value)}）`)
    .replace(/negative foreign exchange/gi, "為替のマイナス影響")
    .replace(/foreign exchange|currency/gi, "為替")
    .replace(/lower organic volume/gi, "オーガニック販売数量の減少")
    .replace(/a decrease in organic volume/gi, "オーガニック販売数量の減少")
    .replace(/organic volume/gi, "オーガニック販売数量")
    .replace(/\bvolume\b/gi, "販売数量")
    .replace(/\bpricing\b/gi, "価格")
    .replace(/\bdemand\b/gi, "需要")
    .replace(/\bleasing\b/gi, "リース")
    .replace(/\boccupancy\b/gi, "稼働率")
    .replace(/\brenewal\b/gi, "契約更新")
    .replace(/\bServices\b/g, "サービス")
    .replace(/\bService\b/g, "サービス")
    .replace(/\biPhone\b/g, "iPhone")
    .replace(/\bMac\b/g, "Mac")
    .replace(/\biPad\b/g, "iPad")
    .replace(/\bWearables,\s*Home and Accessories\b/g, "ウェアラブル・ホーム関連")
    .replace(/\band\b/gi, "と")
    .replace(/\bincluding\b/gi, "、")
    .replace(/,\s*/g, "、")
    .replace(/\s+/g, " ")
    .replace(/\s+と\s+/g, "と")
    .replace(/、\s*と\s*/g, "と")
    .replace(/、{2,}/g, "、")
    .trim();
}

function isWeakNarrativeContext(context: string): boolean {
  return /直接説明する本文は見つかりません|一般的な注意書き|案内文|材料としては弱め/.test(context);
}

function fallbackSourceChunks(input: ChatPromptInput): SourceChunkRecord[] {
  if (!input.contextPack) {
    return input.filing.sourceChunks;
  }

  const seen = new Set<string>();
  const merged: SourceChunkRecord[] = [];
  for (const source of [...input.contextPack.sourceChunks, ...input.filing.sourceChunks]) {
    if (seen.has(source.sourceId)) {
      continue;
    }
    seen.add(source.sourceId);
    merged.push(source);
  }
  return merged;
}

function findMetricSourceId(sourceChunks: SourceChunkRecord[], metric: MetricSnapshot): string | undefined {
  const exact = sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed)?.sourceId;
  if (exact) {
    return exact;
  }

  const label = metricLabel(metric.logicalName);
  return sourceChunks.find((chunk) => {
    if (chunk.sectionType !== "xbrl_metric") {
      return false;
    }

    const haystack = `${chunk.sectionTitle ?? ""} ${chunk.sourceLabel ?? ""} ${chunk.text ?? ""}`.toLowerCase();
    if (metric.logicalName === "revenue") {
      return /売上高|収益|revenue|revenues|net sales|sales/.test(haystack);
    }
    if (metric.logicalName === "netIncome") {
      return /純利益|net income|net loss|netincomeloss/.test(haystack);
    }
    if (metric.logicalName === "operatingIncome") {
      return /営業利益|operating income|operatingincomeloss/.test(haystack);
    }
    if (metric.logicalName === "operatingCashFlow") {
      return /営業cf|営業キャッシュフロー|operating cash flow|net cash provided/.test(haystack);
    }

    return haystack.includes(label.toLowerCase());
  })?.sourceId;
}

function isLowSignalNarrative(chunk: SourceChunkRecord): boolean {
  const text = chunk.text;
  const normalized = text.replace(/\s+/g, " ").trim();
  const normalizedLower = normalized.toLowerCase();
  if (
    normalized.length < 140 &&
    /management.?s discussion and analysis|results of operations|financial condition/i.test(normalizedLower)
  ) {
    return true;
  }

  const hasBusinessSignal = /accelerated computing|gpu|data center|compute|networking|graphics|gaming|professional visualization|automotive|customers?|cloud service providers?|enterprise|revenue from/i.test(
    normalized
  );
  const hasTableNoise = /table of contents|following table sets forth|expressed as a percentage of revenue/i.test(
    normalized
  );
  if (hasTableNoise && hasBusinessSignal && normalized.length >= 500) {
    return false;
  }

  return /available information|available free of charge|forward-looking statements|private securities litigation reform act|investor relations website|corporate website|sec.?s website|securities and exchange commission|investor\.nvidia\.com|table of contents|following table sets forth|expressed as a percentage of revenue|should be read in conjunction|financial reporting standards?|new pronouncements|accounting policies/i.test(
    normalized
  );
}

function truncateExcerpt(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trimEnd()}...`;
}

function containsJapaneseCharacters(text: string): boolean {
  return /[ぁ-んァ-ヶ一-龠]/.test(text);
}

function isUnavailableOnlyAnswer(answer: string): boolean {
  const compact = answer
    .replace(/\s+/g, "")
    .replace(/[。.!！?？]+$/g, "")
    .toLowerCase();

  if (
    compact === "この決算資料の範囲では確認できません" ||
    compact === "このfilingの提供コンテキストでは確認できません"
  ) {
    return true;
  }

  const hasUnavailablePhrase =
    /(確認できません|分かりません|わかりません|cannotconfirm|notenoughcontext)/.test(compact);
  const hasFactSignal = /(売上高|営業利益|純利益|営業キャッシュフロー|前年同期比|比較値|本文では|提出資料では|\d|%)/.test(
    compact
  );

  return hasUnavailablePhrase && !hasFactSignal && compact.length <= 90;
}
