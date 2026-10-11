# Getting started

This guide takes you from nothing to your first recorded AI call in about five minutes.

## 1. Start Torrix

Pick whichever is easiest for you.

**With Bun** (needs [Bun](https://bun.sh) 1.2 or newer):

```bash
git clone https://github.com/TorrixAI/torrix.git
cd torrix
bun install
bun run start
```

**With Docker:**

```bash
docker run -d --name torrix -p 8088:8088 -v torrix_data:/data gettorrixai/torrix:latest
```

**As a single binary** (Linux and macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/TorrixAI/torrix/main/deploy/install.sh | sh
torrix
```

Torrix listens on port 8088. Open http://localhost:8088 in your browser.

## 2. Create your account

The first account you create becomes the administrator. Torrix also creates a **Default**
project and an API key for you. Torrix keys start with `trxk_`.

## 3. Connect your app

Open **Integrations** in the sidebar. Each card covers one way to send data, and each has a
**Generate key** button that creates a separate key for that tool, so you can revoke it on its
own later. Copy the command or snippet shown on the card. Commands are shown for macOS and Linux
or for Windows PowerShell, depending on your computer.

The most common choices:

| You use | Start here |
|---|---|
| Any HTTP client, any language | [HTTP proxy](integrations/http-proxy.md) |
| Python with OpenAI or Anthropic | [Python SDK](integrations/python-sdk.md) |
| TypeScript or Node.js | [TypeScript SDK](integrations/typescript-sdk.md) |
| Claude Code | [Claude Code plugin](integrations/claude-code.md) |
| opencode | [opencode plugin](integrations/opencode.md) |
| An app already instrumented with OpenTelemetry | [OpenTelemetry](integrations/opentelemetry.md) |

## 4. Make a call and look at it

Send one request through your app. Then open:

- **Runs** to see the call with its prompt, response, tokens, cost and latency.
- **Traces** to see how calls group into conversations and agent turns.
- **Dashboard** for spend, volume and errors over time.

The Integrations page also shows a **Connected** badge on each card once data arrives.

## 5. Next steps

- Learn [how Torrix organizes runs, traces and sessions](concepts.md), so your agent runs group
  the way you expect.
- Set a budget or hard cap under **Cost & Alerts**.
- Turn on PII masking under **Governance** if prompts may contain personal data.
- Move to Postgres or Kubernetes when you are ready: see [Self-hosting](self-hosting.md).
