import { lookupTicker } from "../../clients/sec";
import type { Env, FilingCacheRecord, TickerRecord } from "../../env";
import { isAppError } from "../errors";
import { serializeCompanyResponse } from "../company-response";
import { loadCachedLatestFiling } from "../filings/cache";
import { ensureLatestFiling } from "../filings/latest";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
import { readQuotaIdentity } from "../quota";
import type { RemoteConfig } from "../remote-config";

const COMPANY_RETRY_AFTER_SECONDS = 60;
const RETRYABLE_COMPANY_MESSAGE = "SEC data is temporarily unavailable";

type CompanyMode = "view" | "refresh";

export type CompanyUsecaseResult =
  | {
      kind: "ok";
      body: unknown;
    }
  | {
      kind: "not_found";
      message: string;
    };

export async function loadCompanyUsecase(input: CompanyUsecaseInput): Promise<CompanyUsecaseResult> {
  return runCompanyUsecase({
    ...input,
    mode: "view",
    forceRemoteCheck: false
  });
}

export async function refreshCompanyUsecase(input: CompanyUsecaseInput): Promise<CompanyUsecaseResult> {
  return runCompanyUsecase({
    ...input,
    mode: "refresh",
    forceRemoteCheck: true
  });
}

interface CompanyUsecaseInput {
  request: Request;
  ticker: string;
  env: Env;
  config: RemoteConfig;
  ctx: Pick<ExecutionContext, "waitUntil">;
}

interface RunCompanyUsecaseInput extends CompanyUsecaseInput {
  mode: CompanyMode;
  forceRemoteCheck: boolean;
}

async function runCompanyUsecase({
  request,
  ticker,
  env,
  config,
  ctx,
  mode,
  forceRemoteCheck
}: RunCompanyUsecaseInput): Promise<CompanyUsecaseResult> {
  let fallbackTicker: string | null = null;
  try {
    const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
    const tickerRecord = await lookupTicker(ticker, env);
    if (!tickerRecord) {
      return { kind: "not_found", message: `Ticker not found: ${ticker}` };
    }

    fallbackTicker = tickerRecord.ticker;
    const filingOrFallback = await loadLatestCompanyFiling({
      tickerRecord,
      env,
      config,
      ctx,
      mode,
      forceRemoteCheck
    });
    if ("body" in filingOrFallback) {
      return { kind: "ok", body: filingOrFallback.body };
    }

    logEvent("company_load_success", {
      ticker: tickerRecord.ticker,
      mode,
      identityKind: identity.identityKind,
      filingKey: filingOrFallback.filing.filingKey
    });
    return {
      kind: "ok",
      body: await serializeCompanyResponse(filingOrFallback.filing, env, {
        displayTicker: tickerRecord.ticker,
        allowHistoricalPersistence: true
      })
    };
  } catch (error) {
    if (fallbackTicker && isRetryableCompanyLoadError(error)) {
      return {
        kind: "ok",
        body: await buildRetryableCompanyBody(fallbackTicker, env, config)
      };
    }

    logErrorEvent("company_load_failure", {
      ticker: ticker.trim().toUpperCase(),
      mode,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function loadLatestCompanyFiling({
  tickerRecord,
  env,
  config,
  ctx,
  mode,
  forceRemoteCheck
}: {
  tickerRecord: TickerRecord;
  env: Env;
  config: RemoteConfig;
  ctx: Pick<ExecutionContext, "waitUntil">;
  mode: CompanyMode;
  forceRemoteCheck: boolean;
}): Promise<{ filing: FilingCacheRecord } | { body: unknown }> {
  try {
    const filing = await ensureLatestFiling(tickerRecord.ticker, env, config, {
      forceRemoteCheck,
      deferFullContent: true,
      executionContext: ctx,
      tickerRecord
    });
    return { filing };
  } catch (error) {
    if (mode === "refresh" && isRetryableCompanyLoadError(error)) {
      logWarnEvent("company_refresh_remote_fallback", {
        ticker: tickerRecord.ticker,
        reason: error instanceof Error ? error.message : String(error)
      });
      return { body: await buildRetryableCompanyBody(tickerRecord.ticker, env, config) };
    }

    throw error;
  }
}

function isRetryableCompanyLoadError(error: unknown): boolean {
  return isAppError(error) && error.status === 503;
}

async function buildRetryableCompanyBody(requestedTicker: string, env: Env, config: RemoteConfig): Promise<unknown> {
  const normalizedTicker = requestedTicker.trim().toUpperCase();
  try {
    const stale = await loadCachedLatestFiling(normalizedTicker, env, config);
    if (stale) {
      logWarnEvent("company_load_stale_fallback_used", {
        ticker: normalizedTicker,
        filingKey: stale.filingKey,
        reason: "retryable_upstream_failure"
      });
      return serializeCompanyResponse(stale, env, {
        displayTicker: normalizedTicker,
        allowHistoricalPersistence: true,
        status: "stale_ready",
        statusMessage: RETRYABLE_COMPANY_MESSAGE,
        retryAfterSeconds: COMPANY_RETRY_AFTER_SECONDS
      });
    }
  } catch (fallbackError) {
    logWarnEvent("company_load_stale_fallback_failed", {
      ticker: normalizedTicker,
      reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
    });
  }

  logWarnEvent("company_load_retryable_status_returned", {
    ticker: normalizedTicker,
    reason: "retryable_upstream_failure"
  });
  return {
    status: "failed_retryable",
    ticker: normalizedTicker,
    message: RETRYABLE_COMPANY_MESSAGE,
    retryAfterSeconds: COMPANY_RETRY_AFTER_SECONDS
  };
}
