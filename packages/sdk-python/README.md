# Torrix Python SDK

Record every OpenAI and Anthropic call your Python app or agent makes in
[Torrix](https://github.com/TorrixAI/torrix), the self-hosted observability platform for AI agents.
You get the prompt, response, tokens, cost, latency and tool calls of each call, grouped into
traces and sessions.

- No dependencies of its own. Works with sync, async and streaming clients.
- Sends data in a background thread, so your app is not slowed down.
- Your data goes only to your own Torrix server.

## Install

```bash
pip install torrix-sdk
```

You also need a running Torrix server. The quickest way:

```bash
docker run -d --name torrix -p 8088:8088 -v torrix_data:/data gettorrixai/torrix:latest
```

Open http://localhost:8088, create your account, and copy an API key from **Integrations**.

## Use

The package installs as `torrix-sdk` and imports as `torrix`.

```python
import torrix

torrix.init(api_key="trxk_YOUR_KEY", base_url="http://localhost:8088")
```

That is all. Every call made through the installed `openai` and `anthropic` packages is recorded
from now on.

Group calls into one turn and name the agent that made them:

```python
with torrix.run_context(session_id="chat-7", agent_name="support-bot"):
    answer = client.chat.completions.create(model="gpt-4o-mini", messages=[...])
```

Short scripts and serverless functions should call `torrix.flush()` before they exit.

## Learn more

- [Python SDK guide](https://github.com/TorrixAI/torrix/blob/main/docs/integrations/python-sdk.md)
- [How Torrix organizes your data](https://github.com/TorrixAI/torrix/blob/main/docs/concepts.md)
- [Torrix on GitHub](https://github.com/TorrixAI/torrix)

MIT licensed.
