import {
  generateModelQuoteTranslation,
  isQuoteTranslationAvailable,
  resolveLlmProvider
} from "../clients/llm/provider";
import type { Env } from "../env";
import { TranslateQuoteRequestSchema } from "../lib/contracts";
import { logLlmUsage } from "../lib/llm-usage";
import { hashForLog, logErrorEvent, logEvent, suffixForLog } from "../lib/logging";
import {
  beginRequestExecution,
  completeRequestExecution,
  failRequestExecution,
  isQuoteTranslationExecutionResult,
  type RequestExecutionBeginResult,
  type RequestExecutionConfigSnapshot
} from "../lib/request-execution";
import { buildQuoteTranslationRequestHash } from "../lib/request-fingerprint";
import { isCreditBillingEnabledForIdentity, type RemoteConfig } from "../lib/remote-config";
import {
  loadUsage,
  readQuotaIdentity,
  type QuotaIdentity,
  type RequestExecutionReservationOptions
} from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json, serverError, unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

const TRANSLATE_QUOTE_PAYLOAD_MAX_BYTES = 4_096;
const QUOTE_TRANSLATION_CREDIT_COST = 1;
const QUOTE_TRANSLATION_EXECUTION_POLICY_VERSION = "quote-translation-execution-v1";

export const handleTranslateQuoteRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/translate-quote")) {
    return null;
  }

  const payload = await parseJsonBody(request, TranslateQuoteRequestSchema, {
    invalidMessage: "Invalid quote translation payload",
    maxBytes: TRANSLATE_QUOTE_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Quote translation payload is too large"
  });
  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const creditBillingEnabled = isCreditBillingEnabledForIdentity(config, identity);
  const reservation = buildQuoteTranslationReservation(identity);
  const providerAvailable = isQuoteTranslationAvailable(env);
  const requestHash = await buildQuoteTranslationRequestHash({
    text: payload.text,
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    creditCost: QUOTE_TRANSLATION_CREDIT_COST
  });
  const execution = await beginRequestExecution(identity, env, config, {
    operationId: payload.operationId,
    requestHash,
    route: "quote_translation",
    allowCreate: providerAvailable,
    executionPolicyVersion: QUOTE_TRANSLATION_EXECUTION_POLICY_VERSION,
    configSnapshot: buildQuoteTranslationExecutionConfigSnapshot(env, config, creditBillingEnabled),
    reservation
  });

  if (execution.outcome === "not_started") {
    return unavailable("Quote translation is temporarily disabled");
  }
  const executionResponse = nonLeaderExecutionResponse(execution);
  if (executionResponse) {
    return executionResponse;
  }
  if (execution.outcome === "replay") {
    if (!isQuoteTranslationExecutionResult(execution.result)) {
      return serverError("Cached quote translation is unavailable");
    }
    const usage = await loadUsage(identity, env, config);
    return json({
      translatedText: execution.result.translatedText,
      modelName: execution.result.modelName,
      usage: { ...usage, creditBillingEnabled },
      creditsCharged: execution.result.creditsCharged,
      creditsRemaining: usage.credits?.totalRemaining
    });
  }

  if (!providerAvailable) {
    await persistQuoteTranslationFailureSafely(identity, env, {
      operationId: payload.operationId,
      requestHash,
      failureCode: "quote_translation_unavailable",
      failureStatus: 503
    });
    return unavailable("Quote translation is temporarily disabled");
  }

  const startedAt = Date.now();
  try {
    const translation = await generateModelQuoteTranslation(env, payload);
    logLlmUsage(translation.llmUsage, {
      aiTask: "translation",
      route: "/v1/translate-quote",
      responsePath: translation.providerName
    });

    logEvent("quote_translation_request", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      identityKind: identity.identityKind,
      targetLanguage: payload.targetLanguage,
      inputLength: payload.text.length,
      providerName: translation.providerName,
      latencyMs: Date.now() - startedAt
    });

    const cachedCreditsCharged = reservation.mode === "credits" ? QUOTE_TRANSLATION_CREDIT_COST : 0;
    const stableResult: unknown = {
      kind: "quote_translation",
      translatedText: translation.translatedText,
      modelName: translation.modelName,
      creditsCharged: cachedCreditsCharged
    };
    if (!isQuoteTranslationExecutionResult(stableResult)) {
      throw new Error("quote_translation_stable_result_invalid");
    }
    const completion = await completeRequestExecution(identity, env, {
      operationId: payload.operationId,
      requestHash,
      route: "quote_translation",
      resultBody: stableResult,
      resultMetadata: {
        responsePath: translation.providerName,
        modelName: translation.modelName,
        creditsCharged: stableResult.creditsCharged
      },
      chargeable: true
    });
    const usage = await loadUsage(identity, env, config);

    return json({
      translatedText: stableResult.translatedText,
      modelName: stableResult.modelName,
      usage: { ...usage, creditBillingEnabled },
      creditsCharged: completion.creditsCharged,
      creditsRemaining: usage.credits?.totalRemaining
    });
  } catch (error) {
    const failure = classifyQuoteTranslationFailure(error);
    await persistQuoteTranslationFailureSafely(identity, env, {
      operationId: payload.operationId,
      requestHash,
      ...failure
    });

    logErrorEvent("quote_translation_failed", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      identityKind: identity.identityKind,
      targetLanguage: payload.targetLanguage,
      inputLength: payload.text.length,
      errorClass: error instanceof Error ? error.name : typeof error
    });
    throw error;
  }
};

function nonLeaderExecutionResponse(result: RequestExecutionBeginResult): Response | null {
  if (result.outcome === "pending") {
    return json(
      { error: "execution_pending" },
      {
        status: 202,
        headers: { "retry-after": String(result.retryAfterSeconds) }
      }
    );
  }
  if (result.outcome === "payload_mismatch") {
    return json({ error: "operation_id_payload_mismatch" }, { status: 409 });
  }
  if (result.outcome === "result_expired") {
    return json({ error: "operation_result_expired" }, { status: 410 });
  }
  if (result.outcome === "failed") {
    return json(
      {
        error: result.failureCode || "operation_execution_failed",
        ...(result.failureDetails ?? {})
      },
      { status: result.failureStatus || 409 }
    );
  }
  return null;
}

function buildQuoteTranslationExecutionConfigSnapshot(
  env: Env,
  config: RemoteConfig,
  creditBillingEnabled: boolean
): RequestExecutionConfigSnapshot {
  const provider = resolveLlmProvider(env);
  const requestedModelName = provider === "openai" ? env.OPENAI_CHAT_MODEL?.trim() : env.GEMINI_TRANSLATION_MODEL?.trim();
  return {
    creditBillingEnabled,
    llmProvider: provider,
    requestedModelName: requestedModelName || null,
    modelConfigVersion: env.OPENAI_PROMPT_VERSION?.trim() || null,
    routeAvailable: isQuoteTranslationAvailable(env),
    promptVersion: config.promptVersion
  };
}

function classifyQuoteTranslationFailure(error: unknown): {
  failureCode: string;
  failureStatus: number;
  failureDetails?: RequestExecutionConfigSnapshot;
} {
  return {
    failureCode: "quote_translation_failed",
    failureStatus: 500
  };
}

function buildQuoteTranslationReservation(
  identity: QuotaIdentity
): RequestExecutionReservationOptions {
  if (identity.accessMode === "dev_unlimited") {
    return { mode: "unmetered" };
  }
  return {
    mode: "credits",
    creditsRequired: QUOTE_TRANSLATION_CREDIT_COST,
    reference: {
      type: "quote_translation",
      id: "source_preview"
    }
  };
}

async function persistQuoteTranslationFailureSafely(
  identity: QuotaIdentity,
  env: Env,
  options: {
    operationId: string;
    requestHash: string;
    failureCode: string;
    failureStatus: number;
    failureDetails?: RequestExecutionConfigSnapshot;
  }
): Promise<void> {
  try {
    await failRequestExecution(identity, env, {
      ...options,
      route: "quote_translation"
    });
  } catch (error) {
    logErrorEvent("request_execution_failure_persist_failed", {
      route: "quote_translation",
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      operationIdSuffix: suffixForLog(options.operationId),
      requestHashSuffix: options.requestHash.slice(-12),
      errorClass: error instanceof Error ? error.name : typeof error
    });
  }
}
