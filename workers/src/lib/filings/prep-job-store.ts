import type { Env, TickerRecord } from "../../env";
import { logWarnEvent } from "../logging";
import type { QuotaIdentity } from "../quota";

export type FilingPrepJobStatus = "preparing" | "ready" | "failed_retryable" | "failed_permanent";

export interface FilingPrepJobRecord {
  jobId: string;
  quotaSubject: string;
  ticker: string;
  cik: string;
  companyName: string;
  status: FilingPrepJobStatus;
  filingKey?: string;
  errorMessage?: string;
  retryAfterSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFilingPrepJobInput {
  identity: QuotaIdentity;
  tickerRecord: TickerRecord;
  retryAfterSeconds: number;
}

export async function createFilingPrepJob(env: Env, input: CreateFilingPrepJobInput): Promise<FilingPrepJobRecord> {
  const now = new Date().toISOString();
  const record: FilingPrepJobRecord = {
    jobId: `filing-prep:${input.tickerRecord.cik}:${input.tickerRecord.ticker}:${crypto.randomUUID()}`,
    quotaSubject: input.identity.quotaSubject,
    ticker: input.tickerRecord.ticker,
    cik: input.tickerRecord.cik,
    companyName: input.tickerRecord.companyName,
    status: "preparing",
    retryAfterSeconds: input.retryAfterSeconds,
    createdAt: now,
    updatedAt: now
  };

  const db = getOptionalDb(env);
  if (!db) {
    return record;
  }

  try {
    await db
      .prepare(
        `INSERT INTO filing_prep_jobs (
          job_id,
          quota_subject,
          ticker,
          cik,
          company_name,
          status,
          retry_after_seconds,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.jobId,
        record.quotaSubject,
        record.ticker,
        record.cik,
        record.companyName,
        record.status,
        record.retryAfterSeconds ?? null,
        record.createdAt,
        record.updatedAt
      )
      .run();
  } catch (error) {
    logWarnEvent("filing_prep_job_create_failed", {
      jobId: record.jobId,
      ticker: record.ticker,
      reason: error instanceof Error ? error.message : String(error)
    });
  }

  return record;
}

export async function markFilingPrepJobReady(env: Env, jobId: string, filingKey: string): Promise<void> {
  await updateFilingPrepJob(env, jobId, {
    status: "ready",
    filingKey,
    errorMessage: null,
    retryAfterSeconds: null
  });
}

export async function markFilingPrepJobFailed(
  env: Env,
  jobId: string,
  input: {
    status: Exclude<FilingPrepJobStatus, "preparing" | "ready">;
    errorMessage: string;
    retryAfterSeconds?: number;
  }
): Promise<void> {
  await updateFilingPrepJob(env, jobId, {
    status: input.status,
    filingKey: null,
    errorMessage: input.errorMessage,
    retryAfterSeconds: input.retryAfterSeconds ?? null
  });
}

export async function loadFilingPrepJob(
  env: Env,
  jobId: string,
  identity: QuotaIdentity
): Promise<FilingPrepJobRecord | null> {
  const db = getOptionalDb(env);
  if (!db) {
    return null;
  }

  const row = await db
    .prepare(
      `SELECT
        job_id,
        quota_subject,
        ticker,
        cik,
        company_name,
        status,
        filing_key,
        error_message,
        retry_after_seconds,
        created_at,
        updated_at
      FROM filing_prep_jobs
      WHERE job_id = ? AND quota_subject = ?
      LIMIT 1`
    )
    .bind(jobId, identity.quotaSubject)
    .first<FilingPrepJobRow>();

  return row ? mapFilingPrepJobRow(row) : null;
}

function updateFilingPrepJob(
  env: Env,
  jobId: string,
  update: {
    status: FilingPrepJobStatus;
    filingKey: string | null;
    errorMessage: string | null;
    retryAfterSeconds: number | null;
  }
): Promise<void> {
  const db = getOptionalDb(env);
  if (!db) {
    return Promise.resolve();
  }

  const updatedAt = new Date().toISOString();
  return db
    .prepare(
      `UPDATE filing_prep_jobs
      SET status = ?,
          filing_key = ?,
          error_message = ?,
          retry_after_seconds = ?,
          updated_at = ?
      WHERE job_id = ?`
    )
    .bind(update.status, update.filingKey, update.errorMessage, update.retryAfterSeconds, updatedAt, jobId)
    .run()
    .then(() => undefined)
    .catch((error) => {
      logWarnEvent("filing_prep_job_update_failed", {
        jobId,
        status: update.status,
        reason: error instanceof Error ? error.message : String(error)
      });
    });
}

function getOptionalDb(env: Env): D1Database | null {
  return (env as Partial<Env>).DB ?? null;
}

interface FilingPrepJobRow {
  job_id: string;
  quota_subject: string;
  ticker: string;
  cik: string;
  company_name: string;
  status: FilingPrepJobStatus;
  filing_key: string | null;
  error_message: string | null;
  retry_after_seconds: number | null;
  created_at: string;
  updated_at: string;
}

function mapFilingPrepJobRow(row: FilingPrepJobRow): FilingPrepJobRecord {
  return {
    jobId: row.job_id,
    quotaSubject: row.quota_subject,
    ticker: row.ticker,
    cik: row.cik,
    companyName: row.company_name,
    status: row.status,
    filingKey: row.filing_key ?? undefined,
    errorMessage: row.error_message ?? undefined,
    retryAfterSeconds: row.retry_after_seconds ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
