ALTER TABLE routing_rules ADD COLUMN match_prompt TEXT;
ALTER TABLE routing_rules ADD COLUMN match_prompt_regex TEXT;
ALTER TABLE routing_rules ADD COLUMN target_url TEXT;
ALTER TABLE prompts ADD COLUMN active_revision INTEGER;
