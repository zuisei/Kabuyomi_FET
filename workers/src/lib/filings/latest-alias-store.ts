import type { Env } from "../../env";
import { logWarnEvent } from "../logging";

interface LatestFilingAliasRow {
  filingKey: string;
}

export function buildTickerAliasKey(extractorVersion: string, ticker: string): string {
  return `latest_filing_by_ticker:${extractorVersion}:${ticker.toUpperCase()}`;
}

export function buildTickerAliasKeys(extractorVersion: string, ticker: string): string[] {
  return buildTickerAliasTickers(ticker).map((variant) => buildTickerAliasKey(extractorVersion, variant));
}

export function buildTickerAliasTickers(ticker: string): string[] {
  const normalized = ticker.trim().toUpperCase().replace(/\s+/g, " ");
  const match = normalized.match(/^([A-Z0-9]+)[.\-\s]+([A-Z0-9]+)$/);
  if (!match?.[1] || !match[2]) {
    return [normalized];
  }

  return [...new Set([`${match[1]}-${match[2]}`, `${match[1]}.${match[2]}`, `${match[1]} ${match[2]}`])];
}

export async function loadLatestFilingAliasFromD1(
  extractorVersion: string,
  ticker: string,
  env: Partial<Env>
): Promise<string | null> {
  if (!hasD1(env)) {
    return null;
  }

  let row: LatestFilingAliasRow | null;
  try {
    row = await env.DB.prepare(
      `SELECT filing_key AS filingKey
       FROM latest_filing_aliases
       WHERE extractor_version = ? AND ticker = ?
       LIMIT 1`
    )
      .bind(extractorVersion, ticker.trim().toUpperCase())
      .first<LatestFilingAliasRow>();
  } catch (error) {
    logWarnEvent("latest_alias_d1_read_failed", {
      component: "latest-alias",
      operation: "read",
      extractorVersion,
      ticker: ticker.trim().toUpperCase(),
      reason: error instanceof Error ? error.message : String(error)
    });
    return null;
  }

  return row?.filingKey ?? null;
}

export async function upsertLatestFilingAliases(
  extractorVersion: string,
  ticker: string,
  filingKey: string,
  env: Partial<Env>
): Promise<void> {
  if (!hasD1(env)) {
    return;
  }

  try {
    const updatedAt = new Date().toISOString();
    const statements = buildTickerAliasTickers(ticker).map((aliasTicker) =>
      env.DB.prepare(
        `INSERT INTO latest_filing_aliases (extractor_version, ticker, filing_key, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(extractor_version, ticker) DO UPDATE SET
           filing_key = excluded.filing_key,
           updated_at = excluded.updated_at`
      ).bind(extractorVersion, aliasTicker, filingKey, updatedAt)
    );
    await env.DB.batch(statements);
  } catch (error) {
    logWarnEvent("latest_alias_d1_write_failed", {
      component: "latest-alias",
      operation: "write",
      extractorVersion,
      ticker: ticker.trim().toUpperCase(),
      filingKey,
      reason: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

function hasD1(env: Partial<Env>): env is Env & { DB: D1Database } {
  return typeof env.DB?.prepare === "function" && typeof env.DB?.batch === "function";
}
