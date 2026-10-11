import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Run } from "../src/core/domain";
import { extractMedia } from "../src/lib/extract";
import { bearer, createTestApp, seedSession } from "./helpers";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const WAV_TINY = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

function tempMediaDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "torrix-media-"));
}

test("extractMedia finds image, audio and remote parts across providers", () => {
  const openai = extractMedia(
    {
      messages: [
        { role: "system", content: "you are helpful" },
        {
          role: "user",
          content: [
            { type: "text", text: "what is in these?" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
            { type: "image_url", image_url: { url: "https://img.example/photo.jpg" } },
            { type: "input_audio", input_audio: { data: WAV_TINY, format: "wav" } },
          ],
        },
      ],
    },
    "openai",
  );
  expect(openai).toHaveLength(3);
  expect(openai[0]).toMatchObject({ kind: "image", mime: "image/png", source: "data" });
  expect(openai[0].bytes).toBeGreaterThan(40);
  expect(openai[1]).toMatchObject({ kind: "image", source: "url" });
  expect(openai[2]).toMatchObject({ kind: "audio", mime: "audio/wav", source: "base64" });
  expect(openai[2].bytes).toBeGreaterThan(20);

  const anthropic = extractMedia(
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1PX } },
          ],
        },
      ],
    },
    "anthropic",
  );
  expect(anthropic).toHaveLength(1);
  expect(anthropic[0]).toMatchObject({ kind: "image", mime: "image/png", source: "base64" });

  const gemini = extractMedia(
    { contents: [{ role: "user", parts: [{ text: "hi" }, { inlineData: { mimeType: "audio/ogg", data: WAV_TINY } }] }] },
    "gemini",
  );
  expect(gemini).toHaveLength(1);
  expect(gemini[0]).toMatchObject({ kind: "audio", mime: "audio/ogg" });
});

test("proxy persists inline media to disk and records assets on the run", async () => {
  const mediaDir = tempMediaDir();
  const upstream = Bun.serve({
    port: 0,
    async fetch() {
      return Response.json({
        id: "chatcmpl-media",
        model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "a dot" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 50, completion_tokens: 3, total_tokens: 53 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}`, TORRIX_MEDIA_DIR: mediaDir });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "media@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
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
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe this" },
              { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
              { type: "image_url", image_url: { url: "https://img.example/photo.jpg" } },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const runs = await ctx.repos.runs.list((await ctx.repos.users.findByEmail("media@torrix.test"))!.id, { limit: 5, offset: 0 });
    const run = runs.runs[0] as Run;
    expect(run.media_count).toBe(2);
    const assets = JSON.parse(run.media_assets ?? "[]") as Array<Record<string, unknown>>;
    expect(assets).toHaveLength(2);
    expect(String(assets[0].sha256)).toHaveLength(64);
    const stored = String(assets[0].stored_path ?? "");
    expect(stored.endsWith(".png")).toBe(true);
    expect(fs.existsSync(path.join(mediaDir, stored))).toBe(true);
    expect(fs.readFileSync(path.join(mediaDir, stored)).length).toBeGreaterThan(40);
    expect(assets[1].stored_path).toBeUndefined();
    expect(String(assets[1].ref)).toContain("img.example");

    const detail = await ctx.app.inject({ method: "GET", url: `/ui/runs/${run.id}`, headers: bearer(key) });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain("Media assets");
    expect(detail.body).toContain("image/png");
    expect(detail.body).toContain(`/ui/runs/${run.id}/media/0`);

    const bytes = await ctx.app.inject({ method: "GET", url: `/ui/runs/${run.id}/media/0`, headers: bearer(key) });
    expect(bytes.statusCode).toBe(200);
    expect(String(bytes.headers["content-type"])).toContain("image/png");
    expect(bytes.rawPayload.length).toBeGreaterThan(40);
    const missing = await ctx.app.inject({ method: "GET", url: `/ui/runs/${run.id}/media/9`, headers: bearer(key) });
    expect(missing.statusCode).toBe(404);

    const listed = await ctx.app.inject({ method: "GET", url: "/ui/runs", headers: bearer(key) });
    expect(listed.body).toContain("2 media");
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("streaming proxy records media assets on the run", async () => {
  const mediaDir = tempMediaDir();
  const encoder = new TextEncoder();
  const upstream = Bun.serve({
    port: 0,
    async fetch() {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"id":"chatcmpl-stream","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"a dot"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}`, TORRIX_MEDIA_DIR: mediaDir });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "streammedia@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
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
        stream: true,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe this" },
              { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
            ],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const userId = (await ctx.repos.users.findByEmail("streammedia@torrix.test"))!.id;
    const runs = await ctx.repos.runs.list(userId, { limit: 5, offset: 0 });
    const run = runs.runs[0] as Run;
    expect(run.media_count).toBe(1);
    const assets = JSON.parse(run.media_assets ?? "[]") as Array<Record<string, unknown>>;
    expect(assets).toHaveLength(1);
    expect(fs.existsSync(path.join(mediaDir, String(assets[0].stored_path)))).toBe(true);
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("ingest persists base64 media without a proxy", async () => {
  const mediaDir = tempMediaDir();
  const ctx = await createTestApp({ TORRIX_MEDIA_DIR: mediaDir });
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(session.key),
      payload: {
        records: [
          {
            provider: "anthropic",
            model: "claude-3-5-sonnet",
            request: {
              body: {
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: "caption" },
                      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1PX } },
                    ],
                  },
                ],
              },
            },
            response: { body: { content: [{ type: "text", text: "a pixel" }] } },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const runs = await ctx.repos.runs.list(session.user.id, { limit: 5, offset: 0 });
    expect(runs.runs[0].media_count).toBe(1);
    const assets = JSON.parse(runs.runs[0].media_assets ?? "[]") as Array<Record<string, unknown>>;
    expect(assets[0].kind).toBe("image");
    expect(fs.existsSync(path.join(mediaDir, String(assets[0].stored_path)))).toBe(true);
  } finally {
    await ctx.cleanup();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});
