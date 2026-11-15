#!/usr/bin/env node
// Claude Code PreToolUse hook: asks Torrix whether a tool call may run.
//
//   TORRIX_GUARD       off | observe | enforce   (default off)
//   TORRIX_GUARD_FAIL  open | closed             (default open)
//   TORRIX_AGENT_KEY   trxa_... credential with the authorize scope
//
// The hook never prints a decision unless enforcement is on. In observe mode it
// asks Torrix and logs the answer, but Claude Code still runs the tool. In
// enforce mode an allow, deny or held decision becomes allow, deny or ask. If
// Torrix cannot be reached, "open" allows the tool and "closed" denies it.
import * as fs from "node:fs";

function setting(name, fallback) {
  return String(process.env[`CLAUDE_PLUGIN_OPTION_${name}`] || process.env[`TORRIX_${name}`] || fallback).trim();
}

function output(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
}

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const guard = setting("GUARD", "off").toLowerCase();
  const failMode = setting("GUARD_FAIL", "open").toLowerCase();
  const agentKey = setting("AGENT_KEY", "");
  const baseUrl = setting("BASE_URL", "http://127.0.0.1:8088").replace(/\/+$/, "");
  const input = readInput();

  if (guard === "off" || !agentKey || !input) {
    return;
  }
  const toolName = String(input.tool_name || "tool").slice(0, 120);
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const payload = {
    action: toolName,
    resourceType: "tool",
    resourceId: toolName,
    toolName,
    targetSystem: "claude-code",
    protocol: "sdk",
    params: toolInput,
    context: {
      client: "claude-code",
      cwd: input.cwd || null,
      permission_mode: input.permission_mode || null,
    },
    sessionId: input.session_id || null,
    traceId: input.session_id || null,
  };

  let decision = "ALLOW";
  let reason = "";
  try {
    const response = await fetch(`${baseUrl}/api/v1/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${agentKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`authorize returned ${response.status}`);
    }
    const body = await response.json();
    decision = String(body.decision || "").toUpperCase();
    reason = String(body.reason || body.reasonCode || "");
  } catch (error) {
    if (guard === "observe") {
      return;
    }
    if (failMode === "closed") {
      output("deny", `Torrix unavailable (${error?.message || error}); blocked by fail-closed policy.`);
      return;
    }
    output("allow", `Torrix unavailable (${error?.message || error}); allowed by fail-open policy.`);
    return;
  }

  if (guard === "observe") {
    return;
  }
  if (decision === "DENY") {
    output("deny", `Torrix denied ${toolName}${reason ? `: ${reason}` : "."}`);
    return;
  }
  if (decision === "REQUIRE_APPROVAL") {
    output("ask", `Torrix held ${toolName} for approval${reason ? `: ${reason}` : "."}`);
    return;
  }
  output("allow", `Torrix allowed ${toolName}.`);
}

main().catch(() => {
  // The hook must never crash Claude Code. An unexpected error is fail-open.
});
