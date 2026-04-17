import type { Env, FilingCacheRecord } from "../../env";
import {
  buildFilingKey,
  fetchSubmissions,
  lookupTicker,
  pickComparisonFiling,
  pickLatestSupportedFiling
} from "../../clients/sec";
import { AppError } from "../errors";
import { loadArchivedFilingByKey } from "../history-store";
import { logEvent } from "../logging";
import type { RemoteConfig } from "../remote-config";
import { buildCacheKey, buildTickerAliasKey, isCurrentCacheRecord, loadCachedLatestFiling } from "./cache";
import { enqueueHistoricalPersistence } from "./history-persistence";
import { ingestFiling } from "./ingest";
import { acquireFilingLock } from "./lock";

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
