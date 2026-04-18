type LogLevel = "info" | "warn" | "error";

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
