import { listTickersByCik, lookupTicker } from "../clients/sec";
import { ensureLatestFiling } from "../lib/pipeline";
import { ensureCompanyAccessAllowed, readQuotaIdentity } from "../lib/quota";
import { badRequest, json, notFound } from "../lib/response";
import { isAppError } from "../lib/errors";
import { serializeCompanyResponse } from "../lib/company-response";
import { loadCachedLatestFiling } from "../lib/filings/cache";
import { logErrorEvent, logEvent, logWarnEvent } from "../lib/logging";
import { STARTER_TICKERS } from "../lib/starter-tickers";
import type { RouteHandler } from "./types";

const COMPANY_RETRY_AFTER_SECONDS = 60;
const RETRYABLE_COMPANY_MESSAGE = "SEC data is temporarily unavailable";

export const handleCompanyRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!url.pathname.startsWith("/v1/company/")) {
    return null;
  }

  const ticker = decodeURIComponent(url.pathname.split("/")[3] ?? "");
  if (!ticker) {
    return badRequest("Ticker is required");
  }

  if (request.method === "GET") {
    let fallbackTicker: string | null = null;
    try {
      const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
      const tickerRecord = await lookupTicker(ticker, env);
      if (!tickerRecord) {
        return notFound(`Ticker not found: ${ticker}`);
      }
      const relatedTickers = await listTickersByCik(tickerRecord.cik, env);
      const normalizedRequestedTicker = ticker.trim().toUpperCase();
      const needsAliasResolution = /[.\-\s]/.test(normalizedRequestedTicker);
      if (!needsAliasResolution) {
        await ensureCompanyAccessAllowed(identity, normalizedRequestedTicker, STARTER_TICKERS, env, config, { relatedTickers });
      }

      if (needsAliasResolution || tickerRecord.ticker !== normalizedRequestedTicker) {
        await ensureCompanyAccessAllowed(identity, tickerRecord.ticker, STARTER_TICKERS, env, config, { relatedTickers });
      }
      fallbackTicker = tickerRecord.ticker;
      const filing = await ensureLatestFiling(tickerRecord.ticker, env, config, {
        deferFullContent: true,
        executionContext: ctx,
        tickerRecord
      });
      logEvent("company_load_success", {
        ticker: tickerRecord.ticker,
        mode: "view",
        identityKind: identity.identityKind,
        filingKey: filing.filingKey
      });
      return json(
        await serializeCompanyResponse(filing, env, {
          displayTicker: tickerRecord.ticker,
          allowHistoricalPersistence: true
        })
      );
    } catch (error) {
      if (fallbackTicker && isRetryableCompanyLoadError(error)) {
        const fallback = await buildRetryableCompanyResponse(fallbackTicker, env, config);
        if (fallback) {
          return fallback;
        }
      }

      logErrorEvent("company_load_failure", {
        ticker: ticker.trim().toUpperCase(),
        mode: "view",
        reason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  if (request.method === "POST" && url.pathname.endsWith("/refresh")) {
    let fallbackTicker: string | null = null;
    try {
      const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
      const tickerRecord = await lookupTicker(ticker, env);
      if (!tickerRecord) {
        return notFound(`Ticker not found: ${ticker}`);
      }
      const relatedTickers = await listTickersByCik(tickerRecord.cik, env);
      const normalizedRequestedTicker = ticker.trim().toUpperCase();
      const needsAliasResolution = /[.\-\s]/.test(normalizedRequestedTicker);
      if (!needsAliasResolution) {
        await ensureCompanyAccessAllowed(identity, normalizedRequestedTicker, STARTER_TICKERS, env, config, { relatedTickers });
      }

      if (needsAliasResolution || tickerRecord.ticker !== normalizedRequestedTicker) {
        await ensureCompanyAccessAllowed(identity, tickerRecord.ticker, STARTER_TICKERS, env, config, { relatedTickers });
      }
      fallbackTicker = tickerRecord.ticker;
      let filing;
      try {
        filing = await ensureLatestFiling(tickerRecord.ticker, env, config, {
          forceRemoteCheck: true,
          deferFullContent: true,
          executionContext: ctx,
          tickerRecord
        });
      } catch (error) {
        if (isRetryableCompanyLoadError(error)) {
          logWarnEvent("company_refresh_remote_fallback", {
            ticker: tickerRecord.ticker,
            reason: error instanceof Error ? error.message : String(error)
          });
          return await buildRetryableCompanyResponse(tickerRecord.ticker, env, config);
        } else {
          throw error;
        }
      }

      logEvent("company_load_success", {
        ticker: tickerRecord.ticker,
        mode: "refresh",
        identityKind: identity.identityKind,
        filingKey: filing.filingKey
      });
      return json(
        await serializeCompanyResponse(filing, env, {
          displayTicker: tickerRecord.ticker,
          allowHistoricalPersistence: true
        })
      );
    } catch (error) {
      if (fallbackTicker && isRetryableCompanyLoadError(error)) {
        const fallback = await buildRetryableCompanyResponse(fallbackTicker, env, config);
        if (fallback) {
          return fallback;
        }
      }

      logErrorEvent("company_load_failure", {
        ticker: ticker.trim().toUpperCase(),
        mode: "refresh",
        reason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  return null;
};

function isRetryableCompanyLoadError(error: unknown): boolean {
  return isAppError(error) && error.status === 503;
}

async function buildRetryableCompanyResponse(
  requestedTicker: string,
  env: Parameters<typeof loadCachedLatestFiling>[1],
  config: Parameters<typeof loadCachedLatestFiling>[2]
): Promise<Response | null> {
  const normalizedTicker = requestedTicker.trim().toUpperCase();
  try {
    const stale = await loadCachedLatestFiling(normalizedTicker, env, config);
    if (stale) {
      logWarnEvent("company_load_stale_fallback_used", {
        ticker: normalizedTicker,
        filingKey: stale.filingKey,
        reason: "retryable_upstream_failure"
      });
      return json(
        await serializeCompanyResponse(stale, env, {
          displayTicker: normalizedTicker,
          allowHistoricalPersistence: true,
          status: "stale_ready",
          statusMessage: RETRYABLE_COMPANY_MESSAGE,
          retryAfterSeconds: COMPANY_RETRY_AFTER_SECONDS
        })
      );
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
  return json({
    status: "failed_retryable",
    ticker: normalizedTicker,
    message: RETRYABLE_COMPANY_MESSAGE,
    retryAfterSeconds: COMPANY_RETRY_AFTER_SECONDS
  });
}
