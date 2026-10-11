CREATE TABLE IF NOT EXISTS model_pricing (
  model TEXT PRIMARY KEY,
  input DOUBLE PRECISION NOT NULL,
  output DOUBLE PRECISION NOT NULL,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_created ON model_pricing(created_at);

ALTER TABLE api_keys ADD COLUMN budget_usd DOUBLE PRECISION;
ALTER TABLE api_keys ADD COLUMN hard_cap_usd DOUBLE PRECISION;

ALTER TABLE projects ADD COLUMN budget_usd DOUBLE PRECISION;
ALTER TABLE projects ADD COLUMN hard_cap_usd DOUBLE PRECISION;