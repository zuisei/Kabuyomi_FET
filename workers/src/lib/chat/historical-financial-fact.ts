import type {
  FinancialFactPeriodKind,
  FinancialFactRole,
  FinancialFiscalQuarter,
  MetricSnapshot
} from "../../env";

export const HISTORICAL_FINANCIAL_FACT = Symbol.for("kabuyomi.historicalFinancialFact");

export interface HistoricalFinancialFactEvidence {
  filingKey: string;
  formType: "10-K" | "10-Q";
  logicalName: MetricSnapshot["logicalName"];
  tagUsed: string;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
  periodKind: FinancialFactPeriodKind;
  fiscalYear: number | null;
  fiscalQuarter: FinancialFiscalQuarter;
  role: Extract<FinancialFactRole, "current" | "comparison" | "reported">;
}

export function readHistoricalFinancialFactEvidence(source: unknown): HistoricalFinancialFactEvidence | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  return (source as { [HISTORICAL_FINANCIAL_FACT]?: HistoricalFinancialFactEvidence })[HISTORICAL_FINANCIAL_FACT];
}
