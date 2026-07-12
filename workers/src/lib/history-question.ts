export type HistoricalComparisonMode = "immediate_prior" | "multi_period_trend";

export function classifyHistoricalComparisonMode(question: string): HistoricalComparisonMode | null {
  const normalized = question.replace(/\s+/g, "").toLowerCase();

  if (
    /(?:前回(?:の)?決算(?:と比べ(?:て|ると)?|と比較|との違い)|前回(?:と比べ(?:て|ると)?|と比較|との違い)|直前(?:の)?(?:決算|提出資料|四半期|年次)|previous(?:filing|quarter|results?))/.test(
      normalized
    )
  ) {
    return "immediate_prior";
  }

  if (
    /(?:3年|三年|過去\d+年|過去|ここ\d+年|ここ数年|履歴|推移|トレンド|historical|history|trend|trends|compare|comparison|timeseries|時系列|比較)/.test(
      normalized
    )
  ) {
    return "multi_period_trend";
  }

  return null;
}

export function isHistoricalQuestion(question: string): boolean {
  return classifyHistoricalComparisonMode(question) !== null;
}
