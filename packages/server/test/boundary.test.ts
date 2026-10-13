import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// Phase 5 moved the paid code into packages/enterprise. Core (public) code and
// tests must never reach into it, and the old in-core location must stay gone.
const SRC = path.resolve(import.meta.dir, "../src");
const TEST = path.resolve(import.meta.dir);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith(".ts") ? [full] : [];
  });
}

function offenders(files: string[]): string[] {
  return files
    .filter((file) => /@torrix\/enterprise|packages\/enterprise|\.\.\/src\/ee/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(TEST, file).split(path.sep).join("/"));
}

test("core source never references the enterprise package", () => {
  expect(offenders(walk(SRC))).toEqual([]);
});

test("core tests never reference the enterprise package", () => {
  const files = walk(TEST).filter((file) => !file.endsWith("boundary.test.ts"));
  expect(offenders(files)).toEqual([]);
});

test("the paid code no longer lives inside the core package", () => {
  expect(fs.existsSync(path.join(SRC, "ee"))).toBe(false);
});
