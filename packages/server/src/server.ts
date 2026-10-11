import { loadConfig, type ServerConfig } from "./core/config";
import { openInitialClient } from "./db/manager";
import { sqlAll } from "./db/sql";
import { createRepositories, type Repositories } from "./repos";
import { buildApp } from "./app";
import { ExtensionHost } from "./core/extensionHost";
import type { TorrixExtension } from "./core/extensions";
import type { DbClient } from "./db/client";
import { loadPricingOverrides } from "./lib/pricing";
import { loadStoredPricing, syncLivePricing } from "./lib/pricingSync";
import { loadStoredLicense } from "./lib/license";
import { generateApiKey, hashKey, keyPrefix } from "./lib/auth";
import { buildRunRow, makeEvent } from "./lib/runMapper";
import { runWeeklyDigest } from "./lib/costGate";
import { checkForUpdate } from "./lib/updateCheck";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

export interface StartOptions {
  extensions?: readonly TorrixExtension[];
  env?: NodeJS.ProcessEnv;
}

export async function startServer(options: StartOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? process.env;
  const config = loadConfig(env);

  if (process.argv.includes("--version") || process.argv.includes("-v") || process.argv.includes("version")) {
    console.log(`torrix ${config.version}`);
    process.exit(0);
  }

  const host = new ExtensionHost(options.extensions ?? [], config.license);
  const client = await openInitialClient(config.dbPath, config.databaseUrl, host.migrationSources());

  const repos = createRepositories(client);
  try {
    loadPricingOverrides(await repos.prices.list());
    await loadStoredPricing(repos);
    await loadStoredLicense(repos, config.license, env);
  } catch (err) {
    console.error("failed to load pricing overrides", err);
  }
  if (config.isDemo) {
    try {
      await seedDemoData(repos);
    } catch (err) {
      console.error("demo seed failed", err);
    }
  }
  const deps = { repos, config, env, host };
  const app = await buildApp(deps);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Torrix v${config.version} (${config.edition}) listening on http://localhost:${config.port}`);

  // Watch mode restarts the process on every file change; reopening the browser
  // on each restart would spam tabs, so auto-open only applies to `bun run start`.
  const watching = process.execArgv.includes("--watch") || env._BUN_WATCHER_CHILD === "1";
  if (config.openBrowser && !config.docker && !watching) {
    openBrowser(`http://localhost:${config.port}`);
  }

  startPeriodicTasks(config, client, repos, env);
  host.startPeriodic(deps);
  return app;
}

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : process.platform === "darwin"
          ? ["open", url]
          : ["xdg-open", url];
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // browser open is best-effort
  }
}

function startPeriodicTasks(config: ServerConfig, client: DbClient, repos: Repositories, env: NodeJS.ProcessEnv): void {
  setInterval(async () => {
    try {
      const all = await sqlAll<{ id: string }>(client.engine, "SELECT id FROM users");
      for (const u of all) {
        await repos.runs.deleteOld(u.id, config.editionConfig.retentionDays);
      }
    } catch (err) {
      console.error("retention cleanup failed", err);
    }
  }, 24 * 60 * 60 * 1000);

  setInterval(async () => {
    try {
      const all = await sqlAll<{ id: string }>(client.engine, "SELECT id FROM users");
      for (const u of all) {
        await runWeeklyDigest({ repos }, u.id);
      }
    } catch (err) {
      console.error("weekly digest sweep failed", err);
    }
  }, 60 * 60 * 1000);

  const refreshPricing = async () => {
    try {
      const result = await syncLivePricing(repos);
      if (result.models) {
        console.log(`pricing sync: ${result.models} model prices (${result.source})`);
      }
    } catch (err) {
      console.error("pricing sync failed", err);
    }
  };
  // Downloads public model price lists only; TORRIX_PRICING_SYNC=false keeps the server fully offline.
  if (env.TORRIX_PRICING_SYNC !== "false") {
    setTimeout(refreshPricing, 30_000);
    setInterval(refreshPricing, 24 * 60 * 60 * 1000);
  }

  if (config.updateRepo && env.TORRIX_UPDATE_CHECK !== "false") {
    const updateRepo = config.updateRepo;
    setTimeout(() => void checkForUpdate(repos, updateRepo), 5_000);
    setInterval(() => void checkForUpdate(repos, updateRepo), 24 * 60 * 60 * 1000);
  }

  const runWipe = async () => {
    if (config.edition !== "community") {
      return;
    }
    try {
      const next = await repos.instance.get("next_wipe_at");
      const nextMs = next ? Date.parse(next) : Number.NaN;
      if (!Number.isFinite(nextMs)) {
        await repos.instance.set("next_wipe_at", new Date(Date.now() + 7 * 86_400_000).toISOString());
        return;
      }
      if (nextMs > Date.now()) {
        return;
      }
      const all = await sqlAll<{ id: string }>(client.engine, "SELECT id FROM users");
      let wiped = 0;
      for (const u of all) {
        wiped += await repos.runs.wipe(u.id);
      }
      await repos.instance.set("next_wipe_at", new Date(Date.now() + 7 * 86_400_000).toISOString());
      console.log(`community weekly wipe: removed ${wiped} run(s)`);
    } catch (err) {
      console.error("community weekly wipe failed", err);
    }
  };
  setTimeout(runWipe, 5_000);
  setInterval(runWipe, 60 * 60 * 1000);

  if (config.telemetry) {
    setTimeout(() => void pingTelemetry(repos), 1000);
    setInterval(() => void pingTelemetry(repos), 24 * 60 * 60 * 1000);
  }
}

async function pingTelemetry(repos: Repositories): Promise<void> {
  try {
    let instanceId = await repos.instance.get("instance_id");
    if (!instanceId) {
      instanceId = crypto.randomUUID();
      await repos.instance.set("instance_id", instanceId);
    }
    const os = process.platform;
    const node = process.version ?? "";
    await fetch("https://telemetry.torrix.io/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, os, node }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // fire-and-forget; never affects server
  }
}

async function seedDemoData(repos: Repositories): Promise<void> {
  if ((await repos.users.countUsers()) > 0) {
    return;
  }
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const key = generateApiKey();
  await repos.users.create({
    id: userId,
    email: "demo@torrix.local",
    password: await bcrypt.hash("torrix-demo", 10),
    api_key: hashKey(key),
    is_admin: 1,
    must_change_password: 0,
    created_at: now,
  });
  const projectId = crypto.randomUUID();
  await repos.projects.create({ id: projectId, user_id: userId, name: "Default", created_at: now });
  await repos.apiKeys.create({
    id: crypto.randomUUID(),
    user_id: userId,
    name: "Demo API key",
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
  const agents = ["build", "plan", "explore"];
  for (let i = 0; i < 9; i += 1) {
    const started = new Date(Date.now() - (9 - i) * 60_000).toISOString();
    const run = buildRunRow({
      id: `demo_run_${i}`,
      user_id: userId,
      project_id: projectId,
      name: i === 0 ? "demo conversation" : `demo turn ${i}`,
      provider: "openai",
      model: "gpt-4o-mini",
      status: 200,
      source: "sdk",
      input_tokens: 400 + i * 20,
      output_tokens: 80 + i * 5,
      cost_usd: 0.001 + i * 0.0002,
      latency_ms: 800 + i * 40,
      agent_name: agents[i % agents.length],
      session_id: "demo_session",
      trace_id: i < 3 ? "demo_trace_a" : "demo_trace_b",
      parent_run_id: i >= 3 && i % 3 === 0 ? `demo_run_${i - 3}` : undefined,
      tags: { app: "demo" },
      created_at: started,
    });
    await repos.runs.save(run);
    await repos.events.addMany([
      makeEvent(run.id, "info", "seeded demo run"),
      makeEvent(run.id, "summary", "demo summary"),
    ]);
  }
  console.log("demo mode: seeded demo@torrix.local (password torrix-demo) with 9 sample runs");
}