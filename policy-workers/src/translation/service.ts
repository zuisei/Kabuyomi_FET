import type { PolicyEvent } from "../domain/types.ts";
import {
  OpenAIAPIError,
  applyPublicTranslation,
  defaultRealtimeCutoff,
  defaultTranslationModel,
  estimatedTranslationTokens,
  normalizeGeneratedTranslation,
  parseOpenAITranslation,
  preserveRequiredTitleIdentifiers,
  requestOpenAITranslation,
  translationLane,
  translationPromptVersion,
  translationRequestBody,
  translationSourceForEvent,
  validateTranslation,
  type PolicyTranslationRow,
  type TranslationLane,
  type TranslationSource
} from "./model.ts";

export interface TranslationEnv {
  CORE: D1Database;
  OPS: D1Database;
  TEMP: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSLATION_MODEL?: string;
  TRANSLATION_REALTIME_CUTOFF?: string;
  TRANSLATION_REALTIME_LIMIT?: string;
  TRANSLATION_DAILY_TOKEN_BUDGET?: string;
}

type ReadModelRow = { event_id: string; payload_json: string };
type TranslationJobRow = {
  id: string;
  event_id: string;
  source_content_hash: string;
  source_available_at: string;
  lane: TranslationLane;
  status: string;
  prompt_version: string;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  attempt_count: number;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

type BatchManifestRow = {
  id: string;
  status: string;
  cutoff_before: string;
  candidate_count: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_max_cost_usd: number;
  manifest_object_key: string;
  openai_input_file_id: string | null;
  openai_batch_id: string | null;
};

export type TranslationQueueSummary = {
  scanned: number;
  alreadyTranslated: number;
  realtime: number;
  batch: number;
  skipped: number;
  cutoff: string;
};

export type RealtimeTranslationSummary = {
  state: "completed" | "missing_credentials" | "daily_budget_reached";
  attempted: number;
  translated: number;
  rejected: number;
  failed: number;
  deferred: number;
  inputTokens: number;
  outputTokens: number;
};

export type BatchManifestPreview = {
  manifestID: string;
  status: string;
  cutoffBefore: string;
  candidateCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedMaxCostUSD: number;
  requiredConfirmation: string;
};

export type PublicTranslationRequestStatus = {
  eventID: string;
  mode: "automatic" | "on_demand";
  state: "available" | "queued" | "processing" | "retry" | "failed" | "translated" | "batch_processing" | "unavailable";
  requestedAt: string | null;
  updatedAt: string | null;
  retryAfterSeconds: number | null;
};

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function parseEvent(row: ReadModelRow): PolicyEvent | null {
  try { return JSON.parse(row.payload_json) as PolicyEvent; }
  catch { return null; }
}

function jobID(source: TranslationSource): string {
  return `${source.eventID}:translation:${source.sourceContentHash.slice(0, 20)}:${translationPromptVersion}`;
}

function translationID(source: TranslationSource): string {
  return `${source.eventID}:ja:${source.sourceContentHash.slice(0, 20)}:${translationPromptVersion}`;
}

function model(env: TranslationEnv): string {
  return env.OPENAI_TRANSLATION_MODEL?.trim() || defaultTranslationModel;
}

function realtimeCutoff(env: TranslationEnv): string {
  const value = env.TRANSLATION_REALTIME_CUTOFF?.trim() || defaultRealtimeCutoff;
  if (Number.isNaN(Date.parse(value))) throw new Error("TRANSLATION_REALTIME_CUTOFF must be ISO-8601");
  return new Date(value).toISOString();
}

function realtimeLimit(env: TranslationEnv): number {
  return Math.min(Math.max(Number(env.TRANSLATION_REALTIME_LIMIT ?? 5) || 5, 1), 20);
}

function dailyTokenBudget(env: TranslationEnv): number {
  return Math.min(Math.max(Number(env.TRANSLATION_DAILY_TOKEN_BUDGET ?? 1_900_000) || 1_900_000, 1_000), 2_000_000);
}

function utcPeriodStart(now = new Date()): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function currentUsage(env: TranslationEnv, now = new Date()): Promise<number> {
  const row = await env.OPS.prepare("SELECT counter_value FROM usage_counters WHERE period_start=? AND counter_name='openai_translation_tokens'")
    .bind(utcPeriodStart(now)).first<{ counter_value: number }>();
  return row?.counter_value ?? 0;
}

async function addUsage(env: TranslationEnv, input: number, output: number, now = new Date()): Promise<void> {
  const total = Math.max(0, input) + Math.max(0, output);
  if (total === 0) return;
  const timestamp = now.toISOString();
  await env.OPS.prepare(`INSERT INTO usage_counters(period_start,counter_name,counter_value,updated_at)
    VALUES (?,'openai_translation_tokens',?,?)
    ON CONFLICT(period_start,counter_name) DO UPDATE SET counter_value=usage_counters.counter_value+excluded.counter_value,updated_at=excluded.updated_at`)
    .bind(utcPeriodStart(now), total, timestamp).run();
}

async function acceptedTranslationExists(env: TranslationEnv, source: TranslationSource): Promise<boolean> {
  const row = await env.CORE.prepare(`SELECT id FROM policy_translations
    WHERE event_id=? AND source_content_hash=? AND prompt_version=?
      AND title_status<>'rejected' AND factual_summary_status<>'rejected' LIMIT 1`)
    .bind(source.eventID, source.sourceContentHash, translationPromptVersion).first();
  return Boolean(row);
}

export async function queueTranslationCandidates(env: TranslationEnv): Promise<TranslationQueueSummary> {
  const cutoff = realtimeCutoff(env);
  const [rows, translatedRows] = await Promise.all([
    env.CORE.prepare("SELECT event_id,payload_json FROM event_read_models WHERE published_at IS NOT NULL ORDER BY source_updated_at DESC")
      .all<ReadModelRow>(),
    env.CORE.prepare(`SELECT event_id,source_content_hash FROM policy_translations
      WHERE prompt_version=? AND title_status<>'rejected' AND factual_summary_status<>'rejected'`)
      .bind(translationPromptVersion).all<{ event_id: string; source_content_hash: string }>()
  ]);
  const translated = new Set(translatedRows.results.map((row) => `${row.event_id}:${row.source_content_hash}`));
  const statements: D1PreparedStatement[] = [];
  const summary: TranslationQueueSummary = { scanned: rows.results.length, alreadyTranslated: 0, realtime: 0, batch: 0, skipped: 0, cutoff };
  const now = new Date().toISOString();
  for (const row of rows.results) {
    const event = parseEvent(row);
    const source = event ? translationSourceForEvent(event) : null;
    if (!source) { summary.skipped += 1; continue; }
    if (translated.has(`${source.eventID}:${source.sourceContentHash}`)) { summary.alreadyTranslated += 1; continue; }
    const lane = translationLane(source.sourceAvailableAt, cutoff);

    // **過去資料は自動で積まない。**
    //
    // 以前は cutoff より古いものを `awaiting_batch` として並べていたが、
    // その Batch は明示確認まで送らない決まりで、結果 354件が動かないまま
    // 溜まっていた。自動翻訳は新着だけにして、過去のは**人が押したときだけ**
    // 訳す(2026-08-26 オーナー「これからは新着だけ翻訳して過去のは自分でやらせて」)。
    //
    // 積まなくても画面は困らない: job が無い過去資料は
    // `publicTranslationRequestStatus` が `available` を返し、
    // 「日本語に翻訳」のボタンが出る。押されたぶんだけトークンを使う。
    if (lane === "batch") { summary.batch += 1; continue; }

    const tokens = estimatedTranslationTokens(source);
    const status = "queued";
    statements.push(env.OPS.prepare(`INSERT INTO translation_jobs(
      id,event_id,source_content_hash,source_available_at,lane,status,prompt_version,
      estimated_input_tokens,estimated_output_tokens,attempt_count,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)
    ON CONFLICT(event_id,source_content_hash,prompt_version) DO NOTHING`)
      .bind(jobID(source), source.eventID, source.sourceContentHash, source.sourceAvailableAt, lane, status,
        translationPromptVersion, tokens.input, tokens.output, now, now));
    summary.realtime += 1;
  }
  for (const batch of chunks(statements, 80)) await env.OPS.batch(batch);
  return summary;
}

async function readCurrentSource(env: TranslationEnv, eventID: string): Promise<TranslationSource | null> {
  const row = await env.CORE.prepare("SELECT event_id,payload_json FROM event_read_models WHERE event_id=? AND published_at IS NOT NULL")
    .bind(eventID).first<ReadModelRow>();
  const event = row ? parseEvent(row) : null;
  return event ? translationSourceForEvent(event) : null;
}

function publicRequestMode(env: TranslationEnv, source: TranslationSource): PublicTranslationRequestStatus["mode"] {
  return translationLane(source.sourceAvailableAt, realtimeCutoff(env)) === "batch" ? "on_demand" : "automatic";
}

function retryAfterSeconds(nextAttemptAt: string | null): number | null {
  if (!nextAttemptAt) return null;
  const milliseconds = Date.parse(nextAttemptAt) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1_000)) : null;
}

async function activeBatchStatus(env: TranslationEnv, jobID: string): Promise<string | null> {
  const row = await env.OPS.prepare(`SELECT manifest.status
    FROM translation_batch_manifest_jobs link
    JOIN translation_batch_manifests manifest ON manifest.id=link.manifest_id
    WHERE link.job_id=? AND manifest.status IN ('prepared','submitted','processing')
    LIMIT 1`).bind(jobID).first<{ status: string }>();
  return row?.status ?? null;
}

export async function publicTranslationRequestStatus(
  env: TranslationEnv,
  eventID: string
): Promise<PublicTranslationRequestStatus> {
  const source = await readCurrentSource(env, eventID);
  if (!source) {
    return { eventID, mode: "on_demand", state: "unavailable", requestedAt: null, updatedAt: null, retryAfterSeconds: null };
  }
  const mode = publicRequestMode(env, source);
  if (await acceptedTranslationExists(env, source)) {
    return { eventID, mode, state: "translated", requestedAt: null, updatedAt: null, retryAfterSeconds: null };
  }
  const job = await env.OPS.prepare(`SELECT * FROM translation_jobs
    WHERE event_id=? AND source_content_hash=? AND prompt_version=? LIMIT 1`)
    .bind(source.eventID, source.sourceContentHash, translationPromptVersion).first<TranslationJobRow>();
  if (!job) {
    return {
      eventID, mode, state: mode === "automatic" ? "queued" : "available",
      requestedAt: null, updatedAt: null, retryAfterSeconds: null
    };
  }
  if (await activeBatchStatus(env, job.id)) {
    return {
      eventID, mode, state: "batch_processing", requestedAt: job.created_at, updatedAt: job.updated_at,
      retryAfterSeconds: null
    };
  }
  const state: PublicTranslationRequestStatus["state"] = (() => {
    if (job.status === "awaiting_batch") return mode === "on_demand" ? "available" : "queued";
    if (job.status === "queued") return "queued";
    if (job.status === "processing" || job.status === "submitted") return "processing";
    if (job.status === "retry") return "retry";
    if (job.status === "failed" || job.status === "cancelled" || job.status === "completed") return "failed";
    return "unavailable";
  })();
  return {
    eventID, mode, state, requestedAt: job.created_at, updatedAt: job.updated_at,
    retryAfterSeconds: state === "retry" ? retryAfterSeconds(job.next_attempt_at) : null
  };
}

export async function requestPublicTranslation(
  env: TranslationEnv,
  eventID: string
): Promise<PublicTranslationRequestStatus> {
  const current = await publicTranslationRequestStatus(env, eventID);
  if (["translated", "processing", "retry", "batch_processing", "unavailable"].includes(current.state)) {
    return current;
  }
  const source = await readCurrentSource(env, eventID);
  if (!source) return current;
  const tokens = estimatedTranslationTokens(source);
  const now = new Date().toISOString();
  const lane = current.mode === "automatic" ? "realtime" : "manual_priority";
  await env.OPS.prepare(`INSERT INTO translation_jobs(
    id,event_id,source_content_hash,source_available_at,lane,status,prompt_version,
    estimated_input_tokens,estimated_output_tokens,attempt_count,created_at,updated_at
  ) VALUES (?,?,?,?,?,'queued',?,?,?,0,?,?)
  ON CONFLICT(event_id,source_content_hash,prompt_version) DO NOTHING`)
    .bind(jobID(source), source.eventID, source.sourceContentHash, source.sourceAvailableAt, lane,
      translationPromptVersion, tokens.input, tokens.output, now, now).run();

  const job = await env.OPS.prepare(`SELECT * FROM translation_jobs
    WHERE event_id=? AND source_content_hash=? AND prompt_version=? LIMIT 1`)
    .bind(source.eventID, source.sourceContentHash, translationPromptVersion).first<TranslationJobRow>();
  if (!job || await activeBatchStatus(env, job.id)) return publicTranslationRequestStatus(env, eventID);
  await env.OPS.prepare(`UPDATE translation_jobs SET
    lane=?,
    status=CASE WHEN status IN ('awaiting_batch','failed','cancelled','completed') THEN 'queued' ELSE status END,
    attempt_count=CASE WHEN status IN ('failed','cancelled','completed') THEN 0 ELSE attempt_count END,
    next_attempt_at=CASE WHEN status IN ('awaiting_batch','failed','cancelled','completed') THEN NULL ELSE next_attempt_at END,
    openai_batch_id=NULL,
    last_error=CASE WHEN status IN ('awaiting_batch','failed','cancelled','completed') THEN NULL ELSE last_error END,
    updated_at=?
    WHERE id=? AND status NOT IN ('processing','submitted')`)
    .bind(lane, now, job.id).run();
  return publicTranslationRequestStatus(env, eventID);
}

async function readCurrentSources(env: TranslationEnv, eventIDs: string[]): Promise<Map<string, TranslationSource>> {
  const result = new Map<string, TranslationSource>();
  for (const batch of chunks([...new Set(eventIDs)], 80)) {
    if (batch.length === 0) continue;
    const rows = await env.CORE.prepare(`SELECT event_id,payload_json FROM event_read_models
      WHERE published_at IS NOT NULL AND event_id IN (${batch.map(() => "?").join(",")})`)
      .bind(...batch).all<ReadModelRow>();
    for (const row of rows.results) {
      const event = parseEvent(row);
      const source = event ? translationSourceForEvent(event) : null;
      if (source) result.set(source.eventID, source);
    }
  }
  return result;
}

async function persistTranslation(
  env: TranslationEnv,
  source: TranslationSource,
  generated: { titleJA: string; factualSummaryJA: string },
  warnings: string[],
  accepted: boolean,
  translatedAt: string
): Promise<void> {
  const status = accepted ? "machine_translated" : "rejected";
  await env.CORE.prepare(`INSERT INTO policy_translations(
    id,event_id,source_content_hash,source_language,title_ja,title_status,factual_summary_ja,factual_summary_status,
    provider,model,prompt_version,translated_at,validation_warnings_json,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(event_id,source_content_hash,prompt_version) DO UPDATE SET
    title_ja=excluded.title_ja,title_status=excluded.title_status,
    factual_summary_ja=excluded.factual_summary_ja,factual_summary_status=excluded.factual_summary_status,
    provider=excluded.provider,model=excluded.model,translated_at=excluded.translated_at,
    validation_warnings_json=excluded.validation_warnings_json`)
    .bind(translationID(source), source.eventID, source.sourceContentHash, source.sourceLanguage,
      generated.titleJA, status, generated.factualSummaryJA, status, "openai", model(env), translationPromptVersion,
      translatedAt, JSON.stringify(warnings), translatedAt).run();
}

async function completeJob(env: TranslationEnv, id: string, responseID: string | null, now: string): Promise<void> {
  await env.OPS.prepare("UPDATE translation_jobs SET status='completed',openai_response_id=?,last_error=NULL,completed_at=?,updated_at=? WHERE id=?")
    .bind(responseID, now, now, id).run();
}

async function retryOrFailJob(env: TranslationEnv, job: TranslationJobRow, error: string, now = new Date()): Promise<"retry" | "failed"> {
  const attempt = job.attempt_count + 1;
  const status = attempt >= 3 ? "failed" : "retry";
  const next = status === "retry" ? new Date(now.getTime() + 2 ** attempt * 60_000).toISOString() : null;
  await env.OPS.prepare("UPDATE translation_jobs SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?")
    .bind(status, error.slice(0, 800), next, now.toISOString(), job.id).run();
  return status;
}

function isQuotaExhaustion(error: unknown): boolean {
  if (error instanceof OpenAIAPIError) {
    if (error.code === "insufficient_quota" || error.type === "insufficient_quota") return true;
  }
  return error instanceof Error && /current quota|billing quota|run out of credits|no balance left/i.test(error.message);
}

async function deferQuotaBlockedJob(env: TranslationEnv, job: TranslationJobRow, error: string, now = new Date()): Promise<void> {
  const next = new Date(now.getTime() + 30 * 60_000).toISOString();
  await env.OPS.prepare("UPDATE translation_jobs SET status='retry',last_error=?,next_attempt_at=?,updated_at=? WHERE id=?")
    .bind(`quota_blocked: ${error}`.slice(0, 800), next, now.toISOString(), job.id).run();
}

export async function processRealtimeTranslations(env: TranslationEnv, fetcher: typeof fetch = fetch): Promise<RealtimeTranslationSummary> {
  return processRealtimeTranslationJobs(env, fetcher);
}

export async function processRealtimeTranslationForEvent(
  env: TranslationEnv,
  eventID: string,
  fetcher: typeof fetch = fetch
): Promise<RealtimeTranslationSummary> {
  return processRealtimeTranslationJobs(env, fetcher, eventID);
}

async function processRealtimeTranslationJobs(
  env: TranslationEnv,
  fetcher: typeof fetch,
  eventID?: string
): Promise<RealtimeTranslationSummary> {
  const summary: RealtimeTranslationSummary = {
    state: "completed", attempted: 0, translated: 0, rejected: 0, failed: 0, deferred: 0, inputTokens: 0, outputTokens: 0
  };
  if (!env.OPENAI_API_KEY?.trim()) return { ...summary, state: "missing_credentials" };
  const now = new Date();
  let used = await currentUsage(env, now);
  const budget = dailyTokenBudget(env);
  const statement = env.OPS.prepare(`SELECT * FROM translation_jobs
    WHERE lane IN ('realtime','manual_priority') AND status IN ('queued','retry')
      AND COALESCE(next_attempt_at,created_at)<=?
      ${eventID ? "AND event_id=?" : ""}
    ORDER BY CASE lane WHEN 'manual_priority' THEN 0 ELSE 1 END,source_available_at DESC
    LIMIT ?`);
  const jobs = eventID
    ? await statement.bind(now.toISOString(), eventID, 1).all<TranslationJobRow>()
    : await statement.bind(now.toISOString(), realtimeLimit(env)).all<TranslationJobRow>();

  for (const job of jobs.results) {
    const estimated = job.estimated_input_tokens + job.estimated_output_tokens;
    if (used + estimated > budget) {
      summary.state = "daily_budget_reached";
      summary.deferred += 1;
      continue;
    }
    const source = await readCurrentSource(env, job.event_id);
    if (!source || source.sourceContentHash !== job.source_content_hash) {
      await env.OPS.prepare("UPDATE translation_jobs SET status='cancelled',last_error='source changed before translation',updated_at=? WHERE id=?")
        .bind(now.toISOString(), job.id).run();
      continue;
    }
    if (await acceptedTranslationExists(env, source)) {
      await completeJob(env, job.id, null, now.toISOString());
      continue;
    }
    const claimed = await env.OPS.prepare(`UPDATE translation_jobs SET status='processing',attempt_count=attempt_count+1,updated_at=?
      WHERE id=? AND status IN ('queued','retry')`).bind(now.toISOString(), job.id).run();
    if ((claimed.meta.changes ?? 0) !== 1) continue;
    summary.attempted += 1;
    try {
      let generated = await requestOpenAITranslation(source, env.OPENAI_API_KEY, model(env), fetcher);
      let checked = preserveRequiredTitleIdentifiers(
        source,
        validateTranslation(source, normalizeGeneratedTranslation(source, generated))
      );
      let inputTokens = generated.inputTokens;
      let outputTokens = generated.outputTokens;
      if (!checked.accepted && used + inputTokens + outputTokens + estimated <= budget) {
        const rejectedTranslation = {
          titleJA: checked.titleJA,
          factualSummaryJA: checked.factualSummaryJA
        };
        const repaired = await requestOpenAITranslation(
          source,
          env.OPENAI_API_KEY,
          model(env),
          fetcher,
          checked.warnings,
          rejectedTranslation
        );
        generated = repaired;
        checked = preserveRequiredTitleIdentifiers(
          source,
          validateTranslation(source, normalizeGeneratedTranslation(source, repaired))
        );
        inputTokens += repaired.inputTokens;
        outputTokens += repaired.outputTokens;
      }
      const completedAt = new Date().toISOString();
      await persistTranslation(env, source, checked, checked.warnings, checked.accepted, completedAt);
      await addUsage(env, inputTokens, outputTokens, now);
      summary.inputTokens += inputTokens;
      summary.outputTokens += outputTokens;
      used += inputTokens + outputTokens;
      if (checked.accepted) {
        await completeJob(env, job.id, generated.responseID, completedAt);
        summary.translated += 1;
      } else {
        await env.OPS.prepare("UPDATE translation_jobs SET status='failed',openai_response_id=?,last_error=?,updated_at=? WHERE id=?")
          .bind(generated.responseID, `translation validation failed: ${checked.warnings.join(",")}`, completedAt, job.id).run();
        summary.rejected += 1;
      }
    } catch (error) {
      if (isQuotaExhaustion(error)) {
        await deferQuotaBlockedJob(env, job, error instanceof Error ? error.message : String(error), now);
        summary.deferred += 1;
        continue;
      }
      const state = await retryOrFailJob(env, job, error instanceof Error ? error.message : String(error), now);
      if (state === "failed") summary.failed += 1;
      else summary.deferred += 1;
    }
  }
  return summary;
}

export async function latestTranslationsForEvents(env: Pick<TranslationEnv, "CORE">, eventIDs: string[]): Promise<Map<string, PolicyTranslationRow>> {
  const result = new Map<string, PolicyTranslationRow>();
  for (const batch of chunks(eventIDs, 80)) {
    if (batch.length === 0) continue;
    const rows = await env.CORE.prepare(`SELECT * FROM policy_translations
      WHERE event_id IN (${batch.map(() => "?").join(",")})
        AND title_status<>'rejected' AND factual_summary_status<>'rejected'
      ORDER BY event_id,translated_at DESC`).bind(...batch).all<PolicyTranslationRow>();
    for (const row of rows.results) if (!result.has(row.event_id)) result.set(row.event_id, row);
  }
  return result;
}

export async function applyLatestTranslations(env: Pick<TranslationEnv, "CORE">, events: PolicyEvent[]): Promise<PolicyEvent[]> {
  const translations = await latestTranslationsForEvents(env, events.map((event) => event.id));
  return events.map((event) => {
    const row = translations.get(event.id);
    const source = translationSourceForEvent(event);
    return row && source?.sourceContentHash === row.source_content_hash ? applyPublicTranslation(event, row) : event;
  });
}

export function batchConfirmationText(row: Pick<BatchManifestRow, "id" | "candidate_count" | "estimated_input_tokens" | "estimated_output_tokens">): string {
  return `SUBMIT BATCH ${row.id} ITEMS ${row.candidate_count} TOKENS ${row.estimated_input_tokens + row.estimated_output_tokens}`;
}

function batchPreview(row: BatchManifestRow): BatchManifestPreview {
  return {
    manifestID: row.id,
    status: row.status,
    cutoffBefore: row.cutoff_before,
    candidateCount: row.candidate_count,
    estimatedInputTokens: row.estimated_input_tokens,
    estimatedOutputTokens: row.estimated_output_tokens,
    estimatedTotalTokens: row.estimated_input_tokens + row.estimated_output_tokens,
    estimatedMaxCostUSD: row.estimated_max_cost_usd,
    requiredConfirmation: batchConfirmationText(row)
  };
}

export async function prepareBatchManifest(env: TranslationEnv, maximumItems = 500): Promise<BatchManifestPreview> {
  const existing = await env.OPS.prepare("SELECT * FROM translation_batch_manifests WHERE status='prepared' ORDER BY created_at DESC LIMIT 1")
    .first<BatchManifestRow>();
  if (existing) return batchPreview(existing);
  const jobs = await env.OPS.prepare(`SELECT * FROM translation_jobs WHERE lane='batch' AND status='awaiting_batch'
    ORDER BY source_available_at DESC LIMIT ?`).bind(Math.min(Math.max(maximumItems, 1), 500)).all<TranslationJobRow>();
  if (jobs.results.length === 0) throw new Error("No historical translation jobs are awaiting Batch preparation");
  const currentSources = await readCurrentSources(env, jobs.results.map((job) => job.event_id));
  const sources: Array<{ job: TranslationJobRow; source: TranslationSource }> = [];
  const cancelled: D1PreparedStatement[] = [];
  for (const job of jobs.results) {
    const source = currentSources.get(job.event_id);
    if (!source || source.sourceContentHash !== job.source_content_hash) {
      cancelled.push(env.OPS.prepare("UPDATE translation_jobs SET status='cancelled',last_error='source changed before batch preparation',updated_at=? WHERE id=?")
        .bind(new Date().toISOString(), job.id));
      continue;
    }
    sources.push({ job, source });
  }
  for (const batch of chunks(cancelled, 80)) await env.OPS.batch(batch);
  if (sources.length === 0) throw new Error("No current historical translation sources remain");
  const manifestID = crypto.randomUUID();
  const objectKey = `v1/translations/batches/${manifestID}/input.jsonl`;
  const jsonl = sources.map(({ job, source }) => JSON.stringify({
    custom_id: job.id,
    method: "POST",
    url: "/v1/responses",
    body: translationRequestBody(source, model(env))
  })).join("\n") + "\n";
  await env.TEMP.put(objectKey, jsonl, { httpMetadata: { contentType: "application/jsonl" }, customMetadata: { manifestID } });
  const input = sources.reduce((total, item) => total + item.job.estimated_input_tokens, 0);
  const output = sources.reduce((total, item) => total + item.job.estimated_output_tokens, 0);
  const estimatedMaxCostUSD = Number(((input * 0.025 + output * 0.2) / 1_000_000).toFixed(6));
  const cutoffBefore = realtimeCutoff(env);
  const createdAt = new Date().toISOString();
  await env.OPS.prepare(`INSERT INTO translation_batch_manifests(
    id,status,cutoff_before,candidate_count,estimated_input_tokens,estimated_output_tokens,
    estimated_max_cost_usd,manifest_object_key,created_at
  ) VALUES (?,'prepared',?,?,?,?,?,?,?)`).bind(manifestID, cutoffBefore, sources.length, input, output, estimatedMaxCostUSD, objectKey, createdAt).run();
  for (const batch of chunks(sources.map(({ job }) => env.OPS.prepare(
    "INSERT INTO translation_batch_manifest_jobs(manifest_id,job_id) VALUES (?,?)"
  ).bind(manifestID, job.id)), 80)) await env.OPS.batch(batch);
  return batchPreview({
    id: manifestID, status: "prepared", cutoff_before: cutoffBefore, candidate_count: sources.length,
    estimated_input_tokens: input, estimated_output_tokens: output, estimated_max_cost_usd: estimatedMaxCostUSD,
    manifest_object_key: objectKey, openai_input_file_id: null, openai_batch_id: null
  });
}

async function openAIJSON(fetcher: typeof fetch, apiKey: string, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  const response = await fetcher(url, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: { message?: unknown } }).error?.message === "string"
      ? (body as { error: { message: string } }).error.message : `OpenAI returned HTTP ${response.status}`;
    throw new Error(message);
  }
  if (!body || typeof body !== "object") throw new Error("OpenAI returned an invalid JSON response");
  return body as Record<string, unknown>;
}

export async function submitBatchManifest(
  env: TranslationEnv,
  manifestID: string,
  confirmation: string,
  fetcher: typeof fetch = fetch
): Promise<{ manifestID: string; batchID: string; status: string }> {
  if (!env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is not configured");
  const manifest = await env.OPS.prepare("SELECT * FROM translation_batch_manifests WHERE id=?")
    .bind(manifestID).first<BatchManifestRow>();
  if (!manifest || manifest.status !== "prepared") throw new Error("Batch manifest is not awaiting confirmation");
  if (confirmation !== batchConfirmationText(manifest)) throw new Error("Batch confirmation text did not match the prepared count and token estimate");
  const object = await env.TEMP.get(manifest.manifest_object_key);
  if (!object) throw new Error("Prepared Batch input is missing");
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new File([await object.arrayBuffer()], `market-docket-${manifest.id}.jsonl`, { type: "application/jsonl" }));
  try {
    const uploaded = await openAIJSON(fetcher, env.OPENAI_API_KEY, "https://api.openai.com/v1/files", { method: "POST", body: form });
    const fileID = typeof uploaded.id === "string" ? uploaded.id : null;
    if (!fileID) throw new Error("OpenAI file upload omitted its id");
    const created = await openAIJSON(fetcher, env.OPENAI_API_KEY, "https://api.openai.com/v1/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input_file_id: fileID,
        endpoint: "/v1/responses",
        completion_window: "24h",
        metadata: { product: "market-docket", manifest_id: manifest.id, purpose: "historical-policy-translation" }
      })
    });
    const batchID = typeof created.id === "string" ? created.id : null;
    if (!batchID) throw new Error("OpenAI Batch creation omitted its id");
    const submittedAt = new Date().toISOString();
    await env.OPS.batch([
      env.OPS.prepare("UPDATE translation_batch_manifests SET status='submitted',openai_input_file_id=?,openai_batch_id=?,submitted_at=?,last_error=NULL WHERE id=?")
        .bind(fileID, batchID, submittedAt, manifest.id),
      env.OPS.prepare(`UPDATE translation_jobs SET status='submitted',openai_batch_id=?,updated_at=?
        WHERE status='awaiting_batch' AND id IN (SELECT job_id FROM translation_batch_manifest_jobs WHERE manifest_id=?)`)
        .bind(batchID, submittedAt, manifest.id)
    ]);
    return { manifestID: manifest.id, batchID, status: "submitted" };
  } catch (error) {
    await env.OPS.prepare("UPDATE translation_batch_manifests SET last_error=? WHERE id=?")
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 800), manifest.id).run();
    throw error;
  }
}

async function completeBatchOutput(env: TranslationEnv, batchID: string, text: string): Promise<void> {
  for (const line of text.split(/\n+/).filter(Boolean)) {
    let item: Record<string, unknown>;
    try { item = JSON.parse(line) as Record<string, unknown>; }
    catch { continue; }
    const customID = typeof item.custom_id === "string" ? item.custom_id : null;
    if (!customID) continue;
    const job = await env.OPS.prepare("SELECT * FROM translation_jobs WHERE id=? AND openai_batch_id=?")
      .bind(customID, batchID).first<TranslationJobRow>();
    if (!job) continue;
    const response = item.response && typeof item.response === "object" ? item.response as Record<string, unknown> : null;
    const statusCode = response && typeof response.status_code === "number" ? response.status_code : 0;
    const body = response?.body;
    if (statusCode < 200 || statusCode >= 300 || !body) {
      await env.OPS.prepare("UPDATE translation_jobs SET status='failed',last_error='OpenAI Batch item failed',updated_at=? WHERE id=?")
        .bind(new Date().toISOString(), job.id).run();
      continue;
    }
    const source = await readCurrentSource(env, job.event_id);
    if (!source || source.sourceContentHash !== job.source_content_hash) {
      await env.OPS.prepare("UPDATE translation_jobs SET status='cancelled',last_error='source changed before Batch result',updated_at=? WHERE id=?")
        .bind(new Date().toISOString(), job.id).run();
      continue;
    }
    try {
      const generated = parseOpenAITranslation(body);
      const checked = validateTranslation(source, generated);
      const now = new Date().toISOString();
      await persistTranslation(env, source, checked, checked.warnings, checked.accepted, now);
      await addUsage(env, generated.inputTokens, generated.outputTokens);
      await env.OPS.prepare("UPDATE translation_jobs SET status=?,openai_response_id=?,last_error=?,completed_at=?,updated_at=? WHERE id=?")
        .bind(checked.accepted ? "completed" : "failed", generated.responseID,
          checked.accepted ? null : `translation validation failed: ${checked.warnings.join(",")}`,
          checked.accepted ? now : null, now, job.id).run();
    } catch (error) {
      await env.OPS.prepare("UPDATE translation_jobs SET status='failed',last_error=?,updated_at=? WHERE id=?")
        .bind((error instanceof Error ? error.message : String(error)).slice(0, 800), new Date().toISOString(), job.id).run();
    }
  }
}

export async function pollSubmittedBatches(env: TranslationEnv, fetcher: typeof fetch = fetch): Promise<{ checked: number; completed: number }> {
  if (!env.OPENAI_API_KEY?.trim()) return { checked: 0, completed: 0 };
  const manifests = await env.OPS.prepare("SELECT * FROM translation_batch_manifests WHERE status IN ('submitted','processing') ORDER BY submitted_at LIMIT 3")
    .all<BatchManifestRow>();
  let completed = 0;
  for (const manifest of manifests.results) {
    if (!manifest.openai_batch_id) continue;
    try {
      const batch = await openAIJSON(fetcher, env.OPENAI_API_KEY, `https://api.openai.com/v1/batches/${encodeURIComponent(manifest.openai_batch_id)}`);
      const status = typeof batch.status === "string" ? batch.status : "processing";
      if (status === "completed" && typeof batch.output_file_id === "string") {
        const output = await fetcher(`https://api.openai.com/v1/files/${encodeURIComponent(batch.output_file_id)}/content`, {
          headers: { "authorization": `Bearer ${env.OPENAI_API_KEY}` }
        });
        if (!output.ok) throw new Error(`OpenAI Batch output returned HTTP ${output.status}`);
        await completeBatchOutput(env, manifest.openai_batch_id, await output.text());
        const now = new Date().toISOString();
        await env.OPS.prepare("UPDATE translation_batch_manifests SET status='completed',completed_at=?,last_error=NULL WHERE id=?")
          .bind(now, manifest.id).run();
        await env.TEMP.delete(manifest.manifest_object_key);
        completed += 1;
      } else if (["failed", "expired", "cancelled"].includes(status)) {
        await env.OPS.prepare("UPDATE translation_batch_manifests SET status='failed',last_error=? WHERE id=?")
          .bind(`OpenAI Batch ended with status ${status}`, manifest.id).run();
      } else {
        await env.OPS.prepare("UPDATE translation_batch_manifests SET status='processing' WHERE id=?").bind(manifest.id).run();
      }
    } catch (error) {
      await env.OPS.prepare("UPDATE translation_batch_manifests SET last_error=? WHERE id=?")
        .bind((error instanceof Error ? error.message : String(error)).slice(0, 800), manifest.id).run();
    }
  }
  return { checked: manifests.results.length, completed };
}

export async function translationOperationalStatus(env: TranslationEnv): Promise<Record<string, unknown>> {
  const [jobs, manifests, translations, usage] = await Promise.all([
    env.OPS.prepare("SELECT lane,status,COUNT(*) AS count FROM translation_jobs GROUP BY lane,status ORDER BY lane,status").all(),
    env.OPS.prepare("SELECT id,status,cutoff_before,candidate_count,estimated_input_tokens,estimated_output_tokens,estimated_max_cost_usd,openai_batch_id,created_at,submitted_at,completed_at,last_error FROM translation_batch_manifests ORDER BY created_at DESC LIMIT 20").all(),
    env.CORE.prepare("SELECT title_status,factual_summary_status,COUNT(*) AS count FROM policy_translations GROUP BY title_status,factual_summary_status").all(),
    env.OPS.prepare("SELECT period_start,counter_value,updated_at FROM usage_counters WHERE counter_name='openai_translation_tokens' ORDER BY period_start DESC LIMIT 7").all()
  ]);
  return {
    model: model(env),
    promptVersion: translationPromptVersion,
    realtimeCutoff: realtimeCutoff(env),
    dailyTokenBudget: dailyTokenBudget(env),
    credentialsConfigured: Boolean(env.OPENAI_API_KEY?.trim()),
    jobs: jobs.results,
    manifests: manifests.results,
    translations: translations.results,
    usage: usage.results
  };
}
