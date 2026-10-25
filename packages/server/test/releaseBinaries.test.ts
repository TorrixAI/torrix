import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

test("release targets match install.sh and the release workflow", () => {
  const compile = read("scripts/compile.ts");
  for (const target of ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-x64", "bun-darwin-arm64", "bun-windows-x64"]) {
    expect(compile).toContain(`"${target}"`);
  }
  expect(compile).toContain("torrix-${spec.os}-${spec.arch}");
  expect(compile).toContain("--verify");

  const install = read("deploy/install.sh");
  expect(install).toContain('asset="torrix-${os}-${arch}"');

  const workflow = read(".github/workflows/release-binaries.yml");
  expect(workflow).toContain("bun run compile:all");
  expect(workflow).toContain("SHA256SUMS");
  expect(workflow).toContain("gh release upload");
  expect(() => Bun.YAML.parse(workflow)).not.toThrow();

  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  expect(pkg.scripts.compile).toBe("bun scripts/compile.ts");
  expect(pkg.scripts["compile:all"]).toBe("bun scripts/compile.ts --all");
});
