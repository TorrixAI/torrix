# Python SDK

The Python SDK records calls made with the official `openai` and `anthropic` packages, including
async clients and streaming. It has no dependencies of its own and sends data in the background,
so it does not slow your app down.

Requires Python 3.9 or newer.

## Install

```bash
pip install "git+https://github.com/TorrixAI/torrix.git#subdirectory=packages/sdk-python"
```

## Set up

```python
import torrix

torrix.init(api_key="trxk_YOUR_KEY", base_url="http://localhost:8088")
```

That is enough. `init` finds the installed `openai` and `anthropic` packages and records every call
made through them from then on. To record only one client instead, pass `auto_instrument=False`
and wrap that client:

```python
from openai import OpenAI

client = torrix.wrap(OpenAI())
```

## Group calls into turns and agents

Use `run_context` to say which calls belong together:

```python
with torrix.run_context(session_id="chat-7", agent_name="support-bot"):
    plan = client.chat.completions.create(model="gpt-4o-mini", messages=[...])

    with torrix.run_context(agent_name="researcher"):
        notes = client.chat.completions.create(model="gpt-4o-mini", messages=[...])

    answer = client.chat.completions.create(model="gpt-4o-mini", messages=[...])
```

- Everything inside the outer block is one trace (one turn) in session `chat-7`.
- `plan` and `answer` are siblings, made by `support-bot`.
- The `researcher` calls hang under `plan`, the latest call made before the inner block opened.

You can also pass `trace_id`, `name` and `parent_run_id` to `run_context` to set them yourself.

## Name a single call

```python
client.chat.completions.create(model="gpt-4o-mini", messages=[...], torrix_name="classify ticket")
```

`torrix_name` is removed before the request goes to the provider.

## Send records yourself

For providers or frameworks the SDK does not wrap, send a record directly. Token counts and cost
are worked out from the bodies when you leave them out:

```python
torrix.ingest({
    "model": "gpt-4o-mini",
    "provider": "openai",
    "input_tokens": 120,
    "output_tokens": 40,
    "request": {"body": {"messages": [{"role": "user", "content": "Hi"}]}},
    "response": {"body": {"choices": [{"message": {"content": "Hello"}}]}},
})
```

See the [Ingest API](ingest-api.md) for every field.

## Options

| `init` option | Default | What it does |
|---|---|---|
| `project` | your default project | project id or name for all calls |
| `sample_rate` | `1.0` | record only a share of calls |
| `background` | `True` | send in a background thread; `False` sends before returning |
| `enabled` | `True` | turn recording off without removing code |
| `timeout` | `10.0` | seconds to wait for Torrix |

Data is flushed when the process exits. Call `torrix.flush()` to send everything now, for example
at the end of a short script or a serverless function.
