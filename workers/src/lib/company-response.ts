import type { Env, FilingCacheRecord } from "../env";
import { loadHistoricalOverview } from "./history-store";

export async function serializeCompanyResponse(
  filing: FilingCacheRecord,
  env: Partial<Env> = {},
  options: { displayTicker?: string; allowHistoricalPersistence?: boolean } = {}
) {
  const historicalOverview = await loadHistoricalOverview(filing, env, {
    allowPersistence: options.allowHistoricalPersistence ?? false
  });

  return {
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
}
