CREATE TABLE IF NOT EXISTS guardrail_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT NOT NULL,
  run_id TEXT,
  score REAL,
  threshold REAL,
  action TEXT,
  created_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_guardrail_events_session ON guardrail_events(user_id, session_id);

ALTER TABLE online_eval_configs ADD COLUMN guardrail_action TEXT DEFAULT 'off';
ALTER TABLE online_eval_configs ADD COLUMN guardrail_threshold REAL DEFAULT 50;
ALTER TABLE online_eval_configs ADD COLUMN guardrail_window_minutes INTEGER DEFAULT 60;
