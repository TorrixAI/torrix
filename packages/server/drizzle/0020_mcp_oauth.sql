ALTER TABLE mcp_servers ADD COLUMN oauth_client_id TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_client_secret TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_token TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_authorized_at TEXT;

CREATE TABLE IF NOT EXISTS mcp_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_states_scope ON mcp_oauth_states(user_id, server_id);
