import type {
  Env,
  FilingCacheRecord,
  FilingReference,
  MetricSnapshot,
  SourceChunkRecord,
  SummaryRecord,
  UsageState
} from "../env";
import { generateChatAnswer, generateSummary } from "../clients/gemini";
import {
  buildFilingKey,
  fetchFilingAssets,
  fetchSubmissions,
  lookupTicker,
  pickComparisonFiling,
  pickLatestSupportedFiling
} from "../clients/sec";
import { findTrustedWebSupplement, type WebSupplementRecord } from "../clients/web-search";
import { extractMDASection } from "../extractors/mda";
import { AppError } from "./errors";
import {
  ensureHistoricalArtifacts,
  hasHistoricalBindings,
  loadArchivedFilingByKey,
  maybeBuildHistoricalChatResponse
} from "./history-store";
import { logEvent } from "./logging";
import type { RemoteConfig } from "./remote-config";

export interface QuotaIdentity {
  quotaSubject: string;
  plan: "free" | "pro";
}

interface UsageEnvelope {
  usage: UsageState;
}

export type ChatSourceKind = "sec_filing" | "web_supplement";

export interface ChatEvidenceSource {
  sourceId: string;
  sourceKind: ChatSourceKind;
  sectionType: string;
  sourceLabel: string;
  excerpt: string;
}

interface ChatResponsePayload {
  answer: string;
  sources: ChatEvidenceSource[];
}

const CONTEXT_UNAVAILABLE_ANSWER = "この filing の提供コンテキストでは確認できません。";

export function readQuotaIdentity(
  request: Request,
  options: { requireDeviceKey?: boolean } = {}
): QuotaIdentity {
  const deviceKey = request.headers.get("x-device-key")?.trim();
  if (options.requireDeviceKey && !deviceKey) {
    throw new AppError(400, "Device key is required");
  }

  return {
    quotaSubject: `free:${deviceKey || "anonymous"}`,
    plan: "free"
  };
}

export async function ensureLatestFiling(
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: { forceRemoteCheck?: boolean; executionContext?: Pick<ExecutionContext, "waitUntil"> } = {}
): Promise<FilingCacheRecord> {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!options.forceRemoteCheck) {
    const cachedByTicker = await loadCachedLatestFiling(normalizedTicker, env, config);
    if (cachedByTicker && isCurrentCacheRecord(cachedByTicker, config)) {
      enqueueHistoricalPersistence(cachedByTicker, env, options.executionContext);
      return cachedByTicker;
    }
  }

  const tickerRecord = await lookupTicker(ticker, env);
  if (!tickerRecord) {
    logEvent("ticker_lookup_failed", { ticker });
    throw new AppError(404, `Ticker not found: ${ticker}`);
  }

  const submissions = await fetchSubmissions(tickerRecord.cik, env);
  const current = pickLatestSupportedFiling(tickerRecord, submissions);
  if (!current) {
    logEvent("unsupported_filing", {
      ticker: tickerRecord.ticker,
      cik: tickerRecord.cik
    });
    throw new AppError(422, `No supported filing found for ${ticker}`);
  }

  logEvent("filing_selected", {
    ticker: current.ticker,
    cik: current.cik,
    formType: current.formType,
    accessionNumber: current.accessionNumber
  });

  const filingKey = buildFilingKey(config.extractorVersion, current);
  const cacheKey = buildCacheKey(config.extractorVersion, current.cik, current.accessionNumber);
  const cached = await env.KABUYOMI_CACHE.get(cacheKey, "json");
  if (cached && isCurrentCacheRecord(cached as FilingCacheRecord, config)) {
    await env.KABUYOMI_CACHE.put(buildTickerAliasKey(config.extractorVersion, current.ticker), filingKey);
    enqueueHistoricalPersistence(cached as FilingCacheRecord, env, options.executionContext);
    return cached as FilingCacheRecord;
  }

  const archived = await loadArchivedFilingByKey(filingKey, env);
  if (archived && isCurrentCacheRecord(archived, config)) {
    await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(archived));
    await env.KABUYOMI_CACHE.put(buildTickerAliasKey(config.extractorVersion, current.ticker), filingKey);
    enqueueHistoricalPersistence(archived, env, options.executionContext);
    return archived;
  }

  const releaseLock = await acquireFilingLock(filingKey, env);
  try {
    const secondRead = await env.KABUYOMI_CACHE.get(cacheKey, "json");
    if (secondRead && isCurrentCacheRecord(secondRead as FilingCacheRecord, config)) {
      enqueueHistoricalPersistence(secondRead as FilingCacheRecord, env, options.executionContext);
      return secondRead as FilingCacheRecord;
    }

    const secondArchived = await loadArchivedFilingByKey(filingKey, env);
    if (secondArchived && isCurrentCacheRecord(secondArchived, config)) {
      await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(secondArchived));
      await env.KABUYOMI_CACHE.put(buildTickerAliasKey(config.extractorVersion, current.ticker), filingKey);
      enqueueHistoricalPersistence(secondArchived, env, options.executionContext);
      return secondArchived;
    }

    const record = await ingestFiling(current, pickComparisonFiling(tickerRecord, submissions, current), env, config);
    await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(record));
    await env.KABUYOMI_CACHE.put(buildTickerAliasKey(config.extractorVersion, current.ticker), filingKey);
    enqueueHistoricalPersistence(record, env, options.executionContext);
    return record;
  } finally {
    await releaseLock();
  }
}

export async function loadFilingByKey(filingKey: string, env: Env): Promise<FilingCacheRecord | null> {
  const [extractorVersion, cik, accession] = filingKey.split(":");
  if (!extractorVersion || !cik || !accession) {
    return null;
  }

  const cacheKey = `filing_cache:${extractorVersion}:${cik}:${accession}`;
  const cached = await env.KABUYOMI_CACHE.get(cacheKey, "json");
  if (cached) {
    return cached as FilingCacheRecord;
  }

  const archived = await loadArchivedFilingByKey(filingKey, env);
  if (archived) {
    await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(archived));
  }
  return archived;
}

export async function consumeChatQuota(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return mutateUsage(identity, env, config, "consumeChat");
}

export async function consumeStockQuota(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return mutateUsage(identity, env, config, "consumeStock", ticker);
}

export async function loadUsage(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return mutateUsage(identity, env, config, "state");
}

export async function buildChatResponse(
  filing: FilingCacheRecord,
  question: string,
  env: Env,
  config?: Pick<RemoteConfig, "webSupplementEnabled">
) : Promise<ChatResponsePayload> {
  const historical = await maybeBuildHistoricalChatResponse(filing, question, env);
  if (historical) {
    return ensureFilingGroundedResponse(historical);
  }

  const deterministic = buildDeterministicMetricAnswer(filing, question);
  if (deterministic) {
    return maybeAppendWebSupplement(
      filing,
      question,
      ensureFilingGroundedResponse(deterministic),
      env,
      config
    );
  }

  const modelResponse = await generateChatAnswer(env, { filing, question });
  const validSourceIds = new Set(filing.sourceChunks.map((chunk) => chunk.sourceId));
  const approvedSourceIds = modelResponse.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

  if (approvedSourceIds.length === 0 && modelResponse.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    return {
      answer: modelResponse.answer,
      sources: []
    };
  }

  if (approvedSourceIds.length === 0) {
    throw new AppError(502, "Chat response is temporarily unavailable", "Model returned no valid sourceIds");
  }

  if (shouldRecoverFromWeakModelSources(filing, question, approvedSourceIds)) {
    const fallback = await generateChatAnswer({ ...env, GEMINI_API_KEY: undefined } as Env, { filing, question });
    const fallbackApprovedSourceIds = fallback.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

    if (fallbackApprovedSourceIds.length > 0) {
      return maybeAppendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse({
          answer: fallback.answer,
          sources: fallbackApprovedSourceIds.map((sourceId) => {
            const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId)!;
            return buildSecFilingSource(source);
          })
        }),
        env,
        config
      );
    }
  }

  return maybeAppendWebSupplement(
    filing,
    question,
    ensureFilingGroundedResponse({
      answer: modelResponse.answer,
      sources: approvedSourceIds.map((sourceId) => {
        const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId)!;
        return buildSecFilingSource(source);
      })
    }),
    env,
    config
  );
}

function shouldRecoverFromWeakModelSources(
  filing: FilingCacheRecord,
  question: string,
  sourceIds: string[]
): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  const asksBroadReasoning =
    ((/(売上|sales|revenue)/.test(normalized) && /(主因|要因|理由|なぜ|支え|ドライバ|牽引)/.test(normalized)) ||
      /(株価|市場|反応|好感|嫌気|織り込|織込|shareprice|stockprice|marketreaction|ガイダンス|見通し|予想|guidance|outlook|来期|次四半期|還元|自社株買い|buyback|repurchase|配当|dividend|capitalallocation|株主還元)/.test(
        normalized
      ));

  if (!asksBroadReasoning) {
    return false;
  }

  const citedNarratives = sourceIds
    .map((sourceId) => filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId))
    .filter((chunk): chunk is SourceChunkRecord => chunk !== undefined && chunk.sectionType === "md_a");

  return citedNarratives.length > 0 && citedNarratives.every(isLowSignalNarrativeSource);
}

function isLowSignalNarrativeSource(source: SourceChunkRecord): boolean {
  return /available information|investor relations website|corporate website|securities and exchange commission|should be read in conjunction/i.test(
    source.text
  );
}

async function maybeAppendWebSupplement(
  filing: FilingCacheRecord,
  question: string,
  response: ChatResponsePayload,
  env: Env,
  config?: Pick<RemoteConfig, "webSupplementEnabled">
): Promise<ChatResponsePayload> {
  if (response.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    return response;
  }

  if (config?.webSupplementEnabled === false) {
    return response;
  }

  if (!shouldUseWebSupplement(question, response.answer)) {
    return response;
  }

  const supplement = await findTrustedWebSupplement(filing, question, env);
  if (!supplement) {
    return response;
  }

  const webSentence = buildWebSupplementSentence(supplement, question);
  if (!webSentence) {
    return response;
  }

  return ensureFilingGroundedResponse({
    answer: `${response.answer} ${webSentence}`,
    sources: [
      ...response.sources,
      {
        sourceId: "W1",
        sourceKind: "web_supplement",
        sectionType: "web_search",
        sourceLabel: `${supplement.publisher} · ${truncateText(supplement.title, 80)}`,
        excerpt: truncateText(supplement.snippet || supplement.title, 220)
      }
    ]
  });
}

function shouldUseWebSupplement(question: string, answer: string): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  const asksGrowthDrivers =
    /(支え|押し上げ|牽引|ドライバー|contributors?|drivers?)/.test(normalized) ||
    (/(主因|要因|理由|背景)/.test(normalized) && /(売上|増収|成長|growth|revenue|需要|株価|市場|反応)/.test(normalized));
  const asksBroadContext =
    /(株価|shareprice|stockprice|買いか|売りか|投資判断|おすすめ|今後|この先|見通し|予想|guidance|outlook|最近|直近|市場|反応|ニュース|報道|話題|関税|tariff|還元|自社株買い|buyback|repurchase|配当|dividend|capital allocation|株主還元|リスク|懸念|逆風|risk)/.test(
      normalized
    );

  return (
    asksBroadContext ||
    asksGrowthDrivers ||
    answer.includes("この filing だけでは") ||
    answer.includes("断定できません") ||
    answer.includes("切り分けられません")
  );
}

function buildWebSupplementSentence(supplement: WebSupplementRecord, question: string): string | null {
  const haystack = `${supplement.title} ${supplement.snippet}`.toLowerCase();
  const normalizedQuestion = question.replace(/\s+/g, "").toLowerCase();
  const asksContrastiveReaction =
    /(株価|市場|反応|上げ|上が|下げ|下が|好感|嫌気)/.test(normalizedQuestion) &&
    (/(なのに|にもかかわらず|のに)/.test(normalizedQuestion) ||
      /(不確実|不透明|懸念|逆風|弱い|悪い|微妙|risk|uncertain|uncertainty)/.test(normalizedQuestion));
  const points: string[] = [];
  const pushPoint = (point: string) => {
    if (!points.includes(point)) {
      points.push(point);
    }
  };

  if (/forecast|guidance|outlook/.test(haystack) && /beat|above|stronger than expected/.test(haystack)) {
    pushPoint("会社見通しが市場予想より強い方向");
  } else if (/forecast|guidance|outlook/.test(haystack)) {
    pushPoint("会社見通し");
  }

  if (/shares? up|stock rises?|sending shares up|stock jumps?/.test(haystack)) {
    pushPoint("市場では株価上昇で反応した");
  } else if (/shares? down|stock falls?|sending shares down|stock drops?/.test(haystack)) {
    pushPoint("市場では株価下落で反応した");
  }

  if (/tariff/.test(haystack)) {
    pushPoint("関税コストや関税リスク");
  }

  if (/margin|pricing|gross margin|profitability|cost pressure/.test(haystack)) {
    pushPoint("利益率や値付け");
  }

  if (/cash flow|free cash flow|liquidity/.test(haystack)) {
    pushPoint("現金を生み出す力");
  }

  if (/buyback|share repurchase|repurchased/.test(haystack)) {
    pushPoint("自社株買い");
  }

  if (/dividend/.test(haystack)) {
    pushPoint("配当");
  }

  if (/capital allocation|capital return/.test(haystack)) {
    pushPoint("会社のお金の使い方");
  }

  if (/ai investment|ai roll-out|artificial intelligence|open to m&a/.test(haystack)) {
    pushPoint("AI投資やAI戦略");
  }

  if (/china/.test(haystack) && /(miss|fell short|weak|decline|disappoint)/.test(haystack)) {
    pushPoint("中国売上の弱さ");
  }
  if (/china/.test(haystack) && /(rebound|recover|improv|strong)/.test(haystack)) {
    pushPoint("中国需要の持ち直し");
  }
  if (/iphone/.test(haystack)) {
    pushPoint("iPhone需要");
  }
  if (/\bservices?\b/.test(haystack)) {
    pushPoint("サービス事業の伸び");
  }
  if (/\bcloud\b/.test(haystack)) {
    pushPoint("クラウド事業の伸び");
  }
  if (/subscription/.test(haystack)) {
    pushPoint("サブスクリプション収益");
  }
  if (/advertising|ads\b/.test(haystack)) {
    pushPoint("広告事業");
  }
  if (/pricing|price hikes?|higher prices?/.test(haystack)) {
    pushPoint("値上げ効果");
  }
  if (/strong demand|resilient demand|healthy demand|demand rebound/.test(haystack)) {
    pushPoint("需要の強さ");
  }
  if (/enterprise/.test(haystack)) {
    pushPoint("企業向け需要");
  }
  if (/risk|uncertainty|macro|slowdown|pressure|weakness/.test(haystack)) {
    pushPoint("景気や需要の不確実性");
  }
  if (/driven by|powered by|boosted by|helped by/.test(haystack) && points.length === 0) {
    pushPoint("事業別の伸び要因");
  }

  if (points.length === 0) {
    if (!supplement.publisher) {
      return null;
    }

    return `外部補足では ${supplement.publisher} が、この論点に関する報道を出しています。これは filing 外の補足です。`;
  }

  if (asksContrastiveReaction) {
    return `外部補足では ${supplement.publisher} が、${points.join("、")}に触れており、市場は懸念よりこちらを強く見た可能性があります。これは filing 外の補足です。`;
  }

  return `外部補足では ${supplement.publisher} が、${points.join("、")}に触れています。これは filing 外の補足です。`;
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trimEnd()}...`;
}

function buildDeterministicMetricAnswer(
  filing: FilingCacheRecord,
  question: string
): ChatResponsePayload | null {
  const normalizedQuestion = question.replace(/\s+/g, "").toLowerCase();
  const asksContrastiveMarketReaction =
    /(株価|市場|反応|上げ|上が|下げ|下が|好感|嫌気)/.test(normalizedQuestion) &&
    (/(なのに|にもかかわらず|のに)/.test(normalizedQuestion) ||
      /(不確実|不透明|懸念|逆風|弱い|悪い|微妙|risk|uncertain|uncertainty)/.test(normalizedQuestion));
  const asksRevenueDrivers =
    /(売上|増収|成長|growth|revenue)/.test(normalizedQuestion) &&
    /(支え|押し上げ|牽引|ドライバ|主因|要因|理由|どの変化|何が)/.test(normalizedQuestion);
  const asksCashGeneration =
    /(キャッシュフロー|cashflow|cash flow|現金|お金.*稼|稼げてる)/.test(normalizedQuestion) &&
    !/(還元|自社株買い|buyback|repurchase|配当|dividend|株主還元)/.test(normalizedQuestion);
  const asksAboutMargin = /(利益率|マージン|採算)/.test(normalizedQuestion);
  const asksAboutCause = /(主因|要因|理由|なぜ)/.test(normalizedQuestion);
  const asksAboutImprovement = /(改善|向上|良化)/.test(normalizedQuestion);
  const asksAboutDeterioration = /(悪化|低下|下落|落ち込|鈍化)/.test(normalizedQuestion);
  const asksAboutChange = /(どう|変化|推移|なった)/.test(normalizedQuestion);
  if (asksContrastiveMarketReaction) {
    return buildContrastiveMarketReactionAnswer(filing);
  }

  if (asksRevenueDrivers) {
    return buildRevenueDriversAnswer(filing);
  }

  if (asksCashGeneration) {
    return buildCashGenerationAnswer(filing);
  }

  if (!asksAboutMargin || (!asksAboutImprovement && !asksAboutDeterioration && !asksAboutChange)) {
    return null;
  }

  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const operatingIncome = filing.metrics.find((metric) => metric.logicalName === "operatingIncome");
  const netIncome = filing.metrics.find((metric) => metric.logicalName === "netIncome");
  if (!revenue || !revenue.comparisonValue) {
    return null;
  }

  const currentOperatingMargin =
    operatingIncome && operatingIncome.comparisonValue !== undefined ? operatingIncome.value / revenue.value : undefined;
  const priorOperatingMargin =
    operatingIncome && operatingIncome.comparisonValue !== undefined
      ? operatingIncome.comparisonValue / revenue.comparisonValue
      : undefined;
  const currentNetMargin = netIncome && netIncome.comparisonValue !== undefined ? netIncome.value / revenue.value : undefined;
  const priorNetMargin =
    netIncome && netIncome.comparisonValue !== undefined ? netIncome.comparisonValue / revenue.comparisonValue : undefined;

  const operatingDelta =
    currentOperatingMargin !== undefined && priorOperatingMargin !== undefined
      ? currentOperatingMargin - priorOperatingMargin
      : undefined;
  const netDelta =
    currentNetMargin !== undefined && priorNetMargin !== undefined ? currentNetMargin - priorNetMargin : undefined;

  const marginSnapshots = [
    buildMarginSnapshot("営業利益率", currentOperatingMargin, priorOperatingMargin, operatingDelta),
    buildMarginSnapshot("純利益率", currentNetMargin, priorNetMargin, netDelta)
  ].filter((snapshot): snapshot is MarginSnapshot => snapshot !== null);
  if (marginSnapshots.length === 0) {
    return null;
  }

  const improvedMargins = marginSnapshots.filter((snapshot) => snapshot.direction === "improved");
  const deterioratedMargins = marginSnapshots.filter((snapshot) => snapshot.direction === "deteriorated");
  const hasImprovement = improvedMargins.length > 0;
  const hasDeterioration = deterioratedMargins.length > 0;

  const sourceIds = Array.from(new Set([
    findMetricSourceId(filing, "revenue"),
    findMetricSourceId(filing, "operatingIncome"),
    findMetricSourceId(filing, "netIncome")
  ].filter((sourceId): sourceId is string => Boolean(sourceId))));

  const sources = sourceIds.map((sourceId) => {
    const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId)!;
    return buildSecFilingSource(source);
  });

  if (asksAboutCause) {
    if (asksAboutDeterioration && !hasDeterioration) {
      return {
        answer: [
          "提出資料上、今期の利益率悪化は確認できません。",
          ...marginSnapshots.map(formatMarginSnapshot)
        ].join(" "),
        sources
      };
    }
    if (asksAboutImprovement && !hasImprovement) {
      return {
        answer: [
          "提出資料上、今期の利益率改善は確認できません。",
          ...marginSnapshots.map(formatMarginSnapshot)
        ].join(" "),
        sources
      };
    }
    return null;
  }

  const answerParts = [buildMarginIntro({ asksAboutImprovement, asksAboutDeterioration, hasImprovement, hasDeterioration })];
  answerParts.push(...marginSnapshots.map(formatMarginSnapshot));

  return {
    answer: answerParts.join(" "),
    sources
  };
}

function buildRevenueDriversAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const revenueSourceId = findMetricSourceId(filing, "revenue");
  if (!revenue || !revenueSourceId) {
    return null;
  }

  const revenueSource = filing.sourceChunks.find((chunk) => chunk.sourceId === revenueSourceId);
  if (!revenueSource) {
    return null;
  }

  const narrative = summarizeRevenueDrivers(filing.sourceChunks);
  const sources = [buildSecFilingSource(revenueSource)];
  if (narrative) {
    for (const sourceId of narrative.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
  }

  const answerParts = [buildMetricObservationSentence(revenue)];
  if (narrative) {
    answerParts.push(narrative.text);
  }
  answerParts.push("ただし、どの要因がいちばん効いたかを厳密に切り分けるには追加情報が必要です。");

  return {
    answer: answerParts.join(" "),
    sources: dedupeSources(sources)
  };
}

function buildContrastiveMarketReactionAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const risk = summarizeRiskContext(filing.sourceChunks);
  const performance = summarizePerformanceStrength(filing);
  const drivers = summarizeRevenueDrivers(filing.sourceChunks);

  if (!risk && !performance && !drivers) {
    return null;
  }

  const sources: ChatEvidenceSource[] = [];
  const answerParts: string[] = [];

  if (risk) {
    for (const sourceId of risk.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(`たしかに、提出資料では${risk.text}。`);
  }

  if (performance) {
    for (const sourceId of performance.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(`一方で、${performance.text}`);
  }

  if (drivers) {
    for (const sourceId of drivers.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(drivers.text);
  }

  answerParts.push("そのため、「不確実さはあるが、足元の業績や需要は想定より強い」と受け取られても不思議ではありません。");
  answerParts.push("ただし、実際に株価を押し上げた理由を一つに断定することはできません。");

  return {
    answer: answerParts.join(" "),
    sources: dedupeSources(sources)
  };
}

function buildCashGenerationAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const metric = filing.metrics.find((entry) => entry.logicalName === "operatingCashFlow");
  const sourceId = findMetricSourceId(filing, "operatingCashFlow");
  if (!metric || !sourceId) {
    return null;
  }

  const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
  if (!source) {
    return null;
  }

  return {
    answer: buildMetricObservationSentence(metric),
    sources: [buildSecFilingSource(source)]
  };
}

function summarizeRevenueDrivers(
  sourceChunks: SourceChunkRecord[]
): { text: string; sourceIds: string[] } | null {
  const points: string[] = [];
  const sourceIds: string[] = [];
  const regionPatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: "米州", pattern: /Americas[\s\S]*?higher net sales of ([^.]+)\./i },
    { label: "中国", pattern: /Greater China[\s\S]*?higher net sales of ([^.]+)\./i },
    { label: "日本", pattern: /Japan[\s\S]*?higher net sales of ([^.]+)\./i },
    { label: "アジア太平洋", pattern: /Rest of Asia Pacific[\s\S]*?higher net sales of ([^.]+)\./i }
  ];

  for (const chunk of sourceChunks) {
    if (chunk.sectionType !== "md_a") {
      continue;
    }

    for (const region of regionPatterns) {
      const match = chunk.text.match(region.pattern);
      if (!match?.[1]) {
        continue;
      }

      const driver = translateDriverList(match[1]);
      const point = `${region.label}は ${driver}`;
      if (!points.includes(point)) {
        points.push(point);
      }
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
    }
  }

  if (points.length === 0) {
    return null;
  }

  return {
    text: `提出資料では、${points.join("、")}の売上増が伸びを支えたと説明しています。`,
    sourceIds
  };
}

function summarizePerformanceStrength(
  filing: FilingCacheRecord
): { text: string; sourceIds: string[] } | null {
  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const operatingIncome = filing.metrics.find((metric) => metric.logicalName === "operatingIncome");
  const netIncome = filing.metrics.find((metric) => metric.logicalName === "netIncome");
  const sourceIds: string[] = [];

  if (revenue) {
    const sourceId = findMetricSourceId(filing, "revenue");
    if (sourceId) {
      sourceIds.push(sourceId);
    }
  }

  if (operatingIncome) {
    const sourceId = findMetricSourceId(filing, "operatingIncome");
    if (sourceId) {
      sourceIds.push(sourceId);
    }
  } else if (netIncome) {
    const sourceId = findMetricSourceId(filing, "netIncome");
    if (sourceId) {
      sourceIds.push(sourceId);
    }
  }

  if (revenue && operatingIncome) {
    return {
      text: `${buildMetricObservationSentence(revenue)} ${buildMetricObservationSentence(operatingIncome)} 少なくとも、足元の数字自体は弱くありません。`,
      sourceIds
    };
  }

  if (revenue) {
    return {
      text: `${buildMetricObservationSentence(revenue)} 少なくとも、売上の伸び自体は確認できます。`,
      sourceIds
    };
  }

  if (operatingIncome) {
    return {
      text: `${buildMetricObservationSentence(operatingIncome)} 少なくとも、利益面は弱くありません。`,
      sourceIds
    };
  }

  if (netIncome) {
    return {
      text: `${buildMetricObservationSentence(netIncome)} 少なくとも、利益面は弱くありません。`,
      sourceIds
    };
  }

  return null;
}

function summarizeRiskContext(
  sourceChunks: SourceChunkRecord[]
): { text: string; sourceIds: string[] } | null {
  const points: string[] = [];
  const sourceIds: string[] = [];

  for (const chunk of sourceChunks) {
    if (chunk.sectionType !== "md_a") {
      continue;
    }

    const haystack = chunk.text.toLowerCase();
    if (/forward-looking statements|private securities litigation reform act|available information/i.test(haystack)) {
      continue;
    }

    if (/tariff|関税/.test(haystack) && !points.includes("関税や追加措置の不確実さが残っています")) {
      points.push("関税や追加措置の不確実さが残っています");
      sourceIds.push(chunk.sourceId);
    }

    if (
      /(macroeconomic|inflation|interest rates|component pricing|currency fluctuations|macro)/.test(haystack) &&
      !points.includes("景気・金利・為替などの不確実さがあります")
    ) {
      points.push("景気・金利・為替などの不確実さがあります");
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
    }

    if (
      /(consumer spending|consumer sentiment|negative consumer sentiment|adverse impact|uncertain|uncertainty|risk)/.test(
        haystack
      ) &&
      !points.includes("需要や消費者心理が弱くなるリスクがあります")
    ) {
      points.push("需要や消費者心理が弱くなるリスクがあります");
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
    }

    if (points.length >= 2) {
      break;
    }
  }

  if (points.length === 0) {
    return null;
  }

  return {
    text: points.join("、"),
    sourceIds
  };
}

function translateDriverList(raw: string): string {
  return raw
    .replace(/\bServices\b/g, "サービス")
    .replace(/\bService\b/g, "サービス")
    .replace(/\band\b/gi, "と")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMetricObservationSentence(metric: MetricSnapshot): string {
  const label = metricLabel(metric.logicalName);
  const current = formatMetricValue(metric.value, metric.unit);

  if (metric.yoyPercent !== undefined) {
    return `${label}は ${current} で、前年同期比 ${formatYoYDelta(metric.yoyPercent)} です。`;
  }

  if (metric.comparisonValue !== undefined) {
    return `${label}は ${current} で、比較値は ${formatMetricValue(metric.comparisonValue, metric.unit)} です。`;
  }

  return `${label}は ${current} です。`;
}

function dedupeSources(sources: ChatEvidenceSource[]): ChatEvidenceSource[] {
  const deduped: ChatEvidenceSource[] = [];
  for (const source of sources) {
    if (!deduped.some((entry) => entry.sourceId === source.sourceId)) {
      deduped.push(source);
    }
  }
  return deduped;
}

function buildSecFilingSource(source: SourceChunkRecord): ChatEvidenceSource {
  return {
    sourceId: source.sourceId,
    sourceKind: "sec_filing",
    sectionType: source.sectionType,
    sourceLabel: source.sourceLabel,
    excerpt: source.text.slice(0, 220)
  };
}

function ensureFilingGroundedResponse(response: ChatResponsePayload): ChatResponsePayload {
  if (response.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    return {
      answer: response.answer,
      sources: []
    };
  }

  if (!response.sources.some((source) => source.sourceKind === "sec_filing")) {
    throw new AppError(502, "Chat response must cite the filing", "No SEC filing source was attached");
  }

  return response;
}

type MarginDirection = "improved" | "deteriorated" | "flat";

type MarginSnapshot = {
  label: string;
  current: number;
  prior: number;
  direction: MarginDirection;
};

function buildMarginSnapshot(
  label: string,
  current: number | undefined,
  prior: number | undefined,
  delta: number | undefined
): MarginSnapshot | null {
  if (current === undefined || prior === undefined || delta === undefined) {
    return null;
  }

  if (delta > 0.0001) {
    return { label, current, prior, direction: "improved" };
  }
  if (delta < -0.0001) {
    return { label, current, prior, direction: "deteriorated" };
  }
  return { label, current, prior, direction: "flat" };
}

function buildMarginIntro({
  asksAboutImprovement,
  asksAboutDeterioration,
  hasImprovement,
  hasDeterioration
}: {
  asksAboutImprovement: boolean;
  asksAboutDeterioration: boolean;
  hasImprovement: boolean;
  hasDeterioration: boolean;
}): string {
  if (asksAboutImprovement) {
    if (hasImprovement && !hasDeterioration) {
      return "提出資料上、利益率は改善しています。";
    }
    if (!hasImprovement && hasDeterioration) {
      return "提出資料上、利益率の改善は確認できません。";
    }
    return "提出資料上、利益率は項目ごとに方向が分かれています。";
  }

  if (asksAboutDeterioration) {
    if (hasDeterioration && !hasImprovement) {
      return "提出資料上、利益率は悪化しています。";
    }
    if (!hasDeterioration && hasImprovement) {
      return "提出資料上、今期の利益率悪化は確認できません。";
    }
    return "提出資料上、利益率は項目ごとに方向が分かれています。";
  }

  if (hasImprovement && !hasDeterioration) {
    return "提出資料上、利益率は改善しています。";
  }
  if (!hasImprovement && hasDeterioration) {
    return "提出資料上、利益率は悪化しています。";
  }
  return "提出資料上、利益率は項目ごとに方向が分かれています。";
}

function formatMarginSnapshot(snapshot: MarginSnapshot): string {
  const prior = `${(snapshot.prior * 100).toFixed(1)}%`;
  const current = `${(snapshot.current * 100).toFixed(1)}%`;

  switch (snapshot.direction) {
    case "improved":
      return `${snapshot.label}は ${prior} から ${current} へ改善しています。`;
    case "deteriorated":
      return `${snapshot.label}は ${prior} から ${current} へ低下しています。`;
    case "flat":
      return `${snapshot.label}は ${prior} から ${current} で、大きな変化はありません。`;
  }
}

function findMetricSourceId(filing: FilingCacheRecord, logicalName: MetricSnapshot["logicalName"]): string | undefined {
  const metric = filing.metrics.find((item) => item.logicalName === logicalName);
  if (!metric) {
    return undefined;
  }

  return filing.sourceChunks.find(
    (chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed
  )?.sourceId;
}

function buildCacheKey(extractorVersion: string, cik: string, accessionNumber: string): string {
  return `filing_cache:${extractorVersion}:${cik}:${accessionNumber.replaceAll("-", "")}`;
}

function isCurrentCacheRecord(record: FilingCacheRecord, config: RemoteConfig): boolean {
  return record.extractorVersion === config.extractorVersion && record.promptVersion === config.promptVersion;
}

function buildTickerAliasKey(extractorVersion: string, ticker: string): string {
  return `latest_filing_by_ticker:${extractorVersion}:${ticker.toUpperCase()}`;
}

function enqueueHistoricalPersistence(
  record: FilingCacheRecord,
  env: Env,
  executionContext?: Pick<ExecutionContext, "waitUntil">
): void {
  if (!hasHistoricalBindings(env)) {
    return;
  }

  const task = ensureHistoricalArtifacts(record, env).catch((error) => {
    logEvent("history_persistence_failed", {
      filingKey: record.filingKey,
      reason: error instanceof Error ? error.message : String(error)
    });
  });

  if (executionContext) {
    executionContext.waitUntil(task);
    return;
  }

  void task;
}

async function loadCachedLatestFiling(
  ticker: string,
  env: Env,
  config: RemoteConfig
): Promise<FilingCacheRecord | null> {
  const filingKey = await env.KABUYOMI_CACHE.get(buildTickerAliasKey(config.extractorVersion, ticker));
  if (!filingKey) {
    return null;
  }

  return loadFilingByKey(filingKey, env);
}

export async function ensureHistoricalFilingStored(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env,
  config: RemoteConfig
): Promise<FilingCacheRecord> {
  const filingKey = buildFilingKey(config.extractorVersion, filing);
  const archived = await loadArchivedFilingByKey(filingKey, env);
  if (archived && isCurrentCacheRecord(archived, config)) {
    await ensureHistoricalArtifacts(archived, env);
    return archived;
  }

  const releaseLock = await acquireFilingLock(filingKey, env);
  try {
    const secondArchived = await loadArchivedFilingByKey(filingKey, env);
    if (secondArchived && isCurrentCacheRecord(secondArchived, config)) {
      await ensureHistoricalArtifacts(secondArchived, env);
      return secondArchived;
    }

    const record = await ingestFiling(filing, comparisonFiling, env, config);
    await ensureHistoricalArtifacts(record, env);
    return record;
  } finally {
    await releaseLock();
  }
}

async function ingestFiling(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env,
  config: RemoteConfig
): Promise<FilingCacheRecord> {
  const { html, primaryDocumentUrl, metrics } = await fetchFilingAssets(filing, comparisonFiling, env);
  const extracted = extractMDASection(html, filing.formType);
  if (!extracted) {
    logEvent("extraction_failed", {
      ticker: filing.ticker,
      cik: filing.cik,
      formType: filing.formType,
      accessionNumber: filing.accessionNumber
    });
    throw new AppError(422, "Failed to extract MD&A section");
  }

  logEvent("extraction_succeeded", {
    ticker: filing.ticker,
    cik: filing.cik,
    formType: filing.formType,
    accessionNumber: filing.accessionNumber,
    tokenCount: extracted.tokenCount
  });

  const filingKey = buildFilingKey(config.extractorVersion, filing);
  const sourceChunks = buildSourceChunks(filing, extracted.text, metrics);
  const summary = await generateSummary(env, {
    filingKey,
    ticker: filing.ticker,
    companyName: filing.companyName,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    metrics,
    sourceChunks
  });

  return {
    filingKey,
    ticker: filing.ticker,
    companyName: filing.companyName,
    cik: filing.cik,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    primaryDocumentUrl,
    mdaText: extracted.text,
    mdaTokenCount: extracted.tokenCount,
    metrics,
    sourceChunks,
    summary,
    generatedAt: new Date().toISOString(),
    extractorVersion: config.extractorVersion,
    promptVersion: config.promptVersion
  };
}

function buildSourceChunks(
  filing: FilingReference,
  mdaText: string,
  metrics: MetricSnapshot[]
): SourceChunkRecord[] {
  const chunks: SourceChunkRecord[] = [];
  const mdParagraphs = splitMdaParagraphs(mdaText);

  let mdOffset = 0;
  let sourceIndex = 1;

  for (const paragraph of mdParagraphs) {
    const excerpt = paragraph.slice(0, 900);
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "md_a",
      sectionTitle: filing.formType === "10-K" ? "Item 7" : "Part I, Item 2",
      sourceLabel: `${filing.formType} ${filing.formType === "10-K" ? "Item 7" : "Part I Item 2"}, filed ${filing.filedAt}`,
      text: excerpt,
      startOffset: mdOffset,
      endOffset: mdOffset + excerpt.length,
      sortOrder: sourceIndex
    });
    mdOffset += paragraph.length + 2;
    sourceIndex += 1;
    if (sourceIndex > 8) {
      break;
    }
  }

  for (const metric of metrics) {
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "xbrl_metric",
      sectionTitle: metricLabel(metric.logicalName),
      sourceLabel: `XBRL ${metricLabel(metric.logicalName)} (${metric.tagUsed})`,
      text: [
        `${metricLabel(metric.logicalName)}: ${metric.value} ${metric.unit}`,
        metric.comparisonValue !== undefined ? `比較値: ${metric.comparisonValue}` : null,
        metric.yoyPercent !== undefined ? `YoY: ${metric.yoyPercent.toFixed(1)}%` : null
      ]
        .filter(Boolean)
        .join(" / "),
      startOffset: 0,
      endOffset: 0,
      tagName: metric.tagUsed,
      sortOrder: sourceIndex
    });
    sourceIndex += 1;
  }

  return chunks;
}

function splitMdaParagraphs(mdaText: string): string[] {
  const paragraphs = mdaText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !looksLikeTocParagraph(paragraph));

  if (paragraphs.length >= 2) {
    return paragraphs;
  }

  const collapsed = mdaText.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < collapsed.length && chunks.length < 8) {
    let end = Math.min(cursor + 1_100, collapsed.length);
    if (end < collapsed.length) {
      const boundary = Math.max(
        collapsed.lastIndexOf(". ", end),
        collapsed.lastIndexOf("; ", end),
        collapsed.lastIndexOf("? ", end),
        collapsed.lastIndexOf("! ", end)
      );
      if (boundary > cursor + 200) {
        end = boundary + 1;
      }
    }

    const candidate = collapsed.slice(cursor, end).trim();
    if (candidate && !looksLikeTocParagraph(candidate)) {
      chunks.push(candidate);
    }
    cursor = end;
  }

  return chunks;
}

function looksLikeTocParagraph(paragraph: string): boolean {
  const sample = paragraph.slice(0, 320);
  const itemMentions = [...sample.matchAll(/item\s+\d/gi)].length;
  return /table of contents/i.test(sample) || /pagepart/i.test(sample) || itemMentions >= 3;
}

function metricLabel(metric: MetricSnapshot["logicalName"]): string {
  const labels: Record<MetricSnapshot["logicalName"], string> = {
    revenue: "売上高",
    netIncome: "純利益",
    epsBasic: "EPS（Basic）",
    operatingIncome: "営業利益",
    operatingCashFlow: "営業CF"
  };
  return labels[metric];
}

function formatMetricValue(value: number, unit: string): string {
  if (unit === "USD") {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000_000) {
      return `${formatCompactNumber(value / 1_000_000_000_000)}兆ドル`;
    }
    if (abs >= 100_000_000) {
      return `${formatCompactNumber(value / 100_000_000)}億ドル`;
    }
  }

  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} ${unit}`.trim();
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(value);
}

function formatYoYDelta(yoyPercent: number): string {
  const formatted = `${Math.abs(yoyPercent).toFixed(1)}%`;
  return `${formatted}${yoyPercent >= 0 ? "増" : "減"}`;
}

async function acquireFilingLock(
  filingKey: string,
  env: Env
): Promise<() => Promise<void>> {
  const stub = env.FILING_LOCK.getByName(filingKey);
  const response = await stub.fetch("https://do/lock", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to acquire filing lock");
  }

  return async () => {
    await stub.fetch("https://do/unlock", { method: "POST" });
  };
}

async function mutateUsage(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  action: "state" | "consumeChat" | "consumeStock",
  ticker?: string
): Promise<UsageState> {
  const stub = env.USER_QUOTA.getByName(identity.quotaSubject);
  const dateJST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const response = await stub.fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        quotaSubject: identity.quotaSubject,
        plan: identity.plan,
        dateJST,
        ticker,
        chatLimit: identity.plan === "pro" ? config.proDailyChatLimit : config.freeDailyChatLimit,
        stockLimit: identity.plan === "pro" ? Number.MAX_SAFE_INTEGER : config.freeStockLimit
      })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!response.ok || !payload.usage) {
    logEvent("quota_denial", {
      action,
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      reason: payload.error ?? "Quota request failed"
    });
    throw new AppError(response.status, payload.error ?? "Quota request failed");
  }

  return payload.usage;
}
