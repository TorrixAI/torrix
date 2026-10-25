export interface User {
  id: string;
  email: string;
  password: string;
  api_key: string | null;
  is_admin: number;
  must_change_password: number;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  budget_usd?: number | null;
  hard_cap_usd?: number | null;
  prompt_compression?: string | null;
  compression_words?: string | null;
}

export type ProjectRole = "owner" | "editor" | "viewer";

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  created_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scope: string;
  projects: string | null;
  permission: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  budget_usd?: number | null;
  hard_cap_usd?: number | null;
}

export type RunSource =
  | "proxy"
  | "sdk"
  | "playground"
  | "eval"
  | "mcp"
  | "mcp_proxy"
  | "mcp_gateway"
  | "a2a"
  | "otel"
  | "dataset";

export interface Run {
  id: string;
  user_id: string;
  project_id: string;
  name?: string | null;
  provider?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  thinking_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_creation_tokens?: number | null;
  cost_usd?: number | null;
  latency_ms?: number | null;
  status?: number | null;
  finish_reason?: string | null;
  source?: string | null;
  is_golden?: number | null;
  score?: number | null;
  score_note?: string | null;
  scored_at?: string | null;
  run_note?: string | null;
  request_body?: string | null;
  request_bytes?: number | null;
  response_bytes?: number | null;
  target_url?: string | null;
  trace_id?: string | null;
  session_id?: string | null;
  parent_run_id?: string | null;
  routed_from?: string | null;
  fallback_used?: number | null;
  structured_output?: string | null;
  json_parse_ok?: number | null;
  agent_name?: string | null;
  agent_id?: string | null;
  end_user_id?: string | null;
  prompt_hash?: string | null;
  tags?: string | null;
  api_key_id?: string | null;
  dataset_id?: string | null;
  dataset_row_id?: string | null;
  share_token?: string | null;
  is_anomaly?: number | null;
  original_input_tokens?: number | null;
  original_request_body?: string | null;
  is_seed?: number | null;
  error?: string | null;
  review_state?: string | null;
  pii_masked?: number | null;
  pii_findings?: string | null;
  policy_flags?: string | null;
  share_expires_at?: string | null;
  media_count?: number | null;
  media_assets?: string | null;
  retrieval_docs?: string | null;
  intent_cluster?: string | null;
  created_at: string;
}

export type EventType =
  | "request"
  | "response"
  | "prompt"
  | "thinking"
  | "tool_call"
  | "error"
  | "info"
  | "summary";

export interface Events {
  id: string;
  run_id: string;
  message: string;
  type: string;
  created_at: string;
}

export interface RunData {
  id: string;
  user_id: string;
  project_id: string;
  name?: string;
  model?: string;
  provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  status?: number;
  finish_reason?: string;
  source: RunSource;
  is_golden?: boolean;
  score?: number | null;
  run_note?: string;
  request_body?: string;
  request_bytes?: number;
  response_bytes?: number;
  target_url?: string;
  trace_id?: string;
  session_id?: string;
  parent_run_id?: string;
  routed_from?: string;
  fallback_used?: boolean;
  structured_output?: string | null;
  json_parse_ok?: boolean | null;
  agent_name?: string;
  agent_id?: string;
  end_user_id?: string;
  prompt_hash?: string;
  tags?: Record<string, string>;
  api_key_id?: string;
  dataset_id?: string;
  dataset_row_id?: string;
  share_token?: string;
  is_anomaly?: boolean;
  original_input_tokens?: number;
  original_request_body?: string;
  error?: string;
  review_state?: string;
  pii_masked?: boolean;
  pii_findings?: string;
  policy_flags?: string;
  share_expires_at?: string;
  media_count?: number;
  media_assets?: string;
  retrieval_docs?: string;
  intent_cluster?: string;
  created_at?: string;
}

export interface Prompt {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  description?: string | null;
  tags?: string | null;
  latest_revision: number;
  active_revision?: number | null;
  created_at: string;
  updated_at: string;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  revision: number;
  template: string;
  variables?: string | null;
  model?: string | null;
  note?: string | null;
  author_user_id: string;
  created_at: string;
}

export interface Dataset {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatasetRow {
  id: string;
  dataset_id: string;
  idx: number;
  input: string;
  expected?: string | null;
  tags?: string | null;
  created_at: string;
}

export type EvalScorer = "exact" | "contains";

export type OnlineEvalScorer = EvalScorer | "judge";

export type GuardrailAction = "off" | "flag" | "hold_next" | "block_session";

export interface GuardrailEvent {
  id: string;
  user_id: string;
  project_id: string | null;
  session_id: string;
  run_id: string | null;
  score: number | null;
  threshold: number | null;
  action: GuardrailAction;
  created_at: string;
  expires_at: string;
}

export interface Eval {
  id: string;
  user_id: string;
  project_id: string;
  dataset_id: string;
  mode: "offline" | "online";
  provider: string;
  model: string;
  target_url: string | null;
  temperature: number | null;
  max_tokens: number | null;
  scorer: OnlineEvalScorer;
  status: "running" | "done" | "failed";
  total_rows: number;
  rows_done: number;
  passed: number;
  fail: number;
  score_sum: number;
  cost_usd: number;
  judge_cost_usd?: number | null;
  tokens_total: number;
  avg_latency_ms: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

export interface EvalResult {
  id: string;
  eval_id: string;
  dataset_row_id?: string | null;
  run_id?: string | null;
  score: number;
  score_note?: string | null;
  latency_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  error?: string | null;
  created_at: string;
}

export interface JudgeSettings {
  user_id: string;
  provider: string;
  base_url: string | null;
  model: string | null;
  api_key: string | null;
  criteria: string | null;
  updated_at: string;
}

export interface RunJudgment {
  id: string;
  run_id: string;
  user_id: string;
  provider: string | null;
  model: string | null;
  criteria: string | null;
  score: number | null;
  rationale: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number;
  raw: string | null;
  error: string | null;
  created_at: string;
}

export interface OnlineEvalConfig {
  project_id: string;
  user_id: string;
  enabled: number;
  dataset_id: string | null;
  scorer: OnlineEvalScorer;
  judge_enabled: number;
  judge_criteria: string | null;
  guardrail_action: GuardrailAction;
  guardrail_threshold: number;
  guardrail_window_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface AuthResult {
  user: User;
  keyRecord: ApiKey | null;
}

export interface PricingOverride {
  model: string;
  input: number;
  output: number;
  created_at: string;
}

export interface AlertSettings {
  user_id: string;
  enabled: number;
  webhook_url: string | null;
  webhook_secret: string | null;
  pagerduty_routing_key: string | null;
  email_webhook_url: string | null;
  email_webhook_token: string | null;
  email_recipients: string | null;
  budget_usd: number | null;
  hard_cap_usd: number | null;
  last_alert_at: string | null;
  last_alert_level: number | null;
  notify_on_error: number;
  anomaly_enabled: number;
  anomaly_multiplier: number;
  digest_enabled: number;
  last_digest_sent_at: string | null;
}

export interface CostUsageRow {
  scope: "user" | "project" | "api_key";
  id: string | null;
  name: string;
  spend: number;
  budget_usd: number | null;
  hard_cap_usd: number | null;
}

export type PiiType =
  | "email"
  | "phone"
  | "card"
  | "iban"
  | "ssn"
  | "ipv4"
  | "postal"
  | "passport"
  | "api_key";

export interface GovernanceSettings {
  user_id: string;
  pii_enabled: number;
  pii_types: string;
  pii_placeholder: string;
  pii_mask_input: number;
  pii_mask_output: number;
  human_review_enabled: number;
  audit_enabled: number;
  updated_at: string;
}

export type PolicyAction = "block" | "flag";
export type PolicyStage = "request" | "response";
export type PolicyMatchKind = "keyword" | "regex" | "pii" | "model" | "max_tokens" | "model_not_in_list" | "cost_above";
export type PolicySeverity = "low" | "medium" | "high";

export interface Policy {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  enabled: number;
  action: PolicyAction;
  stage: PolicyStage;
  match_kind: PolicyMatchKind;
  match_value: string | null;
  severity: PolicySeverity;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  id: string;
  user_id: string;
  project_id: string | null;
  actor: string;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
  created_at: string;
}

export type RoutingMatchKind = "exact" | "prefix" | "regex";

export interface RoutingRule {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  enabled: number;
  priority: number;
  match_provider: string | null;
  match_model: string | null;
  match_kind: RoutingMatchKind;
  match_prompt?: string | null;
  match_prompt_regex?: string | null;
  target_model: string;
  target_url?: string | null;
  fallback_model: string | null;
  max_cost_usd: number | null;
  min_quality_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface RoutingDecision {
  ruleId: string;
  ruleName: string;
  originalModel: string;
  targetModel: string;
  fallbackModel: string | null;
  estimatedCost: number;
  reason: string;
}

export type ReviewState = "pending" | "approved" | "rejected";

export interface ReviewItem {
  id: string;
  run_id: string;
  user_id: string;
  project_id: string;
  state: ReviewState;
  reviewer_user_id: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

export type ExportProvider = "s3" | "gcs";

export interface ExportConfig {
  id: string;
  user_id: string;
  provider: ExportProvider;
  endpoint: string | null;
  bucket: string;
  prefix: string;
  access_key_id: string | null;
  secret_access_key: string | null;
  schedule_minutes: number;
  enabled: number;
  last_export_at: string | null;
  last_run_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PiiFinding {
  type: PiiType;
  count: number;
  samples: string[];
}

export interface PolicyVerdict {
  policyId: string;
  policyName: string;
  action: PolicyAction;
  stage: PolicyStage;
  severity: PolicySeverity;
  detail: string;
}

export interface PolicyDecision {
  blocked: boolean;
  blockReason: string | null;
  flags: PolicyVerdict[];
}

export interface SlmOpportunity {
  cluster: string;
  runs: number;
  spendUsd: number;
  avgLatencyMs: number;
  suggestion: string;
  sampleRunId: string | null;
}

export type AgentStatus = "active" | "suspended" | "blocked" | "expired" | "revoked";

export interface Agent {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  business_owner: string | null;
  purpose: string | null;
  environment: string;
  status: AgentStatus;
  model: string | null;
  provider: string | null;
  identity_provider: string | null;
  external_subject: string | null;
  tags: string | null;
  risk_level: RiskLevel | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentCredential {
  id: string;
  agent_id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export type PrincipalKind = "human" | "service" | "application" | "external";
export type PrincipalStatus = "active" | "disabled";
export type IdentityProviderKind = "local" | "oidc" | "entra" | "okta" | "sap_ias" | "scim";

export interface Principal {
  id: string;
  user_id: string;
  kind: PrincipalKind;
  display_name: string;
  email: string | null;
  linked_user_id: string | null;
  identity_provider: IdentityProviderKind;
  external_subject: string | null;
  status: PrincipalStatus;
  created_at: string;
  updated_at: string;
}

export type DelegationStatus = "active" | "revoked" | "expired" | "suspended";

export interface DelegationLimits {
  automatic_approval_amount?: number;
  maximum_amount?: number;
  currency?: string;
  daily_limit?: number;
}

export interface Delegation {
  id: string;
  user_id: string;
  principal_id: string;
  agent_id: string;
  delegator_agent_id: string | null;
  parent_delegation_id: string | null;
  purpose: string | null;
  allowed_actions: string;
  allowed_resources: string;
  conditions: string;
  limits: string;
  status: DelegationStatus;
  starts_at: string | null;
  expires_at: string | null;
  depth: number;
  created_by_user_id: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export type AuthorizationEffect = "allow" | "deny" | "require_approval";

export interface AuthorizationPolicy {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  enabled: number;
  effect: AuthorizationEffect;
  priority: number;
  conditions: string;
  actions: string;
  resources: string;
  latest_version: number;
  created_at: string;
  updated_at: string;
}

export interface AuthorizationPolicyVersion {
  id: string;
  policy_id: string;
  user_id: string;
  version: number;
  snapshot: string;
  note: string | null;
  author_user_id: string | null;
  created_at: string;
}

export type DecisionPosture = "deny" | "allow";

export interface AgentControlSettings {
  user_id: string;
  default_posture: DecisionPosture;
  approval_timeout_minutes: number;
  max_delegation_depth: number;
  risk_escalation: string;
  authorization_retention_days: number | null;
  approval_alerts: number;
  approval_webhook_url: string | null;
  webhook_secret: string | null;
  require_grant: number;
  updated_at: string;
}

export type AuthorizationProtocol = "rest" | "sdk" | "mcp" | "a2a";

export type RequestState =
  | "requested"
  | "allowed"
  | "denied"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired";

export interface AuthorizationRequest {
  id: string;
  user_id: string;
  project_id: string | null;
  agent_id: string;
  credential_id: string | null;
  principal_id: string | null;
  delegation_id: string | null;
  delegation_chain: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  tool_name: string | null;
  target_system: string | null;
  protocol: AuthorizationProtocol;
  params: string | null;
  context: string | null;
  request_hash: string;
  trace_id: string | null;
  run_id: string | null;
  session_id: string | null;
  parent_run_id: string | null;
  state: RequestState;
  execution_status: string | null;
  result_summary: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export type DecisionKind = "allow" | "deny" | "require_approval";

export interface AuthorizationDecisionRecord {
  id: string;
  request_id: string;
  user_id: string;
  agent_id: string;
  principal_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  tool_name: string | null;
  protocol: AuthorizationProtocol;
  decision: DecisionKind;
  policy_id: string | null;
  policy_version_id: string | null;
  policy_name: string | null;
  policy_version: number | null;
  reason: string;
  reason_code: string;
  risk_level: RiskLevel | null;
  risk_score: number | null;
  risk_factors: string | null;
  request_hash: string;
  trace_id: string | null;
  run_id: string | null;
  latency_ms: number | null;
  engine_version: string | null;
  error_code: string | null;
  created_at: string;
}

export type ApprovalState = "pending" | "approved" | "rejected" | "expired" | "cancelled" | "consumed";

export interface Approval {
  id: string;
  request_id: string;
  user_id: string;
  principal_id: string | null;
  agent_id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  tool_name: string | null;
  target_system: string | null;
  params_summary: string | null;
  state: ApprovalState;
  request_hash: string;
  policy_id: string | null;
  policy_version_id: string | null;
  reason: string | null;
  risk_level: RiskLevel | null;
  expires_at: string | null;
  reviewer_user_id: string | null;
  note: string | null;
  consumed_at: string | null;
  decided_at: string | null;
  created_at: string;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  signal: string;
  value: number;
  detail: string;
}

export interface RiskAssessmentResult {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
}

export interface RiskAssessmentRecord {
  id: string;
  request_id: string;
  user_id: string;
  level: RiskLevel;
  score: number;
  factors: string;
  engine_version: string;
  created_at: string;
}

export type ConditionOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "matches";

export interface ConditionLeaf {
  field: string;
  op: ConditionOp;
  value: unknown;
}

export interface ConditionAll {
  all: ConditionNode[];
}

export interface ConditionAny {
  any: ConditionNode[];
}

export interface ConditionNot {
  not: ConditionNode;
}

export type ConditionNode = ConditionLeaf | ConditionAll | ConditionAny | ConditionNot;

export interface AuthorizationInput {
  userId: string;
  projectId: string | null;
  agentId: string;
  credentialId: string | null;
  principalId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  toolName: string | null;
  targetSystem: string | null;
  protocol: AuthorizationProtocol;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  traceId: string | null;
  runId: string | null;
  sessionId?: string | null;
  parentRunId?: string | null;
  grantDelegationId?: string | null;
}

export interface AuthorizationOutcome {
  requestId: string;
  decision: DecisionKind;
  reasonCode: string;
  reason: string;
  policyId: string | null;
  policyName: string | null;
  policyVersion: number | null;
  policyVersionId: string | null;
  risk: RiskAssessmentResult;
  approvalId: string | null;
  approvalExpiresAt: string | null;
  delegationId: string | null;
  chain: string[];
  latencyMs: number;
}

export type McpServerAuthType = "none" | "bearer" | "api_key" | "custom_headers" | "oauth";
export type McpServerStatus = "connected" | "error" | "unknown";

export interface McpServer {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  endpoint: string;
  transport: string;
  auth_type: McpServerAuthType;
  auth_config: string | null;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  oauth_token: string | null;
  oauth_authorized_at: string | null;
  sign_requests: number;
  environment: string;
  status: McpServerStatus;
  last_checked_at: string | null;
  last_error: string | null;
  tools_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface McpOAuthState {
  state: string;
  user_id: string;
  server_id: string;
  code_verifier: string;
  created_at: string;
  expires_at: string;
}

export interface McpServerTool {
  id: string;
  server_id: string;
  user_id: string;
  name: string;
  description: string | null;
  action: string | null;
  input_schema: string | null;
  annotations: string | null;
  discovered_at: string;
}

export interface AgentTool {
  id: string;
  agent_id: string;
  user_id: string;
  server_id: string;
  tool_name: string;
  action: string | null;
  created_at: string;
}

export interface AgentPermission {
  id: string;
  user_id: string;
  agent_id: string;
  principal_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  effect: AuthorizationEffect;
  max_amount: number | null;
  requires_approval: number;
  delegation_id: string | null;
  policy_id: string | null;
  computed_at: string;
}