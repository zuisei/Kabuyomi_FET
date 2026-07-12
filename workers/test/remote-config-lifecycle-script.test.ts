import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../scripts/remote-config-lifecycle.mjs", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/remote-config-lifecycle-envelope.json", import.meta.url));
const approvedHash = "9806bad46f964d067b60f46afa0978ab432aa977bcf776e5c8636dc60b9bb591";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("remote config lifecycle operator script", () => {
  it("reports the bounded lifecycle and approved config hash without mutating input", () => {
    const before = readFileSync(fixturePath, "utf8");
    const result = run(["inspect", fixturePath, "--now", "2026-07-20T00:00:00.000Z"]);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.status).toBe(0);
    expect(report).toMatchObject({
      version: "review-fixture-v1",
      maxStaleAgeSeconds: 3_888_000,
      configSha256: approvedHash,
      status: "fresh",
      reviewDueAgeSeconds: 1_209_600,
      criticalAgeSeconds: 3_024_000
    });
    expect(report.legacyClientCompatibility).toEqual({
      status: "disabled",
      expiresAt: "1970-01-01T00:00:00.000Z",
      secondsUntilExpiry: 0
    });
    expect(readFileSync(fixturePath, "utf8")).toBe(before);
  });

  it("refreshes only reviewed metadata after an explicit matching hash", () => {
    const directory = mkdtempSync(join(tmpdir(), "kabuyomi-remote-config-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "reviewed.json");
    const result = run([
      "refresh-reviewed",
      fixturePath,
      outputPath,
      "--approved-config-sha256",
      approvedHash,
      "--version",
      "review-fixture-v2"
    ]);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    const original = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
    const refreshed = JSON.parse(readFileSync(outputPath, "utf8")) as Record<string, unknown>;

    expect(result.status).toBe(0);
    expect(report).toMatchObject({
      version: "review-fixture-v2",
      maxStaleAgeSeconds: 3_888_000,
      configSha256: approvedHash,
      configChanged: false
    });
    expect(refreshed.config).toEqual(original.config);
    expect(refreshed.version).toBe("review-fixture-v2");
    expect(refreshed.maxStaleAgeSeconds).toBe(3_888_000);
    expect(refreshed.updatedAt).not.toBe(original.updatedAt);
  });

  it("refuses to refresh when the human-approved hash does not match", () => {
    const directory = mkdtempSync(join(tmpdir(), "kabuyomi-remote-config-"));
    temporaryDirectories.push(directory);
    const result = run([
      "refresh-reviewed",
      fixturePath,
      join(directory, "rejected.json"),
      "--approved-config-sha256",
      "0".repeat(64),
      "--version",
      "review-fixture-v2"
    ]);

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("Approved hash mismatch");
  });

  it("refuses an unbounded operator-selected stale age", () => {
    const directory = mkdtempSync(join(tmpdir(), "kabuyomi-remote-config-"));
    temporaryDirectories.push(directory);
    const result = run([
      "refresh-reviewed",
      fixturePath,
      join(directory, "rejected.json"),
      "--approved-config-sha256",
      approvedHash,
      "--version",
      "review-fixture-v2",
      "--max-stale-age-seconds",
      "3888001"
    ]);

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("--max-stale-age-seconds must be 1..3888000");
  });

  it("refuses a missing or malformed legacy-client compatibility gate", () => {
    const directory = mkdtempSync(join(tmpdir(), "kabuyomi-remote-config-"));
    temporaryDirectories.push(directory);
    const malformedPath = join(directory, "malformed.json");
    const envelope = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, any>;
    envelope.config.legacyClientCompatibility = { enabled: true, expiresAt: "2099-01-01" };
    writeFileSync(malformedPath, JSON.stringify(envelope));

    const result = run(["inspect", malformedPath]);
    expect(result.status).toBe(65);
    expect(result.stderr).toContain("canonical ISO-8601 expiresAt");
  });

  it("refuses an enabled bridge longer than the hard 30-day window", () => {
    const directory = mkdtempSync(join(tmpdir(), "kabuyomi-remote-config-"));
    temporaryDirectories.push(directory);
    const malformedPath = join(directory, "too-long.json");
    const envelope = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, any>;
    envelope.config.legacyClientCompatibility = {
      enabled: true,
      expiresAt: "2026-08-11T00:00:01.000Z"
    };
    writeFileSync(malformedPath, JSON.stringify(envelope));

    const result = run(["inspect", malformedPath]);
    expect(result.status).toBe(65);
    expect(result.stderr).toContain("within 2592000 seconds");
  });

  it.each([
    ["active", "2026-07-20T00:00:00.000Z", 0],
    ["review_due", "2026-08-03T00:00:00.000Z", 1],
    ["critical", "2026-08-09T12:00:00.000Z", 2],
    ["expired", "2026-08-10T00:00:00.000Z", 3]
  ])("reports enabled bridge lifecycle %s and raises the matching monitor severity", (status, now, exitCode) => {
    const directory = mkdtempSync(join(tmpdir(), "kabuyomi-remote-config-"));
    temporaryDirectories.push(directory);
    const enabledPath = join(directory, `enabled-${status}.json`);
    const envelope = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, any>;
    envelope.config.legacyClientCompatibility = {
      enabled: true,
      expiresAt: "2026-08-10T00:00:00.000Z"
    };
    writeFileSync(enabledPath, JSON.stringify(envelope));

    const result = run(["inspect", enabledPath, "--now", now]);
    const report = JSON.parse(result.stdout) as Record<string, any>;
    expect(result.status).toBe(exitCode);
    expect(report.legacyClientCompatibility.status).toBe(status);
  });
});

function run(args: string[]) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
