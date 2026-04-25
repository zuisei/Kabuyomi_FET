import type { Env, FilingReference } from "../env";
import { AppError } from "../lib/errors";
import { logErrorEvent } from "../lib/logging";
import type {
  CompanyFactsResponse,
  ConceptResponse,
  FilingHtmlResponse,
  SubmissionResponse,
  TickerSnapshotEnvelope
} from "./sec";

export interface MetricsFetcherResponse {
  concepts: Record<string, ConceptResponse | null>;
  companyFacts: CompanyFactsResponse | null;
}

export interface FilingAssetsFetcherResponse extends MetricsFetcherResponse {
  html: string;
  primaryDocumentUrl: string;
}

export interface FetchSubmissionsOptions {
  includeHistory?: boolean;
}

const DEFAULT_FETCHER_TIMEOUT_MS = 25_000;
const DEFAULT_FETCHER_RETRY_COUNT = 1;
const SEC_RATE_LIMITER_NAME = "global";

export async function fetchTickerSnapshotFromFetcher(env: Env): Promise<TickerSnapshotEnvelope> {
  return fetcherRequest(env, "/internal/sec/tickers-snapshot", {});
}

export async function fetchSubmissionsFromFetcher(
  cik: string,
  env: Env,
  options: FetchSubmissionsOptions = {}
): Promise<SubmissionResponse> {
  return fetcherRequest(env, "/internal/sec/submissions", {
    cik,
    includeHistory: options.includeHistory === true
  });
}

export async function fetchFilingHtmlFromFetcher(filing: FilingReference, env: Env): Promise<FilingHtmlResponse> {
  return fetcherRequest(env, "/internal/sec/filing", {
    cik: filing.cik,
    accessionNumber: filing.accessionNumber,
    primaryDocument: filing.primaryDocument
  });
}

export async function fetchMetricsFromFetcher(
  cik: string,
  tags: string[],
  env: Env
): Promise<MetricsFetcherResponse> {
  return fetcherRequest(env, "/internal/sec/metrics", { cik, tags });
}

export async function fetchFilingAssetsFromFetcher(
  filing: FilingReference,
  tags: string[],
  env: Env
): Promise<FilingAssetsFetcherResponse> {
  const payload = {
    cik: filing.cik,
    accessionNumber: filing.accessionNumber,
    primaryDocument: filing.primaryDocument,
    tags
  };

  try {
    return await fetcherRequest(env, "/internal/sec/filing-assets", payload);
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 502) {
      throw error;
    }

    if (!/failed \(404\) for \/internal\/sec\/filing-assets/i.test(error.message)) {
      throw error;
    }

    const [filingResponse, metricsResponse] = await Promise.all([
      fetchFilingHtmlFromFetcher(filing, env),
      fetchMetricsFromFetcher(filing.cik, tags, env)
    ]);

    return {
      html: filingResponse.html,
      primaryDocumentUrl: filingResponse.primaryDocumentUrl,
      concepts: metricsResponse.concepts,
      companyFacts: metricsResponse.companyFacts
    };
  }
}

async function fetcherRequest<ResponseType>(
  env: Env,
  path: string,
  payload: Record<string, unknown>
): Promise<ResponseType> {
  if (!env.SEC_FETCHER_BASE_URL) {
    throw new AppError(503, "SEC data is temporarily unavailable", "SEC fetcher base URL is not configured");
  }

  const timeoutMs = parsePositiveInt(env.SEC_FETCHER_TIMEOUT_MS, DEFAULT_FETCHER_TIMEOUT_MS);
  let lastError: unknown;

  for (let attempt = 0; attempt <= DEFAULT_FETCHER_RETRY_COUNT; attempt += 1) {
    const headers = new Headers({ "content-type": "application/json" });
    if (env.SEC_FETCHER_SHARED_SECRET) {
      headers.set("x-internal-token", env.SEC_FETCHER_SHARED_SECRET);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await waitForSecRateLimit(env, path);
      const response = await fetch(new URL(path, env.SEC_FETCHER_BASE_URL).toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new AppError(
          response.status >= 500 ? 503 : 502,
          "SEC data is temporarily unavailable",
          `SEC fetcher request failed (${response.status}) for ${path}: ${text}`
        );
        logErrorEvent("sec_fetcher_failure", {
          path,
          attempt,
          status: response.status,
          retryable,
          reason: `http_${response.status}`
        });
        if (retryable && attempt < DEFAULT_FETCHER_RETRY_COUNT) {
          continue;
        }
        throw lastError;
      }

      return JSON.parse(text) as ResponseType;
    } catch (error) {
      lastError = error;
      const timedOut =
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof DOMException && error.name === "AbortError");
      if ((timedOut || !(error instanceof AppError)) && attempt < DEFAULT_FETCHER_RETRY_COUNT) {
        continue;
      }

      if (timedOut) {
        logErrorEvent("sec_fetcher_failure", {
          path,
          attempt,
          reason: "timeout",
          timeoutMs
        });
        throw new AppError(
          503,
          "SEC data is temporarily unavailable",
          `SEC fetcher request timed out after ${timeoutMs}ms for ${path}`
        );
      }

      if (error instanceof AppError) {
        throw error;
      }

      logErrorEvent("sec_fetcher_failure", {
        path,
        attempt,
        reason: String(error)
      });
      throw new AppError(
        503,
        "SEC data is temporarily unavailable",
        `SEC fetcher request failed for ${path}: ${String(error)}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof AppError) {
    throw lastError;
  }

  throw new AppError(503, "SEC data is temporarily unavailable", `SEC fetcher request failed for ${path}`);
}

async function waitForSecRateLimit(env: Env, path: string): Promise<void> {
  if (!env.SEC_RATE_LIMITER) {
    return;
  }

  const tokens = path === "/internal/sec/filing-assets" ? 2 : 1;
  const response = await env.SEC_RATE_LIMITER.getByName(SEC_RATE_LIMITER_NAME).fetch(
    `https://do/sec-rate-limit?tokens=${tokens}`
  );
  if (!response.ok) {
    throw new AppError(503, "SEC data is temporarily unavailable", "SEC rate limiter request failed");
  }
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
