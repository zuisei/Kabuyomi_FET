import type { Env, FilingCacheRecord, FilingReference, MetricSnapshot } from "../../env";
import { fetchSubmissions, fetchSubmissionsWithHistory, listSupportedFilings, lookupTicker, pickComparisonFiling } from "../../clients/sec";
import { ensureHistoricalFilingStored } from "../filings/history-persistence";
import { selectHistoricalAutohydrationCandidates } from "../history-autohydration";
import { hasHistoricalBindings, isHistoricalQuestion, maybeBuildHistoricalChatResponse } from "../history-store";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../metrics";
import type { RemoteConfig } from "../remote-config";
import { buildSecFilingSource, type ChatResponsePayload } from "./grounding";

const AUTO_HYDRATION_TIMEOUT_MS = 6_000;

type HydrationAttempt = {
  attempted: boolean;
  selectedCount: number;
  hydratedCount: number;
  reason?: string;
  status: "skipped" | "completed" | "failed" | "timed_out";
};

type HistoricalHydrationOptions = {
  executionContext?: Pick<ExecutionContext, "waitUntil">;
};

type HistoricalHydrationPreparation =
  | {
      status: "ready";
      tickerRecord: NonNullable<Awaited<ReturnType<typeof lookupTicker>>>;
      submissions: Awaited<ReturnType<typeof fetchSubmissions>>;
      candidates: FilingReference[];
    }
  | {
      status: "skipped";
      reason: "ticker_not_found" | "no_comparable_candidates";
    };

export async function maybeBuildHistoricalChatResponseWithHydration(
  filing: FilingCacheRecord,
  question: string,
  env: Env,
  config: RemoteConfig,
  options: HistoricalHydrationOptions = {}
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

  const contentMode = resolveHistoricalHydrationContentMode(question);
  let preparation: HistoricalHydrationPreparation;
  try {
    preparation = await prepareHistoricalHydration(filing, env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logErrorEvent("chat_historical_hydration_prepare_failed", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason
    });
    return buildHistoricalDegradeResponse(filing, question, "履歴補完の準備が一時的に失敗したため");
  }
  if (preparation.status === "skipped") {
    return buildInsufficientHistoricalResponse(filing, {
      attempted: false,
      selectedCount: 0,
      hydratedCount: 0,
      status: "skipped",
      reason: preparation.reason
    });
  }

  if (options.executionContext) {
    enqueueHistoricalHydration(filing, env, config, options.executionContext, contentMode, preparation);
    return buildHistoricalDegradeResponse(filing, question, "履歴比較をバックグラウンドで準備中のため");
  }

  const hydration = await hydrateHistoricalCoverageForChat(filing, env, config, {
    contentMode,
    preparation
  });
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

async function hydrateHistoricalCoverageForChat(
  filing: FilingCacheRecord,
  env: Env,
  config: RemoteConfig,
  options: {
    contentMode?: "full" | "metrics_only";
    preparation?: Extract<HistoricalHydrationPreparation, { status: "ready" }>;
  } = {}
): Promise<HydrationAttempt> {
  try {
    const preparation = options.preparation ?? (await prepareHistoricalHydration(filing, env));
    if (preparation.status === "skipped") {
      return {
        attempted: false,
        selectedCount: 0,
        hydratedCount: 0,
        status: "skipped",
        reason: preparation.reason
      };
    }
    const contentMode = options.contentMode ?? "full";

    logEvent("chat_historical_hydration_attempted", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      selectedCount: preparation.candidates.length,
      timeoutMs: AUTO_HYDRATION_TIMEOUT_MS,
      contentMode
    });

    let hydratedCount = 0;
    for (const candidate of preparation.candidates) {
      await withTimeout(
        ensureHistoricalFilingStored(
          candidate,
          pickComparisonFiling(preparation.tickerRecord, preparation.submissions, candidate),
          env,
          config,
          { contentMode }
        ),
        AUTO_HYDRATION_TIMEOUT_MS,
        `historical hydration timed out for ${candidate.ticker}:${candidate.accessionNumber}`
      );
      hydratedCount += 1;
    }

    return {
      attempted: true,
      selectedCount: preparation.candidates.length,
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
      selectedCount: options.preparation?.candidates.length ?? 0,
      hydratedCount: 0,
      status,
      reason
    };
  }
}

async function prepareHistoricalHydration(
  filing: FilingCacheRecord,
  env: Env
): Promise<HistoricalHydrationPreparation> {
  const tickerRecord = await lookupTicker(filing.ticker, env);
  if (!tickerRecord) {
    logWarnEvent("chat_historical_hydration_skipped", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "ticker_not_found"
    });
    return {
      status: "skipped",
      reason: "ticker_not_found"
    };
  }

  const submissions = await fetchSubmissionsWithHistory(tickerRecord.cik, env);
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
      status: "skipped",
      reason: "no_comparable_candidates"
    };
  }

  return {
    status: "ready",
    tickerRecord,
    submissions,
    candidates
  };
}

function enqueueHistoricalHydration(
  filing: FilingCacheRecord,
  env: Env,
  config: RemoteConfig,
  executionContext: Pick<ExecutionContext, "waitUntil">,
  contentMode: "full" | "metrics_only",
  preparation: Extract<HistoricalHydrationPreparation, { status: "ready" }>
): void {
  executionContext.waitUntil(
    (async () => {
      logEvent("chat_historical_hydration_enqueued", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        formType: filing.formType,
        selectedCount: preparation.candidates.length,
        contentMode
      });

      const hydration = await hydrateHistoricalCoverageForChat(filing, env, config, {
        contentMode,
        preparation
      });

      if (hydration.hydratedCount > 0) {
        logEvent("chat_historical_autohydrated", {
          filingKey: filing.filingKey,
          ticker: filing.ticker,
          formType: filing.formType,
          hydratedCount: hydration.hydratedCount,
          mode: "background"
        });
        return;
      }

      logWarnEvent("chat_historical_insufficient", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        formType: filing.formType,
        selectedCount: hydration.selectedCount,
        hydratedCount: hydration.hydratedCount,
        status: hydration.status,
        reason: hydration.reason ?? "history_still_insufficient",
        mode: "background"
      });
    })()
  );
}

function resolveHistoricalHydrationContentMode(question: string): "full" | "metrics_only" {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return /(地域|事業|セグメント|支え|牽引|ドライバ|driver|要因|原因|理由|背景|segment)/.test(normalized)
    ? "full"
    : "metrics_only";
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
        : `現時点では比較に足る過去年の決算資料がまだ揃っていません。${describeHydrationReason(hydration)}`;

  return {
    answer: `${requirementCopy} ${hydrationCopy} いま確実に確認できるのは最新の決算資料の内容までです。`,
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
    return "比較対象の過去年の決算資料が不足";
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
      answer: `最新の決算資料の範囲では、${buildMetricObservationSentence(metric)} いま確実に言えるのは直近1期の数字までです。`,
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
      ? `最新の決算資料の範囲では、${verdict} いま確実に言えるのは直近1期の内容までです。`
      : "最新の決算資料の範囲では、いま確実に言えるのは直近1期の内容までです。",
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
  if (/(純利益|netincome|利益|儲|赤字|黒字|損失|loss)/.test(normalized)) {
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
