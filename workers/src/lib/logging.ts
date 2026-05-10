type LogLevel = "info" | "warn" | "error";

export function suffixForLog(value: unknown, visibleChars = 8): string | null {
  try {
    const normalized = normalizeLogValue(value);
    if (!normalized) {
      return null;
    }
    const safeVisibleChars = Math.max(1, Math.floor(visibleChars));
    if (normalized.length <= safeVisibleChars) {
      return normalized.slice(1) || hashForLog(normalized);
    }
    return normalized.slice(-safeVisibleChars);
  } catch {
    return null;
  }
}

export function hashForLog(value: unknown): string | null {
  try {
    const normalized = normalizeLogValue(value);
    if (!normalized) {
      return null;
    }
    return `hash:${fnv1a64(normalized)}`;
  } catch {
    return null;
  }
}

export function redactForLog(value: unknown): string | null {
  const suffix = suffixForLog(value);
  const hash = hashForLog(value);
  if (!suffix && !hash) {
    return null;
  }
  return [hash, suffix ? `suffix:${suffix}` : null].filter(Boolean).join(":");
}

export function logEvent(event: string, payload: Record<string, unknown> = {}): void {
  emitLog("info", event, payload);
}

export function logWarnEvent(event: string, payload: Record<string, unknown> = {}): void {
  emitLog("warn", event, payload);
}

export function logErrorEvent(event: string, payload: Record<string, unknown> = {}): void {
  emitLog("error", event, payload);
}

function emitLog(level: LogLevel, event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    event,
    ...payload,
    loggedAt: new Date().toISOString()
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

function normalizeLogValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0").slice(0, 16);
}
