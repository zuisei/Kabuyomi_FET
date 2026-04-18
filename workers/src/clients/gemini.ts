import type { Env, SummaryRecord } from "../env";
import { logEvent } from "../lib/logging";
import { localChatFallback, localSummaryFallback, recoverBroaderFallbackIfNeeded } from "./gemini/fallback";
import {
  normalizeChatResponse,
  normalizeSummaryResponse,
  polishJapaneseText,
  stripEnglishParentheticals,
  isRecord
} from "./gemini/normalize";
import { buildChatPrompt, buildSummaryPrompt } from "./gemini/prompts";
import { invokeGemini } from "./gemini/request";
import type { ChatPromptInput, GeminiChatAnswer, SummaryPromptInput } from "./gemini/types";

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
    verdict: stripEnglishParentheticals(polishJapaneseText(normalized.verdict)),
    highlights: normalized.highlights.map((line) => ({
      ...line,
      text: stripEnglishParentheticals(polishJapaneseText(line.text))
    })),
    changes: normalized.changes.map((line) => ({
      ...line,
      text: stripEnglishParentheticals(polishJapaneseText(line.text))
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
    answer: stripEnglishParentheticals(polishJapaneseText(normalized.answer)),
    sourceIds: normalized.sourceIds
  });

  if (shouldRecoverLowQualityChatAnswer(input, recovered.answer)) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "low_quality_answer" });
    return localChatFallback(input);
  }

  return recovered;
}

function logSchemaMismatch(kind: "summary" | "chat", payload: unknown) {
  logEvent("gemini_schema_mismatch", {
    kind,
    keys: isRecord(payload) ? Object.keys(payload).slice(0, 12) : [],
    payloadType: Array.isArray(payload) ? "array" : typeof payload
  });
}

function shouldRecoverLowQualityChatAnswer(input: ChatPromptInput, answer: string): boolean {
  const normalizedQuestion = input.question.toLowerCase();
  const normalizedAnswer = answer.toLowerCase();
  const asksBroadStockContext =
    /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
      normalizedQuestion
    ) ||
    (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalizedQuestion) &&
      /(株|株価|市場|stock|share)/.test(normalizedQuestion));

  const asksAboutFilingStructure =
    /(item|md&a|risk factors|form 10-q|form 10-k|項目|どこ|どの欄|section|パート)/.test(normalizedQuestion);

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

  const latinCount = (answer.match(/[A-Za-z]/g) ?? []).length;
  const japaneseCount = (answer.match(/[ぁ-んァ-ヶ一-龠]/g) ?? []).length;
  return !asksAboutFilingStructure && latinCount >= 40 && japaneseCount <= 12;
}
