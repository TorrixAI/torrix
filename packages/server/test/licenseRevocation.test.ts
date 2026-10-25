import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bearer, createTestApp, licenseSigner } from "./helpers";
import { verifyRevocationList } from "../src/lib/license";

async function adminKey(ctx: Awaited<ReturnType<typeof createTestApp>>, email: string): Promise<string> {
  const signup = await ctx.app.inject({ method: "POST", url: "/auth/signup", payload: { email, password: "password123" } });
  return (signup.json() as { api_key: string }).api_key;
}

test("a signed revocation document verifies and a tampered one does not", async () => {
  const signer = await licenseSigner("revoke");
  const doc = await signer.sign({
    type: "torrix-license-revocations",
    issued_at: new Date().toISOString(),
    revoked: ["LIC-1", "LIC-2"],
  });
  const verified = await verifyRevocationList(doc, [signer.trusted]);
  expect(verified).toMatchObject({ valid: true, revoked: ["LIC-1", "LIC-2"] });

  const [payload, signature] = doc.split(".");
  const forged = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as { revoked: string[] };
  forged.revoked.push("LIC-3");
  const tampered = `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`;
  expect((await verifyRevocationList(tampered, [signer.trusted])).valid).toBe(false);
  expect((await verifyRevocationList("not-a-document", [signer.trusted])).reason).toBe("malformed");
});

test("activation checks the signed list and revokes only the listed serial", async () => {
  const dir = mkdtempSync(join(tmpdir(), "torrix-revocation-"));
  const file = join(dir, "revocations.txt");
  const signer = await licenseSigner("revoke");
  const revokedLicense = await signer.sign({
    edition: "pro",
    licensee: "Acme",
    customer: "acme",
    serial: "LIC-REVOKED",
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  const activeLicense = await signer.sign({
    edition: "enterprise",
    licensee: "Beta",
    customer: "beta",
    serial: "LIC-ACTIVE",
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  const doc = await signer.sign({
    type: "torrix-license-revocations",
    issued_at: new Date().toISOString(),
    revoked: ["LIC-REVOKED"],
  });
  writeFileSync(file, doc);

  const ctx = await createTestApp({ TORRIX_LICENSE_REVOCATIONS: file }, { trustedKeys: [signer.trusted] });
  try {
    const key = await adminKey(ctx, "revoked@torrix.test");
    const blocked = await ctx.app.inject({ method: "POST", url: "/api/license", headers: bearer(key), payload: { key: revokedLicense } });
    expect(blocked.statusCode).toBe(200);
    const body = blocked.json() as { edition: string; serial: string | null; revoked: { serial: string } | null; notice: string };
    expect(body.edition).toBe("community");
    expect(body.revoked?.serial).toBe("LIC-REVOKED");
    expect(body.notice).toContain("revocation list");

    const info = await ctx.app.inject({ method: "GET", url: "/api/license", headers: bearer(key) });
    expect(info.json()).toMatchObject({ edition: "community", serial: null, revoked: { serial: "LIC-REVOKED" } });

    const allowed = await ctx.app.inject({ method: "POST", url: "/api/license", headers: bearer(key), payload: { key: activeLicense } });
    expect(allowed.statusCode).toBe(200);
    expect((allowed.json() as { edition: string; serial: string }).edition).toBe("enterprise");
    expect((allowed.json() as { serial: string }).serial).toBe("LIC-ACTIVE");
  } finally {
    await ctx.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
