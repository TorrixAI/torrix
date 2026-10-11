# Torrix

Self-hosted observability for LLM apps and AI agents. Torrix records every model call your app
makes: prompt, response, tokens, cost, latency, tool calls and errors. Calls are grouped into
traces and sessions so you can follow what an agent did, step by step. Your data stays on your
server.

Works with OpenAI, Anthropic, Gemini and any OpenAI-compatible API, through a drop-in HTTP proxy,
the Python and TypeScript SDKs, OpenTelemetry, or the Claude Code and opencode plugins.

## Run it

```bash
docker run -d --name torrix -p 8088:8088 -v torrix_data:/data gettorrixai/torrix:latest
```

Open http://localhost:8088 and create your account. The **Integrations** page gives you an API key
and a ready-to-copy setup command for each integration.

The same image is published to `ghcr.io/torrixai/torrix`.

## Docker Compose

```yaml
services:
  torrix:
    image: gettorrixai/torrix:latest
    restart: unless-stopped
    ports:
      - "8088:8088"
    volumes:
      - torrix_data:/data
volumes:
  torrix_data:
```

## Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8088` | port the server listens on |
| `DB_PATH` | `/data/torrix.sqlite` | SQLite file location |
| `TORRIX_DATABASE_URL` | none | Postgres connection URL, used instead of SQLite when set |
| `TORRIX_SECRET_KEY` | none | encrypts saved credentials. Set it in production and keep it safe |
| `TORRIX_PRICING_SYNC` | `true` | set to `false` to stop the daily download of public model prices |
| `TORRIX_LOCAL_HOST` | none | lets the proxy reach a model server on your network, for example `host.docker.internal:11434` for Ollama |
| `TORRIX_LICENSE_KEY` | none | a Pro or Enterprise license key |

Telemetry is off in this image. Data lives in `/data`, so keep that volume when you upgrade.

## Tags

- `latest`: the newest release
- `1.0.0`, `1.0`: a specific release

Images are built for `linux/amd64` and `linux/arm64`, run as a non-root user and include a health
check on `/health`.

## Links

- Source and docs: https://github.com/TorrixAI/torrix
- License: FSL-1.1-ALv2. Each release becomes Apache 2.0 two years after it ships.
