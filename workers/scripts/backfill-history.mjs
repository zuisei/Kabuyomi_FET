const args = process.argv.slice(2);

const options = {
  years: 3,
  maxFilingsPerTicker: 2,
  tickers: []
};

for (const arg of args) {
  if (arg.startsWith("--years=")) {
    options.years = Number.parseInt(arg.slice("--years=".length), 10);
    continue;
  }

  if (arg.startsWith("--max-filings-per-ticker=")) {
    options.maxFilingsPerTicker = Number.parseInt(arg.slice("--max-filings-per-ticker=".length), 10);
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

  options.tickers.push(arg.trim().toUpperCase());
}

const baseUrl = process.env.BACKFILL_URL ?? "http://127.0.0.1:8787";
const sharedSecret = process.env.BACKFILL_SHARED_SECRET;

if (!sharedSecret) {
  console.error("BACKFILL_SHARED_SECRET is required");
  process.exit(1);
}

const response = await fetch(new URL("/v1/internal/backfill/history", baseUrl), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-token": sharedSecret
  },
  body: JSON.stringify({
    tickers: options.tickers.length > 0 ? options.tickers : undefined,
    years: options.years,
    maxFilingsPerTicker: options.maxFilingsPerTicker
  })
});

const payload = await response.json();
if (!response.ok) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));
