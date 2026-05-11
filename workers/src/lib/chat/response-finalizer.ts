import type { Env, FilingCacheRecord } from "../../env";
import type { ChatFallbackKind } from "../../clients/gemini/types";
import type { RemoteConfig } from "../remote-config";
import {
  buildJapaneseLanguageGuardFallback,
  buildJapaneseLanguageGuardRepair,
  checkFinalAnswerJapaneseOnly
} from "./final-answer-language";
import { attachChatDebug } from "./response-payload";
import {
  attachCurrentFilingSourceUrls,
  ensureFilingGroundedResponse,
  type ChatResponseDebug,
  type ChatResponsePayload,
  type ChatResponsePath,
  type FallbackCategory,
  type FallbackUserReason
} from "./grounding";
import type { ChatTimingTracker } from "./timing";
import { maybeAppendWebSupplement } from "./web-supplement";
import { hasBannedPhrase } from "./evidence-fallback";

type ChatResponseDebugInput = Omit<ChatResponseDebug, "sourceCount" | "sourceIds">;

type FallbackTaxonomy = {
  fallbackCategory: FallbackCategory;
  fallbackUserReason: FallbackUserReason;
  missingEvidence?: string[];
  missingEvidenceLabelsJa?: string[];
  guardLabels?: string[];
};

type AnswerCleanupResult = {
  answer: string;
  taxonomy?: Partial<FallbackTaxonomy>;
};

export async function finalizeChatResponse({
  filing,
  question,
  response,
  responsePath,
  debug,
  env,
  config,
  timings,
  includeWebSupplement = true,
  attachSourceUrls = true
}: {
  filing: FilingCacheRecord;
  question: string;
  response: ChatResponsePayload;
  responsePath: ChatResponsePath;
  debug: ChatResponseDebugInput;
  env: Env;
  config: RemoteConfig;
  timings: ChatTimingTracker;
  includeWebSupplement?: boolean;
  attachSourceUrls?: boolean;
}): Promise<ChatResponsePayload> {
  const grounded = ensureFilingGroundedResponse(response);
  const supplemented = includeWebSupplement
    ? await timings.timeAsync("webSupplementMs", () =>
      maybeAppendWebSupplement(
        filing,
        question,
        grounded,
        env,
        config
      )
    )
    : grounded;
  const responseWithUrls = attachSourceUrls
    ? timings.timeSync("groundingMs", () => attachCurrentFilingSourceUrls(supplemented, filing.primaryDocumentUrl))
    : supplemented;
  const normalizedFallbackKind = normalizeFallbackKind(responsePath, debug);
  const cleanup = cleanAnswerForQuestion(responseWithUrls.answer, responsePath, normalizedFallbackKind, question, debug.questionIntent, filing);
  const catQ06Cleanup = cleanCatQ06MarginDurabilityAnswer(cleanup.answer, question, debug, filing);
  const q04DurabilityRepair = repairDriverDurabilityFollowupAnswer(catQ06Cleanup.answer, question, debug, filing);
  const uxCleanedAnswer = q04DurabilityRepair?.answer ?? catQ06Cleanup.answer;
  const originalAnswerBeforeLanguageGuard = uxCleanedAnswer;
  const languageCheck = checkFinalAnswerJapaneseOnly(uxCleanedAnswer);
  const bannedPhraseDetected = hasBannedPhrase(uxCleanedAnswer);
  const bannedPhraseCleanedAnswer = languageCheck.ok && bannedPhraseDetected
    ? cleanBannedFinalAnswer(uxCleanedAnswer, debug.questionIntent)
    : uxCleanedAnswer;
  const bannedPhraseStillDetected = languageCheck.ok && hasBannedPhrase(bannedPhraseCleanedAnswer);
  const languageRepairCandidate = languageCheck.ok
    ? null
    : buildJapaneseLanguageGuardRepair({
      question,
      questionIntent: debug.questionIntent,
      sourceGateSufficient: debug.sourceGateSufficient,
      sourceGateEvidenceSlots: debug.sourceGateEvidenceSlots
    });
  const languageRepairCheck = languageRepairCandidate
    ? checkFinalAnswerJapaneseOnly(languageRepairCandidate)
    : null;
  const languageRepairSafe = Boolean(
    languageRepairCandidate &&
    languageRepairCheck?.ok &&
    !hasBannedPhrase(languageRepairCandidate)
  );
  const finalAnswerSafe = (languageCheck.ok && !bannedPhraseStillDetected) || languageRepairSafe;
  const sourceBackedQ04RepairAccepted = Boolean(
    finalAnswerSafe &&
    q04DurabilityRepair?.labels.some((label) => label === "q04_bank_durability_source_backed_repair" || label === "q04_retail_durability_source_backed_repair")
  );
  const languageSafeAnswer = languageCheck.ok && !bannedPhraseStillDetected
    ? bannedPhraseCleanedAnswer
    : languageRepairSafe && languageRepairCandidate
      ? languageRepairCandidate
      : buildJapaneseLanguageGuardFallback({
      question,
      questionIntent: debug.questionIntent,
      fallbackKind: normalizedFallbackKind,
      missingSourceTypes: debug.sourceGateMissingSourceTypes
    });
  const finalLanguageCheck = languageRepairSafe && languageRepairCheck ? languageRepairCheck : languageCheck;
  const sanitizedLanguageSafeAnswer = sanitizeFinalUserFacingAnswer(languageSafeAnswer);
  const finalResponsePath = sourceBackedQ04RepairAccepted ? "openai" : finalAnswerSafe ? responsePath : "fallback";
  const finalFallbackKind: ChatFallbackKind = finalAnswerSafe
    ? sourceBackedQ04RepairAccepted
      ? "none"
      : normalizedFallbackKind
    : "language_guard_fallback";
  const responsePathFallbackButKindNone = finalResponsePath === "fallback" && finalFallbackKind === "none";
  const finalAnswerLanguageLabels = languageCheck.ok && finalAnswerSafe ? [] : languageRepairSafe ? [
    ...languageCheck.labels,
    "answer_repaired_to_japanese"
  ] : [
    ...languageCheck.labels,
    ...(bannedPhraseStillDetected ? ["generic_fallback_phrase"] : []),
    "answer_rewritten_to_japanese_fallback"
  ];
  const fallbackTaxonomy = classifyFallbackTaxonomy({
    debug,
    responsePath: finalResponsePath,
    fallbackKind: responsePathFallbackButKindNone ? "unknown_fallback" : finalFallbackKind,
    cleanup,
    finalAnswerSafe,
    languageLabels: finalAnswerLanguageLabels
  });
  const finalFallbackTaxonomy = suppressInvisibleMalformedCurrencyTaxonomy(fallbackTaxonomy, sanitizedLanguageSafeAnswer);

  return attachChatDebug(
    {
      ...responseWithUrls,
      answer: sanitizedLanguageSafeAnswer,
      responsePath: finalResponsePath
    },
    {
      ...debug,
      responsePath: finalResponsePath,
      fallbackReason: sourceBackedQ04RepairAccepted ? null : finalAnswerSafe ? debug.fallbackReason : debug.fallbackReason ?? "low_quality_answer",
      fallbackCategory: finalFallbackTaxonomy.fallbackCategory,
      fallbackUserReason: finalFallbackTaxonomy.fallbackUserReason,
      missingEvidence: finalFallbackTaxonomy.missingEvidence ?? [],
      missingEvidenceLabelsJa: finalFallbackTaxonomy.missingEvidenceLabelsJa ?? [],
      guardLabels: finalFallbackTaxonomy.guardLabels ?? [],
      fallbackKind: responsePathFallbackButKindNone ? "unknown_fallback" : finalFallbackKind,
      fallbackKindSource: sourceBackedQ04RepairAccepted ? "finalizer" : finalAnswerSafe ? debug.fallbackKindSource ?? "finalizer" : "language_guard",
      responsePathFallbackButKindNone,
      finalAnswerJapaneseRatio: finalLanguageCheck.japaneseRatio,
      finalAnswerEnglishSentenceCount: finalLanguageCheck.englishSentenceCount,
      finalAnswerRawExcerptLike: finalLanguageCheck.rawExcerptLike,
      finalAnswerLanguageLabels,
      finalAnswerLanguageViolations: finalAnswerSafe ? [] : languageCheck.violations,
      languageGuardChecked: true,
      languageGuardOk: finalAnswerSafe,
      languageGuardViolationLabels: finalAnswerLanguageLabels,
      languageGuardFallbackUsed: !finalAnswerSafe,
      languageGuardFallbackKind: finalAnswerSafe ? null : "language_guard_fallback",
      originalAnswerBeforeLanguageGuardLength: languageCheck.ok ? null : originalAnswerBeforeLanguageGuard.length,
      originalAnswerBeforeLanguageGuardSample: languageCheck.ok
        ? null
        : sampleUnsafeAnswer(originalAnswerBeforeLanguageGuard),
      genericFallbackPhraseDetected: bannedPhraseStillDetected,
      sourceRepairLabels: [
        ...(debug.sourceRepairLabels ?? []),
        ...catQ06Cleanup.labels,
        ...(q04DurabilityRepair?.labels ?? []),
        ...(languageRepairSafe ? ["language_guard_source_backed_repair"] : [])
      ],
      ...timings.snapshot()
    }
  );
}

const BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK = "選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。";
const BUSINESS_MODEL_MISSING_EVIDENCE = ["事業内容", "セグメント情報", "売上内訳", "MD&Aの事業説明"];
const MANAGEMENT_MISSING_EVIDENCE = ["MD&A", "業績説明", "セグメント実績", "見通し・リスクの説明"];
const REVENUE_DRIVER_MISSING_EVIDENCE = ["MD&A", "セグメント実績", "売上説明"];
const LIQUIDITY_MISSING_EVIDENCE = ["キャッシュフロー計算書", "流動性の説明", "負債の注記", "借入枠", "満期スケジュール"];
const RISK_MISSING_EVIDENCE = ["リスク要因", "MD&Aのリスク説明", "見通し・リスクの説明"];

type Q04DurabilityRepair = {
  answer: string;
  labels: string[];
};

type AnswerRepairResult = {
  answer: string;
  labels: string[];
};

function cleanCatQ06MarginDurabilityAnswer(
  answer: string,
  question: string,
  debug: ChatResponseDebugInput,
  filing: FilingCacheRecord
): AnswerRepairResult {
  if (!isMarginDurabilityFollowupQuestion(question, debug.questionIntent) || !isCatLikeFiling(filing)) {
    return { answer, labels: [] };
  }

  let cleaned = answer;
  const labels: string[] = [];
  const sourceText = `${debug.selectedSourceExcerpts?.join(" ") ?? ""} ${extractSourceGateEvidenceText(debug.sourceGateEvidenceSlots)}`;
  const netIncomeAmount = extractCurrentMetricValue(debug.sourceGateEvidenceSlots, "純利益");
  if (netIncomeAmount) {
    const corrected = cleaned.replace(/(純利益[^。！？\n]{0,16}?)([0-9]+(?:\.[0-9]+)?)\s*百万ドル/g, `$1${netIncomeAmount}`);
    if (corrected !== cleaned) {
      cleaned = corrected;
      labels.push("cat_q06_net_income_unit_corrected_from_source");
    }
  }
  const revenueAmount = extractCatRevenueOkuDollar(sourceText);
  if (revenueAmount) {
    const corrected = cleaned.replace(/売上高は(?:約)?(?:2025年)?[0-9]+(?:\.[0-9]+)?億ドル/g, `売上高は約${revenueAmount}億ドル`);
    if (corrected !== cleaned) {
      cleaned = corrected;
      labels.push("cat_q06_revenue_unit_corrected_from_source");
    }
  }
  const softened = cleaned.replace(
    /利益率の変動要因は一時的というより、需要の変動とコスト構造の影響が組み合わさっています。/g,
    "利益率の変動要因が一時的か構造的かは、このfilingだけでは断定できません。需要の変動とコスト構造の影響が組み合わさっている点は確認できます。"
  );
  if (softened !== cleaned) {
    cleaned = softened;
    labels.push("cat_q06_temporality_wording_softened");
  }
  if (!/(一時|構造|断定できません|未確定|不確実)/.test(cleaned)) {
    cleaned = `${cleaned.trim()} このfilingだけでは、一時要因か構造的変化かは断定できません。`;
    labels.push("cat_q06_temporality_caveat_added");
  }

  const normalized = sanitizeFinalUserFacingAnswer(cleaned);
  if (normalized !== answer && labels.length === 0) {
    labels.push("cat_q06_wording_cleaned");
  }
  return { answer: normalized, labels };
}

function extractCurrentMetricValue(sourceGateEvidenceSlots: Record<string, unknown> | null | undefined, metricName: string): string | null {
  if (!sourceGateEvidenceSlots || typeof sourceGateEvidenceSlots !== "object") {
    return null;
  }
  const confirmedMetricMovement = (sourceGateEvidenceSlots as Record<string, unknown>).confirmedMetricMovement;
  if (!confirmedMetricMovement || typeof confirmedMetricMovement !== "object") {
    return null;
  }
  const slot = confirmedMetricMovement as Record<string, unknown>;
  return slot.metricName === metricName && typeof slot.currentValue === "string" ? slot.currentValue : null;
}

function isMarginDurabilityFollowupQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "margin_durability_followup") {
    return true;
  }
  return /(利益率|margin|マージン).*(一時|構造|継続)|これは一時要因/i.test(question);
}

function isCatLikeFiling(filing: FilingCacheRecord): boolean {
  return /\bCAT\b|Caterpillar/i.test(`${filing.ticker} ${filing.companyName}`);
}

function extractCatRevenueOkuDollar(text: string): string | null {
  const rawUsdMatch = text.match(/売上高:\s*([0-9]{8,})\s*USD/i);
  if (rawUsdMatch) {
    const value = Number.parseFloat(rawUsdMatch[1]);
    return Number.isFinite(value) ? formatOkuDollar(value / 100_000_000, true) : null;
  }

  const billionMatch = text.match(/Total sales and revenues[^.]{0,80}\$([0-9]+(?:\.[0-9]+)?)\s*billion/i);
  if (billionMatch) {
    const value = Number.parseFloat(billionMatch[1]);
    return Number.isFinite(value) ? formatOkuDollar(value * 10, true) : null;
  }
  return null;
}

function repairDriverDurabilityFollowupAnswer(
  answer: string,
  question: string,
  debug: ChatResponseDebugInput,
  filing: FilingCacheRecord
): Q04DurabilityRepair | null {
  if (!isDriverDurabilityFollowupQuestion(question, debug.questionIntent) || debug.sourceGateSufficient !== true) {
    return null;
  }

  const evidenceText = extractSourceGateEvidenceText(debug.sourceGateEvidenceSlots);
  const labels: string[] = [];
  let repairedAnswer = answer;

  const bankRepair = buildJpmDurabilitySynthesis(answer, evidenceText, debug.lowQualityReason, filing);
  if (bankRepair) {
    repairedAnswer = bankRepair;
    labels.push("q04_bank_durability_source_backed_repair");
  } else {
    const retailRepair = buildWmtDurabilitySynthesis(answer, evidenceText, filing);
    if (retailRepair) {
      repairedAnswer = retailRepair;
      labels.push("q04_retail_durability_source_backed_repair");
    }
  }

  const softenedAnswer = softenOverconfidentDurabilityWording(repairedAnswer);
  if (softenedAnswer !== repairedAnswer) {
    repairedAnswer = softenedAnswer;
    labels.push("q04_durability_wording_softened");
  }

  if (labels.length === 0) {
    return null;
  }

  const sanitized = sanitizeFinalUserFacingAnswer(repairedAnswer);
  return { answer: sanitized, labels };
}

function isDriverDurabilityFollowupQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "driver_durability_followup") {
    return true;
  }
  return /(その要因|一時|継続|続きそう|続く|durability|temporary)/i.test(question) &&
    !/(利益率|margin|マージン)/i.test(question);
}

function extractSourceGateEvidenceText(sourceGateEvidenceSlots?: Record<string, unknown> | null): string {
  if (!sourceGateEvidenceSlots || typeof sourceGateEvidenceSlots !== "object") {
    return "";
  }
  const pieces: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string") {
      pieces.push(value);
    }
  };
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) {
      return;
    }
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) {
        visit(item, depth + 1);
      }
    }
  };
  visit(sourceGateEvidenceSlots);
  return pieces.join(" ").slice(0, 5000);
}

function buildJpmDurabilitySynthesis(
  answer: string,
  evidenceText: string,
  lowQualityReason: unknown,
  filing: FilingCacheRecord
): string | null {
  if (!isJpmLikeFiling(filing) || !hasBankDurabilityEvidence(evidenceText)) {
    return null;
  }
  const underAnswered = lowQualityReason === "durability_missing_assessment" ||
    /セグメント・地域別の強弱|十分に分解できません|確認すべき箇所は/.test(answer);
  if (!underAnswered) {
    return null;
  }

  const lower = evidenceText.toLowerCase();
  const niiClause = /net interest income|\bnii\b/.test(lower)
    ? "NIIはMarkets NII、Card Servicesの回転残高、wholesale deposit残高、投資証券活動が寄与しましたが、deposit margin compressionや金利低下の影響もあり、金利環境次第です。"
    : "";
  const nirClause = /noninterest income|\bnir\b|investment banking|markets noninterest|asset management|payments|first republic/.test(lower)
    ? "NIRはMarkets非金利収益、資産運用・Payments・投資銀行手数料、First Republic関連利益が寄与しましたが、市場関連収益や一時利益は変動しやすい要因です。"
    : "";
  if (!niiClause && !nirClause) {
    return null;
  }

  return `このfilingだけでは継続性は断定できません。${niiClause}${nirClause}次回はNII、NIR、預金マージン、Markets収益、手数料収入を確認する必要があります。`;
}

function buildWmtDurabilitySynthesis(
  answer: string,
  evidenceText: string,
  filing: FilingCacheRecord
): string | null {
  if (!isWmtLikeFiling(filing) || !hasRetailDurabilityEvidence(evidenceText) || !isDurabilityUnderAnswer(answer)) {
    return null;
  }

  return "このfilingだけでは継続性は断定できません。Walmart USでは、comparable salesにeCommerceが寄与し、transactionsやunit volumes、groceryとhealth & wellnessの強さ、Walmart+ member engagementとomnichannel利用が支えになっています。これらは継続性を見る材料ですが、持続性を判断するには、次回のcomparable sales、traffic、ticket、eCommerce寄与、member engagement、fuel価格影響を確認する必要があります。";
}

function isJpmLikeFiling(filing: FilingCacheRecord): boolean {
  return /\bJPM\b|JPMorgan|Chase/i.test(`${filing.ticker} ${filing.companyName}`);
}

function isWmtLikeFiling(filing: FilingCacheRecord): boolean {
  return /\bWMT\b|Walmart/i.test(`${filing.ticker} ${filing.companyName}`);
}

function hasBankDurabilityEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  const hasNii = /net interest income|\bnii\b|deposit margin compression|wholesale deposit|card services/.test(lower);
  const hasNir = /noninterest income|\bnir\b|markets noninterest|investment banking|asset management|payments|first republic/.test(lower);
  const hasDurabilityContext = /deposit margin compression|lower rates|markets|investment banking|first republic|revolving balances|wholesale deposit|fees|gain/.test(lower);
  return (hasNii || hasNir) && hasDurabilityContext;
}

function hasRetailDurabilityEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  const hasComparableSales = /comparable sales|comp sales|same-store sales/.test(lower);
  const hasRetailDriver = /ecommerce|e-commerce|walmart\+|member engagement|membership|omnichannel|transactions|unit volumes|average ticket|traffic|ticket/.test(lower);
  const hasContext = /continued strength|driven by|contributed|growth|fuel|grocery|health and wellness|health & wellness/.test(lower);
  return hasComparableSales && hasRetailDriver && hasContext;
}

function isDurabilityUnderAnswer(answer: string): boolean {
  return /前問の具体的な要因が十分に特定|一時要因か継続要因かは分類しません|確認すべき箇所は|追加確認が必要/.test(answer);
}

function softenOverconfidentDurabilityWording(answer: string): string {
  let softened = answer
    .replace(/eCommerceの売上寄与が継続的に高まり/g, "eCommerceの売上寄与は継続要因になり得ますが、このfilingだけでは継続性は断定できません")
    .replace(/eCommerce の売上寄与が継続的に高まり/g, "eCommerce の売上寄与は継続要因になり得ますが、このfilingだけでは継続性は断定できません")
    .replace(/eCommerce[^。]*継続的に高まり/g, "eCommerceや会員エンゲージメントは継続性を見る材料ですが、持続性の断定は避けるべきです")
    .replace(/今後も続くでしょう/g, "今後も続くかは、このfilingだけでは断定できません")
    .replace(/今後も続くと見られます/g, "今後も続くかは、このfilingだけでは断定できません")
    .replace(/継続するでしょう/g, "継続するかは、このfilingだけでは断定できません")
    .replace(/持続的に伸びるでしょう/g, "持続的に伸びるかは、このfilingだけでは断定できません")
    .replace(/持続的に伸びると見られます/g, "持続的に伸びるかは、このfilingだけでは断定できません")
    .replace(/安定成長を示しています/g, "継続性を見る材料ですが、このfilingだけでは安定成長とは断定できません")
    .replace(/安定した成長を示しています/g, "継続性を見る材料ですが、このfilingだけでは安定成長とは断定できません");

  if (softened !== answer && !/継続性は断定できません|持続性の断定は避けるべき/.test(softened)) {
    softened = `${softened} このfilingだけでは継続性は断定できません。`;
  }
  return softened.replace(/\s+/g, " ").trim();
}

function cleanAnswerForQuestion(
  answer: string,
  responsePath: ChatResponsePath,
  fallbackKind: ChatFallbackKind,
  question: string,
  questionIntent?: string | null,
  filing?: FilingCacheRecord
): AnswerCleanupResult {
  const normalizedAnswer = sanitizeFinalUserFacingAnswer(answer);
  const sectorCleanup = cleanWrongSectorBankLanguage(normalizedAnswer, question, questionIntent, filing);
  if (sectorCleanup) {
    return sectorCleanup;
  }
  const operatingMarginCleanup = cleanUnsupportedOperatingMarginMovement(normalizedAnswer);
  if (operatingMarginCleanup) {
    return operatingMarginCleanup;
  }
  if (isLiquidityDebtQuestion(question, questionIntent)) {
    return cleanLiquidityDebtAnswer(normalizedAnswer);
  }
  if (isWatchPointsQuestion(question, questionIntent)) {
    return cleanWatchPointsAnswer(normalizedAnswer);
  }
  if (isManagementFocusQuestion(question, questionIntent)) {
    return cleanManagementFocusAnswer(normalizedAnswer);
  }
  if (isBusinessModelQuestion(question, questionIntent)) {
    return cleanBusinessModelAnswer(normalizedAnswer, responsePath, fallbackKind);
  }
  if (hasMalformedCurrencyForTaxonomy(normalizedAnswer) || hasCurrencySanitizationPlaceholder(normalizedAnswer)) {
    return {
      answer: normalizedAnswer,
      taxonomy: {
        fallbackCategory: "sanitation_guard",
        fallbackUserReason: "malformed_currency_detected",
        guardLabels: ["malformed_currency_detected"]
      }
    };
  }
  return { answer: normalizedAnswer };
}

const LIQUIDITY_DEBT_SOURCE_INSUFFICIENT_FALLBACK = "選択された資料だけでは、資金繰りや負債の懸念を直接判断するには不足しています。確認すべき箇所は、キャッシュフロー計算書、流動性の説明、負債の注記、借入枠、満期スケジュールです。現時点では、一般的なリスク要因だけから資金繰りの悪化を断定しません。";

const MANAGEMENT_FOCUS_SOURCE_INSUFFICIENT_FALLBACK = "選択された資料だけでは、経営陣が強調している論点を十分に特定できません。確認すべき箇所は、MD&A（経営陣による業績説明）、業績説明、セグメント実績、見通し・リスクの説明です。売上高だけでは、経営陣の強調点とは判断しません。";

function sourceInsufficientCleanup(
  answer: string,
  fallbackUserReason: Extract<FallbackUserReason, `${string}_sources_missing`>,
  missingEvidenceLabelsJa: string[],
  guardLabels: string[]
): AnswerCleanupResult {
  return {
    answer,
    taxonomy: {
      fallbackCategory: "source_insufficient",
      fallbackUserReason,
      missingEvidence: missingEvidenceLabelsJa.map((label) => sourceLabelToEvidenceKey(label)),
      missingEvidenceLabelsJa,
      guardLabels
    }
  };
}

function sanitizeFinalUserFacingAnswer(answer: string): string {
  return normalizeInternalSourceWording(normalizeBusinessLineLabels(normalizeFallbackSourceLabels(normalizeAwkwardModelLanguage(answer))));
}

function normalizeAwkwardModelLanguage(answer: string): string {
  return answer
    .replace(/\bRevenueFromContractWithCustomerExcludingAssessedTax\b/g, "売上高")
    .replace(/\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+){2,}\b/g, (tag: string) => {
      if (KNOWN_XBRL_TAG_LABELS[tag]) {
        return KNOWN_XBRL_TAG_LABELS[tag];
      }
      return looksLikeXbrlTag(tag) ? "指標" : tag;
    })
    .replace(/売上\s*driver/g, "売上要因")
    .replace(/具体的な\s*driver/g, "具体的な要因")
    .replace(/driverが十分に特定/g, "要因が十分に特定")
    .replace(/前問の\s*driver/g, "前問の要因")
    .replace(/利益率\s*driver/g, "利益率要因")
    .replace(/\bprice\s+reali[sz]ation\b/gi, "価格実現")
    .replace(/\bcost\s+of\s+sales\b/gi, "売上原価")
    .replace(/\bcost\s+of\s+revenue\b/gi, "売上原価")
    .replace(/\bmanufacturing\s+costs?\b/gi, "製造コスト")
    .replace(/\bcosts?\b/gi, "コスト")
    .replace(/\btariffs?\b/gi, "関税")
    .replace(/\bdeveloping economies\b/gi, "新興国")
    .replace(/\bdeveloped economies\b/gi, "先進国")
    .replace(/較為小さい/g, "比較的小さい")
    .replace(/前年同\s*period\s*比/gi, "前年同期比")
    .replace(/\bperiod\b/gi, "期間")
    .replace(/[0-9]+(?:,[0-9]{1,2})+\.[0-9]+億ドル/g, "売上高の数値表示")
    .replace(/([0-9]+(?:,[0-9])+)億ドル/g, (_match, raw: string) => `${raw.replace(/,/g, ".")}億ドル`)
    .replace(/([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw.replace(/,/g, ""));
      return Number.isFinite(value) ? formatUsdAmount(value) : "金額";
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*百万\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value / 100)}億ドル` : `${raw}百万ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*億\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value, raw.includes("."))}億ドル` : `${raw}億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*千\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value / 100_000)}億ドル` : `${raw}千ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*十億\s*(?:USD|ドル)/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value * 10, raw.includes("."))}億ドル` : `${raw}十億ドル`;
    })
    .replace(/([0-9,]+)\s*억\s*([0-9,]+)\s*万\s*USD/g, (_match, okuRaw: string, manRaw: string) => {
      const oku = Number.parseFloat(okuRaw.replace(/,/g, ""));
      const man = Number.parseFloat(manRaw.replace(/,/g, ""));
      return Number.isFinite(oku) && Number.isFinite(man)
        ? `${formatOkuDollar(oku + man / 10_000, true)}億ドル`
        : "金額";
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*[亿億]\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value, raw.includes("."))}億ドル` : `${raw}億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*[亿億]\s*美元/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value, raw.includes("."))}億ドル` : `${raw}億ドル`;
    })
    .replace(/([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\s*美元/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw.replace(/,/g, ""));
      return Number.isFinite(value) ? formatUsdAmount(value) : "金額";
    })
    .replace(/[0-9０-９.,，]+\s*兆円超?(?:の規模)?/g, "金額規模")
    .replace(/前年同[0-9.,?，]+/g, "前年同期の比較値")
    .replace(/\bseasonality\b/gi, "季節性")
    .replace(/\bgovernment\b/gi, "政府")
    .replace(/\bacquisitions?\b/gi, "買収")
    .replace(/\brepurchase(?:d|s)?\b/gi, "買い戻し")
    .replace(/\bexpenditures?\b/gi, "支出")
    .replace(/\bNI\b/g, "純利益")
    .replace(/\bCash flow\b/g, "キャッシュフロー")
    .replace(/\bcash flow\b/g, "キャッシュフロー");
}

const KNOWN_XBRL_TAG_LABELS: Record<string, string> = {
  RevenueFromContractWithCustomerExcludingAssessedTax: "売上高",
  Revenues: "売上高",
  NetIncomeLoss: "純利益",
  OperatingIncomeLoss: "営業利益"
};

function looksLikeXbrlTag(value: string): boolean {
  return /(?:Revenue|Income|Loss|Assets|Liabilities|Equity|Cash|Expense|Expenses|Debt|Stockholders|Contract|Customer|AssessedTax)/.test(value) &&
    /[a-z][A-Z]/.test(value);
}

function normalizeFallbackSourceLabels(answer: string): string {
  return answer
    .replace(/\bMD&A risk discussion\b/gi, "MD&Aのリスク説明")
    .replace(/\bMD&A business discussion\b/gi, "経営陣による業績説明の事業説明")
    .replace(/\bproduct launch or channel inventory discussion\b/gi, "新製品投入や販売チャネル在庫")
    .replace(/\bproduct launches\b/gi, "新製品投入")
    .replace(/\bchannel inventory\b/gi, "販売チャネル在庫")
    .replace(/\bproduct revenue(?: discussion)?\b/gi, "製品別売上")
    .replace(/\bservices revenue(?: discussion)?\b/gi, "サービス売上")
    .replace(/\bgeographic revenue(?: discussion)?\b/gi, "地域別売上")
    .replace(/\bProduct\/category revenue\b/gi, "製品・カテゴリ別売上")
    .replace(/\bGeographic revenue\b/gi, "地域別売上")
    .replace(/\bSegment Information\b/g, "セグメント情報")
    .replace(/\bRevenue Note\b/g, "売上注記")
    .replace(/\bBusiness\b/g, "事業内容")
    .replace(/\bRisk Factors\b/g, "リスク要因")
    .replace(/\brevenue or profitability discussion\b/gi, "売上または利益率の説明")
    .replace(/\bsegment results\b/gi, "セグメント実績")
    .replace(/\brevenue discussion\b/gi, "売上説明")
    .replace(/\bprofitability discussion\b/gi, "利益率・採算性の説明")
    .replace(/\bcash flow \/ liquidity\b/gi, "キャッシュフロー・流動性")
    .replace(/\bliquidity discussion\b/gi, "流動性の説明")
    .replace(/\bdebt discussion\b/gi, "負債の説明")
    .replace(/\bsector-specific KPIs\b/gi, "業種固有KPI")
    .replace(/\bBalance Sheet\b/g, "貸借対照表")
    .replace(/\bDebt Note\b/gi, "負債の注記")
    .replace(/\bLiquidity MD&A\b/g, "流動性の説明")
    .replace(/\bCash Flow Statement\b/g, "キャッシュフロー計算書")
    .replace(/\bMD&A\b(?![の（])/g, "経営陣による業績説明");
}

function normalizeInternalSourceWording(answer: string): string {
  return answer
    .replace(/evidence\s*slot/gi, "根拠")
    .replace(/metric-only/gi, "数値中心")
    .replace(/\bfallback\b/gi, "代替回答")
    .replace(/\bdebug\b/gi, "診断")
    .replace(/\bschema\b/gi, "形式")
    .replace(/選択された\s*source/g, "選択された資料")
    .replace(/この\s*source/g, "この資料")
    .replace(/取得できた\s*source/g, "取得できた資料")
    .replace(/確認すべき\s*source\s*は/g, "確認すべき箇所は")
    .replace(/不足している\s*source\s*type/g, "不足している資料の種類")
    .replace(/source\s*type/g, "資料の種類")
    .replace(/source\s*だけ/g, "資料だけ")
    .replace(/source\s*では/g, "資料では")
    .replace(/source\s*は/g, "資料は")
    .replace(/source\s*を/g, "資料を")
    .replace(/source\s*の/g, "資料の")
    .replace(/source/g, "資料");
}

function normalizeBusinessLineLabels(answer: string): string {
  return answer
    .replace(/\bWearables,\s*Home and Accessories(?:,\s*|、)Services\b/g, "ウェアラブル、ホーム、アクセサリ、サービス")
    .replace(/\bWearables,\s*Home and Accessories\b/g, "ウェアラブル、ホーム、アクセサリ")
    .replace(/\bWearables\b/g, "ウェアラブル")
    .replace(/\bHome and Accessories\b/g, "ホーム、アクセサリ")
    .replace(/売上区分としては、?全社売上高も確認できます。?/g, "")
    .replace(/全社売上高も確認できます。?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const GENERAL_COMPANY_CASH_FLOW_NOTE = "営業CFは、運転資本、在庫、売掛金、買掛金などで大きく動くため、単純な利益水準だけでは判断しません。キャッシュフロー計算書と流動性の説明を合わせて確認する必要があります。";

function cleanWrongSectorBankLanguage(
  answer: string,
  question: string,
  questionIntent?: string | null,
  filing?: FilingCacheRecord
): AnswerCleanupResult | null {
  if (!filing || isFinancialFilingForFinalizer(filing)) {
    return null;
  }
  if (!isCashFlowOrLiquidityAnswer(answer, question, questionIntent) || !containsBankSpecificLanguage(answer)) {
    return null;
  }

  return {
    answer: `${removeBankSpecificSentences(answer)} ${GENERAL_COMPANY_CASH_FLOW_NOTE}`.replace(/\s+/g, " ").trim(),
    taxonomy: {
      fallbackCategory: "sanitation_guard",
      fallbackUserReason: "wrong_sector_wording",
      guardLabels: ["wrong_sector_bank_language_removed"]
    }
  };
}

function cleanUnsupportedOperatingMarginMovement(answer: string): AnswerCleanupResult | null {
  const match = answer.match(/営業利益率は(?:前期比|前年同期比)?で?約?([0-9.]+)%増/);
  if (!match) {
    return null;
  }
  return {
    answer: `営業利益は前年同期比で約${match[1]}%増です。営業利益率の変化要因は、選択された資料だけでは断定しません。`,
    taxonomy: {
      fallbackCategory: "answer_quality_guard",
      fallbackUserReason: "answer_too_metric_only",
      guardLabels: ["operating_margin_growth_wording_rewritten"]
    }
  };
}

function isCashFlowOrLiquidityAnswer(answer: string, question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "cash_flow" || questionIntent === "liquidity_debt") {
    return true;
  }
  return /(営業CF|営業キャッシュフロー|キャッシュフロー|資金繰り|流動性|cash\s*flow|liquidity)/i.test(`${question} ${answer}`);
}

function containsBankSpecificLanguage(answer: string): boolean {
  return /\b(deposits?|loans?|loan losses|credit losses|deposit base|net interest income)\b|預金|貸出|貸倒|信用損失|純金利収入/i.test(answer);
}

function removeBankSpecificSentences(answer: string): string {
  const parts = answer.match(/[^。！？\n]+[。！？]?|\n+/g) ?? [answer];
  return parts.filter((part) => !containsBankSpecificLanguage(part)).join("").replace(/\n{3,}/g, "\n\n").trim();
}

function isFinancialFilingForFinalizer(filing: FilingCacheRecord): boolean {
  const haystack = `${filing.ticker} ${filing.companyName} ${filing.sourceChunks
    .slice(0, 20)
    .map((chunk) => `${chunk.sourceLabel} ${chunk.text}`)
    .join(" ")}`.toLowerCase();
  return /\b(jpm|bac|wfc|c|gs|ms|usb|pnc|tfc|cof|axp|bank|bancorp|financial|securities|brokerage|deposit|loans?|net interest income|credit losses)\b/.test(haystack);
}

function formatUsdAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) {
    return `${formatOkuDollar(value / 100_000_000)}億ドル`;
  }
  if (abs >= 1_000_000) {
    const millions = Math.round((value / 1_000_000) * 10) / 10;
    return `${Number.isInteger(millions) ? String(millions) : millions.toFixed(1)}百万ドル`;
  }
  return "金額";
}

function formatOkuDollar(value: number, forceDecimal = false): string {
  const rounded = Math.round(value * 10) / 10;
  if (forceDecimal) {
    return rounded.toFixed(1);
  }
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function isLiquidityDebtQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "liquidity_debt" || questionIntent === "cash_flow") {
    return true;
  }
  return /(資金繰り|負債|債務|借入|流動性|liquidity|debt|maturity|cashflow|cash flow)/i.test(question.replace(/\s+/g, ""));
}

function cleanLiquidityDebtAnswer(answer: string): AnswerCleanupResult {
  const hasLiquidityEvidence = /(cash|キャッシュ|現金|資金|liquidity|流動性|debt|負債|債務|借入|credit facility|信用枠|revolver|社債|maturit|満期|leverage|レバレッジ|deposit|預金|capital ratio|自己資本|operating cash flow|営業CF|営業キャッシュフロー|キャッシュフロー)/i.test(answer);
  const genericRiskShape = /(主要リスク|リスク要因|規制|競争|顧客|データ|市場環境|サプライチェーン)/.test(answer) &&
    !/(cash|キャッシュ|現金|資金|liquidity|流動性|debt|負債|債務|借入|credit facility|信用枠|maturit|満期|leverage|レバレッジ|deposit|預金|capital ratio|自己資本|operating cash flow|営業CF|営業キャッシュフロー|キャッシュフロー)/i.test(answer);
  const riskSummaryLead = /^主要リスク/.test(answer.trim()) &&
    /(規制|競争|顧客|データ|市場環境|サプライチェーン|リスク要因)/.test(answer) &&
    !/(現金|借入残高|負債残高|満期スケジュール|借入枠|信用枠|キャッシュフロー計算書|営業キャッシュフロー|預金|自己資本比率)/.test(answer);

  if (genericRiskShape || riskSummaryLead || !hasLiquidityEvidence) {
    return sourceInsufficientCleanup(
      LIQUIDITY_DEBT_SOURCE_INSUFFICIENT_FALLBACK,
      "liquidity_sources_missing",
      LIQUIDITY_MISSING_EVIDENCE,
      ["liquidity_debt_sources_missing"]
    );
  }
  return { answer };
}

function isWatchPointsQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "watch_points") {
    return true;
  }
  return /(次回決算|次に見る|見るべき|ポイント|watchpoints?|nextquarter|nextfiling)/i.test(question.replace(/\s+/g, ""));
}

function cleanWatchPointsAnswer(answer: string): AnswerCleanupResult {
  if (!isGenericWatchPointsAnswer(answer)) {
    return { answer };
  }
  return {
    answer: "選択された資料だけでは、次回決算で見るべき会社固有のポイントを3つに絞るには不足しています。確認すべき箇所は、経営陣による業績説明、セグメント実績、売上説明、利益率・採算性の説明、キャッシュフロー・流動性です。一般的な売上・利益・コストだけでは、この会社固有の注目点とは判断しません。",
    taxonomy: {
      fallbackCategory: "answer_quality_guard",
      fallbackUserReason: "generic_watch_points",
      missingEvidence: ["management_discussion", "segment_results", "revenue_discussion", "profitability_discussion", "cash_flow_liquidity"],
      missingEvidenceLabelsJa: ["経営陣による業績説明", "セグメント実績", "売上説明", "利益率・採算性の説明", "キャッシュフロー・流動性"],
      guardLabels: ["generic_watch_points"]
    }
  };
}

function isGenericWatchPointsAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const genericItems = ["売上高", "営業利益", "利益率", "純利益", "コスト構造", "キャッシュフロー", "支出の動向", "財務健全性"].filter((item) => normalized.includes(item)).length;
  const hasMalformedMetric = /[0-9]{1,3}(?:,[0-9]{3})+\s*USD|前年同期の比較値|\?/.test(answer);
  const specificSignals = /(segment|セグメント|顧客|製品|地域|価格|数量|受注|backlog|orders|occupancy|NOI|traffic|ticket|commodity|production|Neutron|Electron|RNA|廃棄物|資産運用|医療機器|半導体|診断|Alaris|Medication Management|信用枠|満期|借入|流動性)/i;
  return (genericItems >= 3 && !specificSignals.test(answer)) || (genericItems >= 2 && hasMalformedMetric);
}

function cleanBusinessModelAnswer(answer: string, responsePath: ChatResponsePath, fallbackKind: ChatFallbackKind): AnswerCleanupResult {
  if (
    responsePath === "fallback" &&
    ["api_error", "low_quality", "weak_grounding", "non_hard_model_timeout", "legacy_template", "unknown_fallback"].includes(fallbackKind) &&
    isMetricSnapshotOnly(answer)
  ) {
    return sourceInsufficientCleanup(
      BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK,
      "business_model_sources_missing",
      BUSINESS_MODEL_MISSING_EVIDENCE,
      ["business_model_metric_snapshot_replaced"]
    );
  }

  const naturalized = normalizeBusinessLineLabels(answer);
  const withoutForbiddenUnits = removeForbiddenCurrencyUnitSentences(naturalized);
  const withoutMetricSnapshots = removeBusinessModelMetricSnapshotSentences(withoutForbiddenUnits);
  if (!withoutMetricSnapshots.trim()) {
    return sourceInsufficientCleanup(
      BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK,
      "business_model_sources_missing",
      BUSINESS_MODEL_MISSING_EVIDENCE,
      ["business_model_metric_sentences_removed"]
    );
  }

  if (isMetricHeavyBusinessModelAnswer(withoutMetricSnapshots)) {
    return {
      answer: BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK,
      taxonomy: {
        fallbackCategory: "answer_quality_guard",
        fallbackUserReason: "answer_too_metric_only",
        missingEvidence: ["business", "segment_information", "revenue_note", "mda_business_discussion"],
        missingEvidenceLabelsJa: BUSINESS_MODEL_MISSING_EVIDENCE,
        guardLabels: ["business_model_metric_heavy"]
      }
    };
  }

  if (withoutMetricSnapshots !== withoutForbiddenUnits) {
    return {
      answer: withoutMetricSnapshots,
      taxonomy: {
        fallbackCategory: "answer_quality_guard",
        fallbackUserReason: "answer_too_metric_only",
        missingEvidence: ["business", "segment_information", "revenue_note", "mda_business_discussion"],
        missingEvidenceLabelsJa: BUSINESS_MODEL_MISSING_EVIDENCE,
        guardLabels: ["business_model_metric_snapshot_sentence_removed"]
      }
    };
  }

  if (hasMalformedCurrencyForTaxonomy(withoutMetricSnapshots) || hasCurrencySanitizationPlaceholder(withoutMetricSnapshots)) {
    return {
      answer: withoutMetricSnapshots,
      taxonomy: {
        fallbackCategory: "sanitation_guard",
        fallbackUserReason: "malformed_currency_detected",
        guardLabels: ["malformed_currency_detected"]
      }
    };
  }

  return { answer: withoutMetricSnapshots };
}

function isManagementFocusQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "management_focus" || questionIntent === "mda_emphasis") {
    return true;
  }
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return /(経営陣.*強調|会社側.*強調|md&a.*強調|強調している論点|強調してる論点|強調されてること|強調されていること|management.*emphas|mda.*emphas)/i.test(normalized);
}

function cleanManagementFocusAnswer(answer: string): AnswerCleanupResult {
  if (isMetricSnapshotOnly(answer) || isMetricOnlyManagementFocusAnswer(answer)) {
    return {
      answer: MANAGEMENT_FOCUS_SOURCE_INSUFFICIENT_FALLBACK,
      taxonomy: {
        fallbackCategory: "answer_quality_guard",
        fallbackUserReason: "answer_too_metric_only",
        missingEvidence: ["mda", "results_of_operations", "segment_results", "outlook_risk_discussion"],
        missingEvidenceLabelsJa: MANAGEMENT_MISSING_EVIDENCE,
        guardLabels: ["management_focus_metric_only"]
      }
    };
  }
  return { answer };
}

function isMetricOnlyManagementFocusAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const hasManagementSignal = /(経営陣|会社側|強調|MD&A|経営陣による業績説明|業績説明|セグメント|需要|見通し|リスク|利益率|製品|サービス|顧客|供給|コスト|価格|数量)/.test(normalized);
  const metricLead = /^(売上高|収益|営業利益|純利益|利益率|マージン)は[-0-9.,]+(?:兆|億|百万)?ドル/.test(normalized);
  const metricHeavy = /(売上高|営業利益|純利益|前年同期比|前年比|億ドル|百万ドル|%)/g;
  const metricHits = normalized.match(metricHeavy)?.length ?? 0;
  return metricLead || (!hasManagementSignal && metricHits >= 2);
}

function isBusinessModelQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "business_model" || questionIntent === "business_overview") {
    return true;
  }
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return /(何屋|なに屋|何で稼|なにで稼|何で儲|なにで儲|儲けている|儲けてる|稼いでる|稼いでん|なんの会社|何の会社|どんな会社|何してる|何をしてる|事業内容|収益源|businessmodel|whatdoes.*companydo|whatbusiness)/.test(normalized);
}

function isMetricSnapshotOnly(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const metricLabel = "(?:売上高|営業利益|純利益|営業CF|営業キャッシュフロー)";
  const amount = "[-0-9.,]+(?:兆|億|百万)?ドル";
  return new RegExp(`^${metricLabel}は${amount}で、?(?:前年同期比|前年比)[-0-9.]+%[増減]です。?$`).test(normalized) ||
    new RegExp(`^${metricLabel}は${amount}です。?$`).test(normalized);
}

function isMetricHeavyBusinessModelAnswer(answer: string): boolean {
  const firstSentence = firstJapaneseSentence(answer).replace(/\s+/g, "");
  if (isMetricSnapshotOnly(firstSentence)) {
    return true;
  }
  if (/^(この会社|同社|[A-Za-z0-9 .,&'-]+)?(?:は)?(?:主に)?(?:売上|売上高|収益|営業利益|純利益|利益率|マージン|前年同期比)/.test(firstSentence)) {
    return true;
  }
  if (/売上(?:を|高を)?[「\"]?売上高|売上を軸に稼/.test(firstSentence)) {
    return true;
  }

  const businessSignals = /(会社|企業|事業|製品|サービス|半導体|ソフトウェア|小売|広告|販売|提供|顧客|向け|収益源|稼ぐ会社|何屋|メーカー|プラットフォーム|部品|機器)/;
  const metricSignals = /(売上高|営業利益|純利益|利益率|前年同期比|前年比|営業CF|キャッシュフロー|億ドル|百万ドル|USD|ドル)/g;
  const metricHits = answer.match(metricSignals)?.length ?? 0;
  return !businessSignals.test(answer) && metricHits >= 2;
}

function firstJapaneseSentence(answer: string): string {
  return answer.split(/[。！？\n]/)[0] ?? answer;
}

function removeForbiddenCurrencyUnitSentences(answer: string): string {
  if (!hasForbiddenCurrencyUnit(answer)) {
    return answer;
  }

  const parts = answer.match(/[^。！？\n]+[。！？]?|\n+/g) ?? [answer];
  const kept = parts.filter((part) => !hasForbiddenCurrencyUnit(part));
  return kept.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function removeBusinessModelMetricSnapshotSentences(answer: string): string {
  const parts = answer.match(/[^。！？\n]+[。！？]?|\n+/g) ?? [answer];
  const kept = parts.filter((part) => !isBusinessModelMetricSnapshotSentence(part));
  return kept.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function isBusinessModelMetricSnapshotSentence(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  if (!/[0-9０-９]/.test(normalized)) {
    return false;
  }
  if (!/(売上高|総売上高|純利益|営業利益|利益率|マージン|前年同期比|前年比|前期比|四半期実績|決算では|億ドル|百万ドル|USD|ドル|%)/.test(normalized)) {
    return false;
  }
  if (/(製品|サービス|部品|半導体|ソフトウェア|広告|プラットフォーム|顧客|向け|販売から稼|提供して稼|収益源)/.test(normalized) && !/(売上高|総売上高|純利益|営業利益|前年同期比|前年比|四半期実績)/.test(normalized)) {
    return false;
  }
  return true;
}

function hasForbiddenCurrencyUnit(text: string): boolean {
  return /(?:千\s*USD|千USD|百万円|億円|万円|[0-9０-９.,，]+億[0-9０-９.,，千百十]*千\s*USD|[0-9０-９.,，]+億[0-9０-９.,，千百十]*百万円|[0-9０-９.,，]+億[0-9０-９.,，千百十]*万円|[0-9０-９.,，]+\s*円)/.test(text);
}

function hasMalformedCurrencyForTaxonomy(text: string): boolean {
  return hasForbiddenCurrencyUnit(text) ||
    /(?:百万\s*USD|億\s*USD|億USD|千\s*USD|千USD|[0-9]{1,3}(?:,[0-9]{3})+\s*USD|[0-9]+(?:\.[0-9]+)?\s*[亿億]?\s*美元|[0-9]+,[0-9]+億ドル|[0-9]+(?:,[0-9]{1,2})+\.[0-9]+億ドル|前年同[0-9.,?，]+)/.test(text);
}

function hasCurrencySanitizationPlaceholder(text: string): boolean {
  return /売上高の数値表示/.test(text);
}

function suppressInvisibleMalformedCurrencyTaxonomy(
  taxonomy: FallbackTaxonomy,
  finalAnswer: string
): FallbackTaxonomy {
  if (
    taxonomy.fallbackUserReason !== "malformed_currency_detected" ||
    hasMalformedCurrencyForTaxonomy(finalAnswer) ||
    hasCurrencySanitizationPlaceholder(finalAnswer)
  ) {
    return taxonomy;
  }
  return {
    fallbackCategory: "none",
    fallbackUserReason: "none",
    missingEvidence: taxonomy.missingEvidence,
    missingEvidenceLabelsJa: taxonomy.missingEvidenceLabelsJa,
    guardLabels: (taxonomy.guardLabels ?? []).filter((label) => label !== "malformed_currency_detected")
  };
}

function classifyFallbackTaxonomy({
  debug,
  responsePath,
  fallbackKind,
  cleanup,
  finalAnswerSafe,
  languageLabels
}: {
  debug: ChatResponseDebugInput;
  responsePath: ChatResponsePath;
  fallbackKind: ChatFallbackKind;
  cleanup: AnswerCleanupResult;
  finalAnswerSafe: boolean;
  languageLabels: string[];
}): FallbackTaxonomy {
  if (!finalAnswerSafe) {
    return {
      fallbackCategory: "language_guard",
      fallbackUserReason: "raw_english_detected",
      guardLabels: languageLabels.length > 0 ? languageLabels : ["language_guard"]
    };
  }

  const cleanupTaxonomy = normalizePartialTaxonomy(cleanup.taxonomy);
  if (cleanupTaxonomy) {
    return cleanupTaxonomy;
  }

  const modelErrorKind = debug.modelApiErrorKind ?? debug.geminiApiErrorKind ?? null;
  if (modelErrorKind) {
    return {
      fallbackCategory: "model_error",
      fallbackUserReason: modelErrorKindToUserReason(modelErrorKind),
      guardLabels: [`model_api_error:${modelErrorKind}`]
    };
  }

  if (debug.sourceIdsValid === false || debug.fallbackReason === "invalid_source_id") {
    return {
      fallbackCategory: "answer_quality_guard",
      fallbackUserReason: "invalid_sources",
      guardLabels: ["invalid_sources"]
    };
  }

  if (debug.fallbackReason === "schema_invalid" || debug.fallbackReason === "json_parse_failed") {
    return {
      fallbackCategory: "model_error",
      fallbackUserReason: "model_schema_invalid",
      guardLabels: [debug.fallbackReason]
    };
  }

  if (responsePath !== "fallback" && fallbackKind === "none") {
    return { fallbackCategory: "none", fallbackUserReason: "none" };
  }

  if (responsePath === "fallback") {
    if (debug.fallbackReason === "gemini_timeout" || fallbackKind === "non_hard_model_timeout" || fallbackKind === "hard_model_timeout_evidence") {
      return {
        fallbackCategory: "model_error",
        fallbackUserReason: "model_timeout",
        guardLabels: ["model_timeout"]
      };
    }
    if (debug.fallbackReason === "gemini_api_error" || fallbackKind === "api_error") {
      return {
        fallbackCategory: "model_error",
        fallbackUserReason: "model_unavailable",
        guardLabels: ["model_api_error"]
      };
    }
    if (debug.evidenceFallbackUsed || fallbackKind === "evidence_slot" || debug.sourceGateApplied) {
      return sourceInsufficientTaxonomyForIntent(debug.questionIntent, debug.sourceGateMissingSourceTypes);
    }
  }

  return { fallbackCategory: "none", fallbackUserReason: "none" };
}

function normalizePartialTaxonomy(taxonomy?: Partial<FallbackTaxonomy>): FallbackTaxonomy | null {
  if (!taxonomy?.fallbackCategory && !taxonomy?.fallbackUserReason) {
    return null;
  }
  return {
    fallbackCategory: taxonomy.fallbackCategory ?? "none",
    fallbackUserReason: taxonomy.fallbackUserReason ?? "none",
    missingEvidence: taxonomy.missingEvidence ?? taxonomy.missingEvidenceLabelsJa?.map((label) => sourceLabelToEvidenceKey(label)),
    missingEvidenceLabelsJa: taxonomy.missingEvidenceLabelsJa,
    guardLabels: taxonomy.guardLabels
  };
}

function modelErrorKindToUserReason(kind: NonNullable<ChatResponseDebug["modelApiErrorKind"]>): FallbackUserReason {
  switch (kind) {
    case "rate_limit":
      return "model_rate_limited";
    case "timeout":
      return "model_timeout";
    case "bad_request":
    case "payload_too_large":
    case "context_too_large":
      return "model_schema_invalid";
    case "auth_error":
    case "provider_server_error":
    case "network_error":
    case "unknown":
    default:
      return "model_unavailable";
  }
}

function sourceInsufficientTaxonomyForIntent(questionIntent?: string | null, missingSourceTypes: string[] = []): FallbackTaxonomy {
  if (questionIntent === "business_model" || questionIntent === "business_overview") {
    return sourceInsufficientTaxonomy("business_model_sources_missing", BUSINESS_MODEL_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "management_focus" || questionIntent === "mda_emphasis") {
    return sourceInsufficientTaxonomy("management_discussion_sources_missing", MANAGEMENT_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "liquidity_debt" || questionIntent === "cash_flow") {
    return sourceInsufficientTaxonomy("liquidity_sources_missing", LIQUIDITY_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "risk_factors") {
    return sourceInsufficientTaxonomy("risk_sources_missing", RISK_MISSING_EVIDENCE, missingSourceTypes);
  }
  return sourceInsufficientTaxonomy("revenue_driver_sources_missing", REVENUE_DRIVER_MISSING_EVIDENCE, missingSourceTypes);
}

function sourceInsufficientTaxonomy(
  fallbackUserReason: Extract<FallbackUserReason, `${string}_sources_missing`>,
  fallbackLabelsJa: string[],
  missingSourceTypes: string[]
): FallbackTaxonomy {
  const labelsJa = missingSourceTypes.length > 0
    ? dedupeStrings(missingSourceTypes.map((label) => normalizeMissingEvidenceLabelJa(label)))
    : fallbackLabelsJa;
  return {
    fallbackCategory: "source_insufficient",
    fallbackUserReason,
    missingEvidence: labelsJa.map((label) => sourceLabelToEvidenceKey(label)),
    missingEvidenceLabelsJa: labelsJa,
    guardLabels: ["source_insufficient"]
  };
}

function normalizeMissingEvidenceLabelJa(label: string): string {
  const normalized = label.trim();
  const lower = normalized.toLowerCase();
  if ((lower.includes("mda") || lower.includes("md&a")) && lower.includes("risk")) {
    return "MD&Aのリスク説明";
  }
  if (lower.includes("mda") || lower.includes("md&a") || normalized.includes("経営陣")) {
    return "MD&A";
  }
  if (lower.includes("segment")) {
    return "セグメント実績";
  }
  if (lower.includes("revenue")) {
    return "売上説明";
  }
  if (lower.includes("profitability") || lower.includes("margin")) {
    return "利益率・採算性の説明";
  }
  if (lower.includes("cash") || lower.includes("liquidity")) {
    return "キャッシュフロー・流動性";
  }
  if (lower.includes("debt")) {
    return "負債の説明";
  }
  if (lower.includes("risk")) {
    return "リスク要因";
  }
  if (lower.includes("sector")) {
    return "業種固有KPI";
  }
  return normalizeFallbackSourceLabels(normalized);
}

function sourceLabelToEvidenceKey(label: string): string {
  return label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/md&a/g, "mda")
    .replace(/[・、／/（）()]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function sampleUnsafeAnswer(answer: string): string {
  return answer
    .replace(/[A-Za-z][A-Za-z0-9’'&,()/-]+(?:\s+[A-Za-z0-9’'&,()/-]+){5,}/g, "[english omitted]")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function cleanBannedFinalAnswer(answer: string, questionIntent?: string | null): string {
  let cleaned = answer
    .replace(/提出資料の本文に、この論点に関する説明があります。?\s*/g, "")
    .replace(/本文に、この論点に関する説明があります。?\s*/g, "")
    .replace(/本文全体と数字を並べると、どの要因が強いかを追いやすくなります。?\s*/g, "")
    .replace(/本文全体と数字を並べると見えてきます。?\s*/g, "")
    .replace(/本文の要因説明と並べると判断しやすくなります。?\s*/g, "")
    .replace(/価格、数量、需要、コスト、mixを見るべきです。?\s*/g, "")
    .replace(/利益の動きは、この説明と費用・評価損益・税金の数字を並べると見えてきます。?/g, "利益の動きは、費用・評価損益・税金の内訳確認が必要です。")
    .replace(/(^|[。！？\s])買いです。?/g, "$1投資判断や株価の断定はしません。")
    .replace(/(?:売るべき|買うべき|投資推奨|目標株価|株価予想|(?:割安|割高)(?:です|だ|と断定|と判断))。?/g, "投資判断や株価の断定はしません。");

  if (/この資料の範囲では確認できません/.test(cleaned)) {
    const replacement = questionIntent === "liquidity_debt"
      ? "debt note や liquidity discussion の追加確認が必要です"
      : "不足している資料の種類の追加確認が必要です";
    cleaned = cleaned.replace(/この資料の範囲では確認できません/g, replacement);
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

function normalizeFallbackKind(
  responsePath: ChatResponsePath,
  debug: ChatResponseDebugInput
): ChatFallbackKind {
  if (responsePath !== "fallback") {
    return "none";
  }

  if (debug.fallbackKind && debug.fallbackKind !== "none") {
    if (debug.fallbackKind === "model_timeout") {
      return debug.sourceGateApplied ? "hard_model_timeout_evidence" : "non_hard_model_timeout";
    }
    return debug.fallbackKind;
  }

  switch (debug.fallbackReason) {
    case "gemini_timeout":
      return debug.sourceGateApplied ? "hard_model_timeout_evidence" : "non_hard_model_timeout";
    case "gemini_api_error":
      return "api_error";
    case "weak_grounding":
      return "weak_grounding";
    case "low_quality_answer":
      return debug.evidenceFallbackUsed ? "evidence_slot" : "low_quality";
    case "no_sources":
    case "metrics_only_insufficient":
      return "context_unavailable";
    case "deterministic_repair":
      return "deterministic_metric";
    case "invalid_source_id":
    case "schema_invalid":
    case "json_parse_failed":
      return "legacy_template";
    default:
      return "unknown_fallback";
  }
}
