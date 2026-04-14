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
  buildPrimaryDocumentUrl,
  fetchFilingHtml,
  fetchMetricSnapshots,
  fetchSubmissions,
  lookupTicker,
  pickComparisonFiling,
  pickLatestSupportedFiling
} from "../clients/sec";
import { extractMDASection } from "../extractors/mda";
import { AppError } from "./errors";
import { logEvent } from "./logging";
import type { RemoteConfig } from "./remote-config";

export interface QuotaIdentity {
  quotaSubject: string;
  plan: "free" | "pro";
}

interface UsageEnvelope {
  usage: UsageState;
}

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
  options: { forceRemoteCheck?: boolean } = {}
): Promise<FilingCacheRecord> {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!options.forceRemoteCheck) {
    const cachedByTicker = await loadCachedLatestFiling(normalizedTicker, env, config);
    if (cachedByTicker && isCurrentCacheRecord(cachedByTicker, config)) {
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
    return cached as FilingCacheRecord;
  }

  const releaseLock = await acquireFilingLock(filingKey, env);
  try {
    const secondRead = await env.KABUYOMI_CACHE.get(cacheKey, "json");
    if (secondRead && isCurrentCacheRecord(secondRead as FilingCacheRecord, config)) {
      return secondRead as FilingCacheRecord;
    }

    const record = await ingestFiling(current, pickComparisonFiling(tickerRecord, submissions, current), env, config);
    await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(record));
    await env.KABUYOMI_CACHE.put(buildTickerAliasKey(config.extractorVersion, current.ticker), filingKey);
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
  return (cached as FilingCacheRecord | null) ?? null;
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
  env: Env
): Promise<{ answer: string; sources: Array<{ sourceId: string; sectionType: string; sourceLabel: string; excerpt: string }> }> {
  const modelResponse = await generateChatAnswer(env, { filing, question });
  const validSourceIds = new Set(filing.sourceChunks.map((chunk) => chunk.sourceId));
  const approvedSourceIds = modelResponse.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

  if (approvedSourceIds.length === 0) {
    throw new AppError(502, "Chat response is temporarily unavailable", "Model returned no valid sourceIds");
  }

  return {
    answer: modelResponse.answer,
    sources: approvedSourceIds.map((sourceId) => {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId)!;
      return {
        sourceId: source.sourceId,
        sectionType: source.sectionType,
        sourceLabel: source.sourceLabel,
        excerpt: source.text.slice(0, 220)
      };
    })
  };
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

async function ingestFiling(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env,
  config: RemoteConfig
): Promise<FilingCacheRecord> {
  const html = await fetchFilingHtml(filing, env);
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

  const metrics = await fetchMetricSnapshots(filing, comparisonFiling, env);
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
    primaryDocumentUrl: buildPrimaryDocumentUrl(filing),
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
  const mdParagraphs = mdaText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

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
