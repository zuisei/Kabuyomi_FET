import type { ChatFallbackKind } from "../../clients/gemini/types";

export type FinalAnswerLanguageCheck = {
  ok: boolean;
  japaneseRatio: number;
  englishSentenceCount: number;
  rawExcerptLike: boolean;
  allowedEnglishTerms: string[];
  violations: string[];
  labels: string[];
};

const ALLOWED_ENGLISH_TERMS = [
  "MD&A",
  "SEC",
  "XBRL",
  "10-K",
  "10-Q",
  "net interest income",
  "noninterest income",
  "provision for credit losses",
  "segment results",
  "gross margin",
  "operating margin",
  "same-store sales",
  "traffic",
  "ticket",
  "eCommerce",
  "RPO",
  "ARR",
  "NOI",
  "FFO",
  "EBITDA",
  "capex",
  "backlog",
  "orders",
  "price realization",
  "product revenue",
  "services revenue",
  "geographic revenue",
  "segment revenue",
  "production volume",
  "commodity price",
  "refining margin",
  "occupancy",
  "rate case",
  "credit quality",
  "driver",
  "margin",
  "source",
  "KPI"
];

const ENGLISH_DRIVER_PREFIXES = [
  "前問のdriverは、",
  "利益率driverとして確認できるのは、",
  "確認できるのは、"
];

export function checkFinalAnswerJapaneseOnly(answer: string): FinalAnswerLanguageCheck {
  const normalized = answer.replace(/\s+/g, " ").trim();
  const usedAllowedTerms = ALLOWED_ENGLISH_TERMS.filter((term) => new RegExp(escapeRegExp(term), "i").test(normalized));
  const masked = maskAllowedEnglishTerms(normalized);
  const labels = new Set<string>();
  const violations: string[] = [];
  const japaneseChars = [...normalized].filter((char) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(char)).length;
  const letterChars = [...masked].filter((char) => /[A-Za-z]/.test(char)).length;
  const japaneseRatio = japaneseChars / Math.max(1, japaneseChars + letterChars);
  const englishSentenceCount = countEnglishSentences(masked);
  const rawExcerptLike = isRawEnglishExcerptLike(masked);

  if (englishSentenceCount > 0) {
    violations.push("English sentence leakage");
    labels.add("english_answer_leak");
  }
  if (rawExcerptLike) {
    violations.push("Raw English SEC excerpt leakage");
    labels.add("raw_english_excerpt");
  }
  if (japaneseChars === 0 && letterChars > 24) {
    violations.push("Answer is not primarily Japanese");
    labels.add("non_japanese_final_answer");
  }
  if (hasEnglishAfterDriverPrefix(masked)) {
    violations.push("English source excerpt used as driver");
    labels.add("english_source_excerpt_as_driver");
  }

  if (labels.size > 0) {
    labels.add("final_answer_language_violation");
  }

  return {
    ok: labels.size === 0,
    japaneseRatio,
    englishSentenceCount,
    rawExcerptLike,
    allowedEnglishTerms: usedAllowedTerms,
    violations,
    labels: [...labels]
  };
}

export function buildJapaneseLanguageGuardFallback({
  question,
  questionIntent,
  fallbackKind,
  missingSourceTypes = []
}: {
  question?: string | null;
  questionIntent?: string | null;
  fallbackKind?: ChatFallbackKind | null;
  missingSourceTypes?: string[];
}): string {
  const effectiveIntent = resolveFallbackIntent(questionIntent, question);
  const missing = joinItems(missingSourceTypes.length > 0 ? missingSourceTypes : sourceTypesForIntent(questionIntent));

  if (effectiveIntent === "revenue_driver") {
    return `売上の増減は確認できますが、選択されたsourceでは会社固有の売上driverを十分に特定できません。主因を見るには、${missing} の説明を追加確認する必要があります。`;
  }

  if (effectiveIntent === "driver_durability_followup") {
    return `前問の具体的なdriverを十分に特定できていないため、このsourceだけで一時要因か継続要因かは分類しません。判断には、${missing} の継続確認が必要です。`;
  }

  if (effectiveIntent === "margin_durability_followup") {
    return "利益率の方向は確認できますが、具体的なmargin driverは十分に特定できません。そのため、このsourceだけで一時要因か構造的変化かは分類しません。判断には、cost、mix、pricing、expenses、provision、segment margin などの説明が必要です。";
  }

  if (fallbackKind === "context_unavailable") {
    return `選択されたsourceだけでは、この質問に直接答えるための具体的な説明を十分に確認できません。追加で必要なのは ${missing} です。`;
  }

  return `選択されたsourceだけでは、この質問に直接答えるための具体的な説明を十分に確認できません。確認できる範囲に限定すると、追加で必要なのは ${missing} です。`;
}

function maskAllowedEnglishTerms(answer: string): string {
  return ALLOWED_ENGLISH_TERMS.reduce(
    (masked, term) => masked.replace(new RegExp(escapeRegExp(term), "gi"), " "),
    answer
  );
}

function countEnglishSentences(maskedAnswer: string): number {
  const matches = maskedAnswer.match(/[A-Z][A-Za-z0-9’'&,()/-]+(?:\s+[A-Za-z0-9’'&,()/-]+){7,}(?:[.;:]|\s|$)/g);
  return matches?.filter((match) => !isAllowedNameLikeEnglishSpan(match)).length ?? 0;
}

function isRawEnglishExcerptLike(maskedAnswer: string): boolean {
  return (
    /[A-Za-z][A-Za-z0-9’'&,()/-]+(?:\s+[A-Za-z][A-Za-z0-9’'&,()/-]+){4,}\s*(?:\.{3}|…)/.test(maskedAnswer) ||
    /(?:\.{3}|…)\s*(?:です|。)/.test(maskedAnswer) ||
    /•\s*[A-Za-z]/.test(maskedAnswer) ||
    /\b(?:Item\s+7|Part\s+I\.\s*Item|Risk Factors|Results of Operations)\b/i.test(maskedAnswer) ||
    /\b(?:U\.S\.|Peru|Chile|Indonesia|China|Europe|Asia),\s+[A-Z][A-Za-z]+,\s+[A-Z][A-Za-z]+/.test(maskedAnswer) ||
    /^[a-z];\s*•/.test(maskedAnswer) ||
    /(?:前問のdriverは、|利益率driverとして確認できるのは、|確認できるのは、)\s*[A-Za-z]/.test(maskedAnswer)
  );
}

function hasEnglishAfterDriverPrefix(maskedAnswer: string): boolean {
  return ENGLISH_DRIVER_PREFIXES.some((prefix) => {
    const index = maskedAnswer.indexOf(prefix);
    if (index < 0) {
      return false;
    }
    const following = maskedAnswer.slice(index + prefix.length).trimStart();
    if (isRawEnglishExcerptLike(following.slice(0, 220))) {
      return true;
    }
    const englishPrefix = following.match(/^[、\s]*([A-Za-z][A-Za-z0-9’'&,()/-]+(?:\s+[A-Za-z0-9’'&,()/-]+){0,14})/);
    if (!englishPrefix) {
      return false;
    }
    const span = englishPrefix[1] ?? "";
    return isRawEnglishExcerptLike(span) || isSentenceLikeEnglish(span);
  });
}

function resolveFallbackIntent(questionIntent?: string | null, question?: string | null): string | null | undefined {
  if (
    questionIntent === "revenue_driver" ||
    questionIntent === "driver_durability_followup" ||
    questionIntent === "margin_durability_followup"
  ) {
    return questionIntent;
  }

  const text = question ?? "";
  if (/(一時|継続|続き|構造)/.test(text)) {
    if (/(利益|margin|マージン)/i.test(text)) {
      return "margin_durability_followup";
    }
    return "driver_durability_followup";
  }

  return questionIntent;
}

function isAllowedNameLikeEnglishSpan(span: string): boolean {
  const cleaned = span.replace(/[.;:]+$/, "").trim();
  if (!cleaned) {
    return true;
  }
  if (isRawEnglishExcerptLike(cleaned)) {
    return false;
  }
  if (isSentenceLikeEnglish(cleaned)) {
    return false;
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  const connectorWords = new Set(["and", "or", "of", "the", "for", "to", "in", "&"]);
  const titleLikeCount = words.filter((word) => {
    const plain = word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    return (
      /^[A-Z0-9&][A-Za-z0-9&'/-]*$/.test(plain) ||
      connectorWords.has(plain.toLowerCase()) ||
      /^[A-Z]{2,}$/.test(plain)
    );
  }).length;

  return titleLikeCount === words.length;
}

function isSentenceLikeEnglish(span: string): boolean {
  const cleaned = span.trim();
  const lower = cleaned.toLowerCase();
  const words = cleaned.match(/[A-Za-z]+/g) ?? [];
  if (words.length < 8) {
    return false;
  }

  if (/\b(is|are|was|were|has|have|had|presents|includes|include|contains|contained|increased|decreased|resulted|operates|provides|continue|continued|benefit|found|related|requires|depends|expects|may|could|would|should)\b/i.test(cleaned)) {
    return true;
  }

  return /\b(the|within|from|because|while|among|related|significant|global|industry|countries)\b/.test(lower);
}

function sourceTypesForIntent(questionIntent?: string | null): string[] {
  switch (questionIntent) {
    case "liquidity_debt":
    case "cash_flow":
      return ["Balance Sheet", "Debt Note", "Liquidity MD&A", "Cash Flow Statement"];
    case "risk_summary":
    case "risk_factors":
      return ["Risk Factors", "MD&A risk discussion", "業種固有risk discussion"];
    case "watch_points":
    case "mda_summary":
      return ["MD&A", "segment results", "revenue driver discussion", "liquidity or risk discussion"];
    case "segment_driver":
    case "segment_analysis":
    case "revenue_breakdown":
      return ["Segment results", "Geographic revenue", "Product/category revenue"];
    case "business_model":
    case "business_overview":
      return ["Business", "Segment Information", "Revenue Note", "MD&A business discussion"];
    case "margin_driver":
    case "margin_profitability":
      return ["cost discussion", "mix", "pricing", "operating expenses", "provision", "segment margin"];
    case "prior_filing_delta":
    case "historical_comparison":
      return ["previous filing evidence", "prior filing MD&A", "prior period XBRL"];
    default:
      return ["MD&A", "segment results", "revenue discussion", "業種固有KPI"];
  }
}

function joinItems(items: string[]): string {
  return [...new Set(items.filter(Boolean))].join("、");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
