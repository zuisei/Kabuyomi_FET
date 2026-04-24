import { listTickersByCik, lookupTicker } from "../clients/sec";
import type { Env } from "../env";

export const MAX_TRACKED_TICKERS = 30;
const DEFAULT_BATCH_SIZE = MAX_TRACKED_TICKERS;
const DEFAULT_CONCURRENCY = 4;
const MAX_BATCH_SIZE = MAX_TRACKED_TICKERS;
const MAX_CONCURRENCY = 8;

export const DEFAULT_TRACKED_TICKERS = [
  "NVDA",
  "GOOG",
  "AAPL",
  "MSFT",
  "AMZN",
  "AVGO",
  "META",
  "TSLA",
  "BRK-B",
  "WMT",
  "JPM",
  "LLY",
  "V",
  "XOM",
  "JNJ",
  "MU",
  "ORCL",
  "MA",
  "AMD",
  "COST",
  "NFLX",
  "BAC",
  "CAT",
  "ABBV",
  "CVX",
  "PLTR",
  "HD",
  "INTC",
  "PG",
  "CSCO"
] as const;

const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;

export interface TrackedTickerSettings {
  trackedTickers?: string[];
  dailyRefreshBatchSize?: number;
  dailyRefreshConcurrency?: number;
}

export function normalizeTrackedTickers(values: readonly unknown[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const ticker = value.trim().toUpperCase();
    if (!ticker || !TICKER_PATTERN.test(ticker) || seen.has(ticker)) {
      continue;
    }

    seen.add(ticker);
    normalized.push(ticker);
  }

  return normalized;
}

export function resolveTrackedTickers(settings: TrackedTickerSettings): string[] {
  const configured = normalizeTrackedTickers(settings.trackedTickers ?? []);
  const source = (configured.length > 0 ? configured : [...DEFAULT_TRACKED_TICKERS]).slice(0, MAX_TRACKED_TICKERS);
  return source.slice(0, resolveDailyRefreshBatchSize(settings.dailyRefreshBatchSize, source.length));
}

export async function resolveTrackedTickersForExecution(
  settings: TrackedTickerSettings,
  env: Env
): Promise<string[]> {
  const source = resolveTrackedTickers(settings);
  const resolved: string[] = [];
  const seenIssuerKeys = new Set<string>();

  for (const rawTicker of source) {
    const tickerRecord = await lookupTicker(rawTicker, env);
    if (!tickerRecord) {
      if (!seenIssuerKeys.has(rawTicker)) {
        seenIssuerKeys.add(rawTicker);
        resolved.push(rawTicker);
      }
      continue;
    }

    const issuerKey = tickerRecord.cik.trim() || tickerRecord.ticker;
    if (seenIssuerKeys.has(issuerKey)) {
      continue;
    }

    seenIssuerKeys.add(issuerKey);
    const aliases = await listTickersByCik(tickerRecord.cik, env);
    resolved.push(selectTrackedTickerRepresentative(aliases.length > 0 ? aliases : [tickerRecord.ticker]));
  }

  return resolved;
}

export function selectTrackedTickerRepresentative(values: readonly string[]): string {
  const candidates = normalizeTrackedTickers(values);
  if (candidates.length === 0) {
    throw new Error("No tracked ticker candidates");
  }

  return [...candidates].sort(compareTrackedTickerRepresentatives)[0]!;
}

export function resolveDailyRefreshBatchSize(rawValue: unknown, fallback = DEFAULT_BATCH_SIZE): number {
  return clampPositiveInteger(rawValue, fallback, MAX_BATCH_SIZE);
}

export function resolveDailyRefreshConcurrency(rawValue: unknown, fallback = DEFAULT_CONCURRENCY): number {
  return clampPositiveInteger(rawValue, fallback, MAX_CONCURRENCY);
}

function clampPositiveInteger(rawValue: unknown, fallback: number, max: number): number {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return fallback;
  }

  const normalized = Math.trunc(rawValue);
  if (normalized <= 0) {
    return fallback;
  }

  return Math.min(normalized, max);
}

function compareTrackedTickerRepresentatives(left: string, right: string): number {
  const punctuationDelta = punctuationCount(left) - punctuationCount(right);
  if (punctuationDelta !== 0) {
    return punctuationDelta;
  }

  const lengthDelta = left.length - right.length;
  if (lengthDelta !== 0) {
    return lengthDelta;
  }

  return left.localeCompare(right);
}

function punctuationCount(value: string): number {
  return (value.match(/[.-]/g) ?? []).length;
}
