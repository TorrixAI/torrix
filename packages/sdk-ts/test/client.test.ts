import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TorrixClient } from "../src/client.js";
import { runContext } from "../src/context.js";
import type { TorrixRecord } from "../src/types.js";

interface Captured {
  headers: Record<string, string>;
  body: { records: TorrixRecord[] };
}

const captured: Captured[] = [];
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/ingest") {
        const body = (await request.json()) as { records: TorrixRecord[] };
        captured.push({
          headers: Object.fromEntries(request.headers.entries()),
          body,
        });
        return Response.json({ accepted: body.records.length, ids: body.records.map((record) => record.id ?? "generated") });
      }
      if (url.pathname === "/health") return new Response("ok", { status: 200 });
      return new Response("not found", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("TorrixClient", () => {
  test("queues in the background and flushes with auth headers", async () => {
    captured.length = 0;
    const client = new TorrixClient({ baseUrl, apiKey: "trxk_test", project: "demo", background: true, flushIntervalMs: 5 });
    await client.ingest({ id: "run-1", model: "gpt-4o", status: 200 });
    expect(client.stats().queued).toBe(1);
    await client.flush();
    expect(captured.length).toBe(1);
    expect(captured[0].headers.authorization).toBe("Bearer trxk_test");
    expect(captured[0].headers["x-torrix-project"]).toBe("demo");
    expect(captured[0].headers["user-agent"]).toBe("torrix-sdk/1.0.0");
    expect(captured[0].body.records[0].id).toBe("run-1");
    expect(client.stats()).toMatchObject({ accepted: 1, dropped: 0, queued: 0, lastError: null });
  });

  test("wait mode returns accepted ids", async () => {
    captured.length = 0;
    const client = new TorrixClient({ baseUrl, apiKey: "trxk_test", background: false });
    const ids = await client.ingest({ id: "run-2" }, { wait: true });
    expect(ids).toEqual(["run-2"]);
    expect(captured.length).toBe(1);
  });

  test("sampling drops records", async () => {
    captured.length = 0;
    const client = new TorrixClient({ baseUrl, apiKey: "trxk_test", background: false, sampleRate: 0 });
    const ids = await client.ingest([{ id: "a" }, { id: "b" }], { wait: true });
    expect(ids).toEqual([]);
    expect(captured.length).toBe(0);
    expect(client.stats().dropped).toBe(2);
  });

  test("run context propagates trace, session and agent; sequential calls are siblings", async () => {
    captured.length = 0;
    const client = new TorrixClient({ baseUrl, apiKey: "trxk_test", background: false });
    await runContext({ sessionId: "ses_1", agentName: "planner", name: "plan" }, async () => {
      await client.ingest({ id: "first" }, { wait: true });
      await client.ingest({ id: "second" }, { wait: true });
    });
    const [first] = captured[0].body.records;
    const [second] = captured[1].body.records;
    expect(captured.length).toBe(2);
    expect(first.trace_id).toBeTruthy();
    expect(first.session_id).toBe("ses_1");
    expect(first.agent_name).toBe("planner");
    expect(first.name).toBe("plan");
    expect(first.parent_run_id).toBeUndefined();
    expect(second.parent_run_id).toBeUndefined();
    expect(second.trace_id).toBe(first.trace_id);
  });

  test("a nested run context hangs under the latest call of its enclosing context", async () => {
    captured.length = 0;
    const client = new TorrixClient({ baseUrl, apiKey: "trxk_test", background: false });
    await runContext({ agentName: "planner" }, async () => {
      await client.ingest({ id: "plan" }, { wait: true });
      await Promise.all(
        ["search", "write"].map((agent) =>
          runContext({ agentName: agent }, async () => {
            await client.ingest({ id: `${agent}-1` }, { wait: true });
            await client.ingest({ id: `${agent}-2` }, { wait: true });
          }),
        ),
      );
      await client.ingest({}, { wait: true });
    });
    const records = captured.flatMap((call) => call.body.records) as Array<Record<string, string | undefined>>;
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const id of ["search-1", "search-2", "write-1", "write-2"]) {
      expect(byId.get(id)?.parent_run_id).toBe("plan");
    }
    expect(byId.get("search-1")?.agent_name).toBe("search");
    const last = records[records.length - 1];
    expect(last.id).toBeTruthy();
    expect(last.parent_run_id).toBeUndefined();
    expect(new Set(records.map((r) => r.trace_id)).size).toBe(1);
  });

  test("health reflects server reachability", async () => {
    const client = new TorrixClient({ baseUrl, apiKey: "trxk_test", background: false });
    expect(await client.health()).toBe(true);
    const offline = new TorrixClient({ baseUrl: "http://127.0.0.1:1", background: false, timeoutMs: 200 });
    expect(await offline.health()).toBe(false);
  });
});
