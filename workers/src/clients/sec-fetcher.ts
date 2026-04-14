import type { Env, FilingReference } from "../env";
import { AppError } from "../lib/errors";
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

export async function fetchTickerSnapshotFromFetcher(env: Env): Promise<TickerSnapshotEnvelope> {
  return fetcherRequest(env, "/internal/sec/tickers-snapshot", {});
}

export async function fetchSubmissionsFromFetcher(cik: string, env: Env): Promise<SubmissionResponse> {
  return fetcherRequest(env, "/internal/sec/submissions", { cik });
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

async function fetcherRequest<ResponseType>(
  env: Env,
  path: string,
  payload: Record<string, unknown>
): Promise<ResponseType> {
  if (!env.SEC_FETCHER_BASE_URL) {
    throw new AppError(503, "SEC data is temporarily unavailable", "SEC fetcher base URL is not configured");
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (env.SEC_FETCHER_SHARED_SECRET) {
    headers.set("x-internal-token", env.SEC_FETCHER_SHARED_SECRET);
  }

  const response = await fetch(new URL(path, env.SEC_FETCHER_BASE_URL).toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(
      response.status >= 500 ? 503 : 502,
      "SEC data is temporarily unavailable",
      `SEC fetcher request failed (${response.status}) for ${path}: ${text}`
    );
  }

  return JSON.parse(text) as ResponseType;
}
