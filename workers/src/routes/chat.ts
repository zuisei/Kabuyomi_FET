import { resolveGeminiModel } from "../clients/gemini/request";
import { ChatRequestSchema } from "../lib/contracts";
import { buildChatResponse, loadFilingByKey } from "../lib/pipeline";
import { consumeChatQuota, ensureChatQuotaAvailable, readQuotaIdentity } from "../lib/quota";
import { logErrorEvent, logEvent } from "../lib/logging";
import { badRequest, json, notFound, unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleChatRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/chat")) {
    return null;
  }

  if (!config.chatEnabled) {
    return unavailable("Chat is temporarily disabled");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid chat payload");
  }

  const parsed = ChatRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest("Invalid chat payload");
  }

  try {
    const filing = await loadFilingByKey(parsed.data.filingKey, env);
    if (!filing) {
      return notFound("Filing cache not found");
    }

    const identity = await readQuotaIdentity(request, env, {
      requireDeviceKey: true,
      allowDebugUnlimited: true
    });
    await ensureChatQuotaAvailable(identity, env, config);
    const startedAt = Date.now();
    const answer = await buildChatResponse(filing, parsed.data.question, env, config);
    const usage = await consumeChatQuota(identity, env, config);

    logEvent("chat_request", {
      filingKey: parsed.data.filingKey,
      quotaSubject: identity.quotaSubject,
      identityKind: identity.identityKind,
      latencyMs: Date.now() - startedAt,
      sourceCount: answer.sources.length
    });

    return json({
      answer: answer.answer,
      sources: answer.sources,
      responsePath: answer.responsePath,
      modelName: answer.responsePath === "gemini" ? resolveGeminiModel(env) : null,
      usage
    });
  } catch (error) {
    logErrorEvent("chat_request_failed", {
      filingKey: parsed.data.filingKey,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};
