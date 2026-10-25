import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { blockedReason } from "./validate";

/**
 * Guard for every request the server makes to an address a user or a remote
 * system supplied (MCP servers, record connectors, directory sync, OAuth
 * discovery). The proxy has its own check; this one also resolves DNS, refuses
 * redirects, and keeps two tiers:
 *
 * - cloud metadata and link-local addresses are never reachable;
 * - private and loopback addresses are blocked unless the operator opts in
 *   with TORRIX_ALLOW_PRIVATE_HOSTS=true, or lists the host in TORRIX_LOCAL_HOST.
 */
export interface OutboundPolicy {
  allowPrivate: boolean;
  /** `host` or `host:port` entries that may be reached even though they are private. */
  allowedHosts: string[];
  /** Test hook: resolves a hostname to its addresses. */
  resolve?: (host: string) => Promise<string[]>;
}

export class OutboundBlockedError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "OutboundBlockedError";
    this.reason = reason;
  }
}

export function outboundPolicy(env: NodeJS.ProcessEnv = process.env): OutboundPolicy {
  return {
    allowPrivate: env.TORRIX_ALLOW_PRIVATE_HOSTS === "true",
    allowedHosts: (env.TORRIX_LOCAL_HOST ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  };
}

const LINK_LOCAL_V4 = /^169\.254\./;
const LINK_LOCAL_V6 = /^fe[89ab][0-9a-f]{0,2}:/i;
const METADATA_V6 = /^fd00:ec2:/i;

type AddressClass = "metadata" | "private" | null;

function classifyAddress(address: string): AddressClass {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (LINK_LOCAL_V4.test(host) || LINK_LOCAL_V6.test(host) || METADATA_V6.test(host)) {
    return "metadata";
  }
  const reason = blockedReason(host);
  if (!reason) {
    return null;
  }
  return reason === "metadata_host_blocked" ? "metadata" : "private";
}

function hostAllowed(url: URL, policy: OutboundPolicy): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const withPort = url.port ? `${host}:${url.port}` : null;
  return policy.allowedHosts.some((entry) => entry === host || (withPort !== null && entry === withPort));
}

async function resolveHost(host: string, policy: OutboundPolicy): Promise<string[]> {
  if (policy.resolve) {
    return policy.resolve(host);
  }
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/** Throws OutboundBlockedError unless the URL may be fetched under the policy. */
export async function assertOutboundAllowed(rawUrl: string, policy: OutboundPolicy = outboundPolicy()): Promise<URL> {
  return (await resolveOutboundTarget(rawUrl, policy)).url;
}

export interface OutboundTarget {
  url: URL;
  /** A validated address to connect to, so DNS cannot rebind between the check and the request. */
  address: string | null;
}

/**
 * Validates a user-supplied address and resolves it once. The returned address is
 * what guardedFetch connects to, which closes the DNS-rebinding window between
 * the check and the request.
 */
export async function resolveOutboundTarget(rawUrl: string, policy: OutboundPolicy = outboundPolicy()): Promise<OutboundTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundBlockedError("invalid_url", "the address is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundBlockedError("non_http_protocol", "only http and https addresses are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowedPrivate = policy.allowPrivate || hostAllowed(url, policy);

  // The host itself: an IP literal, a loopback name, or a known metadata hostname.
  const hostKind = classifyAddress(host);
  if (hostKind === "metadata") {
    throw new OutboundBlockedError("metadata_blocked", "cloud metadata and link-local addresses are never allowed");
  }
  if (hostKind === "private" && !allowedPrivate) {
    throw new OutboundBlockedError(
      "private_blocked",
      "private and loopback addresses are blocked; set TORRIX_ALLOW_PRIVATE_HOSTS=true or list the host in TORRIX_LOCAL_HOST to reach internal systems",
    );
  }
  if (isIP(host)) {
    return { url, address: null };
  }

  const resolved = await resolveHost(host, policy).catch(() => null);
  if (!resolved || !resolved.length) {
    // The name did not resolve: let the real request fail with its own error.
    return { url, address: null };
  }
  for (const address of resolved) {
    const kind = classifyAddress(address);
    if (kind === "metadata") {
      throw new OutboundBlockedError("metadata_blocked", "cloud metadata and link-local addresses are never allowed");
    }
    if (kind === "private" && !allowedPrivate) {
      throw new OutboundBlockedError(
        "private_blocked",
        "private and loopback addresses are blocked; set TORRIX_ALLOW_PRIVATE_HOSTS=true or list the host in TORRIX_LOCAL_HOST to reach internal systems",
      );
    }
  }
  return { url, address: resolved[0] };
}

/**
 * fetch for user-supplied addresses: validates the target, connects to the
 * address it resolved (so DNS rebinding cannot swap it), never follows
 * redirects (a safe host could otherwise bounce the request to an internal one),
 * and surfaces a redirect as a blocked request.
 */
export async function guardedFetch(
  rawUrl: string,
  init: RequestInit = {},
  policy: OutboundPolicy = outboundPolicy(),
): Promise<Response> {
  const { url, address } = await resolveOutboundTarget(rawUrl, policy);
  let requestInit: RequestInit = { ...init, redirect: "manual" };
  let target: URL = url;
  if (address) {
    const headers = new Headers(init.headers);
    if (!headers.has("host")) {
      headers.set("host", url.host);
    }
    target = new URL(url.toString());
    target.hostname = address.includes(":") ? `[${address}]` : address;
    requestInit = {
      ...requestInit,
      headers,
      ...(url.protocol === "https:" ? { tls: { serverName: url.hostname } } : {}),
    };
  }
  const res = await fetch(target, requestInit);
  if (res.status >= 300 && res.status < 400) {
    throw new OutboundBlockedError("redirect_blocked", `the server answered HTTP ${res.status}; redirects are not followed, use the final address`);
  }
  return res;
}
