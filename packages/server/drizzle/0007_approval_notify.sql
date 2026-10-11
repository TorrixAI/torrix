ALTER TABLE agent_control_settings ADD COLUMN approval_alerts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_control_settings ADD COLUMN approval_webhook_url TEXT;
