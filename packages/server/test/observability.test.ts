import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession } from "./helpers";

test("ingest stores the agent_id link on captured runs", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const now = new Date().toISOString();
    await ctx.repos.projects.create({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      name: "Default",
      created_at: now,
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(session.key),
      payload: {
        records: [
          {
            agent_id: "agent-observability-test",
            model: "gpt-4o",
            request: { body: { messages: [{ role: "user", content: "hello" }] } },
            response: { body: { choices: [{ message: { content: "hi" } }] } },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const runs = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 });
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0].agent_id).toBe("agent-observability-test");
  } finally {
    await ctx.cleanup();
  }
});
