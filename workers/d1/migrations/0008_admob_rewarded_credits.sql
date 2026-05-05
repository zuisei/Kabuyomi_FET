-- Rewarded AdMob credit intents and idempotent SSV transaction audit.

CREATE TABLE IF NOT EXISTS admob_reward_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  custom_data TEXT NOT NULL UNIQUE,
  reward_credits INTEGER NOT NULL,
  status TEXT NOT NULL,
  daily_date_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  granted_at TEXT,
  transaction_id TEXT,
  credits_remaining INTEGER
);

CREATE INDEX IF NOT EXISTS idx_admob_reward_intents_user_day
  ON admob_reward_intents (user_id, daily_date_key, status);

CREATE TABLE IF NOT EXISTS admob_reward_transactions (
  transaction_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reward_intent_id TEXT NOT NULL,
  ad_unit TEXT NOT NULL,
  reward_credits INTEGER NOT NULL,
  status TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  granted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admob_reward_transactions_user_created
  ON admob_reward_transactions (user_id, created_at DESC);
