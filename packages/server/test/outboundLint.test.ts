import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

/**
 * Every request the server makes to an address a user or a remote system supplied
 * goes through guardedFetch (see AGENTS.md). This test parses the sources and fails
 * when a bare fetch() appears outside the reviewed list below, so the rule stays
 * true in practice. Page scripts inside template literals are not visited by the
 * parser, so only server-side code is checked.
 */
const ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const ROOTS = [path.join(ROOT, "packages", "server", "src"), path.join(ROOT, "packages", "enterprise", "src")];

const ALLOWED: Array<{ file: string; contains: string; reason: string }> = [
  {
    file: "packages/server/src/lib/outbound.ts",
    contains: "fetch(target, requestInit)",
    reason: "the guard itself, after the address was validated and pinned",
  },
  {
    file: "packages/server/src/routes/proxy.ts",
    contains: "fetch(effectiveTarget",
    reason: "LLM proxy upstream, checked by validateTargetUrl",
  },
  {
    file: "packages/server/src/routes/mcpProxy.ts",
    contains: "fetch(target",
    reason: "MCP proxy upstream, checked by validateTargetUrl",
  },
  {
    file: "packages/server/src/routes/api.ts",
    contains: "fetch(validation.url.toString()",
    reason: "run replay upstream, checked by validateTargetUrl",
  },
  {
    file: "packages/server/src/mcpStdio.ts",
    contains: "fetch(`${baseUrl}/mcp`",
    reason: "the stdio bridge talks to its own Torrix instance (TORRIX_URL)",
  },
  {
    file: "packages/server/src/lib/pricingSync.ts",
    contains: "fetch(url",
    reason: "fixed OpenRouter and LiteLLM price endpoints",
  },
  {
    file: "packages/server/src/lib/updateCheck.ts",
    contains: "fetch(`https://api.github.com/repos/${repo}/releases/latest`",
    reason: "fixed GitHub API host",
  },
  {
    file: "packages/server/src/server.ts",
    contains: 'fetch("https://telemetry.torrix.io/ping"',
    reason: "fixed telemetry host",
  },
];

interface FetchSite {
  file: string;
  line: number;
  snippet: string;
}

function scan(file: string, text: string): FetchSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const sites: FetchSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isFetch =
        (ts.isIdentifier(callee) && callee.text === "fetch") ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === "fetch");
      if (isFetch) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        sites.push({ file, line: line + 1, snippet: node.getText(source).replace(/\s+/g, " ").slice(0, 200) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("bare fetch() of a user-supplied address stays on the reviewed list", () => {
  const files = ROOTS.flatMap((root) => walk(root));
  const used = new Set<number>();
  const offenders: string[] = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    for (const site of scan(relative, text)) {
      const allowed = ALLOWED.findIndex((entry) => entry.file === site.file && site.snippet.includes(entry.contains));
      if (allowed >= 0) {
        used.add(allowed);
        continue;
      }
      offenders.push(`${site.file}:${site.line}: ${site.snippet.slice(0, 140)}`);
    }
  }
  expect(offenders).toEqual([]);
  const stale = ALLOWED.filter((entry, index) => !used.has(index)).map((entry) => `${entry.file} (${entry.reason})`);
  expect(stale).toEqual([]);
});
