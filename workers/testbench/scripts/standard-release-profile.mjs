export const STANDARD_RELEASE_PROFILE = Object.freeze({
  version: "standard-release-profile-v1",
  expectedRows: 150,
  templates: Object.freeze([
    "Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08", "Q09", "Q10"
  ]),
  tickers: Object.freeze([
    "AAPL", "JPM", "XOM", "CAT", "WMT", "NVDA", "MU", "MSFT", "GOOGL", "AMZN", "TSLA", "LLY", "V", "KO", "DAL"
  ]),
  questionsPath: "testbench/questions/prompt-v2-smoke-10.jsonl",
  companySetPath: "testbench/company-sets/production-tracked-15.json"
});

export function applyStandardReleaseProfile(thresholds) {
  return {
    ...thresholds,
    requiredTemplates: [...STANDARD_RELEASE_PROFILE.templates],
    exactTemplates: [...STANDARD_RELEASE_PROFILE.templates],
    exactTickers: [...STANDARD_RELEASE_PROFILE.tickers],
    minCompanyTickers: STANDARD_RELEASE_PROFILE.tickers.length,
    exactCompanyTickers: STANDARD_RELEASE_PROFILE.tickers.length,
    minRows: STANDARD_RELEASE_PROFILE.expectedRows,
    exactRows: STANDARD_RELEASE_PROFILE.expectedRows
  };
}
