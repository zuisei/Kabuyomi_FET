import type { Env, FilingCacheRecord } from "../env";
import { loadHistoricalOverview } from "./history-store";

export async function serializeCompanyResponse(
  filing: FilingCacheRecord,
  env: Partial<Env> = {}
) {
  const historicalOverview = await loadHistoricalOverview(filing, env);

  return {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    companyName: filing.companyName,
    cik: filing.cik,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    primaryDocumentUrl: filing.primaryDocumentUrl,
    summary: filing.summary,
    metrics: filing.metrics,
    historicalOverview,
    sourceChunks: filing.sourceChunks,
    lastUpdatedAt: filing.generatedAt
  };
}
