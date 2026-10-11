CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(user_id, parent_run_id);
