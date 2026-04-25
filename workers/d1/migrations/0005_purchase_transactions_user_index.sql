CREATE INDEX IF NOT EXISTS idx_purchase_transactions_user_created
ON purchase_transactions(user_id, created_at DESC);
