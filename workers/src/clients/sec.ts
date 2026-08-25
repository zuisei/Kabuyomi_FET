import type {
  Env,
  FilingFormType,
  FilingReference,
  FinancialFactPeriodKind,
  FinancialFiscalQuarter,
  MetricSnapshot,
  TickerRecord
} from "../env";
import { normalizeFilingText } from "../extractors/mda";
import {
  findLatestQuarterlyNarrative,
  type QuarterlyNarrative,
  type SixKFilingRef
} from "../lib/filings/quarterly-narrative";
import {
  fetchFilingAssetsFromFetcher,
  fetchFilingHtmlFromFetcher,
  listFilingDocumentsFromFetcher,
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
import { AppError } from "../lib/errors";
import { loadSearchFormTypeCache, upsertSearchFormTypeCache } from "../lib/search-form-type-cache";

/// 各指標を表す XBRL タグ。**並び順が優先順位**で、先にあるものが勝つ。
///
/// 後半の ifrs-full 系は外国企業(20-F)向け。トヨタとソニーのように
/// **両方のタクソノミで出す会社がある**ので、us-gaap を先に置いて挙動を変えない。
/// 2026-08-24 に TSMC の実データで 8 指標すべて対応物があることを確認済み
/// (docs/quality/FOREIGN_ISSUER_SUPPORT_2026-08-24.md)。
///
/// 単位は `selectBestFact` が USD(EPS は USD/shares)だけを通す。TSMC は自社で
/// USD 換算値を出しているのでそのまま乗るが、**EPS は現地通貨しか無いので落ちる**。
/// 換算せず落とすのは意図的で、為替をこちらで当てると出典のない数字になる。
const METRIC_TAGS = {
  revenue: [
    "Revenues",
    "SalesRevenueNet",
    // Prefer total top-line metrics before contract-only revenue components.
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenue",
    "RevenueFromContractsWithCustomers"
  ],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "ProfitLossAttributableToOwnersOfParent"],
  epsBasic: ["EarningsPerShareBasic", "BasicEarningsLossPerShare"],
  operatingIncome: ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    "CashFlowsFromUsedInOperatingActivities"
  ],
  // Do not conflate restricted cash with freely available cash equivalents.
  cashAndCashEquivalents: ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"],
  // These concepts intentionally exclude lease obligations and aggregate debt.
  currentDebt: ["LongTermDebtCurrent", "CurrentPortionOfLongtermBorrowings"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongtermBorrowings"],
  /// 親会社株主に帰属する自己資本を先に採る。非支配株主持分を含む `Equity` を
  /// 先に採ると、ROE の分母が実態より大きくなる会社が出る。
  equity: [
    "StockholdersEquity",
    "EquityAttributableToOwnersOfParent",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "Equity"
  ],
  totalAssets: ["Assets"],
  /// 設備投資。キャッシュフロー計算書では支出額(正の数)で載る。
  capitalExpenditure: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"
  ]
} as const;

/// `companyfacts` が指標を載せうるタクソノミ。米国企業は us-gaap、
/// 外国企業(20-F)は ifrs-full。順序は METRIC_TAGS と同じ理由で us-gaap が先。
const METRIC_TAXONOMIES = ["us-gaap", "ifrs-full"] as const;

const METRIC_TAG_LIST = [...new Set(Object.values(METRIC_TAGS).flat())];

type MetricName = keyof typeof METRIC_TAGS;

type MetricPeriodType = "duration" | "cash_flow_ytd" | "instant";

const INSTANT_METRICS = new Set<MetricName>([
  // 貸借対照表の項目は時点の値。期間の窓で採ると1件も一致しない。
  "equity",
  "totalAssets",
  "cashAndCashEquivalents",
  "currentDebt",
  "longTermDebt"
]);
const PRIOR_YEAR_ALIGNMENT_WINDOW_DAYS = 28;
const AVERAGE_CALENDAR_YEAR_DAYS = 365.2425;

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
  fy?: number;
  fp?: string;
  frame?: string;
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
  supplementalEvidenceText?: string;
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
  if (/^(1|true|yes|on)$/iu.test(env.EMERGENCY_DISABLE_SEC_REFRESH?.trim() ?? "")) {
    throw new AppError(503, "SEC refresh is temporarily disabled");
  }
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

  const currentPeriodTime = isoDateToTime(current.periodOfReport);
  const currentFiledTime = isoDateToTime(current.filedAt);
  if (currentPeriodTime === null || currentFiledTime === null) {
    return null;
  }

  const sorted = candidates
    .flatMap((item) => {
      const candidatePeriodTime = isoDateToTime(item.periodOfReport);
      const candidateFiledTime = isoDateToTime(item.filedAt);
      if (
        candidatePeriodTime === null
        || candidateFiledTime === null
        || candidatePeriodTime >= currentPeriodTime
        || candidateFiledTime >= currentFiledTime
      ) {
        return [];
      }

      const elapsedDays = (currentPeriodTime - candidatePeriodTime) / 86_400_000;
      const priorYearDistanceDays = Math.abs(elapsedDays - AVERAGE_CALENDAR_YEAR_DAYS);

      // A 52/53-week fiscal calendar can move a like-for-like annual or
      // quarterly endpoint by seven days, while leap years move calendar-year
      // issuers by one day. Four weeks covers those legitimate shifts but
      // excludes both adjacent fiscal quarters and skipped annual periods.
      if (priorYearDistanceDays > PRIOR_YEAR_ALIGNMENT_WINDOW_DAYS) {
        return [];
      }

      return [{ filing: item, priorYearDistanceDays, candidatePeriodTime }];
    })
    .sort((left, right) =>
      left.priorYearDistanceDays - right.priorYearDistanceDays
      || right.candidatePeriodTime - left.candidatePeriodTime
    );

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

/// 20-F 提出者の直近四半期を、会話が引用できる文章として拾ってくる。
///
/// 20-F は年 1 回なので、これが無いと外国企業は 1 年前の話しかできない。
/// **数値は取り込まない**(プレスリリースは現地通貨で、指標は USD で揃えてある)。
export async function loadQuarterlyNarrative(
  filing: FilingReference,
  env: Env
): Promise<QuarterlyNarrative | null> {
  const submissions = await fetchSubmissions(filing.cik, env);
  const recent = submissions.filings.recent;
  const sixKFilings: SixKFilingRef[] = [];
  for (let index = 0; index < recent.form.length; index += 1) {
    if (recent.form[index]?.trim().toUpperCase() !== "6-K") continue;
    sixKFilings.push({
      accessionNumber: recent.accessionNumber[index]!,
      filedAt: recent.filingDate[index]!,
      primaryDocument: recent.primaryDocument[index] ?? ""
    });
  }
  if (sixKFilings.length === 0) return null;

  const documentUrl = (accessionNumber: string, documentName: string) =>
    `https://www.sec.gov/Archives/edgar/data/${Number(filing.cik)}/${accessionWithoutDashes(
      accessionNumber
    )}/${documentName}`;

  return findLatestQuarterlyNarrative(sixKFilings, {
    listDocuments: async (accessionNumber) =>
      (await listFilingDocumentsFromFetcher(filing.cik, accessionNumber, env)).documents,
    readDocumentText: async (accessionNumber, documentName) => {
      const response = await fetchFilingHtmlFromFetcher(
        { ...filing, accessionNumber, primaryDocument: documentName },
        env
      );
      return normalizeFilingText(response.html);
    },
    buildDocumentUrl: documentUrl
  });
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
    supplementalEvidenceText: fetcherPayload.supplementalEvidenceText,
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

    let comparison = resolveComparisonFact(
      logicalName,
      current.tagUsed,
      filing,
      comparisonFiling,
      fetcherPayload.concepts,
      fetcherPayload.companyFacts
    );
    if (comparison && !comparisonFactsCompatible(logicalName, current, comparison, filing)) {
      comparison = null;
    }
    const currentFiscalYear = normalizeFiscalYear(current.fact.fy);
    const currentFiscalQuarter = normalizeFiscalQuarter(current.fact.fp);
    const comparisonFiscalYear = comparison
      ? resolveComparisonFiscalYear(current.fact, comparison, filing)
      : undefined;
    const comparisonFiscalQuarter = normalizeFiscalQuarter(comparison?.fact.fp);

    results.push({
      logicalName,
      tagUsed: current.tagUsed,
      value: current.fact.val,
      unit: current.unit,
      ...(current.fact.start ? { periodStart: current.fact.start } : {}),
      periodEnd: current.fact.end ?? filing.periodOfReport,
      periodKind: inferFactPeriodKind(current.fact, filing, metricPeriodType(logicalName)),
      ...(currentFiscalYear !== undefined ? { fiscalYear: currentFiscalYear } : {}),
      ...(currentFiscalQuarter !== undefined ? { fiscalQuarter: currentFiscalQuarter } : {}),
      ...(comparison ? { comparisonValue: comparison.fact.val } : {}),
      ...(comparison?.fact.start ? { comparisonPeriodStart: comparison.fact.start } : {}),
      ...(comparison?.fact.end ? { comparisonPeriodEnd: comparison.fact.end } : {}),
      ...(comparison
        ? { comparisonPeriodKind: inferFactPeriodKind(comparison.fact, comparison.filing, metricPeriodType(logicalName)) }
        : {}),
      ...(comparisonFiscalYear !== undefined ? { comparisonFiscalYear } : {}),
      ...(comparisonFiscalQuarter !== undefined ? { comparisonFiscalQuarter } : {}),
      ...(comparison
        ? {
            comparisonTagUsed: comparison.tagUsed,
            comparisonSourceUrl: buildPrimaryDocumentUrl(comparison.filing),
            comparisonAccessionNumber: comparison.filing.accessionNumber
          }
        : {}),
      ...(comparison
        && comparison.fact.val !== 0
        && !valuesCrossZero(current.fact.val, comparison.fact.val)
        ? {
            yoyPercent:
              ((current.fact.val - comparison.fact.val) / Math.abs(comparison.fact.val)) * 100
          }
        : {})
    });
  }

  return results;
}

function resolveComparisonFact(
  logicalName: MetricName,
  requiredTag: string,
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  concepts: Record<string, ConceptResponse | null>,
  companyFacts: CompanyFactsResponse | null
): { tagUsed: string; unit: string; fact: ConceptFact; filing: FilingReference } | null {
  const sameFilingComparison = inferSameFilingComparisonReference(filing);
  if (sameFilingComparison) {
    const fact = resolveFact(logicalName, sameFilingComparison, concepts, companyFacts, requiredTag);
    if (fact) {
      return { ...fact, filing: sameFilingComparison };
    }
  }

  if (!comparisonFiling) {
    return null;
  }

  const fact = resolveFact(logicalName, comparisonFiling, concepts, companyFacts, requiredTag);
  return fact ? { ...fact, filing: comparisonFiling } : null;
}

function resolveFact(
  logicalName: MetricName,
  filing: FilingReference,
  concepts: Record<string, ConceptResponse | null>,
  companyFacts: CompanyFactsResponse | null,
  requiredTag?: string
): { tagUsed: string; unit: string; fact: ConceptFact } | null {
  const taxonomyFacts = METRIC_TAXONOMIES
    .map((taxonomy) => companyFacts?.facts?.[taxonomy])
    .filter((facts): facts is NonNullable<typeof facts> => Boolean(facts));
  let bestCandidate:
    | {
        tagUsed: string;
        unit: string;
        fact: ConceptFact;
        score: number;
        tagPriority: number;
      }
    | null = null;

  const candidateTags = requiredTag ? [requiredTag] : METRIC_TAGS[logicalName];
  for (const [tagPriority, tag] of candidateTags.entries()) {
    const sources = [concepts[tag] ?? null, ...taxonomyFacts.map((facts) => facts[tag] ?? null)];

    for (const concept of sources) {
      const fact = selectBestFact(
        concept?.units,
        filing,
        logicalName === "epsBasic",
        metricPeriodType(logicalName)
      );
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
        candidate.tagPriority < bestCandidate.tagPriority ||
        (candidate.tagPriority === bestCandidate.tagPriority && candidate.score < bestCandidate.score)
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
  isEPS: boolean,
  periodType: MetricPeriodType
): { unit: string; fact: ConceptFact; score: number } | null {
  if (!units) {
    return null;
  }

  const preferredUnits = isEPS ? ["USD/shares"] : ["USD"];
  const flattened: Array<{ unit: string; fact: ConceptFact; score: number }> = [];

  for (const [unit, facts] of Object.entries(units)) {
    const unitPriority = preferredUnits.indexOf(unit);
    if (unitPriority < 0) {
      continue;
    }

    for (const fact of facts) {
      if (!Number.isFinite(fact.val)) {
        continue;
      }

      const form = normalizeForm(fact.form);
      if (form !== filing.formType) {
        continue;
      }

      if (!matchesFilingIdentity(fact, filing) || fact.end !== filing.periodOfReport) {
        continue;
      }

      const periodPenalty = periodType === "instant"
        ? instantPeriodScore(fact)
        : durationScore(fact, filing.formType, periodType);
      if (periodPenalty === null) {
        continue;
      }

      const score =
        unitPriority * 1_000_000 +
        periodPenalty;

      flattened.push({ unit, fact, score });
    }
  }

  flattened.sort((left, right) => left.score - right.score);
  const best = flattened[0];
  return best ? { unit: best.unit, fact: best.fact, score: best.score } : null;
}

function metricPeriodType(logicalName: MetricName): MetricPeriodType {
  if (INSTANT_METRICS.has(logicalName)) {
    return "instant";
  }
  // 設備投資はキャッシュフロー計算書の項目なので、営業CFと同じく期中累計で載る。
  return logicalName === "operatingCashFlow" || logicalName === "capitalExpenditure"
    ? "cash_flow_ytd"
    : "duration";
}

function matchesFilingIdentity(fact: ConceptFact, filing: FilingReference): boolean {
  if (fact.accn) {
    return accessionWithoutDashes(fact.accn) === accessionWithoutDashes(filing.accessionNumber);
  }

  // Trimmed regression fixtures may omit accession numbers. In that case,
  // require the SEC filed date when it is available rather than accepting a
  // same-form fact from another filing.
  return !fact.filed || fact.filed === filing.filedAt;
}

function instantPeriodScore(fact: ConceptFact): number | null {
  if (fact.start !== undefined && fact.start.trim().length > 0) {
    return null;
  }
  return isIsoDate(fact.end) ? 0 : null;
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

function durationScore(
  fact: ConceptFact,
  formType: FilingReference["formType"],
  periodType: Exclude<MetricPeriodType, "instant">
): number | null {
  if (!fact.start || !fact.end) {
    return null;
  }

  const start = new Date(fact.start).getTime();
  const end = new Date(fact.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  const durationDays = Math.round((end - start) / 86_400_000);
  // 20-F は 10-K と同じ年次。四半期の窓で採ると年次の事実が全部落ちる。
  if (formType === "10-K" || formType === "20-F") {
    return durationDays >= 300 && durationDays <= 400
      ? Math.abs(durationDays - 380) * 10_000
      : null;
  }

  if (periodType === "cash_flow_ytd") {
    return cashFlowYtdDurationScore(durationDays, fact.fp);
  }

  if (durationDays < 60 || durationDays > 120) {
    return null;
  }

  return Math.abs(durationDays - 100) * 10_000;
}

function cashFlowYtdDurationScore(durationDays: number, fiscalPeriod: string | undefined): number | null {
  const normalizedPeriod = fiscalPeriod?.trim().toUpperCase();
  const expected = normalizedPeriod === "Q1"
    ? { minimum: 60, maximum: 120, target: 100 }
    : normalizedPeriod === "Q2"
      ? { minimum: 140, maximum: 220, target: 190 }
      : normalizedPeriod === "Q3"
        ? { minimum: 225, maximum: 310, target: 280 }
        : null;

  if (expected) {
    return durationDays >= expected.minimum && durationDays <= expected.maximum
      ? Math.abs(durationDays - expected.target) * 10_000
      : null;
  }

  if (normalizedPeriod) {
    return null;
  }

  // Older trimmed facts may omit fp. A 10-Q cash-flow statement is cumulative;
  // among otherwise identical candidates, prefer the longest valid YTD span.
  return durationDays >= 60 && durationDays <= 310
    ? (310 - durationDays) * 10_000
    : null;
}

function inferFactPeriodKind(
  fact: ConceptFact,
  filing: FilingReference,
  periodType: MetricPeriodType
): FinancialFactPeriodKind {
  if (periodType === "instant") {
    return "instant";
  }
  if (!fact.start || !fact.end) {
    return "unknown";
  }

  const start = new Date(fact.start).getTime();
  const end = new Date(fact.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "unknown";
  }

  const durationDays = Math.round((end - start) / 86_400_000);
  if ((filing.formType === "10-K" || filing.formType === "20-F") && durationDays >= 300 && durationDays <= 400) {
    return "annual";
  }
  if (periodType === "cash_flow_ytd" && filing.formType === "10-Q") {
    const fiscalPeriod = fact.fp?.trim().toUpperCase();
    if (fiscalPeriod === "Q1") {
      // Q1 cash flow is both fiscal-YTD and the exact quarter. Classifying it
      // as a quarter keeps it period-compatible with Q1 income-statement facts.
      return "quarter";
    }
    if (fiscalPeriod === "Q2" || fiscalPeriod === "Q3") {
      return "year_to_date";
    }
    // Older SEC facts can omit fp. Preserve the exact-period distinction from
    // the observed duration instead of labeling a one-quarter span as YTD.
    return durationDays >= 60 && durationDays <= 120 ? "quarter" : "year_to_date";
  }
  if (durationDays >= 60 && durationDays <= 120) {
    return "quarter";
  }
  if (durationDays > 120 && durationDays <= 300) {
    return "year_to_date";
  }
  return "duration";
}

function normalizeFiscalYear(fiscalYear: number | undefined): number | undefined {
  if (fiscalYear === undefined || !Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) {
    return undefined;
  }
  return fiscalYear;
}

function resolveComparisonFiscalYear(
  currentFact: ConceptFact,
  comparison: { fact: ConceptFact; filing: FilingReference },
  currentFiling: FilingReference
): number | undefined {
  const sameFilingContext = accessionWithoutDashes(comparison.filing.accessionNumber)
    === accessionWithoutDashes(currentFiling.accessionNumber);
  if (!sameFilingContext) {
    return normalizeFiscalYear(comparison.fact.fy);
  }

  // SEC comparative contexts embedded in a later filing carry the later
  // filing's fy/fp metadata. Preserve the fiscal-calendar offset from the
  // current fact instead of falsely labeling the prior period as the current
  // fiscal year (important for off-calendar issuers as well).
  const currentFiscalYear = normalizeFiscalYear(currentFact.fy);
  const currentPeriodYear = isoDateYear(currentFact.end ?? currentFiling.periodOfReport);
  const comparisonPeriodYear = isoDateYear(comparison.fact.end);
  if (
    currentFiscalYear === undefined
    || currentPeriodYear === undefined
    || comparisonPeriodYear === undefined
  ) {
    return undefined;
  }
  const derived = currentFiscalYear - (currentPeriodYear - comparisonPeriodYear);
  return normalizeFiscalYear(derived);
}

function comparisonFactsCompatible(
  logicalName: MetricName,
  current: { tagUsed: string; unit: string; fact: ConceptFact },
  comparison: { tagUsed: string; unit: string; fact: ConceptFact; filing: FilingReference },
  currentFiling: FilingReference
): boolean {
  if (current.tagUsed !== comparison.tagUsed || current.unit !== comparison.unit) {
    return false;
  }

  // Callers normally obtain comparisonFiling through pickComparisonFiling,
  // but keep the metric builder fail-closed as well: an injected or stale
  // multi-year filing must never be surfaced as an ordinary YoY comparison.
  if (!arePriorYearPeriodsAligned(
    current.fact.end ?? currentFiling.periodOfReport,
    comparison.fact.end ?? comparison.filing.periodOfReport
  )) {
    return false;
  }

  const currentQuarter = normalizeFiscalQuarter(current.fact.fp);
  const comparisonQuarter = normalizeFiscalQuarter(comparison.fact.fp);
  if (currentQuarter !== undefined && comparisonQuarter !== undefined && currentQuarter !== comparisonQuarter) {
    return false;
  }

  const periodType = metricPeriodType(logicalName);
  const currentPeriodKind = inferFactPeriodKind(current.fact, currentFiling, periodType);
  const comparisonPeriodKind = inferFactPeriodKind(comparison.fact, comparison.filing, periodType);
  if (currentPeriodKind !== comparisonPeriodKind) {
    return false;
  }
  if (currentPeriodKind === "instant") {
    return true;
  }

  const currentDurationDays = factDurationDays(current.fact);
  const comparisonDurationDays = factDurationDays(comparison.fact);
  return currentDurationDays !== null
    && comparisonDurationDays !== null
    && Math.abs(currentDurationDays - comparisonDurationDays) <= 7;
}

function factDurationDays(fact: ConceptFact): number | null {
  if (!fact.start || !fact.end) return null;
  const start = Date.parse(fact.start);
  const end = Date.parse(fact.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 86_400_000);
}

function isoDateYear(value: string | undefined): number | undefined {
  const match = /^(\d{4})-\d{2}-\d{2}$/u.exec(value ?? "");
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : undefined;
}

function valuesCrossZero(current: number, comparison: number): boolean {
  return (current < 0 && comparison >= 0) || (current >= 0 && comparison < 0);
}

function normalizeFiscalQuarter(fiscalPeriod: string | undefined): FinancialFiscalQuarter | undefined {
  const normalized = fiscalPeriod?.trim().toUpperCase();
  if (normalized === "Q1" || normalized === "Q2" || normalized === "Q3" || normalized === "Q4" || normalized === "FY") {
    return normalized;
  }
  return undefined;
}

function isIsoDate(value: string | undefined): value is string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isoDateToTime(value: string | undefined): number | null {
  if (!isIsoDate(value)) {
    return null;
  }
  return Date.parse(`${value}T00:00:00.000Z`);
}

function arePriorYearPeriodsAligned(currentPeriodEnd: string, comparisonPeriodEnd: string): boolean {
  const currentTime = isoDateToTime(currentPeriodEnd);
  const comparisonTime = isoDateToTime(comparisonPeriodEnd);
  if (currentTime === null || comparisonTime === null || comparisonTime >= currentTime) {
    return false;
  }
  const elapsedDays = (currentTime - comparisonTime) / 86_400_000;
  return Math.abs(elapsedDays - AVERAGE_CALENDAR_YEAR_DAYS) <= PRIOR_YEAR_ALIGNMENT_WINDOW_DAYS;
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

/// 取り込む提出書類はこの 3 つだけ。修正版(`10-K/A` `20-F/A`)は従来どおり通さない。
/// **20-F は外国企業の年次報告**で、10-K の位置にあたる(2026-08-24)。
/// 20-F 提出者は 10-K / 10-Q をまったく出さないので、これを通さない限り
/// TSM・ASML・SAP・トヨタ・BABA・Shell・NVO・ソニーは 1 社も扱えない。
function normalizeForm(form: string | undefined): FilingFormType | null {
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
  if (normalized === "20-F") {
    return "20-F";
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
