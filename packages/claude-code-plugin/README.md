# Torrix for Claude Code

Logs every Claude Code model call to your self-hosted Torrix instance: model, input and output
tokens, prompt-cache reads and writes, thinking tokens, cost, prompts, responses, thinking, tool
calls, and the subagent tree. Data goes only to the Torrix URL you configure.

It works with a Claude subscription or an API key, and it never sits in the request path:
if Torrix is down, Claude Code keeps working and the backlog is sent on the next turn.

## Install

Requires Node.js 18+ on your `PATH`.

In Claude Code:

```
/plugin marketplace add <path-to-torrix-repo>
/plugin install torrix@torrix
```

Claude Code asks for:

| Setting | Value |
|---|---|
| Torrix URL | e.g. `http://127.0.0.1:8088` |
| Torrix API key | a `trxk_` key from Torrix > API Keys (stored in the OS secure store) |
| Torrix project | optional project id or name; empty uses your default project |

Environment variables work too and are used when the plugin settings are empty:
`TORRIX_BASE_URL`, `TORRIX_API_KEY`, `TORRIX_PROJECT`. Set `TORRIX_DISABLED=1` to pause logging.

## What you see in Torrix

| Torrix field | From Claude Code |
|---|---|
| Run | one model API call (`cc_<message id>`) |
| Session | the Claude Code session |
| Trace | one user prompt and everything it triggered |
| Agent | `claude-code`, or the subagent type (`Explore`, `Plan`, ...) |
| Parent run | the call that launched a subagent |
| Tags | `client=claude-code`, Claude Code version, git branch, tools used |

Cost uses Torrix pricing, including Anthropic cache pricing (reads 0.1x, writes 1.25x the input
rate). If a model shows $0, add its price under Cost & Alerts > Pricing.

## How it works

Hooks on `Stop`, `SubagentStop` and `SessionEnd` run `scripts/torrix-hook.mjs` in the background.
It reads only the transcript lines added since the last run, groups them into one record per API
call, and posts them to `/api/ingest`. Its read position only advances after Torrix accepts the
batch, and run ids are stable, so retries never create duplicates.

Prompt and response text is capped at 4 KB per run, and Torrix applies your PII masking settings
before anything is stored.

Troubleshooting: errors are written to `torrix-hook.log` in the plugin data directory
(`~/.claude/plugins/data/<plugin>/`).

The transcript format is not a documented Claude Code API. Unknown entries are skipped, so a
format change can stop capture but cannot break Claude Code.
