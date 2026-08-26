import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DAY_SECONDS = 86_400;
const REVIEW_DUE_AGE_SECONDS = 14 * DAY_SECONDS;
const CRITICAL_AGE_SECONDS = 35 * DAY_SECONDS;
const MAX_STALE_AGE_SECONDS = 45 * DAY_SECONDS;
const LEGACY_CLIENT_COMPATIBILITY_MAX_WINDOW_SECONDS = 30 * DAY_SECONDS;
const LEGACY_CLIENT_COMPATIBILITY_REVIEW_DUE_SECONDS = 7 * DAY_SECONDS;
const LEGACY_CLIENT_COMPATIBILITY_CRITICAL_SECONDS = DAY_SECONDS;
const MAX_TRACKED_TICKERS = 30;

const REQUIRED_BOOLEAN_FIELDS = [
  "adsEnabled",
  "rewardedCreditEnabled",
  "rewardedSsvReady",
  "chatEnabled",
  "webSupplementEnabled",
  "creditBillingEnabled",
  "consumablePurchasesEnabled",
  "accountRecoveryReady",
  "maintenanceMode",
  "dailyRefreshEnabled",
  "emergencyPaidGrantsDisabled"
];

const REQUIRED_NON_NEGATIVE_INTEGER_FIELDS = [
  "freeStockLimit",
  "freeDailyChatLimit",
  "liteDailyChatLimit",
  "proStockLimit",
  "proDailyChatLimit"
];

function usage() {
  return [
    "Usage:",
    "  node scripts/remote-config-lifecycle.mjs inspect <envelope.json> [--now <ISO-8601>]",
    "  node scripts/remote-config-lifecycle.mjs refresh-reviewed <input.json> <output.json> --approved-config-sha256 <sha256> --version <new-version> [--reviewed-at <ISO-8601>] [--max-stale-age-seconds <seconds>]",
    "",
    "inspect never mutates the envelope. refresh-reviewed changes only reviewed metadata and requires an explicit human-approved config hash.",
    "",
    "Note: since 2026-08-24 an overdue config no longer disables the Worker (see src/lib/remote-config.ts).",
    "The non-zero exit codes here are the reminder — they turn the daily lifecycle-monitor workflow red.",
    "Nothing user-facing breaks while they are red."
  ].join("\n");
}

function parseOptions(values) {
  const positional = [];
  const options = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    options.set(value, next);
    index += 1;
  }
  return { positional, options };
}

function readEnvelope(path) {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) throw new Error(`Envelope does not exist: ${absolutePath}`);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
  validateEnvelope(parsed);
  return { absolutePath, envelope: parsed };
}

function validateEnvelope(envelope) {
  if (!isRecord(envelope)) throw new Error("Envelope must be a JSON object");
  if (!isNonEmptyString(envelope.version)) throw new Error("Envelope version must be non-empty");
  if (!Number.isFinite(Date.parse(envelope.updatedAt))) throw new Error("Envelope updatedAt must be ISO-8601");
  if (!isPositiveInteger(envelope.maxStaleAgeSeconds) || envelope.maxStaleAgeSeconds > MAX_STALE_AGE_SECONDS) {
    throw new Error(`Envelope maxStaleAgeSeconds must be 1..${MAX_STALE_AGE_SECONDS}`);
  }
  if (!isRecord(envelope.config)) throw new Error("Envelope config must be a JSON object");
  validateConfig(envelope.config, envelope.updatedAt);
}

function validateConfig(config, updatedAt) {
  for (const field of REQUIRED_BOOLEAN_FIELDS) {
    if (typeof config[field] !== "boolean") throw new Error(`Config ${field} must be boolean`);
  }
  for (const field of REQUIRED_NON_NEGATIVE_INTEGER_FIELDS) {
    if (!isNonNegativeInteger(config[field])) throw new Error(`Config ${field} must be a non-negative integer`);
  }
  if (config.freeDailyChatLimit < 25) throw new Error("Config freeDailyChatLimit must be at least 25");
  if (!isPositiveInteger(config.dailyRefreshBatchSize) || config.dailyRefreshBatchSize > MAX_TRACKED_TICKERS) {
    throw new Error(`Config dailyRefreshBatchSize must be 1..${MAX_TRACKED_TICKERS}`);
  }
  if (!isPositiveInteger(config.dailyRefreshConcurrency) || config.dailyRefreshConcurrency > 8) {
    throw new Error("Config dailyRefreshConcurrency must be 1..8");
  }
  if (!isNonEmptyString(config.extractorVersion) || !isNonEmptyString(config.promptVersion)) {
    throw new Error("Config extractorVersion and promptVersion must be non-empty");
  }
  if (!isRecord(config.planCredits)
      || config.planCredits.free !== 0
      || ![config.planCredits.lite, config.planCredits.pro, config.planCredits.pro_max].every(isNonNegativeInteger)) {
    throw new Error("Config planCredits must contain non-negative free/lite/pro/pro_max values and free must be 0");
  }
  if (!Array.isArray(config.trackedTickers) || config.trackedTickers.length > MAX_TRACKED_TICKERS) {
    throw new Error(`Config trackedTickers must contain at most ${MAX_TRACKED_TICKERS} values`);
  }
  const normalizedTickers = config.trackedTickers.map((value) => typeof value === "string" ? value.trim().toUpperCase() : "");
  if (normalizedTickers.some((ticker) => !/^[A-Z][A-Z0-9.-]{0,15}$/u.test(ticker))
      || new Set(normalizedTickers).size !== normalizedTickers.length
      || normalizedTickers.some((ticker, index) => ticker !== config.trackedTickers[index])) {
    throw new Error("Config trackedTickers must be unique normalized ticker symbols");
  }
  if (config.rewardedCreditEnabled && !config.adsEnabled) {
    throw new Error("rewardedCreditEnabled requires adsEnabled");
  }
  if (config.rewardedSsvReady && !config.rewardedCreditEnabled) {
    throw new Error("rewardedSsvReady requires rewardedCreditEnabled");
  }
  if (config.consumablePurchasesEnabled && !config.creditBillingEnabled) {
    throw new Error("consumablePurchasesEnabled requires creditBillingEnabled");
  }
  if (!isRecord(config.legacyClientCompatibility)
      || typeof config.legacyClientCompatibility.enabled !== "boolean"
      || !isCanonicalIsoTimestamp(config.legacyClientCompatibility.expiresAt)) {
    throw new Error("Config legacyClientCompatibility must contain boolean enabled and canonical ISO-8601 expiresAt");
  }
  if (config.legacyClientCompatibility.enabled) {
    const updatedAtMs = Date.parse(updatedAt);
    const expiresAtMs = Date.parse(config.legacyClientCompatibility.expiresAt);
    if (expiresAtMs <= updatedAtMs
        || expiresAtMs - updatedAtMs > LEGACY_CLIENT_COMPATIBILITY_MAX_WINDOW_SECONDS * 1_000) {
      throw new Error(
        `Enabled legacyClientCompatibility expiresAt must be after updatedAt and within ${LEGACY_CLIENT_COMPATIBILITY_MAX_WINDOW_SECONDS} seconds`
      );
    }
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function configSha256(envelope) {
  return sha256(stableJson(envelope.config));
}

function lifecycle(envelope, now) {
  const rawAgeSeconds = Math.floor((now - Date.parse(envelope.updatedAt)) / 1_000);
  const ageSeconds = Math.max(0, rawAgeSeconds);
  const reviewDueAgeSeconds = Math.min(REVIEW_DUE_AGE_SECONDS, Math.max(1, Math.floor(envelope.maxStaleAgeSeconds / 2)));
  const criticalLeadSeconds = Math.min(7 * DAY_SECONDS, Math.max(1, Math.floor(envelope.maxStaleAgeSeconds / 5)));
  const criticalAgeSeconds = Math.min(
    CRITICAL_AGE_SECONDS,
    Math.max(reviewDueAgeSeconds, envelope.maxStaleAgeSeconds - criticalLeadSeconds)
  );
  const secondsUntilExpiry = envelope.maxStaleAgeSeconds - ageSeconds;
  const status = rawAgeSeconds < -5 * 60
    ? "future_invalid"
    : ageSeconds > envelope.maxStaleAgeSeconds
      ? "expired"
      : ageSeconds >= criticalAgeSeconds
        ? "critical"
        : ageSeconds >= reviewDueAgeSeconds
          ? "review_due"
          : "fresh";
  return { status, ageSeconds, secondsUntilExpiry, reviewDueAgeSeconds, criticalAgeSeconds };
}

function inspect(path, nowValue) {
  const { absolutePath, envelope } = readEnvelope(path);
  const now = nowValue ? Date.parse(nowValue) : Date.now();
  if (!Number.isFinite(now)) throw new Error("--now must be ISO-8601");
  const state = lifecycle(envelope, now);
  const legacyState = legacyClientCompatibilityLifecycle(envelope, now);
  process.stdout.write(`${JSON.stringify({
    path: absolutePath,
    version: envelope.version,
    updatedAt: envelope.updatedAt,
    maxStaleAgeSeconds: envelope.maxStaleAgeSeconds,
    configSha256: configSha256(envelope),
    legacyClientCompatibility: legacyState,
    ...state
  }, null, 2)}\n`);
  process.exitCode = Math.max(lifecycleExitCode(state.status), lifecycleExitCode(legacyState.status));
}

function legacyClientCompatibilityLifecycle(envelope, now) {
  const gate = envelope.config.legacyClientCompatibility;
  if (!gate.enabled) {
    return { status: "disabled", expiresAt: gate.expiresAt, secondsUntilExpiry: 0 };
  }
  const secondsUntilExpiry = Math.floor((Date.parse(gate.expiresAt) - now) / 1_000);
  return {
    status: secondsUntilExpiry <= 0
      ? "expired"
      : secondsUntilExpiry <= LEGACY_CLIENT_COMPATIBILITY_CRITICAL_SECONDS
        ? "critical"
        : secondsUntilExpiry <= LEGACY_CLIENT_COMPATIBILITY_REVIEW_DUE_SECONDS
          ? "review_due"
          : "active",
    expiresAt: gate.expiresAt,
    secondsUntilExpiry: Math.max(0, Math.min(LEGACY_CLIENT_COMPATIBILITY_MAX_WINDOW_SECONDS, secondsUntilExpiry))
  };
}

function lifecycleExitCode(status) {
  if (status === "future_invalid" || status === "expired") return 3;
  if (status === "critical") return 2;
  if (status === "review_due") return 1;
  return 0;
}

function refreshReviewed(inputPath, outputPath, options) {
  const approvedHash = options.get("--approved-config-sha256")?.trim().toLowerCase();
  const version = options.get("--version")?.trim();
  const reviewedAt = options.get("--reviewed-at") ?? new Date().toISOString();
  const requestedMaxStaleAge = options.get("--max-stale-age-seconds");
  const maxStaleAgeSeconds = requestedMaxStaleAge === undefined
    ? MAX_STALE_AGE_SECONDS
    : Number(requestedMaxStaleAge);
  if (!approvedHash || !/^[a-f0-9]{64}$/u.test(approvedHash)) {
    throw new Error("--approved-config-sha256 must be a 64-character SHA-256");
  }
  if (!version || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(version)) {
    throw new Error("--version must be a new non-empty operational version without spaces");
  }
  if (!isPositiveInteger(maxStaleAgeSeconds) || maxStaleAgeSeconds > MAX_STALE_AGE_SECONDS) {
    throw new Error(`--max-stale-age-seconds must be 1..${MAX_STALE_AGE_SECONDS}`);
  }
  const reviewedAtMs = Date.parse(reviewedAt);
  if (!Number.isFinite(reviewedAtMs) || reviewedAtMs > Date.now() + 5 * 60_000) {
    throw new Error("--reviewed-at must be valid ISO-8601 and not more than five minutes in the future");
  }
  const input = readEnvelope(inputPath);
  const outputAbsolutePath = resolve(outputPath);
  if (input.absolutePath === outputAbsolutePath) throw new Error("Output must differ from input to preserve review evidence");
  if (version === input.envelope.version) throw new Error("--version must differ from the prior envelope version");
  const actualHash = configSha256(input.envelope);
  if (actualHash !== approvedHash) {
    throw new Error(`Approved hash mismatch: expected ${approvedHash}, actual ${actualHash}`);
  }
  const refreshed = {
    version,
    updatedAt: new Date(reviewedAtMs).toISOString(),
    maxStaleAgeSeconds,
    config: input.envelope.config
  };
  validateEnvelope(refreshed);
  writeFileSync(outputAbsolutePath, `${JSON.stringify(refreshed, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    output: outputAbsolutePath,
    version: refreshed.version,
    updatedAt: refreshed.updatedAt,
    maxStaleAgeSeconds: refreshed.maxStaleAgeSeconds,
    configSha256: actualHash,
    configChanged: stableJson(input.envelope.config) !== stableJson(refreshed.config)
  }, null, 2)}\n`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isPositiveInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

try {
  const command = process.argv[2];
  const { positional, options } = parseOptions(process.argv.slice(3));
  if (command === "inspect" && positional.length === 1) {
    inspect(positional[0], options.get("--now"));
  } else if (command === "refresh-reviewed" && positional.length === 2) {
    refreshReviewed(positional[0], positional[1], options);
  } else {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 64;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 65;
}
