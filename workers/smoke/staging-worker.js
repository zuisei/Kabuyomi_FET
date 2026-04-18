const baseURL = process.env.KABUYOMI_SMOKE_BASE_URL?.trim();
const deviceKey = process.env.KABUYOMI_SMOKE_DEVICE_KEY?.trim() || "smoke-device";
const ticker = process.env.KABUYOMI_SMOKE_TICKER?.trim().toUpperCase() || "AAPL";
const searchQuery = process.env.KABUYOMI_SMOKE_SEARCH_QUERY?.trim() || ticker;
const chatQuestion = process.env.KABUYOMI_SMOKE_CHAT_QUESTION?.trim() || "売上高は？";
const historyQuestion = process.env.KABUYOMI_SMOKE_HISTORY_QUESTION?.trim() || "この3年の売上推移は？";

if (!baseURL) {
  console.error(
    "KABUYOMI_SMOKE_BASE_URL is required, for example: KABUYOMI_SMOKE_BASE_URL=https://kabuyomi-api.example.workers.dev npm run smoke:staging"
  );
  process.exit(1);
}

async function main() {
  await runStep("usage", checkUsage);
  await runStep("search", checkSearch);
  const company = await runStep("watchlist/add", checkWatchlistAdd);
  const filingKey = company?.filingKey;
  await runStep("company", () => checkCompany(filingKey));
  await runStep("chat", () => checkChat(filingKey));
  await runStep("chat-history", () => checkHistoricalChat(filingKey));
  await runStep("billing/sync", checkBillingDisabled);
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
  const response = await fetch(`${baseURL}/v1/usage`, {
    headers: {
      "x-device-key": deviceKey
    }
  });

  if (!response.ok) {
    throw new Error(`/v1/usage failed with ${response.status}`);
  }

  const payload = await response.json();
  if (typeof payload?.chatsUsed !== "number" || typeof payload?.stocksUsed !== "number") {
    throw new Error("/v1/usage returned an unexpected payload");
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

async function checkWatchlistAdd() {
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

  return payload.company;
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

async function checkChat(filingKey) {
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
}

async function checkHistoricalChat(filingKey) {
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
}

async function checkBillingDisabled() {
  const response = await fetch(`${baseURL}/v1/billing/sync`, {
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

  if (response.status !== 503) {
    throw new Error(`/v1/billing/sync expected 503, received ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error !== "Billing sync is disabled during beta") {
    throw new Error("/v1/billing/sync did not return the beta-disabled response");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
