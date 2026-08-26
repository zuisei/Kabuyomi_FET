import assert from "node:assert/strict";
import test from "node:test";
import {
  MarketDisabledProvider,
  MarketProviderError,
  loadAlignedBars,
  type MarketBarsRequest,
  type MarketBarsResponse,
  type MarketDataProvider,
  type MarketQuoteRequest,
  type MarketQuoteResponse,
  type ProviderMarketBar
} from "../src/market/provider.ts";
import { calculateMarketStudy, marketEvaluationPlan, visibleMarketStudy } from "../src/market/study.ts";

const start = "2026-07-20T14:00:00.000Z";
const end = "2026-07-20T14:30:00.000Z";
const bar = (timestamp: string, close: number, volume: number): ProviderMarketBar => ({ timestamp, open: close, high: close, low: close, close, volume });

test("market calculation aligns benchmark bars and computes volume and abnormal return", () => {
  const result = calculateMarketStudy(
    [bar(start, 100, 1_000), bar(end, 110, 2_400)],
    [bar(start, 100, 5_000), bar(end, 105, 5_500)],
    1_000,
    end
  );
  assert.equal(result.points.length, 2);
  assert.ok(Math.abs(result.points[1].abnormalReturnPoints - 5) < 1e-9);
  assert.ok(Math.abs(result.summary.securityReturn - 0.10) < 1e-9);
  assert.ok(Math.abs(result.summary.benchmarkReturn - 0.05) < 1e-9);
  assert.ok(Math.abs(result.summary.abnormalReturn - 0.05) < 1e-9);
  assert.equal(result.summary.maxVolumeRatio, 2.4);
  assert.equal(result.summary.abnormalReactionDetected, true);
});

test("market plans distinguish day, regular-session and after-hours publication", () => {
  assert.equal(marketEvaluationPlan(start, "day"), "daily_time_unknown");
  assert.equal(marketEvaluationPlan(start, "minute"), "regular_session_minute");
  assert.equal(marketEvaluationPlan("2026-07-20T21:00:00.000Z", "exact"), "next_regular_session_open");
  assert.equal(marketEvaluationPlan("2026-07-19T14:00:00.000Z", "minute"), "next_regular_session_open");
});

test("replay excludes future bars and evaluations", () => {
  const result = calculateMarketStudy(
    [bar(start, 100, 1_000), bar(end, 110, 2_400)],
    [bar(start, 100, 5_000), bar(end, 105, 5_500)],
    1_000,
    end
  );
  const before = visibleMarketStudy(result.points, result.summary, "2026-07-20T14:10:00.000Z");
  assert.deepEqual(before.points.map((point) => point.timestamp), [start]);
  assert.equal(before.summary, null);
  assert.equal(visibleMarketStudy(result.points, result.summary, end).summary?.availableAt, end);
});

test("missing aligned data is rejected", () => {
  assert.throws(
    () => calculateMarketStudy([bar(start, 100, 1_000)], [bar(end, 100, 1_000)], 1_000, end),
    (error: unknown) => error instanceof MarketProviderError && error.code === "missing_data"
  );
});

test("disabled provider and rate-limit failures remain explicit", async () => {
  await assert.rejects(
    () => new MarketDisabledProvider().bars({ symbol: "NVDA", interval: "1min", outputSize: 10 }),
    (error: unknown) => error instanceof MarketProviderError && error.code === "provider_disabled"
  );

  const rateLimited: MarketDataProvider = {
    providerID: "licensed-test",
    licenseMode: "licensed_proxy",
    async bars(_request: MarketBarsRequest): Promise<MarketBarsResponse> {
      throw new MarketProviderError("rate_limited", "Too many requests", 30);
    },
    async quote(_request: MarketQuoteRequest): Promise<MarketQuoteResponse> {
      throw new MarketProviderError("rate_limited", "Too many requests", 30);
    }
  };
  await assert.rejects(
    () => loadAlignedBars(rateLimited, { symbol: "NVDA", interval: "1min", outputSize: 10 }, { symbol: "QQQ", interval: "1min", outputSize: 10 }),
    (error: unknown) => error instanceof MarketProviderError && error.code === "rate_limited" && error.retryAfterSeconds === 30
  );
});

test("provider pair validation rejects missing or mismatched responses", async () => {
  const requests: string[] = [];
  const provider: MarketDataProvider = {
    providerID: "licensed-test",
    licenseMode: "licensed_proxy",
    async bars(request: MarketBarsRequest): Promise<MarketBarsResponse> {
      requests.push(request.symbol);
      return { symbol: request.symbol, providerID: "licensed-test", attribution: "Licensed test data", isDelayed: true, bars: request.symbol === "NVDA" ? [bar(start, 100, 1_000)] : [] };
    },
    async quote(request: MarketQuoteRequest): Promise<MarketQuoteResponse> {
      return { symbol: request.symbol, providerID: "licensed-test", attribution: "Licensed test data", price: 100, observedAt: start };
    }
  };
  await assert.rejects(
    () => loadAlignedBars(provider, { symbol: "NVDA", interval: "1min", outputSize: 10 }, { symbol: "QQQ", interval: "1min", outputSize: 10 }),
    (error: unknown) => error instanceof MarketProviderError && error.code === "missing_data"
  );
  assert.deepEqual(requests.sort(), ["NVDA", "QQQ"]);
});
