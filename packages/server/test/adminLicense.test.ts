import { expect, test } from "bun:test";
import { bearer, createTestApp, licenseSigner, seedSession } from "./helpers";

async function adminKey(ctx: Awaited<ReturnType<typeof createTestApp>>, email: string): Promise<string> {
  const signup = await ctx.app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { email, password: "password123" },
  });
  return (signup.json() as { api_key: string }).api_key;
}

test("admin user management lists, creates, promotes and deletes users", async () => {
  const ctx = await createTestApp();
  try {
    const key = await adminKey(ctx, "root@torrix.test");

    const listed = await ctx.app.inject({ method: "GET", url: "/api/admin/users", headers: bearer(key) });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { users: unknown[] }).users).toHaveLength(1);

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: bearer(key),
      payload: { email: "member@torrix.test", password: "password123", is_admin: false },
    });
    expect(created.statusCode).toBe(201);
    const memberKey = (created.json() as { api_key: string }).api_key;
    expect(memberKey).toStartWith("trxk_");

    const member = await ctx.repos.users.findByEmail("member@torrix.test");
    expect(member?.is_admin).toBe(0);

    const promoted = await ctx.app.inject({
      method: "PATCH",
      url: `/api/admin/users/${member!.id}`,
      headers: bearer(key),
      payload: { is_admin: true },
    });
    expect(promoted.statusCode).toBe(200);
    expect((await ctx.repos.users.findById(member!.id))?.is_admin).toBe(1);

    const demoted = await ctx.app.inject({
      method: "PATCH",
      url: `/api/admin/users/${member!.id}`,
      headers: bearer(key),
      payload: { is_admin: false },
    });
    expect(demoted.statusCode).toBe(200);

    const self = await ctx.repos.users.findByEmail("root@torrix.test");
    const deleteSelf = await ctx.app.inject({
      method: "DELETE",
      url: `/api/admin/users/${self!.id}`,
      headers: bearer(key),
    });
    expect(deleteSelf.statusCode).toBe(400);

    const deleted = await ctx.app.inject({
      method: "DELETE",
      url: `/api/admin/users/${member!.id}`,
      headers: bearer(key),
    });
    expect(deleted.statusCode).toBe(200);
    expect(await ctx.repos.users.findById(member!.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
}, 20_000);

test("admin backup returns a consistent SQLite file", async () => {
  const ctx = await createTestApp();
  try {
    const key = await adminKey(ctx, "backup@torrix.test");
    const res = await ctx.app.inject({ method: "GET", url: "/api/admin/backup", headers: bearer(key) });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("application/octet-stream");
    expect(res.rawPayload.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
  } finally {
    await ctx.cleanup();
  }
});

test("license activation switches edition and deactivation returns to community", async () => {
  const signer = await licenseSigner("test");
  const ctx = await createTestApp({}, { trustedKeys: [signer.trusted] });
  try {
    const key = await adminKey(ctx, "license@torrix.test");
    const license = await signer.sign({ edition: "enterprise", licensee: "Acme", expires_at: "2099-01-01T00:00:00.000Z" });

    const before = await ctx.app.inject({ method: "GET", url: "/api/config", headers: bearer(key) });
    expect((before.json() as { edition: string }).edition).toBe("community");

    const activated = await ctx.app.inject({
      method: "POST",
      url: "/api/license",
      headers: bearer(key),
      payload: { key: license },
    });
    expect(activated.statusCode).toBe(200);
    expect((activated.json() as { edition: string }).edition).toBe("enterprise");

    const after = await ctx.app.inject({ method: "GET", url: "/api/config", headers: bearer(key) });
    expect((after.json() as { edition: string }).edition).toBe("enterprise");

    const info = await ctx.app.inject({ method: "GET", url: "/api/license", headers: bearer(key) });
    expect(info.json()).toMatchObject({ source: "license", licensee: "Acme" });

    const invalid = await ctx.app.inject({
      method: "POST",
      url: "/api/license",
      headers: bearer(key),
      payload: { key: "not.a.license" },
    });
    expect(invalid.statusCode).toBe(400);

    const deactivated = await ctx.app.inject({ method: "DELETE", url: "/api/license", headers: bearer(key) });
    expect(deactivated.statusCode).toBe(200);
    expect((deactivated.json() as { edition: string }).edition).toBe("community");
  } finally {
    await ctx.cleanup();
  }
});

test("demo mode blocks writes but keeps reads and login available", async () => {
  const ctx = await createTestApp({ IS_DEMO: "true" });
  try {
    const session = await seedSession(ctx);
    const write = await ctx.app.inject({
      method: "POST",
      url: "/api/keys",
      headers: bearer(session.key),
      payload: { name: "nope" },
    });
    expect(write.statusCode).toBe(403);
    expect((write.json() as { error: string }).error).toBe("demo_read_only");

    const read = await ctx.app.inject({ method: "GET", url: "/api/config", headers: bearer(session.key) });
    expect(read.statusCode).toBe(200);

    const login = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@torrix.test", password: "password123" },
    });
    expect(login.statusCode).not.toBe(403);
  } finally {
    await ctx.cleanup();
  }
});

test("settings permissions reports the allowed tabs", async () => {
  const ctx = await createTestApp();
  try {
    const key = await adminKey(ctx, "perms@torrix.test");
    const res = await ctx.app.inject({ method: "GET", url: "/api/settings/permissions", headers: bearer(key) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tabs: string[]; is_admin: boolean; edition: string };
    expect(body.tabs).toContain("database");
    expect(body.tabs).toContain("users");
    expect(body.is_admin).toBe(true);
    expect(body.edition).toBe("community");
  } finally {
    await ctx.cleanup();
  }
});


test("a license on the Community build is accepted with a plain notice that the paid features are missing", async () => {
  const signer = await licenseSigner("notice");
  const ctx = await createTestApp({}, { trustedKeys: [signer.trusted] });
  try {
    const key = await adminKey(ctx, "notice@torrix.test");

    const before = (await ctx.app.inject({ method: "GET", url: "/api/license", headers: bearer(key) })).json() as { notice: string | null; paid_build: boolean };
    expect(before.paid_build).toBe(false);
    expect(before.notice).toBeNull();

    const license = await signer.sign({ edition: "pro", licensee: "Acme", expires_at: "2099-01-01T00:00:00.000Z" });
    const activated = (await ctx.app.inject({ method: "POST", url: "/api/license", headers: bearer(key), payload: { key: license } })).json() as {
      ok: boolean;
      edition: string;
      notice: string | null;
      paid_build: boolean;
    };
    expect(activated).toMatchObject({ ok: true, edition: "pro", paid_build: false });
    expect(activated.notice).toContain("Pro license is active");
    expect(activated.notice).toContain("does not include Pro features");
    expect(activated.notice).toContain("keep your data volume and license key");
    expect(activated.notice).not.toContain("—");

    const info = (await ctx.app.inject({ method: "GET", url: "/api/license", headers: bearer(key) })).json() as { notice: string | null };
    expect(info.notice).toBe(activated.notice);

    const enterprise = await signer.sign({ edition: "enterprise", expires_at: "2099-01-01T00:00:00.000Z" });
    const upgraded = (await ctx.app.inject({ method: "POST", url: "/api/license", headers: bearer(key), payload: { key: enterprise } })).json() as { notice: string };
    expect(upgraded.notice).toContain("Enterprise license is active");

    await ctx.app.inject({ method: "DELETE", url: "/api/license", headers: bearer(key) });
    const cleared = (await ctx.app.inject({ method: "GET", url: "/api/license", headers: bearer(key) })).json() as { notice: string | null };
    expect(cleared.notice).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

test("pages that upsell stop asking a licensed Community build to activate a license", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const agents = await ctx.app.inject({ method: "GET", url: "/ui/agents/observed", headers: bearer(session.key) });
    expect(agents.body).toContain("Activate a license");
    expect(agents.body).not.toContain("Your Pro license is active");
    const governance = await ctx.app.inject({ method: "GET", url: "/ui/governance", headers: bearer(session.key) });
    expect(governance.body).toContain("See what Pro adds");
    expect(governance.body).not.toContain("How to switch");

    ctx.config.license.override("pro");
    const licensedAgents = await ctx.app.inject({ method: "GET", url: "/ui/agents/observed", headers: bearer(session.key) });
    expect(licensedAgents.body).toContain("Your Pro license is active, but this server runs the Community build.");
    expect(licensedAgents.body).toContain("keep your data volume and license key");
    expect(licensedAgents.body).toContain("How to switch");
    expect(licensedAgents.body).not.toContain("Activate a license");
    expect(licensedAgents.body).not.toContain("—");
    const licensedGovernance = await ctx.app.inject({ method: "GET", url: "/ui/governance", headers: bearer(session.key) });
    expect(licensedGovernance.body).toContain("Included in your Pro license");
    expect(licensedGovernance.body).toContain("How to switch");
  } finally {
    await ctx.cleanup();
  }
});
