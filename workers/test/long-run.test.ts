import { describe, expect, it } from "vitest";
import { buildLongRunSeries, findTurningPoints } from "../src/lib/history/long-run";

/// 数字はすべて Apple の実データ(SEC companyconcept、2026-08-25 取得)。
/// 作った値では、タグが年で切り替わることも遡及修正の存在も再現できない。
function annual(value: number, year: number, filed: string) {
  return {
    val: value,
    start: `${year - 1}-09-30`,
    end: `${year}-09-28`,
    form: "10-K",
    fp: "FY",
    filed
  };
}

/// Apple は売上のタグを 2 度替えている。1 タグだけ見ると 19 年が 3 年に縮む。
const APPLE = [
  {
    tag: "Revenues",
    concept: {
      units: {
        USD: [annual(215_639_000_000, 2016, "2018-11-05"), annual(229_234_000_000, 2017, "2018-11-05")]
      }
    }
  },
  {
    tag: "SalesRevenueNet",
    concept: {
      units: {
        USD: [
          // 2008 は当時 32.48B と発表され、のちに 37.49B へ修正された
          //(iPhone の収益認識の変更)。
          annual(32_479_000_000, 2008, "2008-11-05"),
          annual(37_491_000_000, 2008, "2010-10-27"),
          annual(65_225_000_000, 2010, "2010-10-27"),
          annual(215_639_000_000, 2016, "2016-10-26")
        ]
      }
    }
  },
  {
    tag: "RevenueFromContractWithCustomerExcludingAssessedTax",
    concept: {
      units: {
        USD: [
          annual(229_234_000_000, 2017, "2019-10-31"),
          annual(265_595_000_000, 2018, "2019-10-31"),
          annual(260_174_000_000, 2019, "2019-10-31"),
          annual(391_035_000_000, 2024, "2024-11-01"),
          annual(416_161_000_000, 2025, "2025-10-31")
        ]
      }
    }
  }
] as never;

describe("long-run series", () => {
  /// これが本題。会社はタグを替えるので、繋がないと歴史にならない。
  it("stitches tags so the history is not truncated to one tag's span", () => {
    const series = buildLongRunSeries(APPLE)!;
    const years = series.points.map((point) => point.fiscalYear);

    expect(years).toEqual([2008, 2010, 2016, 2017, 2018, 2019, 2024, 2025]);
    // 単独のタグでは 2016〜2017 の 2 年しか取れない。
    expect(buildLongRunSeries([APPLE[0]] as never)!.points).toHaveLength(2);
  });

  /// 同じ年に 2 つの値があるのは遡及修正。後の値を採り、元の値を残す。
  it("takes the restated figure and keeps what was originally reported", () => {
    const series = buildLongRunSeries(APPLE)!;
    const restated = series.points.find((point) => point.fiscalYear === 2008)!;

    expect(restated.value).toBe(37_491_000_000);
    expect(restated.restatedFrom).toBe(32_479_000_000);
  });

  it("does not mark an unrevised year as restated", () => {
    const series = buildLongRunSeries(APPLE)!;
    expect(series.points.find((point) => point.fiscalYear === 2025)?.restatedFrom).toBeUndefined();
  });

  /// 重複する年の値はタグ間で一致していた(実測)。繋いでも矛盾しない。
  it("agrees on a year reported under more than one tag", () => {
    const series = buildLongRunSeries(APPLE)!;
    expect(series.points.find((point) => point.fiscalYear === 2017)?.value).toBe(229_234_000_000);
  });

  it("ignores quarterly and non-annual facts", () => {
    const withQuarter = [
      {
        tag: "Revenues",
        concept: {
          units: {
            USD: [
              annual(100, 2020, "2020-11-01"),
              { val: 25, start: "2020-01-01", end: "2020-03-31", form: "10-Q", fp: "Q1", filed: "2020-04-30" }
            ]
          }
        }
      }
    ] as never;
    expect(buildLongRunSeries(withQuarter)!.points).toHaveLength(1);
  });
});

describe("turning points", () => {
  /// 19 年ぶんの本文を取り込むのは高い。**語る年だけ**を先に決める。
  const series = {
    unit: "USD",
    points: [
      { fiscalYear: 2013, periodEnd: "2013-09-28", value: 170_910_000_000, tagUsed: "t" },
      { fiscalYear: 2014, periodEnd: "2014-09-27", value: 182_795_000_000, tagUsed: "t" },
      { fiscalYear: 2015, periodEnd: "2015-09-26", value: 233_715_000_000, tagUsed: "t" },
      { fiscalYear: 2016, periodEnd: "2016-09-24", value: 215_639_000_000, tagUsed: "t" },
      { fiscalYear: 2017, periodEnd: "2017-09-30", value: 229_234_000_000, tagUsed: "t" },
      { fiscalYear: 2018, periodEnd: "2018-09-29", value: 265_595_000_000, tagUsed: "t" }
    ]
  };

  it("finds the year the story turns", () => {
    const turning = findTurningPoints(series);
    const kinds = Object.fromEntries(turning.map((point) => [point.kind, point.fiscalYear]));

    // Apple が初めて減収したのは 2016 年度。
    expect(kinds.first_decline).toBe(2016);
    // その 2016 が底。
    expect(kinds.trough).toBe(2016);
    // 2018 で過去最高を更新し直した。単なる record ではなく recovery。
    expect(kinds.recovery).toBe(2018);
  });

  it("calls it a record, not a recovery, when nothing ever fell", () => {
    const onlyUp = {
      unit: "USD",
      points: [1, 2, 3, 4].map((n) => ({
        fiscalYear: 2020 + n,
        periodEnd: `${2020 + n}-12-31`,
        value: n * 100,
        tagUsed: "t"
      }))
    };
    const kinds = findTurningPoints(onlyUp).map((point) => point.kind);
    expect(kinds).toContain("record");
    expect(kinds).not.toContain("recovery");
    expect(kinds).not.toContain("first_decline");
  });

  it("says nothing when there is not enough history to have a shape", () => {
    expect(findTurningPoints({ unit: "USD", points: series.points.slice(0, 2) })).toEqual([]);
  });
});
