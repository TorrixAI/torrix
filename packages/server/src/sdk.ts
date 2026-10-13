/// <reference path="./assets/modules.d.ts" />
// Public surface for separately distributed Torrix editions. Extensions import
// from "@torrix/server" (this file) or "@torrix/server/testing", never from deep
// source paths, so the core can be refactored without breaking them.
export { startServer, type StartOptions } from "./server";
export { buildApp, type AppDeps, type BuildAppOptions } from "./app";
export { ExtensionHost } from "./core/extensionHost";
export {
  NO_ASSIST,
  type Assist,
  type ExtensionContext,
  type FeatureDescriptor,
  type LicenseGate,
  type McpToolContribution,
  type PeriodicTask,
  type ProxyHooks,
  type TorrixExtension,
  type TraceAnnotation,
  type TraceAnnotationInput,
  type UiSlotInput,
} from "./core/extensions";
export {
  EDITION_CONFIG,
  editionAtLeast,
  loadConfig,
  parseEdition,
  type Edition,
  type EditionConfig,
  type ServerConfig,
} from "./core/config";
export type { MigrationDirs, MigrationFiles } from "./db/migrate";
export type { DbClient } from "./db/client";
export { sqlAll, sqlGet, sqlRun } from "./db/sql";
export type { AuthorizationJoin, InstanceRepository } from "./core/ports";
export type { Repositories } from "./repos";
export type {
  Agent,
  AgentControlSettings,
  AgentCredential,
  AgentPermission,
  AgentStatus,
  Approval,
  AuditEntry,
  AuthResult,
  AuthorizationDecisionRecord,
  AuthorizationEffect,
  AuthorizationInput,
  AuthorizationOutcome,
  AuthorizationPolicy,
  AuthorizationPolicyVersion,
  AuthorizationProtocol,
  AuthorizationRequest,
  ConditionNode,
  ConditionOp,
  DecisionKind,
  Delegation,
  DelegationLimits,
  Eval,
  Events,
  ExportConfig,
  GuardrailAction,
  GuardrailEvent,
  IdentityProviderKind,
  JudgeSettings,
  McpServer,
  McpServerAuthType,
  McpServerTool,
  OnlineEvalConfig,
  OnlineEvalScorer,
  PiiType,
  Policy,
  PolicyAction,
  PolicyDecision,
  PolicyMatchKind,
  PolicySeverity,
  PolicyStage,
  PolicyVerdict,
  Principal,
  PrincipalKind,
  PrincipalStatus,
  ReviewItem,
  ReviewState,
  RiskAssessmentResult,
  RiskFactor,
  RiskLevel,
  RoutingDecision,
  RoutingMatchKind,
  RoutingRule,
  Run,
  RunData,
  RunJudgment,
} from "./core/domain";
export { clientIp, recordAudit, recordAuditSafe } from "./lib/audit";
export {
  authenticateKey,
  buildAuthCookie,
  extractBearer,
  generateApiKey,
  getUserLimit,
  hashKey,
  keyPrefix,
  readAuthCookie,
} from "./lib/auth";
export { monthStart, spendSince, evaluateRunCost } from "./lib/costGate";
export { scoreWithCascade, type EvalDeps } from "./lib/evalRunner";
export { emitEval, emitRun } from "./lib/events";
export { extractUserPrompt } from "./lib/extract";
export {
  dispatchEmailGateway,
  dispatchPagerDuty,
  dispatchWebhook,
  emailRecipients,
  hasNotificationChannel,
  notifyChannels,
  type NotifyDeps,
} from "./lib/notify";
export { scanAndMask } from "./lib/pii";
export { calculateCost, getCostComparison } from "./lib/pricing";
export { buildRunRow, makeEvent } from "./lib/runMapper";
export { recommendSavings } from "./lib/savings";
export { decryptSecret, encryptSecret, secretsEncrypted } from "./lib/secrets";
export { checkForUpdate } from "./lib/updateCheck";
export { agentTabs } from "./routes/agents";
export { lockedFeature, lockedFeatures, type LockedFeature } from "./core/lockedFeatures";
export { assertOutboundAllowed, guardedFetch, OutboundBlockedError, outboundPolicy, type OutboundPolicy } from "./lib/outbound";
export {
  GOVERNANCE_STYLE,
  backLink,
  emptyState,
  escapeHtml,
  fmtMs,
  fmtTokens,
  fmtUsd,
  lockedPanel,
  relTime,
  shell,
  shortDate,
  treeAgentChip,
  truncate,
} from "./routes/ui";
