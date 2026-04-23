const baseURL = process.env.KABUYOMI_SMOKE_BASE_URL?.trim();
const customDeviceKey = process.env.KABUYOMI_SMOKE_DEVICE_KEY?.trim();
const deviceKey = customDeviceKey || `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ticker = process.env.KABUYOMI_SMOKE_TICKER?.trim().toUpperCase() || "AAPL";
const searchQuery = process.env.KABUYOMI_SMOKE_SEARCH_QUERY?.trim() || ticker;
const chatQuestion = process.env.KABUYOMI_SMOKE_CHAT_QUESTION?.trim() || "売上高は？";
const historyQuestion = process.env.KABUYOMI_SMOKE_HISTORY_QUESTION?.trim() || "この3年の売上推移は？";
const validResponsePaths = new Set(["historical", "deterministic", "fallback", "gemini"]);

if (!baseURL) {
  console.error(
    "KABUYOMI_SMOKE_BASE_URL is required, for example: KABUYOMI_SMOKE_BASE_URL=https://kabuyomi-api.example.workers.dev npm run smoke:staging"
  );
  process.exit(1);
}

async function main() {
  const initialUsage = await runStep("usage-baseline", checkUsageBaseline);
  await runStep("search", checkSearch);
  const addResult = await runStep("watchlist/add", () => checkWatchlistAdd(initialUsage));
  const filingKey = addResult?.company?.filingKey;
  await runStep("company", () => checkCompany(filingKey));
  const afterChat = await runStep("chat", () => checkChat(filingKey, addResult.usage));
  const afterHistoricalChat = await runStep("chat-history", () => checkHistoricalChat(filingKey, afterChat));
  if (addResult.savedTickerAdded) {
    await runStep("watchlist/remove", () => checkWatchlistRemove(afterHistoricalChat));
  } else {
    console.log("[smoke] watchlist/remove ... skipped (ticker was already saved for the custom smoke device)");
  }
  await runStep("billing/sync", checkBillingSync);
  console.log("Kabuyomi staging smoke passed");
}

async function runStep(name, fn) {
  process.stdout.write(`[smoke] ${name} ... `);
  try {
    const result = await fn();
    console.log("ok");
    return result;
  } catch (error) {
    console.log("failed");
    throw new Error(`[${name}] ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkUsage() {
  const payload = await fetchUsage();
  assertUsagePayload(payload, "/v1/usage");
  return payload;
}

async function checkUsageBaseline() {
  const payload = await checkUsage();

  if (!customDeviceKey && (payload.chatsUsed !== 0 || payload.stocksUsed !== 0)) {
    throw new Error("auto-generated smoke device should start at 0 chats and 0 saved tickers");
  }

  return payload;
}

async function fetchUsage() {
  const response = await fetch(`${baseURL}/v1/usage`, {
    headers: {
      "x-device-key": deviceKey
    }
  });

  if (!response.ok) {
    throw new Error(`/v1/usage failed with ${response.status}`);
  }

  return response.json();
}

function assertUsagePayload(payload, label) {
  if (
    typeof payload?.chatsUsed !== "number" ||
    typeof payload?.chatLimit !== "number" ||
    typeof payload?.stocksUsed !== "number" ||
    typeof payload?.stockLimit !== "number"
  ) {
    throw new Error(`${label} returned an unexpected usage payload`);
  }
}

async function checkSearch() {
  const response = await fetch(`${baseURL}/v1/search?q=${encodeURIComponent(searchQuery)}`, {
    headers: {
      "x-device-key": deviceKey
    }
  });

  if (!response.ok) {
    throw new Error(`/v1/search failed with ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.items) || payload.items.length === 0) {
    throw new Error("/v1/search returned no items");
  }
}

async function checkWatchlistAdd(previousUsage) {
  const response = await fetch(`${baseURL}/v1/watchlist/add`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey
    },
    body: JSON.stringify({ ticker })
  });

  if (!response.ok) {
    throw new Error(`/v1/watchlist/add failed with ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.company?.ticker !== ticker || typeof payload?.company?.filingKey !== "string") {
    throw new Error("/v1/watchlist/add returned an unexpected payload");
  }
  assertUsagePayload(payload?.usage, "/v1/watchlist/add");

  if (payload.usage.chatsUsed !== previousUsage.chatsUsed) {
    throw new Error("/v1/watchlist/add changed chatsUsed unexpectedly");
  }

  if (customDeviceKey) {
    if (payload.usage.stocksUsed < previousUsage.stocksUsed || payload.usage.stocksUsed > previousUsage.stocksUsed + 1) {
      throw new Error("/v1/watchlist/add returned an unexpected saved ticker delta for a custom smoke device");
    }
  } else if (payload.usage.stocksUsed !== previousUsage.stocksUsed + 1) {
    throw new Error("/v1/watchlist/add did not increment saved ticker count");
  }

  const usage = await checkUsage();
  if (usage.chatsUsed !== payload.usage.chatsUsed || usage.stocksUsed !== payload.usage.stocksUsed) {
    throw new Error("/v1/watchlist/add usage did not match /v1/usage");
  }

  return {
    ...payload,
    savedTickerAdded: payload.usage.stocksUsed === previousUsage.stocksUsed + 1
  };
}

async function checkCompany(expectedFilingKey) {
  const response = await fetch(`${baseURL}/v1/company/${encodeURIComponent(ticker)}`, {
    headers: {
      "x-device-key": deviceKey
    }
  });

  if (!response.ok) {
    throw new Error(`/v1/company/${ticker} failed with ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.ticker !== ticker || typeof payload?.filingKey !== "string") {
    throw new Error(`/v1/company/${ticker} returned an unexpected payload`);
  }

  if (expectedFilingKey && payload.filingKey !== expectedFilingKey) {
    throw new Error(`/v1/company/${ticker} filingKey mismatch`);
  }

  return payload;
}

async function checkChat(filingKey, previousUsage) {
  if (!filingKey) {
    throw new Error("chat smoke requires a filingKey from company/watchlist");
  }

  const response = await fetch(`${baseURL}/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey
    },
    body: JSON.stringify({
      filingKey,
      question: chatQuestion
    })
  });

  if (!response.ok) {
    throw new Error(`/v1/chat failed with ${response.status}`);
  }

  const payload = await response.json();
  if (typeof payload?.answer !== "string" || !Array.isArray(payload?.sources)) {
    throw new Error("/v1/chat returned an unexpected payload");
  }
  assertUsagePayload(payload?.usage, "/v1/chat");
  assertChatMetadata(payload, "/v1/chat");
  assertUsageDelta(payload.usage, {
    chatsUsed: previousUsage.chatsUsed + 1,
    stocksUsed: previousUsage.stocksUsed
  }, "/v1/chat");

  return payload.usage;
}

async function checkHistoricalChat(filingKey, previousUsage) {
  if (!filingKey) {
    throw new Error("historical chat smoke requires a filingKey from company/watchlist");
  }

  const response = await fetch(`${baseURL}/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey
    },
    body: JSON.stringify({
      filingKey,
      question: historyQuestion
    })
  });

  if (!response.ok) {
    throw new Error(`/v1/chat historical flow failed with ${response.status}`);
  }

  const payload = await response.json();
  if (typeof payload?.answer !== "string" || !Array.isArray(payload?.sources)) {
    throw new Error("/v1/chat historical flow returned an unexpected payload");
  }
  assertUsagePayload(payload?.usage, "/v1/chat historical");
  assertChatMetadata(payload, "/v1/chat historical");
  assertUsageDelta(payload.usage, {
    chatsUsed: previousUsage.chatsUsed + 1,
    stocksUsed: previousUsage.stocksUsed
  }, "/v1/chat historical");

  return payload.usage;
}

async function checkWatchlistRemove(previousUsage) {
  const response = await fetch(`${baseURL}/v1/watchlist/remove`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey
    },
    body: JSON.stringify({ ticker })
  });

  if (!response.ok) {
    throw new Error(`/v1/watchlist/remove failed with ${response.status}`);
  }

  const payload = await response.json();
  assertUsagePayload(payload?.usage, "/v1/watchlist/remove");
  assertUsageDelta(payload.usage, {
    chatsUsed: previousUsage.chatsUsed,
    stocksUsed: previousUsage.stocksUsed - 1
  }, "/v1/watchlist/remove");

  const usage = await checkUsage();
  if (usage.chatsUsed !== payload.usage.chatsUsed || usage.stocksUsed !== payload.usage.stocksUsed) {
    throw new Error("/v1/watchlist/remove usage did not match /v1/usage");
  }
}

function assertChatMetadata(payload, label) {
  if (!validResponsePaths.has(payload?.responsePath)) {
    throw new Error(`${label} returned an unexpected responsePath`);
  }

  if (payload.responsePath === "gemini") {
    if (typeof payload.modelName !== "string" || payload.modelName.trim().length === 0) {
      throw new Error(`${label} should return a modelName for the gemini path`);
    }
    return;
  }

  if (payload.modelName !== null) {
    throw new Error(`${label} should return modelName=null for non-gemini paths`);
  }
}

function assertUsageDelta(currentUsage, expectedUsage, label) {
  if (currentUsage.chatsUsed !== expectedUsage.chatsUsed || currentUsage.stocksUsed !== expectedUsage.stocksUsed) {
    throw new Error(
      `${label} returned unexpected usage delta (got chats=${currentUsage.chatsUsed}, stocks=${currentUsage.stocksUsed})`
    );
  }
}

async function checkBillingSync() {
  const activeClaimResponse = await fetch(`${baseURL}/v1/billing/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      originalTransactionId: "smoke-tx",
      productId: "app.kabuyomi.pro.monthly",
      active: true
    })
  });

  if (activeClaimResponse.status !== 403) {
    throw new Error(`/v1/billing/sync active claim expected 403, received ${activeClaimResponse.status}`);
  }

  const activeClaimPayload = await activeClaimResponse.json();
  if (activeClaimPayload?.error !== "Billing verification is required") {
    throw new Error("/v1/billing/sync active claim returned an unexpected error payload");
  }

  const inactiveResponse = await fetch(`${baseURL}/v1/billing/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      originalTransactionId: "smoke-tx-inactive",
      productId: "app.kabuyomi.pro.monthly",
      active: false
    })
  });

  if (inactiveResponse.status !== 200) {
    throw new Error(`/v1/billing/sync inactive expected 200, received ${inactiveResponse.status}`);
  }

  const payload = await inactiveResponse.json();
  if (payload?.plan !== "free") {
    throw new Error("/v1/billing/sync inactive did not return a free entitlement");
  }

  if (typeof payload?.quotaSubject !== "string" || !payload.quotaSubject.startsWith("free:")) {
    throw new Error("/v1/billing/sync inactive did not return a free quota subject");
  }

  if (payload?.productId !== null) {
    throw new Error("/v1/billing/sync inactive should not echo an unverified product id");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
