import { expect, test } from "bun:test";
import { bearer, createTestApp } from "./helpers";

const credentials = (email: string) => ({ email, password: "a-long-password" });

test("the first account can always sign up, later ones cannot unless the operator opts in", async () => {
  const ctx = await createTestApp({ TORRIX_ALLOW_SIGNUP: "false" });
  try {
    const first = await ctx.app.inject({ method: "POST", url: "/auth/signup", payload: credentials("admin@example.org") });
    expect(first.statusCode).toBe(201);
    expect((first.json() as { api_key: string }).api_key).toMatch(/^trxk_/);

    const stranger = await ctx.app.inject({ method: "POST", url: "/auth/signup", payload: credentials("stranger@example.org") });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json()).toMatchObject({ error: "signup_closed" });
    expect(await ctx.repos.users.countUsers()).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

test("an administrator can still add people, and open sign-up can be turned on", async () => {
  const closed = await createTestApp({ TORRIX_ALLOW_SIGNUP: "false" });
  try {
    const first = await closed.app.inject({ method: "POST", url: "/auth/signup", payload: credentials("admin@example.org") });
    const key = (first.json() as { api_key: string }).api_key;
    const created = await closed.app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: bearer(key),
      payload: { email: "teammate@example.org", password: "another-password" },
    });
    expect(created.statusCode).toBe(201);
  } finally {
    await closed.cleanup();
  }

  const open = await createTestApp({ TORRIX_ALLOW_SIGNUP: "true" });
  try {
    expect((await open.app.inject({ method: "POST", url: "/auth/signup", payload: credentials("a@example.org") })).statusCode).toBe(201);
    expect((await open.app.inject({ method: "POST", url: "/auth/signup", payload: credentials("b@example.org") })).statusCode).toBe(201);
  } finally {
    await open.cleanup();
  }
});

test("the login page hides account creation once an account exists", async () => {
  const ctx = await createTestApp({ TORRIX_ALLOW_SIGNUP: "false" });
  try {
    const before = await ctx.app.inject({ method: "GET", url: "/ui/login" });
    expect(before.body).not.toContain('id="tabSignup" style="display:none"');
    expect(before.body).not.toContain("created by an administrator");

    await ctx.app.inject({ method: "POST", url: "/auth/signup", payload: credentials("admin@example.org") });
    const after = await ctx.app.inject({ method: "GET", url: "/ui/login" });
    expect(after.body).toContain('id="tabSignup" style="display:none"');
    expect(after.body).toContain("New accounts are created by an administrator.");
  } finally {
    await ctx.cleanup();
  }
});

test("the production default is closed", async () => {
  const { loadConfig } = await import("../src/core/config");
  expect(loadConfig({}).allowSignup).toBe(false);
  expect(loadConfig({ TORRIX_ALLOW_SIGNUP: "true" }).allowSignup).toBe(true);
});
