import type { Env, FilingCacheRecord, FilingReference, MetricSnapshot, SourceChunkRecord, TickerRecord } from "../env";
import { fetchSubmissions, listSupportedFilings, lookupTicker, pickComparisonFiling } from "../clients/sec";
import { logEvent } from "./logging";
import type { RemoteConfig } from "./remote-config";

const HISTORY_YEARS = 3;
const ARCHIVE_PREFIX = "filings";
const DEFAULT_BACKFILL_FORMS: FilingReference["formType"][] = ["10-K"];
const DEFAULT_BACKFILL_TOTAL_CAP = 8;
const MAX_BACKFILL_TOTAL_CAP = 20;
const SAME_QUARTER_MATCH_WINDOW_DAYS = 45;

type HistoricalSource = {
  sourceId: string;
  sourceKind: "historical_filing";
  sourceStrength: "filing_primary";
  sectionType: string;
  sourceLabel: string;
  excerpt: string;
  sourceUrl?: string;
};

export interface HistoricalChatResponse {
  answer: string;
  sources: HistoricalSource[];
}

export interface HistoricalOverviewPoint {
  filingKey: string;
  filedAt: string;
  periodEnd: string;
  value: number;
  unit: string;
  yoyPercent: number | null;
  sourceId: string;
}

export interface HistoricalOverviewSeries {
  logicalName: MetricSnapshot["logicalName"];
  label: string;
  points: HistoricalOverviewPoint[];
}

export interface HistoricalOverviewPayload {
  comparisonBasis: "annual" | "quarterly";
  years: number;
  series: HistoricalOverviewSeries[];
}

export interface BackfillHistoryRequest {
  tickers?: string[];
  years: number;
  forms?: FilingReference["formType"][];
  maxFilingsPerTicker: number;
  maxTotalFilings?: number;
  cursorByTicker?: Record<string, number>;
}

export interface BackfillHistoryResult {
  tickers: string[];
  years: number;
  forms: FilingReference["formType"][];
  maxTotalFilings: number;
  processedFilings: Array<{ ticker: string; filingKey: string }>;
  skippedFilings: Array<{ ticker: string; filingKey: string; reason: string }>;
  failedTickers: Array<{ ticker: string; reason: string }>;
  nextCursorByTicker: Record<string, number>;
  totalCapReached: boolean;
}

interface HistoricalMetricRow {
  filingKey: string;
  ticker: string;
  formType: "10-K" | "10-Q";
  filedAt: string;
  periodOfReport: string;
  periodEnd: string;
  logicalName: MetricSnapshot["logicalName"];
  value: number;
  unit: string;
  yoyPercent: number | null;
  sourceId: string;
  primaryDocumentUrl?: string;
}

interface SegmentHighlightRow {
  filingKey: string;
  ticker: string;
  formType: "10-K" | "10-Q";
  filedAt: string;
  periodEnd: string;
  dimension: string;
  label: string;
  summary: string;
  sourceId: string | null;
  primaryDocumentUrl?: string;
}

type SegmentHighlightInsert = {
  filingKey: string;
  ticker: string;
  periodEnd: string;
  dimension: string;
  label: string;
  summary: string;
  sourceId: string | null;
};

export function hasHistoricalBindings(env: Partial<Env>): env is Env & { DB: D1Database; FILINGS_BUCKET: R2Bucket } {
  const candidate = env as Partial<Env> & {
    DB?: { prepare?: unknown; batch?: unknown };
    FILINGS_BUCKET?: { get?: unknown; put?: unknown; head?: unknown };
  };

  return (
    typeof candidate.DB?.prepare === "function" &&
    typeof candidate.DB?.batch === "function" &&
    typeof candidate.FILINGS_BUCKET?.get === "function" &&
    typeof candidate.FILINGS_BUCKET?.put === "function"
  );
}

export function isHistoricalQuestion(question: string): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return /(3年|三年|過去\d+年|過去|ここ\d+年|ここ数年|推移|比較|trend|trends|compare|comparison|timeseries|時系列)/.test(
    normalized
  );
}

export async function loadArchivedFilingByKey(filingKey: string, env: Partial<Env>): Promise<FilingCacheRecord | null> {
  if (!hasHistoricalBindings(env)) {
    return null;
  }

  const archived = await env.FILINGS_BUCKET.get(buildArchiveObjectKey(filingKey));
  if (!archived) {
    return null;
  }

  return JSON.parse(await archived.text()) as FilingCacheRecord;
}

export async function ensureHistoricalArtifacts(record: FilingCacheRecord, env: Partial<Env>): Promise<void> {
  if (!hasHistoricalBindings(env)) {
    return;
  }

  const [isIndexed, archived] = await Promise.all([
    env.DB.prepare("SELECT filing_key FROM filings WHERE filing_key = ? LIMIT 1").bind(record.filingKey).first<string>("filing_key"),
    env.FILINGS_BUCKET.head(buildArchiveObjectKey(record.filingKey))
  ]);

  const tasks: Promise<unknown>[] = [];

  if (!archived) {
    tasks.push(
      env.FILINGS_BUCKET.put(buildArchiveObjectKey(record.filingKey), JSON.stringify(record), {
        httpMetadata: { contentType: "application/json" }
      })
    );
  }

  if (!isIndexed) {
    tasks.push(persistHistoryIndex(record, env));
  }

  await Promise.all(tasks);
}

export async function maybeBuildHistoricalChatResponse(
  filing: FilingCacheRecord,
  question: string,
  env: Partial<Env>
): Promise<HistoricalChatResponse | null> {
  if (!isHistoricalQuestion(question) || !hasHistoricalBindings(env)) {
    return null;
  }

  await ensureHistoricalArtifacts(filing, env);

  const metricNames = selectHistoricalMetricNames(question);
  const metricRows = await loadHistoricalMetricRows(
    filing.cik,
    filing.formType,
    subtractYearsIsoDate(filing.periodOfReport, HISTORY_YEARS),
    metricNames,
    filing.formType === "10-Q" ? 24 : 9,
    env
  );

  if (metricRows.length < 2) {
    return null;
  }

  const groups = groupMetricRows(metricRows);
  const asksMargin = /(利益率|マージン|採算)/.test(question.replace(/\s+/g, "").toLowerCase());
  const asksDrivers = /(地域|事業|セグメント|支え|牽引|ドライバ|要因|原因|背景)/.test(question.replace(/\s+/g, "").toLowerCase());

  const answerParts = [`この${HISTORY_YEARS}年の${filing.formType === "10-Q" ? "四半期" : "年次"}提出資料ベースで見ると、`];
  const sources: HistoricalSource[] = [];

  if (asksMargin) {
    const marginSummary = buildMarginHistorySummary(groups);
    if (marginSummary) {
      answerParts.push(marginSummary.text);
      sources.push(...marginSummary.sources);
    }
  } else {
    for (const logicalName of metricNames) {
      const summary = buildMetricHistorySummary(groups.get(logicalName) ?? []);
      if (!summary) {
        continue;
      }
      answerParts.push(summary.text);
      sources.push(...summary.sources);
    }
  }

  if (asksDrivers) {
    const segments = await loadSegmentHighlights(
      filing.cik,
      filing.formType,
      subtractYearsIsoDate(filing.periodOfReport, HISTORY_YEARS),
      env
    );
    const segmentSummary = buildSegmentHistorySummary(segments);
    if (segmentSummary) {
      answerParts.push(segmentSummary.text);
      sources.push(...segmentSummary.sources);
    }
  }

  const dedupedSources = dedupeSources(sources);
  if (dedupedSources.length === 0) {
    return null;
  }

  return {
    answer: answerParts.join(" ").trim(),
    sources: dedupedSources
  };
}

export async function loadHistoricalOverview(
  filing: FilingCacheRecord,
  env: Partial<Env>
): Promise<HistoricalOverviewPayload | null> {
  if (!hasHistoricalBindings(env)) {
    return null;
  }

  await ensureHistoricalArtifacts(filing, env);

  const logicalNames: MetricSnapshot["logicalName"][] = [
    "revenue",
    "operatingIncome",
    "netIncome",
    "operatingCashFlow",
    "epsBasic"
  ];
  const metricRows = await loadHistoricalMetricRows(
    filing.cik,
    filing.formType,
    subtractYearsIsoDate(filing.periodOfReport, HISTORY_YEARS),
    logicalNames,
    filing.formType === "10-Q" ? 36 : 15,
    env
  );

  if (metricRows.length < 2) {
    return null;
  }

  const grouped = groupMetricRows(metricRows);
  const series = logicalNames
    .map((logicalName) => {
      const rows = grouped.get(logicalName) ?? [];
      const selectedRows =
        filing.formType === "10-Q"
          ? selectComparableQuarterRows(rows, filing.periodOfReport)
          : selectDistinctPeriodRows(rows, HISTORY_YEARS);

      if (selectedRows.length < 2) {
        return null;
      }

      return {
        logicalName,
        label: metricLabel(logicalName),
        points: selectedRows
          .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
          .map((row) => ({
            filingKey: row.filingKey,
            filedAt: row.filedAt,
            periodEnd: row.periodEnd,
            value: row.value,
            unit: row.unit,
            yoyPercent: row.yoyPercent,
            sourceId: row.sourceId
          }))
      } satisfies HistoricalOverviewSeries;
    })
    .filter((value): value is HistoricalOverviewSeries => value !== null);

  if (series.length === 0) {
    return null;
  }

  return {
    comparisonBasis: filing.formType === "10-Q" ? "quarterly" : "annual",
    years: HISTORY_YEARS,
    series
  };
}

export async function backfillHistoricalFilings(
  request: BackfillHistoryRequest,
  env: Partial<Env>,
  config: RemoteConfig,
  ensureStoredFiling: (
    filing: FilingReference,
    comparisonFiling: FilingReference | null,
    env: Env,
    config: RemoteConfig
  ) => Promise<FilingCacheRecord>
): Promise<BackfillHistoryResult> {
  if (!hasHistoricalBindings(env)) {
    throw new Error("D1 and R2 bindings are required for history backfill");
  }

  const requestedTickers = normalizeTickers(request.tickers ?? []);
  const tickers = requestedTickers.length > 0 ? requestedTickers : [];
  const requestedForms = resolveBackfillForms(request.forms);
  const maxTotalFilings = resolveMaxTotalFilings(request.maxTotalFilings);
  const processedFilings: Array<{ ticker: string; filingKey: string }> = [];
  const skippedFilings: Array<{ ticker: string; filingKey: string; reason: string }> = [];
  const failedTickers: Array<{ ticker: string; reason: string }> = [];
  const nextCursorByTicker: Record<string, number> = {};
  let remainingBudget = maxTotalFilings;
  let totalCapReached = false;

  for (let tickerIndex = 0; tickerIndex < tickers.length; tickerIndex += 1) {
    const ticker = tickers[tickerIndex]!;
    if (remainingBudget <= 0) {
      totalCapReached = true;
      preserveRemainingTickers(nextCursorByTicker, tickers.slice(tickerIndex), request.cursorByTicker);
      break;
    }

    try {
      const tickerRecord = await lookupTicker(ticker, env as Env);
      if (!tickerRecord) {
        failedTickers.push({ ticker, reason: "Ticker not found" });
        continue;
      }

      const submissions = await fetchSubmissions(tickerRecord.cik, env as Env);
      const candidates = listSupportedFilings(tickerRecord, submissions)
        .filter((filingReference) => requestedForms.includes(filingReference.formType))
        .filter((filingReference) => filingReference.periodOfReport >= subtractYearsIsoDate(new Date().toISOString(), request.years))
        .sort((left, right) => right.periodOfReport.localeCompare(left.periodOfReport));

      const cursor = request.cursorByTicker?.[ticker] ?? 0;
      const batch = candidates.slice(cursor, cursor + request.maxFilingsPerTicker);
      let consumedInBatch = 0;

      for (const filingReference of batch) {
        if (remainingBudget <= 0) {
          totalCapReached = true;
          nextCursorByTicker[ticker] = cursor + consumedInBatch;
          preserveRemainingTickers(nextCursorByTicker, tickers.slice(tickerIndex + 1), request.cursorByTicker);
          break;
        }

        const filingKey = filingReference.accessionNumber.replaceAll("-", "");
        const existingIndexed = await env.DB.prepare("SELECT filing_key, ticker FROM filings WHERE filing_key = ? LIMIT 1")
          .bind(`${config.extractorVersion}:${filingReference.cik}:${filingKey}`)
          .first<{ filing_key: string; ticker: string }>();
        consumedInBatch += 1;

        if (existingIndexed?.filing_key) {
          if (existingIndexed.ticker !== tickerRecord.ticker) {
            await normalizeIndexedFilingTicker(existingIndexed.filing_key, tickerRecord.ticker, env);
          }
          skippedFilings.push({
            ticker,
            filingKey: existingIndexed.filing_key,
            reason: "already_indexed"
          });
          continue;
        }

        remainingBudget -= 1;
        const comparisonFiling = pickComparisonFiling(tickerRecord, submissions, filingReference);
        const stored = await ensureStoredFiling(filingReference, comparisonFiling, env as Env, config);
        processedFilings.push({
          ticker,
          filingKey: stored.filingKey
        });
      }

      if (totalCapReached) {
        break;
      }

      if (cursor + batch.length < candidates.length) {
        nextCursorByTicker[ticker] = cursor + batch.length;
      }
    } catch (error) {
      failedTickers.push({
        ticker,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logEvent("history_backfill_completed", {
    tickerCount: tickers.length,
    forms: requestedForms,
    maxTotalFilings,
    processedCount: processedFilings.length,
    skippedCount: skippedFilings.length,
    failedCount: failedTickers.length,
    totalCapReached
  });

  return {
    tickers,
    years: request.years,
    forms: requestedForms,
    maxTotalFilings,
    processedFilings,
    skippedFilings,
    failedTickers,
    nextCursorByTicker,
    totalCapReached
  };
}

function resolveBackfillForms(forms?: FilingReference["formType"][]): FilingReference["formType"][] {
  const normalized = [...new Set((forms ?? DEFAULT_BACKFILL_FORMS).filter((form): form is FilingReference["formType"] => form === "10-K" || form === "10-Q"))];
  return normalized.length > 0 ? normalized : [...DEFAULT_BACKFILL_FORMS];
}

function resolveMaxTotalFilings(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BACKFILL_TOTAL_CAP;
  }

  return Math.max(1, Math.min(MAX_BACKFILL_TOTAL_CAP, Math.trunc(value ?? DEFAULT_BACKFILL_TOTAL_CAP)));
}

function preserveRemainingTickers(
  nextCursorByTicker: Record<string, number>,
  tickers: string[],
  cursorByTicker?: Record<string, number>
): void {
  for (const ticker of tickers) {
    nextCursorByTicker[ticker] = cursorByTicker?.[ticker] ?? 0;
  }
}

async function normalizeIndexedFilingTicker(
  filingKey: string,
  ticker: string,
  env: Env & { DB: D1Database }
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE filings SET ticker = ? WHERE filing_key = ?").bind(ticker, filingKey),
    env.DB.prepare("UPDATE metric_history SET ticker = ? WHERE filing_key = ?").bind(ticker, filingKey),
    env.DB.prepare("UPDATE segment_highlights SET ticker = ? WHERE filing_key = ?").bind(ticker, filingKey)
  ]);
}

function buildArchiveObjectKey(filingKey: string): string {
  return `${ARCHIVE_PREFIX}/${filingKey}.json`;
}

async function persistHistoryIndex(record: FilingCacheRecord, env: Env & { DB: D1Database }): Promise<void> {
  const metricRows = buildMetricHistoryRows(record);
  const segmentHighlights = extractSegmentHighlights(record);

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO filings (
        filing_key, ticker, cik, form_type, filed_at, period_of_report, accession, primary_document_url, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(filing_key) DO UPDATE SET
        ticker = excluded.ticker,
        cik = excluded.cik,
        form_type = excluded.form_type,
        filed_at = excluded.filed_at,
        period_of_report = excluded.period_of_report,
        accession = excluded.accession,
        primary_document_url = excluded.primary_document_url,
        generated_at = excluded.generated_at`
    ).bind(
      record.filingKey,
      record.ticker,
      record.cik,
      record.formType,
      record.filedAt,
      record.periodOfReport,
      record.filingKey.split(":")[2] ?? record.filingKey,
      record.primaryDocumentUrl,
      record.generatedAt
    )
  ];

  for (const metricRow of metricRows) {
    statements.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO metric_history (
          filing_key, ticker, period_end, logical_name, value, unit, yoy_percent, source_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        metricRow.filingKey,
        metricRow.ticker,
        metricRow.periodEnd,
        metricRow.logicalName,
        metricRow.value,
        metricRow.unit,
        metricRow.yoyPercent,
        metricRow.sourceId
      )
    );
  }

  for (const highlight of segmentHighlights) {
    statements.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO segment_highlights (
          filing_key, ticker, period_end, dimension, label, summary, source_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        highlight.filingKey,
        highlight.ticker,
        highlight.periodEnd,
        highlight.dimension,
        highlight.label,
        highlight.summary,
        highlight.sourceId
      )
    );
  }

  await env.DB.batch(statements);
}

function buildMetricHistoryRows(record: FilingCacheRecord): Array<{
  filingKey: string;
  ticker: string;
  periodEnd: string;
  logicalName: MetricSnapshot["logicalName"];
  value: number;
  unit: string;
  yoyPercent: number | null;
  sourceId: string;
}> {
  return record.metrics.map((metric) => ({
    filingKey: record.filingKey,
    ticker: record.ticker,
    periodEnd: metric.periodEnd,
    logicalName: metric.logicalName,
    value: metric.value,
    unit: metric.unit,
    yoyPercent: metric.yoyPercent ?? null,
    sourceId:
      record.sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed)?.sourceId ??
      `metric:${metric.logicalName}`
  }));
}

function extractSegmentHighlights(record: FilingCacheRecord): SegmentHighlightInsert[] {
  const highlights: SegmentHighlightInsert[] = [];
  const patterns: Array<{ dimension: string; label: string; pattern: RegExp }> = [
    { dimension: "geography", label: "米州", pattern: /Americas[\s\S]*?higher net sales of ([^.]+)\./i },
    { dimension: "geography", label: "中国", pattern: /Greater China[\s\S]*?higher net sales of ([^.]+)\./i },
    { dimension: "geography", label: "日本", pattern: /Japan[\s\S]*?higher net sales of ([^.]+)\./i },
    { dimension: "geography", label: "アジア太平洋", pattern: /Rest of Asia Pacific[\s\S]*?higher net sales of ([^.]+)\./i }
  ];

  for (const chunk of record.sourceChunks) {
    if (chunk.sectionType !== "md_a") {
      continue;
    }

    for (const pattern of patterns) {
      const match = chunk.text.match(pattern.pattern);
      if (!match?.[1]) {
        continue;
      }

      if (highlights.some((item) => item.label === pattern.label && item.filingKey === record.filingKey)) {
        continue;
      }

      highlights.push({
        filingKey: record.filingKey,
        ticker: record.ticker,
        periodEnd: record.periodOfReport,
        dimension: pattern.dimension,
        label: pattern.label,
        summary: translateDriverList(match[1]),
        sourceId: chunk.sourceId
      });
    }
  }

  return highlights;
}

async function loadHistoricalMetricRows(
  cik: string,
  formType: FilingReference["formType"],
  sinceDate: string,
  logicalNames: MetricSnapshot["logicalName"][],
  limit: number,
  env: Env & { DB: D1Database }
): Promise<HistoricalMetricRow[]> {
  const placeholders = logicalNames.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT
      m.filing_key AS filingKey,
      m.ticker AS ticker,
      f.form_type AS formType,
      f.filed_at AS filedAt,
      f.period_of_report AS periodOfReport,
      m.period_end AS periodEnd,
      m.logical_name AS logicalName,
      m.value AS value,
      m.unit AS unit,
      m.yoy_percent AS yoyPercent,
      m.source_id AS sourceId,
      f.primary_document_url AS primaryDocumentUrl
    FROM metric_history m
    JOIN filings f ON f.filing_key = m.filing_key
    WHERE f.cik = ? AND f.form_type = ? AND m.period_end >= ? AND m.logical_name IN (${placeholders})
    ORDER BY m.period_end DESC, f.filed_at DESC
    LIMIT ?`
  )
    .bind(cik, formType, sinceDate, ...logicalNames, limit)
    .all<HistoricalMetricRow>();

  return result.results;
}

async function loadSegmentHighlights(
  cik: string,
  formType: FilingReference["formType"],
  sinceDate: string,
  env: Env & { DB: D1Database }
): Promise<SegmentHighlightRow[]> {
  const result = await env.DB.prepare(
    `SELECT
      s.filing_key AS filingKey,
      s.ticker AS ticker,
      f.form_type AS formType,
      f.filed_at AS filedAt,
      s.period_end AS periodEnd,
      s.dimension AS dimension,
      s.label AS label,
      s.summary AS summary,
      s.source_id AS sourceId,
      f.primary_document_url AS primaryDocumentUrl
    FROM segment_highlights s
    JOIN filings f ON f.filing_key = s.filing_key
    WHERE f.cik = ? AND f.form_type = ? AND s.period_end >= ?
    ORDER BY s.period_end DESC, s.label ASC
    LIMIT 12`
  )
    .bind(cik, formType, sinceDate)
    .all<SegmentHighlightRow>();

  return result.results;
}

function selectHistoricalMetricNames(question: string): MetricSnapshot["logicalName"][] {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  const metrics: MetricSnapshot["logicalName"][] = [];

  if (/(売上|revenue|growth|成長)/.test(normalized)) {
    metrics.push("revenue");
  }
  if (/(営業利益|operatingincome|本業)/.test(normalized)) {
    metrics.push("operatingIncome");
  }
  if (/(純利益|netincome|利益|儲|赤字|黒字|損失|loss)/.test(normalized)) {
    metrics.push("netIncome");
  }
  if (/(キャッシュ|cash|現金)/.test(normalized)) {
    metrics.push("operatingCashFlow");
  }
  if (/(eps|一株)/.test(normalized)) {
    metrics.push("epsBasic");
  }
  if (/(利益率|マージン|採算)/.test(normalized)) {
    metrics.push("revenue", "operatingIncome", "netIncome");
  }

  if (metrics.length === 0) {
    metrics.push("revenue", "operatingIncome", "operatingCashFlow");
  }

  return Array.from(new Set(metrics));
}

function groupMetricRows(rows: HistoricalMetricRow[]): Map<MetricSnapshot["logicalName"], HistoricalMetricRow[]> {
  const grouped = new Map<MetricSnapshot["logicalName"], HistoricalMetricRow[]>();

  for (const row of rows) {
    const bucket = grouped.get(row.logicalName) ?? [];
    bucket.push(row);
    grouped.set(row.logicalName, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.sort((left, right) => right.periodEnd.localeCompare(left.periodEnd));
  }

  return grouped;
}

function buildMetricHistorySummary(
  rows: HistoricalMetricRow[]
): { text: string; sources: HistoricalSource[] } | null {
  if (rows.length < 2) {
    return null;
  }

  const latest = rows[0]!;
  const earliest = rows[rows.length - 1]!;
  const direction = latest.value > earliest.value ? "増えています" : latest.value < earliest.value ? "減っています" : "ほぼ横ばいです";
  const text = [
    `${metricLabel(latest.logicalName)}は ${earliest.periodEnd} の ${formatMetricValue(earliest.value, earliest.unit)} から ${latest.periodEnd} の ${formatMetricValue(latest.value, latest.unit)} へ ${direction}。`,
    latest.yoyPercent !== null ? `直近は前年同期比 ${formatYoYDelta(latest.yoyPercent)} です。` : ""
  ]
    .filter(Boolean)
    .join(" ");

  return {
    text,
    sources: [buildHistoricalMetricSource(latest), buildHistoricalMetricSource(earliest)]
  };
}

function buildMarginHistorySummary(
  groups: Map<MetricSnapshot["logicalName"], HistoricalMetricRow[]>
): { text: string; sources: HistoricalSource[] } | null {
  const revenueRows = groups.get("revenue") ?? [];
  const operatingRows = groups.get("operatingIncome") ?? [];
  if (revenueRows.length < 2 || operatingRows.length < 2) {
    return null;
  }

  const latestRevenue = revenueRows[0]!;
  const earliestRevenue = revenueRows[revenueRows.length - 1]!;
  const latestOperating = findRowByPeriod(operatingRows, latestRevenue.periodEnd);
  const earliestOperating = findRowByPeriod(operatingRows, earliestRevenue.periodEnd);
  if (!latestOperating || !earliestOperating || latestRevenue.value === 0 || earliestRevenue.value === 0) {
    return null;
  }

  const latestMargin = latestOperating.value / latestRevenue.value;
  const earliestMargin = earliestOperating.value / earliestRevenue.value;
  const direction = latestMargin > earliestMargin ? "改善しています" : latestMargin < earliestMargin ? "低下しています" : "大きな変化はありません";

  return {
    text: `営業利益率は ${earliestRevenue.periodEnd} の ${(earliestMargin * 100).toFixed(1)}% から ${latestRevenue.periodEnd} の ${(latestMargin * 100).toFixed(1)}% へ ${direction}。`,
    sources: [
      buildHistoricalMetricSource(latestRevenue),
      buildHistoricalMetricSource(latestOperating),
      buildHistoricalMetricSource(earliestRevenue),
      buildHistoricalMetricSource(earliestOperating)
    ]
  };
}

function buildSegmentHistorySummary(
  rows: SegmentHighlightRow[]
): { text: string; sources: HistoricalSource[] } | null {
  if (rows.length === 0) {
    return null;
  }

  const latestPeriod = rows[0]!.periodEnd;
  const latestRows = rows.filter((row) => row.periodEnd === latestPeriod).slice(0, 3);
  if (latestRows.length === 0) {
    return null;
  }

  return {
    text: `直近の提出資料では、${latestRows.map((row) => `${row.label}は ${row.summary}`).join("、")}が伸び要因として挙がっています。`,
    sources: latestRows.map(buildSegmentSource)
  };
}

function buildHistoricalMetricSource(row: HistoricalMetricRow): HistoricalSource {
  return {
    sourceId: `${row.filingKey}:${row.sourceId}`,
    sourceKind: "historical_filing",
    sourceStrength: "filing_primary",
    sectionType: "historical_metric",
    sourceLabel: `${row.formType} filed ${row.filedAt} · period ${row.periodEnd}`,
    excerpt: `${metricLabel(row.logicalName)}: ${formatMetricValue(row.value, row.unit)} (${row.periodEnd})`,
    sourceUrl: row.primaryDocumentUrl
  };
}

function buildSegmentSource(row: SegmentHighlightRow): HistoricalSource {
  return {
    sourceId: `${row.filingKey}:${row.sourceId ?? `${row.dimension}:${row.label}`}`,
    sourceKind: "historical_filing",
    sourceStrength: "filing_primary",
    sectionType: "historical_segment",
    sourceLabel: `${row.formType} filed ${row.filedAt} · period ${row.periodEnd}`,
    excerpt: `${row.label}: ${row.summary}`,
    sourceUrl: row.primaryDocumentUrl
  };
}

function findRowByPeriod(rows: HistoricalMetricRow[], periodEnd: string): HistoricalMetricRow | undefined {
  return rows.find((row) => row.periodEnd === periodEnd);
}

function dedupeSources(sources: HistoricalSource[]): HistoricalSource[] {
  const deduped: HistoricalSource[] = [];
  for (const source of sources) {
    if (!deduped.some((entry) => entry.sourceId === source.sourceId)) {
      deduped.push(source);
    }
  }
  return deduped;
}

function selectDistinctPeriodRows(rows: HistoricalMetricRow[], count: number): HistoricalMetricRow[] {
  const selected: HistoricalMetricRow[] = [];
  const seenPeriods = new Set<string>();

  for (const row of rows) {
    if (seenPeriods.has(row.periodEnd)) {
      continue;
    }

    selected.push(row);
    seenPeriods.add(row.periodEnd);

    if (selected.length >= count) {
      break;
    }
  }

  return selected;
}

function selectComparableQuarterRows(rows: HistoricalMetricRow[], currentPeriodEnd: string): HistoricalMetricRow[] {
  const remaining = [...selectDistinctPeriodRows(rows, rows.length)];
  const selected: HistoricalMetricRow[] = [];

  for (let yearOffset = 0; yearOffset < HISTORY_YEARS; yearOffset += 1) {
    const targetDate = subtractYearsIsoDate(currentPeriodEnd, yearOffset);
    const bestIndex = findClosestHistoricalRowIndex(remaining, targetDate);
    if (bestIndex === -1) {
      continue;
    }

    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return selected;
}

function findClosestHistoricalRowIndex(rows: HistoricalMetricRow[], targetDate: string): number {
  const targetMs = new Date(targetDate).getTime();
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < rows.length; index += 1) {
    const distanceDays = Math.abs(new Date(rows[index]!.periodEnd).getTime() - targetMs) / (24 * 60 * 60 * 1000);
    if (distanceDays > SAME_QUARTER_MATCH_WINDOW_DAYS) {
      continue;
    }

    if (distanceDays < bestDistance) {
      bestDistance = distanceDays;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function normalizeTickers(values: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const ticker = value.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) {
      continue;
    }
    seen.add(ticker);
    normalized.push(ticker);
  }

  return normalized;
}

function subtractYearsIsoDate(input: string, years: number): string {
  const date = new Date(input);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function translateDriverList(raw: string): string {
  return raw
    .replace(/\bServices\b/g, "サービス")
    .replace(/\bService\b/g, "サービス")
    .replace(/\biPhone\b/g, "iPhone")
    .replace(/\biPad\b/g, "iPad")
    .replace(/\band\b/gi, "と")
    .replace(/\s+/g, " ")
    .trim();
}

function metricLabel(metric: MetricSnapshot["logicalName"]): string {
  const labels: Record<MetricSnapshot["logicalName"], string> = {
    revenue: "売上高",
    netIncome: "純利益",
    epsBasic: "EPS（Basic）",
    operatingIncome: "営業利益",
    operatingCashFlow: "営業CF"
  };
  return labels[metric];
}

function formatMetricValue(value: number, unit: string): string {
  if (unit === "USD") {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000_000) {
      return `${formatCompactNumber(value / 1_000_000_000_000)}兆ドル`;
    }
    if (abs >= 100_000_000) {
      return `${formatCompactNumber(value / 100_000_000)}億ドル`;
    }
  }

  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} ${unit}`.trim();
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(value);
}

function formatYoYDelta(yoyPercent: number): string {
  const formatted = `${Math.abs(yoyPercent).toFixed(1)}%`;
  return `${formatted}${yoyPercent >= 0 ? "増" : "減"}`;
}
