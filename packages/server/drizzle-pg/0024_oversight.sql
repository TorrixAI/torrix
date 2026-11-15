ALTER TABLE approvals ADD COLUMN canary INTEGER DEFAULT 0;
ALTER TABLE approvals ADD COLUMN canary_expected TEXT;
ALTER TABLE approvals ADD COLUMN canary_outcome TEXT;
ALTER TABLE approvals ADD COLUMN required_approvals INTEGER DEFAULT 1;
ALTER TABLE approvals ADD COLUMN approvals_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS approval_signoffs (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reviewer_user_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_signoffs_unique ON approval_signoffs(approval_id, reviewer_user_id);
CREATE INDEX IF NOT EXISTS idx_approval_signoffs_approval ON approval_signoffs(approval_id, created_at);

ALTER TABLE agent_control_settings ADD COLUMN approval_min_risk TEXT DEFAULT 'low';
ALTER TABLE agent_control_settings ADD COLUMN rubber_stamp_seconds INTEGER DEFAULT 2;
ALTER TABLE agent_control_settings ADD COLUMN rubber_stamp_rate INTEGER DEFAULT 95;
ALTER TABLE agent_control_settings ADD COLUMN canary_interval_hours INTEGER DEFAULT 0;
