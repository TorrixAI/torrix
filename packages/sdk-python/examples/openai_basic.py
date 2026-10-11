"""Minimal example: log OpenAI SDK calls through a Torrix instance.

Run against a locally started Torrix server with:

    pip install torrix[openai]
    python openai_basic.py
"""

import torrix
from openai import OpenAI

torrix.init(base_url="http://localhost:8088", api_key="trxk_...", project="Default")

# Patch OpenAI (sync + async) to record every completion automatically.
torrix.wrap()

client = OpenAI()

res = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Say hello in one word."}],
)
print("model said:", res.choices[0].message.content)

# The request, response, tokens and cost are now visible in the Torrix dashboard.

# Manual capture also works for anything not going through the OpenAI SDK:
run_id = torrix.ingest(
    {
        "model": "claude-sonnet-4",
        "request": {"body": {"messages": [{"role": "user", "content": "ping"}]}},
        "response": {"body": {"content": "pong"}},
        "input_tokens": 5,
        "output_tokens": 1,
    }
)
print("ingested run ids:", run_id)