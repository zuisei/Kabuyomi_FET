import { pathToFileURL } from "node:url";

const DEFAULT_OPTIONS = Object.freeze({
  years: 3,
  forms: ["10-K"],
  maxFilingsPerTicker: 1,
  maxTotalFilings: 8,
  contentMode: "metrics_only",
  cursorByTicker: {},
  tickers: []
});

export function parseBackfillArgs(args) {
  const options = {
    ...DEFAULT_OPTIONS,
    forms: [...DEFAULT_OPTIONS.forms],
    cursorByTicker: {},
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

    if (arg.startsWith("--max-total-filings=")) {
      options.maxTotalFilings = Number.parseInt(arg.slice("--max-total-filings=".length), 10);
      continue;
    }

    if (arg.startsWith("--forms=")) {
      options.forms = arg
        .slice("--forms=".length)
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value === "10-K" || value === "10-Q");
      continue;
    }

    if (arg.startsWith("--content-mode=")) {
      const contentMode = arg.slice("--content-mode=".length).trim();
      if (contentMode !== "metrics_only" && contentMode !== "full") {
        throw new Error("--content-mode must be metrics_only or full");
      }
      options.contentMode = contentMode;
      continue;
    }

    if (arg.startsWith("--cursor=")) {
      const match = /^([A-Za-z][A-Za-z0-9.-]{0,15}):(\d+)$/u.exec(arg.slice("--cursor=".length).trim());
      if (!match) {
        throw new Error("--cursor must use TICKER:NON_NEGATIVE_INTEGER");
      }
      options.cursorByTicker[match[1].toUpperCase()] = Number.parseInt(match[2], 10);
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

  return options;
}

export function buildBackfillPayload(options) {
  return {
    tickers: options.tickers.length > 0 ? options.tickers : undefined,
    years: options.years,
    forms: options.forms,
    maxFilingsPerTicker: options.maxFilingsPerTicker,
    maxTotalFilings: options.maxTotalFilings,
    contentMode: options.contentMode,
    cursorByTicker: Object.keys(options.cursorByTicker).length > 0 ? options.cursorByTicker : undefined
  };
}

export async function runBackfillRequest({
  options,
  baseUrl = "http://127.0.0.1:8787",
  sharedSecret,
  fetchImpl = fetch
}) {
  if (!sharedSecret) {
    throw new Error("BACKFILL_SHARED_SECRET is required");
  }

  const validatedBaseUrl = validateBackfillBaseUrl(baseUrl);

  const response = await fetchImpl(new URL("/v1/internal/backfill/history", validatedBaseUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-internal-token": sharedSecret
    },
    body: JSON.stringify(buildBackfillPayload(options))
  });
  const payload = await response.json();
  return { response, payload };
}

export function validateBackfillBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("BACKFILL_URL must be a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("BACKFILL_URL must not contain credentials");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("BACKFILL_URL must use HTTPS outside loopback development");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BACKFILL_URL must be an origin without a path, query, or fragment");
  }
  return url.origin;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  try {
    const options = parseBackfillArgs(args);
    const { response, payload } = await runBackfillRequest({
      options,
      baseUrl: env.BACKFILL_URL ?? "http://127.0.0.1:8787",
      sharedSecret: env.BACKFILL_SHARED_SECRET
    });

    if (!response.ok) {
      console.error(JSON.stringify(payload, null, 2));
      return 1;
    }

    console.log(JSON.stringify(payload, null, 2));
    if (Array.isArray(payload.failedTickers) && payload.failedTickers.length > 0) {
      console.error(`Backfill failed for ${payload.failedTickers.length} ticker(s)`);
      return 2;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
