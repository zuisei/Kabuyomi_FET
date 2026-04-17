import type { FilingCacheRecord } from "../env";

export function serializeCompanyResponse(filing: FilingCacheRecord) {
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
    sourceChunks: filing.sourceChunks,
    lastUpdatedAt: filing.generatedAt
  };
}
