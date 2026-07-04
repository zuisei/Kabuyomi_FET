import type { Env, FilingReference, MetricSnapshot, TickerRecord } from "../env";
import {
  fetchFilingAssetsFromFetcher,
  fetchFilingHtmlFromFetcher,
  fetchMetricsFromFetcher,
  fetchPreparedFilingFromFetcher,
  fetchSubmissionsFromFetcher,
  fetchTickerSnapshotFromFetcher
} from "./sec-fetcher";
import {
  matchesClassTickerAlias,
  matchesCompactTickerAlias,
  normalizeClassTickerAlias,
  normalizeCompactTicker,
  normalizeTickerInput,
  parseTickerAliasInput,
  resolveBaseTickerFallback
} from "./sec-ticker-alias";
import { logWarnEvent } from "../lib/logging";
import { loadSearchFormTypeCache, upsertSearchFormTypeCache } from "../lib/search-form-type-cache";

const METRIC_TAGS = {
  revenue: [
    "Revenues",
    "SalesRevenueNet",
    // Prefer total top-line metrics before contract-only revenue components.
    "RevenueFromContractWithCustomerExcludingAssessedTax"
  ],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  epsBasic: ["EarningsPerShareBasic"],
  operatingIncome: ["OperatingIncomeLoss"],
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
  ]
} as const;

const METRIC_TAG_LIST = [...new Set(Object.values(METRIC_TAGS).flat())];

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

export interface PreparedFilingResponse {
  primaryDocumentUrl: string;
  mdaText: string;
  mdaTokenCount: number;
  metrics: MetricSnapshot[];
  usedStartPattern: string;
  usedEndPattern: string;
  diagnostics: {
    inputHtmlChars: number;
    normalizedChars: number;
    startMatchesCount: number;
    endMatchesCount: number;
    sanitizeMs: number;
    domParseMs: number;
    textReadMs: number;
    cleanupMs: number;
    normalizeMs: number;
    boundaryScanMs: number;
    selectionMs: number;
    totalMs: number;
  };
}

export interface TickerSnapshotEnvelope {
  updatedAt?: string;
  items?: TickerRecord[];
  fields?: string[];
  data?: unknown[][];
}

interface TickerSnapshot {
  updatedAt: string;
  items: TickerRecord[];
  searchIndex: TickerSearchIndexEntry[];
}

interface TickerSearchIndexEntry {
  item: TickerRecord;
  tickerInput: string;
  tickerLower: string;
  companyNameLower: string;
  tickerAlias: string | null;
  compactTicker: string;
}

interface TickerSearchContext {
  normalizedQuery: string;
  lowerQuery: string;
  queryAlias: string | null;
  compactQuery: string | null;
  baseTickerFallback: string | null;
}

interface TickerSnapshotMemoryCache {
  snapshot?: TickerSnapshot;
  expiresAt: number;
  loadPromise?: Promise<TickerSnapshot>;
}

const SEARCH_RESULT_LIMIT = 20;
const SEARCH_FORM_TYPE_REMOTE_LOOKUP_LIMIT = 6;
const TICKER_SNAPSHOT_MEMORY_TTL_MS = 5 * 60 * 1000;
const TICKER_SEARCH_SCORE_ORDER = [0, 1, 1.5, 1.75, 2, 3, 4, 5, 6, 7, 8] as const;
const tickerSnapshotMemoryCaches = new WeakMap<KVNamespace, TickerSnapshotMemoryCache>();

export async function searchTickers(query: string, env: Env): Promise<{ items: TickerRecord[]; updatedAt: string | null }> {
  const snapshot = await getTickerSnapshot(env);
  const normalizedQuery = query.trim();
  const rankedItems = selectTickerSearchResults(snapshot.searchIndex, normalizedQuery, SEARCH_RESULT_LIMIT);
  const items = await enrichTickerSearchResults(rankedItems, normalizedQuery, env);

  return {
    items,
    updatedAt: snapshot.updatedAt
  };
}

export function sortTickerSearchResults(items: TickerRecord[], normalizedQuery: string): TickerRecord[] {
  return selectTickerSearchResults(buildTickerSearchIndex(items), normalizedQuery, Number.POSITIVE_INFINITY);
}

async function enrichTickerSearchResults(
  items: TickerRecord[],
  _normalizedQuery: string,
  env: Env
): Promise<TickerRecord[]> {
  const cachedFormTypes = await loadSearchFormTypeCache(items.map((item) => item.ticker), env);
  const remoteFormTypes = await loadMissingSearchFormTypes(items, cachedFormTypes, env);

  return items.map((item) => {
    const key = normalizeTickerInput(item.ticker);
    const latestFormType = cachedFormTypes.has(key) ? cachedFormTypes.get(key) : remoteFormTypes.get(key);
    return latestFormType ? { ...item, latestFormType } : item;
  });
}

async function loadMissingSearchFormTypes(
  items: TickerRecord[],
  cachedFormTypes: Map<string, string | null>,
  env: Env
): Promise<Map<string, string | null>> {
  const missing = items
    .slice(0, SEARCH_FORM_TYPE_REMOTE_LOOKUP_LIMIT)
    .filter((item) => !cachedFormTypes.has(normalizeTickerInput(item.ticker)));

  if (missing.length === 0) {
    return new Map();
  }

  const entries = await Promise.all(
    missing.map(async (item): Promise<[string, string | null]> => {
      const ticker = normalizeTickerInput(item.ticker);
      try {
        const latestFormType = await resolveLatestSearchFormType(item, env);
        await upsertSearchFormTypeCache(ticker, latestFormType, env);
        return [ticker, latestFormType];
      } catch (error) {
        logWarnEvent("search_form_type_lookup_failed", {
          ticker,
          cik: item.cik,
          reason: error instanceof Error ? error.message : String(error)
        });
        return [ticker, null];
      }
    })
  );

  return new Map(entries);
}

function selectTickerSearchResults(
  index: TickerSearchIndexEntry[],
  query: string,
  limit: number
): TickerRecord[] {
  const context = buildTickerSearchContext(query);
  if (!context) {
    return [];
  }

  const buckets = new Map<number, TickerSearchIndexEntry[]>();
  const bounded = Number.isFinite(limit);
  const perBucketLimit = bounded ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
  if (perBucketLimit === 0) {
    return [];
  }

  for (const entry of index) {
    const score = scoreTickerSearchEntry(entry, context);
    if (score === null) {
      continue;
    }

    let bucket = buckets.get(score);
    if (!bucket) {
      bucket = [];
      buckets.set(score, bucket);
    }

    if (bounded) {
      insertBoundedTickerSearchEntry(bucket, entry, perBucketLimit);
    } else {
      bucket.push(entry);
    }
  }

  const results: TickerRecord[] = [];
  for (const score of TICKER_SEARCH_SCORE_ORDER) {
    const bucket = buckets.get(score);
    if (!bucket) {
      continue;
    }

    if (!bounded) {
      bucket.sort(compareTickerSearchEntry);
    }

    for (const entry of bucket) {
      results.push(entry.item);
      if (bounded && results.length >= perBucketLimit) {
        return results;
      }
    }
  }

  return results;
}

function buildTickerSearchContext(query: string): TickerSearchContext | null {
  const normalizedQuery = normalizeTickerInput(query);
  if (!normalizedQuery) {
    return null;
  }

  const parsedAlias = parseTickerAliasInput(normalizedQuery);
  return {
    normalizedQuery,
    lowerQuery: normalizedQuery.toLowerCase(),
    queryAlias: parsedAlias ? `${parsedAlias.baseTicker}.${parsedAlias.suffix}` : null,
    compactQuery: parsedAlias?.compactTicker ?? null,
    baseTickerFallback: parsedAlias?.baseTicker ?? null
  };
}

function scoreTickerSearchEntry(
  entry: TickerSearchIndexEntry,
  context: TickerSearchContext
): number | null {
  if (entry.tickerLower === context.lowerQuery) {
    return 0;
  }

  if (context.queryAlias && entry.tickerAlias === context.queryAlias) {
    return 1;
  }

  if (context.compactQuery && entry.compactTicker === context.compactQuery) {
    return 1.5;
  }

  if (context.baseTickerFallback && entry.tickerInput === context.baseTickerFallback) {
    return 1.75;
  }

  if (entry.tickerInput.startsWith(context.normalizedQuery)) {
    return 2;
  }

  if (context.queryAlias && entry.tickerAlias?.startsWith(context.queryAlias)) {
    return 3;
  }

  if (entry.companyNameLower === context.lowerQuery) {
    return 4;
  }

  if (entry.companyNameLower.startsWith(context.lowerQuery)) {
    return 5;
  }

  if (entry.tickerLower.includes(context.lowerQuery)) {
    return 6;
  }

  if (context.queryAlias && entry.tickerAlias?.includes(context.queryAlias)) {
    return 7;
  }

  if (entry.companyNameLower.includes(context.lowerQuery)) {
    return 8;
  }

  return null;
}

function insertBoundedTickerSearchEntry(
  bucket: TickerSearchIndexEntry[],
  entry: TickerSearchIndexEntry,
  limit: number
): void {
  let insertAt = bucket.findIndex((candidate) => compareTickerSearchEntry(entry, candidate) < 0);
  if (insertAt === -1) {
    insertAt = bucket.length;
  }

  if (insertAt >= limit) {
    return;
  }

  bucket.splice(insertAt, 0, entry);
  if (bucket.length > limit) {
    bucket.length = limit;
  }
}

function compareTickerSearchEntry(left: TickerSearchIndexEntry, right: TickerSearchIndexEntry): number {
  if (left.item.ticker.length !== right.item.ticker.length) {
    return left.item.ticker.length - right.item.ticker.length;
  }

  if (left.item.ticker === right.item.ticker) {
    return 0;
  }

  return left.item.ticker < right.item.ticker ? -1 : 1;
}

export async function refreshTickerSnapshot(env: Env): Promise<void> {
  const payload = await fetchTickerSnapshotFromFetcher(env);
  const normalized = normalizeTickerSnapshot(payload, new Date().toISOString());
  await env.KABUYOMI_CACHE.put("tickers_snapshot", JSON.stringify(normalized));
  cacheTickerSnapshot(env, buildTickerSnapshot(normalized));
}

export async function lookupTicker(ticker: string, env: Env): Promise<TickerRecord | null> {
  const normalizedTicker = normalizeTickerInput(ticker);
  if (!normalizedTicker) {
    return null;
  }

  const snapshot = await getTickerSnapshot(env);
  const exactMatch = snapshot.searchIndex.find((entry) => entry.tickerInput === normalizedTicker)?.item;
  if (exactMatch) {
    return exactMatch;
  }

  const normalizedAlias = normalizeClassTickerAlias(normalizedTicker);
  const aliasMatch = normalizedAlias
    ? snapshot.searchIndex.find((entry) => entry.tickerAlias === normalizedAlias)?.item
    : undefined;
  if (aliasMatch) {
    return aliasMatch;
  }

  const parsedAlias = parseTickerAliasInput(normalizedTicker);
  const compactAliasMatch = parsedAlias
    ? snapshot.searchIndex.find((entry) => entry.compactTicker === parsedAlias.compactTicker)?.item
    : undefined;
  if (compactAliasMatch) {
    return compactAliasMatch;
  }

  return parsedAlias
    ? snapshot.searchIndex.find((entry) => entry.tickerInput === parsedAlias.baseTicker)?.item ?? null
    : null;
}

export async function listTickersByCik(cik: string, env: Env): Promise<string[]> {
  const normalizedCik = cik.trim();
  if (!normalizedCik) {
    return [];
  }

  const snapshot = await getTickerSnapshot(env);
  return [...new Set(
    snapshot.items
      .filter((item) => item.cik === normalizedCik)
      .map((item) => normalizeTickerInput(item.ticker))
      .filter(Boolean)
  )];
}

export async function fetchSubmissions(cik: string, env: Env): Promise<SubmissionResponse> {
  return fetchSubmissionsFromFetcher(cik, env);
}

export async function fetchSubmissionsWithHistory(cik: string, env: Env): Promise<SubmissionResponse> {
  return fetchSubmissionsFromFetcher(cik, env, { includeHistory: true });
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

export async function resolveLatestSearchFormType(tickerRecord: TickerRecord, env: Env): Promise<string | null> {
  const submissions = await fetchSubmissions(tickerRecord.cik, env);
  const supported = pickLatestSupportedFiling(tickerRecord, submissions);
  return supported?.formType ?? pickLatestRecentFormType(submissions);
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
  const fetcherPayload = await fetchMetricsFromFetcher(filing.cik, METRIC_TAG_LIST, env);
  return buildMetricSnapshotsFromFetcherPayload(filing, comparisonFiling, fetcherPayload);
}

export async function fetchFilingAssets(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env
): Promise<FilingHtmlResponse & { metrics: MetricSnapshot[] }> {
  const fetcherPayload = await fetchFilingAssetsFromFetcher(filing, METRIC_TAG_LIST, env);
  return {
    html: fetcherPayload.html,
    primaryDocumentUrl: fetcherPayload.primaryDocumentUrl,
    metrics: buildMetricSnapshotsFromFetcherPayload(filing, comparisonFiling, fetcherPayload)
  };
}

export async function fetchPreparedFiling(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env
): Promise<PreparedFilingResponse | null> {
  const fetcherPayload = await fetchPreparedFilingFromFetcher(filing, METRIC_TAG_LIST, env);
  if (!fetcherPayload) {
    return null;
  }

  return {
    primaryDocumentUrl: fetcherPayload.primaryDocumentUrl,
    mdaText: fetcherPayload.mdaText,
    mdaTokenCount: fetcherPayload.mdaTokenCount,
    metrics: buildMetricSnapshotsFromFetcherPayload(filing, comparisonFiling, fetcherPayload),
    usedStartPattern: fetcherPayload.usedStartPattern,
    usedEndPattern: fetcherPayload.usedEndPattern,
    diagnostics: fetcherPayload.diagnostics
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

    const comparison = resolveComparisonFact(
      logicalName,
      filing,
      comparisonFiling,
      fetcherPayload.concepts,
      fetcherPayload.companyFacts
    );

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

function resolveComparisonFact(
  logicalName: MetricName,
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  concepts: Record<string, ConceptResponse | null>,
  companyFacts: CompanyFactsResponse | null
): { tagUsed: string; unit: string; fact: ConceptFact } | null {
  const sameFilingComparison = inferSameFilingComparisonReference(filing);
  if (sameFilingComparison) {
    const fact = resolveFact(logicalName, sameFilingComparison, concepts, companyFacts);
    if (fact) {
      return fact;
    }
  }

  if (!comparisonFiling) {
    return null;
  }

  return resolveFact(logicalName, comparisonFiling, concepts, companyFacts);
}

function resolveFact(
  logicalName: MetricName,
  filing: FilingReference,
  concepts: Record<string, ConceptResponse | null>,
  companyFacts: CompanyFactsResponse | null
): { tagUsed: string; unit: string; fact: ConceptFact } | null {
  const usGaap = companyFacts?.facts?.["us-gaap"] ?? {};
  let bestCandidate:
    | {
        tagUsed: string;
        unit: string;
        fact: ConceptFact;
        score: number;
        tagPriority: number;
      }
    | null = null;

  for (const [tagPriority, tag] of METRIC_TAGS[logicalName].entries()) {
    const sources = [concepts[tag] ?? null, usGaap[tag] ?? null];

    for (const concept of sources) {
      const fact = selectBestFact(concept?.units, filing, logicalName === "epsBasic");
      if (!fact) {
        continue;
      }

      const candidate = {
        tagUsed: tag,
        unit: fact.unit,
        fact: fact.fact,
        score: fact.score,
        tagPriority
      };

      if (
        !bestCandidate ||
        candidate.score < bestCandidate.score ||
        (candidate.score === bestCandidate.score && candidate.tagPriority < bestCandidate.tagPriority)
      ) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate
    ? {
        tagUsed: bestCandidate.tagUsed,
        unit: bestCandidate.unit,
        fact: bestCandidate.fact
      }
    : null;
}
function selectBestFact(
  units: Record<string, ConceptFact[]> | undefined,
  filing: FilingReference,
  isEPS: boolean
): { unit: string; fact: ConceptFact; score: number } | null {
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
  return best ? { unit: best.unit, fact: best.fact, score: best.score } : null;
}

function inferSameFilingComparisonReference(filing: FilingReference): FilingReference | null {
  const priorPeriodEnd = shiftPeriodEndByYears(filing.periodOfReport, -1);
  if (!priorPeriodEnd) {
    return null;
  }

  return {
    ...filing,
    periodOfReport: priorPeriodEnd
  };
}

function shiftPeriodEndByYears(dateString: string, years: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const shifted = new Date(Date.UTC(year + years, month - 1, day));
  if (
    shifted.getUTCFullYear() !== year + years ||
    shifted.getUTCMonth() !== month - 1 ||
    shifted.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0")
  ].join("-");
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
  const normalized = form.trim().toUpperCase();
  if (normalized === "10-K") {
    return "10-K";
  }
  if (normalized === "10-Q") {
    return "10-Q";
  }
  return null;
}

function pickLatestRecentFormType(submissions: SubmissionResponse): string | null {
  const form = submissions.filings.recent.form.find((candidate) => candidate.trim().length > 0);
  return normalizeDisplayForm(form);
}

function normalizeDisplayForm(form: string | undefined): string | null {
  if (!form) {
    return null;
  }

  const compact = form.trim().replace(/\s+/g, " ");
  if (!compact) {
    return null;
  }

  const supported = normalizeForm(compact);
  if (supported) {
    return supported;
  }

  return compact.length > 24 ? compact.slice(0, 24) : compact;
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

async function getTickerSnapshot(env: Env): Promise<TickerSnapshot> {
  const cache = tickerSnapshotMemoryCaches.get(env.KABUYOMI_CACHE);
  const now = Date.now();
  if (cache?.snapshot && cache.expiresAt > now) {
    return cache.snapshot;
  }

  if (cache?.loadPromise) {
    return cache.loadPromise;
  }

  const loadPromise = loadTickerSnapshot(env);
  tickerSnapshotMemoryCaches.set(env.KABUYOMI_CACHE, {
    snapshot: cache?.snapshot,
    expiresAt: cache?.expiresAt ?? 0,
    loadPromise
  });

  try {
    const snapshot = await loadPromise;
    cacheTickerSnapshot(env, snapshot);
    return snapshot;
  } catch (error) {
    if (cache?.snapshot) {
      tickerSnapshotMemoryCaches.set(env.KABUYOMI_CACHE, {
        snapshot: cache.snapshot,
        expiresAt: cache.expiresAt
      });
    } else {
      tickerSnapshotMemoryCaches.delete(env.KABUYOMI_CACHE);
    }
    throw error;
  }
}

async function loadTickerSnapshot(env: Env): Promise<TickerSnapshot> {
  const cached = await env.KABUYOMI_CACHE.get("tickers_snapshot", "json");
  const snapshot = normalizeTickerSnapshot(cached);
  if (snapshot.items.length > 0) {
    return buildTickerSnapshot(snapshot);
  }

  await refreshTickerSnapshot(env);
  const refreshed = await env.KABUYOMI_CACHE.get("tickers_snapshot", "json");
  return buildTickerSnapshot(normalizeTickerSnapshot(refreshed));
}

function cacheTickerSnapshot(env: Env, snapshot: TickerSnapshot): void {
  tickerSnapshotMemoryCaches.set(env.KABUYOMI_CACHE, {
    snapshot,
    expiresAt: Date.now() + TICKER_SNAPSHOT_MEMORY_TTL_MS
  });
}

function buildTickerSnapshot(snapshot: { updatedAt: string; items: TickerRecord[] }): TickerSnapshot {
  return {
    ...snapshot,
    searchIndex: buildTickerSearchIndex(snapshot.items)
  };
}

function buildTickerSearchIndex(items: TickerRecord[]): TickerSearchIndexEntry[] {
  return items.map((item) => {
    const tickerInput = normalizeTickerInput(item.ticker);
    return {
      item,
      tickerInput,
      tickerLower: tickerInput.toLowerCase(),
      companyNameLower: item.companyName.toLowerCase(),
      tickerAlias: normalizeClassTickerAlias(tickerInput),
      compactTicker: normalizeCompactTicker(tickerInput)
    };
  });
}
