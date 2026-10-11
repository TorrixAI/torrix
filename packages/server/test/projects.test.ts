import { expect, test } from "bun:test";
import { bearer, createTestApp } from "./helpers";

async function createUser(ctx: Awaited<ReturnType<typeof createTestApp>>, adminKey: string, email: string): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/admin/users",
    headers: bearer(adminKey),
    payload: { email, password: "password123", is_admin: false },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { api_key: string }).api_key;
}

test("projects support CRUD, membership roles and access control", async () => {
  const upstream = Bun.serve({
    port: 0,
    async fetch() {
      return Response.json({
        id: "chatcmpl-projects",
        model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "owner@torrix.test", password: "password123" },
    });
    const ownerKey = (signup.json() as { api_key: string }).api_key;
    const memberKey = await createUser(ctx, ownerKey, "member@torrix.test");
    const strangerKey = await createUser(ctx, ownerKey, "stranger@torrix.test");
    const member = (await ctx.repos.users.findByEmail("member@torrix.test"))!;

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: bearer(ownerKey),
      payload: { name: "Prod" },
    });
    expect(created.statusCode).toBe(201);
    const prodId = (created.json() as { project: { id: string } }).project.id;

    const listed = await ctx.app.inject({ method: "GET", url: "/api/projects", headers: bearer(ownerKey) });
    expect((listed.json() as { projects: Array<{ role: string }> }).projects.some((p) => p.role === "owner")).toBe(true);

    const added = await ctx.app.inject({
      method: "POST",
      url: `/api/projects/${prodId}/members`,
      headers: bearer(ownerKey),
      payload: { email: "member@torrix.test", role: "viewer" },
    });
    expect(added.statusCode).toBe(201);

    const memberList = await ctx.app.inject({ method: "GET", url: "/api/projects", headers: bearer(memberKey) });
    const shared = (memberList.json() as { projects: Array<{ id: string; role: string }> }).projects.find((p) => p.id === prodId);
    expect(shared?.role).toBe("viewer");

    const proxy = (key: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/proxy",
        headers: {
          ...bearer(key),
          "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
          "x-upstream-authorization": "Bearer upstream",
          "x-torrix-project": prodId,
        },
        payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      });

    const viewerWrite = await proxy(memberKey);
    expect(viewerWrite.statusCode).toBe(403);
    expect((viewerWrite.json() as { error: string }).error).toBe("project_read_only");

    const strangerWrite = await proxy(strangerKey);
    expect(strangerWrite.statusCode).toBe(403);
    expect((strangerWrite.json() as { error: string }).error).toBe("project_forbidden");

    const editorAdd = await ctx.app.inject({
      method: "POST",
      url: `/api/projects/${prodId}/members`,
      headers: bearer(memberKey),
      payload: { email: "stranger@torrix.test", role: "viewer" },
    });
    expect(editorAdd.statusCode).toBe(403);

    const promoted = await ctx.app.inject({
      method: "PATCH",
      url: `/api/projects/${prodId}/members/${member.id}`,
      headers: bearer(ownerKey),
      payload: { role: "editor" },
    });
    expect(promoted.statusCode).toBe(200);

    const editorWrite = await proxy(memberKey);
    expect(editorWrite.statusCode).toBe(200);
    const memberRuns = await ctx.repos.runs.list(member.id, { limit: 5, offset: 0 });
    expect(memberRuns.runs[0].project_id).toBe(prodId);

    const runsView = await ctx.app.inject({ method: "GET", url: `/ui/runs?project=${prodId}`, headers: bearer(ownerKey) });
    expect(runsView.statusCode).toBe(200);
    expect(runsView.body).toContain("All projects");

    const removed = await ctx.app.inject({
      method: "DELETE",
      url: `/api/projects/${prodId}/members/${member.id}`,
      headers: bearer(ownerKey),
    });
    expect(removed.statusCode).toBe(200);
    const afterRemoval = await proxy(memberKey);
    expect(afterRemoval.statusCode).toBe(403);
    expect((afterRemoval.json() as { error: string }).error).toBe("project_forbidden");

    const renamed = await ctx.app.inject({
      method: "PATCH",
      url: `/api/projects/${prodId}`,
      headers: bearer(ownerKey),
      payload: { name: "Production" },
    });
    expect(renamed.statusCode).toBe(200);

    const defaultProject = (await ctx.repos.projects.findDefault((await ctx.repos.users.findByEmail("owner@torrix.test"))!.id))!;
    const deleted = await ctx.app.inject({
      method: "DELETE",
      url: `/api/projects/${defaultProject.id}`,
      headers: bearer(ownerKey),
    });
    expect(deleted.statusCode).toBe(200);
    const lastDelete = await ctx.app.inject({
      method: "DELETE",
      url: `/api/projects/${prodId}`,
      headers: bearer(ownerKey),
    });
    expect(lastDelete.statusCode).toBe(400);
    expect((lastDelete.json() as { error: string }).error).toBe("last_project");
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});
