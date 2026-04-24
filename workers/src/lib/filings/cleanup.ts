import type { Env } from "../../env";
import { AppError } from "../errors";
import { buildArchiveObjectKey } from "../history-store";
import type { RemoteConfig } from "../remote-config";
import { buildCacheKey, buildTickerAliasKeys } from "./cache";

export interface CleanupFilingsRequest {
  execute: boolean;
  targetVersions?: string[];
  tickers?: string[];
  maxFilings: number;
  maxKvKeys: number;
  includeUnshadowed: boolean;
  onlyDisagreeingMetrics: boolean;
}

export interface CleanupFilingCandidate {
  filingKey: string;
  ticker: string;
  cik: string;
  accession: string;
  formType: string;
  periodOfReport: string;
  version: string;
  hasCurrentVersion: boolean;
  hasMetricDisagreement: boolean;
  r2ObjectKey: string;
  kvCacheKey: string;
}

export interface CleanupFilingsResult {
  dryRun: boolean;
  currentExtractorVersion: string;
  targetVersions: string[];
  selection: {
    tickers?: string[];
    includeUnshadowed: boolean;
    onlyDisagreeingMetrics: boolean;
    maxFilings: number;
    maxKvKeys: number;
  };
  candidates: CleanupFilingCandidate[];
  kvKeys: string[];
  warnings: string[];
  deleted: {
    d1Filings: number;
    r2Objects: number;
    kvKeys: number;
  };
}

interface CleanupCandidateRow {
  filingKey: string;
  ticker: string;
  cik: string;
  accession: string;
  formType: string;
  periodOfReport: string;
  version: string;
  hasCurrentVersion: number;
  hasMetricDisagreement: number;
}

export async function cleanupFilingStorage(
  request: CleanupFilingsRequest,
  env: Env,
  config: RemoteConfig
): Promise<CleanupFilingsResult> {
  const currentExtractorVersion = normalizeExtractorVersion(config.extractorVersion);
  const targetVersions = resolveTargetVersions(request.targetVersions, currentExtractorVersion);
  const tickers = normalizeTickers(request.tickers ?? []);
  const candidates = await listCleanupCandidates(request, env, currentExtractorVersion, targetVersions, tickers);
  const kvKeys = listCleanupKvKeys(candidates, request.maxKvKeys);
  const warnings = buildCleanupWarnings(candidates, kvKeys, request);

  const result: CleanupFilingsResult = {
    dryRun: !request.execute,
    currentExtractorVersion,
    targetVersions,
    selection: {
      tickers: tickers.length > 0 ? tickers : undefined,
      includeUnshadowed: request.includeUnshadowed,
      onlyDisagreeingMetrics: request.onlyDisagreeingMetrics,
      maxFilings: request.maxFilings,
      maxKvKeys: request.maxKvKeys
    },
    candidates,
    kvKeys,
    warnings,
    deleted: {
      d1Filings: 0,
      r2Objects: 0,
      kvKeys: 0
    }
  };

  if (!request.execute) {
    return result;
  }

  result.deleted.d1Filings = await deleteHistoryRows(candidates, env);
  result.deleted.r2Objects = await deleteArchivedObjects(candidates, env);
  result.deleted.kvKeys = await deleteKvKeys(kvKeys, env);
  return result;
}

async function listCleanupCandidates(
  request: CleanupFilingsRequest,
  env: Env,
  currentExtractorVersion: string,
  targetVersions: string[],
  tickers: string[]
): Promise<CleanupFilingCandidate[]> {
  if (targetVersions.length === 0) {
    return [];
  }

  const versionPlaceholders = targetVersions.map(() => "?").join(", ");
  const tickerFilter = tickers.length > 0 ? `AND old.ticker IN (${tickers.map(() => "?").join(", ")})` : "";
  const result = await env.DB.prepare(
    `SELECT
      old.filing_key AS filingKey,
      old.ticker AS ticker,
      old.cik AS cik,
      old.accession AS accession,
      old.form_type AS formType,
      old.period_of_report AS periodOfReport,
      substr(old.filing_key, 1, instr(old.filing_key, ':') - 1) AS version,
      EXISTS (
        SELECT 1 FROM filings current
        WHERE substr(current.filing_key, 1, instr(current.filing_key, ':') - 1) = ?
          AND current.cik = old.cik
          AND current.accession = old.accession
      ) AS hasCurrentVersion,
      EXISTS (
        SELECT 1
        FROM metric_history old_metric
        JOIN filings current ON current.cik = old.cik AND current.accession = old.accession
        JOIN metric_history current_metric
          ON current_metric.filing_key = current.filing_key
          AND current_metric.logical_name = old_metric.logical_name
        WHERE old_metric.filing_key = old.filing_key
          AND substr(current.filing_key, 1, instr(current.filing_key, ':') - 1) = ?
          AND current_metric.value <> old_metric.value
      ) AS hasMetricDisagreement
    FROM filings old
    WHERE substr(old.filing_key, 1, instr(old.filing_key, ':') - 1) IN (${versionPlaceholders})
      ${tickerFilter}
      AND (
        ? = 1
        OR EXISTS (
          SELECT 1 FROM filings current
          WHERE substr(current.filing_key, 1, instr(current.filing_key, ':') - 1) = ?
            AND current.cik = old.cik
            AND current.accession = old.accession
        )
      )
      AND (
        ? = 0
        OR EXISTS (
          SELECT 1
          FROM metric_history old_metric
          JOIN filings current ON current.cik = old.cik AND current.accession = old.accession
          JOIN metric_history current_metric
            ON current_metric.filing_key = current.filing_key
            AND current_metric.logical_name = old_metric.logical_name
          WHERE old_metric.filing_key = old.filing_key
            AND substr(current.filing_key, 1, instr(current.filing_key, ':') - 1) = ?
            AND current_metric.value <> old_metric.value
        )
      )
    ORDER BY hasMetricDisagreement DESC, old.ticker ASC, old.period_of_report DESC, old.filing_key ASC
    LIMIT ?`
  )
    .bind(
      currentExtractorVersion,
      currentExtractorVersion,
      ...targetVersions,
      ...tickers,
      request.includeUnshadowed ? 1 : 0,
      currentExtractorVersion,
      request.onlyDisagreeingMetrics ? 1 : 0,
      currentExtractorVersion,
      request.maxFilings
    )
    .all<CleanupCandidateRow>();

  return (result.results ?? []).map((row) => ({
    filingKey: row.filingKey,
    ticker: row.ticker,
    cik: row.cik,
    accession: row.accession,
    formType: row.formType,
    periodOfReport: row.periodOfReport,
    version: row.version,
    hasCurrentVersion: Boolean(row.hasCurrentVersion),
    hasMetricDisagreement: Boolean(row.hasMetricDisagreement),
    r2ObjectKey: buildArchiveObjectKey(row.filingKey),
    kvCacheKey: buildKvCacheKey(row.filingKey)
  }));
}

function listCleanupKvKeys(candidates: CleanupFilingCandidate[], maxKvKeys: number): string[] {
  if (maxKvKeys <= 0 || candidates.length === 0) {
    return [];
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const candidateKeys = [
      candidate.kvCacheKey,
      ...buildTickerAliasKeys(candidate.version, candidate.ticker)
    ];

    for (const key of candidateKeys) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      keys.push(key);
      if (keys.length >= maxKvKeys) {
        return keys;
      }
    }
  }

  return keys;
}

async function deleteHistoryRows(candidates: CleanupFilingCandidate[], env: Env): Promise<number> {
  if (candidates.length === 0) {
    return 0;
  }

  const statements = candidates.flatMap((candidate) => [
    env.DB.prepare("DELETE FROM metric_history WHERE filing_key = ?").bind(candidate.filingKey),
    env.DB.prepare("DELETE FROM segment_highlights WHERE filing_key = ?").bind(candidate.filingKey),
    env.DB.prepare("DELETE FROM filings WHERE filing_key = ?").bind(candidate.filingKey)
  ]);
  await env.DB.batch(statements);
  return candidates.length;
}

async function deleteArchivedObjects(candidates: CleanupFilingCandidate[], env: Env): Promise<number> {
  let deleted = 0;
  for (const candidate of candidates) {
    await env.FILINGS_BUCKET.delete(candidate.r2ObjectKey);
    deleted += 1;
  }
  return deleted;
}

async function deleteKvKeys(keys: string[], env: Env): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    await env.KABUYOMI_CACHE.delete(key);
    deleted += 1;
  }
  return deleted;
}

function resolveTargetVersions(requestedVersions: string[] | undefined, currentExtractorVersion: string): string[] {
  const versions = requestedVersions?.length ? requestedVersions.map(normalizeExtractorVersion) : previousExtractorVersions(currentExtractorVersion);
  const uniqueVersions = Array.from(new Set(versions));
  if (uniqueVersions.includes(currentExtractorVersion)) {
    throw new AppError(400, "Cleanup targetVersions must not include the current extractor version");
  }
  return uniqueVersions;
}

function previousExtractorVersions(currentExtractorVersion: string): string[] {
  const match = currentExtractorVersion.match(/^v(\d+)$/);
  if (!match?.[1]) {
    return [];
  }

  const currentNumber = Number.parseInt(match[1], 10);
  if (!Number.isFinite(currentNumber) || currentNumber <= 1) {
    return [];
  }

  return Array.from({ length: currentNumber - 1 }, (_, index) => `v${index + 1}`);
}

function normalizeExtractorVersion(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTickers(tickers: string[]): string[] {
  return Array.from(new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)));
}

function buildKvCacheKey(filingKey: string): string {
  const [version, cik, accession] = filingKey.split(":");
  return buildCacheKey(version ?? "", cik ?? "", accession ?? "");
}

function buildCleanupWarnings(
  candidates: CleanupFilingCandidate[],
  kvKeys: string[],
  request: CleanupFilingsRequest
): string[] {
  const warnings: string[] = [];
  if (!request.execute) {
    warnings.push("dry-run only; no KV, D1, or R2 entries were deleted");
  }
  if (!request.includeUnshadowed) {
    warnings.push("unshadowed old D1 filing rows are preserved; only rows with a current-version replacement are candidates");
  }
  if (candidates.length >= request.maxFilings) {
    warnings.push("candidate filing list reached maxFilings; rerun with a higher cap or a narrower ticker set");
  }
  if (kvKeys.length >= request.maxKvKeys && request.maxKvKeys > 0) {
    warnings.push("KV key list reached maxKvKeys; rerun with a higher cap if needed");
  }
  return warnings;
}
