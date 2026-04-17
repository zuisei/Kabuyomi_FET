import type { Env } from "../../env";

export async function acquireFilingLock(
  filingKey: string,
  env: Env
): Promise<() => Promise<void>> {
  const stub = env.FILING_LOCK.getByName(filingKey);
  const response = await stub.fetch("https://do/lock", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to acquire filing lock");
  }

  return async () => {
    await stub.fetch("https://do/unlock", { method: "POST" });
  };
}
