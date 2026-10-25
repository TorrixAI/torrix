import { expect, test } from "bun:test";
import { assertOutboundAllowed, guardedFetch, OutboundBlockedError, outboundPolicy, type OutboundPolicy } from "../src/lib/outbound";

const strict: OutboundPolicy = { allowPrivate: false, allowedHosts: [], resolve: async () => ["93.184.216.34"] };
const permissive: OutboundPolicy = { ...strict, allowPrivate: true };

async function reason(url: string, policy: OutboundPolicy): Promise<string | null> {
  try {
    await assertOutboundAllowed(url, policy);
    return null;
  } catch (err) {
    return err instanceof OutboundBlockedError ? err.reason : `other:${(err as Error).message}`;
  }
}

test("cloud metadata and link-local addresses are never reachable, even when private hosts are allowed", async () => {
  for (const url of [
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.1.7/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://[fe80::1]/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://[::ffff:169.254.169.254]/",
  ]) {
    expect(await reason(url, strict)).toBe("metadata_blocked");
    expect(await reason(url, permissive)).toBe("metadata_blocked");
  }
});

test("private and loopback addresses are blocked unless the operator opts in", async () => {
  for (const url of ["http://127.0.0.1:8080/", "http://10.1.2.3/", "http://192.168.0.5/x", "http://172.20.0.4/", "http://[::1]/", "http://localhost:3000/"]) {
    expect(await reason(url, strict)).toBe("private_blocked");
    expect(await reason(url, permissive)).toBeNull();
  }
  expect(await reason("https://example.com/mcp", strict)).toBeNull();
});

test("a listed host is reachable without opening every private address", async () => {
  const policy: OutboundPolicy = { ...strict, allowedHosts: ["10.0.0.9:3000", "internal-erp"] };
  expect(await reason("http://10.0.0.9:3000/mcp", policy)).toBeNull();
  expect(await reason("http://10.0.0.9:4000/mcp", policy)).toBe("private_blocked");
  expect(await reason("http://10.0.0.10:3000/mcp", policy)).toBe("private_blocked");
  const named: OutboundPolicy = { ...policy, resolve: async () => ["10.9.9.9"] };
  expect(await reason("http://internal-erp/api", named)).toBeNull();
});

test("a public-looking name that resolves to a private or metadata address is blocked", async () => {
  expect(await reason("https://evil.example/x", { ...strict, resolve: async () => ["10.0.0.5"] })).toBe("private_blocked");
  expect(await reason("https://evil.example/x", { ...strict, resolve: async () => ["93.184.216.34", "169.254.169.254"] })).toBe("metadata_blocked");
  expect(await reason("https://evil.example/x", { ...permissive, resolve: async () => ["169.254.169.254"] })).toBe("metadata_blocked");
});

test("only http and https addresses are accepted", async () => {
  expect(await reason("file:///etc/passwd", permissive)).toBe("non_http_protocol");
  expect(await reason("gopher://example.com/", permissive)).toBe("non_http_protocol");
  expect(await reason("not a url", permissive)).toBe("invalid_url");
});

test("a redirect is never followed, so a safe host cannot bounce a request to a metadata address", async () => {
  let metadataHit = false;
  const server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" } });
    },
  });
  try {
    await expect(guardedFetch(`http://127.0.0.1:${server.port}/start`, {}, permissive)).rejects.toMatchObject({ reason: "redirect_blocked" });
    expect(metadataHit).toBe(false);
  } finally {
    server.stop(true);
  }
});

test("guardedFetch returns the response for an allowed address", async () => {
  const server = Bun.serve({ port: 0, async fetch() { return Response.json({ ok: true }); } });
  try {
    const res = await guardedFetch(`http://127.0.0.1:${server.port}/`, {}, permissive);
    expect(await res.json()).toEqual({ ok: true });
    await expect(guardedFetch(`http://127.0.0.1:${server.port}/`, {}, strict)).rejects.toBeInstanceOf(OutboundBlockedError);
  } finally {
    server.stop(true);
  }
});

test("guardedFetch connects to the address it validated, not a fresh lookup", async () => {
  let seenHost = "";
  let lookups = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      seenHost = req.headers.get("host") ?? "";
      return Response.json({ ok: true });
    },
  });
  const policy: OutboundPolicy = {
    allowPrivate: false,
    allowedHosts: [`pinned.test:${server.port}`],
    resolve: async () => {
      lookups += 1;
      return ["127.0.0.1"];
    },
  };
  try {
    const res = await guardedFetch(`http://pinned.test:${server.port}/api`, {}, policy);
    expect(await res.json()).toEqual({ ok: true });
    expect(seenHost).toBe(`pinned.test:${server.port}`);
    expect(lookups).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("the policy reads the operator's environment", () => {
  expect(outboundPolicy({})).toMatchObject({ allowPrivate: false, allowedHosts: [] });
  expect(outboundPolicy({ TORRIX_ALLOW_PRIVATE_HOSTS: "true" }).allowPrivate).toBe(true);
  expect(outboundPolicy({ TORRIX_LOCAL_HOST: "Host.Docker.Internal:11434, 10.0.0.2" }).allowedHosts).toEqual(["host.docker.internal:11434", "10.0.0.2"]);
});
