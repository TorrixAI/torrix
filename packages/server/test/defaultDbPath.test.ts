import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultDbPath, loadConfig } from "../src/core/config";

const serverDir = path.resolve(import.meta.dir, "..");

test("the default database is anchored to packages/server whatever folder starts the process", () => {
  const expected = path.join(serverDir, "torrix.sqlite");
  expect(loadConfig({}).dbPath).toBe(expected);

  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "dbpath-"));
  const before = process.cwd();
  try {
    process.chdir(elsewhere);
    expect(loadConfig({}).dbPath).toBe(expected);
  } finally {
    process.chdir(before);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("an explicit DB_PATH is used exactly as given", () => {
  expect(loadConfig({ DB_PATH: "mine.sqlite" }).dbPath).toBe("mine.sqlite");
  const absolute = path.join(os.tmpdir(), "x.sqlite");
  expect(loadConfig({ DB_PATH: absolute }).dbPath).toBe(absolute);
});

test("compiled binaries and trees without the server package keep the working-folder default", () => {
  expect(defaultDbPath("/$bunfs/root/core")).toBe("torrix.sqlite");
  expect(defaultDbPath("B:\\~BUN\\root\\core")).toBe("torrix.sqlite");
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "nopkg-"));
  try {
    fs.mkdirSync(path.join(bare, "a", "b"), { recursive: true });
    expect(defaultDbPath(path.join(bare, "a", "b"))).toBe("torrix.sqlite");
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});
