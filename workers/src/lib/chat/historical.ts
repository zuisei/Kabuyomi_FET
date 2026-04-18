import type { Env, FilingCacheRecord, FilingReference, MetricSnapshot } from "../../env";
import { fetchSubmissions, listSupportedFilings, lookupTicker, pickComparisonFiling } from "../../clients/sec";
import { ensureHistoricalFilingStored } from "../filings/history-persistence";
import { hasHistoricalBindings, isHistoricalQuestion, maybeBuildHistoricalChatResponse } from "../history-store";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../metrics";
import type { RemoteConfig } from "../remote-config";
import { buildSecFilingSource, type ChatResponsePayload } from "./grounding";

const AUTO_HYDRATION_YEARS = 3;
const AUTO_HYDRATION_MAX_PRIOR_FILINGS = 2;
const AUTO_HYDRATION_TIMEOUT_MS = 6_000;
const SAME_QUARTER_MATCH_WINDOW_DAYS = 45;

type HydrationAttempt = {
  attempted: boolean;
  selectedCount: number;
  hydratedCount: number;
  reason?: string;
  status: "skipped" | "completed" | "failed" | "timed_out";
};

export async function maybeBuildHistoricalChatResponseWithHydration(
  filing: FilingCacheRecord,
  question: string,
  env: Env,
  config: RemoteConfig
): Promise<ChatResponsePayload | null> {
  if (!isHistoricalQuestion(question)) {
    return null;
  }

  if (!hasHistoricalBindings(env)) {
    logWarnEvent("chat_historical_hydration_skipped", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "bindings_unavailable"
    });
    return buildHistoricalDegradeResponse(filing, question, "履歴ストレージがまだ使えないため");
  }

  let initial: ChatResponsePayload | null = null;
  try {
    initial = await maybeBuildHistoricalChatResponse(filing, question, env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logErrorEvent("chat_historical_lookup_failed", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason
    });
    return buildHistoricalDegradeResponse(filing, question, "履歴比較の読み込みが一時的に失敗したため");
  }

  if (initial) {
    logEvent("chat_historical_hydration_skipped", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "history_already_available"
    });
    return initial;
  }

  const hydration = await hydrateHistoricalCoverageForChat(filing, env, config);
  if (hydration.hydratedCount > 0) {
    try {
      const retried = await maybeBuildHistoricalChatResponse(filing, question, env);
      if (retried) {
        logEvent("chat_historical_autohydrated", {
          filingKey: filing.filingKey,
          ticker: filing.ticker,
          formType: filing.formType,
          hydratedCount: hydration.hydratedCount
        });
        return retried;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logErrorEvent("chat_historical_lookup_failed", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        reason,
        stage: "post_hydration_retry"
      });
      return buildHistoricalDegradeResponse(filing, question, "履歴比較の再読込が一時的に失敗したため");
    }
  }

  logWarnEvent("chat_historical_insufficient", {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    formType: filing.formType,
    selectedCount: hydration.selectedCount,
    hydratedCount: hydration.hydratedCount,
    status: hydration.status,
    reason: hydration.reason ?? "history_still_insufficient"
  });

  if (hydration.status === "failed" || hydration.status === "timed_out") {
    return buildHistoricalDegradeResponse(
      filing,
      question,
      hydration.status === "timed_out" ? "履歴補完が一定時間で終わらなかったため" : "履歴補完が一時的に失敗したため"
    );
  }

  return buildInsufficientHistoricalResponse(filing, hydration);
}

export function selectHistoricalAutohydrationCandidates(
  current: Pick<FilingReference, "formType" | "accessionNumber" | "periodOfReport">,
  filings: FilingReference[]
): FilingReference[] {
  const currentAccession = normalizeAccession(current.accessionNumber);
  const windowStart = subtractYearsIsoDate(current.periodOfReport, AUTO_HYDRATION_YEARS);
  const candidates = filings
    .filter((candidate) => candidate.formType === current.formType)
    .filter((candidate) => normalizeAccession(candidate.accessionNumber) !== currentAccession)
    .filter((candidate) => candidate.periodOfReport < current.periodOfReport)
    .filter((candidate) => candidate.periodOfReport >= windowStart)
    .sort((left, right) => right.periodOfReport.localeCompare(left.periodOfReport));

  if (current.formType === "10-K") {
    return candidates.slice(0, AUTO_HYDRATION_MAX_PRIOR_FILINGS);
  }

  const selected: FilingReference[] = [];
  const remaining = [...candidates];
  for (let yearOffset = 1; yearOffset <= AUTO_HYDRATION_MAX_PRIOR_FILINGS; yearOffset += 1) {
    const targetDate = subtractYearsIsoDate(current.periodOfReport, yearOffset);
    const bestIndex = findClosestQuarterMatchIndex(remaining, targetDate);
    if (bestIndex === -1) {
      continue;
    }

    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return selected;
}

async function hydrateHistoricalCoverageForChat(
  filing: FilingCacheRecord,
  env: Env,
  config: RemoteConfig
): Promise<HydrationAttempt> {
  try {
    const tickerRecord = await lookupTicker(filing.ticker, env);
    if (!tickerRecord) {
      logWarnEvent("chat_historical_hydration_skipped", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        reason: "ticker_not_found"
      });
      return {
        attempted: false,
        selectedCount: 0,
        hydratedCount: 0,
        status: "skipped",
        reason: "ticker_not_found"
      };
    }

    const submissions = await fetchSubmissions(tickerRecord.cik, env);
    const candidates = selectHistoricalAutohydrationCandidates(
      {
        formType: filing.formType,
        accessionNumber: filing.filingKey.split(":")[2] ?? filing.filingKey,
        periodOfReport: filing.periodOfReport
      },
      listSupportedFilings(tickerRecord, submissions)
    );

    if (candidates.length === 0) {
      logWarnEvent("chat_historical_hydration_skipped", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        reason: "no_comparable_candidates"
      });
      return {
        attempted: false,
        selectedCount: 0,
        hydratedCount: 0,
        status: "skipped",
        reason: "no_comparable_candidates"
      };
    }

    logEvent("chat_historical_hydration_attempted", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      selectedCount: candidates.length,
      timeoutMs: AUTO_HYDRATION_TIMEOUT_MS
    });

    let hydratedCount = 0;
    for (const candidate of candidates) {
      await withTimeout(
        ensureHistoricalFilingStored(candidate, pickComparisonFiling(tickerRecord, submissions, candidate), env, config),
        AUTO_HYDRATION_TIMEOUT_MS,
        `historical hydration timed out for ${candidate.ticker}:${candidate.accessionNumber}`
      );
      hydratedCount += 1;
    }

    return {
      attempted: true,
      selectedCount: candidates.length,
      hydratedCount,
      status: "completed"
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const status = /timed out/i.test(reason) ? "timed_out" : "failed";
    logErrorEvent("chat_historical_hydration_failed", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason,
      status
    });
    return {
      attempted: true,
      selectedCount: 0,
      hydratedCount: 0,
      status,
      reason
    };
  }
}

function buildHistoricalDegradeResponse(
  filing: FilingCacheRecord,
  question: string,
  reasonCopy: string
): ChatResponsePayload {
  const latestSnapshot = buildLatestFilingFallback(filing, question);
  const answerParts = [`${reasonCopy}、今回は3年比較を完了できません。`, latestSnapshot.answer];
  answerParts.push("比較が必要なら少し時間を置いてから、もう一度お試しください。");

  return {
    answer: answerParts.join(" ").trim(),
    sources: latestSnapshot.sources
  };
}

function buildInsufficientHistoricalResponse(
  filing: FilingCacheRecord,
  hydration: HydrationAttempt
): ChatResponsePayload {
  const source =
    filing.sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric") ??
    filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a") ??
    filing.sourceChunks[0];

  if (!source) {
    return {
      answer:
        filing.formType === "10-Q"
          ? "この3年比較は同四半期の 10-Q を並べる必要がありますが、まだ比較に足る履歴を用意できていません。"
          : "この3年比較は年次の 10-K を並べる必要がありますが、まだ比較に足る履歴を用意できていません。",
      sources: []
    };
  }

  const requirementCopy =
    filing.formType === "10-Q"
      ? "この3年比較は同じ四半期の 10-Q を並べないと季節性でぶれます。"
      : "この3年比較は年次の 10-K を複数期そろえて見る必要があります。";
  const hydrationCopy =
    hydration.hydratedCount > 0
      ? "必要な過去年だけ自動補完しましたが、まだ比較できるだけの履歴が足りません。"
      : hydration.attempted
        ? `必要な過去年の補完を試しましたが、まだ比較できるだけの履歴が足りません。${describeHydrationReason(hydration)}`
        : `現時点では比較に足る過去年の提出資料がまだ揃っていません。${describeHydrationReason(hydration)}`;

  return {
    answer: `${requirementCopy} ${hydrationCopy} いま確実に確認できるのは最新 filing の内容までです。`,
    sources: [buildSecFilingSource(source)]
  };
}

function describeHydrationReason(hydration: HydrationAttempt): string {
  if (!hydration.reason) {
    return "";
  }

  if (hydration.status === "timed_out") {
    return " 自動補完は一定時間で打ち切りました。";
  }

  if (hydration.status === "failed") {
    return " 自動補完は一時的に失敗しました。";
  }

  if (hydration.status === "skipped") {
    return ` 理由は ${normalizeReasonForUser(hydration.reason)} です。`;
  }

  return "";
}

function findClosestQuarterMatchIndex(candidates: FilingReference[], targetDate: string): number {
  const targetMs = new Date(targetDate).getTime();
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index += 1) {
    const distanceDays = Math.abs(new Date(candidates[index]!.periodOfReport).getTime() - targetMs) / (24 * 60 * 60 * 1000);
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

function normalizeAccession(value: string): string {
  return value.replaceAll("-", "").trim();
}

function subtractYearsIsoDate(input: string, years: number): string {
  const date = new Date(input);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function normalizeReasonForUser(reason: string): string {
  if (reason === "bindings_unavailable") {
    return "履歴ストレージ未接続";
  }
  if (reason === "ticker_not_found") {
    return "ticker 情報未解決";
  }
  if (reason === "no_comparable_candidates") {
    return "比較対象の過去年 filing が不足";
  }
  if (/timed out/i.test(reason)) {
    return "履歴補完が一定時間内に終わらなかった";
  }

  const trimmed = reason.trim();
  if (!trimmed) {
    return "一時的な内部エラー";
  }

  return "一時的な内部エラー";
}

function buildLatestFilingFallback(filing: FilingCacheRecord, question: string): ChatResponsePayload {
  const metric = selectFallbackMetric(filing, question);
  if (metric) {
    const metricSource =
      findMetricSourceChunk(filing, metric.logicalName) ??
      filing.sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric");

    return {
      answer: `最新 filing の範囲では、${buildMetricObservationSentence(metric)} いま確実に言えるのは直近1期の数字までです。`,
      sources: metricSource ? [buildSecFilingSource(metricSource)] : []
    };
  }

  const source =
    filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a") ??
    filing.sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric") ??
    filing.sourceChunks[0];
  const verdict = filing.summary.verdict.trim();

  return {
    answer: verdict
      ? `最新 filing の範囲では、${verdict} いま確実に言えるのは直近1期の内容までです。`
      : "最新 filing の範囲では、いま確実に言えるのは直近1期の内容までです。",
    sources: source ? [buildSecFilingSource(source)] : []
  };
}

function selectFallbackMetric(
  filing: FilingCacheRecord,
  question: string
): MetricSnapshot | undefined {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  const preferred: MetricSnapshot["logicalName"][] = [];

  if (/(売上|revenue|growth|成長)/.test(normalized)) {
    preferred.push("revenue");
  }
  if (/(営業利益|operatingincome|本業)/.test(normalized)) {
    preferred.push("operatingIncome");
  }
  if (/(純利益|netincome|利益|儲)/.test(normalized)) {
    preferred.push("netIncome");
  }
  if (/(eps|一株|pershare)/.test(normalized)) {
    preferred.push("epsBasic");
  }
  if (/(キャッシュフロー|cashflow|cash flow|現金)/.test(normalized)) {
    preferred.push("operatingCashFlow");
  }

  preferred.push("revenue", "operatingIncome", "netIncome", "operatingCashFlow", "epsBasic");

  for (const logicalName of preferred) {
    const metric = filing.metrics.find((entry) => entry.logicalName === logicalName);
    if (metric) {
      return metric;
    }
  }

  return undefined;
}

function buildMetricObservationSentence(metric: MetricSnapshot): string {
  const label = metricLabel(metric.logicalName);
  const current = formatMetricValue(metric.value, metric.unit);

  if (metric.yoyPercent !== undefined) {
    return `${label}は ${current} で、前年同期比 ${formatYoYDelta(metric.yoyPercent)} です。`;
  }

  if (metric.comparisonValue !== undefined) {
    return `${label}は ${current} で、比較値は ${formatMetricValue(metric.comparisonValue, metric.unit)} です。`;
  }

  return `${label}は ${current} です。`;
}

function findMetricSourceChunk(
  filing: FilingCacheRecord,
  logicalName: MetricSnapshot["logicalName"]
) {
  const metric = filing.metrics.find((entry) => entry.logicalName === logicalName);
  if (!metric) {
    return undefined;
  }

  return filing.sourceChunks.find(
    (chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed
  );
}
