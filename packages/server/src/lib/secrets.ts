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
  if (!material) {
    return null;
  }
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
