import type { DbClient } from "../db/client";
import type {
  AgentRepository,
  AlertRepository,
  ApiKeyRepository,
  AuditRepository,
  AuthorizationPolicyRepository,
  AuthorizationRepository,
  DatasetRepository,
  DelegationRepository,
  EvalRepository,
  EventRepository,
  ExportRepository,
  GovernanceRepository,
  GraphRepository,
  GuardrailRepository,
  InstanceRepository,
  JudgeRepository,
  McpServerRepository,
  OnlineEvalRepository,
  PricingRepository,
  PrincipalRepository,
  ProjectRepository,
  PromptRepository,
  RoutingRepository,
  RunRepository,
  UserRepository,
} from "../core/ports";

export interface Repositories {
  db: DbClient;
  users: UserRepository;
  projects: ProjectRepository;
  apiKeys: ApiKeyRepository;
  runs: RunRepository;
  events: EventRepository;
  instance: InstanceRepository;
  prompts: PromptRepository;
  datasets: DatasetRepository;
  evals: EvalRepository;
  judge: JudgeRepository;
  onlineEvals: OnlineEvalRepository;
  guardrails: GuardrailRepository;
  prices: PricingRepository;
  alerts: AlertRepository;
  audit: AuditRepository;
  governance: GovernanceRepository;
  routing: RoutingRepository;
  exports: ExportRepository;
  agents: AgentRepository;
  principals: PrincipalRepository;
  delegations: DelegationRepository;
  authzPolicies: AuthorizationPolicyRepository;
  authorization: AuthorizationRepository;
  mcpServers: McpServerRepository;
  graph: GraphRepository;
}

import { createUserRepository } from "./users";
import { createProjectRepository } from "./projects";
import { createApiKeyRepository } from "./apiKeys";
import { createRunRepository } from "./runs";
import { createEventRepository } from "./events";
import { createInstanceRepository } from "./instance";
import { createPromptRepository } from "./prompts";
import { createDatasetRepository } from "./datasets";
import { createEvalRepository } from "./evals";
import { createJudgeRepository } from "./judge";
import { createOnlineEvalRepository } from "./onlineEvals";
import { createGuardrailRepository } from "./guardrails";
import { createPricingRepository } from "./pricing";
import { createAlertRepository } from "./alerts";
import { createAuditRepository, createGovernanceRepository } from "./governance";
import { createRoutingRepository } from "./routing";
import { createExportRepository } from "./exports";
import { createAgentRepository } from "./agents";
import { createPrincipalRepository } from "./principals";
import { createDelegationRepository } from "./delegations";
import { createAuthorizationPolicyRepository } from "./authzPolicies";
import { createAuthorizationRepository } from "./authorization";
import { createMcpServerRepository } from "./mcpServers";
import { createGraphRepository } from "./graph";

export function createRepositories(db: DbClient): Repositories {
  return {
    db,
    users: createUserRepository(db),
    projects: createProjectRepository(db),
    apiKeys: createApiKeyRepository(db),
    runs: createRunRepository(db),
    events: createEventRepository(db),
    instance: createInstanceRepository(db),
    prompts: createPromptRepository(db),
    datasets: createDatasetRepository(db),
    evals: createEvalRepository(db),
    judge: createJudgeRepository(db),
    onlineEvals: createOnlineEvalRepository(db),
    guardrails: createGuardrailRepository(db),
    prices: createPricingRepository(db),
    alerts: createAlertRepository(db),
    audit: createAuditRepository(db),
    governance: createGovernanceRepository(db),
    routing: createRoutingRepository(db),
    exports: createExportRepository(db),
    agents: createAgentRepository(db),
    principals: createPrincipalRepository(db),
    delegations: createDelegationRepository(db),
    authzPolicies: createAuthorizationPolicyRepository(db),
    authorization: createAuthorizationRepository(db),
    mcpServers: createMcpServerRepository(db),
    graph: createGraphRepository(db),
  };
}