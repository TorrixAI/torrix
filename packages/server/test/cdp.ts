import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export const browserPath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));

interface CdpMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

export class Cdp {
  private nextId = 1;
  private pending = new Map<number, (message: CdpMessage) => void>();
  private constructor(
    private socket: WebSocket,
    readonly sessionId: string,
    private browser: ReturnType<typeof Bun.spawn>,
  ) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)!(message);
        this.pending.delete(message.id);
      }
    });
  }

  /** Starts a headless browser, opens one page and returns a handle for it. */
  static async launch(): Promise<Cdp> {
    const port = 18_000 + ((process.pid + Math.floor(Math.random() * 1000)) % 4000);
    const profile = path.join(os.tmpdir(), `torrix-cdp-${crypto.randomUUID()}`);
    fs.mkdirSync(profile, { recursive: true });
    const browser = Bun.spawn(
      [browserPath!, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
      { stdout: "ignore", stderr: "ignore" },
    );
    let ws: string | null = null;
    const deadline = Date.now() + 30_000;
    while (!ws && Date.now() < deadline) {
      try {
        ws = ((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl?: string }).webSocketDebuggerUrl ?? null;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!ws) {
      browser.kill();
      throw new Error(`browser debugging port ${port} did not open`);
    }
    const socket = new WebSocket(ws);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("cdp connect failed")));
    });
    const bootstrap = new Cdp(socket, "", browser);
    const target = await bootstrap.send("Target.createTarget", { url: "about:blank" });
    const attach = await bootstrap.send("Target.attachToTarget", { targetId: target.result!.targetId, flatten: true });
    const page = new Cdp(socket, attach.result!.sessionId as string, browser);
    page.pending = bootstrap.pending;
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    return page;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (this.sessionId) payload.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.socket.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`cdp timeout: ${method}`));
      }, 15_000);
    });
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const result = res.result?.result as { value?: unknown } | undefined;
    const exception = res.result?.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
    if (exception) throw new Error(`page error: ${exception.exception?.description ?? exception.text}`);
    return result?.value as T;
  }

  async waitFor(expression: string, label: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.eval(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  async goto(url: string, readyExpression: string, label: string): Promise<void> {
    await this.send("Page.navigate", { url });
    await this.waitFor(`document.readyState==='complete' && (${readyExpression})`, label);
  }

  /** Signs in through the SPA session endpoint and keeps the key the API client reads. */
  async signIn(origin: string, key: string): Promise<void> {
    await this.goto(`${origin}/ui/login`, "document.readyState==='complete'", "login page");
    await this.eval(`(async function(){
      var response = await fetch("/ui/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: ${JSON.stringify(key)} }) });
      if (!response.ok) throw new Error("session rejected");
      localStorage.setItem("torrix_key", ${JSON.stringify(key)});
      location.assign("/ui/dashboard");
      return true;
    })()`);
    await this.waitFor("location.pathname==='/ui/dashboard'", "dashboard after sign in");
  }

  close(): void {
    this.socket.close();
    this.browser.kill();
  }
}
