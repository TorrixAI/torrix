# HTTP proxy

The proxy is the quickest way in. Your app keeps talking to its provider, but through Torrix, and
Torrix records every call on the way. It works with any language and any client library that lets
you change the base URL or add headers.

## How it works

Send your request to `http://localhost:8088/proxy` and tell Torrix where it should go:

```bash
curl http://localhost:8088/proxy/v1/chat/completions \
  -H "authorization: Bearer trxk_YOUR_KEY" \
  -H "x-target-url: https://api.openai.com/v1/chat/completions" \
  -H "x-upstream-authorization: Bearer $OPENAI_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'
```

Three headers are required:

| Header | What it is |
|---|---|
| `authorization` | your Torrix key, `Bearer trxk_...` |
| `x-target-url` | the provider endpoint the call should go to |
| `x-upstream-authorization` | your provider key, passed on as the provider's `authorization` header. For Anthropic, send `x-api-key` as usual instead |

Torrix forwards the request, streams the answer back unchanged, and records tokens, cost, latency,
the prompt and response, reasoning and tool calls. Streaming works for OpenAI, Anthropic and other
providers that use server-sent events.

Paths after `/proxy` are accepted, so a client library configured with
`base_url = http://localhost:8088/proxy` can append `/v1/chat/completions` or `/v1/messages` on its
own.

## Group calls into turns and conversations

Optional headers fill in the fields described in [How Torrix organizes your data](../concepts.md):

| Header | Sets |
|---|---|
| `x-torrix-trace` | the trace, one per user turn. If missing, the W3C `traceparent` header is used, and if that is missing each call is its own trace |
| `x-torrix-session` | the session (a conversation) |
| `x-torrix-parent-run-id` | the call that started this one, for agent trees |
| `x-agent-name` | the agent making the call |
| `x-torrix-agent-id` | a stable agent id |
| `x-torrix-user-id` | your end user, for per-customer analytics |
| `x-torrix-name` | a readable name for the run (default: the first user message) |
| `x-torrix-tags` | extra labels, `key=value,key=value` |
| `x-torrix-project` | project id or name (default: your default project) |
| `x-run-id` | your own run id. It must be new: reusing an id that already exists returns `409 run_id_conflict` |
| `x-torrix-sample` | record only a share of calls, `0` to `1`. Failed calls are always recorded |
| `x-torrix-prompt`, `x-torrix-prompt-vars` | use a saved prompt from the prompt library, `name` or `name:revision`, with JSON variables |
| `x-torrix-retrieval-docs` | a JSON array of the documents you retrieved, shown on the run |

Every response carries an `x-torrix-run-id` header with the id of the recorded run.

## Coming from Helicone

Torrix understands Helicone's headers, so you can switch by changing the base URL first and
renaming headers later:

| Helicone header | Torrix field |
|---|---|
| `Helicone-Session-Id` | session |
| `Helicone-Session-Path` | the `session_path` tag |
| `Helicone-Request-Id` | run id |
| `Helicone-User-Id` | end user |
| `Helicone-Property-Name` | run name |

## Things to know

- Your provider key is passed through and never stored.
- Torrix refuses targets on private network addresses unless you allow a local host with
  `TORRIX_LOCAL_HOST`, so it cannot be used to reach internal services by accident.
- If a budget hard cap is reached, the proxy answers `429 hard_cap_reached` instead of forwarding.
- PII masking, when turned on, applies to what Torrix stores. The request sent to the provider is
  unchanged.
