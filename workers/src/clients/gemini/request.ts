import type { Env } from "../../env";
import { logEvent } from "../../lib/logging";
import { parseJsonishText } from "./normalize";
import { chatResponseJsonSchema, quoteTranslationResponseJsonSchema, summaryResponseJsonSchema } from "./prompts";

export const DEFAULT_GEMINI_MODEL = "gemma-4-31b-it";
export const DEFAULT_GEMINI_TRANSLATION_MODEL = "gemma-4-26b-a4b-it";
const DEFAULT_GEMINI_TIMEOUT_MS = 12_000;
const RETRYABLE_GEMINI_STATUS_CODES = new Set([429, 500, 503, 504]);
const SUMMARY_GENERATION_CONFIG = {
  temperature: 0.2,
  candidateCount: 1,
  responseMimeType: "application/json"
};
const QUOTE_TRANSLATION_GENERATION_CONFIG = {
  temperature: 0.1,
  candidateCount: 1,
  responseMimeType: "application/json"
};
const CHAT_GENERATION_CONFIG = {
  temperature: 0,
  topP: 0.1,
  topK: 1,
  candidateCount: 1,
  responseMimeType: "application/json"
};

export async function invokeGemini(
  env: Env,
  prompt: string,
  kind: "summary" | "chat" | "quote_translation"
): Promise<unknown> {
  const model = kind === "quote_translation" ? resolveGeminiTranslationModel(env) : resolveGeminiModel(env);
  const timeoutMs = resolveGeminiTimeoutMs(env);
  const responseJsonSchema =
    kind === "summary"
      ? summaryResponseJsonSchema()
      : kind === "chat"
        ? chatResponseJsonSchema()
        : quoteTranslationResponseJsonSchema();
  const translationFallbackModel = kind === "quote_translation" ? resolveGeminiTranslationFallbackModel(env) : null;
  const attempts = kind === "summary"
    ? [
        {
          model,
          includeSchema: true,
          generationConfig: { ...SUMMARY_GENERATION_CONFIG, responseJsonSchema }
        }
      ]
    : kind === "quote_translation"
      ? [
          {
            model,
            includeSchema: true,
            generationConfig: { ...QUOTE_TRANSLATION_GENERATION_CONFIG, responseJsonSchema }
          },
          { model, includeSchema: false, generationConfig: QUOTE_TRANSLATION_GENERATION_CONFIG },
          ...(translationFallbackModel
            ? [
                {
                  model: translationFallbackModel,
                  includeSchema: false,
                  generationConfig: QUOTE_TRANSLATION_GENERATION_CONFIG
                }
              ]
            : [])
        ]
    : [
        {
          model,
          includeSchema: true,
          generationConfig: { ...CHAT_GENERATION_CONFIG, responseJsonSchema }
        },
        { model, includeSchema: false, generationConfig: CHAT_GENERATION_CONFIG }
      ];

  for (const [index, attempt] of attempts.entries()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY ?? ""
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: attempt.generationConfig
          }),
          signal: controller.signal
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      const timedOut =
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof DOMException && error.name === "AbortError");
      logEvent("gemini_request_failed", {
        kind,
        model: attempt.model,
        includeSchema: attempt.includeSchema,
        timeoutMs,
        reason: timedOut ? "timeout" : "network_error"
      });
      if (attempts[index + 1]) {
        await waitBeforeGeminiRetry(index);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyPreview = (await response.text()).slice(0, 240);
      logEvent("gemini_request_failed", {
        kind,
        model: attempt.model,
        status: response.status,
        includeSchema: attempt.includeSchema,
        bodyPreview
      });
      if (attempts[index + 1] && (attempt.includeSchema || RETRYABLE_GEMINI_STATUS_CODES.has(response.status))) {
        await waitBeforeGeminiRetry(index);
        continue;
      }
      throw new Error(`Gemini request failed (${response.status})`);
    }

    logEvent("gemini_request_succeeded", {
      kind,
      model: attempt.model,
      status: response.status,
      includeSchema: attempt.includeSchema
    });

    const payload = await response.json<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>();
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    logEvent("gemini_response_preview", {
      kind,
      model: attempt.model,
      includeSchema: attempt.includeSchema,
      textPreview: text.slice(0, 240)
    });

    try {
      return parseJsonishText(text);
    } catch {
      logEvent("gemini_invalid_response", { kind, includeSchema: attempt.includeSchema });
      if (attempt.includeSchema && attempts[index + 1]) {
        continue;
      }
      return {};
    }
  }

  return {};
}

export function resolveGeminiModel(env: Env): string {
  const raw = env.GEMINI_MODEL?.trim();
  if (!raw) {
    return DEFAULT_GEMINI_MODEL;
  }

  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

export function resolveGeminiTranslationModel(env: Env): string {
  const raw = env.GEMINI_TRANSLATION_MODEL?.trim();
  if (!raw) {
    return DEFAULT_GEMINI_TRANSLATION_MODEL;
  }

  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function resolveGeminiTranslationFallbackModel(env: Env): string | null {
  const fallback = resolveGeminiModel(env);
  const primary = resolveGeminiTranslationModel(env);
  return fallback == primary ? null : fallback;
}

function resolveGeminiTimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.GEMINI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GEMINI_TIMEOUT_MS;
}

async function waitBeforeGeminiRetry(attemptIndex: number) {
  const delayMs = Math.min(250 * (attemptIndex + 1), 750);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
