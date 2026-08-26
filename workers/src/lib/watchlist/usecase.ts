import { listTickersByCik, lookupTicker, resolveLatestSearchFormType } from "../../clients/sec";
import { isSupportedFilingForm } from "../../env";
import type { Env, TickerRecord } from "../../env";
import { serializeCompanyResponse } from "../company-response";
import { AppError } from "../errors";
import { ensureLatestFiling } from "../filings/latest";
import {
  createFilingPrepJob,
  markFilingPrepJobFailed,
  markFilingPrepJobReady,
  type FilingPrepJobRecord
} from "../filings/prep-job-store";
import { logErrorEvent, logEvent } from "../logging";
import {
  consumeStockQuotaWithMutation,
  promoteSavedTickerAlias,
  readQuotaIdentity,
  refundStockQuota,
  type QuotaIdentity
} from "../quota";
import type { RemoteConfig } from "../remote-config";

const WATCHLIST_PREPARING_MESSAGE = "SEC filing is being prepared";
const WATCHLIST_PREPARING_RETRY_AFTER_SECONDS = 2;

export type WatchlistAddUsecaseResult =
  | {
      kind: "ok";
      body: unknown;
    }
  | {
      kind: "not_found";
      message: string;
    };

export interface WatchlistAddUsecaseInput {
  request: Request;
  ticker: string;
  asyncMode: boolean;
  env: Env;
  config: RemoteConfig;
  ctx: Pick<ExecutionContext, "waitUntil">;
}

export async function addWatchlistTickerUsecase({
  request,
  ticker,
  asyncMode,
  env,
  config,
  ctx
}: WatchlistAddUsecaseInput): Promise<WatchlistAddUsecaseResult> {
  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const tickerRecord = await lookupTicker(ticker, env);
  if (!tickerRecord) {
    return { kind: "not_found", message: `Ticker not found: ${ticker}` };
  }

  const relatedTickers = await listTickersByCik(tickerRecord.cik, env);
  if (asyncMode) {
    await assertAsyncFilingSupported(tickerRecord, env);
  }

  const stockQuota = await consumeStockQuotaWithMutation(identity, tickerRecord.ticker, env, config, { relatedTickers });
  if (asyncMode) {
    const usage = stockQuota.didMutate
      ? stockQuota.usage
      : await promoteSavedTickerAlias(identity, tickerRecord.ticker, env, config, { relatedTickers });
    const job = await createFilingPrepJob(env, {
      identity,
      tickerRecord,
      retryAfterSeconds: WATCHLIST_PREPARING_RETRY_AFTER_SECONDS
    });

    ctx.waitUntil(
      ensureLatestFiling(tickerRecord.ticker, env, config, {
        deferFullContent: true,
        executionContext: ctx,
        tickerRecord
      })
        .then((filing) => {
          return markFilingPrepJobReady(env, job.jobId, filing.filingKey).then(() => filing);
        })
        .then((filing) => {
          logEvent("watchlist_add_async_filing_ready", {
            jobId: job.jobId,
            ticker: tickerRecord.ticker,
            filingKey: filing.filingKey
          });
        })
        .catch((error) =>
          refundAsyncStockQuotaOnFailure({
            error,
            identity,
            tickerRecord,
            env,
            config,
            relatedTickers,
            job,
            didMutate: stockQuota.didMutate
          })
        )
    );

    return {
      kind: "ok",
      body: {
        status: "preparing",
        ticker: tickerRecord.ticker,
        companyName: tickerRecord.companyName,
        cik: tickerRecord.cik,
        message: WATCHLIST_PREPARING_MESSAGE,
        retryAfterSeconds: WATCHLIST_PREPARING_RETRY_AFTER_SECONDS,
        filingPrepJob: serializeFilingPrepJob(job),
        usage
      }
    };
  }

  const filing = await loadFilingForSavedTicker({
    identity,
    tickerRecord,
    env,
    config,
    ctx,
    relatedTickers,
    didMutate: stockQuota.didMutate
  });
  const usage = stockQuota.didMutate
    ? stockQuota.usage
    : await promoteSavedTickerAlias(identity, tickerRecord.ticker, env, config, { relatedTickers });

  return {
    kind: "ok",
    body: {
      company: await serializeCompanyResponse(filing, env, {
        displayTicker: tickerRecord.ticker,
        allowHistoricalPersistence: true
      }),
      usage
    }
  };
}

async function assertAsyncFilingSupported(tickerRecord: TickerRecord, env: Env): Promise<void> {
  const latestFormType = await resolveLatestSearchFormType(tickerRecord, env);
  if (!isSupportedFilingForm(latestFormType)) {
    logEvent("watchlist_add_async_unsupported_filing", {
      ticker: tickerRecord.ticker,
      cik: tickerRecord.cik,
      latestFormType: latestFormType ?? "unknown"
    });
    throw new AppError(422, `No supported filing found for ${tickerRecord.ticker}`);
  }
}

async function loadFilingForSavedTicker({
  identity,
  tickerRecord,
  env,
  config,
  ctx,
  relatedTickers,
  didMutate
}: {
  identity: QuotaIdentity;
  tickerRecord: TickerRecord;
  env: Env;
  config: RemoteConfig;
  ctx: Pick<ExecutionContext, "waitUntil">;
  relatedTickers: string[];
  didMutate: boolean;
}) {
  try {
    return await ensureLatestFiling(tickerRecord.ticker, env, config, {
      deferFullContent: true,
      executionContext: ctx,
      tickerRecord
    });
  } catch (error) {
    if (didMutate) {
      try {
        await refundStockQuota(identity, tickerRecord.ticker, env, config, { relatedTickers });
      } catch (refundError) {
        logErrorEvent("watchlist_add_quota_refund_failed", {
          ticker: tickerRecord.ticker,
          quotaSubject: identity.quotaSubject,
          reason: refundError instanceof Error ? refundError.message : String(refundError)
        });
      }
    }
    throw error;
  }
}

async function refundAsyncStockQuotaOnFailure({
  error,
  identity,
  tickerRecord,
  env,
  config,
  relatedTickers,
  job,
  didMutate
}: {
  error: unknown;
  identity: QuotaIdentity;
  tickerRecord: TickerRecord;
  env: Env;
  config: RemoteConfig;
  relatedTickers: string[];
  job: FilingPrepJobRecord;
  didMutate: boolean;
}): Promise<void> {
  const status = isRetryableFilingPrepError(error) ? "failed_retryable" : "failed_permanent";
  const errorMessage = error instanceof Error ? error.message : String(error);
  await markFilingPrepJobFailed(env, job.jobId, {
    status,
    errorMessage,
    retryAfterSeconds: status === "failed_retryable" ? WATCHLIST_PREPARING_RETRY_AFTER_SECONDS : undefined
  });
  logErrorEvent("watchlist_add_async_filing_failed", {
    jobId: job.jobId,
    ticker: tickerRecord.ticker,
    status,
    reason: errorMessage
  });
  if (!didMutate) {
    return;
  }

  try {
    await refundStockQuota(identity, tickerRecord.ticker, env, config, { relatedTickers });
  } catch (refundError) {
    logErrorEvent("watchlist_add_async_quota_refund_failed", {
      ticker: tickerRecord.ticker,
      quotaSubject: identity.quotaSubject,
      reason: refundError instanceof Error ? refundError.message : String(refundError)
    });
  }
}

function serializeFilingPrepJob(job: FilingPrepJobRecord): Record<string, unknown> {
  return {
    id: job.jobId,
    status: job.status,
    ticker: job.ticker,
    retryAfterSeconds: job.retryAfterSeconds,
    updatedAt: job.updatedAt
  };
}

function isRetryableFilingPrepError(error: unknown): boolean {
  return error instanceof AppError && error.status >= 500;
}
