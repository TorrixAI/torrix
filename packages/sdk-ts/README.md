# Torrix TypeScript SDK

Zero-dependency client for [Torrix](../../README.md): records LLM calls into a local
Torrix instance through `POST /api/ingest`. Works on Node 18+, Bun and Deno (ingest
and wrapping); `runContext` uses `node:async_hooks` and is Node/Bun only.

## Install

```sh
npm install torrix-sdk
# or from this repo: bun run build --cwd packages/sdk-ts
```

## Quickstart

```ts
import OpenAI from "openai";
import * as torrix from "torrix-sdk";

torrix.init("trxk_...", "http://localhost:8088");

const client = new OpenAI();
torrix.wrap(client);

// Every call is now recorded, with tokens, cost, latency and the full body.
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

Environment fallbacks: `TORRIX_API_KEY`, `TORRIX_URL`, `TORRIX_PROJECT`, `TORRIX_AGENT`.
`init()` also accepts the legacy `init(baseUrl, apiKey)` order.

## Run context

`torrix.runContext()` groups calls into one trace and chains parents automatically,
so nested agents build a tree without manual ids:

```ts
await torrix.runContext({ sessionId: "ses_1", agentName: "planner" }, async () => {
  const plan = await client.chat.completions.create({ ... });   // root run
  const step = await client.chat.completions.create({ ... });   // child of `plan`
});
```

## API

| Export | Description |
|---|---|
| `init(apiKey, baseUrl?, options?)` | Configure the singleton client (background queue by default). |
| `wrap(client, options?)` | Record calls on an OpenAI or Anthropic client instance (streaming included). |
| `unwrap(client?)` | Restore patched methods (one client, or all when omitted). |
| `autoInstrument({ openai, anthropic })` | Patch installed provider packages so future clients are recorded too. |
| `runContext(options, fn)` | Trace/session/agent propagation with automatic `parent_run_id` chaining. |
| `ingest(record, { wait })` | Send a raw [ingest record](../../INTEGRATIONS.md). |
| `flush(timeoutMs?)` | Drain the background queue. |
| `health()` / `stats()` | Server reachability / queue counters. |
| `torrixMiddleware({ client })` | Vercel AI SDK middleware for `wrapLanguageModel`. |
| `TorrixClient` | Low-level client for custom transports (`background: false` for synchronous ingest). |
| `createAttestationVerifier(options)` | For MCP servers behind the Torrix gateway: verify `x-torrix-attestation` and reject calls that bypassed Torrix (also at `torrix/verify`). See [ENFORCED_ROUTING.md](../../ENFORCED_ROUTING.md). |

## Streaming

OpenAI `stream: true` responses and Anthropic message streams are accumulated
(text, reasoning, tool calls, usage when the provider sends it) and recorded once
the stream finishes or fails. The returned stream keeps its original properties
(for example `controller.abort()`).

`torrix_name` (a string) and `torrix_tags` (an object) may be added to a create
call; they are stripped before the request leaves the process and applied to the record.

## Vercel AI SDK

```ts
import { wrapLanguageModel } from "ai";
import { torrixMiddleware } from "torrix-sdk";

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: torrixMiddleware({ client: torrix.getClient() }),
});
```

## Build

```sh
bun run build      # tsc -> dist/
bun run test       # bun test (includes an end-to-end test against the server app)
bun run typecheck
```
