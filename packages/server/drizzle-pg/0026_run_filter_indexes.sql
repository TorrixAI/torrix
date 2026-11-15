CREATE INDEX IF NOT EXISTS idx_runs_agent_name ON runs(user_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_runs_provider ON runs(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_runs_end_user ON runs(user_id, end_user_id);
