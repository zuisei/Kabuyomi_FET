import { parseJsonishText } from "../../../gemini/normalize";
import type { OpenAIChatCompletionPayload, OpenAIResponsesPayload } from "./types";

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

export function parseOpenAIResponsesPayload(payload: OpenAIResponsesPayload): {
  data: unknown;
  failureReason?: "json_parse_failed" | "schema_invalid";
  truncatedAtTokenLimit?: boolean;
} {
  const content = extractOpenAIResponseText(payload);
  // The Responses API reports being cut off as status "incomplete" with
  // incomplete_details.reason, not as a finish_reason. Without this a chat
  // answer truncated at max_output_tokens is indistinguishable in the logs from
  // a model that returned malformed JSON, which are different problems.
  const truncated =
    payload.status === "incomplete" && payload.incomplete_details?.reason === "max_output_tokens";
  const truncationFlag = truncated ? { truncatedAtTokenLimit: true } : {};

  if (!content.trim()) {
    return {
      data: {},
      failureReason: "schema_invalid",
      ...truncationFlag
    };
  }

  try {
    return {
      data: parseJsonishText(content),
      ...truncationFlag
    };
  } catch {
    return {
      data: {},
      failureReason: "json_parse_failed",
      ...truncationFlag
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

function extractOpenAIResponseText(payload: OpenAIResponsesPayload): string {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }
  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" || part.text !== undefined)
    .map((part) => part.text ?? "")
    .join("") ?? "";
}
