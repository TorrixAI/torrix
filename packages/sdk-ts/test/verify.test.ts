import { describe, expect, test } from "bun:test";
import { argsDigest, createAttestationVerifier, type AttestationClaims, type Jwks } from "../src/verify.js";

const b64 = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

async function keyPair(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, alg: "ES256" } };
}

async function mint(key: Awaited<ReturnType<typeof keyPair>>, overrides: Partial<AttestationClaims> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: AttestationClaims = {
    iss: "torrix",
    aud: "erp",
    sub: "agent-1",
    iat: now,
    exp: now + 60,
    jti: crypto.randomUUID(),
    mcp_method: "tools/call",
    tool: "pay",
    args_sha256: await argsDigest({ amount: 10 }),
    decision: "allow",
    ...overrides,
  };
  const input = `${b64(JSON.stringify({ alg: "ES256", typ: "JWT", kid: key.kid }))}.${b64(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64(new Uint8Array(sig))}`;
}

const call = { method: "tools/call", params: { name: "pay", arguments: { amount: 10 } } };

describe("attestation verifier", () => {
  test("accepts a valid token and enforces claims", async () => {
    const key = await keyPair("k1");
    const jwks: Jwks = { keys: [key.publicJwk] };
    const verifier = createAttestationVerifier({ audience: "erp", jwks });
    expect((await verifier.verify(await mint(key), call)).sub).toBe("agent-1");

    const cases: Array<[Partial<AttestationClaims>, string]> = [
      [{ exp: Math.floor(Date.now() / 1000) - 120 }, "attestation_expired"],
      [{ iat: Math.floor(Date.now() / 1000) + 600, exp: Math.floor(Date.now() / 1000) + 660 }, "attestation_not_yet_valid"],
      [{ iss: "someone-else" }, "attestation_wrong_issuer"],
      [{ mcp_method: "tools/list" }, "attestation_method_mismatch"],
      [{ decision: "require_approval" }, "attestation_not_allowed"],
    ];
    for (const [overrides, code] of cases) {
      await expect(verifier.verify(await mint(key, overrides), call)).rejects.toMatchObject({ code });
    }
    await expect(verifier.verify("not.a.jwt", call)).rejects.toMatchObject({ code: "attestation_malformed" });
    await expect(verifier.verifyRequest({}, call)).rejects.toMatchObject({ code: "attestation_missing" });
    await expect(verifier.verifyRequest({ "X-Torrix-Attestation": await mint(key) }, [call])).rejects.toMatchObject({ code: "attestation_malformed" });
  });

  test("a key from another issuer is rejected even with a matching kid", async () => {
    const real = await keyPair("k1");
    const forger = await keyPair("k1");
    const verifier = createAttestationVerifier({ audience: "erp", jwks: { keys: [real.publicJwk] } });
    await expect(verifier.verify(await mint(forger), call)).rejects.toMatchObject({ code: "attestation_bad_signature" });
  });

  test("refetches the JWKS once when a rotated kid appears", async () => {
    const oldKey = await keyPair("old");
    const newKey = await keyPair("new");
    let served: Jwks = { keys: [oldKey.publicJwk] };
    let fetches = 0;
    const fakeFetch = (async () => {
      fetches += 1;
      return Response.json(served);
    }) as unknown as typeof fetch;
    const verifier = createAttestationVerifier({ audience: "erp", jwksUrl: "https://torrix.test/.well-known/jwks.json", fetch: fakeFetch });
    await verifier.verify(await mint(oldKey), call);
    expect(fetches).toBe(1);

    served = { keys: [newKey.publicJwk, oldKey.publicJwk] };
    await verifier.verify(await mint(newKey), call);
    expect(fetches).toBe(2);

    // An unknown kid inside the 30s window does not hammer the JWKS endpoint.
    await expect(verifier.verify(await mint(await keyPair("bogus")), call)).rejects.toMatchObject({ code: "attestation_unknown_key" });
    expect(fetches).toBe(2);
  });

  test("custom replay store is consulted and replays can be disabled", async () => {
    const key = await keyPair("k1");
    const seen = new Set<string>();
    const verifier = createAttestationVerifier({
      audience: "erp",
      jwks: { keys: [key.publicJwk] },
      replayStore: { remember: (jti) => (seen.has(jti) ? false : (seen.add(jti), true)) },
    });
    const token = await mint(key);
    await verifier.verify(token, call);
    await expect(verifier.verify(token, call)).rejects.toMatchObject({ code: "attestation_replayed" });
    expect(seen.size).toBe(1);

    const lenient = createAttestationVerifier({ audience: "erp", jwks: { keys: [key.publicJwk] }, rejectReplays: false });
    await lenient.verify(token, call);
    await lenient.verify(token, call);
  });
});
