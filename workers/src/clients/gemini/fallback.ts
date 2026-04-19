import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord, SummaryRecord } from "../../env";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../../lib/metrics";
import type { ChatPromptInput, GeminiChatAnswer, SummaryPromptInput } from "./types";

type QuestionProfile = {
  normalized: string;
  asksCause: boolean;
  asksDetail: boolean;
  asksGuidance: boolean;
  asksMarketReaction: boolean;
  asksStockContext: boolean;
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
  const metric = selectRelevantMetric(input.filing, profile);
  const metricSourceId = metric ? findMetricSourceId(input.filing, metric) : undefined;
  const narrative = selectRelevantNarrative(input.filing, profile, metricSourceId);

  if (profile.asksStockPrice || profile.asksRecommendation || profile.asksMarketReaction || profile.asksStockContext) {
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

  const anchorSource = selectFallbackAnchorSource(input.filing.sourceChunks);
  if (!anchorSource) {
    return {
      answer: "この filing の提供コンテキストでは確認できません。",
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
    asksStockContext:
      /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
        normalized
      ) ||
      (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalized) &&
        /(株|株価|市場|stock|share)/.test(normalized)),
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
    profile.asksRevenue ||
    profile.asksStockContext
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

  if (
    profile.asksRevenue ||
    profile.asksStockPrice ||
    profile.asksRecommendation ||
    profile.asksStockContext ||
    profile.asksGuidance ||
    profile.asksForecast
  ) {
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

  if (profile.asksGuidance || profile.asksForecast) {
    return guidanceNarrative ?? riskNarrative ?? driverNarrative;
  }

  if (profile.asksRisk) {
    return riskNarrative ?? driverNarrative;
  }

  if (profile.asksProfitability) {
    return marginNarrative ?? driverNarrative;
  }

  if (profile.asksRevenue || profile.asksCause || profile.asksRegion || profile.asksProductMix) {
    return driverNarrative;
  }

  if (
    profile.asksStockPrice ||
    profile.asksRecommendation ||
    profile.asksStockContext ||
    profile.asksMarketReaction
  ) {
    return riskNarrative ?? driverNarrative ?? findNarrative(/demand/);
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

function buildNarrativeFallbackAnswer(narrative: SourceChunkRecord, profile: QuestionProfile): GeminiChatAnswer {
  const limitation = buildNarrativeFallbackLimitation(profile);
  return {
    answer: limitation ? `${summarizeNarrativeEvidence(narrative, profile)} ${limitation}` : summarizeNarrativeEvidence(narrative, profile),
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

function buildMetricLimitation(profile: QuestionProfile): string {
  if (profile.asksRevenue && (profile.asksCause || profile.asksDetail)) {
    return "どの事業や地域が売上高を押し上げたかまでは分かりません。";
  }

  if (profile.asksRisk || profile.asksTariff) {
    return "どのリスクがどこまで業績に効くかは、この filing だけでは断定できません。";
  }

  if (profile.asksCashFlow && profile.asksCapitalAllocation) {
    return "配当や自社株買いが十分かどうかは、この filing だけでは分かりません。";
  }

  if (profile.asksCapitalAllocation) {
    return "還元方針の十分性や今後の水準は、この filing だけでは言い切れません。";
  }

  if (profile.asksCashFlow) {
    return "現金創出の持続性までは、この filing だけでは断定できません。";
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
    return "株価の方向や買いかどうかは、この filing だけでは決められません。";
  }

  if (profile.asksMarketReaction) {
    return "株価の反応には市場予想や外部ニュースも効くので、filing だけでは決め打ちできません。";
  }

  return "この filing から確認できる範囲で、近い事実を整理します。";
}

function buildClosestContextLimitation(profile: QuestionProfile): string {
  if (profile.asksStockPrice || profile.asksRecommendation) {
    return "まず決算書で確認できる変化を押さえ、そのうえで市場価格や投資判断は別情報で確認するのが安全です。";
  }

  if (profile.asksStockContext) {
    return "まず決算で確認できる数字を押さえ、そのうえで株価推移や決算後ニュースを別で見るのが安全です。";
  }

  if (profile.asksGuidance || profile.asksForecast) {
    return "具体的な見通しや外部予想との比較は、この filing 以外の情報も必要です。";
  }

  return "この filing だけではここから先は断定できません。";
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
    return "具体的な数値見通しや外部予想との比較は、この filing 以外の情報も必要です。";
  }

  if (profile.asksRisk || profile.asksTariff) {
    return "どのリスクが実際に表面化するかは、この filing だけでは断定できません。";
  }

  if (profile.asksCapitalAllocation) {
    return "還元余力や今後の方針までは、この filing 断片だけでは言い切れません。";
  }

  if (profile.asksRevenue && (profile.asksCause || profile.asksDetail)) {
    return "どの要因がいちばん効いたかの厳密な切り分けは、この filing 断片だけでは難しいです。";
  }

  if (profile.asksProfitability && profile.asksCause) {
    return "利益率に最も効いた要因を断定するには、追加の filing 記述も見たいところです。";
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
    return "filingベースで見ると、足元はやや強めです。";
  }

  if (score <= -1) {
    return "filingベースで見ると、足元は慎重寄りです。";
  }

  return "filingベースで見ると、強弱はまだらです。";
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
    /management's discussion|results of operations|our business risks|forward-looking statements|investors are cautioned|available information|investor relations website|corporate website|private securities litigation reform act/.test(
      lowered
    )
  ) {
    return "提出資料の一般的な注意書きや案内文で、この論点の深掘りには向きません。";
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

  const generalDriverMatch = trimmed.match(/(?:primarily due to|driven by|helped by|powered by)\s+([^.]+)\./i);
  if (generalDriverMatch?.[1]) {
    return `本文では、${translateDriverList(generalDriverMatch[1])} が主な押し上げ要因と説明しています。`;
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

  if (/(risk|uncertain|uncertainty|macro|consumer sentiment|consumer spending|slowdown|adverse impact)/.test(lowered)) {
    return "本文では、景気や需要の不確実性をリスクとして挙げています。";
  }

  if (!containsJapaneseCharacters(trimmed)) {
    return "提出資料の本文に、この論点に関する説明がありますが、この断片だけでは要因を言い切れません。";
  }

  const excerpt = truncateExcerpt(trimmed, 140).replace(/^「|」$/g, "");
  return excerpt.match(/[。！？]$/) ? excerpt : `${excerpt}。`;
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
    .replace(/\bServices\b/g, "サービス")
    .replace(/\bService\b/g, "サービス")
    .replace(/\biPhone\b/g, "iPhone")
    .replace(/\bMac\b/g, "Mac")
    .replace(/\biPad\b/g, "iPad")
    .replace(/\bWearables,\s*Home and Accessories\b/g, "ウェアラブル・ホーム関連")
    .replace(/\band\b/gi, "と")
    .replace(/,\s*/g, "、")
    .replace(/\s+/g, " ")
    .trim();
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

function containsJapaneseCharacters(text: string): boolean {
  return /[ぁ-んァ-ヶ一-龠]/.test(text);
}
