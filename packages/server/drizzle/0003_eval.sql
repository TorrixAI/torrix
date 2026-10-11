CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT,
  name TEXT,
  description TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_datasets_user ON datasets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id TEXT PRIMARY KEY,
  dataset_id TEXT,
  idx INTEGER,
  input TEXT,
  expected TEXT,
  tags TEXT DEFAULT '[]',
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dataset_rows_dataset ON dataset_rows(dataset_id, idx);

CREATE TABLE IF NOT EXISTS evals (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  dataset_id TEXT,
  mode TEXT DEFAULT 'offline',
  provider TEXT,
  model TEXT,
  target_url TEXT,
  temperature REAL,
  max_tokens INTEGER,
  scorer TEXT DEFAULT 'exact',
  status TEXT DEFAULT 'running',
  total_rows INTEGER DEFAULT 0,
  rows_done INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  fail INTEGER DEFAULT 0,
  score_sum REAL DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  avg_latency_ms REAL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_evals_user ON evals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS eval_results (
  id TEXT PRIMARY KEY,
  eval_id TEXT,
  dataset_row_id TEXT,
  run_id TEXT,
  score INTEGER DEFAULT 0,
  score_note TEXT,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_eval_results_eval ON eval_results(eval_id);