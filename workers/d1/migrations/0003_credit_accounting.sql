-- Credit accounting audit tables. The hot balance stays in USER_QUOTA Durable Objects.

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  monthly_balance_after INTEGER NOT NULL,
  purchased_balance_after INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created
  ON credit_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS monthly_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  credits_granted INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_grants_user_period
  ON monthly_grants (user_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS purchase_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  original_transaction_id TEXT,
  credits_granted INTEGER NOT NULL,
  status TEXT NOT NULL,
  purchased_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
