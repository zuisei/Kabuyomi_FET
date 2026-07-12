import type { Env } from "../env";
import { AppError } from "./errors";
import { hashForLog, logEvent, suffixForLog } from "./logging";
import {
  buildRequestExecutionReservationIntent,
  persistRequestExecutionAccounting,
  type CreditOperationResult,
  type MonthlyGrantResult,
  type QuotaIdentity,
  type RequestExecutionReservationOptions
} from "./quota";
import type { RemoteConfig } from "./remote-config";

export type RequestExecutionRoute = "chat" | "quote_translation";
export type RequestExecutionConfigValue = string | number | boolean | null;
export type RequestExecutionConfigSnapshot = Record<string, RequestExecutionConfigValue>;

export interface ChatExecutionResult extends Record<string, unknown> {
  kind: "chat";
  answer: string;
  sources: unknown[];
  responsePath: string;
  modelName: string | null;
  creditsCharged: number;
}

export interface QuoteTranslationExecutionResult extends Record<string, unknown> {
  kind: "quote_translation";
  translatedText: string;
  modelName: string;
  creditsCharged: number;
}

export type StableRequestExecutionResult = ChatExecutionResult | QuoteTranslationExecutionResult;

export type RequestExecutionBeginResult =
  | {
      outcome: "leader";
      executionPolicyVersion: string;
      createdAt: string;
      reservationId: string;
      reservationMode: "credits" | "legacy_chat" | "unmetered";
      reservationExpiresAt: string;
      creditsReserved: number;
      monthlyGrant?: MonthlyGrantResult;
    }
  | { outcome: "pending"; retryAfterSeconds: number }
  | { outcome: "replay"; result: StableRequestExecutionResult; resultMetadata: RequestExecutionConfigSnapshot }
  | { outcome: "not_started" }
  | { outcome: "payload_mismatch" }
  | { outcome: "result_expired" }
  | {
      outcome: "failed";
      failureCode: string;
      failureStatus: number;
      failureDetails?: RequestExecutionConfigSnapshot;
      monthlyGrant?: MonthlyGrantResult;
    };

export interface RequestExecutionCompletionResult {
  outcome: "completed";
  didMutate: boolean;
  reservationStatus: "committed" | "released" | "none";
  creditsCharged: number;
  completedAt?: string;
  resultExpiresAt?: string;
  creditOperation?: CreditOperationResult;
  monthlyGrant?: MonthlyGrantResult;
}

export interface RequestExecutionFailureResult {
  outcome: "failed" | "completed";
  didMutate: boolean;
  reservationStatus?: "released" | "expired" | "committed" | "none";
}

export class RequestExecutionHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
    readonly details: RequestExecutionConfigSnapshot = {}
  ) {
    super(code);
    this.name = "RequestExecutionHttpError";
  }
}

export function isRequestExecutionHttpError(error: unknown): error is RequestExecutionHttpError {
  return error instanceof RequestExecutionHttpError;
}

export function requireRequestExecutionLeaderOrReplay(
  result: RequestExecutionBeginResult
): Extract<RequestExecutionBeginResult, { outcome: "leader" | "replay" }> {
  if (result.outcome === "leader" || result.outcome === "replay") {
    return result;
  }
  if (result.outcome === "pending") {
    throw new RequestExecutionHttpError("execution_pending", 202, result.retryAfterSeconds);
  }
  if (result.outcome === "payload_mismatch") {
    throw new RequestExecutionHttpError("operation_id_payload_mismatch", 409);
  }
  if (result.outcome === "result_expired") {
    throw new RequestExecutionHttpError("operation_result_expired", 410);
  }
  if (result.outcome === "failed") {
    throw new RequestExecutionHttpError(
      result.failureCode || "operation_execution_failed",
      result.failureStatus || 409,
      undefined,
      result.failureDetails
    );
  }
  throw new RequestExecutionHttpError("request_execution_not_started", 503);
}

export async function beginRequestExecution(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    operationId: string;
    requestHash: string;
    route: RequestExecutionRoute;
    allowCreate: boolean;
    executionPolicyVersion: string;
    configSnapshot: RequestExecutionConfigSnapshot;
    reservation: RequestExecutionReservationOptions;
  }
): Promise<RequestExecutionBeginResult> {
  const reservation = buildRequestExecutionReservationIntent(identity, config, options.reservation);
  const response = await requestExecutionStub(identity, env).fetch("https://do/request-execution", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "begin", ...options, reservation })
  });
  const payload = (await response.json()) as RequestExecutionBeginResult & { error?: string };
  const outcome = payload.outcome;
  const logFields = executionLogFields(identity, options.operationId, options.requestHash, options.route);

  if (outcome === "leader") {
    logEvent("request_execution_started", { ...logFields, executionPolicyVersion: options.executionPolicyVersion });
  } else if (outcome === "replay") {
    logEvent("request_execution_replayed", logFields);
  } else if (outcome === "pending") {
    logEvent("request_execution_pending", { ...logFields, retryAfterSeconds: payload.retryAfterSeconds });
  } else if (outcome === "payload_mismatch") {
    logEvent("request_execution_payload_mismatch", logFields);
  }

  if (!outcome) {
    throw new AppError(response.status || 500, "Request execution state unavailable");
  }
  if ("monthlyGrant" in payload && payload.monthlyGrant) {
    await persistRequestExecutionAccounting(identity, env, { monthlyGrant: payload.monthlyGrant });
  }
  return payload;
}

export async function completeRequestExecution(
  identity: QuotaIdentity,
  env: Env,
  options: {
    operationId: string;
    requestHash: string;
    route: RequestExecutionRoute;
    resultBody: StableRequestExecutionResult;
    resultMetadata: RequestExecutionConfigSnapshot;
    chargeable: boolean;
  }
): Promise<RequestExecutionCompletionResult> {
  const response = await requestExecutionStub(identity, env).fetch("https://do/request-execution", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", ...options })
  });
  if (!response.ok) {
    throw new AppError(response.status, "Request execution completion failed");
  }
  const payload = (await response.json()) as RequestExecutionCompletionResult;
  if (payload.outcome !== "completed") {
    throw new AppError(500, "Request execution completion state unavailable");
  }
  await persistRequestExecutionAccounting(identity, env, {
    monthlyGrant: payload.monthlyGrant,
    creditOperation: payload.creditOperation
  });
  logEvent("request_execution_completed", executionLogFields(identity, options.operationId, options.requestHash, options.route));
  return payload;
}

export async function failRequestExecution(
  identity: QuotaIdentity,
  env: Env,
  options: {
    operationId: string;
    requestHash: string;
    route: RequestExecutionRoute;
    failureCode: string;
    failureStatus: number;
    failureDetails?: RequestExecutionConfigSnapshot;
  }
): Promise<RequestExecutionFailureResult> {
  const response = await requestExecutionStub(identity, env).fetch("https://do/request-execution", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "fail", ...options })
  });
  if (!response.ok) {
    throw new AppError(response.status, "Request execution failure state could not be saved");
  }
  const payload = (await response.json()) as RequestExecutionFailureResult;
  if (payload.outcome !== "failed" && payload.outcome !== "completed") {
    throw new AppError(500, "Request execution failure state unavailable");
  }
  logEvent("request_execution_failed", {
    ...executionLogFields(identity, options.operationId, options.requestHash, options.route),
    failureCode: options.failureCode,
    failureStatus: options.failureStatus
  });
  return payload;
}

export function isChatExecutionResult(value: unknown): value is ChatExecutionResult {
  const result = value as Partial<ChatExecutionResult> | null;
  return Boolean(
    result &&
      result.kind === "chat" &&
      typeof result.answer === "string" &&
      Array.isArray(result.sources) &&
      typeof result.responsePath === "string" &&
      (typeof result.modelName === "string" || result.modelName === null) &&
      typeof result.creditsCharged === "number"
  );
}

export function isQuoteTranslationExecutionResult(value: unknown): value is QuoteTranslationExecutionResult {
  const result = value as Partial<QuoteTranslationExecutionResult> | null;
  return Boolean(
    result &&
      result.kind === "quote_translation" &&
      typeof result.translatedText === "string" &&
      typeof result.modelName === "string" &&
      typeof result.creditsCharged === "number"
  );
}

function requestExecutionStub(identity: QuotaIdentity, env: Env) {
  return env.USER_QUOTA.getByName(identity.quotaSubject);
}

function executionLogFields(
  identity: QuotaIdentity,
  operationId: string,
  requestHash: string,
  route: RequestExecutionRoute
) {
  return {
    quotaSubjectHash: hashForLog(identity.quotaSubject),
    operationIdSuffix: suffixForLog(operationId),
    requestHashSuffix: requestHash.slice(-12),
    route
  };
}
