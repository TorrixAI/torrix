# How Torrix compares

There are good tools for LLM tracing, such as Langfuse, Helicone and LangSmith. This page explains
where Torrix is different, so you can pick what fits. It reflects our reading of their public
documentation in October 2026. If something here is out of date, please open an issue.

## What Torrix focuses on

| | Torrix | Typical LLM tracing tools |
|---|---|---|
| Main unit | The **agent run**: a tree of model calls, tool calls and subagents per user turn | The trace of a request or chain |
| Coding agents | Plugins for **Claude Code** and **opencode**: every session, subagent and its cost, with no code | Usually needs SDK code or OpenTelemetry setup |
| Cost control | Budgets **and hard caps** that refuse calls before they reach the provider | Mostly dashboards and alerts after the fact |
| Running it yourself | **One process and one SQLite file.** Postgres when you want it | Often several services, such as an analytics database, a cache and object storage |
| Where your data goes | Only your server | Cloud first, self-hosting as an option |
| Beyond observing | Paid editions decide **what agents may do**: agent identities, delegated authority, approvals and a governed MCP gateway | Observability and evaluation |

## Coming from another tool

**Helicone.** Torrix reads Helicone's headers (`Helicone-Session-Id`, `Helicone-Request-Id`,
`Helicone-User-Id`, `Helicone-Property-*` and more), so you can switch the base URL first and rename
headers later. See [HTTP proxy](integrations/http-proxy.md#coming-from-helicone) and the
[migration guide](migrating-from-helicone-langfuse.md).

**Langfuse or LangSmith with OpenTelemetry.** Point your OpenTelemetry exporter at Torrix's
`/v1/traces` endpoint. GenAI spans become runs with tokens, cost and the parent and child links.
See [OpenTelemetry](integrations/opentelemetry.md) and the
[migration guide](migrating-from-helicone-langfuse.md).

**Langfuse, LangSmith or another SDK.** Use the Torrix [Python](integrations/python-sdk.md) or
[TypeScript](integrations/typescript-sdk.md) SDK. Both wrap the official OpenAI and Anthropic clients
with one line, and `run_context` / `runContext` groups calls into turns and agents.

## When another tool may suit you better

- You want a fully managed cloud service and do not want to run anything yourself.
- Your work is mostly prompt experiments in a hosted UI rather than agents in production.
- You need a feature Torrix does not have yet. Tell us in
  [Discussions](https://github.com/TorrixAI/torrix/discussions); it shapes what we build next.
