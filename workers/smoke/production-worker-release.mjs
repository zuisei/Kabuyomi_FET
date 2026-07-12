import { createHash } from "node:crypto";

const DEFAULT_PRODUCTION_BASE_URL = "https://kabuyomi-api.dznqjmctk7.workers.dev";
const PRODUCTION_HOSTNAME = "kabuyomi-api.dznqjmctk7.workers.dev";
const REVIEWED_CONFIG_VERSION = "production-safe-release-20260711-v3";
const SMOKE_UUID_NAMESPACE = "713f632d-4c5c-5d90-9e9c-11d8fc7f6750";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHECK_ONLY = process.argv.includes("--check-only");
const ticker = "AAPL";
const chatQuestion = "この提出資料の要点を説明してください。";
const quoteText = "Revenue increased while operating margin declined.";

let baseURL = "";

await main().catch((error) => {
  console.error(`[production-release-smoke] FAIL ${safeFailureCode(error)}`);
  process.exitCode = 1;
});

async function main() {
  rejectUnknownArguments();
  baseURL = normalizeAndValidateProductionBaseURL(
    process.env.KABUYOMI_SMOKE_BASE_URL?.trim()
      || process.env.KABUYOMI_PRODUCTION_BASE_URL?.trim()
      || DEFAULT_PRODUCTION_BASE_URL
  );
  assertProductionTargetGuard();

  const identifiers = buildDeterministicIdentifiers();
  assertDeterministicIdentifiers(identifiers);

  if (CHECK_ONLY) {
    printSummary({
      status: "PASS_CHECK_ONLY",
      targetClass: "PRODUCTION_WORKER_ONLY",
      checks: {
        productionTargetGuard: "PASS",
        deterministicUuidIdentifiers: "PASS",
        credentialFreeExecution: "PASS",
        redactedOutputPolicy: "PASS",
        networkRequests: "NOT_RUN"
      }
    });
    return;
  }

  const checks = {};

  await runStep("public search", async () => {
    const response = await requestJson(`/v1/search?q=${encodeURIComponent(ticker)}`);
    expectStatus(response, 200, "public_search_status");
    assert(
      Array.isArray(response.body?.items)
        && response.body.items.some((item) => item?.ticker === ticker),
      "public_search_result_missing"
    );
  });
  checks.publicSearch = "PASS";

  const legacyHeaders = { "x-device-key": identifiers.legacyDeviceKey };
  const legacyUsage = await runStep("fresh legacy compatibility usage", async () => {
    const response = await requestJson("/v1/usage", { headers: legacyHeaders });
    expectStatus(response, 200, "legacy_usage_status");
    assertZeroCreditUsage(response.body, "legacy_usage");
    assertProductionCapabilities(response.body, "legacy_usage");
    return response.body;
  });
  checks.legacyCompatibilityUsage = "PASS";

  const legacyCompany = await runStep("legacy compatibility company read", async () => {
    const response = await requestJson(`/v1/company/${encodeURIComponent(ticker)}`, {
      headers: legacyHeaders
    });
    expectStatus(response, 200, "legacy_company_status");
    assertCompany(response.body, "legacy_company");
    return response.body;
  });
  checks.legacyCompatibilityCompany = "PASS";

  await runStep("legacy chat rejected before model execution", async () => {
    const response = await requestJson("/v1/chat", {
      method: "POST",
      headers: { ...legacyHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        filingKey: legacyCompany.filingKey,
        question: chatQuestion,
        operationId: identifiers.legacyChatOperationId
      })
    });
    expectInsufficientCredits(response, 2, "legacy_chat");
  });
  checks.legacyChatNoModelExecution = "PASS";

  await runStep("legacy quote rejected before model execution", async () => {
    const response = await requestJson("/v1/translate-quote", {
      method: "POST",
      headers: { ...legacyHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        text: quoteText,
        sourceLanguage: "en",
        targetLanguage: "ja",
        operationId: identifiers.legacyQuoteOperationId
      })
    });
    expectInsufficientCredits(response, 1, "legacy_quote");
  });
  checks.legacyQuoteNoModelExecution = "PASS";

  const credential = await runStep("unavailable installation bootstrap without welcome", async () => {
    const response = await requestJson("/v1/identity/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bootstrapOperationId: identifiers.bootstrapOperationId,
        legacyDeviceKey: identifiers.bootstrapLegacyDeviceKey,
        appAttestCapability: "unavailable"
      })
    });
    expectStatus(response, 200, "installation_bootstrap_status");
    const value = response.body?.credential;
    assert(typeof value?.token === "string" && value.token.length > 0, "installation_token_missing");
    assert(typeof value?.principal === "string" && value.principal.length > 0, "installation_principal_missing");
    assert(typeof value?.tokenReference === "string" && value.tokenReference.length > 0,
      "installation_token_reference_missing");
    assert(value.attestationStatus === "unavailable", "installation_attestation_not_unavailable");
    assert(value.creditMode === "none", "installation_credit_mode_not_none");
    assert(response.body?.attestationRequired === false, "installation_attestation_unexpectedly_required");
    return value;
  });
  checks.unavailableBootstrapNoWelcome = "PASS";

  const installationHeaders = {
    authorization: `Installation ${credential.token}`,
    "x-kabuyomi-installation-principal": credential.principal,
    "x-kabuyomi-installation-token-reference": credential.tokenReference
  };

  const installationUsage = await runStep("authenticated zero-credit usage", async () => {
    const response = await requestJson("/v1/usage", { headers: installationHeaders });
    expectStatus(response, 200, "installation_usage_status");
    assertZeroCreditUsage(response.body, "installation_usage");
    assertProductionCapabilities(response.body, "installation_usage");
    return response.body;
  });
  checks.authenticatedUsage = "PASS";

  await runStep("authenticated company read", async () => {
    const response = await requestJson(`/v1/company/${encodeURIComponent(ticker)}`, {
      headers: installationHeaders
    });
    expectStatus(response, 200, "installation_company_status");
    assertCompany(response.body, "installation_company");
    assert(response.body.filingKey === legacyCompany.filingKey, "installation_company_filing_mismatch");
  });
  checks.authenticatedCompany = "PASS";

  await runStep("new-installation chat rejected before model execution", async () => {
    const response = await requestJson("/v1/chat", {
      method: "POST",
      headers: { ...installationHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        filingKey: legacyCompany.filingKey,
        question: chatQuestion,
        operationId: identifiers.installationChatOperationId
      })
    });
    expectInsufficientCredits(response, 2, "installation_chat");
  });
  checks.installationChatNoModelExecution = "PASS";

  await runStep("new-installation quote rejected before model execution", async () => {
    const response = await requestJson("/v1/translate-quote", {
      method: "POST",
      headers: { ...installationHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        text: quoteText,
        sourceLanguage: "en",
        targetLanguage: "ja",
        operationId: identifiers.installationQuoteOperationId
      })
    });
    expectInsufficientCredits(response, 1, "installation_quote");
  });
  checks.installationQuoteNoModelExecution = "PASS";

  await runStep("paid and account routes fail before Apple work", async () => {
    await expectCapabilityDisabled(
      "/v1/billing/sync",
      {
        originalTransactionId: identifiers.billingOriginalTransactionId,
        signedTransactionInfo: "invalid.invalid.invalid"
      },
      installationHeaders,
      "Subscription billing is temporarily unavailable",
      "billing_sync"
    );
    await expectCapabilityDisabled(
      "/v1/ios/subscriptions/sync",
      {
        originalTransactionId: identifiers.subscriptionOriginalTransactionId,
        signedTransactionInfo: "invalid.invalid.invalid"
      },
      installationHeaders,
      "Subscription billing is temporarily unavailable",
      "subscription_sync"
    );
    await expectCapabilityDisabled(
      "/v1/ios/purchases/credits/complete",
      {
        productId: "kabuyomi.credits.100",
        transactionId: identifiers.consumableTransactionId,
        signedTransactionInfo: "invalid.invalid.invalid"
      },
      installationHeaders,
      "Credit purchases are temporarily unavailable",
      "consumable_purchase"
    );
    await expectCapabilityDisabled(
      "/v1/account/apple/session",
      { identityToken: "invalid.invalid.invalid" },
      installationHeaders,
      "Account recovery is temporarily unavailable",
      "account_session"
    );
  });
  checks.billingDisabledBeforeApple = "PASS";
  checks.subscriptionDisabledBeforeApple = "PASS";
  checks.consumableDisabledBeforeApple = "PASS";
  checks.accountDisabledBeforeApple = "PASS";

  await runStep("invalid SSV rejected without grant", async () => {
    const response = await requestJson("/v1/admob/ssv?key_id=invalid&signature=invalid");
    expectStatus(response, 401, "invalid_ssv_status");
    expectError(response, "invalid_signature", "invalid_ssv_error");
  });
  checks.invalidSsvNoGrant = "PASS";

  const appleNotificationRejection = await runStep("invalid Apple notification rejected without grant", async () => {
    const response = await requestJson("/v1/apple/notifications/v2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedPayload: "invalid.invalid.invalid" })
    });
    if (response.status === 400) {
      expectError(
        response,
        "Apple notification signature verification failed",
        "invalid_apple_notification_error"
      );
      return "PASS_INVALID_SIGNATURE_REJECTED";
    }
    expectStatus(response, 503, "invalid_apple_notification_status");
    expectError(
      response,
      "Apple transaction verification is not configured",
      "invalid_apple_notification_fail_closed_error"
    );
    return "PASS_FAIL_CLOSED_NOT_CONFIGURED";
  });
  checks.invalidAppleNotificationNoGrant = appleNotificationRejection;

  const finalLegacyUsage = await runStep("final legacy balance remains zero", async () => {
    const response = await requestJson("/v1/usage", { headers: legacyHeaders });
    expectStatus(response, 200, "final_legacy_usage_status");
    assertZeroCreditUsage(response.body, "final_legacy_usage");
    return response.body;
  });
  assertCreditBalancesStable(legacyUsage, finalLegacyUsage, "legacy_credit_balance_changed");
  checks.finalLegacyBalanceZero = "PASS";

  const finalInstallationUsage = await runStep("final installation balance remains zero", async () => {
    const response = await requestJson("/v1/usage", { headers: installationHeaders });
    expectStatus(response, 200, "final_installation_usage_status");
    assertZeroCreditUsage(response.body, "final_installation_usage");
    return response.body;
  });
  assertCreditBalancesStable(
    installationUsage,
    finalInstallationUsage,
    "installation_credit_balance_changed"
  );
  checks.finalInstallationBalanceZero = "PASS";

  const appleNotificationsReady = appleNotificationRejection === "PASS_INVALID_SIGNATURE_REJECTED";
  printSummary({
    status: appleNotificationsReady ? "PASS" : "PASS_WITH_CAPABILITY_DISABLED",
    targetClass: "PRODUCTION_WORKER_ONLY",
    checks,
    disabledCapabilities: appleNotificationsReady ? [] : ["app_store_server_notifications"],
    outstandingExternalActions: appleNotificationsReady ? [] : ["configure_numeric_apple_app_id_and_verify_live_delivery"],
    chargeableModelRequests: "NONE",
    customerIdentitiesUsed: "NONE",
    credentialsPrinted: "NONE",
    rawIdentifiersPrinted: "NONE",
    userContentPrinted: "NONE"
  });
}

function buildDeterministicIdentifiers() {
  const labels = {
    legacyDeviceKey: "legacy-device-key",
    bootstrapLegacyDeviceKey: "bootstrap-legacy-device-key",
    bootstrapOperationId: "bootstrap-operation",
    legacyChatOperationId: "legacy-chat-operation",
    legacyQuoteOperationId: "legacy-quote-operation",
    installationChatOperationId: "installation-chat-operation",
    installationQuoteOperationId: "installation-quote-operation",
    billingOriginalTransactionId: "billing-original-transaction",
    subscriptionOriginalTransactionId: "subscription-original-transaction",
    consumableTransactionId: "consumable-transaction"
  };
  return Object.fromEntries(
    Object.entries(labels).map(([key, label]) => [key, uuidV5(`production-release-smoke-v1:${label}`)])
  );
}

function assertDeterministicIdentifiers(identifiers) {
  const values = Object.values(identifiers);
  assert(values.every((value) => UUID_PATTERN.test(value)), "deterministic_uuid_invalid");
  assert(new Set(values).size === values.length, "deterministic_uuid_collision");
  assert(
    stableJson(identifiers) === stableJson(buildDeterministicIdentifiers()),
    "deterministic_uuid_unstable"
  );
}

function uuidV5(name) {
  assert(UUID_PATTERN.test(SMOKE_UUID_NAMESPACE), "uuid_namespace_invalid");
  const namespace = Uint8Array.from(
    Buffer.from(SMOKE_UUID_NAMESPACE.replaceAll("-", ""), "hex")
  );
  const bytes = Uint8Array.from(
    createHash("sha1").update(namespace).update(name, "utf8").digest().subarray(0, 16)
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function expectCapabilityDisabled(path, body, headers, expectedError, label) {
  const response = await requestJson(path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  expectStatus(response, 503, `${label}_status`);
  expectError(response, expectedError, `${label}_error`);
}

function expectInsufficientCredits(response, creditsRequired, label) {
  expectStatus(response, 402, `${label}_status`);
  expectError(response, "insufficient_credits", `${label}_error`);
  assert(response.body?.creditsRequired === creditsRequired, `${label}_required_credits_mismatch`);
  assert(response.body?.creditsRemaining === 0, `${label}_remaining_credits_nonzero`);
}

function assertCompany(value, label) {
  assert(value?.ticker === ticker, `${label}_ticker_mismatch`);
  assert(typeof value?.filingKey === "string" && value.filingKey.length > 0, `${label}_filing_missing`);
  assert(value?.status !== "failed_retryable", `${label}_retryable_failure`);
}

function assertZeroCreditUsage(value, label) {
  assertUsageShape(value, `${label}_shape`);
  assert(value?.plan === "free", `${label}_plan_not_free`);
  assert(value?.credits?.monthlyLimit === 0, `${label}_monthly_limit_nonzero`);
  assert(value?.credits?.monthlyRemaining === 0, `${label}_monthly_remaining_nonzero`);
  assert(value?.credits?.welcomeRemaining === 0, `${label}_welcome_remaining_nonzero`);
  assert(value?.credits?.rewardedAdRemaining === 0, `${label}_reward_remaining_nonzero`);
  assert(value?.credits?.purchasedRemaining === 0, `${label}_purchased_remaining_nonzero`);
  assert(value?.credits?.totalRemaining === 0, `${label}_total_remaining_nonzero`);
}

function assertProductionCapabilities(value, label) {
  assert(["kv", "d1_lkg"].includes(value?.capabilities?.configSource), `${label}_config_source_untrusted`);
  assert(value?.capabilities?.configVersion === REVIEWED_CONFIG_VERSION, `${label}_config_version_mismatch`);
  assert(value?.capabilities?.chatEnabled === true, `${label}_chat_disabled`);
  assert(value?.creditBillingEnabled === false, `${label}_billing_not_disabled`);
  assert(value?.capabilities?.consumablePurchasesEnabled === false, `${label}_consumables_not_disabled`);
  assert(value?.capabilities?.accountRecoveryReady === false, `${label}_account_not_disabled`);
  assert(value?.capabilities?.rewardedCredit?.enabled === false, `${label}_reward_capability_enabled`);
  assert(
    value?.capabilities?.rewardedCredit?.rewardedCreditEnabled === false,
    `${label}_reward_config_enabled`
  );
  assert(value?.capabilities?.rewardedCredit?.ssvReady === false, `${label}_reward_ssv_ready`);
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

function assertCreditBalancesStable(first, second, code) {
  const project = (value) => ({
    monthlyLimit: value?.credits?.monthlyLimit,
    monthlyRemaining: value?.credits?.monthlyRemaining,
    welcomeRemaining: value?.credits?.welcomeRemaining,
    rewardedAdRemaining: value?.credits?.rewardedAdRemaining,
    purchasedRemaining: value?.credits?.purchasedRemaining,
    totalRemaining: value?.credits?.totalRemaining
  });
  assert(stableJson(project(first)) === stableJson(project(second)), code);
}

async function runStep(label, operation) {
  process.stdout.write(`[production-release-smoke] ${label} ... `);
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
  let response;
  try {
    response = await fetch(`${baseURL}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
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
  return { status: response.status, body };
}

function expectStatus(response, expected, code) {
  assert(response.status === expected, code);
}

function expectError(response, expected, code) {
  assert(response.body?.error === expected, code);
}

function rejectUnknownArguments() {
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--check-only");
  assert(unknown.length === 0, "unsupported_argument");
}

function normalizeAndValidateProductionBaseURL(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("production_target_url_invalid");
  }
  assert(url.protocol === "https:", "production_target_https_required");
  assert(url.hostname === PRODUCTION_HOSTNAME, "non_production_target_rejected");
  assert(url.port === "", "production_target_port_rejected");
  assert(url.username === "" && url.password === "", "production_target_credentials_rejected");
  assert(url.pathname === "/" && url.search === "" && url.hash === "", "production_target_must_be_origin");
  return url.origin;
}

function assertProductionTargetGuard() {
  assert(
    normalizeAndValidateProductionBaseURL(DEFAULT_PRODUCTION_BASE_URL) === DEFAULT_PRODUCTION_BASE_URL,
    "production_target_default_rejected"
  );
  const rejectedTargets = [
    "https://kabuyomi-api-test.dznqjmctk7.workers.dev",
    "https://kabuyomi-api-staging.dznqjmctk7.workers.dev",
    "http://kabuyomi-api.dznqjmctk7.workers.dev",
    "https://localhost",
    "https://kabuyomi-api.dznqjmctk7.workers.dev/v1/usage",
    "https://user:password@kabuyomi-api.dznqjmctk7.workers.dev"
  ];
  for (const target of rejectedTargets) {
    let rejected = false;
    try {
      normalizeAndValidateProductionBaseURL(target);
    } catch {
      rejected = true;
    }
    assert(rejected, "production_target_guard_incomplete");
  }
}

function assert(condition, code) {
  if (!condition) fail(code);
}

function fail(code) {
  const error = new Error(code);
  error.name = "SmokeFailure";
  throw error;
}

function safeFailureCode(error) {
  if (error instanceof Error && error.name === "SmokeFailure" && /^[a-z0-9_]+$/u.test(error.message)) {
    return error.message;
  }
  return "unexpected_smoke_failure";
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
}
