import { expect, test } from "bun:test";
import { loadConfig } from "../src/core/config";
import { TRUSTED_LICENSE_KEYS } from "../src/core/licenseKeys";
import { grantFromLicense, loadStoredLicense, verifyLicense } from "../src/lib/license";
import { createTestDb, licenseSigner } from "./helpers";

test("TORRIX_EDITION alone never unlocks a paid edition", () => {
  for (const value of ["pro", "enterprise", "cloud", "PRO"]) {
    expect(loadConfig({ TORRIX_EDITION: value } as NodeJS.ProcessEnv).edition).toBe("community");
  }
  expect(loadConfig({} as NodeJS.ProcessEnv).editionConfig.onlineEvals).toBe(false);
});

test("TORRIX_EDITION caps a licensed edition but cannot raise it", async () => {
  const signer = await licenseSigner("cap");
  const enterpriseLicense = await signer.sign({ edition: "enterprise" });
  const verified = await verifyLicense(enterpriseLicense, [signer.trusted]);
  expect(verified.valid).toBe(true);

  const capped = loadConfig({ TORRIX_EDITION: "pro" } as NodeJS.ProcessEnv, { trustedKeys: [signer.trusted] });
  grantFromLicense(capped.license, verified.payload!);
  expect(capped.edition).toBe("pro");

  const uncapped = loadConfig({} as NodeJS.ProcessEnv, { trustedKeys: [signer.trusted] });
  grantFromLicense(uncapped.license, verified.payload!);
  expect(uncapped.edition).toBe("enterprise");
  expect(uncapped.editionConfig.oidcSso).toBe(true);
});

test("a legacy cloud license is honored as enterprise", async () => {
  const signer = await licenseSigner("legacy");
  const verified = await verifyLicense(await signer.sign({ edition: "cloud" }), [signer.trusted]);
  expect(verified.valid).toBe(true);
  const config = loadConfig({} as NodeJS.ProcessEnv, { trustedKeys: [signer.trusted] });
  grantFromLicense(config.license, verified.payload!);
  expect(config.edition).toBe("enterprise");
});

test("licenses signed by an untrusted key or naming an unknown kid are rejected", async () => {
  const attacker = await licenseSigner("k1");
  const forged = await attacker.sign({ edition: "enterprise" });
  expect(await verifyLicense(forged, TRUSTED_LICENSE_KEYS)).toMatchObject({ valid: false, reason: "bad_signature" });

  const stranger = await licenseSigner("nope");
  const unknown = await stranger.sign({ edition: "pro" });
  expect(await verifyLicense(unknown, TRUSTED_LICENSE_KEYS)).toMatchObject({ valid: false, reason: "unknown_key" });

  expect(await verifyLicense("a.b.c", TRUSTED_LICENSE_KEYS)).toMatchObject({ valid: false, reason: "malformed" });
});

test("an expired or tampered license is rejected", async () => {
  const signer = await licenseSigner("exp");
  const expired = await signer.sign({ edition: "pro", expires_at: "2001-01-01T00:00:00.000Z" });
  expect(await verifyLicense(expired, [signer.trusted])).toMatchObject({ valid: false, reason: "expired" });

  const good = await signer.sign({ edition: "pro" });
  const [, signature] = good.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ kid: "exp", edition: "enterprise" })).toString("base64url");
  expect(await verifyLicense(`${tamperedPayload}.${signature}`, [signer.trusted])).toMatchObject({
    valid: false,
    reason: "bad_signature",
  });
});

test("a license that lapses while running downgrades without a restart", () => {
  const config = loadConfig({} as NodeJS.ProcessEnv);
  config.license.apply({
    edition: "pro",
    licensee: "Acme",
    expiresAt: new Date(Date.now() + 50).toISOString(),
    source: "license",
  });
  expect(config.edition).toBe("pro");
  const until = Date.now() + 60;
  while (Date.now() < until) {
    // spin past the expiry instant
  }
  expect(config.edition).toBe("community");
  expect(config.license.activeGrant()).toBeNull();
});

test("a stored license is applied on boot through the trusted keys", async () => {
  const signer = await licenseSigner("boot");
  const ctx = await createTestDb();
  try {
    await ctx.repos.instance.set("license_key", await signer.sign({ edition: "pro", licensee: "Boot Co" }));
    const config = loadConfig({} as NodeJS.ProcessEnv, { trustedKeys: [signer.trusted] });
    await loadStoredLicense(ctx.repos, config.license, {} as NodeJS.ProcessEnv);
    expect(config.edition).toBe("pro");
    expect(config.license.activeGrant()?.licensee).toBe("Boot Co");

    const untrusting = loadConfig({} as NodeJS.ProcessEnv);
    await loadStoredLicense(ctx.repos, untrusting.license, {} as NodeJS.ProcessEnv);
    expect(untrusting.edition).toBe("community");
  } finally {
    await ctx.cleanup();
  }
});
