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
  "Caterpillar",
  "Construction Industries",
  "Energy & Transportation",
  "Resource Industries",
  "RPO",
  "ARR",
  "NOI",
  "FFO",
  "EBITDA",
  "capex",
  "backlog",
  "dealer inventory",
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
    return `売上の増減は確認できますが、選択された資料だけだと会社固有の売上要因までは追いきれません。次に見るなら、${missing} あたりです。`;
  }

  if (effectiveIntent === "driver_durability_followup") {
    return `前問の具体的な要因を十分に特定できていないため、この資料だけで一時要因か継続要因かは分類しません。判断には、${missing} の継続確認が必要です。`;
  }

  if (effectiveIntent === "margin_durability_followup") {
    return "利益率の方向は確認できますが、具体的な利益率要因は十分に特定できません。そのため、この資料だけで一時要因か構造的変化かは分類しません。判断には、コスト、製品構成、価格、営業費用、引当金、セグメント利益率などの説明が必要です。";
  }

  if (fallbackKind === "context_unavailable") {
    return `選択された資料だけでは、この質問に直接答えるための具体的な説明を十分に確認できません。追加で必要なのは ${missing} です。`;
  }

  return `選択された資料だけでは、この質問に直接答えるための具体的な説明を十分に確認できません。確認できる範囲に限定すると、追加で必要なのは ${missing} です。`;
}

export function buildJapaneseLanguageGuardRepair({
  question,
  questionIntent,
  sourceGateSufficient,
  sourceGateEvidenceSlots
}: {
  question?: string | null;
  questionIntent?: string | null;
  sourceGateSufficient?: boolean | null;
  sourceGateEvidenceSlots?: Record<string, unknown> | null;
}): string | null {
  const effectiveIntent = resolveFallbackIntent(questionIntent, question);
  if (effectiveIntent !== "driver_durability_followup" || sourceGateSufficient !== true) {
    return null;
  }

  const evidenceText = extractEvidenceText(sourceGateEvidenceSlots);
  if (!evidenceText) {
    return null;
  }

  const driverLabels = inferDriverLabels(evidenceText);
  if (driverLabels.length === 0) {
    return null;
  }

  const durabilitySignals = inferDurabilitySignals(evidenceText);
  const nextIndicators = inferNextIndicators(evidenceText, driverLabels);
  const driverText = joinItems(driverLabels.slice(0, 4));
  const signalText = durabilitySignals.length > 0
    ? `提出資料には ${joinItems(durabilitySignals.slice(0, 3))} も示されていますが、これだけで継続性は断定しません。`
    : "ただし、提出資料だけでは継続性は断定できません。";
  const indicatorText = nextIndicators.length > 0
    ? `次に見るべき指標は、${joinItems(nextIndicators.slice(0, 4))} です。`
    : "次に見るべき指標は、同じ要因が次期にも続くかどうかです。";

  return `前問の売上要因は、${driverText} に関する説明が中心です。${signalText}${indicatorText}`;
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

function extractEvidenceText(sourceGateEvidenceSlots?: Record<string, unknown> | null): string {
  if (!sourceGateEvidenceSlots || typeof sourceGateEvidenceSlots !== "object") {
    return "";
  }
  const texts: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string") {
      texts.push(value);
    }
  };

  const metricMovement = sourceGateEvidenceSlots.confirmedMetricMovement;
  if (metricMovement && typeof metricMovement === "object") {
    const record = metricMovement as Record<string, unknown>;
    add(record.label);
    add(record.value);
    add(record.period);
    add(record.change);
  }

  const driverSlots = Array.isArray(sourceGateEvidenceSlots.companyExplainedDrivers)
    ? sourceGateEvidenceSlots.companyExplainedDrivers
    : [];
  for (const slot of driverSlots) {
    if (!slot || typeof slot !== "object") {
      continue;
    }
    const record = slot as Record<string, unknown>;
    add(record.category);
    add(record.driver);
  }

  const signals = Array.isArray(sourceGateEvidenceSlots.segmentOrBusinessSignals)
    ? sourceGateEvidenceSlots.segmentOrBusinessSignals
    : [];
  for (const signal of signals) {
    if (!signal || typeof signal !== "object") {
      continue;
    }
    add((signal as Record<string, unknown>).fact);
  }

  return texts.join(" ").slice(0, 2000);
}

function inferDriverLabels(text: string): string[] {
  const labels: string[] = [];
  const lower = text.toLowerCase();
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(lower)) {
      labels.push(label);
    }
  };

  add("販売数量", /\b(?:sales\s+)?volume|production volumes?|unit volume|数量/);
  add("価格実現", /price realization|pricing|price\/mix|price mix|価格/);
  add("エンドユーザー向け機械販売", /equipment to end users?|end users?|machine sales/);
  add("backlog", /backlog/);
  add("dealer inventory", /dealer inventory|dealer inventories/);
  add("net interest income", /net interest income|nii/);
  add("noninterest income", /noninterest income|investment banking|markets revenue|card services/);
  add("比較可能売上", /comparable sales|comp sales|same-store sales/);
  add("traffic", /traffic/);
  add("ticket", /ticket/);
  add("eCommerce", /ecommerce|e-commerce/);
  add("membership", /membership/);
  add("commodity price", /commodity prices?|crude|oil price|natural gas/);
  add("production volume", /production volumes?|liquids production|gas production/);
  add("refining margin", /refin(?:ing|ery) margins?|downstream margins?/);
  add("services revenue", /services revenue|recurring revenue|installed base/);

  return [...new Set(labels)];
}

function inferDurabilitySignals(text: string): string[] {
  const signals: string[] = [];
  const lower = text.toLowerCase();
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(lower)) {
      signals.push(label);
    }
  };

  add("次期の販売数量や価格実現への見通し", /\bexpect(?:s|ed)?\b.*\b(?:sales|revenues?|volume|price realization)|stronger sales and revenues/);
  add("backlogや受注の確認材料", /backlog|orders?/);
  add("dealer inventoryの変化", /dealer inventory|dealer inventories/);
  add("recurring revenueやサービス需要", /recurring revenue|services revenue|installed base/);
  add("membershipやeCommerceの継続性", /membership|ecommerce|e-commerce/);
  add("金利や預金環境への感応度", /interest rate|deposit|net interest income|nii/);
  add("commodity priceやmarginへの感応度", /commodity prices?|crude|natural gas|refin(?:ing|ery) margins?/);

  return [...new Set(signals)];
}

function inferNextIndicators(text: string, driverLabels: string[]): string[] {
  const lower = text.toLowerCase();
  const indicators = [...driverLabels];
  if (/dealer inventory|dealer inventories/.test(lower)) {
    indicators.push("dealer inventory");
  }
  if (/backlog/.test(lower)) {
    indicators.push("backlog");
  }
  if (/price realization|pricing/.test(lower)) {
    indicators.push("価格実現");
  }
  if (/sales volume|production volume|volume/.test(lower)) {
    indicators.push("販売数量");
  }
  return [...new Set(indicators)];
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
      return ["貸借対照表", "負債の注記", "流動性の説明", "キャッシュフロー計算書"];
    case "risk_summary":
    case "risk_factors":
      return ["リスク要因", "MD&Aのリスク説明", "業種固有リスクの説明"];
    case "watch_points":
    case "mda_summary":
      return ["MD&A", "セグメント実績", "売上要因の説明", "流動性またはリスクの説明"];
    case "segment_driver":
    case "segment_analysis":
    case "revenue_breakdown":
      return ["セグメント実績", "地域別売上", "製品・カテゴリ別売上"];
    case "business_model":
    case "business_overview":
      return ["事業内容", "セグメント情報", "売上内訳", "MD&Aの事業説明"];
    case "margin_driver":
    case "margin_profitability":
      return ["コストの説明", "製品構成", "価格", "営業費用", "引当金", "セグメント利益率"];
    case "prior_filing_delta":
    case "historical_comparison":
      return ["前回の提出資料", "前回のMD&A", "前期のXBRL数値"];
    default:
      return ["MD&A", "segment results", "revenue discussion", "業種固有KPI"];
  }
}

function joinItems(items: string[]): string {
  return [...new Set(items.filter(Boolean).map(humanizeSourceLabel))].join("、");
}

function humanizeSourceLabel(item: string): string {
  const text = item.trim();
  const aliases: Array<[RegExp, string]> = [
    [/^md&a$/i, "MD&A"],
    [/^segment results?$/i, "セグメント実績"],
    [/^geographic revenue$/i, "地域別売上"],
    [/^product(?:\/category)? revenue$/i, "製品・カテゴリ別売上"],
    [/^services revenue$/i, "サービス売上"],
    [/^product launches?$/i, "新製品投入"],
    [/^channel inventory$/i, "販売チャネル在庫"],
    [/^cost discussion$/i, "コストの説明"],
    [/^operating expenses$/i, "営業費用"],
    [/^segment margin$/i, "セグメント利益率"],
    [/^driver$/i, "要因"],
    [/^margin driver$/i, "利益率要因"]
  ];
  return aliases.find(([pattern]) => pattern.test(text))?.[1] ?? text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
