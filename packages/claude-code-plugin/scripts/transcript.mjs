// Converts Claude Code transcript JSONL lines into Torrix ingest records.
// Pure functions only: the hook entrypoint owns files, state and network.
//
// One Claude Code API call is written as several `assistant` lines that share
// `message.id` (one per content block, each repeating the final usage), so
// lines are grouped by that id and become one run with a stable id.

const TEXT_CAP = 4000;

function cap(text, max = TEXT_CAP) {
  return typeof text === "string" && text.length > max ? `${text.slice(0, max)}…` : text ?? "";
}

function parse(line) {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Visible text of a user turn, or null when the line only carries tool results. */
export function userPromptText(entry) {
  const content = entry?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
  return text || null;
}

function toolResultSummary(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const results = content.filter((block) => block && block.type === "tool_result");
  if (!results.length) {
    return null;
  }
  return results
    .map((block) => {
      const body = typeof block.content === "string"
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("\n")
          : "";
      return `[tool_result${block.is_error ? " error" : ""}] ${cap(body, 600)}`;
    })
    .join("\n");
}

export function runIdFor(messageId) {
  return `cc_${messageId}`;
}

/**
 * @param {string[]} lines       complete JSONL lines (no partial trailing line)
 * @param {object}   carry       context from earlier lines of the same transcript:
 *                               { promptId, promptText, lastInput, lastTimestamp }
 * @param {object}   ctx         { agentName, agentId, parentRunId, sessionFallback, traceFallback }
 * @returns {{ records: object[], carry: object, toolUseRuns: Record<string,string> }}
 */
export function convertLines(lines, carry = {}, ctx = {}) {
  const state = {
    promptId: carry.promptId ?? null,
    promptText: carry.promptText ?? null,
    lastInput: carry.lastInput ?? null,
    lastTimestamp: carry.lastTimestamp ?? null,
  };
  const groups = new Map();
  const order = [];
  const failures = [];
  const toolUseRuns = {};

  for (const line of lines) {
    const entry = parse(line);
    if (!entry) {
      continue;
    }
    if (entry.type === "user" && entry.message) {
      if (entry.promptId) {
        state.promptId = entry.promptId;
      }
      const prompt = entry.isMeta ? null : userPromptText(entry);
      if (prompt) {
        state.promptText = prompt;
        state.lastInput = prompt;
      } else {
        state.lastInput = toolResultSummary(entry) ?? state.lastInput;
      }
      state.lastTimestamp = entry.timestamp ?? state.lastTimestamp;
      continue;
    }
    if (entry.type !== "assistant" || !entry.message || !entry.message.id) {
      continue;
    }
    const message = entry.message;
    if (message.model === "<synthetic>") {
      // Claude Code writes failed API calls as synthetic assistant lines.
      const text = Array.isArray(message.content) ? message.content.map((b) => (b && b.type === "text" ? b.text : "")).join("") : "";
      if (/^API Error/i.test(text.trim())) {
        failures.push({ id: message.id, text, timestamp: entry.timestamp, sessionId: entry.sessionId, promptId: state.promptId });
      }
      continue;
    }
    if (!message.usage) {
      continue;
    }
    let group = groups.get(message.id);
    if (!group) {
      group = {
        messageId: message.id,
        model: message.model,
        usage: message.usage,
        stopReason: message.stop_reason ?? null,
        blocks: [],
        startTime: state.lastTimestamp ?? entry.timestamp,
        endTime: entry.timestamp,
        sessionId: entry.sessionId,
        promptId: state.promptId,
        promptText: state.promptText,
        input: state.lastInput,
        version: entry.version,
        gitBranch: entry.gitBranch,
      };
      groups.set(message.id, group);
      order.push(group);
    }
    group.usage = message.usage;
    group.stopReason = message.stop_reason ?? group.stopReason;
    group.endTime = entry.timestamp ?? group.endTime;
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block && typeof block === "object") {
        group.blocks.push(block);
        if (block.type === "tool_use" && block.id) {
          toolUseRuns[block.id] = runIdFor(message.id);
        }
      }
    }
    state.lastTimestamp = entry.timestamp ?? state.lastTimestamp;
  }

  const records = order.map((group) => toRecord(group, ctx));
  for (const failure of failures) {
    records.push({
      id: runIdFor(failure.id),
      name: "Claude Code API error",
      provider: "anthropic",
      source: "sdk",
      status: 500,
      error: cap(failure.text, 1000),
      start_time: failure.timestamp,
      end_time: failure.timestamp,
      session_id: failure.sessionId ?? ctx.sessionFallback ?? undefined,
      trace_id: failure.promptId ?? ctx.traceFallback ?? undefined,
      agent_name: ctx.agentName ?? "claude-code",
      tags: { client: "claude-code" },
      ...(ctx.parentRunId ? { parent_run_id: ctx.parentRunId } : {}),
      ...(ctx.agentId ? { agent_id: ctx.agentId } : {}),
    });
  }
  return { records, carry: state, toolUseRuns };
}

function toRecord(group, ctx) {
  const usage = group.usage ?? {};
  const content = group.blocks.map((block) => {
    if (block.type === "text") return { type: "text", text: cap(block.text) };
    if (block.type === "thinking") return { type: "thinking", thinking: cap(block.thinking) };
    if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} };
    return { type: block.type };
  });
  const toolNames = group.blocks.filter((b) => b.type === "tool_use").map((b) => b.name).filter(Boolean);
  const firstLine = (group.promptText ?? "").split("\n").find((l) => l.trim()) ?? "";
  const name = firstLine ? cap(firstLine.trim(), 80) : toolNames.length ? `tools: ${toolNames.join(", ")}` : "claude code turn";
  const tags = { client: "claude-code" };
  if (group.version) tags.claude_code_version = String(group.version);
  if (group.gitBranch) tags.git_branch = String(group.gitBranch);
  if (toolNames.length) tags.tools = [...new Set(toolNames)].join(",").slice(0, 200);

  const record = {
    id: runIdFor(group.messageId),
    name,
    provider: "anthropic",
    model: group.model,
    source: "sdk",
    status: 200,
    start_time: group.startTime,
    end_time: group.endTime,
    session_id: group.sessionId ?? ctx.sessionFallback ?? undefined,
    trace_id: group.promptId ?? ctx.traceFallback ?? undefined,
    agent_name: ctx.agentName ?? "claude-code",
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
    tags,
    request: {
      body: {
        model: group.model,
        messages: [{ role: "user", content: cap(group.input ?? group.promptText ?? "") }],
      },
    },
    response: {
      body: { model: group.model, content, stop_reason: group.stopReason, usage },
    },
  };
  const thinking = usage.output_tokens_details?.thinking_tokens;
  if (typeof thinking === "number") {
    record.thinking_tokens = thinking;
  }
  if (ctx.parentRunId) {
    record.parent_run_id = ctx.parentRunId;
  }
  if (ctx.agentId) {
    record.agent_id = ctx.agentId;
  }
  return record;
}
