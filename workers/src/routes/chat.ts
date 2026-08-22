import { resolveLlmProvider } from "../clients/llm/provider";
import { ChatRequestSchema } from "../lib/contracts";
import { answerChatUsecase, CHAT_CREDIT_COST } from "../lib/chat/usecase";
import { isCurrentCacheRecord, loadFilingByKey } from "../lib/filings/cache";
import { buildChatRequestHash } from "../lib/request-fingerprint";
import {
  beginRequestExecution,
  completeRequestExecution,
  failRequestExecution,
  isChatExecutionResult,
  type RequestExecutionBeginResult,
  type RequestExecutionConfigSnapshot
} from "../lib/request-execution";
import {
  loadUsage,
  readQuotaIdentity,
  type RequestExecutionReservationOptions,
  type QuotaIdentity
} from "../lib/quota";
import { AppError } from "../lib/errors";
import { parseJsonBody } from "../lib/request";
import { QUESTION_TOO_SHORT_MESSAGE, questionHasSubstance } from "../lib/chat/question-substance";
import { hashForLog, logErrorEvent, suffixForLog } from "../lib/logging";
import { json, notFound, serverError, unavailable } from "../lib/response";
import type { Env } from "../env";
import { isCreditBillingEnabledForIdentity, type RemoteConfig } from "../lib/remote-config";
import type { RouteHandler } from "./types";

const CHAT_PAYLOAD_MAX_BYTES = 12_288;
const CHAT_EXECUTION_POLICY_VERSION = "chat-request-execution-v1";

export const handleChatRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/chat")) {
    return null;
  }

  const payload = await parseJsonBody(request, ChatRequestSchema, {
    invalidMessage: "Invalid chat payload",
    maxBytes: CHAT_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Chat payload is too large"
  });
  // 予約(クレジット)より前。ここで止めれば何も消費されない。
  if (!questionHasSubstance(payload.question)) {
    throw new AppError(400, QUESTION_TOO_SHORT_MESSAGE);
  }
  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const creditBillingEnabled = isCreditBillingEnabledForIdentity(config, identity);
  const reservation = buildChatReservation(identity, payload.filingKey);
  const requestHash = await buildChatRequestHash({
    filingKey: payload.filingKey,
    question: payload.question,
    conversationContext: payload.conversationContext,
    creditCost: CHAT_CREDIT_COST
  });
  const execution = await beginRequestExecution(identity, env, config, {
    operationId: payload.operationId,
    requestHash,
    route: "chat",
    allowCreate: config.chatEnabled,
    executionPolicyVersion: CHAT_EXECUTION_POLICY_VERSION,
    configSnapshot: buildChatExecutionConfigSnapshot(env, config, creditBillingEnabled),
    reservation
  });

  if (execution.outcome === "not_started") {
    return unavailable("Chat is temporarily disabled");
  }
  const executionResponse = nonLeaderExecutionResponse(execution);
  if (executionResponse) {
    return executionResponse;
  }
  if (execution.outcome === "replay") {
    if (!isChatExecutionResult(execution.result)) {
      return serverError("Cached chat result is unavailable");
    }
    const usage = await loadUsage(identity, env, config);
    return json({
      answer: execution.result.answer,
      sources: execution.result.sources,
      responsePath: execution.result.responsePath,
      modelName: execution.result.modelName,
      ...testReleaseCandidateDebug(env),
      usage: { ...usage, creditBillingEnabled },
      creditsCharged: execution.result.creditsCharged,
      creditsRemaining: usage.credits?.totalRemaining
    });
  }

  try {
    const requestedFiling = await loadFilingByKey(payload.filingKey, env);
    if (!requestedFiling || !isCurrentCacheRecord(requestedFiling, config)) {
      await persistChatExecutionFailureSafely(identity, env, {
        operationId: payload.operationId,
        requestHash,
        failureCode: "filing_cache_not_found",
        failureStatus: 404
      });
      return notFound("Filing cache not found");
    }

    const body = await answerChatUsecase({
      payload,
      filing: requestedFiling,
      identity,
      operationId: payload.operationId,
      env,
      config,
      ctx
    });
    const chargeable = body.chargeable !== false;
    const cachedCreditsCharged = chargeable && reservation.mode === "credits" ? CHAT_CREDIT_COST : 0;
    const stableResult: unknown = {
      kind: "chat",
      answer: body.answer,
      sources: body.sources,
      responsePath: body.responsePath,
      modelName: body.modelName,
      creditsCharged: cachedCreditsCharged
    };
    if (!isChatExecutionResult(stableResult)) {
      throw new Error("chat_stable_result_invalid");
    }
    const completion = await completeRequestExecution(identity, env, {
      operationId: payload.operationId,
      requestHash,
      route: "chat",
      resultBody: stableResult,
      resultMetadata: {
        responsePath: stableResult.responsePath,
        modelName: stableResult.modelName,
        creditsCharged: stableResult.creditsCharged
      },
      chargeable
    });
    const usage = await loadUsage(identity, env, config);
    return json({
      answer: stableResult.answer,
      sources: stableResult.sources,
      responsePath: stableResult.responsePath,
      modelName: stableResult.modelName,
      ...(body.debug === undefined && !isTestEnvironment(env)
        ? {}
        : {
            debug: {
              ...(body.debug && typeof body.debug === "object" ? body.debug : {}),
              releaseCandidateId: normalizedReleaseCandidateId(env)
            }
          }),
      usage: { ...usage, creditBillingEnabled },
      creditsCharged: completion.creditsCharged,
      creditsRemaining: usage.credits?.totalRemaining
    });
  } catch (error) {
    const failure = classifyChatExecutionFailure(error);
    await persistChatExecutionFailureSafely(identity, env, {
      operationId: payload.operationId,
      requestHash,
      ...failure
    });

    logErrorEvent("chat_request_failed", {
      filingKey: payload.filingKey,
      errorClass: error instanceof Error ? error.name : typeof error
    });
    throw error;
  }
};

function testReleaseCandidateDebug(env: Env): Record<string, unknown> {
  return isTestEnvironment(env)
    ? { debug: { releaseCandidateId: normalizedReleaseCandidateId(env) } }
    : {};
}

function isTestEnvironment(env: Env): boolean {
  return env.KABUYOMI_ENV === "test" || env.ENVIRONMENT === "test";
}

function normalizedReleaseCandidateId(env: Env): string | null {
  const value = env.RELEASE_CANDIDATE_ID?.trim().toLowerCase();
  return value && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}

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

function buildChatExecutionConfigSnapshot(
  env: Env,
  config: RemoteConfig,
  creditBillingEnabled: boolean
): RequestExecutionConfigSnapshot {
  const provider = resolveLlmProvider(env);
  const requestedModelName = provider === "openai" ? env.OPENAI_CHAT_MODEL?.trim() : env.GEMINI_MODEL?.trim();
  return {
    chatEnabled: config.chatEnabled,
    creditBillingEnabled,
    extractorVersion: config.extractorVersion,
    promptVersion: config.promptVersion,
    webSupplementEnabled: config.webSupplementEnabled,
    llmProvider: provider,
    requestedModelName: requestedModelName || null,
    modelConfigVersion: env.OPENAI_PROMPT_VERSION?.trim() || null,
    hardIntentRetrievalMode: env.HARD_INTENT_TARGETED_RETRIEVAL_MODE ?? null
  };
}

function classifyChatExecutionFailure(error: unknown): {
  failureCode: string;
  failureStatus: number;
  failureDetails?: RequestExecutionConfigSnapshot;
} {
  return {
    failureCode: "chat_execution_failed",
    failureStatus: 500
  };
}

function buildChatReservation(
  identity: QuotaIdentity,
  filingKey: string
): RequestExecutionReservationOptions {
  if (identity.accessMode === "dev_unlimited") {
    return { mode: "unmetered" };
  }
  return {
    mode: "credits",
    creditsRequired: CHAT_CREDIT_COST,
    reference: {
      type: "chat",
      id: filingKey
    }
  };
}

async function persistChatExecutionFailureSafely(
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
      route: "chat"
    });
  } catch (error) {
    logErrorEvent("request_execution_failure_persist_failed", {
      route: "chat",
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      operationIdSuffix: suffixForLog(options.operationId),
      requestHashSuffix: options.requestHash.slice(-12),
      errorClass: error instanceof Error ? error.name : typeof error
    });
  }
}
