const DEFAULT_USER_AGENT = "Kabuyomi admin@kabuyomi.app";

export function readConfig(env = process.env) {
  return {
    internalToken: env.SEC_FETCHER_SHARED_SECRET ?? "",
    userAgent: env.SEC_USER_AGENT ?? DEFAULT_USER_AGENT,
    rateLimitPerSecond: parsePositiveInt(env.SEC_RATE_LIMIT_PER_SECOND, 8),
    retryCount: parsePositiveInt(env.SEC_FETCHER_RETRY_COUNT, 2),
    initialBackoffMs: parsePositiveInt(env.SEC_FETCHER_INITIAL_BACKOFF_MS, 400)
  };
}

export function createSecService(config = readConfig()) {
  const limiter = createRateLimiter(config.rateLimitPerSecond);

  async function secJson(url, { allowNotFound = false } = {}) {
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
  }

  async function secText(url) {
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
  }

  return {
    async fetchTickerSnapshot() {
      return secJson("https://www.sec.gov/files/company_tickers_exchange.json");
    },

    async fetchSubmissions(cik) {
      return secJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
    },

    async fetchFiling({ cik, accessionNumber, primaryDocument }) {
      const accessionNoDash = String(accessionNumber).replaceAll("-", "");
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDash}/${primaryDocument}`;
      const html = await secText(url);
      return { html, primaryDocumentUrl: url };
    },

    async fetchMetrics({ cik, tags }) {
      const concepts = {};

      for (const tag of tags) {
        concepts[tag] = await secJson(
          `https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/us-gaap/${tag}.json`,
          { allowNotFound: true }
        );
      }

      const companyFacts =
        tags.length > 0
          ? await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`)
          : null;

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
    try {
      await limiter.take();
      const response = await fetch(url, init);
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
    }
  }

  throw lastError ?? new Error(`Request failed for ${url}`);
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
