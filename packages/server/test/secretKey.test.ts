import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptSecret, encryptSecret, ensureSecretKey, reencryptSecret, secretsEncrypted } from "../src/lib/secrets";

let dir: string;
let saved: string | undefined;
let savedPrevious: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "torrix-key-"));
  saved = process.env.TORRIX_SECRET_KEY;
  savedPrevious = process.env.TORRIX_SECRET_KEY_PREVIOUS;
  delete process.env.TORRIX_SECRET_KEY;
  delete process.env.TORRIX_SECRET_KEY_PREVIOUS;
});

afterEach(() => {
  if (saved === undefined) delete process.env.TORRIX_SECRET_KEY;
  else process.env.TORRIX_SECRET_KEY = saved;
  if (savedPrevious === undefined) delete process.env.TORRIX_SECRET_KEY_PREVIOUS;
  else process.env.TORRIX_SECRET_KEY_PREVIOUS = savedPrevious;
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

test("a rotated key reads old values through TORRIX_SECRET_KEY_PREVIOUS and re-encrypts them", async () => {
  process.env.TORRIX_SECRET_KEY = "old-key";
  const stored = await encryptSecret("judge-key");
  process.env.TORRIX_SECRET_KEY = "new-key";
  process.env.TORRIX_SECRET_KEY_PREVIOUS = "old-key";

  expect(await decryptSecret(stored)).toBe("judge-key");
  const rotated = await reencryptSecret(stored);
  expect(rotated).toMatchObject({ rotated: true, unreadable: false });
  delete process.env.TORRIX_SECRET_KEY_PREVIOUS;
  expect(await decryptSecret(rotated.value)).toBe("judge-key");
  expect((await reencryptSecret(rotated.value)).rotated).toBe(false);
});

test("plaintext saved before a key existed is encrypted by reencryptSecret", async () => {
  process.env.TORRIX_SECRET_KEY = "fresh-key";
  const result = await reencryptSecret("plain:saved-before-the-key");
  expect(result.rotated).toBe(true);
  expect(result.value!.startsWith("enc:v1:")).toBe(true);
  expect(await decryptSecret(result.value)).toBe("saved-before-the-key");
});

test("reencryptSecret reports a value neither key can read instead of dropping it", async () => {
  process.env.TORRIX_SECRET_KEY = "key-a";
  const stored = await encryptSecret("unreadable-secret");
  process.env.TORRIX_SECRET_KEY = "key-b";
  expect(await reencryptSecret(stored)).toMatchObject({ value: stored, rotated: false, unreadable: true });
});
