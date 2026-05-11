import type { LlmApiErrorKind } from "./types";

export type ProviderErrorClassification = {
  kind: LlmApiErrorKind;
  code: string | null;
};

export function classifyProviderHttpError(status: number, bodyPreview: string): ProviderErrorClassification {
  const body = bodyPreview.toLowerCase();
  const code = extractErrorCode(bodyPreview);
  if (status === 401 || status === 403) {
    return { kind: "auth_error", code };
  }
  if (status === 429) {
    return { kind: "rate_limit", code };
  }
  if (status >= 500) {
    return { kind: "provider_server_error", code };
  }
  if (status === 408) {
    return { kind: "timeout", code };
  }
  if (status === 400) {
    if (/unknown prompt variables?|prompt variables?/.test(body)) {
      return { kind: "bad_request", code };
    }
    if (/context|maximum context|context length|tokens.*exceed|input.*too.*long|prompt.*too.*long/.test(body)) {
      return { kind: "context_too_large", code };
    }
    if (/payload|request.*too.*large|body.*too.*large|size/i.test(bodyPreview)) {
      return { kind: "payload_too_large", code };
    }
    return { kind: "bad_request", code };
  }
  return { kind: "unknown", code };
}

function extractErrorCode(bodyPreview: string): string | null {
  const typeMatch = bodyPreview.match(/"type"\s*:\s*"([^"]+)"/i);
  if (typeMatch?.[1]) {
    return typeMatch[1].slice(0, 80);
  }
  const codeMatch = bodyPreview.match(/"code"\s*:\s*"?([A-Za-z0-9_.-]+)"?/i);
  return codeMatch?.[1]?.slice(0, 80) ?? null;
}
