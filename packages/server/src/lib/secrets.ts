import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PREFIX = "enc:v1:";
const PLAIN_PREFIX = "plain:";
let warnedMissingKey = false;

function keyMaterial(): string | null {
  const raw = process.env.TORRIX_SECRET_KEY;
  if (!raw || !raw.trim()) {
    return null;
  }
  return raw.trim();
}

/** The key a deployment is rotating away from; it only ever decrypts. */
function previousKeyMaterial(): string | null {
  const raw = process.env.TORRIX_SECRET_KEY_PREVIOUS;
  if (!raw || !raw.trim()) {
    return null;
  }
  return raw.trim();
}

async function deriveKey(material: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const raw = Buffer.from(value, "base64");
  const bytes = new Uint8Array(new ArrayBuffer(raw.byteLength));
  bytes.set(raw);
  return bytes;
}

export function secretsEncrypted(): boolean {
  return keyMaterial() !== null;
}

export async function encryptSecret(plain: string): Promise<string> {
  const material = keyMaterial();
  if (!material) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn("[torrix] TORRIX_SECRET_KEY is not set; MCP credentials are stored in plaintext");
    }
    return `${PLAIN_PREFIX}${plain}`;
  }
  const key = await deriveKey(material);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

async function decryptWith(material: string, stored: string): Promise<string | null> {
  const [ivPart, cipherPart] = stored.slice(PREFIX.length).split(":");
  if (!ivPart || !cipherPart) {
    return null;
  }
  try {
    const key = await deriveKey(material);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivPart) },
      key,
      fromBase64(cipherPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function decryptSecret(stored: string | null | undefined): Promise<string | null> {
  if (!stored) {
    return null;
  }
  if (stored.startsWith(PLAIN_PREFIX)) {
    return stored.slice(PLAIN_PREFIX.length);
  }
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }
  const material = keyMaterial();
  if (material) {
    const plain = await decryptWith(material, stored);
    if (plain !== null) {
      return plain;
    }
  }
  const previous = previousKeyMaterial();
  if (previous) {
    return decryptWith(previous, stored);
  }
  return null;
}

export interface SecretReencryptResult {
  value: string | null;
  /** True when the stored value was rewritten with the current key. */
  rotated: boolean;
  /** True when neither the current nor the previous key can read the value. */
  unreadable: boolean;
}

/**
 * Rewrites one stored secret with the current key. Plaintext from before a key
 * existed is encrypted; a value written with `TORRIX_SECRET_KEY_PREVIOUS` is
 * moved onto `TORRIX_SECRET_KEY`. Without a key the value is returned untouched.
 */
export async function reencryptSecret(stored: string | null | undefined): Promise<SecretReencryptResult> {
  if (!stored) {
    return { value: null, rotated: false, unreadable: false };
  }
  if (!keyMaterial()) {
    return { value: stored, rotated: false, unreadable: false };
  }
  if (!stored.startsWith(PREFIX)) {
    const plain = stored.startsWith(PLAIN_PREFIX) ? stored.slice(PLAIN_PREFIX.length) : stored;
    return { value: await encryptSecret(plain), rotated: true, unreadable: false };
  }
  const material = keyMaterial()!;
  if ((await decryptWith(material, stored)) !== null) {
    return { value: stored, rotated: false, unreadable: false };
  }
  const previous = previousKeyMaterial();
  const viaPrevious = previous ? await decryptWith(previous, stored) : null;
  if (viaPrevious === null) {
    return { value: stored, rotated: false, unreadable: true };
  }
  return { value: await encryptSecret(viaPrevious), rotated: true, unreadable: false };
}

export type SecretKeySource = "env" | "file" | "created" | "none";

/**
 * Secure by default for SQLite installs. With no TORRIX_SECRET_KEY, a key is
 * created next to the database file (readable by the owner only) and reused on
 * every start, so stored credentials are encrypted without any setup. Back the
 * file up with the database, or set TORRIX_SECRET_KEY yourself. Postgres and
 * other setups must set the variable: a key generated on a disk that does not
 * persist would be lost along with every credential it protected.
 */
export function ensureSecretKey(dbPath: string): SecretKeySource {
  if (keyMaterial() !== null) {
    return "env";
  }
  const file = join(dirname(resolve(dbPath)), "torrix.secret.key");
  try {
    if (existsSync(file)) {
      const saved = readFileSync(file, "utf8").trim();
      if (saved) {
        process.env.TORRIX_SECRET_KEY = saved;
        return "file";
      }
    }
    mkdirSync(dirname(file), { recursive: true });
    const created = randomBytes(32).toString("base64url");
    writeFileSync(file, `${created}\n`, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      // not every filesystem supports modes
    }
    process.env.TORRIX_SECRET_KEY = created;
    return "created";
  } catch (err) {
    console.warn(`[torrix] could not create a secret key file (${(err as Error).message}); set TORRIX_SECRET_KEY to encrypt stored credentials`);
    return "none";
  }
}
