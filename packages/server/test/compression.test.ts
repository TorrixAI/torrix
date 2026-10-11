import { expect, test } from "bun:test";
import { compressRequestBody, normalizeCompressionMode, parseCompressionWords } from "../src/lib/compress";
import { bearer, createTestApp } from "./helpers";

test("compression modes transform text parts and leave structure alone", () => {
  expect(normalizeCompressionMode("balanced")).toBe("balanced");
  expect(normalizeCompressionMode("nonsense")).toBe("off");
  expect(parseCompressionWords("alpha, beta ,, gamma")).toEqual(["alpha", "beta", "gamma"]);

  const body = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are    helpful." },
      { role: "user", content: "Please   tell me about foobar  in detail.\n\n\n\nThanks!" },
    ],
  };

  const off = compressRequestBody(body, "off");
  expect(off.changed).toBe(false);
  expect(off.body).toBe(body);

  const conservative = compressRequestBody(body, "conservative");
  expect(conservative.changed).toBe(true);
  const conservativeMessages = conservative.body.messages as Array<Record<string, unknown>>;
  expect(conservativeMessages[0].content).toBe("You are helpful.");
  expect(String(conservativeMessages[1].content)).toContain("Please tell me about foobar in detail.");

  const balanced = compressRequestBody(body, "balanced", ["foobar"]);
  const balancedMessages = balanced.body.messages as Array<Record<string, unknown>>;
  expect(balancedMessages[1].content).toBe("tell me about in detail.");
  expect(balanced.originalText).toContain("Please");
  expect(balanced.compressedText).not.toContain("Please");
});

test("proxy compresses the forwarded body and keeps the original on the run", async () => {
  let upstreamBody: Record<string, unknown> = {};
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      upstreamBody = (await req.json()) as Record<string, unknown>;
      return Response.json({
        id: "chatcmpl-compress",
        model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 9, completion_tokens: 1 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "compress@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const userId = (await ctx.repos.users.findByEmail("compress@torrix.test"))!.id;
    const project = (await ctx.repos.projects.findDefault(userId))!;
    await ctx.repos.projects.updateCompression(project.id, { prompt_compression: "balanced", compression_words: "foobar" });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer upstream",
      },
      payload: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Please   tell me about foobar  in detail." }],
      },
    });
    expect(res.statusCode).toBe(200);
    const forwarded = upstreamBody.messages as Array<Record<string, unknown>>;
    expect(forwarded[0].content).toBe("tell me about in detail.");

    const runs = await ctx.repos.runs.list(userId, { limit: 5, offset: 0 });
    expect(runs.runs[0].original_request_body).toContain("Please");
    expect(runs.runs[0].original_input_tokens).toBeGreaterThan(0);

    const invalid = await ctx.app.inject({
      method: "PUT",
      url: `/api/cost/project/${project.id}`,
      headers: bearer(key),
      payload: { prompt_compression: "extreme" },
    });
    expect(invalid.statusCode).toBe(400);

    const valid = await ctx.app.inject({
      method: "PUT",
      url: `/api/cost/project/${project.id}`,
      headers: bearer(key),
      payload: { prompt_compression: "conservative", compression_words: "hmm" },
    });
    expect(valid.statusCode).toBe(200);
    const updated = await ctx.repos.projects.findById(project.id);
    expect(updated?.prompt_compression).toBe("conservative");
    expect(updated?.compression_words).toBe("hmm");
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});
