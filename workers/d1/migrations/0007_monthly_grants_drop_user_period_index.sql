-- Monthly grants are idempotent by operation_id. Keep same-month plan upgrades
-- auditable by removing the older user+period uniqueness constraint.
DROP INDEX IF EXISTS idx_monthly_grants_user_period;
