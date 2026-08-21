import type { Env, FilingReference } from "../env";
import { AppError } from "../lib/errors";
import { logErrorEvent } from "../lib/logging";
import { createCloudflareSecFetcherService } from "../lib/sec-fetcher-service";
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

export interface PreparedFilingFetcherResponse extends MetricsFetcherResponse {
  primaryDocumentUrl: string;
  mdaText: string;
  mdaTokenCount: number;
  supplementalEvidenceText?: string;
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

export interface FetchSubmissionsOptions {
  includeHistory?: boolean;
}

const DEFAULT_FETCHER_TIMEOUT_MS = 25_000;
const DEFAULT_FETCHER_RETRY_COUNT = 1;
const SEC_RATE_LIMITER_NAME = "global";
const CLOUDFLARE_INTERNAL_FETCHER = "cloudflare-internal";

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

export async function fetchPreparedFilingFromFetcher(
  filing: FilingReference,
  tags: string[],
  env: Env
): Promise<PreparedFilingFetcherResponse | null> {
  const payload = {
    cik: filing.cik,
    accessionNumber: filing.accessionNumber,
    primaryDocument: filing.primaryDocument,
    formType: filing.formType,
    tags
  };

  try {
    return await fetcherRequest(env, "/internal/sec/prepared-filing", payload);
  } catch (error) {
    if (
      error instanceof AppError &&
      error.status === 502 &&
      /failed \(404\) for \/internal\/sec\/prepared-filing/i.test(error.message)
    ) {
      return null;
    }
    throw error;
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

  if (env.SEC_FETCHER_BASE_URL.trim() === CLOUDFLARE_INTERNAL_FETCHER) {
    return fetchFromCloudflareInternalSecFetcher(env, path, payload) as Promise<ResponseType>;
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

async function fetchFromCloudflareInternalSecFetcher(
  env: Env,
  path: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  try {
    // 課金は「実際に SEC を叩く直前」の1点だけに寄せる。1 HTTP リクエスト = 1トークン。
    //
    // 以前は経路の入口で 1〜2トークンをまとめて払っていたが、
    // (a) `fetchWithRetry` の再試行が1トークンも払わずに SEC を叩けてしまい、
    // (b) 逆にキャッシュヒットで SEC を叩かない場合でも払っていた。
    // どちらも実リクエスト数とずれる。入口の課金は残さない
    // (残すと1リクエストに2トークン払うことになり、予算が実質半分になる)。
    const service = createCloudflareSecFetcherService(env, {
      beforeAttempt: () => waitForSecRateLimit(env, path, 1)
    });

    if (path === "/internal/sec/tickers-snapshot") {
      return service.fetchTickerSnapshot();
    }

    if (path === "/internal/sec/submissions") {
      return service.fetchSubmissions(String(payload.cik ?? ""), {
        includeHistory: payload.includeHistory === true
      });
    }

    if (path === "/internal/sec/filing") {
      return service.fetchFiling({
        cik: String(payload.cik ?? ""),
        accessionNumber: String(payload.accessionNumber ?? ""),
        primaryDocument: String(payload.primaryDocument ?? "")
      });
    }

    if (path === "/internal/sec/metrics") {
      return service.fetchMetrics({
        cik: String(payload.cik ?? ""),
        tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : []
      });
    }

    if (path === "/internal/sec/filing-assets") {
      return service.fetchFilingAssets({
        cik: String(payload.cik ?? ""),
        accessionNumber: String(payload.accessionNumber ?? ""),
        primaryDocument: String(payload.primaryDocument ?? ""),
        tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : []
      });
    }

    if (path === "/internal/sec/prepared-filing") {
      const formType = payload.formType === "10-K" || payload.formType === "10-Q" ? payload.formType : null;
      if (!formType) {
        throw new AppError(400, "Invalid SEC fetcher payload", "prepared filing formType must be 10-K or 10-Q");
      }

      return service.fetchPreparedFiling({
        cik: String(payload.cik ?? ""),
        accessionNumber: String(payload.accessionNumber ?? ""),
        primaryDocument: String(payload.primaryDocument ?? ""),
        formType,
        tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : []
      });
    }

    throw new AppError(404, "Not found", `Cloudflare internal SEC fetcher path is not supported: ${path}`);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logErrorEvent("sec_fetcher_failure", {
      path,
      attempt: 0,
      reason: String(error),
      mode: CLOUDFLARE_INTERNAL_FETCHER
    });
    throw new AppError(
      503,
      "SEC data is temporarily unavailable",
      `Cloudflare internal SEC fetcher request failed for ${path}: ${String(error)}`
    );
  }
}

async function waitForSecRateLimit(env: Env, path: string, overrideTokens?: number): Promise<void> {
  if (!env.SEC_RATE_LIMITER) {
    logErrorEvent("sec_rate_limiter_missing", {
      path,
      environment: env.KABUYOMI_ENV ?? env.ENVIRONMENT ?? "unknown",
      behavior: isTestEnvironment(env) ? "test_bypass" : "fail_closed"
    });
    if (!isTestEnvironment(env)) {
      throw new AppError(503, "SEC data is temporarily unavailable", "SEC rate limiter binding is missing");
    }
    return;
  }

  const tokens = overrideTokens ??
    (path === "/internal/sec/filing-assets" || path === "/internal/sec/prepared-filing" ? 2 : 1);
  const response = await env.SEC_RATE_LIMITER.getByName(SEC_RATE_LIMITER_NAME).fetch(
    `https://do/sec-rate-limit?tokens=${tokens}`
  );
  if (!response.ok) {
    throw new AppError(503, "SEC data is temporarily unavailable", "SEC rate limiter request failed");
  }
}

function isTestEnvironment(env: Env): boolean {
  if (env.KABUYOMI_ENV === "test" || env.ENVIRONMENT === "test") {
    return true;
  }
  return !env.KABUYOMI_ENV && !env.ENVIRONMENT;
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
