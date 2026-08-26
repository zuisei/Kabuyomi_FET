import { describe, expect, it } from "vitest";
import { buildLongRunSeries, findTurningPoints } from "../src/lib/history/long-run";

/// 数字はすべて Apple の実データ(SEC companyconcept、2026-08-25 取得)。
/// 作った値では、タグが年で切り替わることも遡及修正の存在も再現できない。
function annual(value: number, year: number, filed: string, accn = `0000320193-${String(year).slice(2)}-000001`) {
  return {
    val: value,
    start: `${year - 1}-09-30`,
    end: `${year}-09-28`,
    form: "10-K",
    fp: "FY",
    filed,
    accn
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

  /// 年表の各行から原文へ飛べること。数字だけ並べた年表は、
  /// このアプリが出していい形ではない。
  it("carries the filing that reported each year", () => {
    const series = buildLongRunSeries(APPLE)!;
    expect(series.points.find((point) => point.fiscalYear === 2025)?.accessionNumber)
      .toBe("0000320193-25-000001");
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
  function series(values: Array<[number, number]>) {
    return {
      unit: "USD",
      points: values.map(([fiscalYear, value]) => ({
        fiscalYear,
        periodEnd: `${fiscalYear}-09-28`,
        value,
        tagUsed: "t"
      }))
    };
  }

  /// Apple の実データ。2015 まで伸び、2016 で初めて減り、2018 で最高に戻した。
  const APPLE_REVENUE = series([
    [2013, 170_910_000_000],
    [2014, 182_795_000_000],
    [2015, 233_715_000_000],
    [2016, 215_639_000_000],
    [2017, 229_234_000_000],
    [2018, 265_595_000_000]
  ]);

  it("finds the year the story turns", () => {
    const kinds = Object.fromEntries(
      findTurningPoints(APPLE_REVENUE).map((point) => [point.kind, point.fiscalYear])
    );
    expect(kinds.first_decline).toBe(2016);
    expect(kinds.trough).toBe(2016);
  });

  /// 戻すのに 2 年かかっている。直後の 1 年だけ見ていると取りこぼす年で、
  /// しかもここが物語の山になる。
  it("marks the year it got back to a record even when that took two years", () => {
    const recovery = findTurningPoints(APPLE_REVENUE).find((point) => point.kind === "recovery");
    expect(recovery?.fiscalYear).toBe(2018);
  });

  /// Netflix は 2007〜2025 が 19 年連続の増収。「過去最高を更新」を素直に出すと
  /// **19 行すべてに印が付いて、何も指していない年表**になる。
  it("does not litter a company that never declined", () => {
    const netflix = series(
      [1.2, 1.4, 1.7, 2.2, 3.2, 3.6, 4.4, 5.5, 6.8, 8.8].map((billions, index) => [
        2007 + index,
        billions * 1_000_000_000
      ]) as Array<[number, number]>
    );
    const turning = findTurningPoints(netflix);

    expect(turning.length).toBeLessThanOrEqual(3);
    expect(turning.map((point) => point.kind)).not.toContain("recovery");
    expect(turning.map((point) => point.kind)).not.toContain("first_decline");
  });

  /// 桁が変わった年は、単調に伸びる会社で数少ない目印になる。
  it("marks the year the company changed order of magnitude", () => {
    const crossing = series([
      [2020, 8_000_000_000],
      [2021, 9_000_000_000],
      [2022, 11_000_000_000]
    ]);
    expect(findTurningPoints(crossing).find((point) => point.kind === "milestone")?.fiscalYear).toBe(2022);
  });

  /// **新しい順に切ってはいけない。** Apple で試したとき、直近の小さな上下に
  /// 押し出されて「2016 年の初の減収」が消えた。一社に一度しかない印なので最優先。
  it("keeps the first decline even when newer, lesser marks compete for the slots", () => {
    const long = series([
      [2010, 100], [2011, 200], [2012, 150], [2013, 260], [2014, 250], [2015, 270],
      [2016, 260], [2017, 280], [2018, 270], [2019, 290], [2020, 280], [2021, 300]
    ]);
    const turning = findTurningPoints(long);
    expect(turning.find((point) => point.kind === "first_decline")?.fiscalYear).toBe(2012);
  });

  it("says nothing when there is not enough history to have a shape", () => {
    expect(findTurningPoints(series([[2020, 1], [2021, 2]]))).toEqual([]);
  });
});
