import type { MetricSnapshot } from "../env";

export function metricLabel(metric: MetricSnapshot["logicalName"]): string {
  const labels: Record<MetricSnapshot["logicalName"], string> = {
    revenue: "売上高",
    netIncome: "純利益",
    epsBasic: "EPS（Basic）",
    operatingIncome: "営業利益",
    operatingCashFlow: "営業CF"
  };

  return labels[metric];
}

export function formatMetricValue(value: number, unit: string): string {
  if (unit === "USD") {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000_000) {
      return `${formatCompactNumber(value / 1_000_000_000_000)}兆ドル`;
    }
    if (abs >= 100_000_000) {
      return `${formatCompactNumber(value / 100_000_000)}億ドル`;
    }
  }

  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} ${unit}`.trim();
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(value);
}

export function formatYoYDelta(yoyPercent: number): string {
  const formatted = `${Math.abs(yoyPercent).toFixed(1)}%`;
  return `${formatted}${yoyPercent >= 0 ? "増" : "減"}`;
}
