# TypeScript SDK

The TypeScript SDK (`torrix-sdk`) records calls made with the official OpenAI and Anthropic
clients, including streaming, and plugs into the Vercel AI SDK. It has no dependencies and sends
data in the background. It runs on Node.js 18+, Bun and Deno.

## Install

```bash
npm install torrix-sdk
```

`pnpm add torrix-sdk`, `yarn add torrix-sdk` and `bun add torrix-sdk` work too.

## Set up

```ts
import OpenAI from "openai";
import * as torrix from "torrix-sdk";

torrix.init("trxk_YOUR_KEY", "http://localhost:8088");

const client = new OpenAI();
torrix.wrap(client);
```

`wrap` patches an OpenAI or Anthropic client instance in place, so you keep using `client` with
its normal types. To record every client your app creates,
call `await torrix.autoInstrument()` once after `init`.

`init` also reads `TORRIX_API_KEY`, `TORRIX_URL`, `TORRIX_PROJECT` and `TORRIX_AGENT` from the
environment, so `torrix.init()` with no arguments works when those are set.

## Group calls into turns and agents

```ts
await torrix.runContext({ sessionId: "chat-7", agentName: "planner" }, async () => {
  const plan = await client.chat.completions.create({ model: "gpt-4o-mini", messages });

  await Promise.all(
    ["search", "write"].map((agentName) =>
      torrix.runContext({ agentName }, () => client.chat.completions.create({ model: "gpt-4o-mini", messages })),
    ),
  );
});
```

- The whole block is one trace in session `chat-7`.
- Calls in the same block are siblings.
- The `search` and `write` subagents hang under `plan`, even though they run in parallel.

`runContext` also accepts `traceId`, `name` and `parentRunId`.

## Name or tag a single call

```ts
await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
  torrix_name: "classify ticket",
  torrix_tags: { team: "support" },
});
```

Both fields are removed before the request goes to the provider.

## Vercel AI SDK

```ts
import { wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { torrixMiddleware } from "torrix-sdk";

const model = wrapLanguageModel({
  model: openai("gpt-4o-mini"),
  middleware: torrixMiddleware({ client: torrix.getClient() }),
});
```

## Before your process exits

Data is sent in the background. In scripts and serverless functions, call `await torrix.flush()`
before returning so nothing is lost.
