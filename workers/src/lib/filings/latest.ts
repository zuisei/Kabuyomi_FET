import type { Env, FilingCacheRecord, TickerRecord } from "../../env";
import {
  buildFilingKey,
  fetchSubmissions,
  lookupTicker,
  pickComparisonFiling,
  pickLatestSupportedFiling
} from "../../clients/sec";
import { AppError } from "../errors";
import { loadArchivedFilingByKey } from "../history-store";
import { logEvent, logWarnEvent } from "../logging";
import type { RemoteConfig } from "../remote-config";
import { buildCacheKey, buildTickerAliasKeys, isCurrentCacheRecord, loadCachedLatestFiling } from "./cache";
import {
  backfillCompanyWebsite,
  enqueueCompanyWebsiteBackfill,
  enqueueContentUpgrade,
  isMetricsOnlyRecord,
  needsCompanyWebsiteBackfill,
  upgradeMetricsOnlyRecord
} from "./content-upgrade";
import { enqueueHistoricalCoveragePreload, enqueueHistoricalPersistence } from "./history-persistence";
import { ingestFiling } from "./ingest";
import { acquireFilingLock } from "./lock";
import { enqueueSummaryUpgrade } from "./summary-upgrade";

export async function ensureLatestFiling(
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: {
    forceRemoteCheck?: boolean;
    deferFullContent?: boolean;
    executionContext?: Pick<ExecutionContext, "waitUntil">;
    tickerRecord?: TickerRecord;
  } = {}
): Promise<FilingCacheRecord> {
  const startedAt = Date.now();
  const normalizedTicker = options.tickerRecord?.ticker ?? ticker.trim().toUpperCase();
  const deferFullContent = options.deferFullContent === true && Boolean(options.executionContext);
  if (!options.forceRemoteCheck) {
    const cachedByTicker = await loadCachedLatestFiling(normalizedTicker, env, config);
    if (cachedByTicker && isCurrentCacheRecord(cachedByTicker, config)) {
      const hydrated = await prepareLatestRecordForReturn(cachedByTicker, env, {
        deferFullContent
      });
      if (hydrated) {
        enqueueHistoricalSideEffects(hydrated, env, config, options.executionContext);
        logLatestFilingReady("cache_alias", normalizedTicker, hydrated.filingKey, startedAt, options.forceRemoteCheck);
        return hydrated;
      }
    }
  }

  const tickerRecord = options.tickerRecord ?? (await lookupTicker(ticker, env));
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
  if (!options.forceRemoteCheck) {
    const cached = await env.KABUYOMI_CACHE.get(cacheKey, "json");
    if (cached && isCurrentCacheRecord(cached as FilingCacheRecord, config)) {
      await cacheLatestFilingAlias(config.extractorVersion, current.ticker, filingKey, env);
      const hydrated = await prepareLatestRecordForReturn(cached as FilingCacheRecord, env, {
        deferFullContent
      });
      if (hydrated) {
        enqueueHistoricalSideEffects(hydrated, env, config, options.executionContext, {
          tickerRecord
        });
        logLatestFilingReady("cache_record", current.ticker, filingKey, startedAt, options.forceRemoteCheck);
        return hydrated;
      }
    }

    const archived = await loadArchivedFilingByKey(filingKey, env);
    if (archived && isCurrentCacheRecord(archived, config)) {
      const hydrated = await prepareLatestRecordForReturn(archived, env, {
        deferFullContent
      });
      if (hydrated) {
        await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(hydrated));
        await cacheLatestFilingAlias(config.extractorVersion, current.ticker, filingKey, env);
        enqueueHistoricalSideEffects(hydrated, env, config, options.executionContext, {
          tickerRecord
        });
        logLatestFilingReady("archive", current.ticker, filingKey, startedAt, options.forceRemoteCheck);
        return hydrated;
      }
    }
  } else {
    const cached = await env.KABUYOMI_CACHE.get(cacheKey, "json");
    if (cached && isCurrentCacheRecord(cached as FilingCacheRecord, config)) {
      await cacheLatestFilingAlias(config.extractorVersion, current.ticker, filingKey, env);
      const hydrated = await prepareLatestRecordForReturn(cached as FilingCacheRecord, env, {
        deferFullContent
      });
      if (hydrated) {
        enqueueHistoricalSideEffects(hydrated, env, config, options.executionContext, {
          tickerRecord
        });
        logLatestFilingReady("cache_record_after_remote_check", current.ticker, filingKey, startedAt, options.forceRemoteCheck);
        return hydrated;
      }
    }

    const archived = await loadArchivedFilingByKey(filingKey, env);
    if (archived && isCurrentCacheRecord(archived, config)) {
      const hydrated = await prepareLatestRecordForReturn(archived, env, {
        deferFullContent
      });
      if (hydrated) {
        await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(hydrated));
        await cacheLatestFilingAlias(config.extractorVersion, current.ticker, filingKey, env);
        enqueueHistoricalSideEffects(hydrated, env, config, options.executionContext, {
          tickerRecord
        });
        logLatestFilingReady("archive_after_remote_check", current.ticker, filingKey, startedAt, options.forceRemoteCheck);
        return hydrated;
      }
    }
  }

  const releaseLock = await acquireFilingLock(filingKey, env);
  try {
    const secondRead = await env.KABUYOMI_CACHE.get(cacheKey, "json");
    if (secondRead && isCurrentCacheRecord(secondRead as FilingCacheRecord, config)) {
      await cacheLatestFilingAlias(config.extractorVersion, current.ticker, filingKey, env);
      const hydrated = prepareLatestRecordForReturnInsideLock(secondRead as FilingCacheRecord, {
        deferFullContent
      });
      if (hydrated) {
        enqueueHistoricalSideEffects(hydrated, env, config, options.executionContext, {
          tickerRecord
        });
        logLatestFilingReady("cache_record_after_lock", current.ticker, filingKey, startedAt, options.forceRemoteCheck);
        return hydrated;
      }
    }

    const secondArchived = await loadArchivedFilingByKey(filingKey, env);
    if (secondArchived && isCurrentCacheRecord(secondArchived, config)) {
      const hydrated = prepareLatestRecordForReturnInsideLock(secondArchived, {
        deferFullContent
      });
      if (hydrated) {
        await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(hydrated));
        await cacheLatestFilingAlias(config.extractorVersion, current.ticker, filingKey, env);
        enqueueHistoricalSideEffects(hydrated, env, config, options.executionContext, {
          tickerRecord
        });
        logLatestFilingReady("archive_after_lock", current.ticker, filingKey, startedAt, options.forceRemoteCheck);
        return hydrated;
      }
    }

    const record = await ingestFiling(current, pickComparisonFiling(tickerRecord, submissions, current), env, config, {
      summaryMode: deferFullContent ? "fallback_only" : "default",
      contentMode: deferFullContent ? "metrics_only" : "full"
    });
    await env.KABUYOMI_CACHE.put(cacheKey, JSON.stringify(record));
    await cacheLatestFilingAlias(config.extractorVersion, current.ticker, filingKey, env);
    enqueueHistoricalSideEffects(record, env, config, options.executionContext, {
      tickerRecord
    });
    logLatestFilingReady("ingest", current.ticker, filingKey, startedAt, options.forceRemoteCheck);
    return record;
  } finally {
    await releaseLock();
  }
}

async function cacheLatestFilingAlias(
  extractorVersion: string,
  ticker: string,
  filingKey: string,
  env: Env
): Promise<void> {
  await Promise.all(buildTickerAliasKeys(extractorVersion, ticker).map((aliasKey) => env.KABUYOMI_CACHE.put(aliasKey, filingKey)));
}

function logLatestFilingReady(
  source: string,
  ticker: string,
  filingKey: string,
  startedAt: number,
  forceRemoteCheck?: boolean
): void {
  logEvent("latest_filing_ready", {
    ticker,
    filingKey,
    source,
    forceRemoteCheck: Boolean(forceRemoteCheck),
    totalMs: Date.now() - startedAt
  });
}

function enqueueHistoricalSideEffects(
  record: FilingCacheRecord,
  env: Env,
  config: RemoteConfig,
  executionContext?: Pick<ExecutionContext, "waitUntil">,
  options: {
    tickerRecord?: TickerRecord;
    submissions?: Awaited<ReturnType<typeof fetchSubmissions>>;
  } = {}
): void {
  enqueueHistoricalPersistence(record, env, executionContext);
  enqueueHistoricalCoveragePreload(record, env, config, executionContext, options);
  if (isMetricsOnlyRecord(record)) {
    enqueueContentUpgrade(record, env, executionContext);
    return;
  }

  if (needsCompanyWebsiteBackfill(record)) {
    enqueueCompanyWebsiteBackfill(record, env, executionContext);
  }
  enqueueSummaryUpgrade(record, env, executionContext);
}

async function prepareLatestRecordForReturn(
  record: FilingCacheRecord,
  env: Env,
  options: { deferFullContent?: boolean } = {}
): Promise<FilingCacheRecord | null> {
  if (isMetricsOnlyRecord(record)) {
    if (options.deferFullContent) {
      return record;
    }

    return upgradeMetricsOnlyRecord(record, env);
  }

  if (needsCompanyWebsiteBackfill(record) && !options.deferFullContent) {
    return maybeBackfillCompanyWebsite(record, env);
  }

  return record;
}

function prepareLatestRecordForReturnInsideLock(
  record: FilingCacheRecord,
  options: { deferFullContent?: boolean } = {}
): FilingCacheRecord | null {
  // The caller already holds the filing lock. Avoid nested lock acquisition; partial records fall through to full ingest.
  if (isMetricsOnlyRecord(record) && !options.deferFullContent) {
    return null;
  }

  return record;
}

async function maybeBackfillCompanyWebsite(record: FilingCacheRecord, env: Env): Promise<FilingCacheRecord> {
  if (!needsCompanyWebsiteBackfill(record)) {
    return record;
  }

  try {
    return await backfillCompanyWebsite(record, env);
  } catch (error) {
    logWarnEvent("filing_company_website_backfill_failed", {
      filingKey: record.filingKey,
      ticker: record.ticker,
      reason: error instanceof Error ? error.message : String(error)
    });
    return record;
  }
}
