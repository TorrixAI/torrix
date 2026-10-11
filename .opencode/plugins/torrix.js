// Torrix observability plugin for opencode (V2 plugin API; requires OpenCode 2.x).
//
// Logs every assistant turn of this opencode instance into a Torrix server.
//
//   TORRIX_API_KEY   trxk_... (required for ingest; without it the plugin is inert)
//   TORRIX_URL       default http://localhost:8088
//   TORRIX_PROJECT   optional project name or id to attribute runs to
//   TORRIX_TAGS      optional "key=value,key=value" extra tags
//   TORRIX_INGEST    "false" disables the /api/ingest path
//   TORRIX_PROXY_TAGS "false" disables x-torrix-* header tagging on /proxy traffic
//
// Subagents: opencode runs them in child sessions. Each run is stored with
// session_id = root session (whole conversation), trace_id = the user turn
// (the user message that triggered it; every subagent spawned during the turn
// inherits it), and parent_run_id = the parent agent's in-flight or last run,
// so the run tree renders in Torrix's trace and session views. Run names use
// the first meaningful prompt line (subagent boilerplate is skipped) plus the
// tools each step ran, so multi-step turns stay distinguishable.
//
// Turns are ingested from the session transcript once an execution settles, so
// a record is built from opencode's final message state (text, reasoning, tool
// calls, tokens, cost) instead of streamed fragments.

const TORRIX_URL = (process.env.TORRIX_URL ?? "http://localhost:8088").replace(/\/+$/, "");
const TORRIX_API_KEY = (process.env.TORRIX_API_KEY ?? "").trim();
const TORRIX_PROJECT = (process.env.TORRIX_PROJECT ?? "").trim();
const TORRIX_TAGS = parsePairs(process.env.TORRIX_TAGS ?? "");
const INGEST_ENABLED = TORRIX_API_KEY !== "" && (process.env.TORRIX_INGEST ?? "true") !== "false";
const PROXY_TAGS = (process.env.TORRIX_PROXY_TAGS ?? "true") !== "false";

const MAX_SESSION_STATE = 400;
const MAX_INGESTED = 2000;
const MAX_PROMPT_CHARS = 8000;
const MAX_RESPONSE_CHARS = 16000;

function parsePairs(raw) {
  const out = {};
  for (const pair of String(raw).split(",")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key) out[key] = value;
    }
  }
  return out;
}

function truncate(text, max) {
  const value = String(text ?? "");
  return value.length > max ? value.slice(0, max) : value;
}

function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timeIso(value) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

function errorText(error) {
  if (!error) return undefined;
  return String(error.message ?? error.type ?? "opencode error");
}

function promptTitle(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful = lines.find((line) => !/^you are a subagent spawned by another session\.?$/i.test(line));
  return meaningful ?? lines[0] ?? "";
}

function trimMap(map, max) {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

function collectContent(content) {
  const out = { text: "", reasoning: "", tools: [] };
  for (const part of content ?? []) {
    if (part.type === "text") out.text += part.text;
    else if (part.type === "reasoning") out.reasoning += part.text;
    else if (part.type === "tool") out.tools.push(part);
  }
  return out;
}

function toolArguments(state) {
  const input = state?.input;
  if (input === undefined || input === null) return "{}";
  return typeof input === "string" ? input : JSON.stringify(input);
}

export default {
  id: "torrix",

  async setup(ctx) {
    const sessionParent = new Map();
    const currentRunBySession = new Map();
    const lastRunBySession = new Map();
    const turnTraceBySession = new Map();
    const executionStartedAt = new Map();
    const ingested = new Set();

    const rootSession = (sessionID) => {
      let current = sessionID;
      for (let i = 0; i < 16; i += 1) {
        const parent = sessionParent.get(current);
        if (!parent) return current;
        current = parent;
      }
      return current;
    };

    const postRecord = async (record) => {
      try {
        await fetch(`${TORRIX_URL}/api/ingest`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TORRIX_API_KEY}` },
          body: JSON.stringify({ records: [record] }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // never fail the opencode session because Torrix is unreachable
      }
    };

    const ingestAssistant = async (sessionID, assistant, messages, outcome, reason) => {
      if (!INGEST_ENABLED || ingested.has(assistant.id)) return;
      ingested.add(assistant.id);
      if (ingested.size > MAX_INGESTED) ingested.clear();
      // Register before the POST so a subagent turn that settles while this one
      // is still in flight can still link its parent_run_id.
      lastRunBySession.set(sessionID, assistant.id);
      trimMap(lastRunBySession, MAX_SESSION_STATE);
      if (currentRunBySession.get(sessionID) === assistant.id) currentRunBySession.delete(sessionID);

      let prompt;
      const index = messages.indexOf(assistant);
      for (let i = index - 1; i >= 0; i -= 1) {
        const message = messages[i];
        // An idle marker closes a turn: every step before it belongs to the
        // same user prompt, so earlier steps keep the shared trace.
        if (message.type === "idle") break;
        if (message.type === "user") {
          prompt = message;
          break;
        }
      }

      const response = collectContent(assistant.content);
      const agent = assistant.agent || "opencode";
      const parentSession = sessionParent.get(sessionID);
      const parentRunId = parentSession
        ? currentRunBySession.get(parentSession) ?? lastRunBySession.get(parentSession)
        : undefined;
      const root = rootSession(sessionID);
      const promptTrace = prompt?.id;
      const traceId = sessionParent.get(sessionID)
        ? turnTraceBySession.get(root) ?? promptTrace ?? assistant.id
        : promptTrace ?? turnTraceBySession.get(root) ?? assistant.id;

      const interrupted = outcome === "interrupted" && !assistant.error;
      const failed = assistant.error != null || outcome === "failed" || interrupted;
      const status = failed ? numberOrUndefined(assistant.error?.status) ?? 500 : 200;
      const error = errorText(assistant.error) ?? (interrupted ? `interrupted (${reason ?? "user"})` : outcome === "failed" ? "opencode error" : undefined);
      const latency =
        assistant.time?.completed && assistant.time?.created
          ? Math.max(0, assistant.time.completed - assistant.time.created)
          : undefined;

      const assistantMessage = {
        role: "assistant",
        content: truncate(response.text, MAX_RESPONSE_CHARS),
      };
      if (response.reasoning) assistantMessage.reasoning_content = truncate(response.reasoning, MAX_RESPONSE_CHARS);
      if (response.tools.length) {
        assistantMessage.tool_calls = response.tools.map((tool) => ({
          id: tool.id,
          type: "function",
          function: { name: tool.name, arguments: toolArguments(tool.state) },
        }));
      }

      const requestContent = [];
      if (prompt?.text) {
        requestContent.push({ type: "text", text: truncate(prompt.text, MAX_PROMPT_CHARS) });
      }
      for (const file of prompt?.files ?? []) {
        const url = file.source?.type === "uri" ? String(file.source.uri ?? "") : `data:${file.mime};base64,${file.data}`;
        if (!url) continue;
        if (String(file.mime).startsWith("image/")) {
          requestContent.push({ type: "image_url", image_url: { url } });
        } else if (url.startsWith("data:")) {
          requestContent.push({ type: "file", file: { file_data: url, filename: file.name || undefined } });
        }
      }
      const requestBody = requestContent.length
        ? {
            body: {
              messages: [
                {
                  role: "user",
                  content: requestContent.length === 1 && requestContent[0].type === "text" ? requestContent[0].text : requestContent,
                },
              ],
            },
          }
        : undefined;

      const toolNames = [...new Set(response.tools.map((tool) => String(tool.tool ?? "").trim()).filter(Boolean))].slice(0, 3);
      const title = promptTitle(prompt?.text);
      const name = title
        ? toolNames.length
          ? `${truncate(title, 56)} → ${truncate(toolNames.join(", "), 20)}`
          : truncate(title, 80)
        : `opencode ${agent}`;

      const record = {
        id: assistant.id,
        name,
        provider: assistant.model?.providerID,
        model: assistant.model?.id,
        status,
        start_time: timeIso(assistant.time?.created),
        end_time: timeIso(assistant.time?.completed),
        latency_ms: latency,
        input_tokens: numberOrUndefined(assistant.tokens?.input),
        output_tokens: numberOrUndefined(assistant.tokens?.output),
        thinking_tokens: numberOrUndefined(assistant.tokens?.reasoning),
        cache_read_tokens: numberOrUndefined(assistant.tokens?.cache?.read),
        cache_creation_tokens: numberOrUndefined(assistant.tokens?.cache?.write),
        cost_usd: typeof assistant.cost === "number" && assistant.cost > 0 ? assistant.cost : undefined,
        session_id: root,
        trace_id: traceId,
        parent_run_id: parentRunId,
        agent_name: agent,
        tags: { app: "opencode", agent, ...TORRIX_TAGS },
        project_id: TORRIX_PROJECT || undefined,
        source: "sdk",
        request: requestBody,
        response:
          response.text || response.tools.length
            ? { body: { choices: [{ index: 0, message: assistantMessage, finish_reason: assistant.finish ?? "stop" }] } }
            : undefined,
        error,
      };

      await postRecord(record);
    };

    const ingestSettled = async (sessionID, outcome, reason) => {
      if (!INGEST_ENABLED) return;
      const startedAt = executionStartedAt.get(sessionID);
      executionStartedAt.delete(sessionID);
      try {
        const messages = await ctx.session.context({ sessionID });
        const candidates = [];
        for (const message of messages) {
          if (message.type !== "assistant" || ingested.has(message.id)) continue;
          const settled = Boolean(message.time?.completed || message.error);
          const interruptedWithContent = outcome === "interrupted" && Boolean(message.content?.length);
          if (!settled && !interruptedWithContent) continue;
          if (startedAt !== undefined && message.time?.created !== undefined && message.time.created < startedAt && !message.error) {
            continue;
          }
          candidates.push(message);
        }
        // Without an execution-start watermark (plugin reloaded mid-turn) only the
        // trailing message can belong to the execution that just settled.
        for (const message of startedAt === undefined ? candidates.slice(-1) : candidates) {
          await ingestAssistant(sessionID, message, messages, outcome, reason);
        }
      } catch {
        // transcript reads must never disturb opencode
      }
    };

    const handleEvent = (event) => {
      const type = event?.type;
      const data = event?.data ?? {};

      if (type === "session.created" || type === "session.forked") {
        if (!data.sessionID) return;
        if (data.parentID) sessionParent.set(data.sessionID, data.parentID);
        else sessionParent.delete(data.sessionID);
        trimMap(sessionParent, MAX_SESSION_STATE);
        return;
      }

      if (type === "session.inbox.delivered") {
        if (!data.sessionID || !data.inboxID) return;
        if (!sessionParent.get(data.sessionID)) {
          turnTraceBySession.set(data.sessionID, data.inboxID);
          trimMap(turnTraceBySession, MAX_SESSION_STATE);
        }
        return;
      }

      if (type === "session.execution.started") {
        if (data.sessionID) {
          executionStartedAt.set(data.sessionID, event.created);
          trimMap(executionStartedAt, MAX_SESSION_STATE);
        }
        return;
      }

      if (type === "session.step.started") {
        if (data.sessionID && data.assistantMessageID) {
          currentRunBySession.set(data.sessionID, data.assistantMessageID);
          trimMap(currentRunBySession, MAX_SESSION_STATE);
        }
        return;
      }

      if (type === "session.execution.succeeded" || type === "session.execution.failed" || type === "session.execution.interrupted") {
        if (!data.sessionID) return;
        const outcome =
          type === "session.execution.succeeded" ? "succeeded" : type === "session.execution.failed" ? "failed" : "interrupted";
        void ingestSettled(data.sessionID, outcome, data.reason);
        return;
      }

      if (type === "session.deleted") {
        if (!data.sessionID) return;
        sessionParent.delete(data.sessionID);
        currentRunBySession.delete(data.sessionID);
        lastRunBySession.delete(data.sessionID);
        turnTraceBySession.delete(data.sessionID);
        executionStartedAt.delete(data.sessionID);
      }
    };

    if (PROXY_TAGS) {
      await ctx.session.hook("model.request", (event) => {
        try {
          const baseURL = String(event?.baseURL ?? "");
          if (!baseURL.includes("/proxy")) return;
          const agent = event.agent || "opencode";
          event.headers["x-agent-name"] = agent;
          event.headers["x-torrix-session"] = rootSession(event.sessionID);
          // The ingest path already records this call; keep the proxy from storing
          // a second copy of successful calls (errors are still always logged).
          if (INGEST_ENABLED) event.headers["x-torrix-sample"] = "0";
          const trace = turnTraceBySession.get(rootSession(event.sessionID));
          if (trace) event.headers["x-torrix-trace"] = trace;
          const tags = [`app=opencode`, `agent=${agent}`];
          for (const [key, value] of Object.entries(TORRIX_TAGS)) tags.push(`${key}=${value}`);
          event.headers["x-torrix-tags"] = tags.join(",");
        } catch {
          // optional tagging only
        }
      });
    }

    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            handleEvent(event);
          } catch {
            // hooks must never throw into opencode
          }
        }
      } catch {
        // stream aborted on unload
      }
    })();

    return () => controller.abort();
  },
};
