import { generateModelSummary } from "../../clients/llm/provider";
import { fetchFilingHtml } from "../../clients/sec";
import type { Env, FilingCacheRecord, FilingReference } from "../../env";
import { extractMDASectionWithDiagnostics, normalizeFilingText } from "../../extractors/mda";
import { buildArchiveObjectKey, upsertHistoricalIndex } from "../history-store";
import { logLlmUsage } from "../llm-usage";
import { logErrorEvent, logEvent } from "../logging";
import { loadFilingByKey } from "./cache";
import { extractCompanyWebsiteUrl } from "./company-website";
import { buildSourceChunks, hasStrongMarginDriverSource, hasStrongRevenueDriverSource } from "./ingest";
import { acquireFilingLock } from "./lock";

export function isMetricsOnlyRecord(record: FilingCacheRecord): boolean {
  return record.contentMode === "metrics_only";
}

export function needsCompanyWebsiteBackfill(record: FilingCacheRecord): boolean {
  return !isMetricsOnlyRecord(record) && !record.companyWebsiteUrl;
}

export function needsRevenueDriverSourceBackfill(record: FilingCacheRecord): boolean {
  if (isMetricsOnlyRecord(record)) {
    return false;
  }
  const hasRevenueMetric = record.metrics.some((metric) => metric.logicalName === "revenue");
  if (!hasRevenueMetric) {
    return false;
  }
  return !record.sourceChunks.some(hasStrongRevenueDriverSource);
}

export function needsMarginSourceBackfill(record: FilingCacheRecord): boolean {
  if (isMetricsOnlyRecord(record)) {
    return false;
  }
  const hasProfitabilityMetric = record.metrics.some((metric) =>
    metric.logicalName === "operatingIncome" || metric.logicalName === "netIncome"
  );
  if (!hasProfitabilityMetric) {
    return false;
  }
  return !record.sourceChunks.some(hasStrongMarginDriverSource);
}

export function enqueueContentUpgrade(
  record: FilingCacheRecord,
  env: Env,
  executionContext?: Pick<ExecutionContext, "waitUntil">
): void {
  if (!executionContext || !isMetricsOnlyRecord(record)) {
    return;
  }

  executionContext.waitUntil(
    upgradeMetricsOnlyRecord(record, env).catch((error) => {
      logErrorEvent("filing_content_upgrade_failed", {
        filingKey: record.filingKey,
        ticker: record.ticker,
        reason: error instanceof Error ? error.message : String(error)
      });
    })
  );
}

export function enqueueCompanyWebsiteBackfill(
  record: FilingCacheRecord,
  env: Env,
  executionContext?: Pick<ExecutionContext, "waitUntil">
): void {
  if (!executionContext || !needsCompanyWebsiteBackfill(record)) {
    return;
  }

  executionContext.waitUntil(
    backfillCompanyWebsite(record, env).catch((error) => {
      logErrorEvent("filing_company_website_backfill_failed", {
        filingKey: record.filingKey,
        ticker: record.ticker,
        reason: error instanceof Error ? error.message : String(error)
      });
    })
  );
}

export async function upgradeMetricsOnlyRecord(record: FilingCacheRecord, env: Env): Promise<FilingCacheRecord | null> {
  if (!isMetricsOnlyRecord(record)) {
    return record;
  }

  const releaseLock = await acquireFilingLock(record.filingKey, env);
  try {
    const current = (await loadFilingByKey(record.filingKey, env)) ?? record;
    if (!isMetricsOnlyRecord(current)) {
      return current;
    }

    const filing = buildFilingReference(current);
    if (!filing) {
      logEvent("filing_content_upgrade_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "missing_filing_reference"
      });
      return null;
    }

    logEvent("filing_content_upgrade_attempted", {
      filingKey: current.filingKey,
      ticker: current.ticker
    });

    const html = await fetchFilingHtml(filing, env);
    const { result: extracted, diagnostics } = extractMDASectionWithDiagnostics(html, filing.formType);
    if (!extracted) {
      logEvent("filing_content_upgrade_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "mda_extraction_failed",
        inputHtmlChars: diagnostics.inputHtmlChars,
        normalizedChars: diagnostics.normalizedChars
      });
      return null;
    }

    const companyWebsiteUrl = extractCompanyWebsiteUrl(html, {
      companyName: current.companyName,
      primaryDocumentUrl: current.primaryDocumentUrl
    });
    const sourceChunks = buildSourceChunks(filing, extracted.text, current.metrics, {
      revenueDriverSearchText: normalizeFilingText(html),
      marginDriverSearchText: normalizeFilingText(html),
      primaryDocumentUrl: current.primaryDocumentUrl
    });
    const generated = await generateModelSummary(env, {
      filingKey: current.filingKey,
      ticker: current.ticker,
      companyName: current.companyName,
      formType: current.formType,
      filedAt: current.filedAt,
      periodOfReport: current.periodOfReport,
      metrics: current.metrics,
      sourceChunks
    });
    logLlmUsage(generated.llmUsage, {
      aiTask: "summary",
      route: "filing_content_upgrade",
      ticker: current.ticker,
      filingKey: current.filingKey,
      responsePath: generated.provider
    });

    const upgraded: FilingCacheRecord = {
      ...current,
      primaryDocumentUrl: current.primaryDocumentUrl,
      companyWebsiteUrl,
      mdaText: extracted.text,
      mdaTokenCount: extracted.tokenCount,
      sourceChunks,
      summary: generated.summary,
      summaryProvider: generated.provider,
      contentMode: "full",
      generatedAt: new Date().toISOString()
    };
    await persistUpgradedRecord(upgraded, env);

    logEvent("filing_content_upgraded", {
      filingKey: current.filingKey,
      ticker: current.ticker,
      summaryProvider: generated.provider,
      sourceChunkCount: sourceChunks.length,
      mdaTokenCount: extracted.tokenCount
    });

    return upgraded;
  } finally {
    await releaseLock();
  }
}

export async function backfillRevenueDriverSourceAssets(
  record: FilingCacheRecord,
  env: Env
): Promise<FilingCacheRecord> {
  if (!needsRevenueDriverSourceBackfill(record)) {
    return record;
  }

  const releaseLock = await acquireFilingLock(record.filingKey, env);
  try {
    const current = (await loadFilingByKey(record.filingKey, env)) ?? record;
    if (!needsRevenueDriverSourceBackfill(current)) {
      return current;
    }

    const filing = buildFilingReference(current);
    if (!filing) {
      logEvent("filing_revenue_driver_source_backfill_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "missing_filing_reference"
      });
      return current;
    }

    logEvent("filing_revenue_driver_source_backfill_attempted", {
      filingKey: current.filingKey,
      ticker: current.ticker
    });

    const html = await fetchFilingHtml(filing, env);
    const { result: extracted, diagnostics } = extractMDASectionWithDiagnostics(html, filing.formType);
    if (!extracted) {
      logEvent("filing_revenue_driver_source_backfill_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "mda_extraction_failed",
        inputHtmlChars: diagnostics.inputHtmlChars,
        normalizedChars: diagnostics.normalizedChars
      });
      return current;
    }

    const sourceChunks = buildSourceChunks(filing, extracted.text, current.metrics, {
      revenueDriverSearchText: normalizeFilingText(html),
      marginDriverSearchText: normalizeFilingText(html),
      primaryDocumentUrl: current.primaryDocumentUrl
    });
    const upgraded: FilingCacheRecord = {
      ...current,
      mdaText: extracted.text,
      mdaTokenCount: extracted.tokenCount,
      sourceChunks,
      contentMode: "full",
      generatedAt: new Date().toISOString()
    };
    await persistUpgradedRecord(upgraded, env);

    logEvent("filing_revenue_driver_source_backfilled", {
      filingKey: current.filingKey,
      ticker: current.ticker,
      sourceChunkCount: sourceChunks.length,
      strongRevenueDriverSourceCount: sourceChunks.filter(hasStrongRevenueDriverSource).length,
      mdaTokenCount: extracted.tokenCount
    });

    return upgraded;
  } finally {
    await releaseLock();
  }
}

export async function backfillMarginSourceAssets(
  record: FilingCacheRecord,
  env: Env
): Promise<FilingCacheRecord> {
  if (!needsMarginSourceBackfill(record)) {
    return record;
  }

  const releaseLock = await acquireFilingLock(record.filingKey, env);
  try {
    const current = (await loadFilingByKey(record.filingKey, env)) ?? record;
    if (!needsMarginSourceBackfill(current)) {
      return current;
    }

    const filing = buildFilingReference(current);
    if (!filing) {
      logEvent("filing_margin_source_backfill_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "missing_filing_reference"
      });
      return current;
    }

    logEvent("filing_margin_source_backfill_attempted", {
      filingKey: current.filingKey,
      ticker: current.ticker
    });

    const html = await fetchFilingHtml(filing, env);
    const normalizedHtml = normalizeFilingText(html);
    const { result: extracted, diagnostics } = extractMDASectionWithDiagnostics(html, filing.formType);
    if (!extracted) {
      logEvent("filing_margin_source_backfill_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "mda_extraction_failed",
        inputHtmlChars: diagnostics.inputHtmlChars,
        normalizedChars: diagnostics.normalizedChars
      });
      return current;
    }

    const sourceChunks = buildSourceChunks(filing, extracted.text, current.metrics, {
      revenueDriverSearchText: normalizedHtml,
      marginDriverSearchText: normalizedHtml,
      primaryDocumentUrl: current.primaryDocumentUrl
    });
    const upgraded: FilingCacheRecord = {
      ...current,
      mdaText: extracted.text,
      mdaTokenCount: extracted.tokenCount,
      sourceChunks,
      contentMode: "full",
      generatedAt: new Date().toISOString()
    };
    await persistUpgradedRecord(upgraded, env);

    logEvent("filing_margin_source_backfilled", {
      filingKey: current.filingKey,
      ticker: current.ticker,
      sourceChunkCount: sourceChunks.length,
      strongMarginSourceCount: sourceChunks.filter(hasStrongMarginDriverSource).length,
      mdaTokenCount: extracted.tokenCount
    });

    return upgraded;
  } finally {
    await releaseLock();
  }
}

export async function backfillCompanyWebsite(record: FilingCacheRecord, env: Env): Promise<FilingCacheRecord> {
  if (!needsCompanyWebsiteBackfill(record)) {
    return record;
  }

  const releaseLock = await acquireFilingLock(record.filingKey, env);
  try {
    const current = (await loadFilingByKey(record.filingKey, env)) ?? record;
    if (!needsCompanyWebsiteBackfill(current)) {
      return current;
    }

    const filing = buildFilingReference(current);
    if (!filing) {
      logEvent("filing_company_website_backfill_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "missing_filing_reference"
      });
      return current;
    }

    logEvent("filing_company_website_backfill_attempted", {
      filingKey: current.filingKey,
      ticker: current.ticker
    });

    const html = await fetchFilingHtml(filing, env);
    const companyWebsiteUrl = extractCompanyWebsiteUrl(html, {
      companyName: current.companyName,
      primaryDocumentUrl: current.primaryDocumentUrl
    });
    if (!companyWebsiteUrl) {
      logEvent("filing_company_website_backfill_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "website_not_found"
      });
      return current;
    }

    const upgraded: FilingCacheRecord = {
      ...current,
      companyWebsiteUrl
    };
    await persistUpgradedRecord(upgraded, env);

    logEvent("filing_company_website_backfilled", {
      filingKey: current.filingKey,
      ticker: current.ticker,
      companyWebsiteUrl
    });

    return upgraded;
  } finally {
    await releaseLock();
  }
}

function buildFilingReference(record: FilingCacheRecord): FilingReference | null {
  const [, , rawAccession] = record.filingKey.split(":");
  const primaryDocument = extractPrimaryDocumentName(record.primaryDocumentUrl);
  if (!rawAccession || !primaryDocument) {
    return null;
  }

  return {
    cik: record.cik,
    ticker: record.ticker,
    companyName: record.companyName,
    exchange: "",
    formType: record.formType,
    accessionNumber: normalizeAccessionNumber(rawAccession),
    primaryDocument,
    filedAt: record.filedAt,
    periodOfReport: record.periodOfReport
  };
}

function extractPrimaryDocumentName(primaryDocumentUrl: string): string | null {
  try {
    const url = new URL(primaryDocumentUrl);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    return lastSegment || null;
  } catch {
    return null;
  }
}

function normalizeAccessionNumber(accessionNumber: string): string {
  const compact = accessionNumber.replaceAll("-", "");
  if (!/^\d{18}$/.test(compact)) {
    return accessionNumber;
  }

  return `${compact.slice(0, 10)}-${compact.slice(10, 12)}-${compact.slice(12)}`;
}

async function persistUpgradedRecord(record: FilingCacheRecord, env: Env): Promise<void> {
  const [, cik, accession] = record.filingKey.split(":");
  if (!cik || !accession) {
    return;
  }

  await Promise.all([
    env.FILINGS_BUCKET.put(buildArchiveObjectKey(record.filingKey), JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" }
    }),
    upsertHistoricalIndex(record, env)
  ]);
}
