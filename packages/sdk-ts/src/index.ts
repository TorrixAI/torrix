import { TorrixClient, TorrixError } from "./client.js";
import type { TorrixClientOptions, TorrixStats } from "./client.js";
import { currentContext, runContext } from "./context.js";
import type { RunContextOptions, TorrixRunContext } from "./context.js";
import { autoInstrument as autoInstrumentWith, unwrap, wrap as wrapWithClient } from "./wrap.js";
import type { AutoInstrumentOptions, WrapOptions } from "./wrap.js";
import { torrixMiddleware } from "./vercel.js";
import type { TorrixMiddlewareOptions } from "./vercel.js";
import type { TorrixRecord } from "./types.js";
import { AttestationError, createAttestationVerifier } from "./verify.js";
import type { AttestationClaims, AttestationVerifier, AttestationVerifierOptions } from "./verify.js";

export { AttestationError, createAttestationVerifier };
export type { AttestationClaims, AttestationVerifier, AttestationVerifierOptions };
export { TorrixClient, TorrixError, torrixMiddleware, unwrap, runContext, currentContext };
export type {
  TorrixClientOptions,
  TorrixStats,
  WrapOptions,
  AutoInstrumentOptions,
  TorrixMiddlewareOptions,
  TorrixRecord,
  RunContextOptions,
  TorrixRunContext,
};

export interface InitOptions {
  baseUrl?: string;
  project?: string;
  tags?: Record<string, string>;
  agentName?: string;
  sampleRate?: number;
  background?: boolean;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface WrapCallOptions {
  provider?: "openai" | "anthropic";
  name?: string;
  tags?: Record<string, string>;
}

let activeClient: TorrixClient | null = null;
let defaults: { name?: string; tags?: Record<string, string>; agentName?: string } = {};

/**
 * Configure the Torrix client. Accepts `init(apiKey, baseUrl?)`, `init(baseUrl, apiKey)`
 * (legacy order) and an options object in either position.
 */
export function init(apiKeyOrUrl: string, baseUrlOrKey?: string | InitOptions, options?: InitOptions): TorrixClient {
  let apiKey = "";
  let baseUrl = "";
  let resolved: InitOptions = {};
  for (const arg of [apiKeyOrUrl, baseUrlOrKey, options]) {
    if (typeof arg === "string") {
      if (isUrl(arg)) baseUrl = arg;
      else if (!apiKey) apiKey = arg;
    } else if (arg && typeof arg === "object") {
      resolved = arg;
    }
  }
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  const key = (apiKey || env.TORRIX_API_KEY || "").trim();
  const url = (baseUrl || resolved.baseUrl || env.TORRIX_URL || "http://localhost:8088").replace(/\/+$/, "");
  defaults = {
    name: undefined,
    tags: resolved.tags,
    agentName: resolved.agentName ?? env.TORRIX_AGENT,
  };
  activeClient = new TorrixClient({
    baseUrl: url,
    apiKey: key || undefined,
    project: resolved.project ?? env.TORRIX_PROJECT,
    sampleRate: resolved.sampleRate,
    timeoutMs: resolved.timeoutMs,
    enabled: resolved.enabled,
    background: resolved.background,
  });
  return activeClient;
}

export function getClient(): TorrixClient {
  if (!activeClient) throw new TorrixError("torrix.init() has not been called");
  return activeClient;
}

export function current(): TorrixClient | null {
  return activeClient;
}

export async function ingest(records: TorrixRecord | TorrixRecord[], options: { wait?: boolean } = {}): Promise<string[]> {
  return getClient().ingest(records, options);
}

export async function flush(timeoutMs?: number): Promise<boolean> {
  return activeClient ? activeClient.flush(timeoutMs) : true;
}

export async function health(): Promise<boolean> {
  return activeClient ? activeClient.health() : false;
}

export function stats(): TorrixStats | null {
  return activeClient ? activeClient.stats() : null;
}

/** Patch an SDK client instance so every call is recorded. */
export function wrap(target: unknown, options: WrapCallOptions = {}): unknown {
  const client = getClient();
  return wrapWithClient(target, {
    client,
    provider: options.provider,
    name: options.name ?? defaults.name,
    tags: { ...(defaults.tags ?? {}), ...(options.tags ?? {}) },
    agentName: defaults.agentName,
  });
}

/** Patch installed `openai` / `anthropic` packages so all future clients are recorded. */
export function autoInstrument(options: { openai?: boolean; anthropic?: boolean } = {}): Promise<{ openai: boolean; anthropic: boolean }> {
  return autoInstrumentWith({ client: getClient(), openai: options.openai, anthropic: options.anthropic });
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
