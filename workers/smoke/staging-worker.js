const baseURL = process.env.KABUYOMI_SMOKE_BASE_URL?.trim();
const deviceKey = process.env.KABUYOMI_SMOKE_DEVICE_KEY?.trim() || "smoke-device";

if (!baseURL) {
  console.error("KABUYOMI_SMOKE_BASE_URL is required");
  process.exit(1);
}

async function main() {
  await checkUsage();
  await checkBillingDisabled();
  console.log("Kabuyomi staging smoke passed");
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
