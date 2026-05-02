import { parseJsonishText } from "../../../gemini/normalize";
import type { OpenAIChatCompletionPayload } from "./types";

export function parseOpenAIChatCompletionPayload(payload: OpenAIChatCompletionPayload): {
  data: unknown;
  failureReason?: "json_parse_failed" | "schema_invalid";
  finishReason?: string | null;
} {
  const content = extractOpenAIMessageContent(payload);
  const finishReason = payload.choices?.[0]?.finish_reason ?? null;
  if (!content.trim()) {
    return {
      data: {},
      failureReason: "schema_invalid",
      finishReason
    };
  }

  try {
    return {
      data: parseJsonishText(content),
      finishReason
    };
  } catch {
    return {
      data: {},
      failureReason: "json_parse_failed",
      finishReason
    };
  }
}

function extractOpenAIMessageContent(payload: OpenAIChatCompletionPayload): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("");
  }
  return "";
}
