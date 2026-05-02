import type { Env, FilingCacheRecord } from "../../env";
import type { ChatFallbackKind } from "../../clients/gemini/types";
import type { RemoteConfig } from "../remote-config";
import {
  buildJapaneseLanguageGuardFallback,
  checkFinalAnswerJapaneseOnly
} from "./final-answer-language";
import { attachChatDebug } from "./response-payload";
import {
  attachCurrentFilingSourceUrls,
  ensureFilingGroundedResponse,
  type ChatResponseDebug,
  type ChatResponsePayload,
  type ChatResponsePath
} from "./grounding";
import type { ChatTimingTracker } from "./timing";
import { maybeAppendWebSupplement } from "./web-supplement";
import { hasBannedPhrase } from "./evidence-fallback";

type ChatResponseDebugInput = Omit<ChatResponseDebug, "sourceCount" | "sourceIds">;

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
  const uxCleanedAnswer = cleanAnswerForQuestion(responseWithUrls.answer, responsePath, normalizedFallbackKind, question, debug.questionIntent);
  const originalAnswerBeforeLanguageGuard = uxCleanedAnswer;
  const languageCheck = checkFinalAnswerJapaneseOnly(uxCleanedAnswer);
  const bannedPhraseDetected = hasBannedPhrase(uxCleanedAnswer);
  const bannedPhraseCleanedAnswer = languageCheck.ok && bannedPhraseDetected
    ? cleanBannedFinalAnswer(uxCleanedAnswer, debug.questionIntent)
    : uxCleanedAnswer;
  const bannedPhraseStillDetected = languageCheck.ok && hasBannedPhrase(bannedPhraseCleanedAnswer);
  const finalAnswerSafe = languageCheck.ok && !bannedPhraseStillDetected;
  const languageSafeAnswer = finalAnswerSafe
    ? bannedPhraseCleanedAnswer
    : buildJapaneseLanguageGuardFallback({
      question,
      questionIntent: debug.questionIntent,
      fallbackKind: normalizedFallbackKind,
      missingSourceTypes: debug.sourceGateMissingSourceTypes
    });
  const sanitizedLanguageSafeAnswer = sanitizeFinalUserFacingAnswer(languageSafeAnswer);
  const finalResponsePath = finalAnswerSafe ? responsePath : "fallback";
  const finalFallbackKind: ChatFallbackKind = finalAnswerSafe
    ? normalizedFallbackKind
    : "language_guard_fallback";
  const responsePathFallbackButKindNone = finalResponsePath === "fallback" && finalFallbackKind === "none";
  const finalAnswerLanguageLabels = finalAnswerSafe ? [] : [
    ...languageCheck.labels,
    ...(bannedPhraseStillDetected ? ["generic_fallback_phrase"] : []),
    "answer_rewritten_to_japanese_fallback"
  ];

  return attachChatDebug(
    {
      ...responseWithUrls,
      answer: sanitizedLanguageSafeAnswer,
      responsePath: finalResponsePath
    },
    {
      ...debug,
      responsePath: finalResponsePath,
      fallbackReason: finalAnswerSafe ? debug.fallbackReason : debug.fallbackReason ?? "low_quality_answer",
      fallbackKind: responsePathFallbackButKindNone ? "unknown_fallback" : finalFallbackKind,
      fallbackKindSource: finalAnswerSafe ? debug.fallbackKindSource ?? "finalizer" : "language_guard",
      responsePathFallbackButKindNone,
      finalAnswerJapaneseRatio: languageCheck.japaneseRatio,
      finalAnswerEnglishSentenceCount: languageCheck.englishSentenceCount,
      finalAnswerRawExcerptLike: languageCheck.rawExcerptLike,
      finalAnswerLanguageLabels,
      finalAnswerLanguageViolations: languageCheck.violations,
      languageGuardChecked: true,
      languageGuardOk: finalAnswerSafe,
      languageGuardViolationLabels: finalAnswerLanguageLabels,
      languageGuardFallbackUsed: !finalAnswerSafe,
      languageGuardFallbackKind: finalAnswerSafe ? null : "language_guard_fallback",
      originalAnswerBeforeLanguageGuardLength: finalAnswerSafe ? null : originalAnswerBeforeLanguageGuard.length,
      originalAnswerBeforeLanguageGuardSample: finalAnswerSafe
        ? null
        : sampleUnsafeAnswer(originalAnswerBeforeLanguageGuard),
      genericFallbackPhraseDetected: bannedPhraseStillDetected,
      ...timings.snapshot()
    }
  );
}

const BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK = "事業内容や収益源は、選択されたsourceだけでは十分に特定できません。確認すべきsourceは事業内容、セグメント情報、売上注記、経営陣による業績説明の事業説明です。売上高だけでは、この会社が何で儲けているかは判断しません。";

function cleanAnswerForQuestion(
  answer: string,
  responsePath: ChatResponsePath,
  fallbackKind: ChatFallbackKind,
  question: string,
  questionIntent?: string | null
): string {
  const normalizedAnswer = sanitizeFinalUserFacingAnswer(answer);
  if (isLiquidityDebtQuestion(question, questionIntent)) {
    return cleanLiquidityDebtAnswer(normalizedAnswer);
  }
  if (isWatchPointsQuestion(question, questionIntent)) {
    return cleanWatchPointsAnswer(normalizedAnswer);
  }
  if (isBusinessModelQuestion(question, questionIntent)) {
    return cleanBusinessModelAnswer(normalizedAnswer, responsePath, fallbackKind);
  }
  return normalizedAnswer;
}

const LIQUIDITY_DEBT_SOURCE_INSUFFICIENT_FALLBACK = "選択されたsourceだけでは、資金繰りや負債の懸念を直接判断するには不足しています。確認すべきsourceは、キャッシュフロー計算書、流動性の説明、負債の注記、借入枠、満期スケジュールです。現時点では、一般的なリスク要因だけから資金繰りの悪化を断定しません。";

function sanitizeFinalUserFacingAnswer(answer: string): string {
  return normalizeFallbackSourceLabels(normalizeAwkwardModelLanguage(answer));
}

function normalizeAwkwardModelLanguage(answer: string): string {
  return answer
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
    .replace(/前年同[0-9.,?，]+/g, "前年同期の比較値")
    .replace(/\bgovernment\b/gi, "政府")
    .replace(/\bacquisitions?\b/gi, "買収")
    .replace(/\brepurchase(?:d|s)?\b/gi, "買い戻し")
    .replace(/\bexpenditures?\b/gi, "支出")
    .replace(/\bNI\b/g, "純利益")
    .replace(/\bCash flow\b/g, "キャッシュフロー")
    .replace(/\bcash flow\b/g, "キャッシュフロー");
}

function normalizeFallbackSourceLabels(answer: string): string {
  return answer
    .replace(/\bMD&A risk discussion\b/gi, "MD&Aのリスク説明")
    .replace(/\bMD&A business discussion\b/gi, "経営陣による業績説明の事業説明")
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
    .replace(/\bMD&A\b(?!の)/g, "経営陣による業績説明");
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

function cleanLiquidityDebtAnswer(answer: string): string {
  const hasLiquidityEvidence = /(cash|キャッシュ|現金|資金|liquidity|流動性|debt|負債|債務|借入|credit facility|信用枠|revolver|社債|maturit|満期|leverage|レバレッジ|deposit|預金|capital ratio|自己資本|operating cash flow|営業キャッシュフロー|キャッシュフロー)/i.test(answer);
  const genericRiskShape = /(主要リスク|リスク要因|規制|競争|顧客|データ|市場環境|サプライチェーン)/.test(answer) &&
    !/(cash|キャッシュ|現金|資金|liquidity|流動性|debt|負債|債務|借入|credit facility|信用枠|maturit|満期|leverage|レバレッジ|deposit|預金|capital ratio|自己資本|operating cash flow|営業キャッシュフロー|キャッシュフロー)/i.test(answer);
  const riskSummaryLead = /^主要リスク/.test(answer.trim()) &&
    /(規制|競争|顧客|データ|市場環境|サプライチェーン|リスク要因)/.test(answer) &&
    !/(現金|借入残高|負債残高|満期スケジュール|借入枠|信用枠|キャッシュフロー計算書|営業キャッシュフロー|預金|自己資本比率)/.test(answer);

  if (genericRiskShape || riskSummaryLead || !hasLiquidityEvidence) {
    return LIQUIDITY_DEBT_SOURCE_INSUFFICIENT_FALLBACK;
  }
  return answer;
}

function isWatchPointsQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "watch_points") {
    return true;
  }
  return /(次回決算|次に見る|見るべき|ポイント|watchpoints?|nextquarter|nextfiling)/i.test(question.replace(/\s+/g, ""));
}

function cleanWatchPointsAnswer(answer: string): string {
  if (!isGenericWatchPointsAnswer(answer)) {
    return answer;
  }
  return "選択されたsourceだけでは、次回決算で見るべき会社固有のポイントを3つに絞るには不足しています。確認すべきsourceは、経営陣による業績説明、セグメント実績、売上説明、利益率・採算性の説明、キャッシュフロー・流動性です。一般的な売上・利益・コストだけでは、この会社固有の注目点とは判断しません。";
}

function isGenericWatchPointsAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const genericItems = ["売上高", "営業利益", "利益率", "純利益", "コスト構造", "キャッシュフロー", "支出の動向", "財務健全性"].filter((item) => normalized.includes(item)).length;
  const hasMalformedMetric = /[0-9]{1,3}(?:,[0-9]{3})+\s*USD|前年同期の比較値|\?/.test(answer);
  const specificSignals = /(segment|セグメント|顧客|製品|地域|価格|数量|受注|backlog|orders|occupancy|NOI|traffic|ticket|commodity|production|Neutron|Electron|RNA|廃棄物|資産運用|医療機器|半導体|診断|Alaris|Medication Management|信用枠|満期|借入|流動性)/i;
  return (genericItems >= 3 && !specificSignals.test(answer)) || (genericItems >= 2 && hasMalformedMetric);
}

function cleanBusinessModelAnswer(answer: string, responsePath: ChatResponsePath, fallbackKind: ChatFallbackKind): string {
  if (
    responsePath === "fallback" &&
    ["api_error", "low_quality", "weak_grounding", "non_hard_model_timeout", "legacy_template", "unknown_fallback"].includes(fallbackKind) &&
    isMetricSnapshotOnly(answer)
  ) {
    return BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK;
  }

  const withoutForbiddenUnits = removeForbiddenCurrencyUnitSentences(answer);
  const withoutMetricSnapshots = removeBusinessModelMetricSnapshotSentences(withoutForbiddenUnits);
  if (!withoutMetricSnapshots.trim()) {
    return BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK;
  }

  if (isMetricHeavyBusinessModelAnswer(withoutMetricSnapshots)) {
    return BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK;
  }

  return withoutMetricSnapshots;
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
    .replace(/利益の動きは、この説明と費用・評価損益・税金の数字を並べると見えてきます。?/g, "利益の動きは、費用・評価損益・税金の内訳確認が必要です。");

  if (/この資料の範囲では確認できません/.test(cleaned)) {
    const replacement = questionIntent === "liquidity_debt"
      ? "debt note や liquidity discussion の追加確認が必要です"
      : "不足しているsource typeの追加確認が必要です";
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
