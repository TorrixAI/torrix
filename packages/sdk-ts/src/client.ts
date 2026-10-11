import { currentContext } from "./context.js";
import type { TorrixRecord } from "./types.js";

export class TorrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TorrixError";
  }
}

export interface TorrixClientOptions {
  baseUrl: string;
  apiKey?: string;
  project?: string;
  sampleRate?: number;
  timeoutMs?: number;
  enabled?: boolean;
  background?: boolean;
  flushIntervalMs?: number;
}

export interface TorrixStats {
  accepted: number;
  dropped: number;
  queued: number;
  lastError: string | null;
}

const BATCH_SIZE = 500;
const DEFAULT_FLUSH_TIMEOUT_MS = 5000;

export class TorrixClient {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly project: string | undefined;
  readonly sampleRate: number;
  readonly timeoutMs: number;
  enabled: boolean;
  readonly background: boolean;

  private readonly flushIntervalMs: number;
  private pending: TorrixRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private closed = false;
  private acceptedCount = 0;
  private droppedCount = 0;
  private lastError: string | null = null;

  constructor(options: TorrixClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.project = options.project;
    this.sampleRate = clamp01(options.sampleRate ?? 1);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.enabled = options.enabled ?? true;
    this.background = options.background ?? true;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    if (this.background && typeof process !== "undefined" && typeof process.once === "function") {
      process.once("beforeExit", () => {
        void this.flush(1000);
      });
    }
  }

  async ingest(records: TorrixRecord | TorrixRecord[], options: { wait?: boolean } = {}): Promise<string[]> {
    if (!this.enabled || this.closed) return [];
    const items = Array.isArray(records) ? records.slice() : [records];
    if (!items.length) return [];
    applyContext(items);
    const accepted: string[] = [];
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const sliced = items.slice(start, start + BATCH_SIZE);
      const batch = this.sampleRate >= 1 ? sliced : sliced.filter(() => Math.random() < this.sampleRate);
      if (!batch.length) {
        this.droppedCount += sliced.length;
        continue;
      }
      if (this.background && !options.wait) {
        this.pending.push(...batch);
        this.scheduleFlush();
        continue;
      }
      accepted.push(...(await this.send(batch)));
      if (this.pending.length) this.scheduleFlush();
    }
    return accepted;
  }

  async flush(timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS): Promise<boolean> {
    if (!this.background) return true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending.length && !this.flushing) return true;
    const drained = this.drain().then(() => true);
    const expired = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    });
    return Promise.race([drained, expired]);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  stats(): TorrixStats {
    return {
      accepted: this.acceptedCount,
      dropped: this.droppedCount,
      queued: this.pending.length,
      lastError: this.lastError,
    };
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(this.timeoutMs) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private scheduleFlush(): void {
    if (this.timer || !this.background || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  private drain(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      while (this.pending.length) {
        const batch = this.pending.splice(0, BATCH_SIZE);
        try {
          await this.send(batch);
        } catch {
          // lastError already recorded; the batch is dropped like the Python SDK
        }
      }
    })().finally(() => {
      this.flushing = null;
      if (this.pending.length && !this.closed) this.scheduleFlush();
    });
    return this.flushing;
  }

  private async send(batch: TorrixRecord[]): Promise<string[]> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "torrix-sdk/1.0.0",
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (this.project) headers["x-torrix-project"] = this.project;
    try {
      const response = await fetch(`${this.baseUrl}/api/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify({ records: batch }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new TorrixError(`ingest rejected with HTTP ${response.status}: ${text}`);
      }
      const parsed = (await response.json().catch(() => ({}))) as { ids?: unknown };
      this.acceptedCount += batch.length;
      return Array.isArray(parsed.ids) ? parsed.ids.map(String) : [];
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.droppedCount += batch.length;
      if (error instanceof TorrixError) throw error;
      throw new TorrixError(`torrix unreachable: ${this.lastError}`);
    }
  }
}

function applyContext(records: TorrixRecord[]): void {
  const context = currentContext();
  if (!context) return;
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    record.trace_id ??= context.trace_id;
    if (context.session_id) record.session_id ??= context.session_id;
    if (context.agent_name) record.agent_name ??= context.agent_name;
    // Calls inside one context are siblings under the context's parent; only a
    // nested context hangs under the latest call of its enclosing context.
    if (context.parent_run_id) record.parent_run_id ??= context.parent_run_id;
    if (context.name && !record.name) record.name = context.name;
    record.id ??= crypto.randomUUID();
    context.last_run_id = record.id;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
