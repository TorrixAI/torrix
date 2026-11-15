import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { BRAND_ASSET_PATHS, FONT_PATHS } from "../assets/files";
import type { ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import type { Repositories } from "../repos";
import { authenticateKey, readAuthCookie, buildAuthCookie, clearAuthCookie, extractBearer } from "../lib/auth";
import type { AuthResult } from "../core/domain";

export interface UiDeps {
  repos: Repositories;
  config: ServerConfig;
  env: NodeJS.ProcessEnv;
  host?: ExtensionHost;
}


const PROJECT_COOKIE = "torrix_project";

/** Reads the sticky project scope cookie; empty string when unset. */
export function readProjectCookie(headers: unknown): string {
  const raw = String((headers as Record<string, unknown>).cookie ?? "");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === PROJECT_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return "";
}

export function buildProjectCookie(value: string): string {
  return `${PROJECT_COOKIE}=${encodeURIComponent(value)}; SameSite=Lax; Path=/; Max-Age=31536000`;
}

export function clearProjectCookie(): string {
  return `${PROJECT_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0`;
}

export interface ProjectScope {
  projectId: string | undefined;
  setCookie: string | null;
  clearCookie: boolean;
}

/**
 * The effective project: an explicit `?project=` wins (`?project=` with no value means all
 * projects), otherwise the sticky cookie applies, so the SPA selector and direct API calls
 * resolve to the same scope.
 */
export async function resolveProjectScope(
  request: FastifyRequest,
  repos: Repositories,
  userId: string,
): Promise<ProjectScope> {
  const q = request.query as { project?: string };
  const cookieValue = readProjectCookie(request.headers);
  if (q.project !== undefined) {
    const wanted = q.project ?? "";
    if (!wanted) {
      return { projectId: undefined, setCookie: null, clearCookie: cookieValue !== "" };
    }
    const allowed = await repos.projects.roleFor(userId, wanted);
    if (!allowed) {
      return { projectId: undefined, setCookie: null, clearCookie: false };
    }
    return { projectId: wanted, setCookie: wanted !== cookieValue ? wanted : null, clearCookie: false };
  }
  if (!cookieValue) {
    return { projectId: undefined, setCookie: null, clearCookie: false };
  }
  const allowed = await repos.projects.roleFor(userId, cookieValue);
  return { projectId: allowed ? cookieValue : undefined, setCookie: null, clearCookie: false };
}

export function applyProjectScope(reply: FastifyReply, scope: ProjectScope): void {
  if (scope.setCookie) {
    reply.header("set-cookie", buildProjectCookie(scope.setCookie));
  } else if (scope.clearCookie) {
    reply.header("set-cookie", clearProjectCookie());
  }
}

// The build directory, in the three places it can live: an explicit path, the
// folder beside a compiled binary, or the source tree during development.
function reactDistDir(): string {
  const configured = process.env.TORRIX_WEB_DIST;
  if (configured) {
    return path.resolve(configured);
  }
  // Release archives unpack the console into `torrix-web/`; images use `web/`.
  for (const name of ["torrix-web", "web"]) {
    const besideBinary = path.join(path.dirname(process.execPath), name);
    if (fs.existsSync(path.join(besideBinary, "index.html"))) {
      return besideBinary;
    }
  }
  return path.join(import.meta.dir, "../../../web/dist");
}

// The console is a React SPA: every console route serves its build. When the
// build is absent the console cannot render, so the fallback explains how to
// produce it instead of keeping a second implementation of the same pages.
const UNBUILT_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f6f6f4"><meta name="robots" content="noindex,nofollow">
<link rel="icon" type="image/svg+xml" href="/ui/assets/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/ui/assets/favicon-32.png"><link rel="apple-touch-icon" sizes="180x180" href="/ui/assets/apple-touch-icon.png">
<title>Torrix Â· AI Observability</title></head>
<body><div id="root"></div><main style="font:14px/1.6 system-ui;max-width:560px;margin:64px auto;padding:0 24px">
<h1 style="font-size:20px;margin:0 0 8px">The Torrix console is not built on this host</h1>
<p style="color:#475569">Run <code>bun run build</code> at the repository root, or use the published image, to serve the web console.</p>
</main></body></html>`;

export async function readSpaHtml(): Promise<string> {
  const index = Bun.file(path.join(reactDistDir(), "index.html"));
  return (await index.exists()) ? index.text() : UNBUILT_HTML;
}

export async function sendReactApp(reply: FastifyReply): Promise<FastifyReply> {
  reply.header("cache-control", "no-cache").type("text/html");
  return reply.send(await readSpaHtml());
}

function safeJsonArray(raw: string | null | undefined): Array<Record<string, unknown>> {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

export async function uiRoute(app: FastifyInstance, deps: UiDeps): Promise<void> {
  const { repos, config } = deps;

  app.get("/assets/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!/^[a-zA-Z0-9._-]+$/.test(file)) return reply.code(404).send({ error: "not_found" });
    const asset = Bun.file(path.join(reactDistDir(), "assets", file));
    if (!(await asset.exists())) return reply.code(404).send({ error: "not_found" });
    reply.header("cache-control", "public, max-age=31536000, immutable");
    if (file.endsWith(".js")) reply.type("application/javascript");
    else if (file.endsWith(".css")) reply.type("text/css");
    else if (file.endsWith(".svg")) reply.type("image/svg+xml");
    else if (file.endsWith(".woff2")) reply.type("font/woff2");
    return reply.send(Buffer.from(await asset.arrayBuffer()));
  });

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
      return reply.redirect("/ui/login");
    }
    (request as unknown as { auth: AuthResult }).auth = auth;
  };

  app.get("/", async (_request, reply) => reply.redirect("/ui/dashboard"));

  for (const [file, asset] of Object.entries(BRAND_ASSET_PATHS)) {
    app.get(`/ui/assets/${file}`, async (_request, reply) => {
      const source = Bun.file(asset.path);
      if (!(await source.exists())) {
        return reply.code(404).send({ error: "not_found" });
      }
      reply.header("cache-control", "public, max-age=86400").type(asset.type);
      return reply.send(Buffer.from(await source.arrayBuffer()));
    });
  }

  // Completes the OIDC redirect: sets the session cookie, seeds the client key
  // and hands off to the SPA.
  app.get("/ui/sso-complete", async (request, reply) => {
    const q = request.query as { key?: string; token?: string };
    const key = (q.key ?? q.token ?? "").trim();
    const auth = key ? await authenticateKey(repos.db, key) : null;
    if (!auth) {
      return reply.redirect("/ui/login");
    }
    reply.header("set-cookie", buildAuthCookie(key));
    reply.type("text/html").send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/ui/assets/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/ui/assets/favicon-32.png"><link rel="apple-touch-icon" sizes="180x180" href="/ui/assets/apple-touch-icon.png">
<title>Signing in Â· Torrix</title></head>
<body><main style="font:14px system-ui;padding:48px">Signing you inâ€¦<script>try{localStorage.setItem("torrix_key",${JSON.stringify(key)})}catch(e){}location.replace("/ui/dashboard")</script></main></body></html>`);
    return reply;
  });

  app.post("/ui/session", async (request, reply) => {
    const body = (request.body ?? {}) as { api_key?: string };
    const key = typeof body.api_key === "string" ? body.api_key.trim() : "";
    if (!key) {
      return reply.code(400).send({ error: "missing_api_key" });
    }
    const auth = await authenticateKey(repos.db, key);
    if (!auth) {
      return reply.code(401).send({ error: "invalid_api_key" });
    }
    reply.header("set-cookie", buildAuthCookie(key));
    return reply.send({ ok: true });
  });

  app.get("/ui/logout", async (request, reply) => {
    // End this browser's session key too; a manual key used via /ui/session
    // must survive sign-out.
    const key = readAuthCookie(request.headers);
    if (key) {
      const auth = await authenticateKey(repos.db, key);
      if (Number(auth?.keyRecord?.session) === 1 && auth?.keyRecord?.id) {
        await repos.apiKeys.revoke(auth.keyRecord.id);
      }
    }
    reply.header("set-cookie", clearAuthCookie());
    return reply.redirect("/ui/login");
  });

  app.get("/ui/fonts/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    const fontPath = FONT_PATHS[file];
    if (!fontPath) {
      return reply.code(404).send({ error: "not_found" });
    }
    const font = Bun.file(fontPath);
    if (!(await font.exists())) {
      return reply.code(404).send({ error: "not_found" });
    }
    reply.header("cache-control", "public, max-age=31536000, immutable").type("font/woff2");
    return reply.send(Buffer.from(await font.arrayBuffer()));
  });

  const spa = (_request: FastifyRequest, reply: FastifyReply) => sendReactApp(reply);
  const authed = { preHandler: authenticate };

  // Public surfaces (no session yet).
  app.get("/ui/login", spa);
  app.get("/share/:token", spa);

  // Console pages: the SPA owns routing, so every path serves the same build.
  for (const url of [
    "/ui/dashboard",
    "/ui/analytics",
    "/ui/live",
    "/ui/team",
    "/ui/runs",
    "/ui/compare",
    "/ui/query",
    "/ui/insights",
    "/ui/traces",
    "/ui/prompts",
    "/ui/datasets",
    "/ui/playground",
    "/ui/settings",
    "/ui/cost",
    "/ui/keys",
    "/ui/projects",
    "/ui/governance",
    "/ui/compliance",
    "/ui/locked/:feature",
  ]) {
    app.get(url, authed, spa);
  }

  // Agent control plane pages. `/ui/agents` and `/ui/agents/observed` come from
  // core agentsRoute (the registry redirects to observed without the extension).
  for (const url of [
    "/ui/agents/delegations",
    "/ui/agents/policies",
    "/ui/agents/approvals",
    "/ui/agents/mcp",
    "/ui/agents/settings",
    "/ui/agents/graph",
    "/ui/agents/activity",
  ]) {
    app.get(url, authed, spa);
  }
  if (deps.host?.installed("agent-control")) {
    app.get("/ui/agents", authed, spa);
  }

  // Parametrised console pages.
  app.get("/ui/agents/:id", authed, spa);
  app.get("/ui/agents/activity/:id", authed, spa);
  app.get("/ui/runs/:id", authed, spa);
  app.get("/ui/traces/:id", authed, spa);
  app.get("/ui/sessions/:id", authed, spa);
  app.get("/ui/prompts/:id", authed, spa);
  app.get("/ui/datasets/:id", authed, spa);

  // Media bytes are streamed from disk, not the SPA.
  app.get("/ui/runs/:id/media/:index", authed, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id, index } = request.params as { id: string; index: string };
    const run = await repos.runs.getById(id, authUser.user.id);
    if (!run) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    const asset = safeJsonArray(run.media_assets)[Number(index)];
    if (!asset) {
      return reply.code(404).send({ error: "media_not_found" });
    }
    const stored = asset.stored_path != null ? path.basename(String(asset.stored_path)) : "";
    if (!stored) {
      const ref = String(asset.ref ?? "");
      if (/^https?:\/\//i.test(ref)) {
        return reply.redirect(ref);
      }
      return reply.code(404).send({ error: "media_not_stored" });
    }
    const file = Bun.file(path.join(config.mediaDir, stored));
    if (!(await file.exists())) {
      return reply.code(404).send({ error: "media_file_missing" });
    }
    const mime = asset.mime != null ? String(asset.mime) : "application/octet-stream";
    reply.header("cache-control", "private, max-age=3600").type(mime);
    return reply.send(Buffer.from(await file.arrayBuffer()));
  });
}
