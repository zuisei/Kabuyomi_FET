import { describe, expect, it } from "vitest";
import { hashForLog, redactForLog, suffixForLog } from "../src/lib/logging";

describe("logging redaction helpers", () => {
  it("keeps suffixes useful without returning the full input", () => {
    const raw = "transaction-abcdefghijklmnopqrstuvwxyz";

    expect(suffixForLog(raw)).toBe("stuvwxyz");
    expect(suffixForLog(raw)).not.toBe(raw);
  });

  it("keeps very short values from being emitted verbatim", () => {
    expect(suffixForLog("tx-1")).toBe("x-1");
    expect(suffixForLog("x")).toMatch(/^hash:/);
  });

  it("hashes are stable and do not reveal the input", () => {
    const raw = "free:device:super-sensitive-device-key";
    const first = hashForLog(raw);
    const second = hashForLog(raw);

    expect(first).toBe(second);
    expect(first).toMatch(/^hash:[0-9a-f]{16}$/);
    expect(first).not.toContain(raw);
  });

  it("redacted values combine hash and suffix metadata", () => {
    const raw = "operation-id-1234567890";
    const redacted = redactForLog(raw);

    expect(redacted).toContain("hash:");
    expect(redacted).toContain("suffix:");
    expect(redacted).not.toContain(raw);
  });
});
