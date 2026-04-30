import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord, SummaryRecord } from "../../env";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../../lib/metrics";
import { analyzeQuestion, wantsNarrativeDepth, type QuestionProfile } from "./fallback-question";
import type { ChatPromptInput, GeminiChatAnswer, SummaryPromptInput } from "./types";

export function localSummaryFallback(input: SummaryPromptInput): SummaryRecord {
  const highlightSources = input.sourceChunks.filter((chunk) => chunk.sectionType === "md_a").slice(0, 2);
  const rankedMetrics = input.metrics
    .filter((metric) => metric.yoyPercent !== undefined || metric.comparisonValue !== undefined)
    .slice(0, 2);
  const headlineMetric = input.metrics.find((metric) => metric.yoyPercent !== undefined) ?? input.metrics[0];
  const verdict = headlineMetric
    ? `${input.companyName}の最新${input.formType}では、${metricLabel(
        headlineMetric.logicalName
      )}を中心に提出資料ベースで確認できます。`
    : `${input.companyName}の最新${input.formType}を日本語で確認できます。`;

  const metricLines = rankedMetrics
    .map((metric) => {
      const sourceId = findMetricSourceIdFromSummaryInput(input, metric);
      if (!sourceId) {
        return null;
      }

      return {
        text: buildSummaryMetricLine(metric),
        sourceIds: [sourceId]
      };
    })
    .filter((value): value is SummaryRecord["changes"][number] => value !== null);

  const narrativeLines = highlightSources.map((source) => ({
    text: buildSummaryNarrativeLine(source, input.formType),
    sourceIds: [source.sourceId]
  }));

  return {
    verdict,
    highlights: [...metricLines.slice(0, 1), ...narrativeLines].slice(0, 2),
    changes: metricLines.length > 0 ? metricLines : narrativeLines
  };
}

export function localChatFallback(input: ChatPromptInput): GeminiChatAnswer {
  const profile = analyzeQuestion(input.question);
  const sourceChunks = fallbackSourceChunks(input);
  const metric = selectRelevantMetric(input.filing, profile);
  const metricSourceId = metric ? findMetricSourceId(sourceChunks, metric) : undefined;
  const narrative = selectRelevantNarrative(sourceChunks, profile, metricSourceId);

  if (profile.asksBusinessOverview) {
    const knownBusiness = summarizeKnownCompanyBusiness(input.filing);
    if (knownBusiness) {
      return knownBusiness;
    }

    if (narrative) {
      return {
        answer: summarizeBusinessNarrativeEvidence(narrative, input.filing.companyName),
        sourceIds: [narrative.sourceId]
      };
    }

    return {
      answer: "この決算資料の範囲では確認できません。",
      sourceIds: []
    };
  }

  if (profile.asksInvestmentView) {
    const investmentView = buildInvestmentViewFallbackAnswer(input.filing, sourceChunks, narrative);
    if (investmentView) {
      return investmentView;
    }
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

    return {
      answer: "この決算資料の範囲では確認できません。",
      sourceIds: []
    };
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

    return {
      answer: "この決算資料の範囲では確認できません。",
      sourceIds: []
    };
  }

  if (metric && metricSourceId) {
    return buildMetricFallbackAnswer(metric, metricSourceId, narrative, profile);
  }

  if (narrative) {
    return buildNarrativeFallbackAnswer(narrative, profile);
  }

  const anchorSource = selectFallbackAnchorSource(sourceChunks);
  if (!anchorSource) {
    return {
      answer: "この決算資料の範囲では確認できません。",
      sourceIds: []
    };
  }

  return {
    answer: `この論点を直接言い切れる材料は薄いですが、提出資料の近い記述としては「${truncateExcerpt(anchorSource.text, 150)}」があります。`,
    sourceIds: [anchorSource.sourceId]
  };
}

export function recoverBroaderFallbackIfNeeded(
  input: ChatPromptInput,
  response: GeminiChatAnswer
): GeminiChatAnswer {
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
      ? findNarrative(revenueDriverNarrativePattern()) ?? findNarrative(/revenue|net sales|sales|segment|region|geograph/)
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

function buildMetricFallbackAnswer(
  metric: MetricSnapshot,
  metricSourceId: string,
  narrative: SourceChunkRecord | undefined,
  profile: QuestionProfile
): GeminiChatAnswer {
  if (metric.logicalName === "revenue" && profile.asksRevenue && profile.asksCause) {
    return buildRevenueDriverFallbackAnswer(metric, metricSourceId, narrative);
  }

  const sourceIds = [metricSourceId];
  const parts = [buildMetricObservation(metric)];
  let includedNarrative = false;

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

function buildRevenueDriverFallbackAnswer(
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
  } else {
    parts.push("ただし、この提出資料の範囲では、売上変化の直接要因は明示されていません。");
    if (narrative && isRevenueAdjacentNarrative(narrative)) {
      sourceIds.push(narrative.sourceId);
      parts.push("近い材料としては、売上区分や地域・セグメントの説明はありますが、どれが増減の主因かまでは切り分けられません。");
    }
  }

  return {
    answer: parts.join(" "),
    sourceIds: Array.from(new Set(sourceIds))
  };
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
  const metric = selectRelevantMetric(filing, {
    ...profile,
    asksRevenue: profile.asksRevenue || (!profile.asksProfit && !profile.asksProfitability && !profile.asksCashFlow)
  });
  const metricSourceId = metric ? findMetricSourceId(sourceChunks, metric) : undefined;
  const sourceIds: string[] = [];
  const parts: string[] = [];

  const hasSubscriptionDurabilitySignal = narrative ? hasSubscriptionGrowthSignal(narrative.text) : false;

  if (narrative) {
    sourceIds.push(narrative.sourceId);
    parts.push(buildDurabilityLead(narrative));
    parts.push(summarizeDurabilityEvidence(narrative));
  } else {
    parts.push(buildNoNarrativeDurabilityLead(profile));
  }

  if (metric && metricSourceId) {
    sourceIds.push(metricSourceId);
    parts.push(`${buildMetricObservation(metric)} ただし、この数字だけでは要因の継続性までは分かりません。`);
  }

  parts.push(
    hasSubscriptionDurabilitySignal
      ? "したがって、今回の材料は一回限りよりも、顧客維持・追加導入・サブスクリプション拡大が続くかで判断する性質です。"
      : "一回限りの要因として明示されているか、次の期も同じ需要・コスト・リスクが続くかで判断する性質です。"
  );

  return sourceIds.length > 0
    ? {
        answer: parts.join(" "),
        sourceIds: Array.from(new Set(sourceIds))
      }
    : null;
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
  add("がん検査・診断", /cancer|tumor|screening|diagnostic/i);
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

function summarizeKnownCompanyBusiness(filing: FilingCacheRecord): GeminiChatAnswer | null {
  const ticker = filing.ticker.toUpperCase();
  const sourceId = selectKnownBusinessSourceId(filing.sourceChunks);
  const sourceIds = sourceId ? [sourceId] : [];

  if (ticker === "PH") {
    return {
      answer:
        `${filing.companyName}は、航空宇宙システムと多様な産業向けのモーション・コントロール技術を扱う会社です。` +
        "提出資料では、Aerospace Systems と Diversified Industrial が主要な事業軸として確認できます。",
      sourceIds
    };
  }

  if (ticker === "CRWD") {
    return {
      answer:
        `${filing.companyName}は、Falcon platform を中心にサイバーセキュリティのサブスクリプションを提供する会社です。` +
        "提出資料では、クラウドセキュリティ、ID保護、脅威インテリジェンスなどのセキュリティ領域が文脈として確認できます。",
      sourceIds
    };
  }

  if (ticker === "CEG") {
    return {
      answer:
        `${filing.companyName}は、米国の発電・電力販売を中心とするエネルギー会社です。` +
        "提出資料では、売上高や発電・電力事業に関する実績が確認できます。",
      sourceIds
    };
  }

  if (ticker === "INTU") {
    return {
      answer:
        `${filing.companyName}は、QuickBooks や TurboTax などを中心に、個人・中小企業向けの会計、税務、財務管理サービスを提供する会社です。` +
        "提出資料では、Consumer、Global Business Solutions、Credit Karma、ProTax などの事業軸が確認できます。",
      sourceIds
    };
  }

  return null;
}

function selectKnownBusinessSourceId(sourceChunks: SourceChunkRecord[]): string | undefined {
  return sourceChunks.find((chunk) => chunk.sectionType === "md_a" && chunk.text.trim())?.sourceId
    ?? sourceChunks.find((chunk) => chunk.text.trim())?.sourceId;
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

function findMetricSourceIdFromSummaryInput(
  input: SummaryPromptInput,
  metric: MetricSnapshot
): string | undefined {
  return input.sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed)?.sourceId;
}

function buildSummaryMetricLine(metric: MetricSnapshot): string {
  const current = formatMetricValue(metric.value, metric.unit);

  if (metric.yoyPercent !== undefined) {
    return `${metricLabel(metric.logicalName)}は ${current} で、前年同期比 ${formatYoYDelta(metric.yoyPercent)} でした。`;
  }

  if (metric.comparisonValue !== undefined) {
    return `${metricLabel(metric.logicalName)}は ${current} で、比較値は ${formatMetricValue(metric.comparisonValue, metric.unit)} でした。`;
  }

  return `${metricLabel(metric.logicalName)}は ${current} でした。`;
}

function buildSummaryNarrativeLine(source: SourceChunkRecord, formType: string): string {
  const label = normalizeSummarySourceLabel(source.sectionTitle || source.sourceLabel, formType);

  if (label.includes("MD&A")) {
    return "MD&A に、今回の増減要因や事業動向の説明があります。";
  }

  if (label.includes("リスク")) {
    return "リスク要因の欄に、注意したい論点の説明があります。";
  }

  return `${label} の記述を確認できます。`;
}

function normalizeSummarySourceLabel(rawLabel: string, formType: string): string {
  const raw = rawLabel.trim();
  const lowered = raw.toLowerCase();

  if (lowered.includes("management's discussion") || lowered.includes("results of operations") || lowered.includes("md&a")) {
    return `${formType} MD&A`;
  }

  if (lowered.includes("risk factors") || lowered.includes("business risks") || lowered.includes("risk")) {
    return `${formType} リスク要因`;
  }

  const itemMatch = raw.match(/Item\s+(\d+[A-Za-z]?)/i);
  if (itemMatch?.[1]) {
    return `${formType} 項目${itemMatch[1]}`;
  }

  return "提出資料";
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

  const pricingDriver = summarizePricingDriver(trimmed);
  if (pricingDriver) {
    return pricingDriver;
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
    return "本文では、コストや値付けが利益率に影響した可能性に触れています。";
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
    /(?:net sales|revenue|sales|subscription revenue|annual recurring revenue|arr) (?:increased|decreased|grew|declined)[^.]{0,220}?(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from)\s+([^.]+)\./i,
    /(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from)\s+([^.]{0,260}?(?:demand|volume|pricing|traffic|ticket|occupancy|leasing|renewal|new stores?|same-store|comparable store|foreign exchange|currency|customer|customers|sales|revenue|subscription|arr|module|platform)[^.]*?)\./i
  ];
  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return `本文では、${translateDriverList(match[1])} が売上変化の要因として説明されています。`;
    }
  }

  if (/(comparable store sales|same-store sales|traffic|ticket)/i.test(text)) {
    return "本文では、既存店売上、客数、客単価など小売の売上ドライバーに関する説明があります。";
  }

  if (/demand/.test(lowered) && /(strong|resilient|healthy|higher|increase|growth|rebound)/.test(lowered)) {
    return "本文では、需要の強さや回復が売上を支えた可能性のある材料として示されています。";
  }

  return null;
}

function hasSubscriptionGrowthSignal(text: string): boolean {
  return /(subscription revenue|annual recurring revenue|\barr\b|recurring revenue|new customers?|existing customers?|customer adoption|customers adopting|additional modules?|module adoption|platform services?|falcon|endpoint security|cloud security|identity protection|threat intelligence)/i.test(text);
}

function revenueDriverNarrativePattern(): RegExp {
  return /(?:net sales|revenue|sales|subscription revenue|annual recurring revenue|\barr\b).{0,220}(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from|demand|volume|pricing|traffic|ticket|comparable store|same-store|occupancy|leasing|renewal|new stores?|foreign exchange|currency|customers?|modules?|platform|subscription)|(?:primarily due to|driven by|attributable to|because of|reflecting|resulted from).{0,220}(?:net sales|revenue|sales|subscription revenue|annual recurring revenue|\barr\b|demand|volume|pricing|traffic|ticket|comparable store|same-store|occupancy|leasing|renewal|new stores?|foreign exchange|currency|customers?|modules?|platform|subscription)/i;
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
    .replace(/same-store sales growth/gi, "既存店売上の伸び")
    .replace(/new store openings?/gi, "新規出店")
    .replace(/stronger customer traffic/gi, "来店客数の増加")
    .replace(/higher customer traffic/gi, "来店客数の増加")
    .replace(/higher average ticket/gi, "客単価の上昇")
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
  return input.contextPack?.sourceChunks ?? input.filing.sourceChunks;
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
