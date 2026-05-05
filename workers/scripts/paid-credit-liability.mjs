#!/usr/bin/env node

import { spawnSync } from "node:child_process";

export function buildPaidCreditLiabilityQuery() {
  return `
WITH latest_user_ledger AS (
  SELECT
    user_id,
    balance_after,
    monthly_balance_after,
    purchased_balance_after,
    COALESCE(
      CAST(json_extract(metadata_json, '$.rewardedAdBalanceAfter') AS INTEGER),
      0
    ) AS ad_balance_after,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, operation_id DESC
    ) AS row_number
  FROM credit_ledger
),
latest_user_balance AS (
  SELECT
    user_id,
    balance_after,
    monthly_balance_after,
    purchased_balance_after,
    ad_balance_after,
    created_at
  FROM latest_user_ledger
  WHERE row_number = 1
),
granted_purchases AS (
  SELECT
    user_id,
    SUM(credits_granted) AS granted_paid_credits
  FROM purchase_transactions
  WHERE status = 'granted'
    AND product_id = 'kabuyomi.credits.100'
  GROUP BY user_id
)
SELECT
  datetime('now') AS as_of,
  COUNT(CASE WHEN latest_user_balance.purchased_balance_after > 0 THEN 1 END) AS user_count_with_paid_balance,
  COALESCE(SUM(latest_user_balance.purchased_balance_after), 0) AS total_paid_credits_remaining,
  COALESCE(SUM(latest_user_balance.purchased_balance_after), 0) * 2.0 AS total_paid_credit_liability_jpy,
  COALESCE(SUM(latest_user_balance.monthly_balance_after), 0) AS total_free_or_promotional_credits_remaining,
  COALESCE(SUM(latest_user_balance.ad_balance_after), 0) AS total_ad_credits_remaining
FROM latest_user_balance
LEFT JOIN granted_purchases
  ON granted_purchases.user_id = latest_user_balance.user_id;
`.trim();
}

export function reportLimitations() {
  return [
    "Limitations:",
    "- This report uses each user's latest credit_ledger snapshot as the current balance source.",
    "- v1 has one paid SKU, kabuyomi.credits.100, priced at ¥200 for 100 paid credits, so liability is calculated at ¥2 per remaining paid credit.",
    "- The schema does not currently store per-lot remaining balance. If future paid SKUs have different prices, add per-lot accounting before using this as an exact liability report."
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    sqlOnly: false,
    remote: true,
    config: "wrangler.toml",
    database: "DB"
  };

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
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const query = buildPaidCreditLiabilityQuery();

  if (options.sqlOnly) {
    console.log(query);
    console.log();
    console.log(reportLimitations());
    return;
  }

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
  console.log();
  console.log(reportLimitations());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
