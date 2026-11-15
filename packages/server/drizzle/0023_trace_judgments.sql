CREATE TABLE IF NOT EXISTS trace_judgments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  score INTEGER,
  reason TEXT,
  confidence REAL,
  first_failing_run_id TEXT,
  provider TEXT,
  model TEXT,
  criteria TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL DEFAULT 0,
  raw TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_judgments_user_trace ON trace_judgments(user_id, trace_id);
