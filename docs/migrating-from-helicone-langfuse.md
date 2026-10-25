# Moving from Helicone or Langfuse

This page is a short migration guide for teams already sending LLM traffic to Helicone or Langfuse.
You can keep your application code and move the endpoint first, then rename headers or instrumentation
later. New calls are recorded in Torrix from the moment the endpoint changes. Historical data is not
imported automatically.

All examples use `http://localhost:8088`. Replace it with your Torrix address, and replace
`trxk_YOUR_KEY` with a key from **Integrations** or **API Keys**.

## From Helicone

Helicone sits between your app and the provider as a proxy. Torrix does the same, so the change is
the base URL plus three headers.

### Before

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"],
    base_url="https://oai.helicone.ai/v1",
    default_headers={"Helicone-Auth": f"Bearer {os.environ['HELICONE_API_KEY']}"},
)
```

### After

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key="trxk_YOUR_KEY",                 # Torrix key, not the provider key
    base_url="http://localhost:8088/proxy/v1",
    default_headers={
        "x-target-url": "https://api.openai.com/v1/chat/completions",
        "x-upstream-authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
    },
)
```

The same shape works in TypeScript:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "trxk_YOUR_KEY",
  baseURL: "http://localhost:8088/proxy/v1",
  defaultHeaders: {
    "x-target-url": "https://api.openai.com/v1/chat/completions",
    "x-upstream-authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
  },
});
```

### Helicone headers Torrix understands

You do not have to rename these on day one. Torrix reads the aliases, maps them onto the run, and
strips them before the request reaches the provider.

| Helicone header | Torrix field |
|---|---|
| `Helicone-Request-Id` | run id. It must be new; an existing id returns `409 run_id_conflict` |
| `Helicone-Session-Id` | session id |
| `Helicone-Session-Path` | `session_path` tag |
| `Helicone-User-Id` | end user id |
| `Helicone-Property-Name` | run name |
| `Helicone-Property-<key>` | tag `<key>` |

Torrix headers win when both are present. For example, `x-torrix-session` overrides
`Helicone-Session-Id`, and `x-torrix-tags` overrides a matching property tag.

Helicone's caching, retry and auth headers are not interpreted. Remove them, or leave them in place:
they are stripped before the upstream call. The Torrix key goes in the standard `Authorization`
header.

### Verify

Open **Runs** after the first call. The run should show the provider, model, tokens, cost, latency,
prompt and response. If the provider key is wrong, the provider's status and error are recorded on the
run. To confirm header mapping, open the run and check its session, end user, name and tags.

## From Langfuse

Langfuse is usually fed by its SDK or by OpenTelemetry. Torrix has two matching paths.

### Option A: OpenTelemetry

Keep your instrumentation and point the exporter at Torrix:

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:8088/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="authorization=Bearer trxk_YOUR_KEY"
```

Torrix reads standard GenAI attributes and turns each span into a run. Langfuse-only attributes are
ignored, so use an instrumentation that emits standard `gen_ai.*` fields or map your spans before
export.

| OpenTelemetry attribute | Torrix field |
|---|---|
| `gen_ai.request.model` | model |
| `gen_ai.system`, `gen_ai.provider.name` | provider |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | token counts |
| `session.id`, `gen_ai.conversation.id` | session |
| `gen_ai.agent.name`, `peer.service` | agent |
| `gen_ai.prompt`, `gen_ai.completion` | prompt and response text |
| `trace_id`, parent `span_id` | trace and parent run |

See [OpenTelemetry](integrations/opentelemetry.md) for the full mapping.

### Option B: Torrix SDK

If you used the Langfuse SDK, replace the client setup with the Torrix SDK. It wraps the official
OpenAI and Anthropic clients and records each call without changing your request code.

Python:

```python
import torrix

torrix.init("trxk_YOUR_KEY", "http://localhost:8088")
torrix.wrap(openai_client)

with torrix.run_context(session_id="chat-7", agent_name="support-bot"):
    reply = openai_client.chat.completions.create(...)
```

TypeScript:

```ts
import * as torrix from "torrix-sdk";

torrix.init("trxk_YOUR_KEY", "http://localhost:8088");
torrix.wrap(openaiClient);

await torrix.runContext({ sessionId: "chat-7", agentName: "support-bot" }, async () => {
  await openaiClient.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello" }],
  });
});
```

See the [Python SDK](integrations/python-sdk.md) and
[TypeScript SDK](integrations/typescript-sdk.md) pages for streaming, Anthropic and Vercel AI SDK
examples.

## What carries over

- Runs with model, provider, tokens, cost, latency, status, prompt, response, reasoning and tool calls.
- Trace, session, parent run, agent, end user and tags.
- Cost calculated from Torrix pricing. Override a model on **Cost**, or set a custom price.
- Budgets, hard caps, alerts, PII masking, policies and tracing views, depending on your edition.

## What does not carry over automatically

- Historical traces. Export them from the old tool if you need a record. New calls are recorded from
  the switch onward.
- Helicone caching and retry features. Torrix does not cache provider responses.
- Langfuse scores, annotation queues and prompt experiments. Torrix has run scoring, notes, prompts
  and datasets, but there is no one-click importer yet.
- Langfuse-only span attributes and SDK-specific objects.

## Rollback

Point the base URL back at Helicone or Langfuse and restore the old headers. Torrix stores its own
runs, so removing it from the request path does not change your provider traffic or your stored data.
