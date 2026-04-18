import type { SummaryRecord } from "../../env";
import { ChatModelResponseSchema, SummaryResponseSchema } from "../../lib/contracts";
import type { GeminiChatAnswer } from "./types";

export function parseJsonishText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1]);
  }

  return JSON.parse(trimmed);
}

export function normalizeSummaryResponse(payload: unknown): SummaryRecord | null {
  const parsed = SummaryResponseSchema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const verdict = firstString(payload.verdict, payload.conclusion, payload.summary, payload.headline);
  const highlights = normalizeSummaryLines(payload.highlights);
  const changes = normalizeSummaryLines(payload.changes);

  const normalized = {
    verdict,
    highlights,
    changes
  };

  const normalizedParsed = SummaryResponseSchema.safeParse(normalized);
  return normalizedParsed.success ? normalizedParsed.data : null;
}

export function normalizeChatResponse(payload: unknown): GeminiChatAnswer | null {
  const parsed = ChatModelResponseSchema.safeParse(payload);
  if (parsed.success) {
    return {
      ...parsed.data,
      usedRemoteModel: true
    };
  }

  if (!isRecord(payload)) {
    return null;
  }

  const answer = firstString(payload.answer, payload.text, payload.response);
  const sourceIds = normalizeSourceIds(payload.sourceIds ?? payload.sources ?? payload.citations ?? payload.sourceId);
  const normalized = { answer, sourceIds };
  const normalizedParsed = ChatModelResponseSchema.safeParse(normalized);
  return normalizedParsed.success
    ? {
        ...normalizedParsed.data,
        usedRemoteModel: true
      }
    : null;
}

export function polishJapaneseText(text: string): string {
  return text
    .replace(/\s+([。、！？])/g, "$1")
    .replace(/([。、！？])([^\s])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripEnglishParentheticals(text: string): string {
  return text
    .replace(/\s*\((?:YoY|MD&A|guidance|capital allocation|cash flow|operating margin|gross margin)[^)]+\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeSummaryLines(value: unknown): Array<{ text: string; sourceIds: string[] }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string" || !isRecord(item)) {
      return [];
    }

    const text = firstString(item.text, item.summary, item.change, item.highlight);
    const sourceIds = normalizeSourceIds(item.sourceIds ?? item.sources ?? item.citations ?? item.sourceId);
    if (!text || sourceIds.length === 0) {
      return [];
    }

    return [{ text, sourceIds }];
  });
}

function normalizeSourceIds(value: unknown): string[] {
  if (typeof value === "string") {
    return value ? [value] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string") {
      return item ? [item] : [];
    }

    if (!isRecord(item)) {
      return [];
    }

    return firstString(item.sourceId, item.id, item.source_id) ? [firstString(item.sourceId, item.id, item.source_id)!] : [];
  });
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
