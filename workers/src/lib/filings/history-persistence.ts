import type { Env, FilingCacheRecord, FilingReference } from "../../env";
import { loadArchivedFilingByKey, ensureHistoricalArtifacts, hasHistoricalBindings } from "../history-store";
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

    // Historical backfills only need filing-grounded metrics and MD&A chunks, so skip Gemini summary spend.
    const record = await ingestFiling(filing, comparisonFiling, env, config, {
      summaryMode: "fallback_only"
    });
    await ensureHistoricalArtifacts(record, env);
    return record;
  } finally {
    await releaseLock();
  }
}
