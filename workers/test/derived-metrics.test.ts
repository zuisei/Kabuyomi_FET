import { describe, expect, it } from "vitest";
import type { MetricSnapshot } from "../src/env";
import { computeDerivedMetrics, formatDerivedMetricValue } from "../src/lib/derived-metrics";

/// 数字は TSMC の実データ(20-F accn 0001193125-25-083423 / FY2024、USD)。
function metric(
  logicalName: MetricSnapshot["logicalName"],
  value: number,
  overrides: Partial<MetricSnapshot> = {}
): MetricSnapshot {
  return {
    logicalName,
    tagUsed: "X",
    value,
    unit: "USD",
    periodEnd: "2024-12-31",
    periodKind: "annual",
    ...overrides
  };
}

const TSM_FY2024 = [
  metric("revenue", 88_268_000_000),
  metric("operatingIncome", 40_318_800_000),
  metric("netIncome", 35_301_100_000),
  metric("operatingCashFlow", 55_693_100_000, { periodKind: "annual" }),
  metric("capitalExpenditure", 29_780_000_000, { periodKind: "annual" }),
  metric("equity", 144_032_000_000, { periodKind: "instant" }),
  metric("totalAssets", 216_000_000_000, { periodKind: "instant" })
];

const find = (metrics: ReturnType<typeof computeDerivedMetrics>, name: string) =>
  metrics.find((derived) => derived.logicalName === name);

describe("derived metrics", () => {
  it("computes the ratios a paid terminal charges for", () => {
    const derived = computeDerivedMetrics(TSM_FY2024);

    expect(formatDerivedMetricValue(find(derived, "roe")!)).toBe("24.5%");
    expect(formatDerivedMetricValue(find(derived, "operatingMargin")!)).toBe("45.7%");
    expect(find(derived, "freeCashFlow")?.value).toBe(25_913_100_000);
  });

  /// 計算結果は提出書類のどこにも書かれていない。答えだけを出すと、
  /// このアプリが守ってきた「すべての記述に出典がある」を自分で破ることになる。
  it("carries the formula and both operands so the number can be checked", () => {
    const roe = find(computeDerivedMetrics(TSM_FY2024), "roe")!;

    expect(roe.formula).toBe("純利益 ÷ 自己資本");
    expect(roe.definitionNote).toContain("期末");
    expect(roe.operands.map((operand) => operand.logicalName)).toEqual(["netIncome", "equity"]);
    expect(roe.operands[0]).toMatchObject({ value: 35_301_100_000, label: "純利益" });
    expect(roe.operands[1]).toMatchObject({ value: 144_032_000_000, label: "自己資本" });
  });

  it("computes nothing when an operand is missing", () => {
    const withoutEquity = TSM_FY2024.filter((m) => m.logicalName !== "equity");
    expect(find(computeDerivedMetrics(withoutEquity), "roe")).toBeUndefined();
    // 他の指標は巻き添えにしない。
    expect(find(computeDerivedMetrics(withoutEquity), "operatingMargin")).toBeDefined();
  });

  /// 別の期の値どうしを割ると、それらしい比率が出てしまう。桁も符号も自然なので気づけない。
  it("refuses operands from different periods", () => {
    const mismatched = [
      metric("netIncome", 35_301_100_000),
      metric("equity", 144_032_000_000, { periodKind: "instant", periodEnd: "2023-12-31" })
    ];
    expect(find(computeDerivedMetrics(mismatched), "roe")).toBeUndefined();
  });

  /// 外国企業は現地通貨と USD の両方を出すことがある。混ぜると桁が合わない。
  it("refuses operands in different currencies", () => {
    const mismatched = [
      metric("netIncome", 1_158_380_000_000, { unit: "TWD" }),
      metric("equity", 144_032_000_000, { unit: "USD", periodKind: "instant" })
    ];
    expect(find(computeDerivedMetrics(mismatched), "roe")).toBeUndefined();
  });

  /// 四半期の利益を期末の自己資本で割った値は年率化されていない。
  /// ROE として読むとおよそ 4 分の 1 に見えるので、年度以外は出さない。
  it("does not report ROE for a quarter", () => {
    const quarterly = [
      metric("netIncome", 8_000_000_000, { periodKind: "quarter" }),
      metric("equity", 144_032_000_000, { periodKind: "instant" })
    ];
    expect(find(computeDerivedMetrics(quarterly), "roe")).toBeUndefined();
    // 利益率は期間どうしの比なので四半期でも意味がある。
    const quarterlyMargin = [
      metric("netIncome", 8_000_000_000, { periodKind: "quarter" }),
      metric("revenue", 20_000_000_000, { periodKind: "quarter" })
    ];
    expect(find(computeDerivedMetrics(quarterlyMargin), "netMargin")).toBeDefined();
  });

  /// 設備投資の符号は会社によって割れる。素直に引くと符号が反転する会社が出る。
  it("subtracts capital expenditure regardless of how the filing signs it", () => {
    const negativeCapex = [
      metric("operatingCashFlow", 55_693_100_000),
      metric("capitalExpenditure", -29_780_000_000)
    ];
    expect(find(computeDerivedMetrics(negativeCapex), "freeCashFlow")?.value).toBe(25_913_100_000);
  });

  it("does not divide by zero", () => {
    const zeroEquity = [
      metric("netIncome", 35_301_100_000),
      metric("equity", 0, { periodKind: "instant" })
    ];
    expect(find(computeDerivedMetrics(zeroEquity), "roe")).toBeUndefined();
  });
});
