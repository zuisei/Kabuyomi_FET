import type { Env, SummaryRecord } from "../../env";
import { logEvent } from "../../lib/logging";
import { generateQuoteTranslation as generateGeminiQuoteTranslation, generateSummary as generateGeminiSummary } from "../gemini";
import { localSummaryFallback } from "../gemini/fallback-summary";
import { buildQuoteTranslationPrompt, buildSummaryPrompt } from "../gemini/prompts";
import {
  normalizeQuoteTranslationResponse,
  normalizeSummaryResponse,
  polishJapaneseText,
  stripAnswerFormattingArtifacts,
  stripEnglishParentheticals
} from "../gemini/normalize";
import type {
  ChatPromptInput,
  GeminiChatAnswer,
  GeminiInvocationUsage,
  QuoteTranslationPromptInput,
  SummaryPromptInput
} from "../gemini/types";
import {
  generateDisabledProviderFallback,
  generateGeminiLegacyChatAnswer
} from "./providers/gemini-legacy";
import {
  classifyOpenAIError,
  generateOpenAIChatAnswer,
  invokeOpenAIQuoteTranslation,
  invokeOpenAISummary,
  resolveOpenAIChatModel
} from "./providers/openai";
import type { LlmProviderName } from "./types";

export type SummaryProviderName = "gemini" | "openai" | "fallback";

export interface ModelSummaryResult {
  summary: SummaryRecord;
  provider: SummaryProviderName;
  llmUsage?: GeminiInvocationUsage[];
}

export function resolveLlmProvider(env: Env): LlmProviderName {
  const raw = env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === "openai" || raw === "disabled" || raw === "gemini-legacy") {
    return raw;
  }
  if (raw === "gemini") {
    return "gemini-legacy";
  }
  return raw ? "disabled" : "gemini-legacy";
}

export async function generateModelChatAnswer(env: Env, input: ChatPromptInput): Promise<GeminiChatAnswer> {
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return generateOpenAIChatAnswer(env, input);
  }
  if (provider === "disabled") {
    return generateDisabledProviderFallback(input);
  }
  return generateGeminiLegacyChatAnswer(env, input);
}

export function isQuoteTranslationAvailable(env: Env): boolean {
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return Boolean(env.OPENAI_API_KEY);
  }
  if (provider === "disabled") {
    return false;
  }
  return Boolean(env.GEMINI_API_KEY);
}

/// 要約が実際に生成できる構成かどうか。差し替え(upgrade)を回すかの判定に使う。
/// `isQuoteTranslationAvailable` と同じ形で、プロバイダごとに必要な鍵を見る。
export function isModelSummaryAvailable(env: Env): boolean {
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return Boolean(env.OPENAI_API_KEY?.trim());
  }
  if (provider === "disabled") {
    return false;
  }
  return Boolean(env.GEMINI_API_KEY?.trim());
}

/// 決算要約の生成をプロバイダごとに振り分ける。
/// 失敗しても例外は投げず、必ずローカルのテンプレート要約に落として返す。
/// `forceFallback` は初回取り込みでテンプレートを即返す用途(`summaryMode: "fallback_only"`)。
export async function generateModelSummary(
  env: Env,
  input: SummaryPromptInput,
  options: { forceFallback?: boolean } = {}
): Promise<ModelSummaryResult> {
  if (options.forceFallback) {
    return { summary: localSummaryFallback(input), provider: "fallback" };
  }

  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return generateOpenAISummary(env, input);
  }
  if (provider === "disabled") {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "provider_disabled" });
    return { summary: localSummaryFallback(input), provider: "fallback" };
  }
  return generateGeminiSummary(env, input);
}

const OPENAI_SUMMARY_MAX_ATTEMPTS = 2;

async function generateOpenAISummary(env: Env, input: SummaryPromptInput): Promise<ModelSummaryResult> {
  if (!env.OPENAI_API_KEY?.trim()) {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "missing_api_key" });
    return { summary: localSummaryFallback(input), provider: "fallback" };
  }

  const basePrompt = buildSummaryPrompt(input);
  const usages: GeminiInvocationUsage[] = [];

  for (let attempt = 0; attempt < OPENAI_SUMMARY_MAX_ATTEMPTS; attempt += 1) {
    let invocation: Awaited<ReturnType<typeof invokeOpenAISummary>>;
    try {
      invocation = await invokeOpenAISummary(env, attempt === 0 ? basePrompt : retrySummaryPrompt(basePrompt));
    } catch (error) {
      const diagnostics = classifyOpenAIError(error);
      logEvent("gemini_fallback_used", {
        kind: "summary",
        reason: "request_failed",
        attempt,
        errorKind: diagnostics.modelApiErrorKind,
        retryable: diagnostics.modelApiErrorRetryable
      });
      // 再試行しても意味がない失敗(認証エラー等)はここで打ち切る。
      if (!diagnostics.modelApiErrorRetryable) {
        break;
      }
      continue;
    }

    usages.push(...invocation.usage);
    const normalized = normalizeSummaryResponse(invocation.data);
    if (!normalized) {
      logEvent("gemini_fallback_used", {
        kind: "summary",
        reason: "schema_validation_failed",
        attempt,
        failureReason: invocation.failureReason ?? null
      });
      continue;
    }

    return {
      summary: polishSummaryRecord(normalized),
      provider: "openai",
      ...(usages.length > 0 ? { llmUsage: usages } : {})
    };
  }

  return {
    summary: localSummaryFallback(input),
    provider: "fallback",
    ...(usages.length > 0 ? { llmUsage: usages } : {})
  };
}

/// 1回目がスキーマ不一致で落ちたときだけ使う。要求する形をより明示して投げ直す。
function retrySummaryPrompt(basePrompt: string): string {
  return [
    basePrompt,
    "",
    "The previous response did not match the required JSON schema.",
    "Return a single JSON object with exactly these keys: verdict (string), highlights (array), changes (array).",
    "Each element of highlights and changes must be an object with keys text (string) and sourceIds (array of strings).",
    "Do not wrap the JSON in markdown fences and do not add any other key."
  ].join("\n");
}

function polishSummaryRecord(record: SummaryRecord): SummaryRecord {
  return {
    verdict: polishSummaryText(record.verdict),
    highlights: record.highlights.map((line) => ({ ...line, text: polishSummaryText(line.text) })),
    changes: record.changes.map((line) => ({ ...line, text: polishSummaryText(line.text) }))
  };
}

function polishSummaryText(text: string): string {
  return stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(text)));
}

export async function generateModelQuoteTranslation(
  env: Env,
  input: QuoteTranslationPromptInput
): Promise<{ translatedText: string; modelName: string; providerName: LlmProviderName; llmUsage?: GeminiInvocationUsage[] }> {
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return generateOpenAIQuoteTranslation(env, input);
  }
  if (provider === "disabled") {
    throw new Error("Quote translation provider is disabled");
  }
  const result = await generateGeminiQuoteTranslation(env, input);
  return {
    ...result,
    providerName: "gemini-legacy"
  };
}

async function generateOpenAIQuoteTranslation(
  env: Env,
  input: QuoteTranslationPromptInput
): Promise<{ translatedText: string; modelName: string; providerName: "openai"; llmUsage?: GeminiInvocationUsage[] }> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key is missing");
  }

  const exactTerms = exactTermsToPreserve(input.text);
  const usages: GeminiInvocationUsage[] = [];
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const invocation = await invokeOpenAIQuoteTranslation(
      env,
      buildOpenAIQuoteTranslationPrompt(input, {
        attempt,
        exactTerms,
        previousError: lastError?.message
      })
    );
    usages.push(...invocation.usage);
    const translatedText = normalizeQuoteTranslationResponse(invocation.data);
    if (!translatedText) {
      lastError = new Error(invocation.failureReason ?? "Quote translation schema validation failed");
      continue;
    }

    try {
      const guarded = guardQuoteTranslation(translatedText, input.text, exactTerms);
      return {
        translatedText: guarded,
        modelName: resolveOpenAIChatModel(env),
        providerName: "openai",
        ...(usages.length > 0 ? { llmUsage: usages } : {})
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Quote translation failed");
}

function buildOpenAIQuoteTranslationPrompt(
  input: QuoteTranslationPromptInput,
  options: { attempt?: number; exactTerms?: string[]; previousError?: string } = {}
): string {
  const lines = [
    buildQuoteTranslationPrompt(input),
    "",
    "Additional Kabuyomi v1 guardrails:",
    "- Output Japanese only, except unavoidable company names, ticker symbols, product names, filing terms, numbers, percentages, and dates.",
    "- Copy company names, acronyms, ticker symbols, and official program/product names exactly as they appear in the source. Do not guess or autocorrect them.",
    "- Do not include investment advice, buy/sell recommendations, forecasts, target prices, or extra analysis.",
    "- If the excerpt is too long or unclear, return a concise faithful Japanese translation of only the supplied excerpt.",
    "- Return no raw internal wording, debug text, markdown, or source labels."
  ];

  if (options.exactTerms && options.exactTerms.length > 0) {
    lines.push("", "These source terms must appear exactly unchanged in translatedText:", options.exactTerms.join(", "));
  }
  if ((options.attempt ?? 0) > 0) {
    lines.push(
      "",
      "Retry instruction:",
      `The previous translation was rejected: ${options.previousError ?? "quality guard failed"}.`,
      "Return a corrected JSON response. Preserve every required source term exactly."
    );
  }

  return lines.join("\n");
}

function guardQuoteTranslation(translatedText: string, sourceText: string, exactTerms: string[]): string {
  const cleaned = repairResidualEnglishTerms(polishJapaneseText(stripAnswerFormattingArtifacts(translatedText)));
  if (!containsJapanese(cleaned)) {
    throw new Error("Quote translation did not produce Japanese text");
  }
  if (cleaned.trim() === sourceText.trim()) {
    throw new Error("Quote translation returned unchanged text");
  }
  if (containsInvestmentAdvice(cleaned)) {
    throw new Error("Quote translation introduced investment advice");
  }
  const missingTerm = exactTerms.find((term) => !cleaned.includes(term));
  if (missingTerm) {
    throw new Error(`Quote translation changed required source term: ${missingTerm}`);
  }
  const leakedTerm = leakedOrdinaryEnglishTerm(cleaned, exactTerms);
  if (leakedTerm) {
    throw new Error(`Quote translation leaked ordinary English term: ${leakedTerm}`);
  }
  return cleaned;
}

function containsJapanese(text: string): boolean {
  return /[ぁ-んァ-ヶ一-龠]/.test(text);
}

function containsInvestmentAdvice(text: string): boolean {
  return /(?:株|銘柄|証券|投資).{0,12}(?:買い|売り|購入|売却|推奨)|(?:買い|売り)(?:推奨|判断|シグナル)|(?:買う|売る)べき|投資判断|目標株価|株価予想|\b(?:buy|sell|target price|forecast)\b/i.test(text);
}

function repairResidualEnglishTerms(text: string): string {
  return text
    .replace(/\bcustomers\b/gi, "顧客")
    .replace(/\bcustomer\b/gi, "顧客")
    .replace(/\bproducts\b/gi, "製品")
    .replace(/\bproduct\b/gi, "製品")
    .replace(/\brevenue\b/gi, "売上高")
    .replace(/\bincome\b/gi, "利益")
    .replace(/\boperations\b/gi, "事業")
    .replace(/\boperation\b/gi, "事業");
}

function leakedOrdinaryEnglishTerm(text: string, exactTerms: string[]): string | null {
  let normalized = text;
  for (const term of exactTerms) {
    normalized = normalized.replaceAll(term, "");
  }
  const leaked = normalized.match(
    /\b(customers?|products?|revenues?|income|operations?|increased|decreased|year|over|due|higher|lower|demand|composed|generation|transmission|distribution|electricity|approximately|million|central|southern|southwestern)\b/i
  );
  return leaked?.[0] ?? null;
}

function exactTermsToPreserve(sourceText: string): string[] {
  const terms = new Set<string>();
  const normalized = sourceText.replace(/\s+/g, " ").trim();

  for (const match of normalized.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,5}\b/g)) {
    const term = match[0].trim();
    if (isPreservableProperNoun(term)) {
      terms.add(term);
    }
  }

  for (const match of normalized.matchAll(/\b[A-Z][A-Z&.-]{1,7}\b/g)) {
    const term = match[0].trim();
    if (!COMMON_UPPERCASE_WORDS.has(term)) {
      terms.add(term);
    }
  }

  return Array.from(terms).slice(0, 8);
}

function isPreservableProperNoun(term: string): boolean {
  const lowered = term.toLowerCase();
  if (COMMON_TITLE_CASE_PHRASES.has(lowered)) {
    return false;
  }
  return /\b(Inc|Corp|Corporation|Company|Energy|Technologies|Systems|International|Holdings|Group|Bank|Financial|South|North|East|West)\b/.test(term);
}

const COMMON_TITLE_CASE_PHRASES = new Set([
  "united states",
  "south carolina",
  "north carolina",
  "new york",
  "cash and cash equivalents",
  "management discussion and analysis"
]);

const COMMON_UPPERCASE_WORDS = new Set([
  "DOMINION",
  "ENERGY",
  "SOUTH",
  "CAROLINA",
  "UNITED",
  "STATES",
  "SEC",
  "MD",
  "AND",
  "THE"
]);
