CREATE TABLE IF NOT EXISTS judge_settings (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'openai',
  base_url TEXT,
  model TEXT,
  api_key TEXT,
  criteria TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS run_judgments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  criteria TEXT,
  score REAL,
  rationale TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL DEFAULT 0,
  raw TEXT,
  error TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_judgments_run ON run_judgments(run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS online_eval_configs (
  project_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  dataset_id TEXT,
  scorer TEXT DEFAULT 'exact',
  judge_enabled INTEGER DEFAULT 0,
  judge_criteria TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_online_eval_user ON online_eval_configs(user_id);

ALTER TABLE evals ADD COLUMN judge_cost_usd REAL DEFAULT 0;
