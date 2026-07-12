-- Consumable refund state is authoritative in USER_QUOTA. D1 retains the
-- server-owned purchase binding and an auditable projection updated only after
-- the Durable Object mutation succeeds.

ALTER TABLE purchase_transactions ADD COLUMN debt_offset_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_transactions ADD COLUMN refunded_at TEXT;
ALTER TABLE purchase_transactions ADD COLUMN refund_reversed_at TEXT;
ALTER TABLE purchase_transactions ADD COLUMN refund_available_removed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_transactions ADD COLUMN refund_debt_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_transactions ADD COLUMN refund_debt_released INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_transactions ADD COLUMN refund_debt_settled_restored INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_transactions ADD COLUMN refund_credits_restored INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_transactions ADD COLUMN refund_notification_uuid TEXT;
ALTER TABLE purchase_transactions ADD COLUMN refund_reversed_notification_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_transactions_status_updated
  ON purchase_transactions (status, updated_at DESC);
