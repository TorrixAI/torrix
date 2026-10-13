import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browserPath = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  sessionId?: string;
  error?: { message: string };
}

class CdpSession {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (message: CdpMessage) => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)!(message);
        this.pending.delete(message.id);
      }
    });
  }

  static async connect(url: string): Promise<CdpSession> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("cdp connect failed")));
    });
    return new CdpSession(socket);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CdpMessage> {
    const id = this.nextId++;
    const payload: CdpMessage = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.socket.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`cdp timeout: ${method}`));
        }
      }, 15_000);
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function evaluate(cdp: CdpSession, sessionId: string, expression: string): Promise<unknown> {
  const res = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  return res.result?.result && (res.result.result as { value?: unknown }).value;
}

async function waitFor(cdp: CdpSession, sessionId: string, expression: string, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function seedRun(ctx: TestApp, userId: string): Promise<Run> {
  const run = {
    id: crypto.randomUUID(),
    user_id: userId,
    name: "clickthrough run",
    model: "gpt-4o",
    provider: "openai",
    input_tokens: 100,
    output_tokens: 20,
    cost_usd: 0.001,
    latency_ms: 150,
    status: 200,
    source: "proxy",
    created_at: new Date().toISOString(),
  } as unknown as Run;
  await ctx.repos.runs.save(run);
  return run;
}

test.skipIf(!browserPath)(
  "browser click-through: sign in, dashboard, runs, score a run",
  async () => {
    const ctx = await createTestApp();
    let browser: ReturnType<typeof Bun.spawn> | null = null;
    let cdp: CdpSession | null = null;
    try {
      const session = await seedSession(ctx);
      const run = await seedRun(ctx, session.user.id);
      const address = await ctx.app.listen({ port: 0, host: "127.0.0.1" });

      const debugPort = 18_000 + (process.pid % 4000);
      const profileDir = path.join(os.tmpdir(), `torrix-cdp-${crypto.randomUUID()}`);
      fs.mkdirSync(profileDir, { recursive: true });

      browser = Bun.spawn(
        [
          browserPath!,
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          `--remote-debugging-port=${debugPort}`,
          `--user-data-dir=${profileDir}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      let browserStderr = "";
      void (async () => {
        const decoder = new TextDecoder();
        const reader = (browser!.stderr as ReadableStream<Uint8Array>).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          browserStderr += decoder.decode(value, { stream: true });
        }
      })();

      let browserWs: string | null = null;
      const deadline = Date.now() + 30_000;
      while (!browserWs && Date.now() < deadline) {
        try {
          const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
          const info = (await res.json()) as { webSocketDebuggerUrl?: string };
          browserWs = info.webSocketDebuggerUrl ?? null;
        } catch {
          // browser still starting
        }
        if (!browserWs) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      if (!browserWs) {
        throw new Error(`cdp unavailable on ${debugPort}; exitCode=${browser.exitCode}; stderr=${browserStderr.slice(0, 500)}`);
      }
      cdp = await CdpSession.connect(browserWs!);

      const createTarget = await cdp.send("Target.createTarget", { url: "about:blank" });
      const targetId = createTarget.result!.targetId as string;
      const attach = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const pageSessionId = attach.result!.sessionId as string;
      await cdp.send("Page.enable", {}, pageSessionId);
      await cdp.send("Runtime.enable", {}, pageSessionId);

      await cdp.send("Page.navigate", { url: `${address}/ui/login` }, pageSessionId);
      await waitFor(cdp, pageSessionId, "document.readyState==='complete' && !!document.getElementById('keyBtn')", "login page");
      expect(await evaluate(cdp, pageSessionId, "document.querySelectorAll('[data-theme-toggle]').length")).toBe(1);
      await evaluate(cdp, pageSessionId, "document.querySelector('[data-theme-toggle]').click()");
      expect(await evaluate(cdp, pageSessionId, "document.documentElement.dataset.theme")).toBe("dark");
      expect(await evaluate(cdp, pageSessionId, "localStorage.getItem('torrix_theme')")).toBe("dark");
      await evaluate(cdp, pageSessionId, "document.getElementById('tabKey').click()");
      await evaluate(
        cdp,
        pageSessionId,
        `localStorage.setItem('torrix_key', ${JSON.stringify(session.key)}); document.getElementById('apikey').value = ${JSON.stringify(session.key)}; document.getElementById('keyBtn').click()`,
      );
      await waitFor(cdp, pageSessionId, "location.pathname==='/ui/dashboard'", "dashboard redirect");
      await waitFor(cdp, pageSessionId, "!!document.querySelector('.db-hero')", "dashboard hero");
      expect(await evaluate(cdp, pageSessionId, "document.querySelector('h1').textContent")).toBe("Dashboard");
      expect(await evaluate(cdp, pageSessionId, "document.documentElement.dataset.theme")).toBe("dark");
      expect(await evaluate(cdp, pageSessionId, "getComputedStyle(document.body).backgroundColor")).toBe("rgb(11, 16, 28)");
      await evaluate(cdp, pageSessionId, "document.querySelector('.topbar-right [data-theme-toggle]').click()");
      expect(await evaluate(cdp, pageSessionId, "document.documentElement.dataset.theme")).toBe("light");
      expect(await evaluate(cdp, pageSessionId, "getComputedStyle(document.body).backgroundColor")).toBe("rgb(248, 250, 252)");
      const finePointer = await evaluate(cdp, pageSessionId, "!!(window.matchMedia && window.matchMedia('(pointer:fine)').matches)");
      if (finePointer) {
        await evaluate(cdp, pageSessionId, "window.dispatchEvent(new PointerEvent('pointermove',{clientX:420,clientY:300,bubbles:true}))");
        await new Promise((r) => setTimeout(r, 60));
        expect(await evaluate(cdp, pageSessionId, "document.documentElement.style.getPropertyValue('--mx')")).not.toBe("");
      }

      await evaluate(cdp, pageSessionId, "document.querySelector('a.nav-item[href=\"/ui/runs\"]').click()");
      await waitFor(cdp, pageSessionId, "location.pathname==='/ui/runs' && !!document.querySelector('table')", "runs list");
      expect(await evaluate(cdp, pageSessionId, "localStorage.getItem('torrix_theme')")).toBe("light");
      const runRows = await evaluate(cdp, pageSessionId, "document.querySelectorAll('tbody tr.clickable').length");
      expect(Number(runRows)).toBeGreaterThanOrEqual(1);

      await evaluate(cdp, pageSessionId, "document.querySelector('tbody tr.clickable').click()");
      await waitFor(cdp, pageSessionId, `location.pathname===${JSON.stringify(`/ui/runs/${run.id}`)}`, "run detail");
      await waitFor(cdp, pageSessionId, "!!document.getElementById('rd-good')", "review panel");
      await evaluate(cdp, pageSessionId, "document.getElementById('rd-good').click()");
      await waitFor(cdp, pageSessionId, "document.getElementById('rd-status').textContent==='scored good'", "score ack");
      const scored = await ctx.repos.runs.getById(run.id, session.user.id);
      expect(scored?.score).toBe(1);

      await evaluate(cdp, pageSessionId, "document.querySelector('a.nav-item[href=\"/ui/governance\"]').click()");
      await waitFor(cdp, pageSessionId, "location.pathname==='/ui/governance' && document.body.textContent.includes('Governance')", "governance page");

      await evaluate(cdp, pageSessionId, "document.querySelector('a.nav-item[href=\"/ui/cost\"]').click()");
      await waitFor(cdp, pageSessionId, "location.pathname==='/ui/cost' && document.body.textContent.includes('Cost')", "cost page");
    } finally {
      cdp?.close();
      browser?.kill();
      await ctx.cleanup();
    }
  },
  90_000,
);

test.skipIf(browserPath !== undefined)("browser click-through skipped (no Chromium/Edge found)", () => {
  expect(true).toBe(true);
});
