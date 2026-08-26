import type { Env, FilingCacheRecord } from "../env";
import { computeDerivedMetrics } from "./derived-metrics";
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
    /// **保存せず、読み出しのたびに計算する。**`filing.metrics` だけから決まる値なので、
    /// 保存すると取り込み済みの資料が古い形のまま残り、キャッシュ世代を上げる羽目になる。
    /// 計算にして初めて、**既にある 500 件超の資料にも今日から出る**
    /// (利益率は既存の材料で出る。ROE / ROA / FCF は自己資本・総資産・設備投資を
    /// 取り始めた以降の取り込みから)。
    derivedMetrics: computeDerivedMetrics(filing.metrics),
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
