ALTER TABLE alert_settings ADD COLUMN last_alert_level REAL;

CREATE TABLE IF NOT EXISTS anomaly_cooldowns (
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  last_fired_at TEXT NOT NULL,
  PRIMARY KEY (user_id, model)
);
