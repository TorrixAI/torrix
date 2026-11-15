ALTER TABLE agents ADD COLUMN frozen INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN frozen_reason TEXT;
ALTER TABLE agents ADD COLUMN frozen_at TEXT;
ALTER TABLE agents ADD COLUMN max_actions_per_minute INTEGER;

ALTER TABLE agent_control_settings ADD COLUMN freeze_all INTEGER DEFAULT 0;
ALTER TABLE agent_control_settings ADD COLUMN freeze_reason TEXT;
ALTER TABLE agent_control_settings ADD COLUMN freeze_at TEXT;
ALTER TABLE agent_control_settings ADD COLUMN quarantine_after_denials INTEGER DEFAULT 0;
ALTER TABLE agent_control_settings ADD COLUMN quarantine_window_minutes INTEGER DEFAULT 60;

CREATE TABLE IF NOT EXISTS tool_freezes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT,
  tool_name TEXT NOT NULL,
  reason TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_freezes_user ON tool_freezes(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_freezes_scope ON tool_freezes(user_id, COALESCE(agent_id, ''), tool_name);
