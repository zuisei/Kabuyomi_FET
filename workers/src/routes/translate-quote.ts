import { generateQuoteTranslation } from "../clients/gemini";
import { TranslateQuoteRequestSchema } from "../lib/contracts";
import { logLlmUsage } from "../lib/llm-usage";
import { logErrorEvent, logEvent } from "../lib/logging";
import { readQuotaIdentity } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json, unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

const TRANSLATE_QUOTE_PAYLOAD_MAX_BYTES = 4_096;

export const handleTranslateQuoteRoute: RouteHandler = async ({ request, url, env }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/translate-quote")) {
    return null;
  }

  const payload = await parseJsonBody(request, TranslateQuoteRequestSchema, {
    invalidMessage: "Invalid quote translation payload",
    maxBytes: TRANSLATE_QUOTE_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Quote translation payload is too large"
  });

  if (!env.GEMINI_API_KEY) {
    return unavailable("Quote translation is temporarily disabled");
  }

  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const startedAt = Date.now();

  try {
    const translation = await generateQuoteTranslation(env, payload);
    logLlmUsage(translation.llmUsage, {
      aiTask: "translation",
      route: "/v1/translate-quote",
      responsePath: "gemini"
    });

    logEvent("quote_translation_request", {
      quotaSubject: identity.quotaSubject,
      identityKind: identity.identityKind,
      targetLanguage: payload.targetLanguage,
      inputLength: payload.text.length,
      latencyMs: Date.now() - startedAt
    });

    return json({
      translatedText: translation.translatedText,
      modelName: translation.modelName
    });
  } catch (error) {
    logErrorEvent("quote_translation_failed", {
      quotaSubject: identity.quotaSubject,
      identityKind: identity.identityKind,
      targetLanguage: payload.targetLanguage,
      inputLength: payload.text.length,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};
