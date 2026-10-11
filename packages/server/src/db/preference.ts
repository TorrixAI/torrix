import * as fs from "node:fs";
import * as path from "node:path";

export interface DbPreference {
  driver: "sqlite" | "postgres";
  url?: string;
  path?: string;
}

/**
 * The engine choice lives in a tiny JSON file next to the SQLite payload file,
 * not inside any database, so it survives a full engine swap and reboot.
 */
export function preferenceFilePath(dbPath: string): string {
  return path.join(path.dirname(path.resolve(dbPath)), "db.preference.json");
}

export function loadPreference(filePath: string): DbPreference | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (parsed.driver !== "sqlite" && parsed.driver !== "postgres") {
      return null;
    }
    const pref: DbPreference = { driver: parsed.driver };
    if (typeof parsed.url === "string" && parsed.url) {
      pref.url = parsed.url;
    }
    if (typeof parsed.path === "string" && parsed.path) {
      pref.path = parsed.path;
    }
    return pref;
  } catch {
    return null;
  }
}

export function savePreference(filePath: string, pref: DbPreference): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(pref, null, 2)}\n`, "utf8");
}

export function removePreference(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // not fatal
  }
}

export function maskDbUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) {
      u.password = "••••••";
    }
    return u.toString();
  } catch {
    return url.length > 14 ? `${url.slice(0, 10)}…` : url;
  }
}