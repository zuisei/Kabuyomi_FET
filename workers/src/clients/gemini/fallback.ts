import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord, SummaryRecord } from "../../env";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../../lib/metrics";
import type { ChatPromptInput, GeminiChatAnswer, SummaryPromptInput } from "./types";

type QuestionProfile = {
  normalized: string;
  asksCause: boolean;
  asksDetail: boolean;
  asksGuidance: boolean;
  asksMarketReaction: boolean;
  asksCapitalAllocation: boolean;
  asksRevenue: boolean;
  asksProfitability: boolean;
  asksProfit: boolean;
  asksCashFlow: boolean;
  asksRisk: boolean;
  asksTariff: boolean;
  asksRegion: boolean;
  asksProductMix: boolean;
  asksStockPrice: boolean;
  asksRecommendation: boolean;
  asksForecast: boolean;
};

export function localSummaryFallback(input: SummaryPromptInput): SummaryRecord {
  const highlightSources = input.sourceChunks.filter((chunk) => chunk.sectionType === "md_a").slice(0, 2);
  const changeSources = input.sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric").slice(0, 2);
  const headlineMetric = input.metrics.find((metric) => metric.yoyPercent !== undefined) ?? input.metrics[0];
  const verdict = headlineMetric
    ? `${input.companyName}の最新${input.formType}では、${metricLabel(
        headlineMetric.logicalName
      )}を中心に提出資料ベースで確認できます。`
    : `${input.companyName}の最新${input.formType}を日本語で確認できます。`;

  return {
    verdict,
    highlights: highlightSources.map((source) => ({
      text: source.text.slice(0, 120).trim(),
      sourceIds: [source.sourceId]
    })),
    changes: changeSources.map((source) => ({
      text: source.text.slice(0, 120).trim(),
      sourceIds: [source.sourceId]
    }))
  };
}

export function localChatFallback(input: ChatPromptInput): GeminiChatAnswer {
  const profile = analyzeQuestion(input.question);
  const metric = selectRelevantMetric(input.filing, profile);
  const metricSourceId = metric ? findMetricSourceId(input.filing, metric) : undefined;
  const narrative = selectRelevantNarrative(input.filing, profile, metricSourceId);

  if (profile.asksStockPrice || profile.asksRecommendation || profile.asksMarketReaction) {
    const closest = buildClosestContextFallbackAnswer(metric, metricSourceId, narrative, profile);
    if (closest) {
      return closest;
    }
  }

  if (metric && metricSourceId) {
    return buildMetricFallbackAnswer(metric, metricSourceId, narrative, profile);
  }

  if (narrative) {
    return buildNarrativeFallbackAnswer(narrative, profile);
  }

  const firstSource = input.filing.sourceChunks[0];
  if (!firstSource) {
    return {
      answer: "この filing の提供コンテキストでは確認できません。",
      sourceIds: []
    };
  }

  return {
    answer: `提出資料では「${truncateExcerpt(firstSource.text, 150)}」と触れています。少なくとも、この論点に関係する記述はここです。`,
    sourceIds: [firstSource.sourceId]
  };
}

export function recoverBroaderFallbackIfNeeded(
  input: ChatPromptInput,
  response: GeminiChatAnswer
): GeminiChatAnswer {
  if (response.answer === "この filing の提供コンテキストでは確認できません。" && response.sourceIds.length === 0) {
    return localChatFallback(input);
  }

  const profile = analyzeQuestion(input.question);
  const narratives = response.sourceIds
    .map((sourceId) => input.filing.sourceChunks.find((chunk) => chunk.sourceId == sourceId && chunk.sectionType === "md_a"))
    .filter((chunk): chunk is SourceChunkRecord => Boolean(chunk));

  if (narratives.length > 0 && narratives.every(isLowSignalNarrative) && wantsNarrativeDepth(profile)) {
    return localChatFallback(input);
  }

  return response;
}

function analyzeQuestion(question: string): QuestionProfile {
  const normalized = question.replace(/\s+/g, "").toLowerCase();

  return {
    normalized,
    asksCause: /(主因|要因|理由|なぜ|背景|支え|押し上げ|牽引|どの変化|何が|driver|cause|why)/.test(normalized),
    asksDetail: /(詳しく|詳細|deep|detail|breakdown|かみ砕)/.test(normalized),
    asksGuidance: /(guidance|outlook|見通し|来期|次四半期)/.test(normalized),
    asksMarketReaction: /(市場|反応|上げ|下げ|好感|嫌気|marketreaction)/.test(normalized),
    asksCapitalAllocation: /(還元|自社株買い|buyback|repurchase|配当|dividend|capitalallocation|株主還元)/.test(
      normalized
    ),
    asksRevenue: /(売上|revenue|sales|growth|増収)/.test(normalized),
    asksProfitability: /(利益率|マージン|粗利|採算|margin|profitability)/.test(normalized),
    asksProfit: /(利益|profit|income|earnings|eps)/.test(normalized),
    asksCashFlow: /(キャッシュフロー|cashflow|cash flow|現金|創出|お金.*稼|稼げてる)/.test(normalized),
    asksRisk: /(リスク|懸念|逆風|不確実|不透明|risk|uncertain|uncertainty|macro)/.test(normalized),
    asksTariff: /(関税|tariff)/.test(normalized),
    asksRegion: /(地域|中国|japan|americas|asia|segment|地域別)/.test(normalized),
    asksProductMix: /(iphone|services|cloud|広告|ads|product mix|サービス|クラウド)/.test(normalized),
    asksStockPrice: /(株価|shareprice|stockprice)/.test(normalized),
    asksRecommendation: /(買いか|売りか|おすすめ|投資判断|recommend)/.test(normalized),
    asksForecast: /(今後|この先|予想|forecast)/.test(normalized)
  };
}

function wantsNarrativeDepth(profile: QuestionProfile): boolean {
  return (
    profile.asksCause ||
    profile.asksDetail ||
    profile.asksRisk ||
    profile.asksTariff ||
    profile.asksGuidance ||
    profile.asksForecast ||
    profile.asksRevenue
  );
}

function selectRelevantMetric(filing: FilingCacheRecord, profile: QuestionProfile): MetricSnapshot | undefined {
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

  if (profile.asksRevenue || profile.asksStockPrice || profile.asksRecommendation || profile.asksGuidance || profile.asksForecast) {
    return filing.metrics.find((metric) => metric.logicalName === "revenue");
  }

  return filing.metrics[0];
}

function selectRelevantNarrative(
  filing: FilingCacheRecord,
  profile: QuestionProfile,
  metricSourceId?: string
): SourceChunkRecord | undefined {
  const narratives = filing.sourceChunks.filter(
    (chunk) => chunk.sectionType === "md_a" && chunk.sourceId !== metricSourceId && !isLowSignalNarrative(chunk)
  );

  const findNarrative = (pattern: RegExp) => narratives.find((chunk) => pattern.test(chunk.text.toLowerCase()));
  const driverNarrative =
    findNarrative(/iphone|services|cloud|ads|americas|china|japan|asia|higher net sales|demand/) ?? narratives[0];

  if (profile.asksTariff) {
    return findNarrative(/tariff|関税/);
  }

  if (profile.asksGuidance || profile.asksForecast) {
    return findNarrative(/guidance|outlook|forecast|expect|cautious|慎重/) ?? driverNarrative;
  }

  if (profile.asksRevenue || profile.asksCause || profile.asksRegion || profile.asksProductMix) {
    return driverNarrative;
  }

  if (profile.asksStockPrice || profile.asksRecommendation || profile.asksRisk || profile.asksMarketReaction) {
    return driverNarrative ?? findNarrative(/risk|uncertain|uncertainty|macro|tariff|demand/);
  }

  return narratives[0];
}

function buildMetricFallbackAnswer(
  metric: MetricSnapshot,
  metricSourceId: string,
  narrative: SourceChunkRecord | undefined,
  profile: QuestionProfile
): GeminiChatAnswer {
  const sourceIds = [metricSourceId];
  const parts = [buildMetricObservation(metric)];

  if (narrative) {
    sourceIds.push(narrative.sourceId);
    parts.push(buildNarrativeContext(narrative, profile));
  }

  parts.push(buildMetricLimitation(profile));

  return {
    answer: parts.join(" "),
    sourceIds
  };
}

function buildClosestContextFallbackAnswer(
  metric: MetricSnapshot | undefined,
  metricSourceId: string | undefined,
  narrative: SourceChunkRecord | undefined,
  profile: QuestionProfile
): GeminiChatAnswer | null {
  const parts = [buildClosestContextLead(profile)];
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

function buildNarrativeFallbackAnswer(narrative: SourceChunkRecord, profile: QuestionProfile): GeminiChatAnswer {
  return {
    answer:
      profile.asksTariff
        ? buildTariffNarrativeSentence(narrative)
        : `提出資料では「${truncateExcerpt(narrative.text, 170)}」と触れています。少なくとも、この論点に近い記述はここです。`,
    sourceIds: [narrative.sourceId]
  };
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
  if (profile.asksTariff) {
    return buildTariffNarrativeSentence(narrative);
  }

  return truncateExcerpt(narrative.text, 170);
}

function buildMetricLimitation(profile: QuestionProfile): string {
  if (profile.asksRevenue && (profile.asksCause || profile.asksDetail)) {
    return "どの事業や地域が売上高を押し上げたかまでは分かりません。";
  }

  if (profile.asksCashFlow && profile.asksCapitalAllocation) {
    return "配当や自社株買いが十分かどうかは、この filing だけでは分かりません。";
  }

  if (profile.asksGuidance || profile.asksForecast) {
    return "この先を言い切ることはできません。";
  }

  if (profile.asksProfitability && profile.asksCause) {
    return "利益率がなぜ動いたかを断定するには、本文の補足も見たいところです。";
  }

  return "この filing だけでは、これ以上の切り分けは難しいです。";
}

function buildClosestContextLead(profile: QuestionProfile): string {
  if (profile.asksStockPrice || profile.asksRecommendation) {
    return "株価が上がるか下がるか自体は、この filing だけでは判断できません。";
  }

  if (profile.asksMarketReaction) {
    return "市場の反応自体は filing 外の情報も必要です。";
  }

  return "この filing から確認できる範囲で、近い事実を整理します。";
}

function buildClosestContextLimitation(profile: QuestionProfile): string {
  if (profile.asksStockPrice || profile.asksRecommendation) {
    return "まず決算書で確認できる変化を押さえ、その上で市場価格や投資判断は別情報で確認するのが安全です。";
  }

  if (profile.asksGuidance || profile.asksForecast) {
    return "具体的な見通しや外部予想との比較は、この filing 以外の情報も必要です。";
  }

  return "この filing だけではここから先は断定できません。";
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

function findMetricSourceId(filing: FilingCacheRecord, metric: MetricSnapshot): string | undefined {
  return filing.sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed)?.sourceId;
}

function isLowSignalNarrative(chunk: SourceChunkRecord): boolean {
  return /available information|investor relations website|corporate website|securities and exchange commission/i.test(
    chunk.text
  );
}

function truncateExcerpt(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trimEnd()}...`;
}
