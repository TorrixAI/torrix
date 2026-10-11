# Ingest API

The ingest API is the simplest building block: you send Torrix a record describing a call you
already made. Use it from any language, for custom frameworks, or to backfill history.

## Send records

```bash
curl http://localhost:8088/api/ingest \
  -H "authorization: Bearer trxk_YOUR_KEY" \
  -H "content-type: application/json" \
  -d '{
    "records": [{
      "model": "gpt-4o-mini",
      "provider": "openai",
      "start_time": "2026-10-11T09:00:00.000Z",
      "end_time": "2026-10-11T09:00:01.200Z",
      "trace_id": "turn-42",
      "session_id": "chat-7",
      "agent_name": "support-bot",
      "request":  { "body": { "messages": [{ "role": "user", "content": "Hi" }] } },
      "response": { "body": { "choices": [{ "message": { "content": "Hello" } }], "usage": { "prompt_tokens": 9, "completion_tokens": 3 } } }
    }]
  }'
```

The body can be `{"records": [...]}` or a plain array. Up to 500 records per request.

The answer is `{"accepted": 1, "ids": ["..."]}`. A record whose `id` belongs to another account is
listed under `rejected` instead.

## Fields

| Field | Meaning |
|---|---|
| `id` | your run id. Sending the same id again is safe: it is acknowledged, not stored twice. An id that belongs to another account is rejected with `run_id_conflict` |
| `name` | a readable name (default: the first user message) |
| `provider`, `model` | who served the call |
| `status`, `error` | HTTP-style status (default 200) and an error message |
| `start_time`, `end_time` | ISO timestamps. The run is placed at `start_time`, and the duration is the difference |
| `latency_ms` | duration, if you do not send both times |
| `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `cache_creation_tokens` | usage. Left out, they are read from the response body |
| `cost_usd` | cost. Left out, it is calculated from the model price, including prompt cache pricing for Claude models |
| `request.body`, `response.body` | the provider's request and response. OpenAI and Anthropic shapes are understood, including reasoning and tool calls |
| `trace_id`, `session_id`, `parent_run_id`, `agent_name`, `agent_id`, `end_user_id` | grouping, see [How Torrix organizes your data](../concepts.md) |
| `tags` | an object of extra labels |
| `project_id` | project. You can also send the `x-torrix-project` header with an id or name |
| `retrieval_docs` | documents you retrieved for the call, shown on the run |

## Limits

- Records count toward your budget hard caps. When a cap is reached the request answers
  `429 hard_cap_reached`.
- PII masking, when turned on, is applied before anything is stored.
