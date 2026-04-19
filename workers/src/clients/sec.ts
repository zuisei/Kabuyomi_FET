import type { Env, FilingReference, MetricSnapshot, TickerRecord } from "../env";
import {
  fetchFilingAssetsFromFetcher,
  fetchFilingHtmlFromFetcher,
  fetchMetricsFromFetcher,
  fetchSubmissionsFromFetcher,
  fetchTickerSnapshotFromFetcher
} from "./sec-fetcher";

const METRIC_TAGS = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet"
  ],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  epsBasic: ["EarningsPerShareBasic"],
  operatingIncome: ["OperatingIncomeLoss"],
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
  ]
} as const;

type MetricName = keyof typeof METRIC_TAGS;

interface SubmissionRecent {
  form: string[];
  accessionNumber: string[];
  primaryDocument: string[];
  filingDate: string[];
  reportDate: string[];
}

export interface SubmissionResponse {
  name: string;
  filings: {
    recent: SubmissionRecent;
  };
}

export interface ConceptFact {
  val: number;
  start?: string;
  filed?: string;
  end?: string;
  form?: string;
  accn?: string;
}

export interface ConceptResponse {
  units?: Record<string, ConceptFact[]>;
}

export interface CompanyFactsResponse {
  facts?: Record<string, Record<string, ConceptResponse>>;
}

export interface FilingHtmlResponse {
  html: string;
  primaryDocumentUrl: string;
}

export interface TickerSnapshotEnvelope {
  updatedAt?: string;
  items?: TickerRecord[];
  fields?: string[];
  data?: unknown[][];
}

export async function searchTickers(query: string, env: Env): Promise<{ items: TickerRecord[]; updatedAt: string | null }> {
  const snapshot = await getTickerSnapshot(env);
  const normalizedQuery = query.trim();
  const rankedItems = sortTickerSearchResults(snapshot.items, normalizedQuery).slice(0, 20);
  const items = await enrichTickerSearchResults(rankedItems, normalizedQuery, env);

  return {
    items,
    updatedAt: snapshot.updatedAt
  };
}

export function sortTickerSearchResults(items: TickerRecord[], normalizedQuery: string): TickerRecord[] {
  return items
    .map((item) => ({
      item,
      score: scoreTickerSearch(item, normalizedQuery)
    }))
    .filter((candidate): candidate is { item: TickerRecord; score: number } => candidate.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      if (left.item.ticker.length !== right.item.ticker.length) {
        return left.item.ticker.length - right.item.ticker.length;
      }

      return left.item.ticker.localeCompare(right.item.ticker);
    })
    .map((candidate) => candidate.item);
}

const SEARCH_FORM_TYPE_CACHE_TTL_SECONDS = 24 * 60 * 60;
const SEARCH_FORM_TYPE_NEGATIVE_SENTINEL = "__none__";
const SEARCH_FORM_TYPE_HYDRATE_LIMIT = 5;

async function enrichTickerSearchResults(
  items: TickerRecord[],
  _normalizedQuery: string,
  env: Env
): Promise<TickerRecord[]> {
  const cachedFormTypes = await Promise.all(items.map((item) => loadCachedLatestFormType(item.ticker, env)));
  const hydrated = items.map((item, index) => {
    const cachedFormType = cachedFormTypes[index];
    if (cachedFormType === undefined || cachedFormType === null) {
      return item;
    }

    return {
      ...item,
      latestFormType: cachedFormType
    };
  });

  const unresolved = hydrated
    .filter((item, index) => item.latestFormType === undefined && cachedFormTypes[index] === undefined)
    .slice(0, SEARCH_FORM_TYPE_HYDRATE_LIMIT);
  if (unresolved.length === 0) {
    return hydrated;
  }

  try {
    const resolved = await Promise.all(
      unresolved.map(async (item) => ({
        ticker: item.ticker,
        latestFormType: await fetchAndCacheLatestFormType(item, env)
      }))
    );
    const byTicker = new Map(resolved.map((entry) => [entry.ticker, entry.latestFormType] as const));

    return hydrated.map((item) =>
      byTicker.has(item.ticker)
        ? {
            ...item,
            latestFormType: byTicker.get(item.ticker) ?? undefined
          }
        : item
    );
  } catch {
    return hydrated;
  }
}

async function loadCachedLatestFormType(
  ticker: string,
  env: Env
): Promise<string | null | undefined> {
  const cached = await env.KABUYOMI_CACHE.get(buildSearchFormTypeCacheKey(ticker));
  if (!cached) {
    return undefined;
  }

  if (cached === SEARCH_FORM_TYPE_NEGATIVE_SENTINEL) {
    return null;
  }

  return cached;
}

async function fetchAndCacheLatestFormType(
  item: TickerRecord,
  env: Env
): Promise<string | null> {
  const submissions = await fetchSubmissions(item.cik, env);
  const latestFiling = pickLatestSupportedFiling(item, submissions);
  const latestFormType = latestFiling?.formType ?? normalizeLatestRawForm(submissions.filings.recent.form);
  await env.KABUYOMI_CACHE.put(
    buildSearchFormTypeCacheKey(item.ticker),
    latestFormType ?? SEARCH_FORM_TYPE_NEGATIVE_SENTINEL,
    { expirationTtl: SEARCH_FORM_TYPE_CACHE_TTL_SECONDS }
  );
  return latestFormType;
}

function buildSearchFormTypeCacheKey(ticker: string): string {
  return `search_latest_form_type:${ticker.trim().toUpperCase()}`;
}

function normalizeLatestRawForm(forms: readonly string[]): string | null {
  const raw = forms.find((form) => typeof form === "string" && form.trim().length > 0);
  const normalized = raw?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function scoreTickerSearch(item: TickerRecord, query: string): number | null {
  const normalizedQuery = query.trim();
  const lowerQuery = normalizedQuery.toLowerCase();
  const ticker = item.ticker.toLowerCase();
  const companyName = item.companyName.toLowerCase();
  const queryAlias = normalizeClassTickerAlias(normalizedQuery);
  const tickerAlias = normalizeClassTickerAlias(item.ticker);

  if (ticker === lowerQuery) {
    return 0;
  }

  if (queryAlias && tickerAlias === queryAlias) {
    return 1;
  }

  if (ticker.startsWith(lowerQuery)) {
    return 2;
  }

  if (queryAlias && tickerAlias?.startsWith(queryAlias)) {
    return 3;
  }

  if (companyName === lowerQuery) {
    return 4;
  }

  if (companyName.startsWith(lowerQuery)) {
    return 5;
  }

  if (ticker.includes(lowerQuery)) {
    return 6;
  }

  if (queryAlias && tickerAlias?.includes(queryAlias)) {
    return 7;
  }

  if (companyName.includes(lowerQuery)) {
    return 8;
  }

  return null;
}

export async function refreshTickerSnapshot(env: Env): Promise<void> {
  const payload = await fetchTickerSnapshotFromFetcher(env);
  const snapshot = normalizeTickerSnapshot(payload, new Date().toISOString());
  await env.KABUYOMI_CACHE.put("tickers_snapshot", JSON.stringify(snapshot));
}

export async function lookupTicker(ticker: string, env: Env): Promise<TickerRecord | null> {
  const normalizedTicker = normalizeTickerInput(ticker);
  if (!normalizedTicker) {
    return null;
  }

  const snapshot = await getTickerSnapshot(env);
  const exactMatch = snapshot.items.find((item) => normalizeTickerInput(item.ticker) === normalizedTicker);
  if (exactMatch) {
    return exactMatch;
  }

  const aliasMatch = snapshot.items.find((item) => matchesClassTickerAlias(normalizedTicker, item.ticker));
  return aliasMatch ?? null;
}

export async function fetchSubmissions(cik: string, env: Env): Promise<SubmissionResponse> {
  return fetchSubmissionsFromFetcher(cik, env);
}

export function pickLatestSupportedFiling(
  tickerRecord: TickerRecord,
  submissions: SubmissionResponse
): FilingReference | null {
  const recent = submissions.filings.recent;

  for (let index = 0; index < recent.form.length; index += 1) {
    const rawForm = recent.form[index];
    const formType = normalizeForm(rawForm);
    if (!formType) {
      continue;
    }

    return {
      cik: tickerRecord.cik,
      ticker: tickerRecord.ticker,
      companyName: tickerRecord.companyName,
      exchange: tickerRecord.exchange,
      formType,
      accessionNumber: recent.accessionNumber[index],
      primaryDocument: recent.primaryDocument[index],
      filedAt: recent.filingDate[index],
      periodOfReport: recent.reportDate[index] ?? recent.filingDate[index]
    };
  }

  return null;
}

export function pickComparisonFiling(
  tickerRecord: TickerRecord,
  submissions: SubmissionResponse,
  current: FilingReference
): FilingReference | null {
  const candidates = allSupportedFilings(tickerRecord, submissions).filter((item) => {
    return item.accessionNumber !== current.accessionNumber && item.formType === current.formType;
  });

  if (current.formType === "10-K") {
    return candidates.find((item) => item.periodOfReport < current.periodOfReport) ?? null;
  }

  const targetDate = new Date(current.periodOfReport);
  const approxPriorYear = new Date(targetDate);
  approxPriorYear.setUTCFullYear(targetDate.getUTCFullYear() - 1);

  const sorted = candidates
    .map((item) => ({
      filing: item,
      distance: Math.abs(new Date(item.periodOfReport).getTime() - approxPriorYear.getTime())
    }))
    .sort((left, right) => left.distance - right.distance);

  return sorted[0]?.filing ?? null;
}

export function listSupportedFilings(tickerRecord: TickerRecord, submissions: SubmissionResponse): FilingReference[] {
  return allSupportedFilings(tickerRecord, submissions);
}

export function buildFilingKey(extractorVersion: string, filing: FilingReference): string {
  return `${extractorVersion}:${filing.cik}:${accessionWithoutDashes(filing.accessionNumber)}`;
}

export function buildPrimaryDocumentUrl(filing: FilingReference): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(filing.cik)}/${accessionWithoutDashes(
    filing.accessionNumber
  )}/${filing.primaryDocument}`;
}

export async function fetchFilingHtml(filing: FilingReference, env: Env): Promise<string> {
  const response = await fetchFilingHtmlFromFetcher(filing, env);
  return response.html;
}

export async function fetchMetricSnapshots(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env
): Promise<MetricSnapshot[]> {
  const fetcherPayload = await fetchMetricsFromFetcher(
    filing.cik,
    [...new Set(Object.values(METRIC_TAGS).flat())],
    env
  );
  return buildMetricSnapshotsFromFetcherPayload(filing, comparisonFiling, fetcherPayload);
}

export async function fetchFilingAssets(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env
): Promise<FilingHtmlResponse & { metrics: MetricSnapshot[] }> {
  const fetcherPayload = await fetchFilingAssetsFromFetcher(
    filing,
    [...new Set(Object.values(METRIC_TAGS).flat())],
    env
  );
  return {
    html: fetcherPayload.html,
    primaryDocumentUrl: fetcherPayload.primaryDocumentUrl,
    metrics: buildMetricSnapshotsFromFetcherPayload(filing, comparisonFiling, fetcherPayload)
  };
}

function buildMetricSnapshotsFromFetcherPayload(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  fetcherPayload: {
    concepts: Record<string, ConceptResponse | null>;
    companyFacts: CompanyFactsResponse | null;
  }
): MetricSnapshot[] {
  const results: MetricSnapshot[] = [];

  for (const logicalName of Object.keys(METRIC_TAGS) as MetricName[]) {
    const current = resolveFact(logicalName, filing, fetcherPayload.concepts, fetcherPayload.companyFacts);

    if (!current) {
      continue;
    }

    const comparison = comparisonFiling
      ? resolveFact(logicalName, comparisonFiling, fetcherPayload.concepts, fetcherPayload.companyFacts)
      : null;

    results.push({
      logicalName,
      tagUsed: current.tagUsed,
      value: current.fact.val,
      unit: current.unit,
      periodEnd: current.fact.end ?? filing.periodOfReport,
      comparisonValue: comparison?.fact.val,
      yoyPercent:
        comparison && comparison.fact.val !== 0
          ? ((current.fact.val - comparison.fact.val) / Math.abs(comparison.fact.val)) * 100
          : undefined
    });
  }

  return results;
}

function resolveFact(
  logicalName: MetricName,
  filing: FilingReference,
  concepts: Record<string, ConceptResponse | null>,
  companyFacts: CompanyFactsResponse | null
): { tagUsed: string; unit: string; fact: ConceptFact } | null {
  for (const tag of METRIC_TAGS[logicalName]) {
    const concept = concepts[tag] ?? null;
    const fact = selectBestFact(concept?.units, filing, logicalName === "epsBasic");
    if (fact) {
      return { tagUsed: tag, unit: fact.unit, fact: fact.fact };
    }
  }

  const usGaap = companyFacts?.facts?.["us-gaap"] ?? {};

  for (const tag of METRIC_TAGS[logicalName]) {
    const concept = usGaap[tag];
    const fact = selectBestFact(concept?.units, filing, logicalName === "epsBasic");
    if (fact) {
      return { tagUsed: tag, unit: fact.unit, fact: fact.fact };
    }
  }

  return null;
}
function selectBestFact(
  units: Record<string, ConceptFact[]> | undefined,
  filing: FilingReference,
  isEPS: boolean
): { unit: string; fact: ConceptFact } | null {
  if (!units) {
    return null;
  }

  const preferredUnits = isEPS ? ["USD/shares", "USD"] : ["USD"];
  const targetPeriod = new Date(filing.periodOfReport).getTime();
  const targetFiled = new Date(filing.filedAt).getTime();
  const targetDurationDays = filing.formType === "10-Q" ? 100 : 380;
  const flattened: Array<{ unit: string; fact: ConceptFact; score: number }> = [];

  for (const [unit, facts] of Object.entries(units)) {
    const unitWeight = preferredUnits.includes(unit) ? 0 : 50_000_000;
    for (const fact of facts) {
      if (typeof fact.val !== "number") {
        continue;
      }

      const form = normalizeForm(fact.form);
      if (form !== filing.formType) {
        continue;
      }

      const durationPenalty = durationScore(fact, targetDurationDays);
      const endTime = fact.end ? new Date(fact.end).getTime() : targetPeriod;
      const filedTime = fact.filed ? new Date(fact.filed).getTime() : targetFiled;
      const score =
        unitWeight +
        durationPenalty +
        Math.abs(endTime - targetPeriod) +
        Math.abs(filedTime - targetFiled);

      flattened.push({ unit, fact, score });
    }
  }

  flattened.sort((left, right) => left.score - right.score);
  const best = flattened[0];
  return best ? { unit: best.unit, fact: best.fact } : null;
}

function durationScore(fact: ConceptFact, targetDurationDays: number): number {
  if (!fact.start || !fact.end) {
    return 200_000_000;
  }

  const start = new Date(fact.start).getTime();
  const end = new Date(fact.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 200_000_000;
  }

  const durationDays = Math.round((end - start) / 86_400_000);
  return Math.abs(durationDays - targetDurationDays) * 10_000;
}

function allSupportedFilings(tickerRecord: TickerRecord, submissions: SubmissionResponse): FilingReference[] {
  const recent = submissions.filings.recent;
  const filings: FilingReference[] = [];

  for (let index = 0; index < recent.form.length; index += 1) {
    const formType = normalizeForm(recent.form[index]);
    if (!formType) {
      continue;
    }

    filings.push({
      cik: tickerRecord.cik,
      ticker: tickerRecord.ticker,
      companyName: tickerRecord.companyName,
      exchange: tickerRecord.exchange,
      formType,
      accessionNumber: recent.accessionNumber[index],
      primaryDocument: recent.primaryDocument[index],
      filedAt: recent.filingDate[index],
      periodOfReport: recent.reportDate[index] ?? recent.filingDate[index]
    });
  }

  return filings;
}

function normalizeForm(form: string | undefined): "10-K" | "10-Q" | null {
  if (!form) {
    return null;
  }
  if (form.startsWith("10-K")) {
    return "10-K";
  }
  if (form.startsWith("10-Q")) {
    return "10-Q";
  }
  return null;
}

function accessionWithoutDashes(accessionNumber: string): string {
  return accessionNumber.replaceAll("-", "");
}

function normalizeTickerSnapshot(raw: unknown, updatedAt = new Date().toISOString()): {
  updatedAt: string;
  items: TickerRecord[];
} {
  if (raw && typeof raw === "object" && "items" in raw && Array.isArray((raw as { items?: unknown[] }).items)) {
    const snapshot = raw as { updatedAt?: string; items: TickerRecord[] };
    return {
      updatedAt: snapshot.updatedAt ?? updatedAt,
      items: snapshot.items
    };
  }

  if (raw && typeof raw === "object" && "data" in raw && Array.isArray((raw as { data?: unknown[] }).data)) {
    const payload = raw as { fields?: string[]; data: unknown[][] };
    const fields = payload.fields ?? ["cik", "name", "ticker", "exchange"];
    const fieldIndex = Object.fromEntries(fields.map((field, index) => [field, index]));
    return {
      updatedAt,
      items: payload.data
        .map((row) => ({
          cik: String(row[fieldIndex.cik] ?? "").padStart(10, "0"),
          companyName: String(row[fieldIndex.name] ?? ""),
          ticker: String(row[fieldIndex.ticker] ?? "").toUpperCase(),
          exchange: String(row[fieldIndex.exchange] ?? "")
        }))
        .filter((item) => item.cik && item.companyName && item.ticker)
    };
  }

  return {
    updatedAt,
    items: []
  };
}

async function getTickerSnapshot(env: Env): Promise<{ updatedAt: string; items: TickerRecord[] }> {
  const cached = await env.KABUYOMI_CACHE.get("tickers_snapshot", "json");
  const snapshot = normalizeTickerSnapshot(cached);
  if (snapshot.items.length > 0) {
    return snapshot;
  }

  await refreshTickerSnapshot(env);
  const refreshed = await env.KABUYOMI_CACHE.get("tickers_snapshot", "json");
  return normalizeTickerSnapshot(refreshed);
}

function normalizeTickerInput(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeClassTickerAlias(value: string): string | null {
  const normalized = normalizeTickerInput(value);
  const match = normalized.match(/^([A-Z0-9]+)[.\-\s]+([A-Z0-9]+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return `${match[1]}.${match[2]}`;
}

function matchesClassTickerAlias(input: string, candidateTicker: string): boolean {
  const inputAlias = normalizeClassTickerAlias(input);
  const candidateAlias = normalizeClassTickerAlias(candidateTicker);
  return Boolean(inputAlias && candidateAlias && inputAlias === candidateAlias);
}
