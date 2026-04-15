const DEFAULT_USER_AGENT = "Kabuyomi admin@kabuyomi.app";
const CACHE_TTL = {
  tickerSnapshot: 24 * 60 * 60 * 1000,
  submissions: 30 * 60 * 1000,
  filing: 24 * 60 * 60 * 1000,
  concept: 6 * 60 * 60 * 1000,
  companyFacts: 6 * 60 * 60 * 1000
};

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

    async fetchSubmissions(cik) {
      return secJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
        cacheTtlMs: CACHE_TTL.submissions
      });
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

    async fetchMetrics({ cik, tags }) {
      const normalizedCik = String(cik).padStart(10, "0");
      const conceptEntriesPromise = Promise.all(
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

      const companyFactsPromise =
        tags.length > 0
          ? secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${normalizedCik}.json`, {
              cacheTtlMs: CACHE_TTL.companyFacts
            })
          : Promise.resolve(null);

      const [conceptEntries, companyFacts] = await Promise.all([conceptEntriesPromise, companyFactsPromise]);
      const concepts = Object.fromEntries(conceptEntries);

      return { concepts, companyFacts };
    }
  };
}

export function validateInternalToken(headers, config) {
  if (!config.internalToken) {
    return true;
  }

  const token = headers["x-internal-token"];
  return typeof token === "string" && token === config.internalToken;
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
        cache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs
        });
      } else {
        cache.delete(key);
      }
      return value;
    } catch (error) {
      if (cached?.value !== undefined) {
        cache.set(key, cached);
        return cached.value;
      }
      cache.delete(key);
      throw error;
    }
  })();

  cache.set(key, {
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
