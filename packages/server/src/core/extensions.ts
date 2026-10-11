import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "../app";
import type { MigrationDirs } from "../db/migrate";
import type { RateRule } from "../lib/rateLimit";
import type { PolicyVerdict, Run, SlmOpportunity } from "./domain";
import type { Edition } from "./editions";

/** One licensable capability contributed by an extension. */
export interface FeatureDescriptor {
  id: string;
  label: string;
  minEdition: Edition;
}

export type LicenseGate = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export interface ExtensionContext {
  deps: AppDeps;
  featureAllowed(featureId: string): boolean;
  /** Route-level gate: 402 `license_required` unless the feature is licensed right now. */
  requireFeature(featureId: string): LicenseGate;
  /**
   * Registers routes in a child scope gated by `featureId`. Its routes are
   * tagged with the feature, so an unlicensed request gets that feature's
   * upgrade card rather than a generic one.
   */
  featureScope(app: FastifyInstance, featureId: string, register: (scope: FastifyInstance) => Promise<void>): Promise<void>;
}

export interface PeriodicTask {
  name: string;
  intervalMs: number;
  initialDelayMs?: number;
  /** Skipped (not unscheduled) while this feature is unlicensed, so upgrades apply live. */
  feature?: string;
  run(ctx: ExtensionContext): Promise<void>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolContext {
  userId: string;
  /** Clamped result size the core MCP server applies to every tool (1-100). */
  limit: number;
}

export interface McpToolContribution {
  /** Tool is listed and callable only while this feature is licensed. */
  feature: string;
  definition: McpToolDefinition;
  handler(ctx: McpToolContext, args: Record<string, unknown>): Promise<unknown>;
}

export interface ProxyRequestInput {
  userId: string;
  projectId: string;
  sessionId: string | null;
  provider: string;
  model: string | null;
  maxTokens: number | null;
  bodyText: string | undefined;
  body: Record<string, unknown> | null;
  promptText: string | null;
}

export interface RequestInspection {
  block?: { reason: string };
  flags: PolicyVerdict[];
}

export interface RouteDecision {
  model: string;
  ruleName: string;
  fallbackModel: string | null;
  targetUrl: string | null;
}

export interface ResponseInspectionInput {
  userId: string;
  projectId: string;
  model: string | null;
  responseText: string | null;
}

export interface ReviewRequest {
  runId: string;
  userId: string;
  projectId: string;
  note: string;
}

/**
 * Proxy pipeline stages an extension can join. Core keeps the order: admit,
 * inspect request, route, dispatch (with core-owned fallback retry), inspect
 * response, then queue review for anything flagged or blocked.
 */
export interface ProxyHooks {
  /** Refuse a request before any work, e.g. a guardrail breach for the session. */
  admit?(ctx: ExtensionContext, input: { userId: string; sessionId: string | null }): Promise<{ status: number; body: Record<string, unknown> } | null>;
  inspectRequest?(ctx: ExtensionContext, input: ProxyRequestInput): Promise<RequestInspection>;
  route?(ctx: ExtensionContext, input: ProxyRequestInput): Promise<RouteDecision | null>;
  inspectResponse?(ctx: ExtensionContext, input: ResponseInspectionInput): Promise<PolicyVerdict[]>;
  /** Returns true when the run was queued for human review. */
  queueReview?(ctx: ExtensionContext, input: ReviewRequest): Promise<boolean>;
}

export interface AssistCompletion {
  text: string;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  error: string | null;
}

export interface AssistVerdict {
  score: number | null;
  rationale: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  error: string | null;
}

export interface IntentCluster {
  key: string;
  runs: Run[];
}

/**
 * Model-assisted analysis core features can use when an edition provides it.
 * Every method has a plain fallback (null or empty), so callers degrade to
 * rule-based output instead of failing.
 */
export interface Assist {
  /** Free-form text from the configured judge LLM; null when unavailable or unconfigured. */
  complete(userId: string, request: { system: string; user: string; maxTokens?: number }): Promise<AssistCompletion | null>;
  /** Graded 0..1 verdict from the judge LLM; null when unavailable or unconfigured. */
  judgeVerdict(userId: string, request: { input: string; output: string; expected: string | null }): Promise<AssistVerdict | null>;
  slmOpportunities(userId: string): Promise<SlmOpportunity[]>;
  clusterRunsByIntent(runs: Run[]): Promise<IntentCluster[]>;
  /** Judges one stored run; false when no judge is configured, so batch callers can stop early. */
  judgeRun(userId: string, run: Run, options: { apply: boolean }): Promise<boolean>;
}

export const NO_ASSIST: Assist = {
  complete: async () => null,
  judgeVerdict: async () => null,
  slmOpportunities: async () => [],
  clusterRunsByIntent: async () => [],
  judgeRun: async () => false,
};

/** Places in core console pages where an edition can render its own panels. */
export type UiSlot = "governance.panels" | "datasets.judge" | "run.judge" | "project.onlineEval" | "projects.script";

export interface UiSlotInput {
  userId: string;
  runId?: string;
  projectId?: string;
  canEdit?: boolean;
  datasets?: Array<{ id: string; name: string | null }>;
}

export type UiSlotRenderer = (ctx: ExtensionContext, input: UiSlotInput) => Promise<string>;

/**
 * The seam between the public core and separately distributed editions. Core
 * never imports an extension; a distribution entrypoint passes extensions to
 * `startServer`, and every contribution is gated by the live license.
 */
export interface TorrixExtension {
  id: string;
  version: string;
  /** Lowest edition that unlocks any of this extension's routes. */
  minEdition: Edition;
  features: readonly FeatureDescriptor[];
  migrations?: MigrationDirs;
  rateLimits?: readonly RateRule[];
  demoWritablePaths?: readonly string[];
  register?(app: FastifyInstance, ctx: ExtensionContext): Promise<void>;
  periodic?: readonly PeriodicTask[];
  mcpTools?(ctx: ExtensionContext): readonly McpToolContribution[];
  /** Extra Prometheus exposition lines for one user, appended to `/metrics`. */
  metrics?(ctx: ExtensionContext, userId: string): Promise<string[]>;
  proxy?: ProxyHooks;
  /** Called after any ingestion path stores a run (proxy, SDK ingest, MCP proxy, replay). Fire-and-forget. */
  runRecorded?(ctx: ExtensionContext, run: Run): void;
  assist?(ctx: ExtensionContext): Partial<Assist>;
  /** Console panels for core page slots; an empty result lets core show its upgrade teaser. */
  ui?: Partial<Record<UiSlot, UiSlotRenderer>>;
  /** Extra sign-in options for the login page, e.g. single sign-on. */
  loginProviders?(ctx: ExtensionContext): Promise<Array<{ label: string; href: string }>>;
  /** Called after a person scores a run (1 good, 0 bad). */
  runScored?(ctx: ExtensionContext, input: { userId: string; run: Run; score: number; ip: string | null }): Promise<void>;
}
