# OpenTelemetry

If your app already emits OpenTelemetry traces for its AI calls, point the exporter at Torrix. Each
span with GenAI attributes becomes a run, and span parents become the agent tree.

## Configure the exporter

Torrix accepts OTLP over HTTP with JSON bodies (gzip is fine) at `POST /v1/traces`.

macOS and Linux:

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:8088/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="authorization=Bearer trxk_YOUR_KEY"
```

Windows PowerShell:

```powershell
$env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://localhost:8088/v1/traces"
$env:OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = "http/json"
$env:OTEL_EXPORTER_OTLP_TRACES_HEADERS = "authorization=Bearer trxk_YOUR_KEY"
```

The protobuf encoding is not supported, so make sure the protocol is `http/json`.

## How spans map to runs

| Span attribute | Torrix field |
|---|---|
| `gen_ai.request.model`, `llm.request.model` | model |
| `gen_ai.system`, `gen_ai.provider.name`, `llm.vendor` | provider |
| `gen_ai.usage.input_tokens`, `llm.usage.prompt_tokens` | input tokens |
| `gen_ai.usage.output_tokens`, `llm.usage.completion_tokens` | output tokens |
| `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens` | prompt cache tokens |
| `session.id`, `gen_ai.conversation.id` | session |
| `gen_ai.agent.name`, `peer.service` | agent |
| `gen_ai.prompt`, `gen_ai.completion` (or span events) | prompt and response text |
| `torrix.project_id` (or the `x-torrix-project-id` header) | project |
| span trace id and parent span id | trace and parent run, within the same trace |

Cost is calculated from the model and token counts.

## Matching proxy calls to your traces

If some calls go through the [HTTP proxy](http-proxy.md), send the standard W3C `traceparent` header
with them. The proxy uses its trace id, so those calls land in the same trace as your spans.
