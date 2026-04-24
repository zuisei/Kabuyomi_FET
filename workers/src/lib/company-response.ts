import type { Env, FilingCacheRecord } from "../env";
import { loadHistoricalOverview } from "./history-store";

export async function serializeCompanyResponse(
  filing: FilingCacheRecord,
  env: Partial<Env> = {},
  options: {
    displayTicker?: string;
    allowHistoricalPersistence?: boolean;
    status?: "ready" | "stale_ready";
    statusMessage?: string;
    retryAfterSeconds?: number;
  } = {}
) {
  const historicalOverview = await loadHistoricalOverview(filing, env, {
    allowPersistence: options.allowHistoricalPersistence ?? false
  });

  const payload = {
    filingKey: filing.filingKey,
    ticker: options.displayTicker ?? filing.ticker,
    companyName: filing.companyName,
    cik: filing.cik,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    primaryDocumentUrl: filing.primaryDocumentUrl,
    companyWebsiteUrl: filing.companyWebsiteUrl,
    summary: filing.summary,
    metrics: filing.metrics,
    historicalOverview,
    sourceChunks: filing.sourceChunks,
    lastUpdatedAt: filing.generatedAt
  };

  if (!options.status) {
    return payload;
  }

  return {
    ...payload,
    status: options.status,
    statusMessage: options.statusMessage,
    retryAfterSeconds: options.retryAfterSeconds
  };
}
