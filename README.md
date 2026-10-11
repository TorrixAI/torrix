# Torrix

**The system of record for your AI agents: what they did, what it cost, and what they were allowed to do.**

Torrix sits between your agents and your LLM providers and tools. Every model call, tool call and
MCP call is recorded with its prompt, response, tokens, cost and latency, and linked into the agent
run it belongs to. You run it yourself, so your data never leaves your infrastructure.

This repository is the free **Community edition**: full observability and cost control for agents.
The paid editions add the other half, deciding what agents may do before they do it.

![Torrix dashboard](docs/images/dashboard.png)

## Why Torrix

- **Built for agents, not single prompts.** Each user turn becomes a tree of model calls, tool
  calls and subagents, with a timeline view, branch totals and the failing step highlighted.
  Coding agents work out of the box: install the Claude Code or opencode plugin and every session
  shows up with its cost.
- **Cost control that stops spending, not just charts.** Budgets and hard caps per user, project
  and API key. When a cap is reached, calls are refused before they reach the provider. Alerts go
  to Slack, webhooks, PagerDuty or email.
- **MCP aware.** See which MCP tools your agents call, how often, and which ones fail.
- **Runs in a minute.** One process and one SQLite file. No ClickHouse, Redis or queue to operate.
  Postgres, Docker, Helm and a single binary when you need them.
- **Works with what you already use.** A drop-in HTTP proxy, Python and TypeScript SDKs,
  OpenTelemetry, .NET and Java clients, and Helicone-compatible headers. OpenAI, Anthropic,
  Gemini, DeepSeek, Groq, OpenRouter, local models and anything else that speaks HTTP.
- **Everything for daily work.** Live feed, search, prompt library with versions, datasets and
  evaluations, a playground, PII masking, and an MCP server so your coding assistant can query
  your traces.

## From observing agents to governing them

Seeing what an agent did is the first step. Most teams soon need to control it too.

| | Community (free) | Pro | Enterprise |
|---|---|---|---|
| Traces, agent trees, cost, budgets, hard caps, evals, PII masking | ✓ | ✓ | ✓ |
| LLM judge, online evaluations and guardrails built from your evaluations | | ✓ | ✓ |
| Model routing, fallbacks and small-model savings | | ✓ | ✓ |
| Policy engine and human review queue | | ✓ | ✓ |
| Agent identities and delegated authority: which agent may do what, on whose behalf | | | ✓ |
| Governed MCP gateway: tool calls are checked and denied or held for approval before they run | | | ✓ |
| Approvals, audit trail, EU AI Act reports, single sign-on | | | ✓ |

The paid editions run on your servers too and keep your Community data when you upgrade. See
[Editions and licensing](docs/editions-and-licensing.md), or
[start a discussion](https://github.com/TorrixAI/torrix/discussions) to ask about a trial.

## Quick start

You need [Bun](https://bun.sh) 1.2 or newer, or Docker.

```bash
git clone https://github.com/TorrixAI/torrix.git
cd torrix
bun install
bun run start
```

Open http://localhost:8088, create your account, and go to **Integrations** to connect your first
app. Every integration card generates its own API key and gives you a command to copy.

Prefer Docker?

```bash
docker run -d --name torrix -p 8088:8088 -v torrix_data:/data gettorrixai/torrix:latest
```

## Send your first call

Point any OpenAI-compatible client at Torrix:

```bash
curl http://localhost:8088/proxy/v1/chat/completions \
  -H "authorization: Bearer trxk_YOUR_TORRIX_KEY" \
  -H "x-target-url: https://api.openai.com/v1/chat/completions" \
  -H "x-upstream-authorization: Bearer $OPENAI_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'
```

The call goes to OpenAI as usual, and shows up in Torrix under **Runs** a moment later.

## Documentation

| Topic | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, create an account, log your first call |
| [How Torrix organizes your data](docs/concepts.md) | Runs, traces, sessions, agents and projects |
| [Integrations](docs/integrations/README.md) | Proxy, SDKs, Claude Code, opencode, OpenTelemetry, MCP |
| [Self-hosting](docs/self-hosting.md) | Docker, Helm, binary, Postgres, backups and upgrades |
| [Configuration](docs/configuration.md) | Every environment variable |
| [Privacy and security](docs/privacy-and-security.md) | What is stored, what leaves your server, PII masking |
| [Editions and licensing](docs/editions-and-licensing.md) | Community, Pro and Enterprise, and what the license allows |
| [FAQ](docs/faq.md) | Common questions |

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).
To report a security issue privately, see [SECURITY.md](SECURITY.md).

## License

Torrix Community is licensed under the [Functional Source License 1.1, Apache 2.0 future license](LICENSE)
(FSL-1.1-ALv2). You can use, modify and self-host it for any purpose except offering it as a
competing commercial product. Each release becomes Apache 2.0 two years after it ships.
