import type { Env, FilingCacheRecord } from "../../env";
import { loadArchivedFilingByKey } from "../history-store";
import type { RemoteConfig } from "../remote-config";

export function buildCacheKey(extractorVersion: string, cik: string, accessionNumber: string): string {
  return `filing_cache:${extractorVersion}:${cik}:${accessionNumber.replaceAll("-", "")}`;
}

export function buildTickerAliasKey(extractorVersion: string, ticker: string): string {
  return `latest_filing_by_ticker:${extractorVersion}:${ticker.toUpperCase()}`;
}

export function isCurrentCacheRecord(record: FilingCacheRecord, config: RemoteConfig): boolean {
  return record.extractorVersion === config.extractorVersion && record.promptVersion === config.promptVersion;
}

export async function loadFilingByKey(filingKey: string, env: Env): Promise<FilingCacheRecord | null> {
  const [extractorVersion, cik, accession] = filingKey.split(":");
  if (!extractorVersion || !cik || !accession) {
    return null;
  }

  const cacheKey = buildCacheKey(extractorVersion, cik, accession);
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

export async function loadCachedLatestFiling(
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
