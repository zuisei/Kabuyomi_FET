import { MarketProviderError, type ProviderMarketBar } from "./provider.ts";

export type MarketTimePrecision = "exact" | "minute" | "hour" | "day";
export type MarketEvaluationPlan = "regular_session_minute" | "next_regular_session_open" | "daily_time_unknown";

export type MarketStudyPoint = {
  timestamp: string;
  normalizedSecurityPrice: number;
  normalizedBenchmarkPrice: number;
  abnormalReturnPoints: number;
  volumeRatio: number;
};

export type MarketStudySummary = {
  availableAt: string;
  securityReturn: number;
  benchmarkReturn: number;
  abnormalReturn: number;
  maxVolumeRatio: number;
  abnormalReactionDetected: boolean;
};

export type ReviewedNormalizedPoint = {
  timestamp: string;
  normalizedSecurityPrice: number;
  normalizedBenchmarkPrice: number;
  volumeRatio: number;
};

export function calculateReviewedMarketStudy(
  input: ReviewedNormalizedPoint[],
  availableAt: string,
  windowStart: string,
  windowEnd: string
): { points: MarketStudyPoint[]; summary: MarketStudySummary } {
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  const available = Date.parse(availableAt);
  if (![start, end, available].every(Number.isFinite) || start >= end || available < end) {
    throw new MarketProviderError("invalid_response", "Window and availability timestamps are invalid");
  }
  if (input.length < 2) throw new MarketProviderError("missing_data", "At least two normalized points are required");
  const ordered = [...input].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const seen = new Set<number>();
  for (const point of ordered) {
    const observed = Date.parse(point.timestamp);
    if (!Number.isFinite(observed) || observed < start || observed > end || seen.has(observed)) {
      throw new MarketProviderError("invalid_response", "Points must be unique and inside the evaluation window");
    }
    seen.add(observed);
    if (![point.normalizedSecurityPrice, point.normalizedBenchmarkPrice, point.volumeRatio].every(Number.isFinite)
      || point.normalizedSecurityPrice <= 0 || point.normalizedBenchmarkPrice <= 0 || point.volumeRatio < 0) {
      throw new MarketProviderError("invalid_response", "Normalized values must be finite and non-negative");
    }
  }
  const first = ordered[0];
  const points = ordered.map((point) => ({
    ...point,
    abnormalReturnPoints: point.normalizedSecurityPrice - point.normalizedBenchmarkPrice
  }));
  const last = points.at(-1)!;
  const securityReturn = last.normalizedSecurityPrice / first.normalizedSecurityPrice - 1;
  const benchmarkReturn = last.normalizedBenchmarkPrice / first.normalizedBenchmarkPrice - 1;
  const abnormalReturn = securityReturn - benchmarkReturn;
  return {
    points,
    summary: {
      availableAt,
      securityReturn,
      benchmarkReturn,
      abnormalReturn,
      maxVolumeRatio: Math.max(...points.map((point) => point.volumeRatio)),
      abnormalReactionDetected: Math.abs(abnormalReturn) >= 0.03
    }
  };
}

export function marketEvaluationPlan(publication: string, precision: MarketTimePrecision): MarketEvaluationPlan {
  if (precision === "day") return "daily_time_unknown";
  const date = new Date(publication);
  if (!Number.isFinite(date.getTime())) throw new MarketProviderError("invalid_response", "Publication time is invalid");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(value("weekday"))) return "next_regular_session_open";
  const minuteOfDay = Number(value("hour")) * 60 + Number(value("minute"));
  return minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 16 * 60
    ? "regular_session_minute"
    : "next_regular_session_open";
}

export function calculateMarketStudy(
  securityBars: ProviderMarketBar[],
  benchmarkBars: ProviderMarketBar[],
  baselineVolume: number,
  availableAt: string
): { points: MarketStudyPoint[]; summary: MarketStudySummary } {
  const benchmarkByTime = new Map(benchmarkBars.map((bar) => [bar.timestamp, bar]));
  const aligned = securityBars
    .flatMap((security): Array<{ security: ProviderMarketBar; benchmark: ProviderMarketBar }> => {
      const benchmark = benchmarkByTime.get(security.timestamp);
      return benchmark ? [{ security, benchmark }] : [];
    })
    .sort((left, right) => left.security.timestamp.localeCompare(right.security.timestamp));

  if (aligned.length < 2) throw new MarketProviderError("missing_data", "At least two aligned security and benchmark bars are required");
  const first = aligned[0];
  if (first.security.close <= 0 || first.benchmark.close <= 0) throw new MarketProviderError("invalid_response", "Baseline prices must be positive");
  const effectiveBaselineVolume = baselineVolume > 0 ? baselineVolume : first.security.volume;

  const points = aligned.map(({ security, benchmark }) => {
    const normalizedSecurityPrice = security.close / first.security.close * 100;
    const normalizedBenchmarkPrice = benchmark.close / first.benchmark.close * 100;
    return {
      timestamp: security.timestamp,
      normalizedSecurityPrice,
      normalizedBenchmarkPrice,
      abnormalReturnPoints: normalizedSecurityPrice - normalizedBenchmarkPrice,
      volumeRatio: effectiveBaselineVolume > 0 ? security.volume / effectiveBaselineVolume : 0
    };
  });
  const last = points.at(-1)!;
  const securityReturn = last.normalizedSecurityPrice / points[0].normalizedSecurityPrice - 1;
  const benchmarkReturn = last.normalizedBenchmarkPrice / points[0].normalizedBenchmarkPrice - 1;
  const abnormalReturn = securityReturn - benchmarkReturn;
  return {
    points,
    summary: {
      availableAt,
      securityReturn,
      benchmarkReturn,
      abnormalReturn,
      maxVolumeRatio: Math.max(...points.map((point) => point.volumeRatio)),
      abnormalReactionDetected: Math.abs(abnormalReturn) >= 0.03
    }
  };
}

export function visibleMarketStudy(
  points: MarketStudyPoint[],
  summary: MarketStudySummary,
  asOf: string
): { points: MarketStudyPoint[]; summary: MarketStudySummary | null } {
  const boundary = new Date(asOf).getTime();
  if (!Number.isFinite(boundary)) throw new MarketProviderError("invalid_response", "Replay boundary is invalid");
  return {
    points: points.filter((point) => new Date(point.timestamp).getTime() <= boundary),
    summary: new Date(summary.availableAt).getTime() <= boundary ? summary : null
  };
}
