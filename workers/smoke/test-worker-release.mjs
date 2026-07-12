import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_TEST_BASE_URL = "https://kabuyomi-api-test.dznqjmctk7.workers.dev";
const TEST_AD_UNIT_ID = "ca-app-pub-3940256099942544/1712485313";
const CHECK_ONLY = process.argv.includes("--check-only");
const rootDir = resolve(new URL("..", import.meta.url).pathname);
let baseURL;
try {
  baseURL = normalizeAndValidateTestBaseURL(
    process.env.KABUYOMI_SMOKE_BASE_URL?.trim()
      || process.env.KABUYOMI_TEST_BASE_URL?.trim()
      || DEFAULT_TEST_BASE_URL
  );
} catch (error) {
  console.error(`[release-smoke] FAIL ${safeFailureCode(error)}`);
  process.exit(1);
}
const devVars = readDevVars(join(rootDir, ".dev.vars"));
const testAutomationSecret = process.env.KABUYOMI_TEST_AUTOMATION_SECRET?.trim()
  || devVars.KABUYOMI_TEST_AUTOMATION_SECRET?.trim()
  || "";

if (!testAutomationSecret) {
  console.error("[release-smoke] FAIL test_automation_secret_missing");
  process.exit(1);
}

if (CHECK_ONLY) {
  printSummary({
    status: "PASS_CHECK_ONLY",
    checks: {
      dedicatedTestTargetGuard: "PASS",
      secretPresenceWithoutDisclosure: "PASS",
      networkRequests: "NOT_RUN"
    },
    externalChecksStillRequired: externalChecksStillRequired()
  });
  process.exit(0);
}

const testAutomationHeaders = {
  "x-kabuyomi-test-authorization": testAutomationSecret
};
const smokeSeed = createHash("sha256")
  .update(`kabuyomi-test-worker-release-smoke-v1\0${baseURL}`)
  .digest("hex");
const bootstrapOperationId = `release-smoke-bootstrap-${smokeSeed.slice(0, 32)}`;
const legacyDeviceKey = `release-smoke-legacy-${smokeSeed.slice(32)}`;
const legacyDetachedDeviceKey = `release-smoke-detached-${smokeSeed.slice(0, 24)}`;
const ticker = "AAPL";
const primaryQuestion = "この企業は何をしている会社ですか？";
const changedQuestion = "売上高の主な変化を説明してください。";
const concurrentQuestion = "最新の提出資料の要点を説明してください。";
const quoteText = "Revenue increased while operating margin declined.";
const checks = {};

try {
  const capabilityUsage = await runStep("dual-test environment and remote config", async () => {
    const response = await requestJson("/v1/usage", { headers: testAutomationHeaders });
    expectStatus(response, 200, "dual_test_usage_status");
    assert(response.body?.accessMode === "dev_unlimited", "dual_test_access_mode_missing");
    assertTrustedRemoteConfigAndCapabilities(response.body);
    return response.body;
  });
  checks.dualTestEnvironment = "PASS";
  checks.remoteConfigAndCapabilities = "PASS";

  await runStep("legacy detached access rejection", async () => {
    const response = await requestJson("/v1/usage", {
      headers: {
        "x-device-key": legacyDetachedDeviceKey,
        "x-kabuyomi-detached-access": "dev_unlimited"
      }
    });
    expectStatus(response, 401, "legacy_detached_status");
    expectError(response, "Installation credential is required", "legacy_detached_error");
  });
  checks.legacyDetachedAccessRejected = "PASS";

  const credential = await runStep("unavailable identity bootstrap without welcome", async () => {
    const response = await requestJson("/v1/identity/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bootstrapOperationId,
        legacyDeviceKey,
        appAttestCapability: "unavailable"
      })
    });
    expectStatus(response, 200, "identity_bootstrap_status");
    const value = response.body?.credential;
    assert(typeof value?.token === "string" && value.token.length > 0, "identity_token_missing");
    assert(typeof value?.principal === "string" && value.principal.length > 0, "identity_principal_missing");
    assert(typeof value?.tokenReference === "string" && value.tokenReference.length > 0, "identity_reference_missing");
    assert(value.attestationStatus === "unavailable", "identity_attestation_not_unavailable");
    assert(value.creditMode === "none", "identity_credit_mode_not_none");
    assert(response.body?.attestationRequired === false, "identity_attestation_unexpectedly_required");
    return value;
  });
  checks.unavailableBootstrapNoWelcome = "PASS";

  const installationHeaders = {
    authorization: `Installation ${credential.token}`,
    "x-kabuyomi-installation-principal": credential.principal,
    "x-kabuyomi-installation-token-reference": credential.tokenReference
  };

  const installationUsage = await runStep("unavailable identity usage", async () => {
    const response = await requestJson("/v1/usage", { headers: installationHeaders });
    expectStatus(response, 200, "installation_usage_status");
    assertUsageShape(response.body, "installation_usage_shape");
    assert(response.body?.plan === "free", "installation_usage_plan");
    assert(response.body?.credits?.welcomeRemaining === 0, "installation_welcome_credit_nonzero");
    assert(response.body?.credits?.totalRemaining === 0, "installation_total_credit_nonzero");
    assertDisabledBillingCapabilities(response.body);
    return response.body;
  });
  checks.unavailableIdentityUsage = "PASS";

  await runStep("public search", async () => {
    const response = await requestJson(`/v1/search?q=${encodeURIComponent(ticker)}`);
    expectStatus(response, 200, "search_status");
    assert(Array.isArray(response.body?.items) && response.body.items.length > 0, "search_items_missing");
  });
  checks.publicSearch = "PASS";

  const company = await runStep("cached company core route", async () => {
    const first = await requestJson(`/v1/company/${encodeURIComponent(ticker)}`, {
      headers: installationHeaders
    });
    expectStatus(first, 200, "company_first_status");
    assert(first.body?.ticker === ticker, "company_ticker_mismatch");
    assert(typeof first.body?.filingKey === "string" && first.body.filingKey.length > 0, "company_filing_key_missing");
    assert(first.body?.status !== "failed_retryable", "company_cache_unavailable");

    const second = await requestJson(`/v1/company/${encodeURIComponent(ticker)}`, {
      headers: installationHeaders
    });
    expectStatus(second, 200, "company_second_status");
    assert(second.body?.filingKey === first.body.filingKey, "company_filing_key_not_stable");
    return first.body;
  });
  checks.cachedCompanyCoreRoute = "PASS";

  await runStep("watchlist add and remove", async () => {
    await removeTickerSafely(installationHeaders);
    const baseline = await requestJson("/v1/usage", { headers: installationHeaders });
    expectStatus(baseline, 200, "watchlist_baseline_status");
    assertUsageShape(baseline.body, "watchlist_baseline_shape");

    const added = await requestJson("/v1/watchlist/add", {
      method: "POST",
      headers: { ...installationHeaders, "content-type": "application/json" },
      body: JSON.stringify({ ticker })
    });
    expectStatus(added, 200, "watchlist_add_status");
    assert(added.body?.company?.ticker === ticker, "watchlist_add_ticker_mismatch");
    assertUsageShape(added.body?.usage, "watchlist_add_usage_shape");
    assert(added.body.usage.stocksUsed === baseline.body.stocksUsed + 1, "watchlist_add_delta");

    const removed = await requestJson("/v1/watchlist/remove", {
      method: "POST",
      headers: { ...installationHeaders, "content-type": "application/json" },
      body: JSON.stringify({ ticker })
    });
    expectStatus(removed, 200, "watchlist_remove_status");
    assertUsageShape(removed.body?.usage, "watchlist_remove_usage_shape");
    assert(removed.body.usage.stocksUsed === baseline.body.stocksUsed, "watchlist_remove_delta");
  });
  checks.watchlistRoundTrip = "PASS";

  await runStep("exact operation replay and payload conflict", async () => {
    const operationId = randomUUID();
    const body = {
      filingKey: company.filingKey,
      question: primaryQuestion,
      operationId
    };
    const first = await postChat(body);
    expectStatus(first, 200, "chat_initial_status");
    assertChatShape(first.body, "chat_initial_shape");

    const replay = await postChat(body);
    expectStatus(replay, 200, "chat_replay_status");
    assertChatShape(replay.body, "chat_replay_shape");
    assertStableChatResult(first.body, replay.body, "chat_replay_result_mismatch");

    const mismatch = await postChat({ ...body, question: changedQuestion });
    expectStatus(mismatch, 409, "chat_payload_mismatch_status");
    expectError(mismatch, "operation_id_payload_mismatch", "chat_payload_mismatch_error");
  });
  checks.exactOperationReplay = "PASS";
  checks.changedPayloadConflict = "PASS";

  await runStep("concurrent duplicate operation", async () => {
    const body = {
      filingKey: company.filingKey,
      question: concurrentQuestion,
      operationId: randomUUID()
    };
    const responses = await Promise.all([postChat(body), postChat(body)]);
    for (const response of responses) {
      assert(response.status === 200 || response.status === 202, "concurrent_duplicate_unexpected_status");
      if (response.status === 202) {
        expectError(response, "execution_pending", "concurrent_duplicate_pending_error");
      } else {
        assertChatShape(response.body, "concurrent_duplicate_chat_shape");
      }
    }

    const completed = await pollForCompletedChat(body);
    for (const response of responses.filter((item) => item.status === 200)) {
      assertStableChatResult(response.body, completed.body, "concurrent_duplicate_result_mismatch");
    }
  });
  checks.concurrentDuplicateRequests = "PASS";

  const quoteTranslation = await runStep("quote translation", checkQuoteTranslation);
  checks.quoteTranslation = quoteTranslation.transientRetries > 0
    ? `PASS_AFTER_${quoteTranslation.transientRetries}_TRANSIENT_RETRY`
    : "PASS";

  await runStep("billing and account routes fail safely while disabled", async () => {
    await expectCapabilityDisabled("/v1/billing/sync", {
      originalTransactionId: `release-smoke-subscription-${randomUUID()}`
    }, installationHeaders, "billing_sync");
    await expectCapabilityDisabled("/v1/ios/subscriptions/sync", {
      originalTransactionId: `release-smoke-subscription-${randomUUID()}`
    }, installationHeaders, "subscription_sync");
    await expectCapabilityDisabled("/v1/ios/purchases/credits/complete", {
      productId: "kabuyomi.credits.100",
      transactionId: `release-smoke-consumable-${randomUUID()}`,
      signedTransactionInfo: "invalid.test.payload"
    }, installationHeaders, "consumable_purchase");

    const account = await requestJson("/v1/account/apple/session", {
      method: "POST",
      headers: { ...installationHeaders, "content-type": "application/json" },
      body: JSON.stringify({ identityToken: "invalid-account-token-with-no-user-data-000000000000" })
    });
    expectStatus(account, 503, "account_rejection_status");
    expectError(account, "Account recovery is temporarily unavailable", "account_rejection_error");
    assert(!account.body?.credential, "account_rejection_returned_credential");
  });
  checks.billingDisabledRejection = "PASS";
  checks.subscriptionDisabledRejection = "PASS";
  checks.consumableDisabledRejection = "PASS";
  checks.accountDisabledRejection = "PASS";

  await runStep("invalid Apple notification JWS", async () => {
    const response = await requestJson("/v1/apple/notifications/v2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedPayload: "invalid.test.payload" })
    });
    expectStatus(response, 400, "apple_notification_status");
    expectError(response, "Apple notification signature verification failed", "apple_notification_error");
  });
  checks.invalidAppleNotificationRejected = "PASS";

  await runStep("reward intent strict gate", async () => {
    const response = await requestJson("/v1/admob/reward-intents", {
      method: "POST",
      headers: {
        ...installationHeaders,
        "content-type": "application/json",
        "x-kabuyomi-ad-unit-id": TEST_AD_UNIT_ID,
        "x-kabuyomi-ad-environment": "test"
      },
      body: "{}"
    });
    expectStatus(response, 403, "reward_strict_gate_status");
    expectError(response, "App Attest verification is required", "reward_strict_gate_error");
  });
  checks.rewardIntentStrictGate = "PASS";

  await runStep("test-only reward intent and invalid SSV rejection", async () => {
    const intent = await requestJson("/v1/admob/reward-intents", {
      method: "POST",
      headers: {
        ...testAutomationHeaders,
        "content-type": "application/json",
        "x-kabuyomi-ad-unit-id": TEST_AD_UNIT_ID,
        "x-kabuyomi-ad-environment": "test"
      },
      body: "{}"
    });
    expectStatus(intent, 200, "reward_test_intent_status");
    assert(typeof intent.body?.rewardIntentId === "string" && intent.body.rewardIntentId.length > 0,
      "reward_test_intent_id_missing");
    assert(typeof intent.body?.customData === "string" && intent.body.customData.length > 0,
      "reward_test_custom_data_missing");

    const invalidSsvQuery = new URLSearchParams({
      key_id: "invalid",
      signature: "invalid"
    });
    const invalidSsv = await requestJson(`/v1/admob/ssv?${invalidSsvQuery.toString()}`);
    expectStatus(invalidSsv, 401, "reward_invalid_ssv_status");
    expectError(invalidSsv, "invalid_signature", "reward_invalid_ssv_error");

    const usageAfterInvalidSsv = await requestJson("/v1/usage", { headers: testAutomationHeaders });
    expectStatus(usageAfterInvalidSsv, 200, "reward_usage_after_invalid_ssv");
    assert(
      usageAfterInvalidSsv.body?.credits?.totalRemaining === capabilityUsage.credits?.totalRemaining,
      "reward_invalid_ssv_changed_credit_balance"
    );
  });
  checks.testOnlyRewardIntent = "PASS";
  checks.invalidSsvNoGrant = "PASS";

  const finalInstallationUsage = await runStep("no-credit postcondition", async () => {
    const response = await requestJson("/v1/usage", { headers: installationHeaders });
    expectStatus(response, 200, "final_installation_usage_status");
    assert(response.body?.credits?.welcomeRemaining === 0, "final_welcome_credit_nonzero");
    assert(response.body?.credits?.totalRemaining === 0, "final_total_credit_nonzero");
    return response.body;
  });
  assert(
    finalInstallationUsage.credits.totalRemaining === installationUsage.credits.totalRemaining,
    "installation_credit_balance_changed"
  );
  checks.noCreditGrantPostcondition = "PASS";

  printSummary({
    status: "PASS",
    targetClass: "DEDICATED_TEST_WORKER",
    checks,
    productionMutations: "NONE",
    externalChecksStillRequired: externalChecksStillRequired()
  });
} catch (error) {
  console.error(`[release-smoke] FAIL ${safeFailureCode(error)}`);
  process.exit(1);
}

async function postChat(body) {
  return requestJson("/v1/chat", {
    method: "POST",
    headers: { ...testAutomationHeaders, "content-type": "application/json" },
    body: JSON.stringify(body)
  }, { timeoutMs: 75_000 });
}

async function checkQuoteTranslation() {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await requestJson("/v1/translate-quote", {
      method: "POST",
      headers: { ...testAutomationHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        text: quoteText,
        sourceLanguage: "en",
        targetLanguage: "ja",
        operationId: randomUUID()
      })
    }, { timeoutMs: 75_000 });

    if (response.status === 200) {
      assert(typeof response.body?.translatedText === "string" && response.body.translatedText.trim().length > 0,
        "quote_translation_text_missing");
      assert(typeof response.body?.modelName === "string" && response.body.modelName.trim().length > 0,
        "quote_translation_model_missing");
      return { transientRetries: attempt - 1 };
    }

    const retryableStatus = response.status === 429 || (response.status >= 500 && response.status <= 599);
    if (!retryableStatus || attempt === maxAttempts) {
      fail(statusFailureCode(response, 200, "quote_translation_status", attempt));
    }
    await delay(500);
  }

  fail("quote_translation_unreachable");
}

async function pollForCompletedChat(body) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await postChat(body);
    if (response.status === 200) {
      assertChatShape(response.body, "concurrent_duplicate_completed_shape");
      return response;
    }
    if (response.status !== 202 || response.body?.error !== "execution_pending") {
      fail("concurrent_duplicate_poll_failed");
    }
    await delay(250);
  }
  fail("concurrent_duplicate_poll_timeout");
}

async function removeTickerSafely(headers) {
  const response = await requestJson("/v1/watchlist/remove", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ ticker })
  });
  expectStatus(response, 200, "watchlist_cleanup_status");
}

async function expectCapabilityDisabled(path, body, headers, label) {
  const response = await requestJson(path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  expectStatus(response, 503, `${label}_status`);
  const expectedError = label === "consumable_purchase"
    ? "Credit purchases are temporarily unavailable"
    : "Subscription billing is temporarily unavailable";
  expectError(response, expectedError, `${label}_error`);
}

function assertTrustedRemoteConfigAndCapabilities(usage) {
  assert(typeof usage?.capabilities?.configVersion === "string" && usage.capabilities.configVersion.trim().length > 0,
    "remote_config_version_missing");
  assert(["kv", "d1_lkg"].includes(usage.capabilities.configSource), "remote_config_source_untrusted");
  assert(usage.capabilities.chatEnabled === true, "remote_config_chat_disabled");
  assert(usage.capabilities.webSupplementEnabled === false, "remote_config_web_unexpectedly_enabled");
  assertDisabledBillingCapabilities(usage);
  const reward = usage.capabilities.rewardedCredit;
  assert(reward?.enabled === true, "reward_capability_disabled");
  assert(reward?.ssvReady === true, "reward_ssv_not_ready");
  assert(reward?.environment === "test", "reward_environment_not_test");
  assert(reward?.emergencyDisabled === false, "reward_emergency_disabled");
}

function assertDisabledBillingCapabilities(usage) {
  assert(usage?.creditBillingEnabled === false, "billing_capability_not_disabled");
  assert(usage?.capabilities?.consumablePurchasesEnabled === false, "consumable_capability_not_disabled");
  assert(usage?.capabilities?.accountRecoveryReady === false, "account_capability_not_disabled");
}

function assertUsageShape(value, code) {
  assert(
    Number.isInteger(value?.chatsUsed)
      && Number.isInteger(value?.chatLimit)
      && Number.isInteger(value?.stocksUsed)
      && Number.isInteger(value?.stockLimit),
    code
  );
}

function assertChatShape(value, code) {
  assert(
    typeof value?.answer === "string"
      && Array.isArray(value?.sources)
      && typeof value?.responsePath === "string"
      && (typeof value?.modelName === "string" || value?.modelName === null)
      && typeof value?.creditsCharged === "number",
    code
  );
}

function assertStableChatResult(first, second, code) {
  const firstProjection = stableJson({
    answer: first.answer,
    sources: first.sources,
    responsePath: first.responsePath,
    modelName: first.modelName,
    creditsCharged: first.creditsCharged
  });
  const secondProjection = stableJson({
    answer: second.answer,
    sources: second.sources,
    responsePath: second.responsePath,
    modelName: second.modelName,
    creditsCharged: second.creditsCharged
  });
  assert(firstProjection === secondProjection, code);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function runStep(label, operation) {
  process.stdout.write(`[release-smoke] ${label} ... `);
  try {
    const result = await operation();
    console.log("PASS");
    return result;
  } catch (error) {
    console.log("FAIL");
    throw error;
  }
}

async function requestJson(path, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  let response;
  try {
    response = await fetch(`${baseURL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    fail("network_request_failed");
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, body };
}

function expectStatus(response, expected, code) {
  if (response.status !== expected) {
    fail(statusFailureCode(response, expected, code));
  }
}

function expectError(response, expected, code) {
  assert(response.body?.error === expected, code);
}

function assert(condition, code) {
  if (!condition) fail(code);
}

function fail(code) {
  const error = new Error(code);
  error.name = "SmokeFailure";
  throw error;
}

function statusFailureCode(response, expected, code, attempts = 1) {
  const actual = Number.isInteger(response?.status) ? response.status : 0;
  const errorClass = safeResponseErrorClass(response);
  return `${code}_expected_${expected}_got_${actual}_${errorClass}_attempts_${attempts}`;
}

function safeResponseErrorClass(response) {
  const value = typeof response?.body?.error === "string" ? response.body.error.trim() : "";
  if (!value) return "no_error_code";
  const normalized = value.toLowerCase();
  if (/^[a-z][a-z0-9_]{0,63}$/u.test(normalized)) return normalized;
  if (normalized === "internal server error") return "internal_server_error";
  if (normalized.includes("temporarily unavailable")) return "temporarily_unavailable";
  if (normalized.includes("under maintenance")) return "maintenance";
  if (normalized.includes("required")) return "required_input";
  if (normalized.includes("not found")) return "not_found";
  if (normalized.includes("failed")) return "request_failed";
  return "public_error";
}

function safeFailureCode(error) {
  if (error instanceof Error && error.name === "SmokeFailure" && /^[a-z0-9_]+$/u.test(error.message)) {
    return error.message;
  }
  return "unexpected_smoke_failure";
}

function normalizeAndValidateTestBaseURL(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("test_target_url_invalid");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  const dedicatedWorkersDev = url.hostname.endsWith(".workers.dev")
    && url.hostname.split(".")[0] === "kabuyomi-api-test";
  assert(local || dedicatedWorkersDev, "non_test_target_rejected");
  assert(local || url.protocol === "https:", "test_target_https_required");
  assert(url.username === "" && url.password === "", "test_target_credentials_rejected");
  assert(url.pathname === "/" && url.search === "" && url.hash === "", "test_target_must_be_origin");
  return url.origin;
}

function readDevVars(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
    if (!match) continue;
    values[match[1]] = parseDevVarValue(match[2]);
  }
  return values;
}

function parseDevVarValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function externalChecksStillRequired() {
  return [
    "real-device App Attest attestation and monotonic assertion counters",
    "valid Google-signed AdMob SSV grant and duplicate callback",
    "StoreKit sandbox purchase, subscription, restore, and duplicate no-op",
    "valid Apple signed notification refund, reversal, and consumption request",
    "valid Sign in with Apple account session and recovery"
  ];
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
}
