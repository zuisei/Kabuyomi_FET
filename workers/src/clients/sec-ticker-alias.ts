import type { TickerRecord } from "../env";

export function normalizeTickerInput(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeClassTickerAlias(value: string): string | null {
  const parsed = parseTickerAliasInput(value);
  if (!parsed) {
    return null;
  }

  return `${parsed.baseTicker}.${parsed.suffix}`;
}

export function matchesClassTickerAlias(input: string, candidateTicker: string): boolean {
  const inputAlias = normalizeClassTickerAlias(input);
  const candidateAlias = normalizeClassTickerAlias(candidateTicker);
  return Boolean(inputAlias && candidateAlias && inputAlias === candidateAlias);
}

export function matchesCompactTickerAlias(input: string, candidateTicker: string): boolean {
  const parsed = parseTickerAliasInput(input);
  if (!parsed) {
    return false;
  }

  return normalizeCompactTicker(candidateTicker) === parsed.compactTicker;
}

export function resolveBaseTickerFallback(input: string, items: TickerRecord[]): TickerRecord | null {
  const baseTicker = normalizeSeriesBaseTickerFallback(input);
  if (!baseTicker) {
    return null;
  }

  return items.find((item) => normalizeTickerInput(item.ticker) === baseTicker) ?? null;
}

export function normalizeCompactTicker(value: string): string {
  return normalizeTickerInput(value).replace(/[.\-\s]+/g, "");
}

export function parseTickerAliasInput(value: string): { baseTicker: string; suffix: string; compactTicker: string } | null {
  const normalized = normalizeTickerInput(value);
  const match = normalized.match(/^([A-Z0-9]+)[.\-\s]+([A-Z0-9]+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    baseTicker: match[1],
    suffix: match[2],
    compactTicker: `${match[1]}${match[2]}`
  };
}

function normalizeSeriesBaseTickerFallback(value: string): string | null {
  const parsed = parseTickerAliasInput(value);
  return parsed?.baseTicker ?? null;
}
