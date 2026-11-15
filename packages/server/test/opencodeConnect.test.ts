import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeCodeInstallScript,
  claudeCodeInstallScriptPowerShell,
  opencodeInstallScript,
  opencodeInstallScriptPowerShell,
} from "../src/connect/scripts";
// @ts-expect-error the server serves this asset as text; this test imports its functions.
import { resolveConnection } from "../src/assets/opencode-torrix.plugin.js";

test("the opencode plugin prefers the environment and falls back to the installed file", () => {
  const file = { url: "http://file:8088/", api_key: "file-key", project: "file-project", tags: "team=core" };
  const fromFile = resolveConnection({}, file);
  expect(fromFile.url).toBe("http://file:8088");
  expect(fromFile.apiKey).toBe("file-key");
  expect(fromFile.project).toBe("file-project");
  expect(fromFile.tags).toEqual({ team: "core" });

  const fromEnv = resolveConnection({ TORRIX_API_KEY: "env-key", TORRIX_URL: "http://env:8088" }, file);
  expect(fromEnv.apiKey).toBe("env-key");
  expect(fromEnv.url).toBe("http://env:8088");
});

// Real API keys are trxk_ plus a 32-character UUID, so documentation
// placeholders like "trxk_..." do not count as a leaked key.
const REAL_KEY = /trxk_[0-9a-f]{32}/;

test("installer scripts carry the instance URL and no API key", () => {
  const posix = opencodeInstallScript("https://torrix.internal:9000/");
  expect(posix).toContain("https://torrix.internal:9000");
  expect(posix.split("TORRIX_OPENCODE_PLUGIN_EOF").length - 1).toBe(2);
  expect(posix).not.toMatch(REAL_KEY);
  expect(posix).toContain("opencode.json");

  const powershell = opencodeInstallScriptPowerShell("https://torrix.internal:9000/");
  expect(powershell).toContain("https://torrix.internal:9000");
  expect(powershell).toContain("opencode.json");
  expect(powershell).not.toMatch(REAL_KEY);

  const claude = claudeCodeInstallScript("https://torrix.internal:9000", "acme/torrix-plugins");
  expect(claude).toContain("claude plugin install torrix");
  expect(claude).toContain("MARKETPLACE='acme/torrix-plugins'");
  expect(claude).not.toMatch(REAL_KEY);

  const claudePs = claudeCodeInstallScriptPowerShell("https://torrix.internal:9000", "acme/torrix-plugins");
  expect(claudePs).toContain("$Marketplace = 'acme/torrix-plugins'");
  expect(claudePs).not.toMatch(REAL_KEY);
});

test("the opencode installer writes the plugin and a private connection file", async () => {
  if (process.platform === "win32") return;
  const home = mkdtempSync(join(tmpdir(), "torrix-connect-"));
  try {
    const script = join(home, "install.sh");
    await Bun.write(script, opencodeInstallScript("http://localhost:8088"));
    const run = Bun.spawnSync(["sh", script], {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), TORRIX_API_KEY: "trxk_test_key" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);

    const pluginPath = join(home, ".config", "opencode", "plugins", "torrix.js");
    const configPath = join(home, ".torrix", "opencode.json");
    expect(readFileSync(pluginPath, "utf8")).toContain("Torrix observability plugin");
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      url: "http://localhost:8088",
      api_key: "trxk_test_key",
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the claude installer keeps a local marketplace only when it exists", async () => {
  if (process.platform === "win32") return;
  const home = mkdtempSync(join(tmpdir(), "torrix-claude-"));
  try {
    const bin = join(home, "bin");
    mkdirSync(bin);
    const record = join(home, "args.txt");
    const claude = join(bin, "claude");
    writeFileSync(claude, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\nexit 0\n`);
    chmodSync(claude, 0o755);

    const script = join(home, "install.sh");
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}`, TORRIX_API_KEY: "trxk_test_key" };

    await Bun.write(script, claudeCodeInstallScript("http://localhost:8088", "/definitely/missing/marketplace"));
    expect(Bun.spawnSync(["sh", script], { env, stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
    const fallbackArgs = readFileSync(record, "utf8");
    expect(fallbackArgs).toContain("--marketplace\nTorrixAI/torrix");
    expect(fallbackArgs).not.toContain("/definitely/missing/marketplace");

    const local = join(home, "marketplace");
    mkdirSync(local);
    await Bun.write(script, claudeCodeInstallScript("http://localhost:8088", local));
    expect(Bun.spawnSync(["sh", script], { env, stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
    expect(readFileSync(record, "utf8")).toContain(local);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
