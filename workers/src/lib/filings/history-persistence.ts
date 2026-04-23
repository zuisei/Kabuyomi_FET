import type { Env, FilingCacheRecord, FilingReference, TickerRecord } from "../../env";
import {
  type SubmissionResponse,
  fetchSubmissions,
  listSupportedFilings,
  lookupTicker,
  pickComparisonFiling
} from "../../clients/sec";
import { loadArchivedFilingByKey, ensureHistoricalArtifacts, hasHistoricalBindings, upsertHistoricalArtifacts } from "../history-store";
import { selectHistoricalAutohydrationCandidates } from "../history-autohydration";
import { logEvent } from "../logging";
import type { RemoteConfig } from "../remote-config";
import { buildFilingKey } from "../../clients/sec";
import { acquireFilingLock } from "./lock";
import { ingestFiling } from "./ingest";
import { isCurrentCacheRecord } from "./cache";

export function enqueueHistoricalPersistence(
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

export function enqueueHistoricalCoveragePreload(
  record: Pick<FilingCacheRecord, "filingKey" | "ticker" | "formType" | "periodOfReport">,
  env: Env,
  config: RemoteConfig,
  executionContext?: Pick<ExecutionContext, "waitUntil">,
  options: {
    tickerRecord?: TickerRecord;
    submissions?: SubmissionResponse;
  } = {}
): void {
  if (!executionContext || !hasHistoricalBindings(env)) {
    return;
  }

  const task = preloadHistoricalCoverage(record, env, config, options).catch((error) => {
    logEvent("history_preload_failed", {
      filingKey: record.filingKey,
      ticker: record.ticker,
      reason: error instanceof Error ? error.message : String(error)
    });
  });
  executionContext.waitUntil(task);
}

export async function ensureHistoricalFilingStored(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env,
  config: RemoteConfig,
  options: { contentMode?: "full" | "metrics_only" } = {}
): Promise<FilingCacheRecord> {
  const filingKey = buildFilingKey(config.extractorVersion, filing);
  const requiresFullContent = options.contentMode !== "metrics_only";
  const archived = await loadArchivedFilingByKey(filingKey, env);
  if (archived && isCurrentCacheRecord(archived, config)) {
    if (!requiresFullContent || !isMetricsOnlyRecord(archived)) {
      await ensureHistoricalArtifacts(archived, env);
      return archived;
    }
  }

  const releaseLock = await acquireFilingLock(filingKey, env);
  try {
    const secondArchived = await loadArchivedFilingByKey(filingKey, env);
    if (secondArchived && isCurrentCacheRecord(secondArchived, config)) {
      if (!requiresFullContent || !isMetricsOnlyRecord(secondArchived)) {
        await ensureHistoricalArtifacts(secondArchived, env);
        return secondArchived;
      }
    }

    // Historical backfills only need filing-grounded metrics and MD&A chunks, so skip Gemini summary spend.
    const record = await ingestFiling(filing, comparisonFiling, env, config, {
      summaryMode: "fallback_only",
      contentMode: options.contentMode ?? "full"
    });
    if (requiresFullContent) {
      await upsertHistoricalArtifacts(record, env);
    } else {
      await ensureHistoricalArtifacts(record, env);
    }
    return record;
  } finally {
    await releaseLock();
  }
}

async function preloadHistoricalCoverage(
  record: Pick<FilingCacheRecord, "filingKey" | "ticker" | "formType" | "periodOfReport">,
  env: Env,
  config: RemoteConfig,
  options: {
    tickerRecord?: TickerRecord;
    submissions?: SubmissionResponse;
  }
): Promise<void> {
  const tickerRecord = options.tickerRecord ?? (await lookupTicker(record.ticker, env));
  if (!tickerRecord) {
    return;
  }

  const submissions = options.submissions ?? (await fetchSubmissions(tickerRecord.cik, env));
  const candidates = selectHistoricalAutohydrationCandidates(
    {
      formType: record.formType,
      accessionNumber: record.filingKey.split(":")[2] ?? record.filingKey,
      periodOfReport: record.periodOfReport
    },
    listSupportedFilings(tickerRecord, submissions)
  );
  if (candidates.length === 0) {
    return;
  }

  logEvent("history_preload_enqueued", {
    filingKey: record.filingKey,
    ticker: record.ticker,
    selectedCount: candidates.length,
    contentMode: "metrics_only"
  });

  let hydratedCount = 0;
  for (const candidate of candidates) {
    await ensureHistoricalFilingStored(candidate, pickComparisonFiling(tickerRecord, submissions, candidate), env, config, {
      contentMode: "metrics_only"
    });
    hydratedCount += 1;
  }

  logEvent("history_preload_completed", {
    filingKey: record.filingKey,
    ticker: record.ticker,
    hydratedCount
  });
}

function isMetricsOnlyRecord(record: FilingCacheRecord): boolean {
  return record.contentMode === "metrics_only";
}
