const args = process.argv.slice(2);

const options = {
  execute: false,
  targetVersions: [],
  tickers: [],
  maxFilings: 50,
  maxKvKeys: 200,
  includeUnshadowed: false,
  onlyDisagreeingMetrics: false
};

for (const arg of args) {
  if (arg === "--execute") {
    options.execute = true;
    continue;
  }

  if (arg === "--include-unshadowed") {
    options.includeUnshadowed = true;
    continue;
  }

  if (arg === "--only-disagreeing-metrics") {
    options.onlyDisagreeingMetrics = true;
    continue;
  }

  if (arg.startsWith("--target-versions=")) {
    options.targetVersions.push(
      ...arg
        .slice("--target-versions=".length)
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
    continue;
  }

  if (arg.startsWith("--tickers=")) {
    options.tickers.push(
      ...arg
        .slice("--tickers=".length)
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    );
    continue;
  }

  if (arg.startsWith("--max-filings=")) {
    options.maxFilings = Number.parseInt(arg.slice("--max-filings=".length), 10);
    continue;
  }

  if (arg.startsWith("--max-kv-keys=")) {
    options.maxKvKeys = Number.parseInt(arg.slice("--max-kv-keys=".length), 10);
    continue;
  }

  options.tickers.push(arg.trim().toUpperCase());
}

const baseUrl = process.env.CLEANUP_URL ?? process.env.BACKFILL_URL ?? "http://127.0.0.1:8787";
const sharedSecret = process.env.BACKFILL_SHARED_SECRET;

if (!sharedSecret) {
  console.error("BACKFILL_SHARED_SECRET is required");
  process.exit(1);
}

const payload = {
  execute: options.execute,
  targetVersions: options.targetVersions.length > 0 ? options.targetVersions : undefined,
  tickers: options.tickers.length > 0 ? options.tickers : undefined,
  maxFilings: options.maxFilings,
  maxKvKeys: options.maxKvKeys,
  includeUnshadowed: options.includeUnshadowed,
  onlyDisagreeingMetrics: options.onlyDisagreeingMetrics
};

const response = await fetch(new URL("/v1/internal/cleanup/filings", baseUrl), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-token": sharedSecret
  },
  body: JSON.stringify(payload)
});

const responsePayload = await response.json();
if (!response.ok) {
  console.error(JSON.stringify(responsePayload, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(responsePayload, null, 2));
