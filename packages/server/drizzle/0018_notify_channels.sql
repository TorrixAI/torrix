ALTER TABLE alert_settings ADD COLUMN pagerduty_routing_key TEXT;
ALTER TABLE alert_settings ADD COLUMN email_webhook_url TEXT;
ALTER TABLE alert_settings ADD COLUMN email_webhook_token TEXT;
ALTER TABLE alert_settings ADD COLUMN email_recipients TEXT;
