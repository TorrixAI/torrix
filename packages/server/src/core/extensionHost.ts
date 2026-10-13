import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "../app";
import { coreMigrationSource } from "../db/dirs";
import type { MigrationSource } from "../db/migrate";
import type { RateRule } from "../lib/rateLimit";
import type { Edition, LicenseState } from "./editions";
import type { PolicyVerdict, Run } from "./domain";
import { NO_ASSIST } from "./extensions";
import type {
  Assist,
  ExtensionContext,
  UiSlot,
  UiSlotInput,
  FeatureDescriptor,
  LicenseGate,
  McpToolContribution,
  ProxyRequestInput,
  RequestInspection,
  ResponseInspectionInput,
  ReviewRequest,
  RouteDecision,
  TorrixExtension,
  TraceAnnotation,
  TraceAnnotationInput,
} from "./extensions";

interface FeatureRouteConfig {
  torrixFeature?: string;
}

function routeFeature(request: FastifyRequest): string | null {
  const config = request.routeOptions?.config as FeatureRouteConfig | undefined;
  return config?.torrixFeature ?? null;
}

function licenseRequired(feature: string | null, edition: Edition) {
  return { error: "license_required", feature, edition };
}

/** Composes the installed extensions; with none installed every call is a no-op. */
export type LockedRenderer = (info: { feature: string | null; edition: Edition }) => string;

export class ExtensionHost {
  private readonly featureIndex = new Map<string, FeatureDescriptor>();
  private lockedRenderer: LockedRenderer | null = null;
  private attached: AppDeps | null = null;

  constructor(
    readonly extensions: readonly TorrixExtension[],
    private readonly license: LicenseState,
  ) {
    const ids = new Set<string>();
    for (const ext of extensions) {
      if (!/^[a-z][a-z0-9-]*$/.test(ext.id) || ext.id === "core") {
        throw new Error(`invalid extension id: ${ext.id}`);
      }
      if (ids.has(ext.id)) {
        throw new Error(`duplicate extension id: ${ext.id}`);
      }
      ids.add(ext.id);
      for (const feature of ext.features) {
        if (this.featureIndex.has(feature.id)) {
          throw new Error(`duplicate feature id: ${feature.id}`);
        }
        this.featureIndex.set(feature.id, feature);
      }
    }
  }

  /** Binds the app dependencies so core call sites can use hooks without threading deps. */
  attach(deps: AppDeps): void {
    this.attached = deps;
  }

  private attachedDeps(): AppDeps {
    if (!this.attached) {
      throw new Error("extension host used before buildApp attached it");
    }
    return this.attached;
  }

  /** Lets the console render an upgrade card instead of JSON for locked /ui pages. */
  setLockedRenderer(renderer: LockedRenderer): void {
    this.lockedRenderer = renderer;
  }

  private sendLocked(request: FastifyRequest, reply: FastifyReply, feature: string | null, edition: Edition) {
    const renderer = this.lockedRenderer;
    if (renderer && request.method === "GET" && request.url.startsWith("/ui/")) {
      return reply.code(402).type("text/html").send(renderer({ feature, edition }));
    }
    return reply.code(402).send(licenseRequired(feature, edition));
  }

  features(): FeatureDescriptor[] {
    return [...this.featureIndex.values()];
  }

  installed(featureId: string): boolean {
    return this.featureIndex.has(featureId);
  }

  featureAllowed(featureId: string): boolean {
    const feature = this.featureIndex.get(featureId);
    return feature !== undefined && this.license.allows(feature.minEdition);
  }

  migrationSources(): MigrationSource[] {
    return [
      coreMigrationSource(),
      ...this.extensions.flatMap((ext) =>
        ext.migrations
          ? [
              {
                id: ext.id,
                dirs: { sqlite: ext.migrations.sqlite, postgres: ext.migrations.postgres },
                files: ext.migrations.files,
              },
            ]
          : [],
      ),
    ];
  }

  rateLimits(): RateRule[] {
    return this.extensions.flatMap((ext) => [...(ext.rateLimits ?? [])]);
  }

  demoWritablePaths(): string[] {
    return this.extensions.flatMap((ext) => [...(ext.demoWritablePaths ?? [])]);
  }

  context(deps: AppDeps): ExtensionContext {
    const requireFeature = (featureId: string): LicenseGate => {
      const feature = this.featureIndex.get(featureId);
      if (!feature) {
        throw new Error(`unknown feature: ${featureId}`);
      }
      return async (request, reply) => {
        if (!this.license.allows(feature.minEdition)) {
          return this.sendLocked(request, reply, feature.id, feature.minEdition);
        }
      };
    };
    return {
      deps,
      featureAllowed: (featureId) => this.featureAllowed(featureId),
      requireFeature,
      featureScope: async (app, featureId, register) => {
        const gate = requireFeature(featureId);
        await app.register(async (scope) => {
          scope.addHook("onRoute", (route) => {
            route.config = { ...(route.config as object | undefined), torrixFeature: featureId } as typeof route.config;
          });
          scope.addHook("onRequest", gate);
          await register(scope);
        });
      },
    };
  }

  /**
   * Each extension registers into its own child scope (content parsers and
   * core hooks are inherited) behind a license gate, so a downgrade or expiry
   * turns its routes off without a restart.
   */
  async registerRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
    const ctx = this.context(deps);
    for (const ext of this.extensions) {
      const register = ext.register;
      if (!register) {
        continue;
      }
      await app.register(async (scope) => {
        scope.addHook("onRequest", async (request, reply) => {
          const featureId = routeFeature(request);
          const feature = featureId ? this.featureIndex.get(featureId) : undefined;
          const minimum = feature?.minEdition ?? ext.minEdition;
          if (!this.license.allows(minimum)) {
            return this.sendLocked(request, reply, feature?.id ?? null, minimum);
          }
        });
        await register(scope, ctx);
      });
    }
  }

  /** MCP tools contributed by licensed extensions; empty without extensions. */
  mcpTools(): McpToolContribution[] {
    if (!this.extensions.some((ext) => ext.mcpTools)) {
      return [];
    }
    const ctx = this.context(this.attachedDeps());
    return this.extensions
      .filter((ext) => ext.mcpTools && this.license.allows(ext.minEdition))
      .flatMap((ext) => [...ext.mcpTools!(ctx)])
      .filter((tool) => this.featureAllowed(tool.feature));
  }

  async metricsLines(userId: string): Promise<string[]> {
    if (!this.extensions.some((ext) => ext.metrics)) {
      return [];
    }
    const ctx = this.context(this.attachedDeps());
    const lines: string[] = [];
    for (const ext of this.extensions) {
      if (ext.metrics && this.license.allows(ext.minEdition)) {
        try {
          lines.push(...(await ext.metrics(ctx, userId)));
        } catch (err) {
          console.error(`${ext.id}: metrics failed`, err);
        }
      }
    }
    return lines;
  }

  private active(): TorrixExtension[] {
    return this.extensions.filter((ext) => this.license.allows(ext.minEdition));
  }

  /** Typed events licensed extensions attach to a trace (e.g. authorization decisions). */
  async traceAnnotations(input: TraceAnnotationInput): Promise<TraceAnnotation[]> {
    const out: TraceAnnotation[] = [];
    for (const ext of this.active()) {
      if (!ext.traceAnnotations) {
        continue;
      }
      try {
        out.push(...(await ext.traceAnnotations(this.context(this.attachedDeps()), input)));
      } catch (err) {
        console.error(`${ext.id}: trace annotations failed`, err);
      }
    }
    return out;
  }

  async admitProxy(input: { userId: string; sessionId: string | null }): Promise<{ status: number; body: Record<string, unknown> } | null> {
    for (const ext of this.active()) {
      const refusal = await ext.proxy?.admit?.(this.context(this.attachedDeps()), input);
      if (refusal) {
        return refusal;
      }
    }
    return null;
  }

  async inspectRequest(input: ProxyRequestInput): Promise<RequestInspection> {
    const flags: PolicyVerdict[] = [];
    for (const ext of this.active()) {
      const result = await ext.proxy?.inspectRequest?.(this.context(this.attachedDeps()), input);
      if (result?.block) {
        return { block: result.block, flags: [...flags, ...result.flags] };
      }
      flags.push(...(result?.flags ?? []));
    }
    return { flags };
  }

  async routeRequest(input: ProxyRequestInput): Promise<RouteDecision | null> {
    for (const ext of this.active()) {
      const decision = await ext.proxy?.route?.(this.context(this.attachedDeps()), input);
      if (decision) {
        return decision;
      }
    }
    return null;
  }

  async inspectResponse(input: ResponseInspectionInput): Promise<PolicyVerdict[]> {
    const flags: PolicyVerdict[] = [];
    for (const ext of this.active()) {
      flags.push(...((await ext.proxy?.inspectResponse?.(this.context(this.attachedDeps()), input)) ?? []));
    }
    return flags;
  }

  async queueReview(input: ReviewRequest): Promise<boolean> {
    let queued = false;
    for (const ext of this.active()) {
      if (await ext.proxy?.queueReview?.(this.context(this.attachedDeps()), input)) {
        queued = true;
      }
    }
    return queued;
  }

  runRecorded(run: Run): void {
    for (const ext of this.active()) {
      if (ext.runRecorded) {
        try {
          ext.runRecorded(this.context(this.attachedDeps()), run);
        } catch (err) {
          console.error(`${ext.id}: runRecorded failed`, err);
        }
      }
    }
  }

  /** Merged assist capabilities of licensed extensions, with no-op fallbacks. */
  assist(): Assist {
    const merged: Assist = { ...NO_ASSIST };
    if (!this.attached) {
      return merged;
    }
    const ctx = this.context(this.attached);
    for (const ext of [...this.active()].reverse()) {
      Object.assign(merged, ext.assist?.(ctx) ?? {});
    }
    return merged;
  }

  /** Concatenated output of every licensed extension for a page slot; "" when none renders. */
  async renderSlot(slot: UiSlot, input: UiSlotInput): Promise<string> {
    const parts: string[] = [];
    for (const ext of this.active()) {
      const render = ext.ui?.[slot];
      if (render) {
        parts.push(await render(this.context(this.attachedDeps()), input));
      }
    }
    return parts.join("");
  }

  async loginProviders(): Promise<Array<{ label: string; href: string }>> {
    const providers: Array<{ label: string; href: string }> = [];
    for (const ext of this.active()) {
      providers.push(...((await ext.loginProviders?.(this.context(this.attachedDeps()))) ?? []));
    }
    return providers;
  }

  async runScored(input: { userId: string; run: Run; score: number; ip: string | null }): Promise<void> {
    for (const ext of this.active()) {
      await ext.runScored?.(this.context(this.attachedDeps()), input);
    }
  }

  startPeriodic(deps: AppDeps): () => void {
    const ctx = this.context(deps);
    const timers: Array<ReturnType<typeof setInterval>> = [];
    for (const ext of this.extensions) {
      for (const task of ext.periodic ?? []) {
        const tick = async () => {
          if (!this.license.allows(ext.minEdition) || (task.feature && !this.featureAllowed(task.feature))) {
            return;
          }
          try {
            await task.run(ctx);
          } catch (err) {
            console.error(`${ext.id}: periodic task ${task.name} failed`, err);
          }
        };
        if (task.initialDelayMs !== undefined) {
          timers.push(setTimeout(tick, task.initialDelayMs));
        }
        timers.push(setInterval(tick, task.intervalMs));
      }
    }
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
        clearInterval(timer);
      }
    };
  }
}
