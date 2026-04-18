import type { Env, FilingCacheRecord, FilingReference } from "../../env";
import { fetchSubmissions, listSupportedFilings, lookupTicker, pickComparisonFiling } from "../../clients/sec";
import { ensureHistoricalFilingStored } from "../filings/history-persistence";
import { hasHistoricalBindings, isHistoricalQuestion, maybeBuildHistoricalChatResponse } from "../history-store";
import { logEvent } from "../logging";
import type { RemoteConfig } from "../remote-config";
import { buildSecFilingSource, type ChatResponsePayload } from "./grounding";

const AUTO_HYDRATION_YEARS = 3;
const AUTO_HYDRATION_MAX_PRIOR_FILINGS = 2;
const SAME_QUARTER_MATCH_WINDOW_DAYS = 45;

type HydrationAttempt = {
  attempted: boolean;
  selectedCount: number;
  hydratedCount: number;
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

  const initial = await maybeBuildHistoricalChatResponse(filing, question, env);
  if (initial || !hasHistoricalBindings(env)) {
    return initial;
  }

  const hydration = await hydrateHistoricalCoverageForChat(filing, env, config);
  if (hydration.hydratedCount > 0) {
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
  }

  logEvent("chat_historical_insufficient", {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    formType: filing.formType,
    selectedCount: hydration.selectedCount,
    hydratedCount: hydration.hydratedCount
  });

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
      return { attempted: false, selectedCount: 0, hydratedCount: 0 };
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

    let hydratedCount = 0;
    for (const candidate of candidates) {
      await ensureHistoricalFilingStored(candidate, pickComparisonFiling(tickerRecord, submissions, candidate), env, config);
      hydratedCount += 1;
    }

    return {
      attempted: candidates.length > 0,
      selectedCount: candidates.length,
      hydratedCount
    };
  } catch (error) {
    logEvent("chat_historical_autohydration_failed", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: error instanceof Error ? error.message : String(error)
    });
    return { attempted: true, selectedCount: 0, hydratedCount: 0 };
  }
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
      ? `必要な過去年だけ自動補完しましたが、まだ比較できるだけの履歴が足りません。`
      : hydration.attempted
        ? "必要な過去年の補完を試しましたが、まだ比較できるだけの履歴が足りません。"
        : "現時点では比較に足る過去年の提出資料がまだ揃っていません。";

  return {
    answer: `${requirementCopy} ${hydrationCopy} いま確実に確認できるのは最新 filing の内容までです。`,
    sources: [buildSecFilingSource(source)]
  };
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
