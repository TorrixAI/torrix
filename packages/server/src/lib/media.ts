import * as fs from "node:fs";
import * as path from "node:path";
import type { MediaPart } from "./extract";

export interface MediaAsset {
  kind: MediaPart["kind"];
  mime: string | null;
  source: MediaPart["source"];
  ref: string;
  bytes: number | null;
  sha256: string;
  stored_path?: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function extensionFor(mime: string | null): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
  };
  return (mime && map[mime]) || ".bin";
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PersistOptions {
  maxBytes?: number;
}

/**
 * Persists inline media payloads (data URLs / base64 blocks) to disk next to the
 * database and returns metadata for every part. Remote references are recorded
 * without downloading. Failures to write a single part never throw; the part is
 * still described by its hash.
 */
export async function persistMedia(dir: string, parts: MediaPart[], opts: PersistOptions = {}): Promise<MediaAsset[]> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const assets: MediaAsset[] = [];
  for (const part of parts) {
    const sha256 = await sha256Hex(part.inline ?? part.ref);
    const asset: MediaAsset = {
      kind: part.kind,
      mime: part.mime,
      source: part.source,
      ref: part.inline ? `${part.source}:${sha256.slice(0, 16)}` : part.ref,
      bytes: part.bytes,
      sha256,
    };
    if (part.inline && (part.bytes ?? 0) <= maxBytes) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const filename = `${sha256.slice(0, 32)}${extensionFor(part.mime)}`;
        const target = path.join(dir, filename);
        if (!fs.existsSync(target)) {
          fs.writeFileSync(target, Buffer.from(part.inline, "base64"));
        }
        asset.stored_path = filename;
      } catch {
        delete asset.stored_path;
      }
    }
    assets.push(asset);
  }
  return assets;
}
