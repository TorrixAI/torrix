# Logging opencode into Torrix

Two ways to get every opencode LLM call into Torrix. Pick one; running both logs each
turn twice.

| Path | Changes required | What Torrix sees |
|---|---|---|
| Plugin + `/api/ingest` (recommended) | env vars only | one run per assistant step (model call), exact tokens/cost from opencode, agent tree via `session_id` / `trace_id` / `parent_run_id` |
| HTTP proxy | provider config | one run per HTTP call, full request/response as forwarded, provider-specific shaped bodies |

## Option A: plugin (no provider changes)

The plugin lives at `../../.opencode/plugins/torrix.js` in this repo. It targets the **OpenCode 2.x**
plugin API (`export default { id, setup }`); OpenCode 1.x rejects it at load with
`failed to load plugin`. Copy it to your own project or global plugin directory:

```
<project>/.opencode/plugins/torrix.js
~/.config/opencode/plugins/torrix.js
```

Then set the environment variables opencode starts with:

```
TORRIX_API_KEY=trxk_...            # required; without it the plugin is inert
TORRIX_URL=http://localhost:8088   # optional
TORRIX_PROJECT=my-project          # optional project name or id
TORRIX_TAGS=team=platform,env=dev  # optional extra run tags
```

Restart opencode. Every completed assistant turn is POSTed to `/api/ingest`. Runs show in
`/ui/runs` with:

- `agent_name` = the opencode agent (`build`, `plan`, `explore`, ...)
- `session_id` = the root session, so the whole conversation groups at `/ui/sessions/:id`
- `trace_id` = the user turn (the user message that triggered it); every subagent spawned during
  the turn inherits it, so `/ui/traces/:id` shows one end-to-end turn. Subagent calls carry
  `parent_run_id` pointing at the parent agent's previous run, so the agent tree renders in the
  same trace and in `/ui/sessions/:id`

Disable one path with `TORRIX_INGEST=false` (plugin off, proxy header tagging stays on) or
`TORRIX_PROXY_TAGS=false` (header tagging off, plugin stays on).

## Option B: HTTP proxy

Copy `opencode.json` from this directory into your project (or merge the `provider`
block into `~/.config/opencode/opencode.json`). Torrix must be running, and the `/proxy/*`
wildcard (already in this build) lets provider SDKs append `/chat/completions` or
`/v1/messages` to the configured base URL.

Per provider:

- **OpenAI / OpenAI-compatible:** `apiKey` is the Torrix `trxk_` key so the SDK sends it
  as `Authorization`; `x-target-url` is the real endpoint and `x-upstream-authorization`
  carries the real provider key.
- **Anthropic:** `apiKey` stays the real Anthropic key (the SDK sends `x-api-key`, which
  Torrix forwards upstream), and a static `Authorization: Bearer trxk_...` header
  authenticates to Torrix.

For per-agent separation without a plugin, define two provider entries with different
`x-agent-name` headers and assign them in each agent's `model`.

## Querying Torrix from opencode (MCP)

The `mcp` block adds Torrix's MCP server as a remote server, so the agent can call
`get_dashboard`, `list_runs`, `get_run`, `get_trace`, `get_session`, `search_runs`,
`list_anomalies`, and the agent-control tools. This only reads Torrix; it does not log
opencode's own calls.

## Verify

1. Start Torrix: `bun run dev` (port 8088).
2. Run a prompt in opencode.
3. Open `http://localhost:8088/ui/runs`; filter by `agent`.
4. Open the run's session and trace links to see the subagent tree.
