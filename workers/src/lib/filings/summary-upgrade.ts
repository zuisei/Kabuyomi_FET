import { generateSummary } from "../../clients/gemini";
import type { Env, FilingCacheRecord } from "../../env";
import { buildArchiveObjectKey } from "../history-store";
import { logLlmUsage } from "../llm-usage";
import { logErrorEvent, logEvent } from "../logging";
import { loadFilingByKey } from "./cache";
import { acquireFilingLock } from "./lock";

export function enqueueSummaryUpgrade(
  record: FilingCacheRecord,
  env: Env,
  executionContext?: Pick<ExecutionContext, "waitUntil">
): void {
  if (!executionContext || !env.GEMINI_API_KEY || record.summaryProvider !== "fallback" || record.contentMode === "metrics_only") {
    return;
  }

  executionContext.waitUntil(
    upgradeSummary(record, env).catch((error) => {
      logErrorEvent("filing_summary_upgrade_failed", {
        filingKey: record.filingKey,
        ticker: record.ticker,
        reason: error instanceof Error ? error.message : String(error)
      });
    })
  );
}

async function upgradeSummary(record: FilingCacheRecord, env: Env): Promise<void> {
  const releaseLock = await acquireFilingLock(record.filingKey, env);
  try {
    const current = (await loadFilingByKey(record.filingKey, env)) ?? record;
    if (current.summaryProvider === "gemini") {
      return;
    }

    logEvent("filing_summary_upgrade_attempted", {
      filingKey: current.filingKey,
      ticker: current.ticker
    });

    const generated = await generateSummary(env, {
      filingKey: current.filingKey,
      ticker: current.ticker,
      companyName: current.companyName,
      formType: current.formType,
      filedAt: current.filedAt,
      periodOfReport: current.periodOfReport,
      metrics: current.metrics,
      sourceChunks: current.sourceChunks
    });
    logLlmUsage(generated.llmUsage, {
      aiTask: "summary",
      route: "filing_summary_upgrade",
      ticker: current.ticker,
      filingKey: current.filingKey,
      responsePath: generated.provider
    });
    if (generated.provider !== "gemini") {
      logEvent("filing_summary_upgrade_skipped", {
        filingKey: current.filingKey,
        ticker: current.ticker,
        reason: "fallback_returned"
      });
      return;
    }

    const upgraded: FilingCacheRecord = {
      ...current,
      summary: generated.summary,
      summaryProvider: generated.provider
    };
    const [, cik, accessionNumber] = current.filingKey.split(":");
    if (!cik || !accessionNumber) {
      return;
    }

    await Promise.all([
      env.FILINGS_BUCKET.put(buildArchiveObjectKey(current.filingKey), JSON.stringify(upgraded), {
        httpMetadata: { contentType: "application/json" }
      })
    ]);

    logEvent("filing_summary_upgraded", {
      filingKey: current.filingKey,
      ticker: current.ticker
    });
  } finally {
    await releaseLock();
  }
}
