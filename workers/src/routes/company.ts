import { ensureLatestFiling } from "../lib/pipeline";
import { ensureCompanyAccessAllowed, readQuotaIdentity } from "../lib/quota";
import { badRequest, json } from "../lib/response";
import { isAppError } from "../lib/errors";
import { serializeCompanyResponse } from "../lib/company-response";
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
    const identity = await readQuotaIdentity(request, {
      requireDeviceKey: true,
      allowDebugUnlimited: true
    });
    await ensureCompanyAccessAllowed(identity, ticker, STARTER_TICKERS, env, config);
    const filing = await ensureLatestFiling(ticker, env, config, { executionContext: ctx });
    return json(await serializeCompanyResponse(filing, env));
  }

  if (request.method === "POST" && url.pathname.endsWith("/refresh")) {
    const identity = await readQuotaIdentity(request, {
      requireDeviceKey: true,
      allowDebugUnlimited: true
    });
    await ensureCompanyAccessAllowed(identity, ticker, STARTER_TICKERS, env, config);
    let filing;
    try {
      filing = await ensureLatestFiling(ticker, env, config, { forceRemoteCheck: true, executionContext: ctx });
    } catch (error) {
      if (isAppError(error) && error.status >= 500) {
        filing = await ensureLatestFiling(ticker, env, config, { executionContext: ctx });
      } else {
        throw error;
      }
    }

    return json(await serializeCompanyResponse(filing, env));
  }

  return null;
};
