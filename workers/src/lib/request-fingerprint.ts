export const CHAT_REQUEST_FINGERPRINT_DOMAIN = "kabuyomi.request.chat.v1";
export const QUOTE_TRANSLATION_REQUEST_FINGERPRINT_DOMAIN = "kabuyomi.request.quote-translation.v1";

export interface ChatRequestFingerprintInput {
  filingKey: string;
  question: string;
  conversationContext?: Array<{ role: "user" | "assistant"; content: string }>;
  analysisTier?: string | null;
  creditCost: number;
}

export interface QuoteTranslationRequestFingerprintInput {
  text: string;
  sourceLanguage?: string | null;
  targetLanguage?: string;
  creditCost: number;
}

export async function buildChatRequestHash(input: ChatRequestFingerprintInput): Promise<string> {
  return sha256Hex(
    canonicalJson({
      domain: CHAT_REQUEST_FINGERPRINT_DOMAIN,
      filingKey: input.filingKey.trim(),
      question: input.question.trim(),
      conversationContext: (input.conversationContext ?? []).map((message) => ({
        role: message.role,
        content: message.content.trim()
      })),
      analysisTier: normalizeOptionalString(input.analysisTier),
      creditCost: input.creditCost
    })
  );
}

export async function buildQuoteTranslationRequestHash(
  input: QuoteTranslationRequestFingerprintInput
): Promise<string> {
  return sha256Hex(
    canonicalJson({
      domain: QUOTE_TRANSLATION_REQUEST_FINGERPRINT_DOMAIN,
      text: input.text.trim(),
      sourceLanguage: normalizeOptionalString(input.sourceLanguage),
      targetLanguage: input.targetLanguage?.trim() || "ja",
      creditCost: input.creditCost
    })
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
