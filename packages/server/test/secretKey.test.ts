import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptSecret, encryptSecret, ensureSecretKey, secretsEncrypted } from "../src/lib/secrets";

let dir: string;
let saved: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "torrix-key-"));
  saved = process.env.TORRIX_SECRET_KEY;
  delete process.env.TORRIX_SECRET_KEY;
});

afterEach(() => {
  if (saved === undefined) delete process.env.TORRIX_SECRET_KEY;
  else process.env.TORRIX_SECRET_KEY = saved;
  rmSync(dir, { recursive: true, force: true });
});

test("a key is created next to the database and credentials are encrypted from the first write", async () => {
  expect(secretsEncrypted()).toBe(false);
  const db = join(dir, "torrix.sqlite");
  expect(ensureSecretKey(db)).toBe("created");
  const file = join(dir, "torrix.secret.key");
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, "utf8").trim().length).toBeGreaterThanOrEqual(40);
  if (process.platform !== "win32") {
    expect(statSync(file).mode & 0o077).toBe(0);
  }
  expect(secretsEncrypted()).toBe(true);
  const stored = await encryptSecret("bearer-token-123");
  expect(stored.startsWith("enc:v1:")).toBe(true);
  expect(stored).not.toContain("bearer-token-123");
  expect(await decryptSecret(stored)).toBe("bearer-token-123");
});

test("the same key is reused on the next start, so earlier credentials stay readable", async () => {
  const db = join(dir, "torrix.sqlite");
  expect(ensureSecretKey(db)).toBe("created");
  const stored = await encryptSecret("api-key-xyz");
  delete process.env.TORRIX_SECRET_KEY;
  expect(ensureSecretKey(db)).toBe("file");
  expect(await decryptSecret(stored)).toBe("api-key-xyz");
});

test("a key the operator set is never replaced", () => {
  process.env.TORRIX_SECRET_KEY = "operator-chosen-key";
  expect(ensureSecretKey(join(dir, "torrix.sqlite"))).toBe("env");
  expect(existsSync(join(dir, "torrix.secret.key"))).toBe(false);
  expect(process.env.TORRIX_SECRET_KEY).toBe("operator-chosen-key");
});

test("an unwritable location falls back to the warning instead of failing the start", () => {
  const blocker = join(dir, "not-a-directory");
  writeFileSync(blocker, "x");
  expect(ensureSecretKey(join(blocker, "nested", "torrix.sqlite"))).toBe("none");
  expect(secretsEncrypted()).toBe(false);
});

test("credentials saved before a key existed are still readable afterwards", async () => {
  const plain = await encryptSecret("saved-before-the-key");
  expect(plain.startsWith("plain:")).toBe(true);
  ensureSecretKey(join(dir, "torrix.sqlite"));
  expect(await decryptSecret(plain)).toBe("saved-before-the-key");
  expect((await encryptSecret("saved-after")).startsWith("enc:v1:")).toBe(true);
});
