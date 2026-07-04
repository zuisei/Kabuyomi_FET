import type { Env, FilingCacheRecord } from "../../env";
import { loadArchivedFilingByKey } from "../history-store";
import type { RemoteConfig } from "../remote-config";
import { upsertSearchFormTypeCache } from "../search-form-type-cache";
import {
  buildTickerAliasKey,
  buildTickerAliasKeys,
  buildTickerAliasTickers,
  loadLatestFilingAliasFromD1,
  upsertLatestFilingAliases
} from "./latest-alias-store";

export { buildTickerAliasKey, buildTickerAliasKeys };

export function buildCacheKey(extractorVersion: string, cik: string, accessionNumber: string): string {
  return `filing_cache:${extractorVersion}:${cik}:${accessionNumber.replaceAll("-", "")}`;
}

export function isCurrentCacheRecord(record: FilingCacheRecord, config: RemoteConfig): boolean {
  return record.extractorVersion === config.extractorVersion &&
    record.promptVersion === config.promptVersion &&
    !looksLikeAmendedAnnualOrQuarterlyRecord(record);
}

export async function loadFilingByKey(filingKey: string, env: Env): Promise<FilingCacheRecord | null> {
  const [extractorVersion, cik, accession] = filingKey.split(":");
  if (!extractorVersion || !cik || !accession) {
    return null;
  }

  return loadArchivedFilingByKey(filingKey, env);
}

export async function loadCachedLatestFiling(
  ticker: string,
  env: Env,
  config: RemoteConfig
): Promise<FilingCacheRecord | null> {
  for (const aliasTicker of buildTickerAliasTickers(ticker)) {
    const d1FilingKey = await loadLatestFilingAliasFromD1(config.extractorVersion, aliasTicker, env);
    if (d1FilingKey) {
      const record = await loadFilingByKey(d1FilingKey, env);
      if (record) {
        return record;
      }
    }

    const aliasKey = buildTickerAliasKey(config.extractorVersion, aliasTicker);
    const filingKey = await env.KABUYOMI_CACHE.get(aliasKey);
    if (!filingKey) {
      continue;
    }

    const record = await loadFilingByKey(filingKey, env);
    if (record) {
      await cacheLatestFilingMetadata(config.extractorVersion, aliasTicker, filingKey, record.formType, env);
      return record;
    }
  }

  return null;
}

export async function cacheLatestFilingMetadata(
  extractorVersion: string,
  ticker: string,
  filingKey: string,
  latestFormType: string | null,
  env: Env
): Promise<void> {
  await Promise.all([
    upsertLatestFilingAliases(extractorVersion, ticker, filingKey, env),
    latestFormType ? upsertSearchFormTypeCache(ticker, latestFormType, env) : Promise.resolve()
  ]);
}

function looksLikeAmendedAnnualOrQuarterlyRecord(record: FilingCacheRecord): boolean {
  const documentName = (() => {
    try {
      return new URL(record.primaryDocumentUrl).pathname.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
    } catch {
      return record.primaryDocumentUrl.toLowerCase();
    }
  })();

  return /(?:^|[-_])(10k|10q)a(?:[-_.]|$)/i.test(documentName) ||
    /(?:^|[-_])10-[kq]a(?:[-_.]|$)/i.test(documentName);
}
