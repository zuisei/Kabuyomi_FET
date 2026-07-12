import type { Env } from "../env";
import { isDedicatedTestEnvironment } from "./test-automation-access";

export type DetachedAccessMode = "dev_unlimited";

export interface DetachedAccessGrant {
  quotaSubject: string;
  accessMode: DetachedAccessMode;
  chatLimitOverride: number;
  stockLimitOverride: number;
}

const DETACHED_ACCESS_HEADER = "x-kabuyomi-detached-access";
const DEV_UNLIMITED_MODE: DetachedAccessMode = "dev_unlimited";
const DETACHED_ACCESS_LIMIT = Number.MAX_SAFE_INTEGER;

export async function loadDetachedAccessFromRequest(request: Request, env: Env): Promise<DetachedAccessGrant | null> {
  // Legacy detached access is retained for local/test compatibility only. A
  // production deployment must never be able to enable it with configuration.
  if (!isDedicatedTestEnvironment(env)) {
    return null;
  }
  const requestedMode = request.headers.get(DETACHED_ACCESS_HEADER)?.trim().toLowerCase();
  if (requestedMode !== DEV_UNLIMITED_MODE) {
    return null;
  }

  const deviceKey = request.headers.get("x-device-key")?.trim().toLowerCase();
  if (!deviceKey) {
    return null;
  }

  const allowlist = parseDetachedAccessDeviceKeys(env.DEV_DETACHED_ACCESS_DEVICE_KEYS);
  if (!isDetachedAccessDeviceAllowed(deviceKey, allowlist)) {
    return null;
  }

  return {
    quotaSubject: `pro:detached:${await sha256Hex(`detached-device:${deviceKey}`)}`,
    accessMode: DEV_UNLIMITED_MODE,
    chatLimitOverride: DETACHED_ACCESS_LIMIT,
    stockLimitOverride: DETACHED_ACCESS_LIMIT
  };
}

function parseDetachedAccessDeviceKeys(rawValue: string | undefined): Set<string> {
  if (!rawValue) {
    return new Set();
  }

  return new Set(
    rawValue
      .split(/[,\n]/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

function isDetachedAccessDeviceAllowed(deviceKey: string, allowlist: Set<string>): boolean {
  if (allowlist.has(deviceKey)) {
    return true;
  }
  for (const entry of allowlist) {
    if (entry.endsWith("*") && deviceKey.startsWith(entry.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
