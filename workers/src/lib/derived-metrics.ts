import type { MetricSnapshot } from "../env";
import { metricLabel } from "./metrics";

/// 提出書類に書かれていない値を、書かれている値から計算する。
///
/// 2026-08-25 オーナー「有料とかになってるデータを計算で求めて出すのはだめなの？」。
/// SEC EDGAR は公開データなので計算して出すこと自体に問題はない
/// (docs/release/DERIVED_METRICS_2026-08-25.md)。ただしこのアプリは
/// **すべての記述に出典がある**ことを建て付けにしていて、ROE のような計算結果は
/// **提出書類のどこにも書かれていない**。
///
/// なので答えだけを出さない。**式と、その材料と、材料の出典を一緒に持つ。**
/// 読む人が検算できる形にして初めて、このアプリが出していい数字になる。
/// (有料端末は 24.5% をくれるが、何を何で割ったかは見せない。そこが違いになる)

export type DerivedMetricName =
  | "roe"
  | "roa"
  | "freeCashFlow"
  | "operatingMargin"
  | "netMargin";

export interface DerivedMetricOperand {
  logicalName: MetricSnapshot["logicalName"];
  label: string;
  value: number;
  unit: string;
  periodEnd: string;
  tagUsed: string;
}

export interface DerivedMetric {
  logicalName: DerivedMetricName;
  label: string;
  value: number;
  /// `ratio` は 0.245 のような比率。金額は元の通貨コードをそのまま持つ。
  unit: "ratio" | string;
  /// 画面にそのまま出す式。数字は入れず、何を何で計算したかだけを書く。
  formula: string;
  /// 定義の明示。ROE は分母を期末にするか期中平均にするかで値が変わる。
  /// どちらで計算したかを書かない指標は、比べようがない。
  definitionNote: string;
  periodEnd: string;
  operands: DerivedMetricOperand[];
}

const LABELS: Record<DerivedMetricName, string> = {
  roe: "ROE（自己資本利益率）",
  roa: "ROA（総資産利益率）",
  freeCashFlow: "フリーキャッシュフロー",
  operatingMargin: "営業利益率",
  netMargin: "純利益率"
};

function operand(metric: MetricSnapshot): DerivedMetricOperand {
  return {
    logicalName: metric.logicalName,
    label: metricLabel(metric.logicalName),
    value: metric.value,
    unit: metric.unit,
    periodEnd: metric.periodEnd,
    tagUsed: metric.tagUsed
  };
}

export function computeDerivedMetrics(metrics: MetricSnapshot[]): DerivedMetric[] {
  const by = new Map<MetricSnapshot["logicalName"], MetricSnapshot>();
  for (const metric of metrics) {
    // 同じ指標が複数来ることは無い想定だが、来たら先勝ちにする(選定は resolveFact 側の仕事)。
    if (!by.has(metric.logicalName)) by.set(metric.logicalName, metric);
  }

  const results: DerivedMetric[] = [];
  const push = (metric: DerivedMetric | null) => {
    if (metric) results.push(metric);
  };

  push(ratio(by, "roe", "netIncome", "equity", {
    formula: "純利益 ÷ 自己資本",
    definitionNote: "分母は期末の自己資本。年度の値のみ算出する。",
    annualOnly: true
  }));
  push(ratio(by, "roa", "netIncome", "totalAssets", {
    formula: "純利益 ÷ 総資産",
    definitionNote: "分母は期末の総資産。年度の値のみ算出する。",
    annualOnly: true
  }));
  push(ratio(by, "operatingMargin", "operatingIncome", "revenue", {
    formula: "営業利益 ÷ 売上高",
    definitionNote: "同じ期間の営業利益と売上高から算出する。"
  }));
  push(ratio(by, "netMargin", "netIncome", "revenue", {
    formula: "純利益 ÷ 売上高",
    definitionNote: "同じ期間の純利益と売上高から算出する。"
  }));
  push(freeCashFlow(by));

  return results;
}

interface RatioOptions {
  formula: string;
  definitionNote: string;
  /// 年度の値だけを出す指標。四半期の利益を期末の自己資本で割った値は
  /// 年率化されておらず、ROE として読むと 4 分の 1 に見える。
  annualOnly?: boolean;
}

function ratio(
  by: Map<MetricSnapshot["logicalName"], MetricSnapshot>,
  name: DerivedMetricName,
  numeratorName: MetricSnapshot["logicalName"],
  denominatorName: MetricSnapshot["logicalName"],
  options: RatioOptions
): DerivedMetric | null {
  const numerator = by.get(numeratorName);
  const denominator = by.get(denominatorName);
  // 材料が片方でも無ければ計算しない。推定を混ぜた時点でこのアプリの意味が無くなる。
  if (!numerator || !denominator) return null;
  if (!alignedForCalculation(numerator, denominator)) return null;
  if (options.annualOnly && numerator.periodKind !== "annual") return null;
  if (denominator.value === 0) return null;

  return {
    logicalName: name,
    label: LABELS[name],
    value: numerator.value / denominator.value,
    unit: "ratio",
    formula: options.formula,
    definitionNote: options.definitionNote,
    periodEnd: numerator.periodEnd,
    operands: [operand(numerator), operand(denominator)]
  };
}

function freeCashFlow(by: Map<MetricSnapshot["logicalName"], MetricSnapshot>): DerivedMetric | null {
  const operating = by.get("operatingCashFlow");
  const capex = by.get("capitalExpenditure");
  if (!operating || !capex) return null;
  if (!alignedForCalculation(operating, capex)) return null;

  // 設備投資はキャッシュフロー計算書に支出額として載る。符号の付け方が
  // 会社によって割れる(正で載せる会社と負で載せる会社がある)ので、
  // 絶対値を引く。ここを素直に足し引きすると、会社によって符号が反転する。
  return {
    logicalName: "freeCashFlow",
    label: LABELS.freeCashFlow,
    value: operating.value - Math.abs(capex.value),
    unit: operating.unit,
    formula: "営業キャッシュフロー − 設備投資",
    definitionNote: "設備投資は有形固定資産の取得による支出。買収・投資有価証券は含まない。",
    periodEnd: operating.periodEnd,
    operands: [operand(operating), operand(capex)]
  };
}

/// 計算に使ってよい組み合わせか。
///
/// - **期末が揃っていること。** 別の期の値どうしを割ると、それらしい比率が出てしまう
/// - **通貨が揃っていること。** 台湾ドルの利益をドルの自己資本で割ると桁が合わない
///   (外国企業は現地通貨と USD の両方を出すことがある)
///
/// 期間の種類(instant / annual)は揃わなくてよい。ROE は期間の利益を時点の
/// 自己資本で割るもので、揃わないのが正しい。
function alignedForCalculation(left: MetricSnapshot, right: MetricSnapshot): boolean {
  return left.periodEnd === right.periodEnd && left.unit === right.unit;
}

export function formatDerivedMetricValue(metric: DerivedMetric): string {
  if (metric.unit !== "ratio") return "";
  return `${(metric.value * 100).toFixed(1)}%`;
}
