import type { MetricSnapshot } from "../env";
import { formatDisplayNumber, formatVerifiedFinancialValue } from "./financial-number-format";

export function metricLabel(metric: MetricSnapshot["logicalName"]): string {
  const labels: Record<MetricSnapshot["logicalName"], string> = {
    revenue: "売上高",
    netIncome: "純利益",
    epsBasic: "EPS（Basic）",
    operatingIncome: "営業利益",
    operatingCashFlow: "営業CF",
    cashAndCashEquivalents: "現金及び現金同等物",
    currentDebt: "1年内返済予定の長期債務",
    longTermDebt: "長期債務（非流動）"
  };

  return labels[metric];
}

export function formatMetricValue(value: number, unit: string): string {
  return formatVerifiedFinancialValue(value, unit);
}

export function formatCompactNumber(value: number): string {
  return formatDisplayNumber(value, 1);
}

export function formatYoYDelta(yoyPercent: number): string {
  const formatted = `${Math.abs(yoyPercent).toFixed(1)}%`;
  return `${formatted}${yoyPercent >= 0 ? "増" : "減"}`;
}
