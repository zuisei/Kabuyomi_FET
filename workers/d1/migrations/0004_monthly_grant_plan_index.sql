CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_grants_user_plan_period
ON monthly_grants(user_id, plan, period_start, period_end);
