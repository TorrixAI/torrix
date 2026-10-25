// Builds the Community release binaries named for deploy/install.sh:
//   torrix-linux-x64, torrix-linux-arm64, torrix-darwin-x64,
//   torrix-darwin-arm64, torrix-windows-x64.exe
//
//   bun run compile                 host platform
//   bun run compile:all             every target
//   bun run compile --verify        boot the host build once
//
// Output: <repo>/dist/torrix-<os>-<arch>[.exe]
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";

const PKG_DIR = path.resolve(import.meta.dir, "..", "packages", "server");
const ROOT = path.resolve(PKG_DIR, "..", "..");
const DRIZZLE_DIR = path.join(ROOT, "packages", "server", "drizzle");

const TARGETS: Record<string, { os: string; arch: string }> = {
  "bun-linux-x64": { os: "linux", arch: "x64" },
  "bun-linux-arm64": { os: "linux", arch: "arm64" },
  "bun-darwin-x64": { os: "darwin", arch: "x64" },
  "bun-darwin-arm64": { os: "darwin", arch: "arm64" },
  "bun-windows-x64": { os: "windows", arch: "x64" },
};

function hostTarget(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `bun-${platform}-${arch}`;
}

function outputFile(outDir: string, target: string): string {
  const spec = TARGETS[target]!;
  return path.join(outDir, `torrix-${spec.os}-${spec.arch}${spec.os === "windows" ? ".exe" : ""}`);
}

const verify = process.argv.includes("--verify");
const all = process.argv.includes("--all");
const outDir = path.resolve(ROOT, "dist");
const requested = process.argv
  .slice(2)
  .filter((arg) => arg.startsWith("--target="))
  .map((arg) => arg.slice("--target=".length));
const targets = all ? Object.keys(TARGETS) : requested.length > 0 ? requested : [hostTarget()];

for (const target of targets) {
  if (!TARGETS[target]) {
    console.error(`unknown target ${target}; expected one of ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
  const outfile = outputFile(outDir, target);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`compiling ${target} -> ${path.relative(ROOT, outfile)}`);
  const result = Bun.spawnSync(
    [process.execPath, "build", "--compile", "--minify", "--target", target, "--outfile", outfile, "src/index.ts"],
    { cwd: PKG_DIR, stdout: "inherit", stderr: "inherit" },
  );
  if (result.exitCode !== 0) {
    console.error(`compile failed for ${target}`);
    process.exit(1);
  }
}

if (verify) {
  const host = hostTarget();
  const outfile = outputFile(outDir, host);
  if (!targets.includes(host)) {
    console.error(`--verify needs the host build (${host}); add it to --target or use --all`);
    process.exit(1);
  }
  await verifyBinary(outfile);
  console.log("verify passed: booted, migrations applied, assets served, Community routes only");
}

async function verifyBinary(file: string): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "torrix-verify-"));
  const dbPath = path.join(dataDir, "torrix.sqlite");
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  const proc = Bun.spawn([file], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      TORRIX_OPEN_BROWSER: "false",
      TORRIX_TELEMETRY: "false",
      TORRIX_PRICING_SYNC: "false",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  const base = `http://127.0.0.1:${port}`;
  let error: string | null = null;
  try {
    if (!(await pollHealth(base, proc, 30_000))) {
      error = "the binary did not answer /health within 30s";
    } else {
      const logo = await fetch(`${base}/ui/assets/torrix-logo.png`);
      if (!logo.ok || (await logo.arrayBuffer()).byteLength === 0) {
        error = "the embedded logo asset is missing from the binary";
      }
      if (!error) {
        const font = await fetch(`${base}/ui/fonts/geist-latin.woff2`);
        if (!font.ok || (await font.arrayBuffer()).byteLength === 0) {
          error = "the embedded font asset is missing from the binary";
        }
      }
      if (!error) {
        const agents = await fetch(`${base}/ui/agents`, { redirect: "manual" });
        if (agents.status !== 302 || !String(agents.headers.get("location")).includes("/ui/agents/observed")) {
          error = `Community /ui/agents should redirect to the observed view, got ${agents.status}`;
        }
      }
      if (!error) {
        const paid = await fetch(`${base}/api/v1/agents`);
        if (paid.status !== 404) {
          error = `paid routes must not exist in the Community binary, got ${paid.status}`;
        }
      }
    }
  } finally {
    proc.kill();
    await proc.exited;
  }

  try {
    if (error) {
      const stderr = await new Response(proc.stderr as ReadableStream).text().catch(() => "");
      if (stderr.trim()) {
        console.error(stderr.trim());
      }
      throw new Error(`verify failed: ${error}`);
    }
    const expected = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")).length;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT COUNT(*) AS c FROM _migrations").get() as { c: number } | null;
      if (!row || Number(row.c) !== expected) {
        throw new Error(`verify failed: expected ${expected} core migrations, found ${row?.c ?? 0}`);
      }
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function pollHealth(base: string, proc: { exitCode: number | null }, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      return false;
    }
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        return true;
      }
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
  return false;
}
