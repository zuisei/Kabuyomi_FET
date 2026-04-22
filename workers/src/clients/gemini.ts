import type { Env, SummaryRecord } from "../env";
import { logEvent } from "../lib/logging";
import { localChatFallback, localSummaryFallback, recoverBroaderFallbackIfNeeded } from "./gemini/fallback";
import {
  normalizeChatResponse,
  normalizeQuoteTranslationResponse,
  normalizeSummaryResponse,
  polishJapaneseText,
  stripAnswerFormattingArtifacts,
  stripEnglishParentheticals,
  isRecord
} from "./gemini/normalize";
import { buildChatPrompt, buildQuoteTranslationPrompt, buildSummaryPrompt } from "./gemini/prompts";
import { invokeGemini, resolveGeminiTranslationModel } from "./gemini/request";
import type { ChatPromptInput, GeminiChatAnswer, QuoteTranslationPromptInput, SummaryPromptInput } from "./gemini/types";

export async function generateSummary(env: Env, input: SummaryPromptInput): Promise<SummaryRecord> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "missing_api_key" });
    return localSummaryFallback(input);
  }

  let response: unknown;
  try {
    response = await invokeGemini(env, buildSummaryPrompt(input), "summary");
  } catch {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "request_failed" });
    return localSummaryFallback(input);
  }

  const normalized = normalizeSummaryResponse(response);
  if (!normalized) {
    logSchemaMismatch("summary", response);
    logEvent("gemini_fallback_used", { kind: "summary", reason: "schema_validation_failed" });
    return localSummaryFallback(input);
  }

  return {
    verdict: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.verdict))),
    highlights: normalized.highlights.map((line) => ({
      ...line,
      text: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(line.text)))
    })),
    changes: normalized.changes.map((line) => ({
      ...line,
      text: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(line.text)))
    }))
  };
}

export async function generateChatAnswer(env: Env, input: ChatPromptInput): Promise<GeminiChatAnswer> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "missing_api_key" });
    return localChatFallback(input);
  }

  let response: unknown;
  try {
    response = await invokeGemini(env, buildChatPrompt(input), "chat");
  } catch {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "request_failed" });
    return localChatFallback(input);
  }

  const normalized = normalizeChatResponse(response);
  if (!normalized) {
    logSchemaMismatch("chat", response);
    logEvent("gemini_fallback_used", { kind: "chat", reason: "schema_validation_failed" });
    return localChatFallback(input);
  }

  const recovered = recoverBroaderFallbackIfNeeded(input, {
    answer: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.answer))),
    sourceIds: normalized.sourceIds,
    usedRemoteModel: normalized.usedRemoteModel
  });

  if (shouldRecoverLowQualityChatAnswer(input, recovered.answer)) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "low_quality_answer" });
    return localChatFallback(input);
  }

  return recovered;
}

export async function generateQuoteTranslation(
  env: Env,
  input: QuoteTranslationPromptInput
): Promise<{ translatedText: string; modelName: string }> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is missing");
  }

  const response = await invokeGemini(env, buildQuoteTranslationPrompt(input), "quote_translation");
  const translatedText = normalizeQuoteTranslationResponse(response);

  if (!translatedText) {
    logSchemaMismatch("quote_translation", response);
    throw new Error("Quote translation schema validation failed");
  }

  return {
    translatedText,
    modelName: resolveGeminiTranslationModel(env)
  };
}

function logSchemaMismatch(kind: "summary" | "chat" | "quote_translation", payload: unknown) {
  logEvent("gemini_schema_mismatch", {
    kind,
    keys: isRecord(payload) ? Object.keys(payload).slice(0, 12) : [],
    payloadType: Array.isArray(payload) ? "array" : typeof payload
  });
}

function shouldRecoverLowQualityChatAnswer(input: ChatPromptInput, answer: string): boolean {
  const normalizedQuestion = input.question.toLowerCase();
  const normalizedAnswer = answer.toLowerCase();
  const asksProfitCause =
    /(赤字|黒字|損失|欠損|純利益|利益|net income|net loss|profit|income|earnings|loss)/.test(normalizedQuestion) &&
    /(主因|要因|原因|理由|なぜ|背景|何が|driver|cause|why)/.test(normalizedQuestion);
  const asksBroadStockContext =
    /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
      normalizedQuestion
    ) ||
    (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalizedQuestion) &&
      /(株|株価|市場|stock|share)/.test(normalizedQuestion));

  const asksAboutFilingStructure =
    /(item|md&a|risk factors|form 10-q|form 10-k|項目|どこ|どの欄|section|パート)/.test(normalizedQuestion);
  const asksContextualReasoning =
    /(ガイダンス|見通し|予想|guidance|outlook|来期|次四半期|リスク|懸念|逆風|不確実|不透明|risk|uncertain|uncertainty|関税|tariff|還元|自社株買い|buyback|repurchase|配当|dividend|株主還元|キャッシュフロー|cash flow|株価|市場|反応|支え|押し上げ|牽引|主因|要因|原因|理由|なぜ)/.test(
      normalizedQuestion
    );

  if (
    !asksAboutFilingStructure &&
    /(management's discussion|results of operations|our business risks|forward-looking statements|investors are cautioned|available information|investor relations website|corporate website|private securities litigation reform act|item\s+\d+[a-z]?\.|form 10-q|form 10-k)/.test(
      normalizedAnswer
    )
  ) {
    return true;
  }

  if (asksBroadStockContext) {
    const mentionsStockContext =
      /(株価|市場|反応|ニュース|別情報|判断できません|決められません|断定できません|株の調子|market|stock|share)/.test(
        normalizedAnswer
      );
    const leansOnMetricsOnly =
      /(売上高|営業利益|純利益|前年比|前年同期比|revenue|operating income|net income)/.test(normalizedAnswer);

    if (leansOnMetricsOnly && !mentionsStockContext) {
      return true;
    }
  }

  if (asksProfitCause) {
    const mentionsProfitContext = /(純利益|赤字|黒字|損失|net income|net loss|profit|loss)/.test(normalizedAnswer);
    const leansOnRevenue = /(売上高|revenue|sales)/.test(normalizedAnswer);
    const leansOnBoilerplate =
      /(一般的な注意書き|案内文|この論点の深掘りには向きません|この決算資料だけでは|この filing だけでは)/.test(
        normalizedAnswer
      );

    if ((leansOnRevenue || leansOnBoilerplate) && !mentionsProfitContext) {
      return true;
    }
  }

  if (asksContextualReasoning) {
    const answerLooksMetricOnly =
      /(売上高|営業利益|純利益|営業cf|キャッシュフロー|前年比|前年同期比|revenue|operating income|net income|cash flow)/.test(
        normalizedAnswer
      ) &&
      !/(本文|提出資料|決算資料|外部補足|この決算資料だけでは|この決算資料以外|この filing だけでは|この filing 以外|断定できません|切り分け|会社見通し|リスク|不確実|需要|iPhone|サービス|自社株買い|配当|株価|市場|反応|安全です)/.test(
        normalizedAnswer
      );

    if (answerLooksMetricOnly) {
      return true;
    }
  }

  const latinCount = (answer.match(/[A-Za-z]/g) ?? []).length;
  const japaneseCount = (answer.match(/[ぁ-んァ-ヶ一-龠]/g) ?? []).length;
  return !asksAboutFilingStructure && latinCount >= 40 && japaneseCount <= 12;
}
