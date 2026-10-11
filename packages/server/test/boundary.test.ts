import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// Modules that make up the private enterprise edition. Core (public) code may
// not import them. ALLOWED is empty: the boundary is strict.
const ENTERPRISE_MODULES = [
  "ee",
  "lib/authorization",
  "lib/agentAuth",
  "lib/delegation",
  "lib/risk",
  "lib/mcpGateway",
  "lib/mcpOAuth",
  "lib/attestation",
  "lib/graph",
  "lib/federation",
  "lib/resources",
  "lib/notifyApproval",
  "lib/policy",
  "lib/compliance",
  "lib/exporter",
  "lib/routing",
  "lib/embeddings",
  "lib/judge",
  "lib/onlineEval",
  "lib/guardrail",
  "lib/oidc",
  "routes/agentControl",
  "routes/authorize",
  "routes/gateway",
  "routes/a2a",
  "routes/agentUi",
];

const ALLOWED = new Set<string>([]);

const SRC = path.resolve(import.meta.dir, "../src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith(".ts") ? [full] : [];
  });
}

function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

function isEnterprise(relPath: string): boolean {
  const bare = relPath.replace(/\.ts$/, "");
  return ENTERPRISE_MODULES.some((m) => bare === m || bare.startsWith(`${m}/`));
}

function coreImportersOfEnterprise(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const self = rel(file);
    if (isEnterprise(self)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = rel(path.resolve(path.dirname(file), match[1]));
      if (isEnterprise(target)) {
        found.set(self, [...(found.get(self) ?? []), target]);
      }
    }
  }
  return found;
}

test("core never imports enterprise modules outside the shrinking allowlist", () => {
  const offenders = [...coreImportersOfEnterprise().entries()]
    .filter(([file]) => !ALLOWED.has(file))
    .map(([file, targets]) => `${file} -> ${targets.join(", ")}`);
  expect(offenders).toEqual([]);
});

test("the allowlist carries no stale entries", () => {
  const importers = coreImportersOfEnterprise();
  expect([...ALLOWED].filter((file) => !importers.has(file))).toEqual([]);
});

test("core source never references the enterprise package", () => {
  const hits = walk(SRC)
    .filter((file) => !isEnterprise(rel(file)))
    .filter((file) => /@torrix\/enterprise|packages\/enterprise/.test(fs.readFileSync(file, "utf8")));
  expect(hits.map(rel)).toEqual([]);
});
