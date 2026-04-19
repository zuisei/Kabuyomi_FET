import { lookupTicker } from "../clients/sec";
import { ensureLatestFiling } from "../lib/pipeline";
import { ensureCompanyAccessAllowed, readQuotaIdentity } from "../lib/quota";
import { badRequest, json, notFound } from "../lib/response";
import { isAppError } from "../lib/errors";
import { serializeCompanyResponse } from "../lib/company-response";
import { logErrorEvent, logEvent, logWarnEvent } from "../lib/logging";
import { STARTER_TICKERS } from "../lib/starter-tickers";
import type { RouteHandler } from "./types";

export const handleCompanyRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!url.pathname.startsWith("/v1/company/")) {
    return null;
  }

  const ticker = decodeURIComponent(url.pathname.split("/")[3] ?? "");
  if (!ticker) {
    return badRequest("Ticker is required");
  }

  if (request.method === "GET") {
    try {
      const identity = await readQuotaIdentity(request, env, {
        requireDeviceKey: true,
        allowDebugUnlimited: true
      });
      const normalizedRequestedTicker = ticker.trim().toUpperCase();
      const needsAliasResolution = /[.\-\s]/.test(normalizedRequestedTicker);
      if (!needsAliasResolution) {
        await ensureCompanyAccessAllowed(identity, normalizedRequestedTicker, STARTER_TICKERS, env, config);
      }
      const tickerRecord = await lookupTicker(ticker, env);
      if (!tickerRecord) {
        return notFound(`Ticker not found: ${ticker}`);
      }

      if (needsAliasResolution || tickerRecord.ticker !== normalizedRequestedTicker) {
        await ensureCompanyAccessAllowed(identity, tickerRecord.ticker, STARTER_TICKERS, env, config);
      }
      const filing = await ensureLatestFiling(tickerRecord.ticker, env, config, {
        executionContext: ctx,
        tickerRecord
      });
      logEvent("company_load_success", {
        ticker: tickerRecord.ticker,
        mode: "view",
        identityKind: identity.identityKind,
        filingKey: filing.filingKey
      });
      return json(await serializeCompanyResponse(filing, env, { displayTicker: tickerRecord.ticker }));
    } catch (error) {
      logErrorEvent("company_load_failure", {
        ticker: ticker.trim().toUpperCase(),
        mode: "view",
        reason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  if (request.method === "POST" && url.pathname.endsWith("/refresh")) {
    try {
      const identity = await readQuotaIdentity(request, env, {
        requireDeviceKey: true,
        allowDebugUnlimited: true
      });
      const normalizedRequestedTicker = ticker.trim().toUpperCase();
      const needsAliasResolution = /[.\-\s]/.test(normalizedRequestedTicker);
      if (!needsAliasResolution) {
        await ensureCompanyAccessAllowed(identity, normalizedRequestedTicker, STARTER_TICKERS, env, config);
      }
      const tickerRecord = await lookupTicker(ticker, env);
      if (!tickerRecord) {
        return notFound(`Ticker not found: ${ticker}`);
      }

      if (needsAliasResolution || tickerRecord.ticker !== normalizedRequestedTicker) {
        await ensureCompanyAccessAllowed(identity, tickerRecord.ticker, STARTER_TICKERS, env, config);
      }
      let filing;
      try {
        filing = await ensureLatestFiling(tickerRecord.ticker, env, config, {
          forceRemoteCheck: true,
          executionContext: ctx,
          tickerRecord
        });
      } catch (error) {
        if (isAppError(error) && error.status >= 500) {
          logWarnEvent("company_refresh_remote_fallback", {
            ticker: tickerRecord.ticker,
            reason: error.message
          });
          filing = await ensureLatestFiling(tickerRecord.ticker, env, config, {
            executionContext: ctx,
            tickerRecord
          });
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
      return json(await serializeCompanyResponse(filing, env, { displayTicker: tickerRecord.ticker }));
    } catch (error) {
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
