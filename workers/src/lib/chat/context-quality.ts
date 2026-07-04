import type { QuestionIntent } from "./intent";

export interface NarrativeQuality {
  charCount: number;
  wordCount: number;
  sentenceCount: number;
  digitRatio: number;
  textRatio: number;
  isShort: boolean;
  isTableFragment: boolean;
  isTableBoilerplate: boolean;
  isHeadingOnly: boolean;
  isLowTextQuality: boolean;
  isBoilerplate: boolean;
  isMeaningful: boolean;
}

export function assessNarrativeQuality(text: string): NarrativeQuality {
  const normalized = normalizeWhitespace(text);
  const charCount = normalized.length;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const sentenceCount = (normalized.match(/[.!?。！？]/g) ?? []).length;
  const digits = (normalized.match(/\d/g) ?? []).length;
  const textChars = (normalized.match(/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length;
  const digitRatio = charCount > 0 ? digits / charCount : 0;
  const textRatio = charCount > 0 ? textChars / charCount : 0;
  const isBoilerplate = isLowSignalBoilerplate(normalized);
  const isShort = charCount < 250;
  const isHeadingOnly = charCount < 120 && sentenceCount === 0 && wordCount <= 8;
  const hasTableBoilerplatePhrase = /table of contents|following table sets forth|expressed as a percentage of revenue/i.test(
    normalized
  );
  const hasBusinessSignal = /accelerated computing|data center|compute|networking|graphics|gaming|professional visualization|automotive|customers?|cloud service providers?|enterprise|revenue from/i.test(
    normalized
  );
  const isTableBoilerplate =
    hasTableBoilerplatePhrase && (charCount < 500 || (!hasBusinessSignal && digitRatio > 0.18));
  const isTableFragment =
    /^(year ended|jan\.?\s+\d+|revenue|gross margin|operating income|net income|total|percentage|in millions)$/i.test(normalized) ||
    (sentenceCount === 0 && (digitRatio > 0.2 || wordCount <= 10)) ||
    (/table sets forth|following table|expressed as a percentage/i.test(normalized) && charCount < 260);
  const hasEnoughSentenceShape = sentenceCount >= 2 || wordCount >= 45;
  const isLowTextQuality = digitRatio >= 0.35 || textRatio <= 0.45 || !hasEnoughSentenceShape;

  return {
    charCount,
    wordCount,
    sentenceCount,
    digitRatio,
    textRatio,
    isShort,
    isTableFragment,
    isTableBoilerplate,
    isHeadingOnly,
    isLowTextQuality,
    isBoilerplate,
    isMeaningful: !isShort && !isTableFragment && !isTableBoilerplate && !isHeadingOnly && !isLowTextQuality && !isBoilerplate
  };
}

export function shouldRejectNarrativeSource(questionIntent: QuestionIntent, quality: NarrativeQuality): boolean {
  if (quality.isBoilerplate || quality.isHeadingOnly) {
    return true;
  }

  switch (questionIntent) {
    case "business_overview":
      return quality.isShort || quality.isTableBoilerplate || quality.isTableFragment || (quality.isLowTextQuality && quality.charCount < 700);
    case "risk_factors":
      return quality.isShort || quality.isTableFragment || (quality.isLowTextQuality && quality.charCount < 700);
    case "segment_analysis":
      return quality.isShort || quality.isHeadingOnly || (quality.isTableFragment && quality.charCount < 350);
    case "mda_summary":
    case "investment_view":
    case "stock_market_context":
      return quality.isHeadingOnly || (quality.isTableFragment && quality.charCount < 350);
    case "revenue_breakdown":
      return quality.isHeadingOnly || (quality.isTableFragment && quality.charCount < 300);
    case "margin_profitability":
    case "cash_flow":
    case "liquidity_debt":
    case "yoy_change":
    case "historical_comparison":
    case "unknown":
      return quality.isHeadingOnly || (quality.isTableFragment && quality.charCount < 220);
  }
}

export function narrativeQualityScore(quality: NarrativeQuality, questionIntent: QuestionIntent): number {
  let score = 0;
  if (quality.charCount >= 800) {
    score += 20;
  } else if (quality.charCount >= 500) {
    score += 12;
  } else if (quality.charCount >= 250) {
    score += 6;
  }

  if (quality.sentenceCount >= 3) {
    score += 10;
  }
  if (quality.digitRatio < 0.12 && questionIntent === "business_overview") {
    score += 8;
  }
  if (!quality.isTableFragment) {
    score += 5;
  }

  return score;
}

export function hasMeaningfulNarrativeShape(text: string): boolean {
  return assessNarrativeQuality(text).isMeaningful;
}

export function isLowSignalBoilerplate(text: string): boolean {
  return /available information|available free of charge|forward-looking statements|private securities litigation reform act|investor relations website|corporate website|sec.?s website|securities and exchange commission|investor\.nvidia\.com|should be read in conjunction/i.test(
    text
  );
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeForDedup(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

export function isOverlappingSupplement(left: string, right: string): boolean {
  const sampleLeft = left.slice(0, 240);
  const sampleRight = right.slice(0, 240);
  return left.includes(sampleRight) || right.includes(sampleLeft);
}
