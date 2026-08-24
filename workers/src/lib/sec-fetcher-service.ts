import type { Env, FilingFormType } from "../env";
import { extractMDASectionWithDiagnostics, normalizeFilingText } from "../extractors/mda";
import type { CompanyFactsResponse, ConceptResponse } from "../clients/sec";

const MAX_RESPONSE_CACHE_ENTRIES = 512;
/// **件数だけでは isolate のメモリを守れない。**
/// `responseCache` はモジュールスコープなので isolate が生きている限り残り、
/// XBRL の `companyfacts` は1社あたり実測 3.6 MB(パース後の JS オブジェクトは
/// その2〜6倍を占める)。追跡銘柄30社を1回の cron で回すと、
/// 件数上限 512 には遠く届かないままテキスト換算で 100 MB を超えうる。
/// Workers の isolate 上限は 128 MB なので、バイト数側にも蓋をする。
///
/// 12 MB は「同一URLの再取得を抑える」という本来の効果を残しつつ、
/// 別CIKの巨大応答が積み上がるのを防げる水準。cron は銘柄ごとに別URLを
/// 引くためキャッシュ再利用が効かず、ここを削っても取得回数はほぼ増えない。
const MAX_RESPONSE_CACHE_BYTES = 12 * 1024 * 1024;
const CACHE_TTL = {
  tickerSnapshot: 24 * 60 * 60 * 1000,
  submissions: 30 * 60 * 1000,
  filing: 24 * 60 * 60 * 1000,
  concept: 6 * 60 * 60 * 1000,
  companyFacts: 6 * 60 * 60 * 1000
};
const SUBMISSIONS_LOOKBACK_YEARS = 4;
const MIN_RECENT_10K_FILINGS = 3;
const MIN_RECENT_10Q_FILINGS = 4;
/// 20-F は年 1 回。4 年遡って 3 本あれば履歴としては十分。
const MIN_RECENT_20F_FILINGS = 3;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_INITIAL_BACKOFF_MS = 400;
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

interface SecFetcherConfig {
  userAgent: string;
  retryCount: number;
  initialBackoffMs: number;
  requestTimeoutMs: number;
  /// SEC を実際に叩く直前に必ず呼ばれる。**再試行のたびにも呼ばれる**ので、
  /// レート予算は「フェッチャ呼び出し数」ではなく「実 HTTP リクエスト数」で消費される。
  /// これが無いと 1トークンで最大 retryCount+1 回 SEC を叩けてしまい、
  /// SEC の fair-access(10 req/s 超過でIPブロック)を静かに超える。
  beforeAttempt?: () => Promise<void>;
}

interface SubmissionRecent {
  form: string[];
  accessionNumber: string[];
  primaryDocument: string[];
  filingDate: string[];
  reportDate: string[];
}

interface SubmissionEntry {
  form: string;
  accessionNumber: string;
  primaryDocument: string;
  filingDate: string;
  reportDate: string;
}

interface CacheEntry {
  value?: unknown;
  expiresAt: number;
  pending?: Promise<unknown>;
  /// ロード時に実測した応答テキスト長(UTF-16 コード単位)。厳密なバイト数では
  /// ないが、退避の判断には十分な近似。`pending` のみのエントリは 0。
  sizeBytes?: number;
}

const responseCache = new Map<string, CacheEntry>();

export function createCloudflareSecFetcherService(
  env: Env,
  options: { beforeAttempt?: () => Promise<void> } = {}
) {
  const config = { ...readSecFetcherConfig(env), beforeAttempt: options.beforeAttempt };

  async function secJson(url: string, options: { allowNotFound?: boolean; cacheTtlMs?: number } = {}) {
    return withCache(responseCache, url, options.cacheTtlMs ?? 0, async () => {
      const response = await fetchWithRetry(
        url,
        {
          method: "GET",
          headers: {
            "user-agent": config.userAgent,
            accept: "application/json,text/html;q=0.9,*/*;q=0.8"
          }
        },
        config
      );

      if (options.allowNotFound === true && response.status === 404) {
        return { value: null, sizeBytes: 0 };
      }

      if (!response.ok) {
        throw new Error(`SEC request failed (${response.status}) for ${url}`);
      }

      // 本文はどのみち全量バッファされるので、ここで長さを測っておく。
      // `response.json()` を直接使うと保持量を知る手立てが無くなる。
      const text = await response.text();
      return { value: JSON.parse(text) as unknown, sizeBytes: text.length };
    });
  }

  async function secText(url: string, options: { cacheTtlMs?: number } = {}): Promise<string> {
    return withCache(responseCache, url, options.cacheTtlMs ?? 0, async () => {
      const response = await fetchWithRetry(
        url,
        {
          method: "GET",
          headers: {
            "user-agent": config.userAgent,
            accept: "application/json,text/html;q=0.9,*/*;q=0.8"
          }
        },
        config
      );

      if (!response.ok) {
        throw new Error(`SEC request failed (${response.status}) for ${url}`);
      }

      const text = await response.text();
      return { value: text, sizeBytes: text.length };
    }) as Promise<string>;
  }

  return {
    async fetchTickerSnapshot(): Promise<unknown> {
      return secJson("https://www.sec.gov/files/company_tickers_exchange.json", {
        cacheTtlMs: CACHE_TTL.tickerSnapshot
      });
    },

    async fetchSubmissions(cik: string, options: { includeHistory?: boolean } = {}): Promise<unknown> {
      const root = await secJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
        cacheTtlMs: CACHE_TTL.submissions
      });

      return options.includeHistory === true ? expandSubmissionHistory(root, secJson) : root;
    },

    async fetchFiling({
      cik,
      accessionNumber,
      primaryDocument
    }: {
      cik: string;
      accessionNumber: string;
      primaryDocument: string;
    }): Promise<{ html: string; primaryDocumentUrl: string }> {
      const accessionNoDash = String(accessionNumber).replaceAll("-", "");
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDash}/${primaryDocument}`;
      const html = await secText(url, { cacheTtlMs: CACHE_TTL.filing });
      return { html, primaryDocumentUrl: url };
    },

    async fetchFilingAssets(args: {
      cik: string;
      accessionNumber: string;
      primaryDocument: string;
      tags: string[];
    }): Promise<{ html: string; primaryDocumentUrl: string; concepts: Record<string, ConceptResponse | null>; companyFacts: CompanyFactsResponse | null }> {
      const [filing, metrics] = await Promise.all([
        this.fetchFiling(args),
        this.fetchMetrics({ cik: args.cik, tags: args.tags })
      ]);

      return {
        html: filing.html,
        primaryDocumentUrl: filing.primaryDocumentUrl,
        concepts: metrics.concepts,
        companyFacts: metrics.companyFacts
      };
    },

    async fetchPreparedFiling(args: {
      cik: string;
      accessionNumber: string;
      primaryDocument: string;
      formType: FilingFormType;
      tags: string[];
    }): Promise<{
      primaryDocumentUrl: string;
      mdaText: string;
      mdaTokenCount: number;
      supplementalEvidenceText?: string;
      usedStartPattern: string;
      usedEndPattern: string;
      diagnostics: unknown;
      concepts: Record<string, ConceptResponse | null>;
      companyFacts: CompanyFactsResponse | null;
    }> {
      const [filing, metrics] = await Promise.all([
        this.fetchFiling(args),
        this.fetchMetrics({ cik: args.cik, tags: args.tags })
      ]);
      const prepared = extractMDASectionWithDiagnostics(filing.html, args.formType);
      if (!prepared.result) {
        throw new Error("Failed to extract MD&A section");
      }

      return {
        primaryDocumentUrl: filing.primaryDocumentUrl,
        mdaText: prepared.result.text,
        mdaTokenCount: prepared.result.tokenCount,
        ...supplementalEvidenceForPreparedFiling(args.cik, filing.html),
        usedStartPattern: prepared.result.usedStartPattern,
        usedEndPattern: prepared.result.usedEndPattern,
        diagnostics: prepared.diagnostics,
        concepts: metrics.concepts,
        companyFacts: metrics.companyFacts
      };
    },

    async fetchMetrics({
      cik,
      tags
    }: {
      cik: string;
      tags: string[];
    }): Promise<{ concepts: Record<string, ConceptResponse | null>; companyFacts: CompanyFactsResponse | null }> {
      const normalizedCik = String(cik).padStart(10, "0");
      const requestedTags = [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
      if (requestedTags.length === 0) {
        return { concepts: {}, companyFacts: null };
      }

      let companyFacts: CompanyFactsResponse | null = null;
      let companyFactsError: unknown = null;
      try {
        companyFacts = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${normalizedCik}.json`, {
          cacheTtlMs: CACHE_TTL.companyFacts
        }) as CompanyFactsResponse;
      } catch (error) {
        companyFactsError = error;
      }

      const { concepts: companyFactsConcepts, missingTags } = extractRequestedConceptsFromCompanyFacts(
        companyFacts,
        requestedTags
      );
      const fallback = await fetchConceptFallbacks(normalizedCik, missingTags, secJson);
      if (!companyFacts && missingTags.length > 0 && fallback.fulfilledCount === 0 && fallback.failedCount > 0) {
        throw companyFactsError ?? new Error(`SEC concept fallback failed for CIK${normalizedCik}`);
      }

      const concepts = Object.fromEntries(
        requestedTags.map((tag) => [tag, companyFactsConcepts[tag] ?? fallback.concepts[tag] ?? null])
      );

      return { concepts, companyFacts };
    }
  };
}

export function supplementalEvidenceForPreparedFiling(cik: string, html: string): { supplementalEvidenceText?: string } {
  // ExxonMobil's reportable-segment revenue table is in Note 3, outside the
  // 10-Q MD&A slice. Return only a bounded primary-evidence excerpt instead
  // of transporting the full filing HTML to the caller.
  if (String(cik).replace(/^0+/u, "") !== "34088") return {};

  const normalized = normalizeFilingText(html);
  const noteStart = normalized.search(/Note\s+\d+\.\s+Disclosures about Segments and Related Information/i);
  if (noteStart < 0) return {};
  const evidence = normalized.slice(noteStart, noteStart + 20_000);
  if (
    !/Upstream[\s\S]{0,500}Energy Products[\s\S]{0,500}Chemical Products[\s\S]{0,500}Specialty Products/i.test(evidence) ||
    !/Sales and other operating revenue/i.test(evidence)
  ) {
    return {};
  }
  return { supplementalEvidenceText: evidence };
}

function readSecFetcherConfig(env: Env): SecFetcherConfig {
  return {
    userAgent: env.SEC_USER_AGENT ?? "Kabuyomi admin@kabuyomi.app",
    retryCount: parsePositiveInt(env.SEC_FETCHER_RETRY_COUNT, DEFAULT_RETRY_COUNT),
    initialBackoffMs: parsePositiveInt(env.SEC_FETCHER_INITIAL_BACKOFF_MS, DEFAULT_INITIAL_BACKOFF_MS),
    requestTimeoutMs: parsePositiveInt(env.SEC_FETCHER_HTTP_TIMEOUT_MS ?? env.SEC_FETCHER_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS)
  };
}

/// 指標が載りうるタクソノミ。米国企業は us-gaap、外国企業(20-F)は ifrs-full。
/// トヨタとソニーのように両方で出す会社があるので、**us-gaap を先に見て挙動を変えない**。
const METRIC_TAXONOMIES = ["us-gaap", "ifrs-full"] as const;

function extractRequestedConceptsFromCompanyFacts(companyFacts: CompanyFactsResponse | null, tags: string[]) {
  const concepts: Record<string, ConceptResponse> = {};
  const missingTags: string[] = [];

  for (const tag of tags) {
    const found = METRIC_TAXONOMIES
      .map((taxonomy) => companyFacts?.facts?.[taxonomy])
      .find((facts) => facts && Object.prototype.hasOwnProperty.call(facts, tag));
    if (found) {
      concepts[tag] = found[tag]!;
      continue;
    }

    missingTags.push(tag);
  }

  return { concepts, missingTags };
}

async function fetchConceptFallbacks(
  normalizedCik: string,
  tags: string[],
  secJson: (url: string, options?: { allowNotFound?: boolean; cacheTtlMs?: number }) => Promise<unknown>
): Promise<{ concepts: Record<string, ConceptResponse | null>; fulfilledCount: number; failedCount: number }> {
  if (tags.length === 0) {
    return { concepts: {}, fulfilledCount: 0, failedCount: 0 };
  }

  // タグ名だけではどちらのタクソノミのものか決まらない(ProfitLoss は両方に存在する)。
  // us-gaap を先に引き、404 なら ifrs-full を引く。両方無ければ null。
  const settled = await Promise.allSettled(
    tags.map(async (tag): Promise<[string, ConceptResponse | null]> => {
      for (const taxonomy of METRIC_TAXONOMIES) {
        const concept = await secJson(
          `https://data.sec.gov/api/xbrl/companyconcept/CIK${normalizedCik}/${taxonomy}/${tag}.json`,
          { allowNotFound: true, cacheTtlMs: CACHE_TTL.concept }
        ) as ConceptResponse | null;
        if (concept) return [tag, concept];
      }
      return [tag, null];
    })
  );
  const concepts: Record<string, ConceptResponse | null> = {};
  let fulfilledCount = 0;
  let failedCount = 0;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      fulfilledCount += 1;
      const [tag, concept] = result.value;
      concepts[tag] = concept;
      continue;
    }

    failedCount += 1;
  }

  return { concepts, fulfilledCount, failedCount };
}

async function expandSubmissionHistory(
  root: unknown,
  secJson: (url: string, options?: { allowNotFound?: boolean; cacheTtlMs?: number }) => Promise<unknown>
): Promise<unknown> {
  const recent = normalizeSubmissionRecent(root);
  if (!recent) {
    return root;
  }

  const files = Array.isArray((root as { filings?: { files?: unknown[] } })?.filings?.files)
    ? (root as { filings: { files: unknown[] } }).filings.files
    : [];
  if (files.length === 0 || hasEnoughSupportedHistory(recent)) {
    return root;
  }

  const entries = toSubmissionEntries(recent);
  const cutoff = isoDateYearsAgo(SUBMISSIONS_LOOKBACK_YEARS);

  for (const file of files) {
    const fileName = typeof (file as { name?: unknown })?.name === "string"
      ? ((file as { name: string }).name).trim()
      : "";
    if (!fileName) {
      continue;
    }

    const fileTo = typeof (file as { filingTo?: unknown })?.filingTo === "string"
      ? (file as { filingTo: string }).filingTo
      : "";
    const fileFrom = typeof (file as { filingFrom?: unknown })?.filingFrom === "string"
      ? (file as { filingFrom: string }).filingFrom
      : "";
    if (fileTo && fileTo < cutoff) {
      break;
    }

    const payload = await secJson(`https://data.sec.gov/submissions/${fileName}`, {
      cacheTtlMs: CACHE_TTL.submissions
    });
    const historicalRecent = normalizeSubmissionRecent(payload);
    if (!historicalRecent) {
      if (fileFrom && fileFrom < cutoff && hasEnoughSupportedHistoryEntries(entries)) {
        break;
      }
      continue;
    }

    entries.push(...toSubmissionEntries(historicalRecent));
    if (hasEnoughSupportedHistoryEntries(entries)) {
      break;
    }

    if (fileFrom && fileFrom < cutoff) {
      break;
    }
  }

  return {
    ...(root as Record<string, unknown>),
    filings: {
      ...((root as { filings?: Record<string, unknown> })?.filings ?? {}),
      recent: toSubmissionRecent(entries)
    }
  };
}

async function fetchWithRetry(url: string, init: RequestInit, config: SecFetcherConfig): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    try {
      await config.beforeAttempt?.();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal
        });
        if (shouldRetryResponse(response) && attempt < config.retryCount) {
          await discardResponseBody(response);
          await sleep(config.initialBackoffMs * (attempt + 1));
          continue;
        }
        return response;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error;
      if (attempt >= config.retryCount) {
        throw error;
      }
      await sleep(config.initialBackoffMs * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`Request failed for ${url}`);
}

async function withCache<T>(
  cache: Map<string, CacheEntry>,
  key: string,
  ttlMs: number,
  loader: () => Promise<{ value: T; sizeBytes: number }>
): Promise<T> {
  const cached = cache.get(key);
  if (cached) {
    if (cached.value !== undefined && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    if (cached.pending) {
      return cached.pending as Promise<T>;
    }
  }

  const pending = (async () => {
    try {
      const { value, sizeBytes } = await loader();
      if (ttlMs > 0) {
        setCacheEntry(cache, key, {
          value,
          expiresAt: Date.now() + ttlMs,
          sizeBytes
        });
      } else {
        cache.delete(key);
      }
      return value;
    } catch (error) {
      if (cached?.value !== undefined) {
        setCacheEntry(cache, key, cached);
        return cached.value as T;
      }
      cache.delete(key);
      throw error;
    }
  })();

  setCacheEntry(cache, key, {
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    pending
  });

  try {
    return await pending;
  } finally {
    const latest = cache.get(key);
    if (latest?.pending === pending && latest.value === undefined) {
      cache.delete(key);
    }
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup before retrying a failed SEC response.
  }
}

function shouldRetryResponse(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

function setCacheEntry(cache: Map<string, CacheEntry>, key: string, entry: CacheEntry): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, entry);
  pruneCache(cache);
}

function pruneCache(cache: Map<string, CacheEntry>): void {
  let totalBytes = 0;
  for (const entry of cache.values()) {
    totalBytes += entry.sizeBytes ?? 0;
  }
  if (cache.size <= MAX_RESPONSE_CACHE_ENTRIES && totalBytes <= MAX_RESPONSE_CACHE_BYTES) {
    return;
  }

  // Map は挿入順を保つ。`setCacheEntry` が毎回 delete してから set し直すので
  // 先頭ほど古い = 先に退避してよい。
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_RESPONSE_CACHE_ENTRIES && totalBytes <= MAX_RESPONSE_CACHE_BYTES) {
      return;
    }
    // 進行中の取得は落とさない(同一URLの相乗りを壊すため)。
    if (entry.pending) {
      continue;
    }
    totalBytes -= entry.sizeBytes ?? 0;
    cache.delete(key);
  }
}

function normalizeSubmissionRecent(payload: unknown): SubmissionRecent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as { filings?: { recent?: unknown } };
  const recent =
    candidate.filings?.recent && typeof candidate.filings.recent === "object"
      ? candidate.filings.recent as SubmissionRecent
      : payload as SubmissionRecent;

  const columns = [
    recent.form,
    recent.accessionNumber,
    recent.primaryDocument,
    recent.filingDate,
    recent.reportDate
  ];
  if (!columns.every((column) => Array.isArray(column))) {
    return null;
  }

  // SEC の submissions.json は列指向で、5つの配列が同じ添字で1件の資料を表す。
  // 長さが揃っていない応答(部分応答・切り詰め)をそのまま通すと、
  // `toSubmissionEntries` が `form.length` を基準に回して他を `?? ""` で埋めるため、
  // **種別と実体がずれた資料**(form[i] と accessionNumber[i] が別物)を
  // 掴みうる。列が食い違う応答は資料一覧として信用できないので弾く。
  const expectedLength = columns[0]!.length;
  if (!columns.every((column) => column.length === expectedLength)) {
    return null;
  }

  return recent;
}

function toSubmissionEntries(recent: SubmissionRecent): SubmissionEntry[] {
  const entries: SubmissionEntry[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < recent.form.length; index += 1) {
    const accessionNumber = String(recent.accessionNumber[index] ?? "").trim();
    if (!accessionNumber || seen.has(accessionNumber)) {
      continue;
    }

    seen.add(accessionNumber);
    entries.push({
      form: String(recent.form[index] ?? ""),
      accessionNumber,
      primaryDocument: String(recent.primaryDocument[index] ?? ""),
      filingDate: String(recent.filingDate[index] ?? ""),
      reportDate: String(recent.reportDate[index] ?? "") || String(recent.filingDate[index] ?? "")
    });
  }

  return entries;
}

function toSubmissionRecent(entries: SubmissionEntry[]): SubmissionRecent {
  const deduped: SubmissionEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.accessionNumber || seen.has(entry.accessionNumber)) {
      continue;
    }
    seen.add(entry.accessionNumber);
    deduped.push(entry);
  }

  deduped.sort((left, right) => {
    const filedDelta = right.filingDate.localeCompare(left.filingDate);
    if (filedDelta !== 0) {
      return filedDelta;
    }

    const reportDelta = right.reportDate.localeCompare(left.reportDate);
    if (reportDelta !== 0) {
      return reportDelta;
    }

    return right.accessionNumber.localeCompare(left.accessionNumber);
  });

  return {
    form: deduped.map((entry) => entry.form),
    accessionNumber: deduped.map((entry) => entry.accessionNumber),
    primaryDocument: deduped.map((entry) => entry.primaryDocument),
    filingDate: deduped.map((entry) => entry.filingDate),
    reportDate: deduped.map((entry) => entry.reportDate)
  };
}

function hasEnoughSupportedHistory(recent: SubmissionRecent): boolean {
  return hasEnoughSupportedHistoryEntries(toSubmissionEntries(recent));
}

/// これ以上ページを辿らなくてよいか、という**打ち切り条件**であって、
/// 銘柄を扱えるかどうかの門ではない(門は `normalizeForm`)。
///
/// 外国企業は 10-K も 10-Q も 1 本も出さないので、米国企業の条件だけを見ていると
/// **永久に満たされず、履歴ファイルを全部取りに行ってしまう**。正しさではなく
/// 通信量の問題だが、20-F だけを出す会社には 20-F の本数で打ち切る。
function hasEnoughSupportedHistoryEntries(entries: SubmissionEntry[]): boolean {
  let tenKCount = 0;
  let tenQCount = 0;
  let twentyFCount = 0;

  for (const entry of entries) {
    if (!entry.filingDate || entry.filingDate < isoDateYearsAgo(SUBMISSIONS_LOOKBACK_YEARS)) {
      continue;
    }

    if (entry.form.startsWith("10-K")) {
      tenKCount += 1;
      continue;
    }

    if (entry.form.startsWith("10-Q")) {
      tenQCount += 1;
      continue;
    }

    // "20-F/A"(訂正版)は取り込み対象ではないが、履歴が十分あることの証拠にはなる。
    if (entry.form.startsWith("20-F")) {
      twentyFCount += 1;
    }
  }

  if (tenKCount >= MIN_RECENT_10K_FILINGS && tenQCount >= MIN_RECENT_10Q_FILINGS) {
    return true;
  }

  return twentyFCount >= MIN_RECENT_20F_FILINGS;
}

function isoDateYearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
