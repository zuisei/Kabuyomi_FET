import type { ChatResponseDebug, ChatResponsePayload } from "./grounding";

export function attachChatDebug(
  response: ChatResponsePayload,
  debug: Omit<ChatResponseDebug, "sourceCount" | "sourceIds">
): ChatResponsePayload {
  return {
    ...response,
    debug: {
      ...debug,
      sourceCount: response.sources.length,
      sourceIds: response.sources.map((source) => source.sourceId)
    }
  };
}
