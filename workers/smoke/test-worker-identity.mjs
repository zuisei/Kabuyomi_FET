const baseURL = process.env.KABUYOMI_SMOKE_BASE_URL?.trim();
if (!baseURL) throw new Error("KABUYOMI_SMOKE_BASE_URL is required");

const legacyDeviceKey = `identity-smoke-${Date.now()}-${crypto.randomUUID()}`;
const bootstrap = await jsonRequest("/v1/identity/bootstrap", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    bootstrapOperationId: crypto.randomUUID(),
    legacyDeviceKey,
    appAttestCapability: "unavailable"
  })
});
expectStatus(bootstrap, 200, "identity bootstrap");
const credential = bootstrap.body?.credential;
if (!credential?.token || !credential?.principal || !credential?.tokenReference) {
  throw new Error("identity bootstrap returned an incomplete credential");
}
if (credential.attestationStatus !== "unavailable" || credential.creditMode !== "none") {
  throw new Error("CLI bootstrap must remain unverified and receive no welcome credit");
}

const installationHeaders = {
  authorization: `Installation ${credential.token}`,
  "x-kabuyomi-installation-principal": credential.principal,
  "x-kabuyomi-installation-token-reference": credential.tokenReference
};

const usage = await jsonRequest("/v1/usage", { headers: installationHeaders });
expectStatus(usage, 200, "usage");
if (usage.body?.credits?.totalRemaining !== 0) {
  throw new Error("unverified CLI installation unexpectedly received credits");
}
if (usage.body?.creditBillingEnabled !== false ||
    usage.body?.capabilities?.consumablePurchasesEnabled !== false ||
    usage.body?.capabilities?.accountRecoveryReady !== false ||
    usage.body?.capabilities?.rewardedCredit?.enabled !== true ||
    usage.body?.capabilities?.rewardedCredit?.ssvReady !== true) {
  throw new Error("runtime capability output does not match the safe test release state");
}

const search = await jsonRequest("/v1/search?q=AAPL");
expectStatus(search, 200, "search");
if (!Array.isArray(search.body?.items) || search.body.items.length === 0) {
  throw new Error("search returned no AAPL result");
}

const company = await jsonRequest("/v1/company/AAPL", { headers: installationHeaders });
expectStatus(company, 200, "company");
if (company.body?.ticker !== "AAPL" || typeof company.body?.filingKey !== "string") {
  throw new Error("company returned an unexpected payload");
}

const reward = await jsonRequest("/v1/admob/reward-intents", {
  method: "POST",
  headers: {
    ...installationHeaders,
    "content-type": "application/json",
    "x-kabuyomi-ad-unit-id": "ca-app-pub-3940256099942544/1712485313",
    "x-kabuyomi-ad-environment": "test"
  },
  body: "{}"
});
expectStatus(reward, 403, "reward without verified App Attest");
if (reward.body?.error !== "App Attest verification is required") {
  throw new Error("reward route did not fail closed on a missing App Attest assertion");
}

const notification = await jsonRequest("/v1/apple/notifications/v2", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ signedPayload: "invalid.test.payload" })
});
expectStatus(notification, 400, "invalid Apple notification");
if (notification.body?.error !== "Apple notification signature verification failed") {
  throw new Error("Apple signed-data verifier did not reject invalid JWS safely");
}

console.log(JSON.stringify({
  status: "PASS",
  baseURL,
  checks: {
    identityBootstrap: "PASS_UNVERIFIED_NO_CREDIT",
    usageCapabilities: "PASS_BILLING_HIDDEN_REWARDED_TEST_READY",
    search: "PASS",
    company: "PASS",
    appAttestMutationGate: "PASS_FAIL_CLOSED",
    appleSignedDataRuntime: "PASS_CONTROLLED_REJECTION"
  },
  externalChecksStillRequired: ["real-device App Attest", "StoreKit sandbox", "AdMob production SSV"]
}, null, 2));

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${baseURL}${path}`, init);
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function expectStatus(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} expected ${expected}, received ${result.status}: ${result.body?.error ?? "unknown"}`);
  }
}
