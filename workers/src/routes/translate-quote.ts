import { generateQuoteTranslation } from "../clients/gemini";
import { TranslateQuoteRequestSchema } from "../lib/contracts";
import { consumeBillableCredits, refundBillableCredits, type CreditChargeResult } from "../lib/credit-operation";
import { logLlmUsage } from "../lib/llm-usage";
import { logErrorEvent, logEvent } from "../lib/logging";
import { isCreditBillingEnabledForIdentity } from "../lib/remote-config";
import { InsufficientCreditsError, readQuotaIdentity } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json, unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

const TRANSLATE_QUOTE_PAYLOAD_MAX_BYTES = 4_096;
const QUOTE_TRANSLATION_CREDIT_COST = 1;

export const handleTranslateQuoteRoute: RouteHandler = async ({ request, url, env, config }) => {
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
  const creditBillingEnabled = isCreditBillingEnabledForIdentity(config, identity);
  const operationId = payload.operationId || crypto.randomUUID();
  let creditCharge: CreditChargeResult | undefined;

  if (creditBillingEnabled) {
    try {
      creditCharge = await consumeBillableCredits({
        identity,
        env,
        config,
        operationId,
        creditsRequired: QUOTE_TRANSLATION_CREDIT_COST,
        reference: {
          type: "quote_translation",
          id: "source_preview"
        }
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        return json(
          {
            error: "insufficient_credits",
            creditsRequired: error.creditsRequired,
            creditsRemaining: error.creditsRemaining
          },
          { status: 402 }
        );
      }
      throw error;
    }
  }

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
      modelName: translation.modelName,
      usage: creditCharge?.usage,
      creditsCharged: creditCharge?.creditsCharged ?? 0,
      creditsRemaining: creditCharge?.creditsRemaining
    });
  } catch (error) {
    if (creditBillingEnabled && creditCharge) {
      try {
        await refundBillableCredits({
          identity,
          env,
          config,
          charge: creditCharge,
          reference: {
            type: "quote_translation",
            id: "source_preview"
          }
        });
      } catch (refundError) {
        logErrorEvent("quote_translation_refund_failed", {
          quotaSubject: identity.quotaSubject,
          operationId,
          reason: refundError instanceof Error ? refundError.message : String(refundError)
        });
      }
    }

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
