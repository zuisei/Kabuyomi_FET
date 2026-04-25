import type { Env } from "../env";
import { logWarnEvent } from "./logging";

const SEARCH_FORM_TYPE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface SearchFormTypeRow {
  ticker: string;
  latestFormType: string | null;
}

export async function loadSearchFormTypeCache(
  tickers: readonly string[],
  env: Partial<Env>,
  now: Date = new Date()
): Promise<Map<string, string | null>> {
  const normalized = normalizeTickers(tickers);
  if (normalized.length === 0 || !hasD1(env)) {
    return new Map();
  }

  try {
    const placeholders = normalized.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `SELECT ticker, latest_form_type AS latestFormType
       FROM search_form_type_cache
       WHERE ticker IN (${placeholders}) AND expires_at > ?`
    )
      .bind(...normalized, now.toISOString())
      .all<SearchFormTypeRow>();

    return new Map((result.results ?? []).map((row) => [row.ticker, row.latestFormType]));
  } catch (error) {
    logWarnEvent("metadata_cache_d1_read_failed", {
      component: "metadata-cache",
      operation: "read",
      tickerCount: normalized.length,
      reason: error instanceof Error ? error.message : String(error)
    });
    return new Map();
  }
}

export async function upsertSearchFormTypeCache(
  ticker: string,
  latestFormType: string | null,
  env: Partial<Env>,
  now: Date = new Date()
): Promise<void> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker || !hasD1(env)) {
    return;
  }

  try {
    const updatedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + SEARCH_FORM_TYPE_CACHE_TTL_MS).toISOString();
    await env.DB.prepare(
      `INSERT INTO search_form_type_cache (ticker, latest_form_type, expires_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ticker) DO UPDATE SET
         latest_form_type = excluded.latest_form_type,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    )
      .bind(normalizedTicker, latestFormType, expiresAt, updatedAt)
      .run();
  } catch (error) {
    logWarnEvent("metadata_cache_d1_write_failed", {
      component: "metadata-cache",
      operation: "write",
      ticker: normalizedTicker,
      latestFormType,
      reason: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

function hasD1(env: Partial<Env>): env is Env & { DB: D1Database } {
  return typeof env.DB?.prepare === "function";
}

function normalizeTickers(tickers: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const ticker of tickers) {
    const value = normalizeTicker(ticker);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}
