import { timingSafeEqual } from "node:crypto";
import { prepareFilingText } from "./prepared-filing.mjs";

// NOTE: このサービスは本番/test のどちらの経路でも使われていない。
// `wrangler.toml` / `wrangler.test.toml` はいずれも
// `SEC_FETCHER_BASE_URL = "cloudflare-internal"` で、実際に動くのは
// Worker 内の `workers/src/lib/sec-fetcher-service.ts` の方。
// ここを直しても本番は変わらないので、両実装を触るときは必ず対にすること。
const DEFAULT_USER_AGENT = "Kabuyomi admin@kabuyomi.app";
const MAX_RESPONSE_CACHE_ENTRIES = 512;
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

export function readConfig(env = process.env) {
  return {
    internalToken: env.SEC_FETCHER_SHARED_SECRET ?? "",
    userAgent: env.SEC_USER_AGENT ?? DEFAULT_USER_AGENT,
    rateLimitPerSecond: parsePositiveInt(env.SEC_RATE_LIMIT_PER_SECOND, 8),
    retryCount: parsePositiveInt(env.SEC_FETCHER_RETRY_COUNT, 2),
    initialBackoffMs: parsePositiveInt(env.SEC_FETCHER_INITIAL_BACKOFF_MS, 400),
    requestTimeoutMs: parsePositiveInt(env.SEC_FETCHER_HTTP_TIMEOUT_MS, 12_000)
  };
}

export function createSecService(config = readConfig()) {
  const limiter = createRateLimiter(config.rateLimitPerSecond);
  const responseCache = new Map();

  async function secJson(url, { allowNotFound = false, cacheTtlMs = 0 } = {}) {
    return withCache(responseCache, url, cacheTtlMs, async () => {
      const response = await fetchWithRetry(
        url,
        {
          method: "GET",
          headers: {
            "user-agent": config.userAgent,
            accept: "application/json,text/html;q=0.9,*/*;q=0.8"
          }
        },
        config,
        limiter
      );

      if (allowNotFound && response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`SEC request failed (${response.status}) for ${url}`);
      }

      return response.json();
    });
  }

  async function secText(url, { cacheTtlMs = 0 } = {}) {
    return withCache(responseCache, url, cacheTtlMs, async () => {
      const response = await fetchWithRetry(
        url,
        {
          method: "GET",
          headers: {
            "user-agent": config.userAgent,
            accept: "application/json,text/html;q=0.9,*/*;q=0.8"
          }
        },
        config,
        limiter
      );

      if (!response.ok) {
        throw new Error(`SEC request failed (${response.status}) for ${url}`);
      }

      return response.text();
    });
  }

  return {
    async fetchTickerSnapshot() {
      return secJson("https://www.sec.gov/files/company_tickers_exchange.json", {
        cacheTtlMs: CACHE_TTL.tickerSnapshot
      });
    },

    async fetchSubmissions(cik, options = {}) {
      const root = await secJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
        cacheTtlMs: CACHE_TTL.submissions
      });

      return options.includeHistory === true ? expandSubmissionHistory(root, secJson) : root;
    },

    async fetchFiling({ cik, accessionNumber, primaryDocument }) {
      const accessionNoDash = String(accessionNumber).replaceAll("-", "");
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDash}/${primaryDocument}`;
      const html = await secText(url, { cacheTtlMs: CACHE_TTL.filing });
      return { html, primaryDocumentUrl: url };
    },

    async fetchFilingAssets({ cik, accessionNumber, primaryDocument, tags }) {
      const [filing, metrics] = await Promise.all([
        this.fetchFiling({ cik, accessionNumber, primaryDocument }),
        this.fetchMetrics({ cik, tags })
      ]);

      return {
        html: filing.html,
        primaryDocumentUrl: filing.primaryDocumentUrl,
        concepts: metrics.concepts,
        companyFacts: metrics.companyFacts
      };
    },

    async fetchPreparedFiling({ cik, accessionNumber, primaryDocument, formType, tags }) {
      const [filing, metrics] = await Promise.all([
        this.fetchFiling({ cik, accessionNumber, primaryDocument }),
        this.fetchMetrics({ cik, tags })
      ]);
      const prepared = prepareFilingText(filing.html, formType);
      if (!prepared.result) {
        throw new Error("Failed to extract MD&A section");
      }

      return {
        primaryDocumentUrl: filing.primaryDocumentUrl,
        ...prepared.result,
        diagnostics: prepared.diagnostics,
        concepts: metrics.concepts,
        companyFacts: metrics.companyFacts
      };
    },

    async fetchMetrics({ cik, tags }) {
      const normalizedCik = String(cik).padStart(10, "0");
      const requestedTags = [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
      if (requestedTags.length === 0) {
        return { concepts: {}, companyFacts: null };
      }

      let companyFacts = null;
      let companyFactsError = null;
      try {
        companyFacts = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${normalizedCik}.json`, {
          cacheTtlMs: CACHE_TTL.companyFacts
        });
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

function extractRequestedConceptsFromCompanyFacts(companyFacts, tags) {
  const usGaap = companyFacts?.facts?.["us-gaap"];
  const concepts = {};
  const missingTags = [];

  for (const tag of tags) {
    if (usGaap && Object.prototype.hasOwnProperty.call(usGaap, tag)) {
      concepts[tag] = usGaap[tag];
      continue;
    }

    missingTags.push(tag);
  }

  return { concepts, missingTags };
}

async function fetchConceptFallbacks(normalizedCik, tags, secJson) {
  if (tags.length === 0) {
    return { concepts: {}, fulfilledCount: 0, failedCount: 0 };
  }

  const settled = await Promise.allSettled(
    tags.map(async (tag) => [
      tag,
      await secJson(
        `https://data.sec.gov/api/xbrl/companyconcept/CIK${normalizedCik}/us-gaap/${tag}.json`,
        {
          allowNotFound: true,
          cacheTtlMs: CACHE_TTL.concept
        }
      )
    ])
  );
  const concepts = {};
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

async function expandSubmissionHistory(root, secJson) {
  const recent = normalizeSubmissionRecent(root);
  if (!recent) {
    return root;
  }

  const files = Array.isArray(root?.filings?.files) ? root.filings.files : [];
  if (files.length === 0 || hasEnoughSupportedHistory(recent)) {
    return root;
  }

  const entries = toSubmissionEntries(recent);
  const cutoff = isoDateYearsAgo(SUBMISSIONS_LOOKBACK_YEARS);

  for (const file of files) {
    const fileName = typeof file?.name === "string" ? file.name.trim() : "";
    if (!fileName) {
      continue;
    }

    const fileTo = typeof file?.filingTo === "string" ? file.filingTo : "";
    const fileFrom = typeof file?.filingFrom === "string" ? file.filingFrom : "";
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
    ...root,
    filings: {
      ...(root?.filings ?? {}),
      recent: toSubmissionRecent(entries)
    }
  };
}

export function validateInternalToken(headers, config) {
  const configuredToken = config.internalToken?.trim();
  if (!configuredToken) {
    return false;
  }

  const token = headers["x-internal-token"];
  if (typeof token !== "string") {
    return false;
  }

  const suppliedToken = token.trim();
  const expectedBuffer = Buffer.from(configuredToken);
  const actualBuffer = Buffer.from(suppliedToken);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function fetchWithRetry(url, init, config, limiter) {
  let lastError = null;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    let timeout;
    try {
      await limiter.take();
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
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
    } catch (error) {
      lastError = error;
      if (attempt >= config.retryCount) {
        throw error;
      }
      await sleep(config.initialBackoffMs * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`Request failed for ${url}`);
}

async function withCache(cache, key, ttlMs, loader) {
  const cached = cache.get(key);
  if (cached) {
    if (cached.value !== undefined && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (cached.pending) {
      return cached.pending;
    }
  }

  const pending = (async () => {
    try {
      const value = await loader();
      if (ttlMs > 0) {
        setCacheEntry(cache, key, {
          value,
          expiresAt: Date.now() + ttlMs
        });
      } else {
        cache.delete(key);
      }
      return value;
    } catch (error) {
      if (cached?.value !== undefined) {
        setCacheEntry(cache, key, cached);
        return cached.value;
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

async function discardResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup before retrying a failed SEC response.
  }
}

function setCacheEntry(cache, key, entry) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, entry);
  pruneCache(cache);
}

function pruneCache(cache) {
  if (cache.size <= MAX_RESPONSE_CACHE_ENTRIES) {
    return;
  }

  for (const [key, entry] of cache) {
    if (cache.size <= MAX_RESPONSE_CACHE_ENTRIES) {
      return;
    }
    if (entry?.pending) {
      continue;
    }
    cache.delete(key);
  }
}

function normalizeSubmissionRecent(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const recent =
    payload?.filings?.recent && typeof payload.filings.recent === "object"
      ? payload.filings.recent
      : payload;

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

  // 5つの配列は同じ添字で1件の資料を表す。長さが揃わない応答を通すと
  // 種別と実体がずれた資料を掴みうるので弾く。
  // (Worker 内の複製 workers/src/lib/sec-fetcher-service.ts と同じ判定)
  const expectedLength = columns[0].length;
  if (!columns.every((column) => column.length === expectedLength)) {
    return null;
  }

  return recent;
}

function toSubmissionEntries(recent) {
  const entries = [];
  const seen = new Set();

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

function toSubmissionRecent(entries) {
  const deduped = [];
  const seen = new Set();

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

function hasEnoughSupportedHistory(recent) {
  return hasEnoughSupportedHistoryEntries(toSubmissionEntries(recent));
}

function hasEnoughSupportedHistoryEntries(entries) {
  let tenKCount = 0;
  let tenQCount = 0;

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
    }
  }

  return tenKCount >= MIN_RECENT_10K_FILINGS && tenQCount >= MIN_RECENT_10Q_FILINGS;
}

function isoDateYearsAgo(years) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function shouldRetryResponse(response) {
  return response.status === 429 || response.status >= 500;
}

function createRateLimiter(limitPerSecond) {
  const issuedAt = [];

  return {
    async take() {
      while (true) {
        const now = Date.now();
        while (issuedAt.length > 0 && now - issuedAt[0] >= 1000) {
          issuedAt.shift();
        }

        if (issuedAt.length < limitPerSecond) {
          issuedAt.push(now);
          return;
        }

        const waitMs = Math.max(25, 1000 - (now - issuedAt[0]));
        await sleep(waitMs);
      }
    }
  };
}

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
