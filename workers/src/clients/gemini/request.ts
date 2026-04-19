import type { Env } from "../../env";
import { logEvent } from "../../lib/logging";
import { parseJsonishText } from "./normalize";
import { chatResponseJsonSchema, summaryResponseJsonSchema } from "./prompts";

export const DEFAULT_GEMINI_MODEL = "gemma-4-31b-it";
const DEFAULT_GEMINI_TIMEOUT_MS = 12_000;

export async function invokeGemini(
  env: Env,
  prompt: string,
  kind: "summary" | "chat"
): Promise<unknown> {
  const model = resolveGeminiModel(env);
  const timeoutMs = resolveGeminiTimeoutMs(env);
  const responseJsonSchema = kind === "summary" ? summaryResponseJsonSchema() : chatResponseJsonSchema();
  const attempts = kind === "summary"
    ? [
        {
          includeSchema: true,
          generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseJsonSchema }
        }
      ]
    : [
        {
          includeSchema: true,
          generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseJsonSchema }
        },
        { includeSchema: false, generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }
      ];

  for (const [index, attempt] of attempts.entries()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY ?? ""
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: attempt.generationConfig
          }),
          signal: controller.signal
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      const timedOut =
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof DOMException && error.name === "AbortError");
      logEvent("gemini_request_failed", {
        kind,
        model,
        includeSchema: attempt.includeSchema,
        timeoutMs,
        reason: timedOut ? "timeout" : "network_error"
      });
      if (attempts[index + 1]) {
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyPreview = (await response.text()).slice(0, 240);
      logEvent("gemini_request_failed", {
        kind,
        model,
        status: response.status,
        includeSchema: attempt.includeSchema,
        bodyPreview
      });
      if (attempt.includeSchema && attempts[index + 1]) {
        continue;
      }
      throw new Error(`Gemini request failed (${response.status})`);
    }

    logEvent("gemini_request_succeeded", {
      kind,
      model,
      status: response.status,
      includeSchema: attempt.includeSchema
    });

    const payload = await response.json<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>();
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    logEvent("gemini_response_preview", {
      kind,
      model,
      includeSchema: attempt.includeSchema,
      textPreview: text.slice(0, 240)
    });

    try {
      return parseJsonishText(text);
    } catch {
      logEvent("gemini_invalid_response", { kind, includeSchema: attempt.includeSchema });
      if (attempt.includeSchema && attempts[index + 1]) {
        continue;
      }
      return {};
    }
  }

  return {};
}

export function resolveGeminiModel(env: Env): string {
  const raw = env.GEMINI_MODEL?.trim();
  if (!raw) {
    return DEFAULT_GEMINI_MODEL;
  }

  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function resolveGeminiTimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.GEMINI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GEMINI_TIMEOUT_MS;
}
