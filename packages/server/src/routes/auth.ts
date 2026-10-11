import type { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { generateApiKey, hashKey, keyPrefix, getUserLimit, authenticateKey, extractBearer, buildAuthCookie } from "../lib/auth";
import { recordAudit, clientIp } from "../lib/audit";
import type { ServerConfig } from "../core/config";
import type { Repositories } from "../repos";

export interface AuthDeps {
  repos: Repositories;
  config: ServerConfig;
  env: NodeJS.ProcessEnv;
}

export async function requireApiKey(deps: AuthDeps, request: { headers: unknown }) {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const key = extractBearer(String(headers.authorization ?? ""));
  if (!key) {
    return null;
  }
  return authenticateKey(deps.repos.db, key);
}

export async function authRoute(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const { repos, config } = deps;

  app.post("/auth/signup", async (request, reply) => {
      const body = (request.body ?? {}) as { email?: string; password?: string };
      const email = normalizeEmail(body.email);
      const password = body.password;

      if (!email || !isEmail(email)) {
        return reply.code(400).send({ error: "invalid_email" });
      }
      if (!password || password.length < 8) {
        return reply.code(400).send({ error: "password_too_short" });
      }

      const limit = getUserLimit(config.editionConfig, deps.env.TORRIX_USER_LIMIT);
      const count = await repos.users.countUsers();
      if (limit !== null && count >= limit) {
        return reply.code(403).send({ error: "user_limit_reached" });
      }

      const existing = await repos.users.findByEmail(email);
      if (existing) {
        return reply.code(409).send({ error: "email_taken" });
      }

      const userId = crypto.randomUUID();
      const now = new Date().toISOString();
      const hash = await bcrypt.hash(password, 10);
      const key = generateApiKey();

      await repos.users.create({
        id: userId,
        email,
        password: hash,
        api_key: hashKey(key),
        is_admin: count === 0 ? 1 : 0,
        must_change_password: 0,
        created_at: now,
      });

      const projectId = crypto.randomUUID();
      await repos.projects.create({ id: projectId, user_id: userId, name: "Default", created_at: now });

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
      });

      return reply.code(201).header("set-cookie", buildAuthCookie(key)).send({ api_key: key });
    },
  );

  app.post("/auth/login", async (request, reply) => {
      const body = (request.body ?? {}) as { email?: string; password?: string };
      const email = normalizeEmail(body.email);
      const password = body.password;

      const user = email ? await repos.users.findByEmail(email) : null;
      if (!user || !password) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      const now = new Date().toISOString();
      const key = generateApiKey();
      await repos.apiKeys.create({
        id: crypto.randomUUID(),
        user_id: user.id,
        name: "Session key",
        key_hash: hashKey(key),
        key_prefix: keyPrefix(key),
        scope: "full",
        projects: null,
        permission: "read_write",
        created_at: now,
        last_used_at: null,
        revoked_at: null,
      });

      return reply.header("set-cookie", buildAuthCookie(key)).send({
        api_key: key,
        must_change_password: user.must_change_password === 1,
      });
    },
  );

  app.put("/auth/change-password", async (request, reply) => {
    const key = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    if (!key) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const auth = await authenticateKey(repos.db, key);
    if (!auth) {
      return reply.code(401).send({ error: "invalid_api_key" });
    }
    const body = (request.body ?? {}) as { current_password?: string; new_password?: string };
    const currentOk = await bcrypt.compare(body.current_password ?? "", auth.user.password);
    if (!currentOk) {
      return reply.code(400).send({ error: "wrong_current_password" });
    }
    if (!body.new_password || body.new_password.length < 8) {
      return reply.code(400).send({ error: "password_too_short" });
    }
    const newHash = await bcrypt.hash(body.new_password, 10);
    await repos.users.changePassword(auth.user.id, newHash, 0);
    return reply.send({ ok: true });
  });
}

function normalizeEmail(email?: string): string | null {
  return email ? email.trim().toLowerCase() : null;
}

function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
