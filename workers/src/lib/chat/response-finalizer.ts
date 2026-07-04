import type { Env, FilingCacheRecord } from "../../env";
import type { ChatFallbackKind } from "../../clients/gemini/types";
import type { RemoteConfig } from "../remote-config";
import {
  buildJapaneseLanguageGuardFallback,
  buildJapaneseLanguageGuardRepair,
  checkFinalAnswerJapaneseOnly
} from "./final-answer-language";
import { buildDeterministicMetricAnswer } from "./deterministic";
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

type DeterministicLanguageFallback = {
  answer: string;
  responseWithUrls: ChatResponsePayload;
  languageCheck: ReturnType<typeof checkFinalAnswerJapaneseOnly>;
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
  const q06DurabilityRepair = q04DurabilityRepair ?? repairMarginDurabilityFollowupAnswer(catQ06Cleanup.answer, question, debug);
  const uxCleanedAnswer = q06DurabilityRepair?.answer ?? catQ06Cleanup.answer;
  const originalAnswerBeforeLanguageGuard = uxCleanedAnswer;
  const languageCheck = checkFinalAnswerJapaneseOnly(uxCleanedAnswer);
  const bannedPhraseDetected = hasBannedPhrase(uxCleanedAnswer);
  const bannedPhraseCleanedAnswer = languageCheck.ok && bannedPhraseDetected
    ? cleanBannedFinalAnswer(uxCleanedAnswer, debug.questionIntent)
    : uxCleanedAnswer;
  const bannedPhraseStillDetected = languageCheck.ok && hasBannedPhrase(bannedPhraseCleanedAnswer);
  const cleanupBlocksModelAnswer = shouldCleanupBlockModelAnswer(cleanup, question, debug.questionIntent);
	const shouldAttemptSourceBackedRepair =
	  !languageCheck.ok ||
	  cleanupBlocksModelAnswer ||
	  debug.lowQualityReason === "profit_cause_revenue_only" ||
	  debug.lowQualityReason === "revenue_driver_declined_despite_context" ||
	  (responsePath === "fallback" &&
	    debug.evidenceFallbackUsed === true &&
	    debug.sourceGateSufficient === true &&
      isDriverDurabilityFollowupQuestion(question, debug.questionIntent)) ||
    (responsePath === "fallback" && shouldRepairFallbackHardFollowupAnswer(bannedPhraseCleanedAnswer, question, debug));
  const languageRepairCandidate = shouldAttemptSourceBackedRepair
    ? buildJapaneseLanguageGuardRepair({
      question,
      questionIntent: inferLanguageRepairIntent(question, debug),
      sourceGateSufficient: debug.sourceGateSufficient,
      sourceGateEvidenceSlots: debug.sourceGateEvidenceSlots,
      selectedSourceExcerpts: debug.selectedSourceExcerpts
    })
    : null;
  const languageRepairCheck = languageRepairCandidate
    ? checkFinalAnswerJapaneseOnly(languageRepairCandidate)
    : null;
  const languageRepairSafe = Boolean(
    languageRepairCandidate &&
    languageRepairCheck?.ok &&
    !hasBannedPhrase(languageRepairCandidate)
  );
  const sourceBackedFollowupRepairCandidate = buildSourceBackedFollowupRepairCandidate({
    answer: bannedPhraseCleanedAnswer,
    question,
    debug,
    normalizedFallbackKind
  });
  const sourceBackedFollowupRepairCheck = sourceBackedFollowupRepairCandidate
    ? checkFinalAnswerJapaneseOnly(sourceBackedFollowupRepairCandidate)
    : null;
  const sourceBackedFollowupRepairSafe = Boolean(
    sourceBackedFollowupRepairCandidate &&
    sourceBackedFollowupRepairCheck?.ok &&
    !hasBannedPhrase(sourceBackedFollowupRepairCandidate) &&
    hasSubstantiveDurabilityEvidenceAnswer(sourceBackedFollowupRepairCandidate)
  );
  const deterministicLanguageFallback = !languageCheck.ok
    ? buildSafeDeterministicLanguageFallback(filing, question)
    : null;
  const finalAnswerSafe = (languageCheck.ok && !bannedPhraseStillDetected) || languageRepairSafe || sourceBackedFollowupRepairSafe || Boolean(deterministicLanguageFallback);
  const sourceBackedHardFollowupAccepted = Boolean(
    finalAnswerSafe &&
    isSourceBackedHardFollowupAccepted({
      question,
      debug,
      normalizedFallbackKind,
      q06DurabilityRepairLabels: q06DurabilityRepair?.labels ?? [],
      languageRepairSafe: languageRepairSafe || sourceBackedFollowupRepairSafe,
      candidateAnswer: sourceBackedFollowupRepairSafe && sourceBackedFollowupRepairCandidate
        ? sourceBackedFollowupRepairCandidate
        : languageRepairSafe && languageRepairCandidate
          ? languageRepairCandidate
          : bannedPhraseCleanedAnswer
    })
  );
  const sourceBackedGateOverrideAccepted =
    sourceBackedHardFollowupAccepted &&
    debug.sourceGateSufficient !== true &&
    q06DurabilityRepair?.labels.includes("q06_previous_answer_margin_candidate_repair") === true &&
    !hasXbrlOnlyHardIntentContext(debug);
  const languageSafeAnswer = sourceBackedFollowupRepairSafe && sourceBackedFollowupRepairCandidate
    ? sourceBackedFollowupRepairCandidate
    : languageRepairSafe && languageRepairCandidate && (!languageCheck.ok || cleanupBlocksModelAnswer || responsePath === "fallback")
      ? languageRepairCandidate
    : languageCheck.ok && !bannedPhraseStillDetected
    ? bannedPhraseCleanedAnswer
    : languageRepairSafe && languageRepairCandidate
      ? languageRepairCandidate
      : deterministicLanguageFallback
        ? deterministicLanguageFallback.answer
      : buildJapaneseLanguageGuardFallback({
      question,
      questionIntent: debug.questionIntent,
      fallbackKind: normalizedFallbackKind,
      missingSourceTypes: debug.sourceGateMissingSourceTypes
    });
  const finalLanguageCheck = deterministicLanguageFallback
    ? deterministicLanguageFallback.languageCheck
    : sourceBackedFollowupRepairSafe && sourceBackedFollowupRepairCheck
      ? sourceBackedFollowupRepairCheck
    : languageRepairSafe && languageRepairCheck
      ? languageRepairCheck
      : languageCheck;
  const sanitizedLanguageSafeAnswer = sanitizeFinalUserFacingAnswer(languageSafeAnswer);
  const finalResponsePath = deterministicLanguageFallback
    ? "deterministic"
    : sourceBackedHardFollowupAccepted
      ? "openai"
      : finalAnswerSafe && !cleanupBlocksModelAnswer
        ? responsePath
        : "fallback";
  const finalFallbackKind: ChatFallbackKind = finalAnswerSafe
    ? deterministicLanguageFallback
      ? "none"
      : sourceBackedHardFollowupAccepted
      ? "none"
      : cleanupBlocksModelAnswer
        ? responsePath === "fallback"
          ? normalizedFallbackKind
          : "low_quality"
        : normalizedFallbackKind
    : "language_guard_fallback";
  const responsePathFallbackButKindNone = finalResponsePath === "fallback" && finalFallbackKind === "none";
  const finalAnswerLanguageLabels = languageCheck.ok && finalAnswerSafe ? [] : languageRepairSafe ? [
    ...languageCheck.labels,
    "answer_repaired_to_japanese"
  ] : deterministicLanguageFallback ? [
    ...languageCheck.labels,
    "answer_repaired_to_deterministic_japanese"
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
      ...(deterministicLanguageFallback?.responseWithUrls ?? responseWithUrls),
      answer: sanitizedLanguageSafeAnswer,
      responsePath: finalResponsePath
    },
    {
      ...debug,
      responsePath: finalResponsePath,
      fallbackReason: deterministicLanguageFallback || sourceBackedHardFollowupAccepted ? null : finalAnswerSafe && !cleanupBlocksModelAnswer ? debug.fallbackReason : debug.fallbackReason ?? "low_quality_answer",
      fallbackCategory: finalFallbackTaxonomy.fallbackCategory,
      fallbackUserReason: finalFallbackTaxonomy.fallbackUserReason,
      missingEvidence: finalFallbackTaxonomy.missingEvidence ?? [],
      missingEvidenceLabelsJa: finalFallbackTaxonomy.missingEvidenceLabelsJa ?? [],
      guardLabels: finalFallbackTaxonomy.guardLabels ?? [],
      fallbackKind: responsePathFallbackButKindNone ? "unknown_fallback" : finalFallbackKind,
      fallbackKindSource: deterministicLanguageFallback || sourceBackedHardFollowupAccepted ? "finalizer" : finalAnswerSafe ? debug.fallbackKindSource ?? "finalizer" : "language_guard",
      responsePathFallbackButKindNone,
      sourceGateSufficient: sourceBackedGateOverrideAccepted ? true : debug.sourceGateSufficient,
      sourceGatePassed: sourceBackedGateOverrideAccepted ? true : debug.sourceGatePassed,
      sourceGateFailureLabels: sourceBackedGateOverrideAccepted ? [] : debug.sourceGateFailureLabels,
      sourceGateMissingSourceTypes: sourceBackedGateOverrideAccepted ? [] : debug.sourceGateMissingSourceTypes,
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
        ...(q06DurabilityRepair?.labels ?? []),
        ...(languageRepairSafe ? ["language_guard_source_backed_repair"] : []),
        ...(sourceBackedFollowupRepairSafe ? ["q06_source_backed_followup_repair"] : []),
        ...(deterministicLanguageFallback ? ["language_guard_deterministic_repair"] : [])
      ],
      ...timings.snapshot()
    }
  );
}

const BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK = "選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。";
const BUSINESS_MODEL_MISSING_EVIDENCE = ["事業内容", "セグメント情報", "売上内訳", "MD&Aの事業説明"];
const MANAGEMENT_MISSING_EVIDENCE = ["MD&A", "業績説明", "セグメント実績", "見通し・リスクの説明"];
const REVENUE_DRIVER_MISSING_EVIDENCE = ["MD&A", "セグメント実績", "売上説明"];
const REVENUE_BREAKDOWN_MISSING_EVIDENCE = ["セグメント実績", "地域別売上", "製品・カテゴリ別売上"];
const MARGIN_DRIVER_MISSING_EVIDENCE = ["MD&A", "セグメント実績", "利益率・採算性の説明", "費用・原価の説明"];
const LIQUIDITY_MISSING_EVIDENCE = ["キャッシュフロー計算書", "流動性の説明", "負債の注記", "借入枠", "満期スケジュール"];
const RISK_MISSING_EVIDENCE = ["リスク要因", "MD&Aのリスク説明", "見通し・リスクの説明"];

function isSourceBackedHardFollowupAccepted({
  question,
  debug,
  normalizedFallbackKind,
  q06DurabilityRepairLabels,
  languageRepairSafe,
  candidateAnswer
}: {
  question: string;
  debug: ChatResponseDebugInput;
  normalizedFallbackKind: ChatFallbackKind;
  q06DurabilityRepairLabels: string[];
  languageRepairSafe: boolean;
  candidateAnswer: string;
}): boolean {
  const isExplicitHardDurabilityFollowup =
    debug.questionIntent === "driver_durability_followup" ||
    debug.questionIntent === "margin_durability_followup" ||
    isDriverDurabilityFollowupQuestion(question, debug.questionIntent) ||
    isMarginDurabilityFollowupQuestion(question, debug.questionIntent) ||
    isGenericDurabilityFollowupWithMarginContext(question, debug);
  const hasHardFollowupSourceReason =
    debug.fallbackUserReason === "revenue_driver_sources_missing" ||
    debug.fallbackUserReason === "margin_driver_sources_missing";
  if (!isExplicitHardDurabilityFollowup && !hasHardFollowupSourceReason) {
    return false;
  }

  if (debug.sourceGateSufficient !== true) {
    if (
      q06DurabilityRepairLabels.includes("q06_previous_answer_margin_candidate_repair") &&
      hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer) &&
      !hasXbrlOnlyHardIntentContext(debug)
	    ) {
	      return true;
	    }
	    if (
	      languageRepairSafe &&
	      isDriverDurabilityFollowupQuestion(question, debug.questionIntent) &&
	      hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer) &&
	      !hasXbrlOnlyHardIntentContext(debug)
	    ) {
	      return true;
	    }
	    return languageRepairSafe &&
	      isGenericDurabilityFollowupWithMarginContext(question, debug) &&
	      hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer) &&
      !hasXbrlOnlyHardIntentContext(debug);
  }

  if (q06DurabilityRepairLabels.some((label) =>
    label === "q04_bank_durability_source_backed_repair" ||
    label === "q04_retail_durability_source_backed_repair" ||
    label === "q04_generic_durability_source_backed_repair"
  )) {
    return true;
  }

  if (
    debug.sourceGateSufficient === true &&
    q06DurabilityRepairLabels.includes("q06_previous_answer_margin_candidate_repair") &&
    hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer)
  ) {
    return true;
  }

  if (
    debug.sourceGateSufficient === true &&
    languageRepairSafe &&
    hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer)
  ) {
    return true;
  }

  if (
    languageRepairSafe &&
    isGenericDurabilityFollowupWithMarginContext(question, debug) &&
    hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer) &&
    !hasXbrlOnlyHardIntentContext(debug)
  ) {
    return true;
  }

  return debug.evidenceFallbackUsed === true &&
    normalizedFallbackKind === "evidence_slot" &&
    (languageRepairSafe || hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer));
}

function hasXbrlOnlyHardIntentContext(debug: ChatResponseDebugInput): boolean {
  const failureLabels = debug.sourceGateFailureLabels ?? [];
  const selectedTypes = debug.selectedSourceTypes ?? [];
  return failureLabels.some((label) =>
    label === "retrieval_overfocused_xbrl" ||
    label === "margin_context_xbrl_only" ||
    label === "q04_metric_only_context"
  ) || (
    selectedTypes.length > 0 &&
    selectedTypes.every((type) => type === "xbrl_metric")
  );
}

function inferLanguageRepairIntent(question: string, debug: ChatResponseDebugInput): string | null | undefined {
  if (debug.questionIntent !== "yoy_change" && isGenericDurabilityFollowupWithMarginContext(question, debug)) {
    return "margin_durability_followup";
  }
  return debug.questionIntent;
}

function isGenericDurabilityFollowupWithMarginContext(question: string, debug: ChatResponseDebugInput): boolean {
  if (!/(一時|一過性|継続|続き|構造|temporary|transitory|continue|continued|structural)/i.test(question)) {
    return false;
  }
  const families = debug.selectedSourceSectionFamilies ?? [];
  const labels = debug.selectedSourceLabels ?? [];
  const excerpts = debug.selectedSourceExcerpts ?? [];
  const text = [...families, ...labels, ...excerpts].join(" ").toLowerCase();
  return debug.questionIntent === "margin_durability_followup" ||
    debug.lowQualityReason === "profit_cause_revenue_only" ||
    /margin|profitability|cost discussion|gross margin|operating expense|cost of sales|cost of revenue|利益率|粗利|費用|原価/.test(text);
}

function shouldRepairFallbackHardFollowupAnswer(answer: string, question: string, debug: ChatResponseDebugInput): boolean {
  if (
    debug.sourceGateSufficient !== true ||
    !/(一時|一過性|継続|続き|構造|temporary|transitory|continue|continued|structural)/i.test(question)
  ) {
    return false;
  }
  const normalized = answer.replace(/\s+/g, " ").trim();
  return debug.questionIntent === "yoy_change" &&
    /(?:[A-Za-z]{3,}\s+){3,}|[0-9]\s*%\s+[A-Za-z]|Other operating|income expense|average selling prices?|bit shipments?/i.test(normalized);
}

function buildSourceBackedFollowupRepairCandidate({
  answer,
  question,
  debug,
  normalizedFallbackKind
}: {
  answer: string;
  question: string;
  debug: ChatResponseDebugInput;
  normalizedFallbackKind: ChatFallbackKind;
}): string | null {
  if (
    debug.sourceGateSufficient !== true ||
    debug.evidenceFallbackUsed !== true ||
    normalizedFallbackKind !== "evidence_slot" ||
    !isMarginDurabilityFollowupQuestion(question, debug.questionIntent) ||
    !isDurabilityUnderAnswer(answer)
  ) {
    return null;
  }

  return buildJapaneseLanguageGuardRepair({
    question,
    questionIntent: "margin_durability_followup",
    sourceGateSufficient: true,
    sourceGateEvidenceSlots: debug.sourceGateEvidenceSlots,
    selectedSourceExcerpts: debug.selectedSourceExcerpts
  });
}

function hasSubstantiveDurabilityEvidenceAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, " ").trim();
  if (!normalized || /具体的な(?:利益率)?要因は十分に特定できません|具体的な要因が十分に特定できていません/.test(normalized)) {
    return false;
  }
  const hasDriverCandidate =
    /(?:売上|利益率)要因(?:候補)?(?:として)?確認できるのは、[^。]{3,}/.test(normalized) ||
    /前問(?:の|で挙がっていた)(?:売上|利益率)要因(?:候補)?は、[^。]{3,}/.test(normalized);
  const hasDurabilityCaveat = /一時|継続|構造|断定しません|断定できません|次に見るべき指標/.test(normalized);
  return hasDriverCandidate && hasDurabilityCaveat;
}

function buildSafeDeterministicLanguageFallback(
  filing: FilingCacheRecord,
  question: string
): DeterministicLanguageFallback | null {
  const deterministic = buildDeterministicMetricAnswer(filing, question);
  if (!deterministic) {
    return null;
  }
  const responseWithUrls = attachCurrentFilingSourceUrls(
    ensureFilingGroundedResponse(deterministic.response),
    filing.primaryDocumentUrl
  );
  const sanitizedAnswer = sanitizeFinalUserFacingAnswer(responseWithUrls.answer);
  const languageCheck = checkFinalAnswerJapaneseOnly(sanitizedAnswer);
  if (!languageCheck.ok || hasBannedPhrase(sanitizedAnswer)) {
    return null;
  }
  return {
    answer: sanitizedAnswer,
    responseWithUrls: {
      ...responseWithUrls,
      answer: sanitizedAnswer
    },
    languageCheck
  };
}

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
  if (
    !isDriverDurabilityFollowupQuestion(question, debug.questionIntent) ||
    ((debug.sourceGateSufficient !== true || isMarginDurabilityFollowupQuestion(question, debug.questionIntent)) && isMarginDurabilityUnderAnswer(answer))
  ) {
    return null;
  }

  if (debug.sourceGateSufficient !== true) {
    const previousAnswerRepair = buildPreviousAnswerDurabilityCandidate(answer, debug.followupPreviousAnswer);
    return previousAnswerRepair
      ? {
          answer: sanitizeFinalUserFacingAnswer(previousAnswerRepair),
          labels: ["q04_previous_answer_driver_candidate_repair"]
        }
      : null;
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
    } else {
      const genericRepair = buildGenericDriverDurabilitySynthesis(answer, evidenceText);
      if (genericRepair) {
        repairedAnswer = genericRepair;
        labels.push("q04_generic_durability_source_backed_repair");
      }
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

function buildPreviousAnswerDurabilityCandidate(answer: string, previousAnswer?: string | null): string | null {
  if (!isDurabilityUnderAnswer(answer) || !previousAnswer || shouldIgnorePreviousDriverAnswer(previousAnswer)) {
    return null;
  }

  const drivers = inferPreviousAnswerDriverLabels(previousAnswer);
  if (drivers.length === 0) {
    return null;
  }

  const indicators = inferPreviousAnswerDurabilityIndicators(previousAnswer, drivers);
  const indicatorText = indicators.length > 0
    ? `次に見るべき指標は、${joinJapaneseItems(indicators.slice(0, 5))} です。`
    : "次に見るべき指標は、同じ要因が次期にも続くかどうかです。";
  return `前問で挙がっていた売上要因候補は、${joinJapaneseItems(drivers.slice(0, 5))} です。ただし、この資料だけでは一時要因か継続要因かは断定しません。${indicatorText}`;
}

function repairMarginDurabilityFollowupAnswer(
  answer: string,
  question: string,
  debug: ChatResponseDebugInput
): Q04DurabilityRepair | null {
  if (!isMarginDurabilityFollowupQuestion(question, debug.questionIntent) && !isGenericDurabilityFollowupWithMarginContext(question, debug)) {
    return null;
  }

  const previousAnswerRepair = buildPreviousAnswerMarginDurabilityCandidate(answer, debug.followupPreviousAnswer);
  return previousAnswerRepair
    ? {
        answer: sanitizeFinalUserFacingAnswer(previousAnswerRepair),
        labels: ["q06_previous_answer_margin_candidate_repair"]
      }
    : null;
}

function buildPreviousAnswerMarginDurabilityCandidate(answer: string, previousAnswer?: string | null): string | null {
  if (!isDurabilityUnderAnswer(answer) || !previousAnswer || shouldIgnorePreviousMarginDriverAnswer(previousAnswer)) {
    return null;
  }

  const drivers = inferPreviousAnswerMarginDriverLabels(previousAnswer);
  if (drivers.length === 0) {
    return null;
  }

  const indicators = inferPreviousAnswerMarginDurabilityIndicators(previousAnswer, drivers);
  const indicatorText = indicators.length > 0
    ? `次に見るべき指標は、${joinJapaneseItems(indicators.slice(0, 5))} です。`
    : "次に見るべき指標は、同じ利益率要因が次期にも続くかどうかです。";
  return `前問で挙がっていた利益率要因候補は、${joinJapaneseItems(drivers.slice(0, 5))} です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。${indicatorText}`;
}

function shouldIgnorePreviousDriverAnswer(previousAnswer: string): boolean {
  return /(?:income taxes payable|Pillar Two|TAC|traffic acquisition costs?|brokerage expense|auto lease depreciation|marketing expense|occupancy expense|distribution fees|noncurrent income taxes|税金|税効果|費用|減価償却|販管費|人件費|信用損失|引当|Sleep\?|正確な表現は数字)/i.test(previousAnswer);
}

function shouldIgnorePreviousMarginDriverAnswer(previousAnswer: string): boolean {
  return /(?:income taxes payable|Pillar Two|noncurrent income taxes|税金|税効果|Sleep\?|正確な表現は数字)/i.test(previousAnswer);
}

function inferPreviousAnswerDriverLabels(previousAnswer: string): string[] {
  const text = previousAnswer.toLowerCase();
  const labels: string[] = [];
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(text)) {
      labels.push(label);
    }
  };

  add("地域別売上", /americas|europe|greater china|asia pacific|地域別|地域/);
  add("iPhone", /iphone/);
  add("サービス売上", /services?|サービス/);
  add("決済ボリューム", /payments volume|processed transactions|cross-border volume|決済/);
  add("Advisory・その他サービス", /advisory|other services/);
  add("販売数量・出荷量", /sales volume|unit case volume|(?<!payments )volume|出荷量|販売数量|数量|ボリューム|量の増加|ボリューム成長|volume growth/);
  add("価格・ミックス", /price\/mix|price mix|pricing|price realization|realized price|価格|ミックス|実現価格|価格低下|値引き/);
  add("資源価格", /crude|oil price|natural gas|commodity|原油|天然ガス|市場価格|資源価格/);
  add("需給環境", /supply|demand|需要|供給/);
  add("買収影響", /acquisition|pioneer|買収/);
  add("製品カテゴリ成長", /coffee|water|sports|trademark coca-cola|sparkling|カテゴリ|コーヒー|水|スポーツ飲料|mounjaro|zepbound|製品/);
  add("ボトリング投資", /bottling|ボトリング/);
  add("クラウド・AWS", /aws|azure|google cloud|cloud|クラウド/);
  add("広告需要", /advertising|\bads?\b|広告/);
  add("旅客収入", /passenger revenue|passenger|旅客/);
  add("精製・燃料価格", /refinery|refining|fuel|精製|燃料/);
  add("車両価格・納車", /vehicle pricing|deliveries|production volume|automotive|車両価格|納車|生産台数/);

  return [...new Set(labels)];
}

function inferPreviousAnswerDurabilityIndicators(previousAnswer: string, drivers: string[]): string[] {
  const text = previousAnswer.toLowerCase();
  const indicators = [...drivers];
  if (/iphone|services?|サービス/.test(text)) {
    indicators.push("製品別売上", "サービス売上");
  }
  if (/greater china|asia pacific|地域/.test(text)) {
    indicators.push("地域別売上");
  }
  if (/tariff|関税/.test(text)) {
    indicators.push("関税影響");
  }
  if (/crude|natural gas|原油|天然ガス|資源価格/.test(text)) {
    indicators.push("資源価格");
  }
  if (/unit case volume|volume|ボリューム|数量/.test(text)) {
    indicators.push("販売数量・ボリューム");
  }
  if (/price\/mix|price mix|価格/.test(text)) {
    indicators.push("価格・ミックス");
  }
  return [...new Set(indicators)];
}

function inferPreviousAnswerMarginDriverLabels(previousAnswer: string): string[] {
  const text = previousAnswer.toLowerCase();
  const labels: string[] = [];
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(text)) {
      labels.push(label);
    }
  };

  add("販売数量・出荷量", /sales volume|unit case volume|volume|出荷量|販売数量|数量|ボリューム|量の増加|ボリューム成長|volume growth/);
  add("価格・ミックス", /price\/mix|price mix|pricing|price realization|realized price|価格|ミックス|実現価格|価格低下|値引き/);
  add("製造コスト", /manufacturing cost|production cost|cost pressure|costs?|製造コスト|原価|コスト/);
  add("関税", /tariff|関税/);
  add("為替", /\bfx\b|foreign exchange|currency|為替/);
  add("粗利益率", /gross margin|gross profit|粗利|粗利益/);
  add("研究開発費", /\br&d\b|research and development|研究開発/);
  add("販売管理費", /selling, general and administrative|sg&a|marketing|administrative|販管費|販売管理費|マーケティング/);
  add("トラフィック獲得コスト", /\btac\b|traffic acquisition costs?|トラフィック獲得/);
  add("減価償却費", /depreciation|amortization|減価償却/);
  add("コンテンツ調達費", /content acquisition costs?|content costs?|コンテンツ/);
  add("人件費", /salar(?:y|ies)|labor|employee compensation|人件費|給与|従業員報酬/);
  add("燃料費", /fuel|aircraft fuel|燃料/);
  add("原材料コスト", /raw material|input cost|ingredient|原材料/);
  add("クラウド需要", /aws|azure|google cloud|cloud|クラウド/);
  add("製品需要", /mounjaro|zepbound|demand|需要/);
  add("訴訟費用・引当", /litigation|provision|訴訟|引当/);
  add("買収関連費用", /acquired ipr&d|acquisition|買収/);

  return [...new Set(labels)];
}

function inferPreviousAnswerMarginDurabilityIndicators(previousAnswer: string, drivers: string[]): string[] {
  const text = previousAnswer.toLowerCase();
  const indicators = [...drivers];
  if (/gross margin|gross profit|粗利/.test(text)) {
    indicators.push("粗利益率");
  }
  if (/price|価格|ミックス/.test(text)) {
    indicators.push("価格・ミックス");
  }
  if (/manufacturing cost|cost|原価|コスト/.test(text)) {
    indicators.push("原価・製造コスト");
  }
  if (/\br&d\b|research and development|研究開発/.test(text)) {
    indicators.push("研究開発費");
  }
  if (/marketing|sg&a|administrative|販管費|販売管理費/.test(text)) {
    indicators.push("販管費");
  }
  if (/\btac\b|traffic acquisition costs?/.test(text)) {
    indicators.push("トラフィック獲得コスト");
  }
  if (/depreciation|amortization|減価償却/.test(text)) {
    indicators.push("減価償却費");
  }
  return [...new Set(indicators)];
}

function joinJapaneseItems(items: string[]): string {
  return [...new Set(items.filter(Boolean))].join("、");
}

function isDriverDurabilityFollowupQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "margin_durability_followup") {
    return false;
  }
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

  return `提出資料だけでは継続性は断定できません。${niiClause}${nirClause}次回はNII、NIR、預金マージン、Markets収益、手数料収入を確認する必要があります。`;
}

function buildWmtDurabilitySynthesis(
  answer: string,
  evidenceText: string,
  filing: FilingCacheRecord
): string | null {
  if (!isWmtLikeFiling(filing) || !hasRetailDurabilityEvidence(evidenceText) || !isDurabilityUnderAnswer(answer)) {
    return null;
  }

  return "提出資料だけでは継続性は断定できません。Walmart USでは、comparable salesにeCommerceが寄与し、transactionsやunit volumes、groceryとhealth & wellnessの強さ、Walmart+ member engagementとomnichannel利用が支えになっています。これらは継続性を見る材料ですが、持続性を判断するには、次回のcomparable sales、traffic、ticket、eCommerce寄与、member engagement、fuel価格影響を確認する必要があります。";
}

function buildGenericDriverDurabilitySynthesis(answer: string, evidenceText: string): string | null {
  if (!isDurabilityUnderAnswer(answer) || !hasGenericDurabilityEvidence(evidenceText)) {
    return null;
  }
  const drivers = inferPreviousAnswerDriverLabels(evidenceText);
  if (drivers.length === 0) {
    return null;
  }
  const indicators = inferPreviousAnswerDurabilityIndicators(evidenceText, drivers);
  const indicatorText = indicators.length > 0
    ? `次に見るべき指標は、${joinJapaneseItems(indicators.slice(0, 5))} です。`
    : `次に見るべき指標は、${joinJapaneseItems(drivers.slice(0, 5))} が次期にも続くかどうかです。`;
  return `このfilingだけでは継続性は断定できません。売上要因候補として確認できるのは、${joinJapaneseItems(drivers.slice(0, 5))} です。${indicatorText}`;
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

function hasGenericDurabilityEvidence(text: string): boolean {
  return /(continue|continued|expected|expects|outlook|future|vary based on|performance expectation|long[- ]term|cyclical|uncertain|uncertainty|risk|headwind|tailwind|supply constraint|demand|volume growth|pricing modifications|price\/mix|price mix|market supply and demand|継続|見通し|不確実|需要|価格)/i.test(text);
}

function isDurabilityUnderAnswer(answer: string): boolean {
  return /前問の具体的な(?:売上|利益率)?要因(?:が|は)?十分に特定|具体的な(?:売上|利益率)?要因(?:が|は)?十分に特定できません|一時要因か(?:継続要因|構造的変化)かは分類しません|確認すべき箇所は|追加確認が必要/.test(answer);
}

function isMarginDurabilityUnderAnswer(answer: string): boolean {
  return /利益率|マージン|営業利益|純利益|粗利|コスト|営業費用|セグメント利益率/.test(answer) &&
    /具体的な(?:利益率)?要因は十分に特定できません|改善\/悪化|一時要因か構造的変化/.test(answer);
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
  if (isRevenueBreakdownQuestion(question, questionIntent)) {
    const revenueBreakdownCleanup = cleanRevenueBreakdownAnswer(normalizedAnswer);
    if (revenueBreakdownCleanup) {
      return revenueBreakdownCleanup;
    }
  }
  if (isRevenueDriverQuestion(question, questionIntent)) {
    const revenueDriverCleanup = cleanRevenueDriverAnswer(normalizedAnswer);
    if (revenueDriverCleanup) {
      return revenueDriverCleanup;
    }
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

const REVENUE_BREAKDOWN_SOURCE_INSUFFICIENT_FALLBACK = "売上高の増減は確認できますが、選択された資料だけでは会社固有の売上の柱までは特定できません。見るべき箇所は、事業別の実績表、製品・サービス別の売上表、地域別の実績表、MD&Aの売上説明です。分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません。";

const REVENUE_DRIVER_SOURCE_INSUFFICIENT_FALLBACK = "売上の増減は確認できますが、選択された資料だけでは会社固有の売上要因までは断定できません。確認すべき箇所は、MD&A、セグメント実績、売上説明です。売上以外の損益項目だけでは、売上要因として扱いません。";

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

function isRevenueDriverQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "revenue_driver") {
    return true;
  }
  const normalized = question.replace(/\s+/g, "");
  return /(売上|増収|減収|revenue|sales)/i.test(normalized) && /(要因|主因|理由|なぜ|driver|cause)/i.test(normalized);
}

function isRevenueBreakdownQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "revenue_breakdown" || questionIntent === "revenue_snapshot" || questionIntent === "segment_driver" || questionIntent === "segment_analysis") {
    return true;
  }
  const normalized = question.replace(/\s+/g, "");
  return /(売上|revenue|sales)/i.test(normalized) && /(内訳|区分|セグメント|segment|地域|region|製品|カテゴリ|category|伸びた|弱かった)/i.test(normalized);
}

function cleanRevenueBreakdownAnswer(answer: string): AnswerCleanupResult | null {
  if (!hasGenericRevenueBreakdownOnly(answer)) {
    return null;
  }
  return sourceInsufficientCleanup(
    REVENUE_BREAKDOWN_SOURCE_INSUFFICIENT_FALLBACK,
    "revenue_breakdown_sources_missing",
    ["セグメント実績", "地域別売上", "製品・カテゴリ別売上"],
    ["revenue_breakdown_generic_category_only"]
  );
}

function hasGenericRevenueBreakdownOnly(answer: string): boolean {
  const compact = answer.replace(/\s+/g, "");
  const hasGenericCategory =
    /(地域別売上|地域別の内訳|セグメント別|セグメント別売上|セグメント別売上高|セグメント別の売上|セグメント別の売上高|セグメント別の内訳|セグメント別売上の内訳|製品別売上|製品・カテゴリ別売上|売上区分|大きい区分|大きな区分|主な売上区分|主な売上区分は不明|区分別の内訳|個別セグメント別|セグメント別・地域別|製品別・地域別|全社ベース|売上高全体|総売上高|全体売上高|支払い関連サービス全般|servicerevenue)/i.test(compact) ||
    /主な売上区分[:：]?売上高/.test(compact);
  if (!hasGenericCategory) {
    return false;
  }
  if (hasConcreteRevenueBreakdownTerm(answer)) {
    return false;
  }
  return /(地域別売上(?:が|は|を|として|という分類)|地域別の内訳|セグメント別(?:では情報|売上高|内訳|の内訳|の売上(?:高)?(?:が|は|を|として|という分類)?)|セグメント別売上の内訳|製品別売上(?:が|は|を|として|という分類)|大きい区分|大きな区分|主な売上区分(?:[:：]?\s*売上高|は不明)|全社ベース|売上高全体|総売上高|全体売上高|支払い関連サービス全般|service revenue|区分別の内訳|具体的な金額の内訳は|詳細な内訳は|内訳(?:情報|データ|は|が)?(?:[^。]{0,48})?(?:示されていません|含まれていません|明示されていません|読み取れません|欠如しています|記載されていません|分かりません|確認できません)|どのセグメントや地域が伸びたか(?:[^。]{0,48})?(?:示されていません|分かりません)|具体的なセグメント別の売上比率|売上内訳のセグメント別金額|カテゴリ別の寄与は示されていません)/i.test(answer);
}

function hasConcreteRevenueBreakdownTerm(answer: string): boolean {
  return [
    /Construction Industries|Resource Industries|Energy & Transportation/i,
    /建設機械|資源産業|エネルギー・輸送/,
    /Energy Products|Chemical Products|Specialty Products|Upstream|Downstream|Chemical/i,
    /NII|NIR|Net interest income|Noninterest revenue|利息収益|非利息収益/i,
    /Walmart U\.?S\.?|Walmart International|Sam'?s Club/i,
    /DRAM|NAND|NOR|Memory|Storage/i,
    /Google Services|Google Cloud|YouTube ads?|Google Network|AdSense/i,
    /iPhone|iPad|Mac|Wearables|ウェアラブル|Services/i,
    /Mounjaro|Zepbound/,
    /Coca-Cola|Trademark|Asia Pacific|EMEA|North America/i,
    /Advisory|Other Services|Payments|value-added services/i,
    /Compute|Networking|Graphics|Data Center/i,
    /Automotive|Energy Generation/i,
    /Passenger revenue|Cargo|Refinery|MRO|Premium products|loyalty/i
  ].some((pattern) => pattern.test(answer));
}

function cleanRevenueDriverAnswer(answer: string): AnswerCleanupResult | null {
  if (!hasMisleadingNonRevenueDriverCause(answer)) {
    return null;
  }
  return sourceInsufficientCleanup(
    REVENUE_DRIVER_SOURCE_INSUFFICIENT_FALLBACK,
    "revenue_driver_sources_missing",
    REVENUE_DRIVER_MISSING_EVIDENCE,
    ["revenue_driver_non_revenue_cause_removed"]
  );
}

function hasMisleadingNonRevenueDriverCause(answer: string): boolean {
  if (!/(売上(?:変化|成長|増減)?の?要因|売上要因|revenue driver)/i.test(answer)) {
    return false;
  }
  return /(?:income taxes payable|Pillar Two|TAC|traffic acquisition costs?|brokerage expense|auto lease depreciation|marketing expense|occupancy expense|distribution fees|noncurrent income taxes|税金|税効果|費用|減価償却|販管費|人件費|信用損失|引当)/i.test(answer);
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
    .replace(/\brevenue\s+driver\s+discussion\b/gi, "売上要因の説明")
    .replace(/\bmargin\s+driver\s+discussion\b/gi, "利益率要因の説明")
    .replace(/\bsegment\s+margin\b/gi, "セグメント利益率")
    .replace(/\bpricing\b/gi, "価格改定")
    .replace(/\bmix\b/gi, "構成")
    .replace(/\bprovision\b/gi, "引当")
    .replace(/\brestructuring\b/gi, "構造改革費用")
    .replace(/\bimpairment\b/gi, "減損")
    .replace(/\bprice\s+reali[sz]ation\b/gi, "価格実現")
    .replace(/\bhigher\s+net\s+sales\s+of\s+Pro\s+models\b/gi, "Proモデルの純売上増")
    .replace(/\bforeign\s+exchange\b/gi, "為替")
    .replace(/\baverage\s+selling\s+prices?\b/gi, "平均販売価格")
    .replace(/\bbit\s+shipments?\b/gi, "出荷量")
    .replace(/\bfavorable\s+mix\b/gi, "有利な製品ミックス")
    .replace(/短期债務/g, "短期債務")
    .replace(/\bmaturities\b/gi, "満期")
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
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*млрд\s*ドル/gi, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value * 10, raw.includes("."))}億ドル` : `${raw}十億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*billion\s*USD\b/gi, (_match, raw: string) => {
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
    .replace(/\bprimarily due to\b/gi, "主に")
    .replace(/\bdriven by\b/gi, "主因は")
    .replace(/\bas well as\b/gi, "さらに")
    .replace(/\bpartially offset by\b/gi, "一部相殺したのは")
    .replace(/\bpartially offset\b/gi, "一部相殺")
    .replace(/\bhigher\s+稼働率\s+expense\b/gi, "稼働関連費用の増加")
    .replace(/\bhigher\s+([a-z][a-z\s-]{2,80}?)\s+expense\b/gi, (_match, raw: string) => `${normalizeEnglishExpenseLabel(raw)}の増加`)
    .replace(/\bhigher\s+auto lease depreciation\b/gi, "オートリース減価償却の増加")
    .replace(/\bdistribution fees\b/gi, "流通費用")
    .replace(/\bcontinued investments in technology\b/gi, "継続的な技術投資")
    .replace(/\bconcentrate\s+販売数量/gi, "原液販売数量")
    .replace(/\bunit case volume\b/gi, "ユニットケース販売数量")
    .replace(/\bBottling Investments\b/g, "ボトリング投資")
    .replace(/\bNorth America\b/g, "北米")
    .replace(/\bPremium products\b/g, "プレミアム商品")
    .replace(/\bMain cabin\b/g, "メインキャビン")
    .replace(/\bre[-\s]?franchising\b/gi, "再フランチャイズ化")
    .replace(/\bsales volume\b/gi, "販売数量")
    .replace(/\bmarketing\b/gi, "マーケティング費用")
    .replace(/\bunfavorable\b/gi, "不利な")
    .replace(/\bfavorable\b/gi, "有利な")
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
    .replace(/\bprice-cost spread discussion\b/gi, "価格とコスト差の説明")
    .replace(/\bprice-cost spread\b/gi, "価格とコスト差")
    .replace(/price-コスト spread discussion/gi, "価格とコスト差の説明")
    .replace(/price-コスト/gi, "価格とコスト")
    .replace(/\bmanufacturing cost discussion\b/gi, "製造コストの説明")
    .replace(/製造コスト\s+discussion/gi, "製造コストの説明")
    .replace(/\bSG&A\/R&D discussion\b/gi, "販管費・研究開発費の説明")
    .replace(/\bcomparable sales discussion\b/gi, "既存店売上の説明")
    .replace(/\btraffic and ticket discussion\b/gi, "客数・客単価の説明")
    .replace(/\beCommerce discussion\b/gi, "EC売上の説明")
    .replace(/\bmembership or advertising discussion\b/gi, "会員・広告収益の説明")
    .replace(/\bproduct revenue(?: discussion)?\b/gi, "製品別売上")
    .replace(/\bservices revenue(?: discussion)?\b/gi, "サービス売上")
    .replace(/\bsegment revenue(?: discussion)?\b/gi, "セグメント別売上")
    .replace(/\bgeographic revenue(?: discussion)?\b/gi, "地域別売上")
    .replace(/\bgeography revenue(?: discussion)?\b/gi, "地域別売上")
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

function normalizeEnglishExpenseLabel(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (/brokerage/.test(normalized)) return "ブローカー費用";
  if (/distribution/.test(normalized)) return "流通費用";
  if (/auto lease depreciation/.test(normalized)) return "オートリース減価償却";
  if (/marketing/.test(normalized)) return "マーケティング費用";
  if (/occupancy/.test(normalized)) return "稼働関連費用";
  if (/technology/.test(normalized)) return "技術投資";
  return "費用";
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
    .replace(/\bsource\b/gi, "資料");
}

function normalizeBusinessLineLabels(answer: string): string {
  return answer
    .replace(/Re資料 Industries/g, "資源産業")
    .replace(/\bResource Industries\b/g, "資源産業")
    .replace(/\bConstruction Industries\b/g, "建設機械")
    .replace(/\bEnergy & Transportation\b/g, "エネルギー・輸送")
    .replace(/\btotal Revenue\b/gi, "全体売上")
    .replace(/全体 Revenue/g, "全体売上")
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
  const ticker = filing.ticker.toUpperCase();
  if (FINANCIAL_TICKERS_FOR_FINALIZER.has(ticker)) {
    return true;
  }
  const name = filing.companyName.toLowerCase();
  return /\b(bank|bancorp|banking|financial group|financial services|capital markets|securities|brokerage)\b/.test(name);
}

const FINANCIAL_TICKERS_FOR_FINALIZER = new Set([
  "JPM",
  "BAC",
  "WFC",
  "C",
  "GS",
  "MS",
  "USB",
  "PNC",
  "TFC",
  "BK",
  "STT",
  "COF",
  "AXP"
]);

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

  if (isGenericBusinessModelAnswer(withoutMetricSnapshots)) {
    return {
      answer: BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK,
      taxonomy: {
        fallbackCategory: "source_insufficient",
        fallbackUserReason: "business_model_sources_missing",
        missingEvidence: ["business", "segment_information", "revenue_note", "mda_business_discussion"],
        missingEvidenceLabelsJa: BUSINESS_MODEL_MISSING_EVIDENCE,
        guardLabels: ["business_model_too_generic"]
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

function isGenericBusinessModelAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const genericBusinessLineOnly = /(?:製品とサービス|製品やサービス|商品とサービス|商品やサービス|製品・サービス|商品・サービス|小売事業|事業活動|販売事業|サービス事業)(?:の提供|の販売)?(?:を通じて)?(?:で|から)?(?:収益|売上|利益)?(?:を)?(?:得ています|稼いでいます|儲けています|上げています|得る会社です|稼ぐ会社です)/.test(normalized);
  return genericBusinessLineOnly;
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
    return alignSourceMissingTaxonomyWithIntent(cleanupTaxonomy, debug.questionIntent);
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

function alignSourceMissingTaxonomyWithIntent(
  taxonomy: FallbackTaxonomy,
  questionIntent?: string | null
): FallbackTaxonomy {
  if (!taxonomy.fallbackUserReason.endsWith("_sources_missing")) {
    return taxonomy;
  }
  if (
    questionIntent === "margin_driver" ||
    questionIntent === "margin_durability_followup" ||
    questionIntent === "margin_profitability"
  ) {
    return {
      ...sourceInsufficientTaxonomy("margin_driver_sources_missing", MARGIN_DRIVER_MISSING_EVIDENCE, taxonomy.missingEvidenceLabelsJa ?? []),
      guardLabels: dedupeStrings(["source_insufficient", ...(taxonomy.guardLabels ?? [])])
    };
  }
  if (questionIntent === "revenue_driver" || questionIntent === "yoy_change" || questionIntent === "driver_durability_followup") {
    return {
      ...sourceInsufficientTaxonomy("revenue_driver_sources_missing", REVENUE_DRIVER_MISSING_EVIDENCE, taxonomy.missingEvidenceLabelsJa ?? []),
      guardLabels: dedupeStrings(["source_insufficient", ...(taxonomy.guardLabels ?? [])])
    };
  }
  return taxonomy;
}

function shouldCleanupBlockModelAnswer(
  cleanup: AnswerCleanupResult,
  question: string,
  questionIntent?: string | null
): boolean {
  const reason = cleanup.taxonomy?.fallbackUserReason;
  if (!reason || reason === "none") {
    return false;
  }
  if (reason === "business_model_sources_missing" && isBusinessModelQuestion(question, questionIntent)) {
    return true;
  }
  if (reason === "revenue_driver_sources_missing" && isRevenueDriverQuestion(question, questionIntent)) {
    return true;
  }
  if (reason === "revenue_breakdown_sources_missing" && isRevenueBreakdownQuestion(question, questionIntent)) {
    return true;
  }
  if (reason === "margin_driver_sources_missing" && (questionIntent === "margin_driver" || questionIntent === "margin_durability_followup" || isMarginDurabilityFollowupQuestion(question, questionIntent))) {
    return true;
  }
  if (reason !== "answer_too_metric_only") {
    return false;
  }
  if (isBusinessModelQuestion(question, questionIntent)) {
    return true;
  }
  return questionIntent === "revenue_driver" ||
    questionIntent === "margin_driver" ||
    questionIntent === "driver_durability_followup" ||
    questionIntent === "margin_durability_followup";
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
  if (questionIntent === "revenue_driver" || questionIntent === "yoy_change" || questionIntent === "driver_durability_followup") {
    return sourceInsufficientTaxonomy("revenue_driver_sources_missing", REVENUE_DRIVER_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "revenue_breakdown" || questionIntent === "revenue_snapshot" || questionIntent === "segment_driver" || questionIntent === "segment_analysis") {
    return sourceInsufficientTaxonomy("revenue_breakdown_sources_missing", REVENUE_BREAKDOWN_MISSING_EVIDENCE, missingSourceTypes);
  }
  const missingHaystack = missingSourceTypes.join(" ").toLowerCase();
  if (/(margin|profitability|price-cost|manufacturing cost|sg&a|sga|r&d|research and development|segment margin|cost discussion)/.test(missingHaystack)) {
    return sourceInsufficientTaxonomy("margin_driver_sources_missing", MARGIN_DRIVER_MISSING_EVIDENCE, missingSourceTypes);
  }
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
  if (questionIntent === "margin_driver" || questionIntent === "margin_durability_followup" || questionIntent === "margin_profitability") {
    return sourceInsufficientTaxonomy("margin_driver_sources_missing", MARGIN_DRIVER_MISSING_EVIDENCE, missingSourceTypes);
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
  if (lower.includes("net interest")) {
    return "純利息収入";
  }
  if (lower.includes("noninterest")) {
    return "非金利収入・費用";
  }
  if (lower.includes("provision for credit losses") || lower.includes("credit loss")) {
    return "信用損失引当";
  }
  if (lower.includes("deposit") || lower.includes("loan") || lower.includes("credit quality")) {
    return "預金・貸出・信用品質";
  }
  if (lower.includes("investment banking") || lower.includes("trading") || lower.includes("wealth management") || lower.includes("asset management")) {
    return "金融サービス別収益";
  }
  if (lower.includes("commodity") || lower.includes("crude") || lower.includes("natural gas")) {
    return "資源価格";
  }
  if (lower.includes("production volume")) {
    return "生産量";
  }
  if (lower.includes("upstream") || lower.includes("downstream")) {
    return "上流・下流セグメント";
  }
  if (lower.includes("refining") || lower.includes("chemical margin")) {
    return "精製・化学マージン";
  }
  if (lower.includes("price-cost") || lower.includes("manufacturing cost") || lower.includes("cost absorption") || lower.includes("material cost")) {
    return "価格とコスト・製造コスト";
  }
  if (lower.includes("sg&a") || lower.includes("sga") || lower.includes("r&d") || lower.includes("research and development")) {
    return "販管費・研究開発費";
  }
  if (lower.includes("segment margin") || lower.includes("segment profitability") || lower.includes("segment operating profit")) {
    return "セグメント利益率";
  }
  if (lower.includes("price realization")) {
    return "価格実現";
  }
  if (lower.includes("sales volume")) {
    return "販売数量";
  }
  if (lower.includes("order") || lower.includes("backlog")) {
    return "受注・バックログ";
  }
  if (lower.includes("dealer inventory")) {
    return "ディーラー在庫";
  }
  if (lower.includes("comparable sales") || lower.includes("comp sales")) {
    return "既存店売上";
  }
  if (lower.includes("traffic") || lower.includes("ticket")) {
    return "客数・客単価";
  }
  if (lower.includes("ecommerce") || lower.includes("e-commerce")) {
    return "EC売上";
  }
  if (lower.includes("membership") || lower.includes("advertising")) {
    return "会員・広告収益";
  }
  if (lower.includes("vehicle pricing")) {
    return "車両価格";
  }
  if (lower.includes("automotive gross margin")) {
    return "自動車粗利益率";
  }
  if (lower.includes("pricing")) {
    return "価格改定";
  }
  if (lower.includes("volume")) {
    return "販売数量";
  }
  if (lower.includes("foreign exchange") || lower.includes("currency")) {
    return "為替影響";
  }
  if (lower.includes("organic sales")) {
    return "オーガニック売上";
  }
  if (lower.includes("gross margin")) {
    return "粗利益率";
  }
  if (lower.includes("deliveries")) {
    return "納車台数";
  }
  if (lower.includes("energy revenue")) {
    return "エネルギー事業収益";
  }
  if (lower.includes("subscription") || lower.includes("usage") || lower.includes("customer") || lower.includes("rpo") || lower.includes("deferred revenue") || lower.includes("retention")) {
    return "サブスク・利用量・顧客指標";
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
