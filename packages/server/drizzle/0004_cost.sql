CREATE TABLE IF NOT EXISTS model_pricing (
  model TEXT PRIMARY KEY,
  input REAL NOT NULL,
  output REAL NOT NULL,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_created ON model_pricing(created_at);

ALTER TABLE api_keys ADD COLUMN budget_usd REAL;
ALTER TABLE api_keys ADD COLUMN hard_cap_usd REAL;

ALTER TABLE projects ADD COLUMN budget_usd REAL;
ALTER TABLE projects ADD COLUMN hard_cap_usd REAL;