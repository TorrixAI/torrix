ALTER TABLE routing_rules ADD COLUMN IF NOT EXISTS match_prompt TEXT;
ALTER TABLE routing_rules ADD COLUMN IF NOT EXISTS match_prompt_regex TEXT;
ALTER TABLE routing_rules ADD COLUMN IF NOT EXISTS target_url TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS active_revision INTEGER;
