import type { Env, FilingCacheRecord } from "../../env";
import { loadArchivedFilingByKey } from "../history-store";
import type { RemoteConfig } from "../remote-config";

export function buildCacheKey(extractorVersion: string, cik: string, accessionNumber: string): string {
  return `filing_cache:${extractorVersion}:${cik}:${accessionNumber.replaceAll("-", "")}`;
}

export function buildTickerAliasKey(extractorVersion: string, ticker: string): string {
  return `latest_filing_by_ticker:${extractorVersion}:${ticker.toUpperCase()}`;
}

export function buildTickerAliasKeys(extractorVersion: string, ticker: string): string[] {
  return classTickerVariants(ticker).map((variant) => buildTickerAliasKey(extractorVersion, variant));
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
  for (const aliasKey of buildTickerAliasKeys(config.extractorVersion, ticker)) {
    const filingKey = await env.KABUYOMI_CACHE.get(aliasKey);
    if (!filingKey) {
      continue;
    }

    const record = await loadFilingByKey(filingKey, env);
    if (record) {
      return record;
    }
  }

  return null;
}

function classTickerVariants(ticker: string): string[] {
  const normalized = ticker.trim().toUpperCase().replace(/\s+/g, " ");
  const match = normalized.match(/^([A-Z0-9]+)[.\-\s]+([A-Z0-9]+)$/);
  if (!match?.[1] || !match[2]) {
    return [normalized];
  }

  return [...new Set([`${match[1]}-${match[2]}`, `${match[1]}.${match[2]}`, `${match[1]} ${match[2]}`])];
}
