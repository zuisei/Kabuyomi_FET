import type { Env } from "../env";

export const DETACHED_ACCESS_HEADER = "x-kabuyomi-detached-access";
export const DEV_DETACHED_ACCESS_MODE = "dev_unlimited";

export interface DetachedAccessGrant {
  accessMode: typeof DEV_DETACHED_ACCESS_MODE;
  plan: "pro";
  quotaSubject: string;
  chatLimit: number;
  stockLimit: number;
}

const DEV_UNLIMITED_LIMIT = Number.MAX_SAFE_INTEGER;

export async function loadDetachedAccessFromRequest(request: Request, env: Env): Promise<DetachedAccessGrant | null> {
  const requestedMode = request.headers.get(DETACHED_ACCESS_HEADER)?.trim();
  if (requestedMode !== DEV_DETACHED_ACCESS_MODE) {
    return null;
  }

  if (!isDetachedAccessEnabled(env.DEV_DETACHED_ACCESS_ENABLED)) {
    return null;
  }

  const deviceKey = request.headers.get("x-device-key")?.trim();
  if (!deviceKey) {
    return null;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`detached-access:${DEV_DETACHED_ACCESS_MODE}:${deviceKey}`)
  );
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");

  return {
    accessMode: DEV_DETACHED_ACCESS_MODE,
    plan: "pro",
    quotaSubject: `detached:${DEV_DETACHED_ACCESS_MODE}:${hex}`,
    chatLimit: DEV_UNLIMITED_LIMIT,
    stockLimit: DEV_UNLIMITED_LIMIT
  };
}

function isDetachedAccessEnabled(rawValue: string | undefined): boolean {
  const normalized = rawValue?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}
