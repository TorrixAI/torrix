ALTER TABLE alert_settings ADD COLUMN webhook_secret TEXT;
ALTER TABLE agent_control_settings ADD COLUMN webhook_secret TEXT;
