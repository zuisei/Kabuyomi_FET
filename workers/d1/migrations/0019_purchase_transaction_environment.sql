-- Records which Apple verification environment a credit purchase was verified
-- against. APPLE_APP_STORE_SERVER_ENVIRONMENT is "auto" in production, so a
-- transaction that is absent from Apple's production endpoint falls back to
-- sandbox and still verifies. TestFlight Release builds point at the production
-- API while StoreKit hands them sandbox transactions, so sandbox-verified
-- grants do reach production balances today.
--
-- Nullable on purpose: rows written before this migration were never told which
-- environment verified them, and backfilling them as 'production' would invent
-- an audit fact. NULL means "unknown", not "production".

ALTER TABLE purchase_transactions ADD COLUMN verification_environment TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_transactions_verification_environment
  ON purchase_transactions (verification_environment, created_at DESC);
