import type { Env } from "../../env";

const DEFAULT_LOCK_RENEW_INTERVAL_MS = 10_000;

export async function acquireFilingLock(
  filingKey: string,
  env: Env
): Promise<() => Promise<void>> {
  const stub = env.FILING_LOCK.getByName(filingKey);
  const response = await stub.fetch("https://do/lock", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to acquire filing lock");
  }
  const payload = (await response.json()) as { token?: string; ttlMs?: number };
  if (!payload.token) {
    throw new Error("Failed to acquire filing lock token");
  }

  const renewIntervalMs = Math.max(
    1_000,
    Math.min(DEFAULT_LOCK_RENEW_INTERVAL_MS, Math.floor((payload.ttlMs ?? 30_000) / 3))
  );
  const interval = setInterval(() => {
    void stub.fetch("https://do/renew", {
      method: "POST",
      body: JSON.stringify({ token: payload.token })
    });
  }, renewIntervalMs);

  return async () => {
    clearInterval(interval);
    await stub.fetch("https://do/unlock", {
      method: "POST",
      body: JSON.stringify({ token: payload.token })
    });
  };
}
