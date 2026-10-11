CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password TEXT,
  api_key TEXT UNIQUE,
  is_admin INTEGER DEFAULT 0,
  must_change_password INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  name TEXT,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  thinking_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  status INTEGER,
  finish_reason TEXT,
  source TEXT,
  is_golden INTEGER DEFAULT 0,
  score INTEGER,
  score_note TEXT,
  scored_at TEXT,
  run_note TEXT,
  request_body TEXT,
  request_bytes INTEGER,
  response_bytes INTEGER,
  target_url TEXT,
  trace_id TEXT,
  session_id TEXT,
  parent_run_id TEXT,
  routed_from TEXT,
  fallback_used INTEGER DEFAULT 0,
  structured_output TEXT,
  json_parse_ok INTEGER,
  agent_name TEXT,
  end_user_id TEXT,
  prompt_hash TEXT,
  tags TEXT,
  api_key_id TEXT,
  dataset_id TEXT,
  dataset_row_id TEXT,
  share_token TEXT,
  is_anomaly INTEGER DEFAULT 0,
  original_input_tokens INTEGER,
  original_request_body TEXT,
  is_seed INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_trace ON runs(trace_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  message TEXT,
  type TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT,
  key_hash TEXT UNIQUE,
  key_prefix TEXT,
  scope TEXT DEFAULT 'full',
  projects TEXT,
  permission TEXT DEFAULT 'read_write',
  created_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS instance_config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS alert_settings (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 0,
  webhook_url TEXT,
  budget_usd REAL,
  hard_cap_usd REAL,
  last_alert_at TEXT,
  notify_on_error INTEGER DEFAULT 0,
  anomaly_enabled INTEGER DEFAULT 0,
  anomaly_multiplier REAL DEFAULT 3.0,
  digest_enabled INTEGER DEFAULT 0,
  last_digest_sent_at TEXT
);

CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT
);