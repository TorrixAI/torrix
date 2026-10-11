ALTER TABLE agents ADD COLUMN IF NOT EXISTS identity_provider TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS external_subject TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_external ON agents(user_id, identity_provider, external_subject) WHERE identity_provider IS NOT NULL;
