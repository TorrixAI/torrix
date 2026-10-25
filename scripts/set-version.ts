// Sets one version across the server, image, Helm chart, SDKs and plugins.
//
//   bun scripts/set-version.ts 1.1.0
//
// Releases are tagged vX.Y.Z and CI checks that every package carries X.Y.Z.
import fs from "node:fs";
import path from "node:path";

const next = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error("usage: bun scripts/set-version.ts <major.minor.patch>");
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dir, "..");
const configPath = path.join(ROOT, "packages/server/src/core/config.ts");
const current = /version: "(\d+\.\d+\.\d+)"/.exec(fs.readFileSync(configPath, "utf8"))?.[1];
if (!current) {
  console.error("could not read the current version from packages/server/src/core/config.ts");
  process.exit(1);
}

const esc = current.replace(/\./g, "\\.");
const targets: Array<[string, RegExp[]]> = [
  ["packages/server/src/core/config.ts", [new RegExp(`(version: ")${esc}(")`)]],
  ["package.json", [new RegExp(`("version": ")${esc}(")`)]],
  ["packages/server/package.json", [new RegExp(`("version": ")${esc}(")`)]],
  ["packages/enterprise/package.json", [new RegExp(`("version": ")${esc}(")`)]],
  ["packages/sdk-ts/package.json", [new RegExp(`("version": ")${esc}(")`)]],
  ["packages/claude-code-plugin/package.json", [new RegExp(`("version": ")${esc}(")`)]],
  ["packages/claude-code-plugin/.claude-plugin/plugin.json", [new RegExp(`("version": ")${esc}(")`)]],
  [".claude-plugin/marketplace.json", [new RegExp(`("version": ")${esc}(")`)]],
  ["packages/enterprise/src/index.ts", [new RegExp(`(_VERSION = ")${esc}(")`)]],
  ["packages/enterprise/src/lib/mcpGateway.ts", [new RegExp(`(name: "torrix", version: ")${esc}(")`, "g")]],
  ["packages/sdk-ts/src/client.ts", [new RegExp(`(torrix-sdk/)${esc}(")`)]],
  ["packages/sdk-java/src/main/java/dev/torrix/TorrixClient.java", [new RegExp(`(torrix-sdk-java/)${esc}(")`)]],
  ["packages/sdk-python/pyproject.toml", [new RegExp(`^(version = ")${esc}(")`, "m")]],
  ["packages/sdk-python/torrix/__init__.py", [new RegExp(`(__version__ = ")${esc}(")`)]],
  ["packages/sdk-python/torrix/_client.py", [new RegExp(`(torrix-sdk/)${esc}()`)]],
  ["deploy/helm/torrix/Chart.yaml", [new RegExp(`^(version: )${esc}()$`, "m"), new RegExp(`^(appVersion: ")${esc}(")$`, "m")]],
  ["deploy/helm/torrix/values.yaml", [new RegExp(`(tag: ")${esc}(")`)]],
  ["docker-compose.pro.yml", [new RegExp(`(image: gettorrixai/[a-z-]+:)${esc}()`)]],
  ["packages/sdk-dotnet/Torrix.Sdk.csproj", [new RegExp(`(<Version>)${esc}(</Version>)`)]],
  ["packages/sdk-java/pom.xml", [new RegExp(`(<version>)${esc}(</version>)`)]],
];

let changed = 0;
for (const [rel, patterns] of targets) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    continue;
  }
  let text = fs.readFileSync(file, "utf8");
  for (const pattern of patterns) {
    if (!pattern.test(text)) {
      console.error(`${rel}: version ${current} not found, fix it by hand`);
      process.exit(2);
    }
    text = text.replace(pattern, `$1${next}$2`);
  }
  fs.writeFileSync(file, text);
  changed += 1;
}
console.log(`version ${current} -> ${next} in ${changed} files. Run bun install to refresh bun.lock.`);
