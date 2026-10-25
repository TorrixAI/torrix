import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config";
import type { Repositories } from "../repos";
import { extractBearer, authenticateKey } from "../lib/auth";
import { recordAudit, clientIp } from "../lib/audit";
import { PII_TYPES, parsePiiTypes } from "../lib/pii";
import type { AuthResult, GovernanceSettings } from "../core/domain";

export interface GovernanceRouteDeps {
  repos: Repositories;
  config: ServerConfig;
}

export async function governanceRoute(app: FastifyInstance, deps: GovernanceRouteDeps): Promise<void> {
  const { repos } = deps;

  const authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthResult | null> = async (
    request,
    reply,
  ) => {
    const key = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    const auth = key ? await authenticateKey(repos.db, key) : null;
    if (!auth) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    (request as unknown as { auth: AuthResult }).auth = auth;
    return auth;
  };

  const requireUser = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthResult | null> => {
    const auth = await authenticate(request, reply);
    if (!auth) {
      return null;
    }
    return auth;
  };

  const activeFlag = (value: unknown): number =>
    value == null || value === false || value === 0 || value === "0" || value === "false" ? 0 : 1;


  // ---------------------------------------------------------------- settings

  app.get("/api/governance/settings", { preHandler: requireUser }, async (request, reply) => {
    const auth = (request as unknown as { auth: AuthResult }).auth;
    const settings = await repos.governance.getSettings(auth.user.id);
    return reply.send({ settings, availableTypes: PII_TYPES });
  });

  app.put("/api/governance/settings", { preHandler: requireUser }, async (request, reply) => {
    const auth = (request as unknown as { auth: AuthResult }).auth;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const current = await repos.governance.getSettings(auth.user.id);
    const fields: Partial<GovernanceSettings> = {};

    if ("pii_enabled" in body) fields.pii_enabled = activeFlag(body.pii_enabled);
    if ("pii_mask_input" in body) fields.pii_mask_input = activeFlag(body.pii_mask_input);
    if ("pii_mask_output" in body) fields.pii_mask_output = activeFlag(body.pii_mask_output);
    if ("human_review_enabled" in body) fields.human_review_enabled = activeFlag(body.human_review_enabled);
    if ("audit_enabled" in body) fields.audit_enabled = activeFlag(body.audit_enabled);
    if (typeof body.pii_placeholder === "string") {
      const ph = body.pii_placeholder.slice(0, 24);
      fields.pii_placeholder = ph || "[redacted]";
    }
    if (Array.isArray(body.pii_types)) {
      const types = (body.pii_types as unknown[])
        .filter((t): t is string => typeof t === "string" && (PII_TYPES as string[]).includes(t));
      fields.pii_types = JSON.stringify(types);
    }
    if (fields.pii_mask_output && fields.pii_enabled === 0) {
      fields.pii_enabled = 1;
    }
    // The stored row keeps the effective selection; carrying it over stops a
    // fresh row from falling back to the empty database default.
    if (fields.pii_enabled === 1 && !("pii_types" in fields)) {
      fields.pii_types = current.pii_types;
    }
    // Fail closed: switching masking on without a type selection would store
    // everything while looking protected, so persist every known type.
    const enabledNow = fields.pii_enabled ?? current.pii_enabled;
    const typesNow = "pii_types" in fields ? parsePiiTypes(fields.pii_types ?? "[]") : parsePiiTypes(current.pii_types);
    if (enabledNow && !typesNow.length) {
      fields.pii_types = JSON.stringify(PII_TYPES);
    }
    fields.updated_at = new Date().toISOString();
    await repos.governance.updateSettings(auth.user.id, fields);
    recordAudit(repos, {
      userId: auth.user.id,
      actor: auth.keyRecord ? `api_key:${auth.keyRecord.key_prefix}` : "ui",
      action: "governance.settings.update",
      targetType: "governance_settings",
      targetId: auth.user.id,
      detail: { fields: Object.keys(fields).filter((k) => k !== "updated_at") },
      ip: clientIp(request),
    });
    const settings = await repos.governance.getSettings(auth.user.id);
    return reply.send({ settings });
  });

  app.get("/api/compliance/pii-types", { preHandler: requireUser }, async (request, reply) => {
    const auth = (request as unknown as { auth: AuthResult }).auth;
    const settings = await repos.governance.getSettings(auth.user.id);
    return reply.send({ types: PII_TYPES, configured: parsePiiTypes(settings.pii_types) });
  });
}
