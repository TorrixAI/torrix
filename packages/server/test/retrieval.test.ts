import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession } from "./helpers";

test("proxy captures retrieval docs, strips them from the upstream body, and renders them", async () => {
  let upstreamBody: Record<string, unknown> = {};
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      upstreamBody = (await req.json()) as Record<string, unknown>;
      return Response.json({
        id: "chatcmpl-rag",
        object: "chat.completion",
        model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "Grounded answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "rag@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const proxied = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer upstream",
      },
      payload: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "What is the refund window?" }],
        retrieval_docs: [
          { id: "doc-1", source: "policy.md", score: 0.92, text: "Refunds are accepted within 14 days." },
          { id: "doc-2", url: "https://kb.example/returns", score: 0.81, text: "Digital goods refunds differ." },
        ],
      },
    });
    expect(proxied.statusCode).toBe(200);
    expect("retrieval_docs" in upstreamBody).toBe(false);

    const listed = await ctx.app.inject({ method: "GET", url: "/api/runs?source=proxy", headers: bearer(key) });
    const runs = (listed.json() as { runs: Run[] }).runs;
    expect(runs).toHaveLength(1);
    const stored = JSON.parse(runs[0].retrieval_docs ?? "[]") as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(2);
    expect(stored[0].source).toBe("policy.md");

    const detail = await ctx.app.inject({ method: "GET", url: `/ui/runs/${runs[0].id}`, headers: bearer(key) });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain("Retrieved context");
    expect(detail.body).toContain("Refunds are accepted within 14 days.");
    expect(detail.body).toContain("policy.md");
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("proxy also accepts retrieval docs via header", async () => {
  const upstream = Bun.serve({
    port: 0,
    async fetch() {
      return Response.json({
        id: "chatcmpl-rag2",
        model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "rag2@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer upstream",
        "x-torrix-retrieval-docs": JSON.stringify([{ text: "Header chunk" }]),
      },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });
    const listed = await ctx.app.inject({ method: "GET", url: "/api/runs?source=proxy", headers: bearer(key) });
    const runs = (listed.json() as { runs: Run[] }).runs;
    expect(JSON.parse(runs[0].retrieval_docs ?? "[]")).toHaveLength(1);
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("ingest stores retrieval docs and strips them from the logged body", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const now = new Date().toISOString();
    await ctx.repos.projects.create({ id: crypto.randomUUID(), user_id: session.user.id, name: "Default", created_at: now });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(session.key),
      payload: {
        records: [
          {
            model: "gpt-4o",
            request: {
              body: {
                messages: [{ role: "user", content: "hello" }],
                retrieval_docs: [{ text: "chunk from body", source: "kb" }],
              },
            },
            response: { body: { choices: [{ message: { content: "hi" } }] } },
          },
          {
            model: "gpt-4o-mini",
            retrieval_docs: [{ text: "explicit chunk", source: "wiki" }],
            request: { body: { messages: [{ role: "user", content: "second" }] } },
            response: { body: { choices: [{ message: { content: "ok" } }] } },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const runs = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 });
    expect(runs.runs).toHaveLength(2);
    const byModel = new Map(runs.runs.map((r) => [r.model, r]));
    expect(JSON.parse(byModel.get("gpt-4o")!.retrieval_docs ?? "[]")[0].text).toBe("chunk from body");
    expect(JSON.parse(byModel.get("gpt-4o-mini")!.retrieval_docs ?? "[]")[0].text).toBe("explicit chunk");
    expect(byModel.get("gpt-4o")!.request_body ?? "").not.toContain("retrieval_docs");

    const detail = await ctx.app.inject({
      method: "GET",
      url: `/ui/runs/${byModel.get("gpt-4o-mini")!.id}`,
      headers: bearer(session.key),
    });
    expect(detail.body).toContain("Retrieved context");
    expect(detail.body).toContain("explicit chunk");
  } finally {
    await ctx.cleanup();
  }
});
