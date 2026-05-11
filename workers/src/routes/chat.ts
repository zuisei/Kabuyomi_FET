import { ChatRequestSchema } from "../lib/contracts";
import { answerChatUsecase } from "../lib/chat/usecase";
import { isCurrentCacheRecord, loadFilingByKey } from "../lib/filings/cache";
import { InsufficientCreditsError } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { logErrorEvent } from "../lib/logging";
import { json, notFound, unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

const CHAT_PAYLOAD_MAX_BYTES = 12_288;

export const handleChatRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/chat")) {
    return null;
  }

  if (!config.chatEnabled) {
    return unavailable("Chat is temporarily disabled");
  }

  const payload = await parseJsonBody(request, ChatRequestSchema, {
    invalidMessage: "Invalid chat payload",
    maxBytes: CHAT_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Chat payload is too large"
  });

  try {
    const requestedFiling = await loadFilingByKey(payload.filingKey, env);
    if (!requestedFiling || !isCurrentCacheRecord(requestedFiling, config)) {
      return notFound("Filing cache not found");
    }

    const body = await answerChatUsecase({
      request,
      payload,
      filing: requestedFiling,
      env,
      config,
      ctx
    });
    return json(body);
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return json(
        {
          error: "insufficient_credits",
          creditsRequired: error.creditsRequired,
          creditsRemaining: error.creditsRemaining
        },
        { status: error.status }
      );
    }

    logErrorEvent("chat_request_failed", {
      filingKey: payload.filingKey,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};
