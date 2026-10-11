# opencode

The Torrix plugin for opencode records every step opencode takes: the model call, tokens, cost,
reasoning, tool calls and the agent that made it, grouped by session and by user turn. Subagents
appear under the agent that started them.

Requires opencode 2.x.

## Install

1. Copy the plugin from this repository into your opencode plugins folder.

   macOS and Linux:

   ```bash
   mkdir -p ~/.config/opencode/plugins
   cp .opencode/plugins/torrix.js ~/.config/opencode/plugins/
   ```

   Windows PowerShell:

   ```powershell
   New-Item -ItemType Directory -Force "$HOME\.config\opencode\plugins" | Out-Null
   Copy-Item .opencode\plugins\torrix.js "$HOME\.config\opencode\plugins\"
   ```

   To log a single project only, copy it to `<project>/.opencode/plugins/` instead.

2. Tell the plugin where Torrix is. Set these environment variables, then start opencode from a
   new terminal:

   | Variable | Required | Meaning |
   |---|---|---|
   | `TORRIX_API_KEY` | yes | your Torrix key; without it the plugin does nothing |
   | `TORRIX_URL` | no | Torrix address, default `http://localhost:8088` |
   | `TORRIX_PROJECT` | no | project id or name |
   | `TORRIX_TAGS` | no | extra labels, `key=value,key=value` |
   | `TORRIX_DEBUG` | no | `1` writes plugin diagnostics to `torrix-opencode.log` in your temp folder |

The **Integrations** page shows these commands with your key filled in.

## What you see in Torrix

| In Torrix | Comes from |
|---|---|
| Run | one opencode step (one model call), sent as soon as the step ends |
| Session | the root opencode session, so a whole conversation stays together |
| Trace | one user turn, including every subagent it started |
| Agent | the opencode agent: `build`, `plan`, `explore` and so on |
| Parent run | the parent agent's call, for subagents |

## Using the proxy as well

If you also point opencode's provider base URL at the Torrix proxy, the plugin tells the proxy not
to store successful calls a second time, so each call is recorded once. Failed calls are still
recorded by the proxy. Set `TORRIX_INGEST=false` if you want the proxy to be the only source.

## Nothing shows up?

- Start opencode from a terminal opened **after** you set the variables. A terminal that was
  already open, or an editor started earlier, still has the old values.
- Open the **Integrations** page in Torrix. The opencode card says **Connected** once a run arrives.
- Set `TORRIX_DEBUG=1`, run one prompt, and read `torrix-opencode.log` in your temp folder. It
  shows whether the plugin loaded, whether it found your key, and what Torrix answered.
