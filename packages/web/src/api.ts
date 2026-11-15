import { formatCompact, formatDateTime, formatDuration, formatMoney } from "./lib/format";
export { formatCount, formatCompact, formatDate, formatDateTime, formatDuration, formatMoney, formatPercent, deltaArrow, deltaTone } from "./lib/format";
export type { DeltaMetric, DeltaTone } from "./lib/format";

export interface Run {
  id: string;
  name?: string | null;
  provider?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  thinking_tokens?: number | null;
  cost_usd?: number | null;
  latency_ms?: number | null;
  status?: number | null;
  source?: string | null;
  score?: number | null;
  score_note?: string | null;
  run_note?: string | null;
  request_body?: string | null;
  trace_id?: string | null;
  session_id?: string | null;
  parent_run_id?: string | null;
  agent_name?: string | null;
  agent_id?: string | null;
  end_user_id?: string | null;
  error?: string | null;
  created_at: string;
  finish_reason?: string | null;
  routed_from?: string | null;
  fallback_used?: number | boolean | null;
  target_url?: string | null;
  retrieval_docs?: string | null;
  media_assets?: string | null;
  media_count?: number | null;
  pii_masked?: number | boolean | null;
  pii_findings?: string | null;
  policy_flags?: string | null;
  review_state?: string | null;
  is_golden?: number | boolean | null;
  share_token?: string | null;
  share_expires_at?: string | null;
  is_anomaly?: number | boolean | null;
}

export interface Judgment {
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

export interface MediaAsset {
  kind: string;
  mime: string | null;
  source?: string;
  ref?: string;
  bytes: number | null;
  sha256: string;
  stored_path?: string;
}

export interface CostComparisonRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface JudgeSettingsView {
  settings: {
    provider: string;
    base_url: string | null;
    model: string | null;
    criteria: string | null;
    has_api_key: boolean;
    updated_at: string | null;
  };
  default_criteria?: string;
}

export interface RunEvent {
  id?: string;
  run_id: string;
  type: string;
  message: string;
  created_at: string;
}

export interface AgentRollup {
  agent: string;
  runs: number;
  cost: number;
  errorCount: number;
}

export interface McpToolRollup {
  tool: string;
  runs: number;
  cost: number;
  errorCount: number;
}

export interface McpRollup {
  calls: number;
  denied: number;
  pending: number;
  errorCount: number;
  tools: McpToolRollup[];
}

export interface DashboardWindow {
  totalCost: number;
  totalRuns: number;
  totalTokens: number;
  errorCount: number;
  flaggedCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgScore: number | null;
  scoredCount: number;
}

export interface Dashboard {
  totalCost: number;
  totalRuns: number;
  totalTokens: number;
  errorCount: number;
  flaggedCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgScore: number | null;
  scoredCount: number;
  judgeCostUsd?: number;
  project_name?: string | null;
  previous: DashboardWindow | null;
  perDay: { date: string; cost: number; runs: number; tokens: number; errors: number; anomalies: number; latencyMs: number }[];
  perDayPrevious?: { date: string; cost: number; runs: number; tokens: number; errors: number; anomalies: number; latencyMs: number }[];
  byModel: { model: string; runs: number; cost: number }[];
  bySource: { source: string; runs: number; cost: number }[];
  byAgent: AgentRollup[];
  mcp: McpRollup;
  latencyBuckets: { bucket: string; count: number }[];
}

export interface RunListSummary {
  agents: number;
  subagents: number;
  sessions: number;
  traces: number;
}

export interface RunEventCount {
  runId: string;
  type: string;
  count: number;
}

export interface RunFirstTool {
  runId: string;
  message: string;
  createdAt: string;
}

export interface RunGroupTotals {
  runs: number;
  agents: number;
  subagents: number;
  cost: number;
  tokens: number;
  errors: number;
  firstAt: string | null;
  lastAt: string | null;
  maxLatencyMs: number;
}

export interface RunPage {
  runs: Run[];
  total: number;
  run_total?: number;
  page: number;
  limit: number;
  summary?: RunListSummary;
  eventCounts?: RunEventCount[];
  firstTools?: RunFirstTool[];
  group?: "none" | "trace" | "session";
  /** Grouped mode: server aggregates, one row per session/trace. */
  groups?: TraceGroup[];
  group_total?: number;
  group_page?: number;
  group_limit?: number;
}

export interface RunDetail extends Run {
  judgments?: Judgment[];
  children?: Run[];
}

export interface ProjectsResponse {
  projects: { id: string; name: string }[];
}

export interface AnalyticsRow {
  key: string;
  runs: number;
  tokens: number;
  cost: number;
  cost_per_1k_tokens?: number;
  errorCount: number;
  error_rate?: number;
  avgLatencyMs: number;
  avgScore: number | null;
}

export interface LeaderboardResponse {
  window_days: number;
  models: AnalyticsRow[];
}

export interface AnalyticsAgentsResponse {
  window_days: number;
  agents: AnalyticsRow[];
}

export interface AnalyticsUsersResponse {
  window_days: number;
  end_users: AnalyticsRow[];
}

export interface AnalyticsToolsResponse {
  window_days: number;
  tools: AnalyticsRow[];
}

export interface TraceGroup {
  id: string;
  runs: number;
  subagents: number;
  cost: number;
  tokens: number;
  errorCount: number;
  firstAt: string;
  lastAt: string;
  models: string[];
  agents: string[];
  trace_score?: number | null;
  trace_score_reason?: string | null;
  first_failing_run_id?: string | null;
  session_score?: number | null;
  session_judged?: number;
  session_good?: number;
}

export interface TracesResponse {
  sessions: TraceGroup[];
  traces: TraceGroup[];
  roots?: Record<string, { agentName: string | null; requestBody: string | null }>;
  totals?: { sessions: number; traces: number };
  paging?: { limit: number; sessions: { page: number }; traces: { page: number } };
}

export interface TraceAnnotation {
  id: string;
  kind: string;
  runId?: string | null;
  traceId?: string | null;
  sessionId?: string | null;
  parentRunId?: string | null;
  at: string;
  title: string;
  detail?: string | null;
  status?: string | null;
  riskLevel?: string | null;
  approval?: { state: string; reviewer: string | null; decidedAt: string | null; waitMs: number | null } | null;
  meta?: {
    request_id?: string;
    action?: string;
    resource_type?: string;
    resource_id?: string;
    tool_name?: string;
    target_system?: string;
    protocol?: string;
    state?: string;
    execution_status?: string;
    reason_code?: string | null;
    policy?: { id?: string; name?: string; version?: number } | null;
    risk_score?: number | null;
    latency_ms?: number | null;
    principal?: { id?: string; kind?: string; display_name?: string | null } | null;
    delegation?: { id?: string; principal_id?: string; purpose?: string | null } | null;
    approval_note?: string | null;
    [key: string]: unknown;
  } | null;
}

export interface GroupRunsResponse {
  kind: "trace" | "session";
  id: string;
  runs: Run[];
  total: number;
  eventCounts?: RunEventCount[];
  firstTools?: RunFirstTool[];
  lastAnswers?: RunFirstTool[];
  toolNames?: Array<{ runId: string; name: string }>;
  totals?: RunGroupTotals;
  trace_score?: number | null;
  trace_score_reason?: string | null;
  first_failing_run_id?: string | null;
  session_score?: number | null;
  session_judged?: number;
  session_good?: number;
  authorization?: TraceAnnotation[];
  limit: number;
  offset: number;
}

export interface JudgeJobState {
  id: string;
  kind: "run" | "trace";
  total: number;
  completed: number;
  good: number;
  bad: number;
  failed: number;
  status: "queued" | "running" | "stopped" | "done";
  stopped: boolean;
  errors: Array<{ trace_id: string; error: string }>;
}

export interface InsightsReport {
  days: number;
  generatedWith: string;
  judgeCostUsd?: number;
  runs: number;
  spendUsd: number;
  priorSpendUsd?: number | null;
  errorRate: number;
  anomalyCount: number;
  highlights: string[];
  actions: { label: string; detail: string; href: string }[];
  caching: {
    totalPotentialSavingsUsd: number;
    repeatedGroups: {
      promptPrefix: string;
      calls: number;
      avgInputTokens: number;
      potentialSavingsUsd: number;
    }[];
  };
  slm: {
    estimatedSavingsUsd: number;
    opportunities: {
      cluster: string;
      runs: number;
      spendUsd: number;
      suggestion: string;
    }[];
  };
  agents: {
    name: string;
    runs: number;
    cost: number;
    errorCount: number;
  }[];
  mcp: {
    calls: number;
    denied: number;
    pending: number;
    tools: {
      tool: string;
      runs: number;
      cost: number;
    }[];
  };
}

export interface SavingsRecommendation {
  id: string;
  kind: "slm_downshift" | "prompt_cache" | "compression" | "model_switch";
  title: string;
  detail: string;
  monthly_usd: number;
  confidence: "high" | "medium" | "low";
  evidence: { runs?: number; models?: string[]; run_ids?: string[] };
}

export interface SavingsReport {
  window_days: number;
  total_monthly_usd: number;
  recommendations: SavingsRecommendation[];
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  scope: string;
  projects: string[];
  permission: string;
  created_at: string;
  last_used_at: string | null;
  budget_usd?: number | null;
  hard_cap_usd?: number | null;
  /** 1 when the key was created by a browser sign-in. */
  session?: number;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  role?: string;
  budget_usd?: number | null;
  hard_cap_usd?: number | null;
  prompt_compression?: string | null;
  compression_words?: string | null;
}

export interface ProjectMember {
  user_id: string;
  email: string;
  role: string;
}

export interface UserRecord {
  id: string;
  email: string;
  is_admin: number;
  must_change_password: number;
  created_at: string;
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

export interface PromptRevisionStats {
  revision: number;
  runs: number;
  cost: number;
  tokens: number;
  avgLatencyMs: number;
  avgScore: number | null;
}

export interface PromptStats {
  prompt_id: string;
  name: string;
  active_revision: number;
  runs: number;
  cost: number;
  tokens: number;
  avgLatencyMs: number;
  avgScore: number | null;
  revisions: PromptRevisionStats[];
}

export interface Dataset {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  rows?: number;
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

export interface Eval {
  id: string;
  user_id: string;
  project_id: string;
  dataset_id: string;
  mode: "offline" | "online";
  provider: string;
  model: string;
  target_url: string | null;
  scorer: "exact" | "contains" | "judge";
  status: "running" | "done" | "failed";
  total_rows: number;
  rows_done: number;
  passed: number;
  fail: number;
  score_sum: number;
  cost_usd: number;
  tokens_total: number;
  avg_latency_ms: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  dataset_name?: string | null;
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
  input_hint?: string | null;
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

export interface PricingOverride {
  model: string;
  input: number;
  output: number;
  created_at: string;
}

export interface OnlineEvalConfig {
  id: string;
  project_id: string;
  enabled: number;
  dataset_id: string | null;
  scorer: string;
  judge_enabled: number;
  judge_criteria: string | null;
}

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

export interface Policy {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  enabled: number;
  action: "block" | "flag";
  stage: "request" | "response";
  match_kind: string;
  match_value: string | null;
  severity: "low" | "medium" | "high";
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewRunRef {
  id: string;
  name: string | null;
  model: string | null;
  provider: string | null;
  status: number | null;
  cost_usd: number | null;
  created_at: string;
  pii_findings?: unknown;
  policy_flags?: unknown;
}

export interface ReviewItem {
  id: string;
  run_id: string;
  user_id: string;
  project_id: string;
  state: "pending" | "approved" | "rejected";
  reviewer_user_id: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
  run: ReviewRunRef | null;
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

export interface RoutingRule {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  enabled: number;
  priority: number;
  match_provider: string | null;
  match_model: string | null;
  match_kind: string;
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

export interface SlmCandidate {
  cluster: string;
  runs: number;
  spendUsd: number;
  avgLatencyMs: number;
  suggestion: string;
  sampleRunId: string | null;
}

export interface ExportConfig {
  id: string;
  user_id: string;
  provider: "s3" | "gcs";
  endpoint: string | null;
  bucket: string;
  prefix: string;
  access_key_id: string | null;
  secret_access_key?: string | null;
  schedule_minutes: number;
  enabled: number;
  last_export_at: string | null;
  last_run_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface GovernanceReport {
  generatedAt: string;
  window: { from: string; to: string; days: number };
  system: { name: string; selfHosted: boolean; dataResidency: string; modelProviders: { model: string; provider: string; runs: number; costUsd: number }[] };
  inventory: { totalRuns: number; totalSpendUsd: number; errorCount: number; maskedRuns: number; flaggedRuns: number; blockedRuns: number; pendingReview: number; approvedRuns: number; rejectedRuns: number };
  transparency: { loggedRequestBodies: number; loggedResponses: number; loggedThinking: number; loggedToolCalls: number; retentionDays: number; piiMasking: { enabled: boolean; types: string[]; inputMasked: boolean; outputMasked: boolean } };
  humanOversight: { reviewEnabled: boolean; policyCount: number; blockingPolicyCount: number; lastReviewDecisions: { state: string; decidedAt: string | null }[] };
  dataGovernance: { auditEvents: number; firstAuditEvent: string | null; lastAuditEvent: string | null; externalExportConfigured: boolean };
  byDay: { date: string; runs: number; cost: number; errors: number }[];
  topRisks: string[];
  article12Recordkeeping: boolean;
}

export interface ComplianceSummary {
  total_runs: number;
  flagged_runs: number;
  anomalies: number;
  errors: number;
  cost_usd: number;
  audit_actions: number;
}

export interface SettingsPermissions {
  tabs: string[];
  is_admin: boolean;
  edition: string;
}

export interface DatabaseInfo {
  driver: "sqlite" | "postgres";
  label: string;
  envOverride: boolean;
}

export interface LicenseInfo {
  edition: string;
  source: "env" | "license";
  licensee: string | null;
  expires_at: string | null;
}

export interface SsoConfig {
  configured: boolean;
  source: "settings" | "env" | "none";
  issuer: string;
  client_id: string;
  has_secret: boolean;
  scopes: string;
  auto_provision: boolean;
  redirect_uri: string;
}

export type AgentStatus = "active" | "suspended" | "blocked" | "expired" | "revoked";

export interface AgentActivity {
  agentId: string;
  lastActiveAt: string | null;
  actions7d: number;
  denied7d: number;
  pendingApprovals: number;
}

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
  risk_level: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  frozen?: number | null;
  frozen_reason?: string | null;
  frozen_at?: string | null;
  max_actions_per_minute?: number | null;
  created_at: string;
  updated_at: string;
  activity?: AgentActivity | null;
}

export interface AgentCredential {
  id: string;
  agent_id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
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

export interface Coverage {
  observed: number;
  governed: number;
  covered: number;
  coverage_percent: number;
  uncovered: Array<{ name: string; runs: number; cost: number; lastSeen: string }>;
  registered_without_traffic: Array<{ id: string; name: string; slug: string; status: string }>;
}

export interface ObservedAgent {
  name: string;
  runs: number;
  tokens: number;
  cost: number;
  errorCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface Principal {
  id: string;
  user_id: string;
  kind: string;
  display_name: string;
  email: string | null;
  linked_user_id: string | null;
  identity_provider: string;
  external_subject: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

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
  allowed_actions: string[] | string;
  allowed_resources: string[] | string;
  conditions: string;
  limits: DelegationLimits | string;
  status: string;
  effective_status?: string;
  starts_at: string | null;
  expires_at: string | null;
  depth: number;
  created_by_user_id: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthorizationPolicy {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  enabled: number;
  effect: "allow" | "deny" | "require_approval";
  priority: number;
  conditions: Record<string, unknown> | string;
  actions: string[] | string;
  resources: string[] | string;
  latest_version: number;
  /** `shadow` policies record what they would decide and never block. */
  enforcement?: "enforce" | "shadow";
  /** 7-day observe-only counts, null when the policy never matched. */
  shadow?: PolicyShadowCounts | null;
  created_at: string;
  updated_at: string;
}

export interface SiemDestinationView {
  id: string;
  name: string;
  kind: "splunk" | "sentinel";
  endpoint_url: string;
  auth_type: "token" | "client_credentials";
  has_token: boolean;
  has_client_secret: boolean;
  tenant_id: string | null;
  client_id: string | null;
  enabled: number;
  batch_size: number;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type AgentIdentityKind = "entra" | "okta" | "agentcore" | "id_jag" | "custom";

export interface AgentIdentityProvider {
  id: string;
  name: string;
  kind: AgentIdentityKind;
  issuer: string;
  audience: string;
  jwks_uri: string | null;
  discovery_url: string | null;
  agent_provider: string;
  owner_user_id: string;
  subject_claim: string | null;
  principal_claim: string;
  principal_provider: string;
  agent_claim: string;
  token_ttl_seconds: number;
  enabled: boolean;
}

export interface McpServerTool {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  action: string | null;
  input_schema: string | null;
  annotations: string | null;
  discovered_at: string;
}

export interface ToolPin {
  tool_name: string;
  definition_hash: string;
  pinned_at: string;
  pinned_by: string | null;
  last_seen_hash: string | null;
  last_seen_at: string | null;
  drift_at: string | null;
  drift_hash: string | null;
  drift_reason: string | null;
}

export interface DelegationGrant {
  jti: string;
  delegation_id: string;
  agent_id: string;
  principal_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  status: "active" | "expired" | "revoked";
}

export interface PolicyShadowCounts {
  matched: number;
  would_change: number;
  would_deny: number;
  would_hold: number;
  last_hit_at: string | null;
}

export interface PolicyPack {
  id: string;
  name: string;
  description: string;
  policies: Array<{ name: string; description: string; effect: "allow" | "deny" | "require_approval"; priority: number }>;
}

export interface ShadowReport {
  policy_id: string;
  name: string;
  effect: "allow" | "deny" | "require_approval";
  enforcement: "enforce" | "shadow";
  window_days: number;
  requests_in_window: number;
  stats: PolicyShadowCounts;
  examples: Array<{
    request_id: string;
    at: string;
    agent_id: string;
    action: string;
    tool: string | null;
    params_preview: string;
    would: "allow" | "deny" | "require_approval";
    actual: "allow" | "deny" | "require_approval";
  }>;
}

export interface SimulationReport {
  window: { days: number; from: string; to: string; limit: number; agent_id: string | null; truncated: boolean };
  totals: { requests: number; replayed: number; skipped: number; unchanged: number; changed: number; drifted_from_recorded: number };
  skipped_reasons: Record<string, number>;
  transitions: Record<string, number>;
  newly: { denied: number; held: number; allowed: number };
  by_agent: Array<{ agent_id: string; agent_name: string; changed: number }>;
  samples: Array<{
    request_id: string;
    at: string;
    agent_id: string;
    agent_name: string;
    action: string;
    tool: string | null;
    target: string | null;
    params_preview: string;
    recorded: { decision: string; reason_code: string; policy_name: string | null } | null;
    current: { decision: string; reason_code: string; policy_name: string | null };
    candidate: { decision: string; reason_code: string; policy_name: string | null };
  }>;
}

export interface SuggestedPolicy {
  name: string;
  description: string;
  effect: "allow" | "deny" | "require_approval";
  priority: number;
  actions: string[];
  resources: string[];
  conditions: Record<string, unknown>;
  enforcement: "shadow";
  reason: string;
  evidence: { requests: number; tool_calls: number };
}

export interface SuggestedDelegation {
  action: "create" | "narrow_existing" | "none";
  agent_id: string;
  principal_id: string | null;
  purpose: string;
  allowed_actions: string[];
  allowed_resources: string[];
  limits: DelegationLimits;
  existing_delegation_id: string | null;
  existing: {
    allowed_actions: string[];
    allowed_resources: string[];
    limits: DelegationLimits;
    covers_observed: boolean;
    broader_than_observed: boolean;
  } | null;
  reason: string;
}

export interface PolicySuggestionReport {
  window: { days: number; from: string; to: string; agent_id: string; agent_name: string; truncated: boolean };
  sources: {
    governed_requests: number;
    allowed: number;
    denied: number;
    held: number;
    missing_decisions: number;
    runs: number;
    tool_calls: number;
  };
  delegation: SuggestedDelegation | null;
  policies: SuggestedPolicy[];
  outliers: Array<{ kind: string; detail: string; action?: string; count: number }>;
  observations: {
    actions: Array<{ action: string; allowed: number; denied: number; held: number; tool_calls: number }>;
    resources: Array<{ value: string; count: number }>;
    principals: Array<{ principal_id: string; count: number }>;
    hours: number[];
    weekdays: number[];
    amounts: { count: number; min: number | null; median: number | null; p95: number | null; max: number | null; currency: string | null };
  };
  warnings: string[];
  confidence: "high" | "medium" | "low";
  generated_at: string;
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
  state: string;
  request_hash: string;
  policy_id: string | null;
  policy_version_id: string | null;
  reason: string | null;
  risk_level: string | null;
  expires_at: string | null;
  reviewer_user_id: string | null;
  note: string | null;
  consumed_at: string | null;
  decided_at: string | null;
  created_at: string;
  canary?: number | null;
  canary_expected?: string | null;
  canary_outcome?: "caught" | "missed" | null;
  required_approvals?: number | null;
  approvals_count?: number | null;
}

export interface OversightMetrics {
  window: { days: number; from: string; to: string };
  totals: { approvals: number; decided: number; approved: number; rejected: number; expired: number; pending: number };
  rates: { approval_rate: number | null; rejection_rate: number | null; expiry_rate: number | null };
  timing: { median_seconds: number | null; p95_seconds: number | null; fastest_seconds: number | null; slowest_seconds: number | null };
  rubber_stamp: {
    flagged: boolean;
    fast_approvals: number;
    sample: number;
    threshold_seconds: number;
    threshold_rate: number;
    approval_rate: number | null;
    note: string;
  };
  canaries: { injected: number; caught: number; missed: number; pending: number; catch_rate: number | null };
  two_person: { required: number; completed: number; pending: number };
  by_tool: Array<{ tool: string; approvals: number; approved: number; rejected: number; fast_approvals: number; median_seconds: number | null }>;
  by_risk: Array<{ risk_level: string; approvals: number; approved: number; rejected: number }>;
  reviewers?: Array<{ reviewer_user_id: string; approvals: number; approved: number; rejected: number; fast_approvals: number; median_seconds: number | null }>;
  generated_at: string;
}

export interface LedgerAnchor {
  id: string;
  user_id: string;
  seq: number;
  hash: string;
  witness_url: string | null;
  witness_id: string | null;
  witnessed_at: string | null;
  receipt: string;
  created_at: string;
}

export interface AuditorToken {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  created_by_user_id: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface McpServer {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  endpoint: string;
  transport: string;
  auth_type: string;
  environment: string;
  status: string;
  last_checked_at: string | null;
  last_error: string | null;
  tools_synced_at: string | null;
  created_at: string;
  updated_at: string;
  tool_count?: number;
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

export interface AgentControlSettings {
  user_id: string;
  default_posture: "deny" | "allow";
  approval_timeout_minutes: number;
  max_delegation_depth: number;
  risk_escalation: string;
  authorization_retention_days: number | null;
  approval_alerts: number;
  approval_webhook_url: string | null;
  webhook_secret: string | null;
  require_grant: number;
  approval_min_risk: "low" | "medium" | "high" | "critical";
  rubber_stamp_seconds: number;
  rubber_stamp_rate: number;
  canary_interval_hours: number;
  freeze_all: number;
  freeze_reason: string | null;
  freeze_at: string | null;
  quarantine_after_denials: number;
  quarantine_window_minutes: number;
  updated_at: string;
}

export interface ContainmentState {
  global: { frozen: boolean; reason: string | null; at: string | null };
  agents: Array<{ id: string; name: string; slug: string; reason: string | null; at: string | null; max_actions_per_minute: number | null }>;
  tools: Array<{ id: string; agent_id: string | null; tool_name: string; reason: string | null; created_at: string }>;
  quarantine: { after_denials: number; window_minutes: number };
  spend_limits: Array<{
    id: string;
    scope: "agent" | "project";
    scope_id: string;
    scope_name: string;
    limit_usd: number;
    period: "daily" | "monthly";
    spend: number;
    paused: boolean;
  }>;
  recent: Array<{ id: string; seq: number; kind: string; payload: string; created_at: string }>;
}

export interface AgentPermission {
  id: string;
  user_id: string;
  agent_id: string;
  principal_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  effect: "allow" | "deny" | "require_approval";
  max_amount: number | null;
  requires_approval: number;
  delegation_id: string | null;
  policy_id: string | null;
  computed_at: string;
}

export interface GraphCounts {
  agents: number;
  delegations: number;
  policies: number;
  permissions: number;
  pendingApprovals: number;
  decisions24h: number;
}

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
  protocol: string;
  decision: "allow" | "deny" | "require_approval";
  policy_id: string | null;
  policy_version_id: string | null;
  policy_name: string | null;
  policy_version: number | null;
  reason: string;
  reason_code: string;
  risk_level: string | null;
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
  protocol: string;
  params: string | null;
  context: string | null;
  request_hash: string;
  trace_id: string | null;
  run_id: string | null;
  state: string;
  execution_status: string | null;
  result_summary: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface DecisionExplain {
  decision: AuthorizationDecisionRecord;
  request: AuthorizationRequest | null;
  approval: Approval | null;
  delegationChain: Delegation[];
  policyVersion: AuthorizationPolicyVersion | null;
}

export interface AppConfig {
  edition: string;
  version: string;
  maxRuns: number;
  retentionDays: number;
  maxGoldenRuns: number;
  maxPlaygroundRuns: number;
  maxDatasets: number;
  currentRuns: number;
  is_demo: boolean;
  features: string[];
  update_available: string | null;
  update_command: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const apiKey = localStorage.getItem("torrix_key");
  const headers = new Headers(init?.headers);
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "include" });
  if (response.status === 401) {
    window.location.assign(`/ui/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error("Your session has expired. Sign in again.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function money(value: number | null | undefined): string {
  return formatMoney(value);
}

export function compact(value: number | null | undefined): string {
  return formatCompact(value);
}

export function fmtMs(ms: number | null | undefined): string {
  return formatDuration(ms);
}

/** Cost tables use two decimals at or above $1 and four below. */
export function fmtCostMoney(value: number | null | undefined): string {
  return formatMoney(value);
}

/** Every console money value follows the same two-or-four decimal rule. */
export function fmtUsd(value: number | null | undefined, precision?: number): string {
  if (precision == null) return formatMoney(value);
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(precision)}`;
}

/**
 * A human prompt is prose, not a tool result, pasted file, SVG path or JSON
 * payload. The console uses this for turn labels and the trace summary, so a
 * loop's later tool output can never replace the prompt a person typed.
 */
export function looksLikeHumanPrompt(text: string | null | undefined): text is string {
  const value = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!value) return false;
  if (value.length > 2000) return false;
  if (/^[\[{]/.test(value)) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") return false;
    } catch {
      // Not JSON, so keep checking whether it reads like prose.
    }
  }
  const compact = value.replace(/\s+/g, "");
  const whitespace = value.length - compact.length;
  const words = value.match(/[A-Za-z][A-Za-z'’-]{1,}/g) ?? [];
  if (value.length >= 80 && whitespace === 0) return false;
  if (value.length >= 80 && words.length < 3) return false;
  if (value.length > 300 && whitespace / value.length < 0.02) return false;
  const codeish = compact.match(/[0-9{}[\]()<>\\/|=;:_~^`]/g)?.length ?? 0;
  if (compact.length > 0 && codeish / compact.length > 0.4) return false;
  return true;
}

function userTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record.type === "tool_result" || record.type === "function_call_output" || record.type === "tool_use") continue;
    if (record.type === "image" || record.type === "input_image" || record.type === "image_url") continue;
    if (typeof record.text === "string") parts.push(record.text);
    else if (typeof record.content === "string") parts.push(record.content);
  }
  return parts.join("\n").trim();
}

/** The first human message in a stored request body; used for turn labels. */
export function userPrompt(requestBody: string | null | undefined): string | null {
  if (!requestBody) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(requestBody) as Record<string, unknown>;
  } catch {
    const raw = requestBody.trim();
    return looksLikeHumanPrompt(raw) ? raw : null;
  }
  const messages = Array.isArray(parsed.messages)
    ? parsed.messages
    : Array.isArray(parsed.contents)
      ? parsed.contents
      : [];
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") continue;
    const message = entry as { role?: unknown; content?: unknown; parts?: unknown };
    const role = String(message.role ?? "").toLowerCase();
    if (role !== "user" && role !== "human") continue;
    const text = userTextFromContent(message.content ?? message.parts);
    if (looksLikeHumanPrompt(text)) return text;
  }
  return null;
}

/** Prompt tags are stored as a JSON object; the console edits them as "k=v, k2". */
export function promptTagsText(tags: string | null | undefined): string {
  if (!tags) return "";
  try {
    const parsed = JSON.parse(tags) as Record<string, unknown>;
    return Object.entries(parsed).map(([key, value]) => (String(value) === key ? key : `${key}=${String(value)}`)).join(", ");
  } catch {
    return tags;
  }
}

export function parseTagsText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    else out[trimmed] = trimmed;
  }
  return out;
}

/** {{variable}} placeholders as they render before the proxy fills them. */
export function renderPromptPreview(template: string): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, "[$1]");
}

export function detectPromptVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g)) found.add(match[1]);
  return [...found];
}

/** Human timestamp for tooltips and dense tables. */
export function shortStamp(iso: string | null | undefined): string {
  return formatDateTime(iso);
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const then = Date.parse(iso);
  if (!then) return "-";
  const diffSec = Math.round((Date.now() - then) / 1000);
  const future = diffSec < 0;
  const absSec = Math.abs(diffSec);
  const suffix = (value: string) => future ? `in ${value}` : `${value} ago`;
  if (absSec < 60) return suffix(`${Math.max(1, absSec)}s`);
  const diffMin = Math.round(absSec / 60);
  if (diffMin < 60) return suffix(`${diffMin}m`);
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return suffix(`${diffHours}h`);
  const diffDays = Math.round(diffHours / 24);
  return suffix(`${diffDays}d`);
}
