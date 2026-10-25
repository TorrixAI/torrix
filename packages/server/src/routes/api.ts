import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import bcrypt from "bcryptjs";
import type { ServerConfig } from "../core/config";
import { grantFromLicense, refreshLicenseRevocations, verifyLicense } from "../lib/license";
import type { Repositories } from "../repos";
import { extractBearer, authenticateKey, generateApiKey, hashKey, keyPrefix, readAuthCookie } from "../lib/auth";
import { runEmitter, evalEmitter, emitRun, serializeSse, acquireSseSlot, releaseSseSlot } from "../lib/events";
import { describeActive, isPostgresUrl, persistChoice, swapDatabase } from "../db/manager";
import type { ExtensionHost } from "../core/extensionHost";
import { sqlRun } from "../db/sql";
import { PROMPT_NAME_RE, extractVariables, mergeVariables } from "../lib/prompts";
import { retainEvalKey, runEvaluation } from "../lib/evalRunner";
import { monthStart, runWeeklyDigest, spendSince, dispatchWebhook } from "../lib/costGate";
import { resolveProjectScope } from "./ui";
import { calculateCost, detectProvider, getCostComparison, removePricingOverride, setPricingOverride } from "../lib/pricing";
import { recordAudit, clientIp } from "../lib/audit";
import { encryptSecret } from "../lib/secrets";
import { extractAnthropic, extractGemini, extractGeneric, extractOpenAI } from "../lib/extract";
import { validateTargetUrl } from "../lib/validate";
import { buildRunRow, makeEvent } from "../lib/runMapper";
import { QueryError, runReadOnlyQuery } from "../lib/sqlConsole";
import { cachingInsights, generateTraceInsights, getInsights, loadCachedTraceInsights, slmSavingsInsights } from "../lib/insights";
import { savingsReport } from "../lib/savings";
import { updateCommand } from "../lib/updateCheck";
import type { ListOptions } from "../core/ports";
import type { AuthResult, ApiKey, Prompt, PromptVersion, Dataset, DatasetRow, Eval, EvalScorer, AlertSettings, CostUsageRow, Run, ExportConfig, User, JudgeSettings, OnlineEvalConfig, OnlineEvalScorer, Events } from "../core/domain";

export interface ApiDeps {
  repos: Repositories;
  config: ServerConfig;
  host: ExtensionHost;
  env?: NodeJS.ProcessEnv;
}

export async function apiRoute(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { repos, config } = deps;

  const authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (
    request,
    reply,
  ) => {
    const headerKey = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    let auth = headerKey ? await authenticateKey(repos.db, headerKey) : null;
    if (!auth) {
      const cookieKey = readAuthCookie(request.headers);
      auth = cookieKey ? await authenticateKey(repos.db, cookieKey) : null;
    }
    if (!auth) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    (request as unknown as { auth: AuthResult }).auth = auth;
  };

  app.get("/health", async () => ({ ok: true, name: "Torrix", version: config.version }));

  app.get("/api/config", { preHandler: authenticate }, async (request) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const currentRuns = await repos.runs.countRuns(authUser.user.id);
    const updateAvailable = await repos.instance.get("update_available");
    return {
      edition: config.edition,
      maxRuns: config.editionConfig.maxRuns,
      retentionDays: config.editionConfig.retentionDays,
      maxGoldenRuns: config.editionConfig.maxGoldenRuns,
      maxPlaygroundRuns: config.editionConfig.maxPlaygroundRuns,
      maxDatasets: config.editionConfig.maxDatasets,
      currentRuns,
      update_available: config.updateRepo && updateAvailable && updateAvailable !== config.version ? updateAvailable : null,
      update_command: updateCommand(config.docker),
    };
  });

  app.get("/api/whoami", { preHandler: authenticate }, async (request) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    return { id: authUser.user.id, email: authUser.user.email, is_admin: authUser.user.is_admin === 1 };
  });

  app.get("/api/playground/meta", { preHandler: authenticate }, async () => ({
    providers: [
      { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", endpoint: "/chat/completions", format: "openai", auth: "bearer", models: ["gpt-5", "gpt-4o", "gpt-4o-mini", "o4-mini"] },
      { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", endpoint: "/messages", format: "anthropic", auth: "x-api-key", models: ["claude-opus-4", "claude-sonnet-4", "claude-sonnet-4-5", "claude-haiku-3-5-20241022"] },
      { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", endpoint: "/models/{model}:generateContent", format: "gemini", auth: "x-goog-api-key", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
      { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", endpoint: "/chat/completions", format: "openai", auth: "bearer", models: ["deepseek-chat", "deepseek-reasoner"] },
      { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", endpoint: "/chat/completions", format: "openai", auth: "bearer", models: ["llama-3.3-70b-versatile"] },
      { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", endpoint: "/chat/completions", format: "openai", auth: "bearer", models: [] },
      { id: "custom", label: "Custom (OpenAI-compatible)", baseUrl: "", endpoint: "/v1/chat/completions", format: "openai", auth: "bearer", models: [] },
    ],
  }));

  const requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (
    request,
    reply,
  ) => {
    await authenticate(request, reply);
    if (reply.sent) {
      return;
    }
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    if (authUser.user.is_admin !== 1) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };

  const resolvePromptProject: (request: FastifyRequest) => Promise<string> = async (request) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const project = await repos.projects.findDefault(authUser.user.id);
    return project?.id ?? "";
  };

  const listEvalsWithDataset = async (repo: Repositories, userId: string, datasetId?: string) => {
    const evals = await repo.evals.listByUser(userId, datasetId);
    const decorated = [];
    for (const evalRecord of evals) {
      const dataset = evalRecord.dataset_id ? await repo.datasets.getById(evalRecord.dataset_id, userId) : null;
      decorated.push({ ...evalRecord, dataset_name: dataset?.name ?? null });
    }
    return decorated;
  };

  app.get("/api/prompts", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const prompts = await repos.prompts.listByUser(authUser.user.id);
    return reply.send({ prompts });
  });

  app.post("/api/prompts", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as {
      name?: string;
      description?: string;
      tags?: Record<string, string>;
      template?: string;
      variables?: string[];
      model?: string;
      note?: string;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const template = typeof body.template === "string" ? body.template.trim() : "";
    if (!PROMPT_NAME_RE.test(name)) {
      return reply.code(400).send({ error: "invalid_prompt_name" });
    }
    if (!template) {
      return reply.code(400).send({ error: "template_required" });
    }
    const projectId = await resolvePromptProject(request);
    if (!projectId) {
      return reply.code(400).send({ error: "no_project" });
    }
    if (await repos.prompts.getByName(projectId, name)) {
      return reply.code(409).send({ error: "prompt_exists", detail: name });
    }
    const now = new Date().toISOString();
    const promptId = crypto.randomUUID();
    const prompt: Prompt = {
      id: promptId,
      project_id: projectId,
      user_id: authUser.user.id,
      name,
      description: typeof body.description === "string" ? body.description : null,
      tags: body.tags && typeof body.tags === "object" ? JSON.stringify(body.tags) : null,
      latest_revision: 1,
      active_revision: 1,
      created_at: now,
      updated_at: now,
    };
    const version: PromptVersion = {
      id: crypto.randomUUID(),
      prompt_id: promptId,
      revision: 1,
      template,
      variables: JSON.stringify(mergeVariables(Array.isArray(body.variables) ? body.variables : [], template)),
      model: typeof body.model === "string" ? body.model : null,
      note: typeof body.note === "string" ? body.note : null,
      author_user_id: authUser.user.id,
      created_at: now,
    };
    await repos.prompts.create(prompt);
    await repos.prompts.addVersion(version);
    return reply.code(201).send({ prompt, version });
  });

  app.get("/api/prompts/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const prompt = await repos.prompts.getById(id, authUser.user.id);
    if (!prompt) {
      return reply.code(404).send({ error: "prompt_not_found" });
    }
    const versions = await repos.prompts.listVersions(id);
    return reply.send({ prompt, versions });
  });

  app.get("/api/prompts/:id/active", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const prompt = await repos.prompts.getById(id, authUser.user.id);
    if (!prompt) {
      return reply.code(404).send({ error: "prompt_not_found" });
    }
    const revision = prompt.active_revision ?? prompt.latest_revision;
    const version = await repos.prompts.getVersion(id, revision);
    return reply.send({ prompt, revision, version });
  });

  app.put("/api/prompts/:id/versions/:revision/activate", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id, revision } = request.params as { id: string; revision: string };
    const parsed = Number(revision);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return reply.code(400).send({ error: "invalid_revision" });
    }
    const prompt = await repos.prompts.getById(id, authUser.user.id);
    if (!prompt) {
      return reply.code(404).send({ error: "prompt_not_found" });
    }
    const activated = await repos.prompts.activateVersion(id, authUser.user.id, Math.floor(parsed));
    if (!activated) {
      return reply.code(404).send({ error: "revision_not_found" });
    }
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "prompt.version.activate",
      targetType: "prompt",
      targetId: id,
      detail: { revision: Math.floor(parsed) },
      ip: clientIp(request),
    });
    const updated = await repos.prompts.getById(id, authUser.user.id);
    return reply.send({ prompt: updated });
  });

  app.post("/api/prompts/:id/versions", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const prompt = await repos.prompts.getById(id, authUser.user.id);
    if (!prompt) {
      return reply.code(404).send({ error: "prompt_not_found" });
    }
    const body = (request.body ?? {}) as { template?: string; variables?: string[]; model?: string; note?: string };
    const template = typeof body.template === "string" ? body.template.trim() : "";
    if (!template) {
      return reply.code(400).send({ error: "template_required" });
    }
    const revision = prompt.latest_revision + 1;
    const version: PromptVersion = {
      id: crypto.randomUUID(),
      prompt_id: id,
      revision,
      template,
      variables: JSON.stringify(mergeVariables(Array.isArray(body.variables) ? body.variables : [], template)),
      model: typeof body.model === "string" ? body.model : null,
      note: typeof body.note === "string" ? body.note : null,
      author_user_id: authUser.user.id,
      created_at: new Date().toISOString(),
    };
    await repos.prompts.addVersion(version);
    await repos.prompts.updateMeta(id, { latest_revision: revision, updated_at: version.created_at });
    return reply.code(201).send({ prompt: { ...prompt, latest_revision: revision }, version });
  });

  app.patch("/api/prompts/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const prompt = await repos.prompts.getById(id, authUser.user.id);
    if (!prompt) {
      return reply.code(404).send({ error: "prompt_not_found" });
    }
    const body = (request.body ?? {}) as { name?: string; description?: string; tags?: Record<string, string> };
    const fields: Partial<Prompt> & { updated_at: string } = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!PROMPT_NAME_RE.test(name)) {
        return reply.code(400).send({ error: "invalid_prompt_name" });
      }
      const dup = await repos.prompts.getByName(prompt.project_id, name);
      if (dup && dup.id !== id) {
        return reply.code(409).send({ error: "prompt_exists", detail: name });
      }
      fields.name = name;
    }
    if (typeof body.description === "string") {
      fields.description = body.description;
    }
    if (body.tags && typeof body.tags === "object") {
      fields.tags = JSON.stringify(body.tags);
    }
    await repos.prompts.updateMeta(id, fields);
    const updated = (await repos.prompts.getById(id, authUser.user.id)) ?? prompt;
    return reply.send({ prompt: updated });
  });

  app.delete("/api/prompts/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const deleted = await repos.prompts.delete(id, authUser.user.id);
    if (!deleted) {
      return reply.code(404).send({ error: "prompt_not_found" });
    }
    return reply.send({ ok: true });
  });

  app.get("/api/prompts/:id/stats", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const stats = await repos.prompts.stats(id, authUser.user.id);
    if (!stats) {
      return reply.code(404).send({ error: "prompt_not_found" });
    }
    return reply.send({ stats });
  });

  const publicKey = (key: ApiKey): Record<string, unknown> => ({
    id: key.id,
    name: key.name,
    key_prefix: key.key_prefix,
    scope: key.scope,
    projects: key.projects ? (JSON.parse(key.projects) as string[]) : [],
    permission: key.permission,
    created_at: key.created_at,
    last_used_at: key.last_used_at,
    budget_usd: key.budget_usd ?? null,
    hard_cap_usd: key.hard_cap_usd ?? null,
  });

  app.get("/api/keys", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const keys = await repos.apiKeys.listByUser(authUser.user.id);
    return reply.send({ keys: keys.map(publicKey), active_key_id: authUser.keyRecord?.id ?? null });
  });

  app.post("/api/keys", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as { name?: string; permission?: string; scope?: string; projects?: string[] };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) {
      return reply.code(400).send({ error: "invalid_name" });
    }
    const permission = body.permission === "read_only" ? "read_only" : "read_write";
    const scope = body.scope === "projects" ? "projects" : "full";
    let projects: string | null = null;
    if (scope === "projects") {
      const list = Array.isArray(body.projects)
        ? body.projects.filter((p): p is string => typeof p === "string" && p.trim() !== "").slice(0, 50)
        : [];
      if (!list.length) {
        return reply.code(400).send({ error: "projects_required" });
      }
      projects = JSON.stringify(list);
    }
    const plain = generateApiKey();
    const record: ApiKey = {
      id: crypto.randomUUID(),
      user_id: authUser.user.id,
      name,
      key_hash: hashKey(plain),
      key_prefix: keyPrefix(plain),
      scope,
      projects,
      permission,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      budget_usd: null,
      hard_cap_usd: null,
    };
    await repos.apiKeys.create(record);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "api_key.create",
      targetType: "api_key",
      targetId: record.id,
      detail: { name, permission, scope },
      ip: clientIp(request),
    });
    return reply.code(201).send({ key: plain, record: publicKey(record) });
  });

  app.delete("/api/keys/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const key = await repos.apiKeys.getById(id);
    if (!key || key.user_id !== authUser.user.id) {
      return reply.code(404).send({ error: "key_not_found" });
    }
    if (key.revoked_at) {
      return reply.send({ ok: true });
    }
    if (authUser.keyRecord?.id === id) {
      return reply.code(400).send({ error: "cannot_revoke_active_key" });
    }
    await repos.apiKeys.revoke(id);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "api_key.revoke",
      targetType: "api_key",
      targetId: id,
      detail: { name: key.name },
      ip: clientIp(request),
    });
    return reply.send({ ok: true });
  });

  app.get("/api/admin/db", { preHandler: requireAdmin }, async (_request, reply) => {
    const active = describeActive(config.dbPath);
    return reply.send({
      driver: active.driver,
      label: active.label,
      envOverride: Boolean(config.databaseUrl),
    });
  });

  app.post("/api/admin/db", { preHandler: requireAdmin }, async (request, reply) => {
    const body = (request.body ?? {}) as { driver?: string; url?: string };
    let choice: { driver: "postgres"; url: string } | { driver: "sqlite" };
    if (body.driver === "postgres") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!isPostgresUrl(url)) {
        return reply.code(400).send({ error: "invalid_postgres_url" });
      }
      choice = { driver: "postgres", url };
    } else if (body.driver === "sqlite") {
      choice = { driver: "sqlite" };
    } else {
      return reply.code(400).send({ error: "invalid_driver" });
    }
    try {
      const result = await swapDatabase(repos.db, config.dbPath, choice, deps.host.migrationSources());
      persistChoice(config.dbPath, choice);
      const active = describeActive(config.dbPath);
      return reply.send({
        ok: true,
        driver: active.driver,
        label: active.label,
        swapped: result.swapped,
        seeded: result.seeded,
      });
    } catch (err) {
      return reply.code(502).send({ error: "db_switch_failed", detail: (err as Error).message });
    }
  });

  app.get("/api/sampling-config", { preHandler: requireAdmin }, async () => {
    const raw = (await repos.instance.get("global_sample_rate")) ?? "1";
    const rate = Number(raw);
    return { sample_rate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1 };
  });

  app.put("/api/sampling-config", { preHandler: requireAdmin }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as { sample_rate?: unknown };
    const value = Number(body.sample_rate);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return reply.code(400).send({ error: "invalid_sample_rate" });
    }
    await repos.instance.set("global_sample_rate", String(value));
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "settings.sampling.update",
      targetType: "instance",
      targetId: "global_sample_rate",
      detail: { sample_rate: value },
      ip: clientIp(request),
    });
    return reply.send({ ok: true, sample_rate: value });
  });

  const publicUser = (user: User): Record<string, unknown> => ({
    id: user.id,
    email: user.email,
    is_admin: user.is_admin,
    must_change_password: user.must_change_password,
    created_at: user.created_at,
  });

  const adminCount = async (): Promise<number> => (await repos.users.list()).filter((u) => u.is_admin === 1).length;

  app.get("/api/admin/users", { preHandler: requireAdmin }, async (_request, reply) => {
    const users = await repos.users.list();
    return reply.send({ users: users.map(publicUser) });
  });

  app.post("/api/admin/users", { preHandler: requireAdmin }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as { email?: string; password?: string; is_admin?: boolean };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return reply.code(400).send({ error: "invalid_email" });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: "password_too_short" });
    }
    if (await repos.users.findByEmail(email)) {
      return reply.code(409).send({ error: "email_taken" });
    }
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const key = generateApiKey();
    await repos.users.create({
      id: userId,
      email,
      password: await bcrypt.hash(password, 10),
      api_key: hashKey(key),
      is_admin: body.is_admin ? 1 : 0,
      must_change_password: 0,
      created_at: now,
    });
    await repos.projects.create({ id: crypto.randomUUID(), user_id: userId, name: "Default", created_at: now });
    await repos.apiKeys.create({
      id: crypto.randomUUID(),
      user_id: userId,
      name: "Default API key",
      key_hash: hashKey(key),
      key_prefix: keyPrefix(key),
      scope: "full",
      projects: null,
      permission: "read_write",
      created_at: now,
      last_used_at: null,
      revoked_at: null,
      budget_usd: null,
      hard_cap_usd: null,
    });
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "admin.user.create",
      targetType: "user",
      targetId: userId,
      detail: { email, is_admin: body.is_admin ? 1 : 0 },
      ip: clientIp(request),
    });
    return reply.code(201).send({ user: publicUser((await repos.users.findById(userId))!), api_key: key });
  });

  app.patch("/api/admin/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const target = await repos.users.findById(id);
    if (!target) {
      return reply.code(404).send({ error: "user_not_found" });
    }
    const body = (request.body ?? {}) as { is_admin?: boolean };
    if ("is_admin" in body) {
      const next = body.is_admin ? 1 : 0;
      if (target.is_admin === 1 && next === 0 && (await adminCount()) <= 1) {
        return reply.code(400).send({ error: "last_admin" });
      }
      await repos.users.setAdmin(id, next);
      recordAudit(repos, {
        userId: authUser.user.id,
        actor: "session",
        action: "admin.user.role",
        targetType: "user",
        targetId: id,
        detail: { is_admin: next },
        ip: clientIp(request),
      });
    }
    return reply.send({ user: publicUser((await repos.users.findById(id))!) });
  });

  app.delete("/api/admin/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    if (id === authUser.user.id) {
      return reply.code(400).send({ error: "cannot_delete_self" });
    }
    const target = await repos.users.findById(id);
    if (!target) {
      return reply.code(404).send({ error: "user_not_found" });
    }
    if (target.is_admin === 1 && (await adminCount()) <= 1) {
      return reply.code(400).send({ error: "last_admin" });
    }
    await repos.users.delete(id);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "admin.user.delete",
      targetType: "user",
      targetId: id,
      detail: { email: target.email },
      ip: clientIp(request),
    });
    return reply.send({ ok: true });
  });

  app.get("/api/admin/backup", { preHandler: requireAdmin }, async (_request, reply) => {
    const active = describeActive(config.dbPath);
    if (active.driver !== "sqlite") {
      return reply.code(400).send({ error: "backup_sqlite_only" });
    }
    const tmp = path.join(os.tmpdir(), `torrix-backup-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.sqlite`);
    try {
      await sqlRun(repos.db.engine, `VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const bytes = Buffer.from(await Bun.file(tmp).arrayBuffer());
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      reply
        .header("content-type", "application/octet-stream")
        .header("content-disposition", `attachment; filename="torrix-backup-${stamp}.sqlite"`);
      return reply.send(bytes);
    } catch (err) {
      return reply.code(500).send({ error: "backup_failed", detail: (err as Error).message });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  const evalScorer = (raw: unknown): EvalScorer => {
    return raw === "contains" ? "contains" : "exact";
  };

  app.get("/api/settings/permissions", { preHandler: authenticate }, async (request) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const tabs = ["database", "sampling"];
    if (authUser.user.is_admin === 1) {
      tabs.push("users", "license");
    }
    if (deps.host.featureAllowed("sso")) {
      tabs.push("sso");
    }
    return {
      tabs,
      is_admin: authUser.user.is_admin === 1,
      edition: config.edition,
    };
  });

  const licenseNotice = (): string | null => {
    const revocation = config.license.revocation();
    if (revocation) {
      return `License serial ${revocation.serial} is on the signed revocation list${revocation.reason ? ` (${revocation.reason})` : ""}. The instance runs on the Community edition. Contact whoever issued the key.`;
    }
    if (config.edition === "community" || deps.host.hasPaidFeatures()) {
      return null;
    }
    const name = config.edition === "enterprise" ? "Enterprise" : "Pro";
    return `Your ${name} license is active, but this server runs the Community build, which does not include ${name} features. Switch to the Torrix ${name} image and keep your data volume and license key. Your runs, settings and users carry over.`;
  };

  app.get("/api/license", { preHandler: requireAdmin }, async () => {
    const grant = config.license.activeGrant();
    return {
      edition: config.edition,
      source: grant?.source === "license" ? "license" : "env",
      licensee: grant?.licensee ?? null,
      customer: grant?.customer ?? null,
      serial: grant?.serial ?? null,
      expires_at: grant?.expiresAt ?? null,
      revoked: config.license.revocation(),
      paid_build: deps.host.hasPaidFeatures(),
      notice: licenseNotice(),
    };
  });

  app.post("/api/license", { preHandler: requireAdmin }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as { key?: string };
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key) {
      return reply.code(400).send({ error: "missing_license_key" });
    }
    const result = await verifyLicense(key, config.license.trustedKeys);
    if (!result.valid || !result.payload) {
      return reply.code(400).send({ error: "invalid_license", reason: result.reason ?? "invalid" });
    }
    await repos.instance.set("license_key", key);
    grantFromLicense(config.license, result.payload);
    await refreshLicenseRevocations(repos, config.license, deps.env ?? {});
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "license.activate",
      targetType: "instance",
      targetId: "license",
      detail: { edition: result.payload.edition, licensee: result.payload.licensee ?? null, serial: result.payload.serial ?? null },
      ip: clientIp(request),
    });
    return reply.send({
      ok: true,
      edition: config.edition,
      licensee: result.payload.licensee ?? null,
      customer: result.payload.customer ?? null,
      serial: result.payload.serial ?? null,
      expires_at: result.payload.expires_at ?? null,
      revoked: config.license.revocation(),
      paid_build: deps.host.hasPaidFeatures(),
      notice: licenseNotice(),
    });
  });

  app.delete("/api/license", { preHandler: requireAdmin }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    await repos.instance.set("license_key", "");
    config.license.clear();
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "license.deactivate",
      targetType: "instance",
      targetId: "license",
      detail: { edition: config.edition },
      ip: clientIp(request),
    });
    return reply.send({ ok: true, edition: config.edition });
  });

  app.get("/api/datasets", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const datasets = await repos.datasets.listByUser(authUser.user.id);
    const withRows = [];
    for (const ds of datasets) {
      withRows.push({ ...ds, rows: await repos.datasets.countRows(ds.id) });
    }
    return reply.send({ datasets: withRows });
  });

  app.post("/api/datasets", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as { name?: string; description?: string };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) {
      return reply.code(400).send({ error: "invalid_dataset_name" });
    }
    const existing = await repos.datasets.countByUser(authUser.user.id);
    if (existing >= config.editionConfig.maxDatasets) {
      return reply.code(400).send({ error: "dataset_limit_reached", max: config.editionConfig.maxDatasets });
    }
    const project = await repos.projects.findDefault(authUser.user.id);
    if (!project) {
      return reply.code(400).send({ error: "no_project" });
    }
    const now = new Date().toISOString();
    const dataset: Dataset = {
      id: crypto.randomUUID(),
      project_id: project.id,
      user_id: authUser.user.id,
      name,
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      created_at: now,
      updated_at: now,
    };
    await repos.datasets.create(dataset);
    return reply.code(201).send({ dataset: { ...dataset, rows: 0 } });
  });

  app.get("/api/datasets/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const dataset = await repos.datasets.getById(id, authUser.user.id);
    if (!dataset) {
      return reply.code(404).send({ error: "dataset_not_found" });
    }
    const rows = await repos.datasets.listRows(id);
    const evals = await listEvalsWithDataset(repos, authUser.user.id, id);
    return reply.send({ dataset, rows, evals });
  });

  app.patch("/api/datasets/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const dataset = await repos.datasets.getById(id, authUser.user.id);
    if (!dataset) {
      return reply.code(404).send({ error: "dataset_not_found" });
    }
    const body = (request.body ?? {}) as { name?: string; description?: string };
    const fields: Partial<Dataset> & { updated_at: string } = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name || name.length > 80) {
        return reply.code(400).send({ error: "invalid_dataset_name" });
      }
      fields.name = name;
    }
    if (typeof body.description === "string") {
      fields.description = body.description;
    }
    await repos.datasets.updateMeta(id, fields);
    const updated = (await repos.datasets.getById(id, authUser.user.id)) ?? dataset;
    return reply.send({ dataset: updated });
  });

  app.delete("/api/datasets/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const deleted = await repos.datasets.delete(id, authUser.user.id);
    if (!deleted) {
      return reply.code(404).send({ error: "dataset_not_found" });
    }
    return reply.send({ ok: true });
  });

  app.post("/api/datasets/:id/rows", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const dataset = await repos.datasets.getById(id, authUser.user.id);
    if (!dataset) {
      return reply.code(404).send({ error: "dataset_not_found" });
    }
    const count = await repos.datasets.countRows(id);
    if (count >= config.editionConfig.maxDatasetRows) {
      return reply.code(400).send({ error: "row_limit_reached", max: config.editionConfig.maxDatasetRows });
    }
    const body = (request.body ?? {}) as { input?: string; expected?: string; tags?: string[] };
    const input = typeof body.input === "string" ? body.input.trim() : "";
    if (!input) {
      return reply.code(400).send({ error: "input_required" });
    }
    const tags = Array.isArray(body.tags) ? body.tags.map(String).map((t) => t.trim()).filter(Boolean) : [];
    const row: DatasetRow = {
      id: crypto.randomUUID(),
      dataset_id: id,
      idx: count,
      input,
      expected: typeof body.expected === "string" && body.expected.trim() ? body.expected.trim() : null,
      tags: tags.length ? JSON.stringify(tags) : null,
      created_at: new Date().toISOString(),
    };
    await repos.datasets.addRow(row);
    return reply.code(201).send({ row });
  });

  app.delete("/api/dataset-rows/:rowId", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { rowId } = request.params as { rowId: string };
    const deleted = await repos.datasets.deleteRow(rowId, authUser.user.id);
    if (!deleted) {
      return reply.code(404).send({ error: "row_not_found" });
    }
    return reply.send({ ok: true });
  });

  app.post("/api/datasets/:id/evaluations", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const dataset = await repos.datasets.getById(id, authUser.user.id);
    if (!dataset) {
      return reply.code(404).send({ error: "dataset_not_found" });
    }
    const rowsCount = await repos.datasets.countRows(id);
    if (!rowsCount) {
      return reply.code(400).send({ error: "dataset_empty" });
    }
    const body = (request.body ?? {}) as {
      mode?: string;
      provider?: string;
      model?: string;
      target_url?: string;
      api_key?: string;
      temperature?: number;
      max_tokens?: number;
      scorer?: string;
    };
    const mode = body.mode === "online" ? "online" : "offline";
    if (mode === "online" && !deps.host.featureAllowed("online-evals")) {
      return reply.code(403).send({ error: "online_evals_gated", detail: "upgrade to pro or enterprise" });
    }
    if (mode === "online") {
      const targetUrl = typeof body.target_url === "string" ? body.target_url.trim() : "";
      const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        return reply.code(400).send({ error: "invalid_target_url" });
      }
      if (!apiKey) {
        return reply.code(400).send({ error: "api_key_required" });
      }
      if (!body.model || !body.provider) {
        return reply.code(400).send({ error: "model_and_provider_required" });
      }
    }
    const project = await repos.projects.findDefault(authUser.user.id);
    const evalRecord: Eval = {
      id: crypto.randomUUID(),
      user_id: authUser.user.id,
      project_id: project?.id ?? dataset.project_id,
      dataset_id: id,
      mode,
      provider: (body.provider ?? "custom").trim().toLowerCase(),
      model: (body.model ?? "").trim(),
      target_url: mode === "online" ? body.target_url?.trim() ?? null : null,
      temperature: typeof body.temperature === "number" && Number.isFinite(body.temperature) ? Number(body.temperature) : null,
      max_tokens: typeof body.max_tokens === "number" && Number.isFinite(body.max_tokens) ? Math.floor(Math.max(1, body.max_tokens)) : null,
      scorer: evalScorer(body.scorer),
      status: "running",
      total_rows: 0,
      rows_done: 0,
      passed: 0,
      fail: 0,
      score_sum: 0,
      cost_usd: 0,
      tokens_total: 0,
      avg_latency_ms: 0,
      error: null,
      started_at: new Date().toISOString(),
      finished_at: null,
      created_at: new Date().toISOString(),
    };
    await repos.evals.create(evalRecord);
    if (mode === "online" && typeof body.api_key === "string") {
      retainEvalKey(evalRecord.id, body.api_key.trim());
    }
    void runEvaluation({ repos, edition: config.editionConfig, onlineEvals: deps.host.featureAllowed("online-evals"), assist: deps.host.assist() }, evalRecord.id, authUser.user.id);
    return reply.code(201).send({ eval: evalRecord });
  });

  app.get("/api/evals", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const evals = await listEvalsWithDataset(repos, authUser.user.id);
    return reply.send({ evals });
  });

  app.get("/api/evals/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const evalRecord = await repos.evals.getById(id, authUser.user.id);
    if (!evalRecord) {
      return reply.code(404).send({ error: "eval_not_found" });
    }
    const results = await repos.evals.listResults(id);
    const rows = await repos.datasets.listRows(evalRecord.dataset_id);
    const rowById = new Map(rows.map((r) => [r.id, r.input.slice(0, 200)]));
    const decorated = results.map((r) => ({ ...r, input_hint: r.dataset_row_id ? rowById.get(r.dataset_row_id) ?? null : null }));
    return reply.send({ eval: evalRecord, results: decorated });
  });

  app.put("/api/dataset-rows/:rowId", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { rowId } = request.params as { rowId: string };
    const existing = await repos.datasets.getRow(rowId, authUser.user.id);
    if (!existing) {
      return reply.code(404).send({ error: "row_not_found" });
    }
    const body = (request.body ?? {}) as { input?: string; expected?: string | null; tags?: string[] };
    const fields: Partial<DatasetRow> = {};
    if (typeof body.input === "string") {
      const input = body.input.trim();
      if (!input) {
        return reply.code(400).send({ error: "input_required" });
      }
      fields.input = input;
    }
    if ("expected" in body) {
      fields.expected = typeof body.expected === "string" && body.expected.trim() ? body.expected.trim() : null;
    }
    if (Array.isArray(body.tags)) {
      const tags = body.tags.map(String).map((t) => t.trim()).filter(Boolean);
      fields.tags = tags.length ? JSON.stringify(tags) : null;
    }
    if (!Object.keys(fields).length) {
      return reply.code(400).send({ error: "nothing_to_update" });
    }
    await repos.datasets.updateRow(rowId, authUser.user.id, fields);
    const updated = await repos.datasets.getRow(rowId, authUser.user.id);
    return reply.send({ row: updated });
  });

  app.post("/api/datasets/:id/rows/import", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const dataset = await repos.datasets.getById(id, authUser.user.id);
    if (!dataset) {
      return reply.code(404).send({ error: "dataset_not_found" });
    }
    const raw = request.body;
    let candidates: Array<{ input?: unknown; expected?: unknown; tags?: unknown }> = [];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const body = raw as { rows?: unknown; csv?: string };
      if (Array.isArray(body.rows)) {
        candidates = body.rows as Array<Record<string, unknown>>;
      } else if (typeof body.csv === "string") {
        candidates = parseCsvRows(body.csv);
      }
    } else if (typeof raw === "string") {
      candidates = parseCsvRows(raw);
    }
    if (!candidates.length) {
      return reply.code(400).send({ error: "no_rows" });
    }
    const count = await repos.datasets.countRows(id);
    const remaining = Math.max(0, config.editionConfig.maxDatasetRows - count);
    if (candidates.length > remaining) {
      return reply.code(400).send({ error: "row_limit_reached", max: config.editionConfig.maxDatasetRows, remaining });
    }
    const created: DatasetRow[] = [];
    const now = new Date().toISOString();
    for (const candidate of candidates) {
      const input = typeof candidate.input === "string" ? candidate.input.trim() : "";
      if (!input) {
        continue;
      }
      let tags: string[] = [];
      if (Array.isArray(candidate.tags)) {
        tags = candidate.tags.map(String).map((t) => t.trim()).filter(Boolean);
      } else if (typeof candidate.tags === "string" && candidate.tags.trim()) {
        tags = candidate.tags.split("|").map((t) => t.trim()).filter(Boolean);
      }
      created.push({
        id: crypto.randomUUID(),
        dataset_id: id,
        idx: count + created.length,
        input,
        expected: typeof candidate.expected === "string" && candidate.expected.trim() ? candidate.expected.trim() : null,
        tags: tags.length ? JSON.stringify(tags) : null,
        created_at: now,
      });
    }
    if (!created.length) {
      return reply.code(400).send({ error: "no_valid_rows" });
    }
    await repos.datasets.addRows(created);
    await repos.datasets.updateMeta(id, { updated_at: now } as Partial<Dataset>);
    return reply.code(201).send({ imported: created.length, skipped: candidates.length - created.length, rows: created });
  });

  app.get("/api/evals/:id/stream", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const evalRecord = await repos.evals.getById(id, authUser.user.id);
    if (!evalRecord) {
      return reply.code(404).send({ error: "eval_not_found" });
    }
    if (!acquireSseSlot()) {
      return reply.code(503).send({ error: "too_many_streams" });
    }
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(serializeSse({ type: "connected", eval: evalRecord }));
    const onEval = (updated: unknown) => {
      const record = updated as { id?: string };
      if (record.id === id) {
        reply.raw.write(serializeSse({ type: "eval.progress", eval: updated }));
      }
    };
    evalEmitter.on("eval", onEval);
    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 25_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      evalEmitter.off("eval", onEval);
      releaseSseSlot();
    });
    return reply;
  });

  const parseNullableUsd = (value: unknown): number | null => {
    if (value == null || value === "") {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const activeFlag = (value: unknown): number => (value == null || value === false || value === 0 || value === "0" || value === "false" ? 0 : 1);

  app.get("/api/cost/settings", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const settings = await repos.alerts.getByUser(authUser.user.id);
    const since = monthStart();
    const userSpend = await spendSince(repos, authUser.user.id, since);
    const usage: CostUsageRow[] = [
      { scope: "user", id: null, name: "Account (all projects)", spend: userSpend, budget_usd: settings.budget_usd, hard_cap_usd: settings.hard_cap_usd },
    ];
    const projects = await repos.projects.listByUser(authUser.user.id);
    for (const project of projects) {
      usage.push({
        scope: "project",
        id: project.id,
        name: project.name,
        spend: await spendSince(repos, authUser.user.id, since, "project", project.id),
        budget_usd: project.budget_usd ?? null,
        hard_cap_usd: project.hard_cap_usd ?? null,
      });
    }
    const keys = await repos.apiKeys.listByUser(authUser.user.id);
    for (const key of keys) {
      usage.push({
        scope: "api_key",
        id: key.id,
        name: key.name,
        spend: await spendSince(repos, authUser.user.id, since, "api_key", key.id),
        budget_usd: key.budget_usd ?? null,
        hard_cap_usd: key.hard_cap_usd ?? null,
      });
    }
    const judgeSpend = await repos.judge.sumCostSince(authUser.user.id, since);
    return reply.send({ settings, month: since.slice(0, 10), usage, judge_spend: judgeSpend });
  });

  app.put("/api/cost/settings", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as Partial<AlertSettings>;
    const fields: Partial<AlertSettings> = {};
    if ("enabled" in body) fields.enabled = activeFlag(body.enabled);
    if ("webhook_url" in body) fields.webhook_url = typeof body.webhook_url === "string" ? body.webhook_url.trim() || null : null;
    if ("webhook_secret" in body) fields.webhook_secret = typeof body.webhook_secret === "string" ? body.webhook_secret.trim() || null : null;
    if ("pagerduty_routing_key" in body) {
      fields.pagerduty_routing_key = typeof body.pagerduty_routing_key === "string" ? body.pagerduty_routing_key.trim() || null : null;
    }
    if ("email_webhook_url" in body) {
      fields.email_webhook_url = typeof body.email_webhook_url === "string" ? body.email_webhook_url.trim() || null : null;
    }
    if ("email_webhook_token" in body) {
      fields.email_webhook_token = typeof body.email_webhook_token === "string" ? body.email_webhook_token.trim() || null : null;
    }
    if ("email_recipients" in body) {
      fields.email_recipients = typeof body.email_recipients === "string" ? body.email_recipients.trim() || null : null;
    }
    if ("budget_usd" in body) fields.budget_usd = parseNullableUsd(body.budget_usd);
    if ("hard_cap_usd" in body) fields.hard_cap_usd = parseNullableUsd(body.hard_cap_usd);
    if ("notify_on_error" in body) fields.notify_on_error = activeFlag(body.notify_on_error);
    if ("anomaly_enabled" in body) fields.anomaly_enabled = activeFlag(body.anomaly_enabled);
    if ("anomaly_multiplier" in body) {
      const m = Number(body.anomaly_multiplier);
      fields.anomaly_multiplier = Number.isFinite(m) && m >= 1 ? m : 3.0;
    }
    if ("digest_enabled" in body) fields.digest_enabled = activeFlag(body.digest_enabled);
    await repos.alerts.update(authUser.user.id, fields);
    const settings = await repos.alerts.getByUser(authUser.user.id);
    return reply.send({ settings });
  });

  app.get("/api/cost/pricing", { preHandler: authenticate }, async () => ({
    prices: await repos.prices.list(),
  }));

  app.put("/api/cost/pricing", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    void authUser;
    const body = (request.body ?? {}) as { model?: string; input?: number; output?: number };
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const input = Number(body.input);
    const output = Number(body.output);
    if (!model || model.length > 120 || !/[a-z0-9_.\-/+ ]/i.test(model)) {
      return reply.code(400).send({ error: "invalid_model" });
    }
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      return reply.code(400).send({ error: "invalid_price" });
    }
    await repos.prices.upsert(model, input, output);
    setPricingOverride(model, input, output);
    return reply.send({ price: { model, input, output } });
  });

  app.delete("/api/cost/pricing/:model", { preHandler: authenticate }, async (request, reply) => {
    const { model } = request.params as { model: string };
    const removed = await repos.prices.remove(model);
    if (!removed) {
      return reply.code(404).send({ error: "price_not_found" });
    }
    removePricingOverride(model);
    return reply.send({ ok: true });
  });

  app.put("/api/cost/project/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const project = await repos.projects.findById(id);
    if (!project || project.user_id !== authUser.user.id) {
      return reply.code(404).send({ error: "project_not_found" });
    }
    const body = (request.body ?? {}) as {
      budget_usd?: number;
      hard_cap_usd?: number;
      prompt_compression?: string;
      compression_words?: string | null;
    };
    const fields: Partial<{ budget_usd: number | null; hard_cap_usd: number | null }> = {};
    if ("budget_usd" in body) fields.budget_usd = parseNullableUsd(body.budget_usd);
    if ("hard_cap_usd" in body) fields.hard_cap_usd = parseNullableUsd(body.hard_cap_usd);
    await repos.projects.updateBudget(id, fields);
    if ("prompt_compression" in body) {
      const mode = body.prompt_compression;
      if (mode !== "off" && mode !== "conservative" && mode !== "balanced") {
        return reply.code(400).send({ error: "invalid_prompt_compression" });
      }
      await repos.projects.updateCompression(id, { prompt_compression: mode });
    }
    if ("compression_words" in body) {
      const words = typeof body.compression_words === "string" ? body.compression_words.trim() : "";
      await repos.projects.updateCompression(id, { compression_words: words || null });
    }
    return reply.send({ ok: true });
  });

  app.put("/api/cost/key/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const key = await repos.apiKeys.getById(id);
    if (!key || key.user_id !== authUser.user.id) {
      return reply.code(404).send({ error: "key_not_found" });
    }
    const body = (request.body ?? {}) as { budget_usd?: number; hard_cap_usd?: number };
    const fields: Partial<{ budget_usd: number | null; hard_cap_usd: number | null }> = {};
    if ("budget_usd" in body) fields.budget_usd = parseNullableUsd(body.budget_usd);
    if ("hard_cap_usd" in body) fields.hard_cap_usd = parseNullableUsd(body.hard_cap_usd);
    await repos.apiKeys.updateLimits(id, fields);
    return reply.send({ ok: true });
  });

  app.get("/api/projects", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const accessible = await repos.projects.listAccessible(authUser.user.id);
    return reply.send({ projects: accessible.map((entry) => ({ ...entry.project, role: entry.role })) });
  });

  app.post("/api/projects", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as { name?: string };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) {
      return reply.code(400).send({ error: "name_required" });
    }
    const project = {
      id: crypto.randomUUID(),
      user_id: authUser.user.id,
      name,
      created_at: new Date().toISOString(),
    };
    await repos.projects.create(project);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "project.create",
      targetType: "project",
      targetId: project.id,
      detail: { name },
      ip: clientIp(request),
    });
    return reply.code(201).send({ project: { ...project, role: "owner" } });
  });

  app.patch("/api/projects/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    if ((await repos.projects.roleFor(authUser.user.id, id)) !== "owner") {
      return reply.code(403).send({ error: "owner_required" });
    }
    const body = (request.body ?? {}) as { name?: string };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) {
      return reply.code(400).send({ error: "name_required" });
    }
    await repos.projects.rename(id, name);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "project.rename",
      targetType: "project",
      targetId: id,
      detail: { name },
      ip: clientIp(request),
    });
    return reply.send({ ok: true, project: { ...(await repos.projects.findById(id)), role: "owner" } });
  });

  app.delete("/api/projects/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    if ((await repos.projects.roleFor(authUser.user.id, id)) !== "owner") {
      return reply.code(403).send({ error: "owner_required" });
    }
    const owned = await repos.projects.listByUser(authUser.user.id);
    if (owned.length <= 1) {
      return reply.code(400).send({ error: "last_project" });
    }
    await repos.projects.delete(id);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "project.delete",
      targetType: "project",
      targetId: id,
      ip: clientIp(request),
    });
    return reply.send({ ok: true });
  });

  app.get("/api/projects/:id/members", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    if (!(await repos.projects.roleFor(authUser.user.id, id))) {
      return reply.code(404).send({ error: "project_not_found" });
    }
    const project = await repos.projects.findById(id);
    if (!project) {
      return reply.code(404).send({ error: "project_not_found" });
    }
    const owner = await repos.users.findById(project.user_id);
    const members: Array<{ user_id: string; email: string; role: string }> = [
      { user_id: project.user_id, email: owner?.email ?? "", role: "owner" },
    ];
    for (const member of await repos.projects.listMembers(id)) {
      const user = await repos.users.findById(member.user_id);
      members.push({ user_id: member.user_id, email: user?.email ?? member.user_id, role: member.role });
    }
    return reply.send({ members });
  });

  app.post("/api/projects/:id/members", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    if ((await repos.projects.roleFor(authUser.user.id, id)) !== "owner") {
      return reply.code(403).send({ error: "owner_required" });
    }
    const project = await repos.projects.findById(id);
    if (!project) {
      return reply.code(404).send({ error: "project_not_found" });
    }
    const body = (request.body ?? {}) as { email?: string; role?: string };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const target = email ? await repos.users.findByEmail(email) : null;
    if (!target) {
      return reply.code(404).send({ error: "user_not_found" });
    }
    if (target.id === project.user_id) {
      return reply.code(400).send({ error: "already_owner" });
    }
    const role = body.role === "editor" ? "editor" : "viewer";
    await repos.projects.addMember(id, target.id, role);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "project.member.add",
      targetType: "project",
      targetId: id,
      detail: { user_id: target.id, role },
      ip: clientIp(request),
    });
    return reply.code(201).send({ ok: true, member: { user_id: target.id, email: target.email, role } });
  });

  app.patch("/api/projects/:id/members/:userId", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id, userId } = request.params as { id: string; userId: string };
    if ((await repos.projects.roleFor(authUser.user.id, id)) !== "owner") {
      return reply.code(403).send({ error: "owner_required" });
    }
    const body = (request.body ?? {}) as { role?: string };
    const role = body.role === "editor" ? "editor" : body.role === "viewer" ? "viewer" : null;
    if (!role) {
      return reply.code(400).send({ error: "invalid_role" });
    }
    await repos.projects.updateMemberRole(id, userId, role);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "project.member.update",
      targetType: "project",
      targetId: id,
      detail: { user_id: userId, role },
      ip: clientIp(request),
    });
    return reply.send({ ok: true });
  });

  app.delete("/api/projects/:id/members/:userId", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id, userId } = request.params as { id: string; userId: string };
    if ((await repos.projects.roleFor(authUser.user.id, id)) !== "owner") {
      return reply.code(403).send({ error: "owner_required" });
    }
    const removed = await repos.projects.removeMember(id, userId);
    if (!removed) {
      return reply.code(404).send({ error: "member_not_found" });
    }
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "project.member.remove",
      targetType: "project",
      targetId: id,
      detail: { user_id: userId },
      ip: clientIp(request),
    });
    return reply.send({ ok: true });
  });

  app.post("/api/cost/digest", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const result = await runWeeklyDigest({ repos }, authUser.user.id, true);
    if (!result.sent) {
      return reply.code(400).send({ error: "digest_not_sent", reason: "configure a webhook url, PagerDuty routing key or email gateway first" });
    }
    return reply.send({ sent: true, payload: result.payload });
  });

  app.get("/api/dashboard", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const projectId = q.project && (await repos.projects.roleFor(authUser.user.id, q.project)) ? q.project : undefined;
    const stats = await repos.runs.dashboardStats(authUser.user.id, {
      projectId,
      from: q.from,
      to: q.to,
    });
    const judgeCostUsd = await repos.judge.sumCostSince(authUser.user.id, monthStart());
    return reply.send({ ...stats, judgeCostUsd });
  });

  app.get("/api/runs", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const offset = (page - 1) * limit;
    const projectId = q.project && (await repos.projects.roleFor(authUser.user.id, q.project)) ? q.project : undefined;
    const opts = runQueryOptions(q, limit, offset, config.editionConfig.fullTextSearch);
    opts.projectId = projectId;
    const { runs, total } = await repos.runs.list(authUser.user.id, opts);
    return reply.send({ runs, total, page, limit });
  });

  app.post("/api/runs/bulk", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as { action?: string; ids?: unknown; score?: unknown; note?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) {
      return reply.code(400).send({ error: "no_ids" });
    }
    if (ids.length > 500) {
      return reply.code(400).send({ error: "too_many_ids", max: 500 });
    }
    if (body.action === "delete") {
      const deleted = await repos.runs.deleteMany(authUser.user.id, ids);
      recordAudit(repos, {
        userId: authUser.user.id,
        actor: "session",
        action: "run.bulk_delete",
        targetType: "run",
        targetId: null,
        detail: { requested: ids.length, deleted },
        ip: clientIp(request),
      });
      return reply.send({ ok: true, deleted });
    }
    if (body.action === "score") {
      let score: number | null;
      if (body.score === "good" || body.score === 1 || body.score === "1") {
        score = 1;
      } else if (body.score === "bad" || body.score === 0 || body.score === "0") {
        score = 0;
      } else if (body.score === "unscored" || body.score === null) {
        score = null;
      } else {
        return reply.code(400).send({ error: "invalid_score" });
      }
      const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;
      const scoredAt = score == null ? null : new Date().toISOString();
      const updated = await repos.runs.updateScoreMany(authUser.user.id, ids, score, note, scoredAt);
      recordAudit(repos, {
        userId: authUser.user.id,
        actor: "session",
        action: "run.bulk_score",
        targetType: "run",
        targetId: null,
        detail: { requested: ids.length, updated, score },
        ip: clientIp(request),
      });
      return reply.send({ ok: true, updated });
    }
    if (body.action === "judge") {
      if (!deps.host.featureAllowed("judge")) {
        return reply.code(402).send({ error: "license_required", feature: "judge", edition: "pro" });
      }
      const assist = deps.host.assist();
      const judgeSettings = await repos.judge.getSettings(authUser.user.id);
      if (!judgeSettings || !judgeSettings.model || !judgeSettings.api_key) {
        return reply.code(400).send({ error: "judge_not_configured" });
      }
      const capped = ids.slice(0, 50);
      recordAudit(repos, {
        userId: authUser.user.id,
        actor: "session",
        action: "run.bulk_judge",
        targetType: "run",
        targetId: null,
        detail: { queued: capped.length },
        ip: clientIp(request),
      });
      void (async () => {
        for (const runId of capped) {
          try {
            const run = await repos.runs.getById(runId, authUser.user.id);
            if (!run) {
              continue;
            }
            if (!(await assist.judgeRun(authUser.user.id, run, { apply: true }))) {
              break;
            }
          } catch (err) {
            console.error("bulk judge failed", err);
          }
        }
      })();
      return reply.code(202).send({ ok: true, queued: capped.length });
    }
    return reply.code(400).send({ error: "unknown_action" });
  });

  app.get("/api/runs/export", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const format = q.format === "ndjson" || q.format === "jsonl" || q.format === "slm" ? q.format : "csv";
    const limit = Math.min(2000, Math.max(1, Number(q.limit) || 1000));
    const opts = runQueryOptions(q, limit, 0, config.editionConfig.fullTextSearch);
    opts.projectId = q.project && (await repos.projects.roleFor(authUser.user.id, q.project)) ? q.project : undefined;
    const { runs } = await repos.runs.list(authUser.user.id, opts);
    if (!runs.length) {
      return reply.code(400).send({ error: "no_runs" });
    }
    const includeEvents = q.include_events === "1" || q.include_events === "true" || format === "jsonl" || format === "slm";
    const events = includeEvents ? await repos.events.listByRunIds(runs.map((run) => run.id)) : [];
    const eventsByRun = new Map<string, Array<{ type: string; message: string; created_at: string }>>();
    for (const event of events) {
      const bucket = eventsByRun.get(event.run_id) ?? [];
      bucket.push({ type: event.type, message: event.message, created_at: event.created_at });
      eventsByRun.set(event.run_id, bucket);
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (format === "csv") {
      reply.header("content-type", "text/csv");
      reply.header("content-disposition", `attachment; filename="torrix-runs-${stamp}.csv"`);
      return reply.send(buildRunsCsv(runs));
    }
    if (format === "ndjson") {
      reply.header("content-type", "application/x-ndjson");
      reply.header("content-disposition", `attachment; filename="torrix-runs-${stamp}.ndjson"`);
      return reply.send(
        runs
          .map((run) => JSON.stringify(includeEvents ? { ...run, events: eventsByRun.get(run.id) ?? [] } : run))
          .join("\n"),
      );
    }
    const lines: string[] = [];
    for (const run of runs) {
      const runEvents = eventsByRun.get(run.id) ?? [];
      const response = runEvents.find((event) => event.type === "response")?.message ?? "";
      const prompt = extractPromptText(run, runEvents);
      if (!prompt) {
        continue;
      }
      if (format === "jsonl") {
        if (!response) {
          continue;
        }
        const messages = requestMessages(run) ?? [{ role: "user", content: prompt }];
        lines.push(JSON.stringify({ messages: [...messages, { role: "assistant", content: response }] }));
      } else {
        lines.push(
          JSON.stringify({
            input: prompt,
            output: response,
            model: run.model ?? null,
            score: run.score ?? null,
            session_id: run.session_id ?? null,
            trace_id: run.trace_id ?? null,
            created_at: run.created_at,
          }),
        );
      }
    }
    if (!lines.length) {
      return reply.code(400).send({ error: "no_exportable_runs" });
    }
    reply.header("content-type", "application/x-ndjson");
    reply.header("content-disposition", `attachment; filename="torrix-${format === "jsonl" ? "fine-tune" : "slm"}-${stamp}.jsonl"`);
    return reply.send(lines.join("\n"));
  });

  app.get("/api/runs/compare", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const ids = (q.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (ids.length < 2) {
      return reply.code(400).send({ error: "need_two_runs" });
    }
    const payload: Array<{ run: Run; events: Events[] }> = [];
    for (const id of ids) {
      const run = await repos.runs.getById(id, authUser.user.id);
      if (!run) {
        continue;
      }
      payload.push({ run, events: await repos.events.listByRun(id) });
    }
    if (payload.length < 2) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    return reply.send({ runs: payload });
  });

  app.post("/api/runs/:id/replay", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const run = await repos.runs.getById(id, authUser.user.id);
    if (!run) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    if (!run.request_body) {
      return reply.code(400).send({ error: "request_body_missing" });
    }
    const body = (request.body ?? {}) as { target_url?: string; api_key?: string; model?: string };
    const rawTarget = (typeof body.target_url === "string" && body.target_url.trim()) || run.target_url || "";
    if (!rawTarget) {
      return reply.code(400).send({ error: "target_url_missing" });
    }
    const validation = validateTargetUrl(rawTarget, !!config.localHost);
    if (!validation.valid || !validation.url) {
      return reply.code(400).send({ error: "blocked_target_url", reason: validation.reason });
    }
    const upstreamAuthorization =
      request.headers["x-upstream-authorization"] ??
      (typeof body.api_key === "string" && body.api_key.trim() ? `Bearer ${body.api_key.trim()}` : undefined);
    let forwardBody = run.request_body;
    if (typeof body.model === "string" && body.model.trim()) {
      try {
        const parsed = JSON.parse(run.request_body) as Record<string, unknown>;
        parsed.model = body.model.trim();
        forwardBody = JSON.stringify(parsed);
      } catch {
        return reply.code(400).send({ error: "request_body_unparseable" });
      }
    }
    const started = Date.now();
    let res: Response;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (upstreamAuthorization) {
        if (String(upstreamAuthorization).startsWith("Bearer ") && resolveReplayAuthHeader(rawTarget) === "authorization") {
          headers.authorization = String(upstreamAuthorization);
        } else if (resolveReplayAuthHeader(rawTarget) === "x-api-key") {
          headers["x-api-key"] = String(upstreamAuthorization).replace(/^Bearer\s+/i, "");
        } else {
          headers.authorization = String(upstreamAuthorization);
        }
      }
      res = await fetch(validation.url.toString(), {
        method: "POST",
        headers,
        body: forwardBody,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      return reply.code(502).send({ error: "replay_failed", detail: (err as Error).message });
    }
    const resText = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(resText) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    const provider = detectProvider(validation.url.toString());
    const reqBase = safeJsonParse(forwardBody) ?? {};
    const extracted = parsed
      ? provider === "anthropic"
        ? extractAnthropic(reqBase, parsed)
        : provider === "gemini"
          ? extractGemini(reqBase, parsed)
          : extractOpenAI(reqBase, parsed)
      : extractGeneric(reqBase, resText);
    const latency = Date.now() - started;
    const cost = calculateCost(extracted.model ?? body.model ?? run.model ?? "", extracted.inputTokens, extracted.outputTokens);
    const replayId = crypto.randomUUID();
    const now = new Date().toISOString();
    let tags: Record<string, string> = { torrix_replay_of: run.id };
    try {
      const existing = run.tags ? (JSON.parse(run.tags) as Record<string, string>) : {};
      tags = { ...existing, ...tags };
    } catch {
      // keep replay tag only
    }
    const runData = {
      id: replayId,
      user_id: authUser.user.id,
      project_id: run.project_id,
      name: `replay: ${run.name ?? run.id}`.slice(0, 120),
      provider,
      model: extracted.model ?? body.model ?? run.model ?? undefined,
      input_tokens: extracted.inputTokens ?? undefined,
      output_tokens: extracted.outputTokens ?? undefined,
      cost_usd: cost,
      latency_ms: latency,
      status: res.status,
      finish_reason: extracted.finishReason ?? undefined,
      source: "proxy" as const,
      request_body: forwardBody,
      target_url: validation.url.toString(),
      trace_id: run.trace_id ?? undefined,
      session_id: run.session_id ?? undefined,
      agent_name: run.agent_name ?? undefined,
      agent_id: run.agent_id ?? undefined,
      end_user_id: run.end_user_id ?? undefined,
      tags,
      created_at: now,
    };
    const savedRun = buildRunRow(runData);
    await repos.runs.save(savedRun);
    await repos.events.addMany([
      makeEvent(replayId, "info", `replay of run ${run.id}`),
      makeEvent(replayId, "request", forwardBody),
      makeEvent(replayId, "response", extracted.responseText.slice(0, 4000)),
    ]);
    emitRun(savedRun);
    deps.host.runRecorded(savedRun);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: "session",
      action: "run.replay",
      targetType: "run",
      targetId: run.id,
      detail: { replay_run_id: replayId, target_url: validation.url.toString(), status: res.status },
      ip: clientIp(request),
    });
    return reply.code(201).send({ run_id: replayId, status: res.status, response_text: extracted.responseText });
  });

  app.get("/api/runs/:id/cost-comparison", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const run = await repos.runs.getById(id, authUser.user.id);
    if (!run) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    const input = run.input_tokens ?? 0;
    const output = run.output_tokens ?? 0;
    return reply.send({
      run_id: run.id,
      current_model: run.model,
      current_cost_usd: run.cost_usd ?? 0,
      input_tokens: input,
      output_tokens: output,
      models: getCostComparison(input, output),
    });
  });

  app.get("/api/analytics/leaderboard", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const days = clampDays(q.days);
    const projectId = q.project && (await repos.projects.roleFor(authUser.user.id, q.project)) ? q.project : undefined;
    const rows = await repos.runs.analyticsByModel(authUser.user.id, { days, projectId });
    return reply.send({
      window_days: days,
      models: rows.map((row) => ({
        ...row,
        cost_per_1k_tokens: row.tokens > 0 ? Number(((row.cost / row.tokens) * 1000).toFixed(6)) : 0,
        error_rate: row.runs > 0 ? Number(((row.errorCount / row.runs) * 100).toFixed(1)) : 0,
      })),
    });
  });

  app.get("/api/analytics/by-agent", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const days = clampDays(q.days);
    const projectId = q.project && (await repos.projects.roleFor(authUser.user.id, q.project)) ? q.project : undefined;
    const rows = await repos.runs.analyticsByAgent(authUser.user.id, { days, projectId });
    return reply.send({ window_days: days, agents: rows });
  });

  app.get("/api/analytics/by-user", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const days = clampDays(q.days);
    const projectId = q.project && (await repos.projects.roleFor(authUser.user.id, q.project)) ? q.project : undefined;
    const rows = await repos.runs.analyticsByEndUser(authUser.user.id, { days, projectId });
    return reply.send({ window_days: days, end_users: rows });
  });

  app.get("/api/analytics/by-tool", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const days = clampDays(q.days);
    const projectId = q.project && (await repos.projects.roleFor(authUser.user.id, q.project)) ? q.project : undefined;
    const rows = await repos.runs.analyticsByTool(authUser.user.id, { days, projectId });
    return reply.send({ window_days: days, tools: rows });
  });

  app.get("/api/analytics/by-project", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const days = clampDays(q.days);
    const projectId = q.project && (await repos.projects.roleFor(authUser.user.id, q.project)) ? q.project : undefined;
    const rows = await repos.runs.analyticsByProject(authUser.user.id, { days, projectId });
    return reply.send({ window_days: days, projects: rows });
  });

  app.get("/api/search", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const query = (q.q ?? q.query ?? "").trim();
    if (!query) {
      return reply.code(400).send({ error: "query_required" });
    }
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const deep = q.deep === "1" || q.deep === "true" || config.editionConfig.fullTextSearch;
    const { runs, total } = await repos.runs.list(authUser.user.id, {
      limit,
      offset: 0,
      search: query,
      deepSearch: deep && config.editionConfig.fullTextSearch,
    });
    return reply.send({ query, total, runs });
  });

  app.post("/api/query", { preHandler: requireAdmin }, async (request, reply) => {
    const body = (request.body ?? {}) as { sql?: string };
    if (typeof body.sql !== "string" || !body.sql.trim()) {
      return reply.code(400).send({ error: "sql_required" });
    }
    try {
      const result = await runReadOnlyQuery(repos.db.engine, body.sql, 500);
      recordAudit(repos, {
        userId: (request as unknown as { auth: AuthResult }).auth.user.id,
        actor: "session",
        action: "query.run",
        targetType: "instance",
        targetId: null,
        detail: { rowCount: result.rowCount, truncated: result.truncated, elapsedMs: result.elapsedMs },
        ip: clientIp(request),
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof QueryError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/api/insights/generate", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const force = q.force === "1" || q.force === "true";
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    return reply.send(await getInsights(repos, authUser.user.id, clampDays(q.days), force, deps.host.assist(), scope.projectId));
  });

  app.post("/api/insights/generate", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const body = (request.body ?? {}) as { days?: number };
    const days = clampDays(typeof body.days === "number" ? String(body.days) : q.days);
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    const report = await getInsights(repos, authUser.user.id, days, true, deps.host.assist(), scope.projectId);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "insights.generate",
      targetType: "report",
      targetId: "insights",
      detail: { days, generatedWith: report.generatedWith, judgeCostUsd: report.judgeCostUsd, project_id: scope.projectId ?? null },
      ip: clientIp(request),
    });
    return reply.send(report);
  });

  app.get("/api/insights/caching", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    return reply.send(await cachingInsights(repos, authUser.user.id, clampDays(q.days), scope.projectId));
  });

  app.get("/api/insights/slm-savings", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    return reply.send(await slmSavingsInsights(deps.host.assist(), authUser.user.id, scope.projectId));
  });

  app.get("/api/insights/savings", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    return reply.send(await savingsReport(repos, authUser.user.id, { days: Number(q.days) || 30, projectId: scope.projectId, assist: deps.host.assist() }));
  });

  app.get("/api/runs/group/:kind/:id/insights", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { kind, id } = request.params as { kind: string; id: string };
    if (kind !== "trace" && kind !== "session") {
      return reply.code(400).send({ error: "invalid_group_kind" });
    }
    const report = await loadCachedTraceInsights(repos, authUser.user.id, kind, id);
    return reply.send({ report });
  });

  app.post("/api/runs/group/:kind/:id/insights", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { kind, id } = request.params as { kind: string; id: string };
    if (kind !== "trace" && kind !== "session") {
      return reply.code(400).send({ error: "invalid_group_kind" });
    }
    const report = await generateTraceInsights(repos, authUser.user.id, kind, id, deps.host.assist());
    if (!report) {
      return reply.code(404).send({ error: "group_not_found" });
    }
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "insights.generate",
      targetType: kind,
      targetId: id,
      detail: { generatedWith: report.generatedWith, judgeCostUsd: report.judgeCostUsd, runs: report.runs },
      ip: clientIp(request),
    });
    return reply.send(report);
  });

  app.get("/api/runs/group/:kind/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { kind, id } = request.params as { kind: string; id: string };
    if (kind !== "trace" && kind !== "session") {
      return reply.code(400).send({ error: "invalid_group_kind" });
    }
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const { runs, total } = await repos.runs.listGroup(authUser.user.id, { kind, id, limit, offset });
    if (kind === "trace" && q.include === "authorization") {
      const authorization = await deps.host.traceAnnotations({
        userId: authUser.user.id,
        traceId: id,
        runIds: runs.map((run) => run.id),
      });
      return reply.send({ kind, id, runs, total, limit, offset, authorization });
    }
    return reply.send({ kind, id, runs, total, limit, offset });
  });

  app.patch("/api/runs/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const existing = await repos.runs.getById(id, authUser.user.id);
    if (!existing) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fields: Partial<Run> = {};
    if ("score" in body) {
      const s = body.score;
      if (s === null || s === "" || s === "unscored") {
        fields.score = null;
        fields.scored_at = null;
      } else if (s === "good" || s === 1 || s === "1") {
        fields.score = 1;
        fields.scored_at = new Date().toISOString();
      } else if (s === "bad" || s === 0 || s === "0") {
        fields.score = 0;
        fields.scored_at = new Date().toISOString();
      } else {
        return reply.code(400).send({ error: "invalid_score" });
      }
    }
    if ("score_note" in body) {
      fields.score_note = typeof body.score_note === "string" ? body.score_note.slice(0, 2000) : null;
    }
    if ("run_note" in body) {
      fields.run_note = typeof body.run_note === "string" ? body.run_note.slice(0, 4000) : null;
    }
    if ("is_golden" in body) {
      const wantGolden = body.is_golden ? 1 : 0;
      if (wantGolden === 1 && !existing.is_golden && Number.isFinite(config.editionConfig.maxGoldenRuns)) {
        const golden = await repos.runs.countGolden(authUser.user.id);
        if (golden >= config.editionConfig.maxGoldenRuns) {
          return reply.code(400).send({ error: "golden_limit_reached", limit: config.editionConfig.maxGoldenRuns });
        }
      }
      fields.is_golden = wantGolden;
    }
    if (!Object.keys(fields).length) {
      return reply.code(400).send({ error: "nothing_to_update" });
    }
    await repos.runs.update(id, fields);
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "run.update",
      targetType: "run",
      targetId: id,
      detail: { fields: Object.keys(fields) },
      ip: clientIp(request),
    });
    if (typeof fields.score === "number") {
      await deps.host.runScored({ userId: authUser.user.id, run: existing, score: fields.score, ip: clientIp(request) });
    }
    const run = await repos.runs.getById(id, authUser.user.id);
    return reply.send({ run });
  });

  app.get("/api/runs/golden/export", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const query = request.query as { project?: string; limit?: string };
    const limit = Math.min(5000, Math.max(1, Number(query.limit) || 1000));
    const runs = await repos.runs.listGolden(authUser.user.id, limit, query.project);
    if (!runs.length) {
      return reply.code(400).send({ error: "no_golden_runs" });
    }
    const events = await repos.events.listByRunIds(runs.map((run) => run.id));
    const byRun = new Map<string, Array<{ type: string; message: string }>>();
    for (const event of events) {
      const bucket = byRun.get(event.run_id) ?? [];
      bucket.push({ type: event.type, message: event.message });
      byRun.set(event.run_id, bucket);
    }
    const lines: string[] = [];
    for (const run of runs) {
      const runEvents = byRun.get(run.id) ?? [];
      const response = runEvents.find((event) => event.type === "response")?.message;
      if (!response) {
        continue;
      }
      let messages: unknown = null;
      try {
        const parsed = JSON.parse(run.request_body ?? "") as { messages?: unknown };
        if (Array.isArray(parsed.messages)) {
          messages = parsed.messages;
        }
      } catch {
        messages = null;
      }
      if (!Array.isArray(messages)) {
        const prompt = runEvents.find((event) => event.type === "request" || event.type === "prompt")?.message;
        if (prompt) {
          messages = [{ role: "user", content: prompt }];
        }
      }
      if (!Array.isArray(messages)) {
        continue;
      }
      lines.push(JSON.stringify({ messages: [...messages, { role: "assistant", content: response }] }));
    }
    if (!lines.length) {
      return reply.code(400).send({ error: "no_exportable_golden_runs" });
    }
    reply.header("content-type", "application/jsonl");
    reply.header("content-disposition", `attachment; filename="torrix-golden-${Date.now()}.jsonl"`);
    return reply.send(lines.join("\n"));
  });

  app.post("/api/runs/:id/share", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    if (!(await repos.runs.getById(id, authUser.user.id))) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    const body = (request.body ?? {}) as { expires_in_days?: unknown };
    const days = Number(body.expires_in_days);
    const expiresAt = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().slice(0, 8);
    await repos.runs.update(id, { share_token: token, share_expires_at: expiresAt });
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "run.share",
      targetType: "run",
      targetId: id,
      detail: { expires_at: expiresAt },
      ip: clientIp(request),
    });
    return reply.send({ share_token: token, path: `/share/${token}`, expires_at: expiresAt });
  });

  app.delete("/api/runs/:id/share", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    if (!(await repos.runs.getById(id, authUser.user.id))) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    await repos.runs.update(id, { share_token: null, share_expires_at: null });
    recordAudit(repos, {
      userId: authUser.user.id,
      actor: authUser.keyRecord ? `api_key:${authUser.keyRecord.key_prefix}` : "session",
      action: "run.unshare",
      targetType: "run",
      targetId: id,
      ip: clientIp(request),
    });
    return reply.send({ ok: true });
  });

  app.get("/api/share/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!token || token.length < 16) {
      return reply.code(404).send({ error: "not_found" });
    }
    const run = await repos.runs.getByShareToken(token);
    if (!run) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (run.share_expires_at && Date.parse(run.share_expires_at) < Date.now()) {
      return reply.code(410).send({ error: "share_expired" });
    }
    const events = await repos.events.listByRun(run.id);
    const { user_id, api_key_id, share_token, ...safe } = run;
    void user_id;
    void api_key_id;
    void share_token;
    return reply.send({ run: safe, events });
  });

  app.get("/api/runs/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const run = await repos.runs.getById(id, authUser.user.id);
    if (!run) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    const judgments = await repos.judge.listJudgments(run.id);
    return reply.send({ ...run, judgments });
  });

  app.get("/api/runs/:id/events", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const run = await repos.runs.getById(id, authUser.user.id);
    if (!run) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    const events = await repos.events.listByRun(id);
    return reply.send({ events });
  });

  app.get("/api/stream", { preHandler: authenticate }, async (request, reply) => {
    if (!acquireSseSlot()) {
      return reply.code(503).send({ error: "too_many_streams" });
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(serializeSse({ type: "connected" }));

    const onRun = (run: unknown) => {
      reply.raw.write(serializeSse(run));
    };
    runEmitter.on("run", onRun);

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 25_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      runEmitter.off("run", onRun);
      releaseSseSlot();
    });

    return reply;
  });
}

function parseCsvRows(text: string): Array<{ input: string; expected: string | null; tags: string[] }> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return [];
  }
  const cells = (line: string): string[] => {
    const out: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        out.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    out.push(current);
    return out.map((cellValue) => cellValue.trim());
  };
  const first = cells(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = first[0] === "input" || first.includes("expected");
  const body = hasHeader ? lines.slice(1) : lines;
  const inputIdx = hasHeader ? Math.max(0, first.indexOf("input")) : 0;
  const expectedIdx = hasHeader ? first.indexOf("expected") : 1;
  const tagsIdx = hasHeader ? first.indexOf("tags") : 2;
  return body.map((line) => {
    const parts = cells(line);
    const tagsRaw = tagsIdx >= 0 ? parts[tagsIdx] ?? "" : "";
    return {
      input: parts[inputIdx] ?? "",
      expected: expectedIdx >= 0 && parts[expectedIdx] ? parts[expectedIdx] : null,
      tags: tagsRaw ? tagsRaw.split("|").map((t) => t.trim()).filter(Boolean) : [],
    };
  });
}

function clampDays(value: string | undefined): number {
  return Math.min(90, Math.max(1, Math.floor(Number(value) || 7)));
}

function runQueryOptions(
  q: Record<string, string | undefined>,
  limit: number,
  offset: number,
  fullTextSearch: boolean,
): ListOptions {
  const statusRaw = q.status;
  const status: number | "error" | undefined =
    statusRaw === "error" ? "error" : statusRaw && statusRaw.trim() && Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : undefined;
  const goldenRaw = q.is_golden;
  const isGolden = goldenRaw === "1" || goldenRaw === "true" ? true : goldenRaw === "0" || goldenRaw === "false" ? false : undefined;
  const score = q.score === "good" || q.score === "bad" || q.score === "unscored" ? q.score : undefined;
  return {
    limit,
    offset,
    source: str(q.source),
    model: str(q.model),
    provider: str(q.provider),
    status,
    from: str(q.from),
    to: str(q.to),
    tag: str(q.tag),
    isGolden,
    sessionId: str(q.session),
    traceId: str(q.trace),
    agentName: str(q.agent),
    endUserId: str(q.end_user),
    score,
    reviewState: str(q.review_state),
    search: str(q.q ?? q.search),
    deepSearch: fullTextSearch,
    anomalyOnly: q.anomaly === "1" || q.anomaly === "true",
    sort: str(q.sort),
    dir: q.dir === "asc" ? "asc" : q.dir === "desc" ? "desc" : undefined,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function requestMessages(run: Run): Array<{ role: string; content: unknown }> | null {
  if (!run.request_body) {
    return null;
  }
  const parsed = safeJsonParse(run.request_body);
  const messages = parsed?.messages;
  if (!Array.isArray(messages)) {
    return null;
  }
  return messages.filter((message): message is { role: string; content: unknown } => Boolean(message) && typeof message === "object");
}

function extractPromptText(run: Run, events: Array<{ type: string; message: string }>): string | null {
  const messages = requestMessages(run);
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === "user" && typeof message.content === "string") {
        return message.content;
      }
    }
  }
  return events.find((event) => event.type === "request" || event.type === "prompt")?.message ?? null;
}

function csvCell(value: unknown): string {
  if (value == null) {
    return "";
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildRunsCsv(runs: Run[]): string {
  const columns: Array<keyof Run> = [
    "id", "created_at", "name", "provider", "model", "source", "status", "input_tokens", "output_tokens",
    "thinking_tokens", "cost_usd", "latency_ms", "score", "is_golden", "agent_name", "end_user_id",
    "session_id", "trace_id", "parent_run_id", "tags", "run_note",
  ];
  const header = columns.join(",");
  const rows = runs.map((run) => columns.map((column) => csvCell(run[column])).join(","));
  return [header, ...rows].join("\n");
}

function resolveReplayAuthHeader(target: string): "authorization" | "x-api-key" {
  return detectProvider(target) === "anthropic" ? "x-api-key" : "authorization";
}
