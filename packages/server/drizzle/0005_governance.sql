CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  actor TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);

CREATE TABLE IF NOT EXISTS governance_settings (
  user_id TEXT PRIMARY KEY,
  pii_enabled INTEGER DEFAULT 0,
  pii_types TEXT DEFAULT '[]',
  pii_placeholder TEXT DEFAULT '[redacted]',
  pii_mask_input INTEGER DEFAULT 1,
  pii_mask_output INTEGER DEFAULT 0,
  human_review_enabled INTEGER DEFAULT 0,
  audit_enabled INTEGER DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  name TEXT,
  enabled INTEGER DEFAULT 1,
  action TEXT DEFAULT 'flag',
  stage TEXT DEFAULT 'request',
  match_kind TEXT DEFAULT 'keyword',
  match_value TEXT,
  severity TEXT DEFAULT 'medium',
  hit_count INTEGER DEFAULT 0,
  last_hit_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_policies_user ON policies(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  name TEXT,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 100,
  match_provider TEXT,
  match_model TEXT,
  match_kind TEXT DEFAULT 'prefix',
  target_model TEXT,
  fallback_model TEXT,
  max_cost_usd REAL,
  min_quality_score REAL,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_user ON routing_rules(user_id, priority ASC);

CREATE TABLE IF NOT EXISTS export_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT DEFAULT 's3',
  endpoint TEXT,
  bucket TEXT,
  prefix TEXT DEFAULT 'torrix',
  access_key_id TEXT,
  secret_access_key TEXT,
  schedule_minutes INTEGER DEFAULT 60,
  enabled INTEGER DEFAULT 0,
  last_export_at TEXT,
  last_run_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_export_configs_user ON export_configs(user_id);

CREATE TABLE IF NOT EXISTS review_queue (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  user_id TEXT,
  project_id TEXT,
  state TEXT DEFAULT 'pending',
  reviewer_user_id TEXT,
  note TEXT,
  created_at TEXT,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_queue_user ON review_queue(user_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_queue_run ON review_queue(run_id);

ALTER TABLE runs ADD COLUMN review_state TEXT;
ALTER TABLE runs ADD COLUMN pii_masked INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN pii_findings TEXT;
ALTER TABLE runs ADD COLUMN policy_flags TEXT;
ALTER TABLE runs ADD COLUMN share_expires_at TEXT;
ALTER TABLE runs ADD COLUMN media_count INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN retrieval_docs TEXT;
ALTER TABLE runs ADD COLUMN intent_cluster TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_share ON runs(share_token);
CREATE INDEX IF NOT EXISTS idx_runs_review ON runs(user_id, review_state);
CREATE INDEX IF NOT EXISTS idx_runs_score ON runs(user_id, score);
CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(user_id, model);
CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(user_id, source);