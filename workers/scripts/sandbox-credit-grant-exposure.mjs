#!/usr/bin/env node

// Sizes the credit grants that reached production from a sandbox-verified Apple
// transaction.
//
// Background: APPLE_APP_STORE_SERVER_ENVIRONMENT was "auto" in production, so a
// transaction Apple's production endpoint did not recognise fell back to sandbox
// and verified there. TestFlight Release builds call the production API while
// StoreKit gives them sandbox transactions, so ordinary TestFlight purchases
// minted free production credits. The grant path now refuses those
// (isCreditGrantEnvironmentAccepted), but grants made before that still stand.
//
// Usage:
//   node scripts/sandbox-credit-grant-exposure.mjs            # run against remote D1
//   node scripts/sandbox-credit-grant-exposure.mjs --local
//   node scripts/sandbox-credit-grant-exposure.mjs --sql      # print the SQL only

import { spawnSync } from "node:child_process";

export function buildSandboxGrantExposureQuery() {
  return `
SELECT
  COALESCE(verification_environment, 'unknown_pre_0019') AS environment,
  COUNT(*) AS transaction_count,
  COALESCE(SUM(CASE WHEN status = 'granted' THEN credits_granted ELSE 0 END), 0) AS granted_credits,
  COUNT(DISTINCT user_id) AS user_count,
  MIN(created_at) AS first_seen,
  MAX(created_at) AS last_seen
FROM purchase_transactions
GROUP BY COALESCE(verification_environment, 'unknown_pre_0019')
ORDER BY granted_credits DESC;
`.trim();
}

export function buildUnknownEnvironmentTransactionQuery(limit = 500) {
  return `
SELECT
  transaction_id,
  original_transaction_id,
  product_id,
  credits_granted,
  status,
  purchased_at,
  created_at
FROM purchase_transactions
WHERE verification_environment IS NULL
  AND status IN ('granted', 'pending')
ORDER BY created_at DESC
LIMIT ${Number.parseInt(String(limit), 10)};
`.trim();
}

export function reportLimitations() {
  return [
    "Limitations:",
    "- verification_environment was added in migration 0019. Every row written before it is NULL,",
    "  which means unknown — NOT production. The first query reports those separately as",
    "  'unknown_pre_0019'; do not read that bucket as clean.",
    "- D1 alone cannot say which of the unknown rows were sandbox. To decide, re-query Apple:",
    "  GET https://api.storekit.itunes.apple.com/inApps/v1/transactions/{transactionId}",
    "  A 404 with errorCode 4040010 (TransactionIdNotFound) against the PRODUCTION endpoint means",
    "  the transaction only exists in sandbox. That needs the App Store Server API key, so it is",
    "  deliberately not done here — this script does not hold credentials and does not mutate.",
    "- Rows written after 0019 are attributed directly: 'production', 'sandbox', or 'internal'",
    "  (the last is /v1/internal/credits/purchase-grant, which never contacts Apple)."
  ].join("\n");
}

function parseArgs(argv) {
  const options = { sqlOnly: false, remote: true, config: "wrangler.toml", database: "DB", limit: 500 };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sql") {
      options.sqlOnly = true;
    } else if (arg === "--local") {
      options.remote = false;
    } else if (arg === "--remote") {
      options.remote = true;
    } else if (arg === "--config") {
      options.config = argv[index + 1] ?? options.config;
      index += 1;
    } else if (arg === "--database") {
      options.database = argv[index + 1] ?? options.database;
      index += 1;
    } else if (arg === "--limit") {
      options.limit = argv[index + 1] ?? options.limit;
      index += 1;
    }
  }

  return options;
}

function runQuery(options, query) {
  const args = [
    "wrangler",
    "d1",
    "execute",
    options.database,
    "--config",
    options.config,
    "--command",
    query
  ];
  args.push(options.remote ? "--remote" : "--local");

  const result = spawnSync("npx", args, {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = buildSandboxGrantExposureQuery();
  const unknown = buildUnknownEnvironmentTransactionQuery(options.limit);

  if (options.sqlOnly) {
    console.log(summary);
    console.log();
    console.log(unknown);
    console.log();
    console.log(reportLimitations());
    return;
  }

  console.log("== grants by verification environment ==");
  runQuery(options, summary);
  console.log();
  console.log("== transactions with an unknown environment (re-query Apple to classify) ==");
  runQuery(options, unknown);
  console.log();
  console.log(reportLimitations());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
