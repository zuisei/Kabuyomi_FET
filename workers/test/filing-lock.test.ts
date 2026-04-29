import { describe, expect, it, vi } from "vitest";
import { FilingLockDO } from "../src/durable/filing-lock";

class MemoryDurableObjectStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function createState() {
  const storage = new MemoryDurableObjectStorage();
  return {
    storage,
    async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      return callback();
    }
  };
}

describe("FilingLockDO", () => {
  it("requires the owning token to renew or release a filing lock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T00:00:00.000Z"));
    try {
      const state = createState();
      const lock = new FilingLockDO(state as never);

      const acquired = await lock.fetch(new Request("https://do/lock", { method: "POST" }));
      expect(acquired.status).toBe(200);
      const acquiredPayload = (await acquired.json()) as { token: string; ttlMs: number };
      expect(acquiredPayload.token).toMatch(/[0-9a-f-]{36}/i);
      expect(acquiredPayload.ttlMs).toBe(30_000);

      const wrongRenew = await lock.fetch(
        new Request("https://do/renew", {
          method: "POST",
          body: JSON.stringify({ token: "wrong-token" })
        })
      );
      expect(wrongRenew.status).toBe(409);

      const originalLockedUntil = await state.storage.get<number>("lockedUntil");
      vi.advanceTimersByTime(12_000);
      const renewed = await lock.fetch(
        new Request("https://do/renew", {
          method: "POST",
          body: JSON.stringify({ token: acquiredPayload.token })
        })
      );
      expect(renewed.status).toBe(200);
      const renewedLockedUntil = await state.storage.get<number>("lockedUntil");
      expect(renewedLockedUntil).toBeGreaterThan(originalLockedUntil ?? 0);

      const wrongRelease = await lock.fetch(
        new Request("https://do/unlock", {
          method: "POST",
          body: JSON.stringify({ token: "wrong-token" })
        })
      );
      expect(wrongRelease.status).toBe(409);
      expect(await state.storage.get<string>("lockToken")).toBe(acquiredPayload.token);

      const released = await lock.fetch(
        new Request("https://do/unlock", {
          method: "POST",
          body: JSON.stringify({ token: acquiredPayload.token })
        })
      );
      expect(released.status).toBe(200);
      expect(await state.storage.get<string>("lockToken")).toBeUndefined();
      expect(await state.storage.get<number>("lockedUntil")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
