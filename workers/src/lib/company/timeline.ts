import { lookupTicker } from "../../clients/sec";
import { fetchMetricsFromFetcher } from "../../clients/sec-fetcher";
import type { Env } from "../../env";
import { buildLongRunSeries, findTurningPoints, type TurningPoint } from "../history/long-run";

/// 会社の年表。「栄枯盛衰」を 1 画面で読ませるためのデータ
/// (2026-08-25 オーナー「企業の歴史解説にしてもありよね年表にして」)。
///
/// **提出書類を 1 本も取り込まずに作れる。** `companyfacts` を 1 回引けば
/// 19 年分が返ってくるので、19 年ぶんの本文解析は要らない
/// (実測: AAPL 2007〜2025 / NFLX 2007〜2025)。
///
/// 語り(解説)を全年ぶん付けようとすると一気に高くつくので、**転換点だけ**に絞る。
/// どの年が転換点かは数字から決まるので、本文を取りに行く前に分かる。

/// 売上のタグ。**並び順が優先順位。** 会社は年を跨いでタグを替えるので、
/// 繋がないと歴史が数年に切り詰められる(AAPL の `Revenues` は 3 年分しかない)。
const REVENUE_TAGS = [
  "Revenues",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenue",
  "RevenueFromContractsWithCustomers"
] as const;

export interface CompanyTimelinePoint {
  fiscalYear: number;
  periodEnd: string;
  value: number;
  /// 後から修正された年は、当時の発表値も返す。当時の記事と数字が合わない
  /// 理由が読者に分かるようにするため。
  restatedFrom?: number;
  /// 前年比(%)。最初の年は null。
  changePercent: number | null;
  /// その年を報告した提出書類。年表の行から原文へ飛ぶ。
  sourceUrl?: string;
}

export interface CompanyTimeline {
  ticker: string;
  companyName: string;
  metric: "revenue";
  unit: string;
  points: CompanyTimelinePoint[];
  turningPoints: TurningPoint[];
}

export async function loadCompanyTimeline(ticker: string, env: Env): Promise<CompanyTimeline | null> {
  const tickerRecord = await lookupTicker(ticker, env);
  if (!tickerRecord) return null;

  const payload = await fetchMetricsFromFetcher(tickerRecord.cik, [...REVENUE_TAGS], env);
  const series = buildLongRunSeries(
    REVENUE_TAGS.map((tag) => ({
      tag,
      concept: payload.concepts?.[tag]
        ?? payload.companyFacts?.facts?.["us-gaap"]?.[tag]
        ?? payload.companyFacts?.facts?.["ifrs-full"]?.[tag]
        ?? null
    }))
  );
  if (!series) return null;

  const points: CompanyTimelinePoint[] = series.points.map((point, index) => {
    const previous = series.points[index - 1];
    return {
      fiscalYear: point.fiscalYear,
      periodEnd: point.periodEnd,
      value: point.value,
      ...(point.restatedFrom === undefined ? {} : { restatedFrom: point.restatedFrom }),
      changePercent:
        previous && previous.value !== 0
          ? ((point.value - previous.value) / Math.abs(previous.value)) * 100
          : null,
      ...(point.accessionNumber
        ? { sourceUrl: filingIndexUrl(tickerRecord.cik, point.accessionNumber) }
        : {})
    };
  });

  return {
    ticker: tickerRecord.ticker,
    companyName: tickerRecord.companyName,
    metric: "revenue",
    unit: series.unit,
    points,
    turningPoints: findTurningPoints(series)
  };
}

/// 提出物のフォルダを指す。本文のファイル名を知らなくても原文に辿り着ける。
function filingIndexUrl(cik: string, accessionNumber: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g, "")}/`;
}
