# Torrix

**See every AI call your apps and agents make, on your own servers.**

Torrix sits between your code and your LLM providers. Every call is recorded with its prompt,
response, tokens, cost, latency and tool calls, and grouped into the conversations and agent runs
it belongs to. You run it yourself, so your data never leaves your infrastructure.

This repository is the free **Community edition**.

![Torrix dashboard](docs/images/dashboard.png)

## What you get

- **One place for all AI traffic.** OpenAI, Anthropic, Gemini, DeepSeek, Groq, OpenRouter,
  local models and anything else that speaks HTTP.
- **Traces of agent runs.** See each user turn as a tree of model calls, tool calls and
  subagents, or as a timeline. Find the step that failed or cost the most.
- **Cost you can trust.** Per call, per model, per agent and per project, including prompt
  cache pricing. Budgets, hard caps and alerts to Slack, webhooks, PagerDuty or email.
- **Works with what you already use.** A drop-in HTTP proxy, Python and TypeScript SDKs,
  OpenTelemetry, plugins for Claude Code and opencode, and .NET and Java clients.
- **Built for daily work.** Live feed, search, prompt library with versions, datasets and
  evaluations, a playground, PII masking, and an MCP server so your coding assistant can query
  your traces.
- **Simple to run.** One process, SQLite by default, Postgres when you need it. Docker, Helm or a
  single binary.

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

## Editions

The Community edition is free and covers observability, cost control and evaluations. Teams that
need agent governance, policies, routing, single sign-on and compliance reporting can upgrade to
**Pro** or **Enterprise** by switching to the paid image with a license key. Your data carries over.
See
[Editions and licensing](docs/editions-and-licensing.md).

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).
To report a security issue privately, see [SECURITY.md](SECURITY.md).

## License

Torrix Community is licensed under the [Functional Source License 1.1, Apache 2.0 future license](LICENSE)
(FSL-1.1-ALv2). You can use, modify and self-host it for any purpose except offering it as a
competing commercial product. Each release becomes Apache 2.0 two years after it ships.
