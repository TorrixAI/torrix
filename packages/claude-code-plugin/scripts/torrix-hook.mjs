#!/usr/bin/env node
// Claude Code hook: forwards new transcript entries to Torrix `/api/ingest`.
// Runs on Stop, SubagentStop and SessionEnd. It must never disturb Claude Code,
// so every failure is swallowed, logged to the plugin data dir, and retried on
// the next hook (ingest ids are stable, so retries never duplicate runs).
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { convertLines } from "./transcript.mjs";

const BATCH = 200;
const LOCK_STALE_MS = 60_000;

const env = process.env;
const settings = {
  baseUrl: (env.CLAUDE_PLUGIN_OPTION_BASE_URL || env.TORRIX_BASE_URL || "http://127.0.0.1:8088").replace(/\/+$/, ""),
  apiKey: env.CLAUDE_PLUGIN_OPTION_API_KEY || env.TORRIX_API_KEY || "",
  project: env.CLAUDE_PLUGIN_OPTION_PROJECT || env.TORRIX_PROJECT || "",
  disabled: env.TORRIX_DISABLED === "1",
  timeoutMs: Number(env.TORRIX_HOOK_TIMEOUT_MS) > 0 ? Number(env.TORRIX_HOOK_TIMEOUT_MS) : 10_000,
};
const dataDir = env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".torrix", "claude-code");

function log(message) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, "torrix-hook.log");
    if (fs.existsSync(file) && fs.statSync(file).size > 256_000) {
      fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // logging is best-effort
  }
}

function stateFile(key, suffix) {
  const name = crypto.createHash("sha1").update(key).digest("hex").slice(0, 20);
  return path.join(dataDir, "state", `${name}.${suffix}.json`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function tryLock(lock) {
  try {
    if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
      fs.rmSync(lock, { force: true });
    }
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

// Stop and SubagentStop hooks can run at the same time; waiting briefly for a
// held lock keeps the main transcript (and its tool map) ahead of subagents.
async function withLock(key, fn) {
  const lock = stateFile(key, "lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (tryLock(lock)) {
      try {
        await fn();
        return true;
      } finally {
        fs.rmSync(lock, { force: true });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function post(records) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${settings.apiKey}` };
  if (settings.project) {
    headers["x-torrix-project"] = settings.project;
  }
  for (let i = 0; i < records.length; i += BATCH) {
    const res = await fetch(`${settings.baseUrl}/api/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({ records: records.slice(i, i + BATCH) }),
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`ingest ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}

/** Reads complete lines appended since the stored offset. */
function readNewLines(file, offset) {
  const size = fs.statSync(file).size;
  const start = size < offset ? 0 : offset;
  if (size === start) {
    return { lines: [], next: start, reset: size < offset };
  }
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline < 0) {
      return { lines: [], next: start, reset: size < offset };
    }
    const text = buffer.subarray(0, lastNewline).toString("utf8");
    return { lines: text.split("\n").filter((l) => l.trim()), next: start + lastNewline + 1, reset: size < offset };
  } finally {
    fs.closeSync(fd);
  }
}

function toolMapFile(sessionKey) {
  return stateFile(sessionKey, "tools");
}

async function processTranscript(file, ctx, sessionKey) {
  if (!file || !fs.existsSync(file)) {
    return;
  }
  await withLock(file, async () => {
    const stateKey = stateFile(file, "offset");
    const saved = readJson(stateKey, { offset: 0, carry: {} });
    const { lines, next, reset } = readNewLines(file, saved.offset);
    if (!lines.length) {
      return;
    }
    const { records, carry, toolUseRuns } = convertLines(lines, reset ? {} : saved.carry, ctx);
    if (Object.keys(toolUseRuns).length) {
      const mapFile = toolMapFile(sessionKey);
      writeJson(mapFile, { ...readJson(mapFile, {}), ...toolUseRuns });
    }
    if (records.length) {
      await post(records);
    }
    writeJson(stateKey, { offset: next, carry });
  });
}

function subagentContext(agentFile, sessionKey, fallbackType) {
  const meta = readJson(agentFile.replace(/\.jsonl$/, ".meta.json"), {});
  const tools = readJson(toolMapFile(sessionKey), {});
  const agentId = path.basename(agentFile, ".jsonl").replace(/^agent-/, "");
  return {
    agentName: meta.agentType || fallbackType || "subagent",
    agentId: agentId || undefined,
    parentRunId: meta.toolUseId ? tools[meta.toolUseId] : undefined,
  };
}

function subagentFiles(mainTranscript) {
  const dir = path.join(mainTranscript.replace(/\.jsonl$/, ""), "subagents");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  if (settings.disabled || !settings.apiKey) {
    return;
  }
  const input = await readStdin();
  const transcript = input.transcript_path;
  if (!transcript) {
    return;
  }
  const sessionKey = input.session_id || transcript;
  const mainCtx = { agentName: "claude-code", sessionFallback: input.session_id };
  // The main transcript goes first so subagent runs can find their parent's tool_use.
  await processTranscript(transcript, mainCtx, sessionKey);
  const subagents =
    input.hook_event_name === "SubagentStop" && input.agent_transcript_path
      ? [input.agent_transcript_path]
      : input.hook_event_name === "SessionEnd"
        ? subagentFiles(transcript)
        : [];
  for (const file of subagents) {
    const ctx = { ...subagentContext(file, sessionKey, input.agent_type), sessionFallback: input.session_id };
    await processTranscript(file, ctx, sessionKey);
  }
}

main()
  .catch((err) => log(`error: ${err && err.message ? err.message : String(err)}`))
  .finally(() => process.exit(0));
