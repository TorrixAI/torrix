CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  slug TEXT,
  name TEXT,
  description TEXT,
  owner_user_id TEXT,
  business_owner TEXT,
  purpose TEXT,
  environment TEXT DEFAULT 'production',
  status TEXT DEFAULT 'active',
  model TEXT,
  provider TEXT,
  tags TEXT DEFAULT '{}',
  risk_level TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_slug ON agents(user_id, slug);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  user_id TEXT,
  name TEXT,
  key_hash TEXT UNIQUE,
  key_prefix TEXT,
  scopes TEXT DEFAULT '[]',
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_agent ON agent_credentials(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT DEFAULT 'human',
  display_name TEXT,
  email TEXT,
  linked_user_id TEXT,
  identity_provider TEXT DEFAULT 'local',
  external_subject TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_principals_external ON principals(user_id, identity_provider, external_subject);
CREATE INDEX IF NOT EXISTS idx_principals_user ON principals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  principal_id TEXT,
  agent_id TEXT,
  delegator_agent_id TEXT,
  parent_delegation_id TEXT,
  purpose TEXT,
  allowed_actions TEXT DEFAULT '[]',
  allowed_resources TEXT DEFAULT '[]',
  conditions TEXT DEFAULT '{}',
  limits TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  starts_at TEXT,
  expires_at TEXT,
  depth INTEGER DEFAULT 0,
  created_by_user_id TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_delegations_agent ON delegations(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_delegations_principal ON delegations(principal_id, status);
CREATE INDEX IF NOT EXISTS idx_delegations_parent ON delegations(parent_delegation_id);

CREATE TABLE IF NOT EXISTS authorization_policies (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  name TEXT,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  effect TEXT DEFAULT 'deny',
  priority INTEGER DEFAULT 100,
  conditions TEXT DEFAULT '{}',
  actions TEXT DEFAULT '[]',
  resources TEXT DEFAULT '[]',
  latest_version INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_authz_policies_user ON authorization_policies(user_id, enabled, priority);

CREATE TABLE IF NOT EXISTS authorization_policy_versions (
  id TEXT PRIMARY KEY,
  policy_id TEXT,
  user_id TEXT,
  version INTEGER,
  snapshot TEXT,
  note TEXT,
  author_user_id TEXT,
  created_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_authz_policy_versions_lookup ON authorization_policy_versions(policy_id, version);

CREATE TABLE IF NOT EXISTS agent_control_settings (
  user_id TEXT PRIMARY KEY,
  default_posture TEXT DEFAULT 'deny',
  approval_timeout_minutes INTEGER DEFAULT 60,
  max_delegation_depth INTEGER DEFAULT 4,
  risk_escalation TEXT DEFAULT '{}',
  authorization_retention_days INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS authorization_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  agent_id TEXT,
  credential_id TEXT,
  principal_id TEXT,
  delegation_id TEXT,
  delegation_chain TEXT DEFAULT '[]',
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  tool_name TEXT,
  target_system TEXT,
  protocol TEXT DEFAULT 'rest',
  params TEXT,
  context TEXT,
  request_hash TEXT,
  trace_id TEXT,
  run_id TEXT,
  state TEXT DEFAULT 'requested',
  execution_status TEXT,
  result_summary TEXT,
  error TEXT,
  created_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_authz_requests_user ON authorization_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authz_requests_agent ON authorization_requests(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authz_requests_trace ON authorization_requests(trace_id);
CREATE INDEX IF NOT EXISTS idx_authz_requests_state ON authorization_requests(user_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authz_requests_hash ON authorization_requests(user_id, request_hash);

CREATE TABLE IF NOT EXISTS authorization_decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  user_id TEXT,
  agent_id TEXT,
  principal_id TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  tool_name TEXT,
  protocol TEXT,
  decision TEXT,
  policy_id TEXT,
  policy_version_id TEXT,
  policy_name TEXT,
  policy_version INTEGER,
  reason TEXT,
  reason_code TEXT,
  risk_level TEXT,
  risk_score REAL,
  risk_factors TEXT,
  request_hash TEXT,
  trace_id TEXT,
  run_id TEXT,
  latency_ms INTEGER,
  engine_version TEXT,
  error_code TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_authz_decisions_user ON authorization_decisions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authz_decisions_request ON authorization_decisions(request_id);
CREATE INDEX IF NOT EXISTS idx_authz_decisions_agent ON authorization_decisions(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authz_decisions_kind ON authorization_decisions(user_id, decision, created_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  user_id TEXT,
  principal_id TEXT,
  agent_id TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  tool_name TEXT,
  target_system TEXT,
  params_summary TEXT,
  state TEXT DEFAULT 'pending',
  request_hash TEXT,
  policy_id TEXT,
  policy_version_id TEXT,
  reason TEXT,
  risk_level TEXT,
  expires_at TEXT,
  reviewer_user_id TEXT,
  note TEXT,
  consumed_at TEXT,
  decided_at TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_user ON approvals(user_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_request ON approvals(request_id);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  user_id TEXT,
  level TEXT,
  score REAL,
  factors TEXT,
  engine_version TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_risk_assessments_request ON risk_assessments(request_id);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  slug TEXT,
  name TEXT,
  endpoint TEXT,
  transport TEXT DEFAULT 'streamable_http',
  auth_type TEXT DEFAULT 'none',
  auth_config TEXT,
  environment TEXT DEFAULT 'production',
  status TEXT DEFAULT 'unknown',
  last_checked_at TEXT,
  last_error TEXT,
  tools_synced_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_slug ON mcp_servers(user_id, slug);

CREATE TABLE IF NOT EXISTS mcp_server_tools (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  user_id TEXT,
  name TEXT,
  description TEXT,
  action TEXT,
  input_schema TEXT,
  annotations TEXT,
  discovered_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_server_tools_lookup ON mcp_server_tools(server_id, name);

CREATE TABLE IF NOT EXISTS agent_tools (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  user_id TEXT,
  server_id TEXT,
  tool_name TEXT,
  action TEXT,
  created_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tools_lookup ON agent_tools(agent_id, server_id, tool_name);

CREATE TABLE IF NOT EXISTS agent_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  agent_id TEXT,
  principal_id TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  effect TEXT,
  max_amount REAL,
  requires_approval INTEGER DEFAULT 0,
  delegation_id TEXT,
  policy_id TEXT,
  computed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_permissions_agent ON agent_permissions(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_permissions_resource ON agent_permissions(user_id, resource_type, resource_id);

ALTER TABLE runs ADD COLUMN agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(user_id, agent_id);
