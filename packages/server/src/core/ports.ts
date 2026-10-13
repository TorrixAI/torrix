import type {
  Agent,
  AgentControlSettings,
  AgentCredential,
  AgentPermission,
  AgentTool,
  AlertSettings,
  ApiKey,
  Approval,
  ApprovalState,
  AuditEntry,
  AuthorizationDecisionRecord,
  AuthorizationPolicy,
  AuthorizationPolicyVersion,
  AuthorizationRequest,
  Dataset,
  DatasetRow,
  DecisionKind,
  Delegation,
  Events,
  Eval,
  EvalResult,
  ExportConfig,
  GovernanceSettings,
  GuardrailEvent,
  JudgeSettings,
  McpOAuthState,
  McpServer,
  McpServerTool,
  OnlineEvalConfig,
  Policy,
  PricingOverride,
  Principal,
  Project,
  ProjectMember,
  ProjectRole,
  Prompt,
  PromptVersion,
  ReviewItem,
  ReviewState,
  RiskAssessmentRecord,
  RoutingRule,
  Run,
  RunJudgment,
  User,
} from "./domain";

export interface UserRepository {
  countUsers(): Promise<number>;
  list(): Promise<User[]>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(user: User): Promise<void>;
  setAdmin(userId: string, isAdmin: number): Promise<void>;
  delete(userId: string): Promise<boolean>;
  markPasswordChange(userId: string): Promise<void>;
  changePassword(userId: string, hash: string, mustChange: number): Promise<void>;
}

export interface ProjectRepository {
  create(project: Project): Promise<void>;
  findById(id: string): Promise<Project | null>;
  findDefault(userId: string): Promise<Project | null>;
  listByUser(userId: string): Promise<Project[]>;
  listAccessible(userId: string): Promise<ProjectAccess[]>;
  /** Every project on the instance; admin views only. */
  listAll(): Promise<Project[]>;
  /** Member counts per project, for the admin project table. */
  memberCounts(): Promise<Array<{ projectId: string; count: number }>>;
  roleFor(userId: string, projectId: string): Promise<ProjectRole | null>;
  rename(id: string, name: string): Promise<void>;
  delete(id: string): Promise<boolean>;
  addMember(projectId: string, userId: string, role: ProjectRole): Promise<void>;
  updateMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<boolean>;
  listMembers(projectId: string): Promise<ProjectMember[]>;
  updateBudget(id: string, fields: Partial<Pick<Project, "budget_usd" | "hard_cap_usd">>): Promise<void>;
  updateCompression(
    id: string,
    fields: Partial<Pick<Project, "prompt_compression" | "compression_words">>,
  ): Promise<void>;
}

export interface ProjectAccess {
  project: Project;
  role: ProjectRole;
}

export interface ApiKeyRepository {
  create(key: ApiKey): Promise<void>;
  findByHash(hash: string): Promise<ApiKey | null>;
  getById(id: string): Promise<ApiKey | null>;
  touchUsage(id: string): Promise<void>;
  listByUser(userId: string): Promise<ApiKey[]>;
  revoke(id: string): Promise<void>;
  updateLimits(id: string, fields: Partial<Pick<ApiKey, "budget_usd" | "hard_cap_usd">>): Promise<void>;
}

export interface RunRepository {
  save(run: Run): Promise<void>;
  /** `ownerId` scopes the write to one user's run; omit it only for trusted internal updates. */
  update(id: string, fields: Partial<Run>, ownerId?: string): Promise<void>;
  getById(runId: string, userId: string): Promise<Run | null>;
  /** Owner of a run id across all users, so client-chosen ids can never land on another tenant's run. */
  ownerOf(runId: string): Promise<string | null>;
  getByShareToken(token: string): Promise<Run | null>;
  countRuns(userId: string): Promise<number>;
  countBySource(userId: string, source: string): Promise<number>;
  countGolden(userId: string): Promise<number>;
  deleteOld(userId: string, olderThanDays: number): Promise<number>;
  dashboardStats(userId: string, filters: DashboardFilters): Promise<DashboardStats>;
  list(userId: string, opts: ListOptions): Promise<{ runs: Run[]; total: number }>;
  listSummary(userId: string, opts: RunListFilters): Promise<RunListSummary>;
  deleteMany(userId: string, ids: string[]): Promise<number>;
  updateScoreMany(userId: string, ids: string[], score: number | null, note: string | null, scoredAt: string | null): Promise<number>;
  countChildren(userId: string, parentIds: string[]): Promise<RunChildCount[]>;
  listByShareToken(token: string, limit: number): Promise<Run[]>;
  listGroups(userId: string, kind: "trace" | "session", limit: number): Promise<TraceGroup[]>;
  /** Same aggregates as `listGroups`, with the runs-list filters and group paging. */
  listGroupsFiltered(
    userId: string,
    kind: "trace" | "session",
    filters: RunListFilters,
    limit: number,
    offset: number,
  ): Promise<{ groups: TraceGroup[]; total: number }>;
  /** All runs of the given groups that match the filters, oldest first per group. */
  listByGroupIds(
    userId: string,
    kind: "trace" | "session",
    groupIds: string[],
    filters: RunListFilters,
    limit: number,
  ): Promise<Run[]>;
  /** Earliest root run (no parent) per group, for the traces index columns. */
  listGroupRoots(userId: string, kind: "trace" | "session", groupIds: string[], projectId?: string): Promise<GroupRoot[]>;
  listGroup(userId: string, query: RunGroupQuery): Promise<{ runs: Run[]; total: number }>;
  listByParents(userId: string, parentIds: string[], limit: number): Promise<Run[]>;
  listObservedAgents(userId: string, limit: number, projectId?: string): Promise<ObservedAgent[]>;
  analyticsByModel(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]>;
  analyticsByEndUser(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]>;
  analyticsByAgent(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]>;
  analyticsByProject(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]>;
  /** Instance-wide month spend per project, across all users (admin views only). */
  spendByProjectSince(since: string): Promise<Array<{ projectId: string; spend: number; runs: number }>>;
  analyticsByTool(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]>;
  listGolden(userId: string, limit: number, projectId?: string): Promise<Run[]>;
  runsSince(userId: string, isoCutoff: string, limit: number, projectId?: string): Promise<Run[]>;
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

export interface AnalyticsFilter {
  days?: number;
  projectId?: string;
}

export interface AnalyticsRow {
  key: string;
  runs: number;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  errorCount: number;
  avgLatencyMs: number;
  avgScore: number | null;
}

export interface RunEventCount {
  runId: string;
  type: string;
  count: number;
}

export interface DashboardFilters {
  projectId?: string;
  from?: string;
  to?: string;
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
  /** Runs denied by the authorization engine (status 403). */
  denied: number;
  /** Runs held for human approval (status 202). */
  pending: number;
  errorCount: number;
  tools: McpToolRollup[];
}

export interface DashboardStats {
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
  previous: DashboardWindow | null;
  perDay: { date: string; cost: number; runs: number; tokens: number; errors: number; latencyMs: number }[];
  byModel: { model: string; runs: number; cost: number }[];
  bySource: { source: string; runs: number; cost: number }[];
  byAgent: AgentRollup[];
  mcp: McpRollup;
  latencyBuckets: { bucket: string; count: number }[];
  /** Month-to-date judge spend (run judging, online evals, insights), added by the API layer. */
  judgeCostUsd?: number;
}

export interface ListOptions {
  limit: number;
  offset: number;
  projectId?: string;
  source?: string;
  model?: string;
  provider?: string;
  status?: number | "error";
  from?: string;
  to?: string;
  tag?: string;
  isGolden?: boolean;
  sessionId?: string;
  traceId?: string;
  agentName?: string;
  endUserId?: string;
  score?: "good" | "bad" | "unscored";
  reviewState?: string;
  search?: string;
  /** When true, search also scans stored request bodies (edition-gated). */
  deepSearch?: boolean;
  anomalyOnly?: boolean;
  /** Sort field: created_at, cost, latency, tokens, score, status, name. */
  sort?: string;
  dir?: "asc" | "desc";
}

export type RunListFilters = Omit<ListOptions, "limit" | "offset">;

export interface RunListSummary {
  agents: number;
  subagents: number;
  sessions: number;
  traces: number;
}

export interface RunChildCount {
  parentRunId: string;
  count: number;
}

/** One tool-call event, trimmed for the flow graph markers. */
export interface RunToolEvent {
  runId: string;
  message: string;
  createdAt: string;
}

export interface EventRepository {
  add(event: Events): Promise<void>;
  addMany(events: Events[]): Promise<void>;
  listByRun(runId: string): Promise<Events[]>;
  listByRunIds(runIds: string[]): Promise<Events[]>;
  countByRunIds(runIds: string[]): Promise<RunEventCount[]>;
  /** Tool-call events for a page of runs, oldest first and capped by the caller. */
  listToolEvents(runIds: string[], limit: number): Promise<RunToolEvent[]>;
}

export interface InstanceRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
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

export interface PromptRepository {
  listByUser(userId: string): Promise<Prompt[]>;
  getById(id: string, userId: string): Promise<Prompt | null>;
  getByName(projectId: string, name: string): Promise<Prompt | null>;
  create(prompt: Prompt): Promise<void>;
  updateMeta(id: string, fields: Partial<Prompt>): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
  listVersions(promptId: string): Promise<PromptVersion[]>;
  getVersion(promptId: string, revision: number): Promise<PromptVersion | null>;
  addVersion(version: PromptVersion): Promise<void>;
  activateVersion(promptId: string, userId: string, revision: number): Promise<boolean>;
  stats(promptId: string, userId: string): Promise<PromptStats | null>;
}

export interface DatasetRepository {
  listByUser(userId: string): Promise<Dataset[]>;
  countByUser(userId: string): Promise<number>;
  getById(id: string, userId: string): Promise<Dataset | null>;
  create(dataset: Dataset): Promise<void>;
  updateMeta(id: string, fields: Partial<Dataset>): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
  countRows(datasetId: string): Promise<number>;
  listRows(datasetId: string): Promise<DatasetRow[]>;
  getRow(rowId: string, userId: string): Promise<DatasetRow | null>;
  addRow(row: DatasetRow): Promise<void>;
  addRows(rows: DatasetRow[]): Promise<void>;
  updateRow(rowId: string, userId: string, fields: Partial<DatasetRow>): Promise<boolean>;
  deleteRow(rowId: string, userId: string): Promise<boolean>;
}

export interface EvalRepository {
  create(evalRecord: Eval): Promise<void>;
  update(id: string, fields: Partial<Eval>): Promise<void>;
  getById(id: string, userId: string): Promise<Eval | null>;
  listByUser(userId: string, datasetId?: string): Promise<Eval[]>;
  findOnlineObserved(userId: string, datasetId: string): Promise<Eval | null>;
  findObservedByProject(userId: string, projectId: string): Promise<Eval | null>;
  addResult(result: EvalResult): Promise<void>;
  listResults(evalId: string): Promise<EvalResult[]>;
}

export interface JudgeRepository {
  getSettings(userId: string): Promise<JudgeSettings | null>;
  saveSettings(userId: string, fields: Partial<JudgeSettings>): Promise<void>;
  addJudgment(judgment: RunJudgment): Promise<void>;
  listJudgments(runId: string): Promise<RunJudgment[]>;
  sumCostSince(userId: string, sinceIso: string): Promise<number>;
}

export interface OnlineEvalRepository {
  getByProject(projectId: string): Promise<OnlineEvalConfig | null>;
  listByUser(userId: string): Promise<OnlineEvalConfig[]>;
  upsert(config: OnlineEvalConfig): Promise<void>;
  delete(projectId: string): Promise<void>;
}

export interface GuardrailRepository {
  insert(event: GuardrailEvent): Promise<void>;
  findActive(userId: string, sessionId: string, nowIso: string): Promise<GuardrailEvent | null>;
  clearForSession(userId: string, sessionId: string): Promise<void>;
  deleteExpired(userId: string, sessionId: string, nowIso: string): Promise<void>;
}

export interface PricingRepository {
  list(): Promise<PricingOverride[]>;
  upsert(model: string, input: number, output: number): Promise<void>;
  remove(model: string): Promise<boolean>;
}

export interface AlertRepository {
  getByUser(userId: string): Promise<AlertSettings>;
  update(userId: string, fields: Partial<AlertSettings>): Promise<void>;
  touchAlert(userId: string, level: number | null): Promise<void>;
  touchDigest(userId: string): Promise<void>;
  getAnomalyCooldown(userId: string, model: string): Promise<string | null>;
  touchAnomalyCooldown(userId: string, model: string): Promise<void>;
}

export interface AuditQuery {
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface AuditRepository {
  record(entry: AuditEntry): Promise<void>;
  recordMany(entries: AuditEntry[]): Promise<void>;
  list(userId: string, query: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }>;
  countBefore(userId: string, isoCutoff: string): Promise<number>;
}

export interface GovernanceRepository {
  getSettings(userId: string): Promise<GovernanceSettings>;
  updateSettings(userId: string, fields: Partial<GovernanceSettings>): Promise<void>;
  listPolicies(userId: string): Promise<Policy[]>;
  getPolicy(id: string, userId: string): Promise<Policy | null>;
  createPolicy(policy: Policy): Promise<void>;
  updatePolicy(id: string, fields: Partial<Policy>): Promise<void>;
  deletePolicy(id: string, userId: string): Promise<boolean>;
  listActivePolicies(userId: string, projectId: string, stage: Policy["stage"]): Promise<Policy[]>;
  notePolicyHit(id: string): Promise<void>;
  enqueueReview(item: ReviewItem): Promise<void>;
  listReviewQueue(userId: string, states: ReviewState[], limit: number): Promise<ReviewItem[]>;
  getReviewForRun(runId: string): Promise<ReviewItem | null>;
  decideReview(id: string, state: ReviewState, reviewerUserId: string, note: string | null): Promise<boolean>;
}

export interface RoutingRepository {
  listRules(userId: string): Promise<RoutingRule[]>;
  getRule(id: string, userId: string): Promise<RoutingRule | null>;
  createRule(rule: RoutingRule): Promise<void>;
  updateRule(id: string, fields: Partial<RoutingRule>): Promise<void>;
  deleteRule(id: string, userId: string): Promise<boolean>;
}

export interface ExportRepository {
  listByUser(userId: string): Promise<ExportConfig[]>;
  getById(id: string, userId: string): Promise<ExportConfig | null>;
  create(config: ExportConfig): Promise<void>;
  update(id: string, fields: Partial<ExportConfig>): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
  listEnabled(): Promise<ExportConfig[]>;
}

export interface TraceGroup {
  kind: "trace" | "session";
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
}

/** Earliest root run of a trace/session group; the body is capped at 4 KB in SQL. */
export interface GroupRoot {
  groupId: string;
  agentName: string | null;
  requestBody: string | null;
}

export interface RunGroupQuery {
  kind: "trace" | "session";
  id: string;
  limit: number;
  offset: number;
}

export interface AgentRepository {
  listByUser(userId: string): Promise<Agent[]>;
  countByUser(userId: string): Promise<number>;
  countActiveByUser(userId: string): Promise<number>;
  getById(id: string, userId: string): Promise<Agent | null>;
  getBySlug(userId: string, slug: string): Promise<Agent | null>;
  findByExternal(userId: string, provider: string, subject: string): Promise<Agent | null>;
  create(agent: Agent): Promise<void>;
  update(id: string, fields: Partial<Agent>): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
  createCredential(credential: AgentCredential): Promise<void>;
  findCredentialByHash(hash: string): Promise<AgentCredential | null>;
  getCredentialById(id: string): Promise<AgentCredential | null>;
  listCredentials(agentId: string, userId: string): Promise<AgentCredential[]>;
  touchCredential(id: string): Promise<void>;
  revokeCredential(id: string, userId: string): Promise<boolean>;
  listTools(agentId: string): Promise<AgentTool[]>;
  addTool(tool: AgentTool): Promise<void>;
  removeTool(id: string, agentId: string): Promise<boolean>;
}

export interface PrincipalRepository {
  listByUser(userId: string): Promise<Principal[]>;
  countByUser(userId: string): Promise<number>;
  getById(id: string, userId: string): Promise<Principal | null>;
  findByExternal(userId: string, provider: string, subject: string): Promise<Principal | null>;
  create(principal: Principal): Promise<void>;
  update(id: string, fields: Partial<Principal>): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
}

export interface DelegationRepository {
  listByUser(userId: string): Promise<Delegation[]>;
  countByUser(userId: string): Promise<number>;
  getById(id: string, userId: string): Promise<Delegation | null>;
  listByAgent(agentId: string, userId: string): Promise<Delegation[]>;
  listByPrincipal(principalId: string, userId: string): Promise<Delegation[]>;
  listActiveForAgent(agentId: string): Promise<Delegation[]>;
  listActiveForPrincipal(principalId: string): Promise<Delegation[]>;
  listChildren(parentId: string): Promise<Delegation[]>;
  create(delegation: Delegation): Promise<void>;
  update(id: string, fields: Partial<Delegation>): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
}

export interface AuthorizationPolicyRepository {
  listByUser(userId: string): Promise<AuthorizationPolicy[]>;
  countByUser(userId: string): Promise<number>;
  getById(id: string, userId: string): Promise<AuthorizationPolicy | null>;
  listActive(userId: string, projectId: string | null): Promise<AuthorizationPolicy[]>;
  create(policy: AuthorizationPolicy): Promise<void>;
  update(id: string, fields: Partial<AuthorizationPolicy>): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
  addVersion(version: AuthorizationPolicyVersion): Promise<void>;
  listVersions(policyId: string): Promise<AuthorizationPolicyVersion[]>;
  getVersion(policyId: string, version: number): Promise<AuthorizationPolicyVersion | null>;
}

export interface AuthorizationQuery {
  agentId?: string;
  decision?: DecisionKind;
  action?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface ApprovalQuery {
  state?: ApprovalState;
  agentId?: string;
  limit: number;
  offset: number;
}

/** A decision joined with everything an operator needs to audit it. */
export interface AuthorizationJoin {
  request: AuthorizationRequest;
  decision: AuthorizationDecisionRecord | null;
  risk: RiskAssessmentRecord | null;
  approval: Approval | null;
  principal: Principal | null;
  delegation: Delegation | null;
}

export interface AuthorizationRepository {
  getSettings(userId: string): Promise<AgentControlSettings>;
  updateSettings(userId: string, fields: Partial<AgentControlSettings>): Promise<void>;
  createRequest(request: AuthorizationRequest): Promise<void>;
  getRequest(id: string, userId: string): Promise<AuthorizationRequest | null>;
  updateRequest(id: string, fields: Partial<AuthorizationRequest>): Promise<void>;
  recordDecision(decision: AuthorizationDecisionRecord): Promise<void>;
  listDecisions(userId: string, query: AuthorizationQuery): Promise<{ decisions: AuthorizationDecisionRecord[]; total: number }>;
  getDecision(id: string, userId: string): Promise<AuthorizationDecisionRecord | null>;
  listByTrace(userId: string, traceId: string): Promise<AuthorizationJoin[]>;
  listByRuns(userId: string, runIds: string[]): Promise<AuthorizationJoin[]>;
  recordRisk(assessment: RiskAssessmentRecord): Promise<void>;
  createApproval(approval: Approval): Promise<void>;
  getApproval(id: string, userId: string): Promise<Approval | null>;
  getApprovalByRequest(requestId: string): Promise<Approval | null>;
  getApprovalByHash(userId: string, requestHash: string): Promise<Approval | null>;
  /** The approval an identical retry can use: pending or approved, unconsumed, unexpired. Approved wins. */
  findOpenApprovalByHash(userId: string, agentId: string, requestHash: string, nowIso: string): Promise<Approval | null>;
  listApprovals(userId: string, query: ApprovalQuery): Promise<{ approvals: Approval[]; total: number }>;
  updateApproval(id: string, fields: Partial<Approval>): Promise<void>;
  consumeApproval(id: string): Promise<boolean>;
  expireStaleApprovals(nowIso: string): Promise<number>;
  pendingApprovalRequestIds(): Promise<string[]>;
  deleteOld(userId: string, olderThanDays: number): Promise<number>;
}

export interface McpServerRepository {
  listByUser(userId: string): Promise<McpServer[]>;
  getById(id: string, userId: string): Promise<McpServer | null>;
  getBySlug(userId: string, slug: string): Promise<McpServer | null>;
  create(server: McpServer): Promise<void>;
  update(id: string, fields: Partial<McpServer>): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
  listTools(serverId: string): Promise<McpServerTool[]>;
  replaceTools(serverId: string, userId: string, tools: McpServerTool[]): Promise<void>;
  listPermissions(userId: string): Promise<AgentPermission[]>;
  createOAuthState(row: McpOAuthState): Promise<void>;
  consumeOAuthState(state: string): Promise<McpOAuthState | null>;
  deleteExpiredOAuthStates(nowIso: string): Promise<number>;
}

export interface GraphFilter {
  agentId?: string;
  action?: string;
  resource?: string;
  limit: number;
  offset?: number;
}

export interface GraphRepository {
  replaceForUser(userId: string, rows: AgentPermission[]): Promise<void>;
  list(userId: string, filter: GraphFilter): Promise<AgentPermission[]>;
  countByUser(userId: string): Promise<number>;
}