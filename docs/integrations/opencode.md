# opencode

The Torrix plugin for opencode records every step opencode takes: the model call, tokens, cost,
reasoning, tool calls and the agent that made it, grouped by session and by user turn. Subagents
appear under the agent that started them.

Requires opencode 2.x.

## Install

The easiest way is the **Integrations** page in Torrix. Choose **opencode**, click **Generate key**
and copy the command it shows.

macOS and Linux:

```bash
curl -fsSL http://localhost:8088/api/connect/opencode.sh | TORRIX_API_KEY=trxk_YOUR_KEY sh
```

Windows PowerShell:

```powershell
$env:TORRIX_API_KEY="trxk_YOUR_KEY"; irm http://localhost:8088/api/connect/opencode.ps1 | iex
```

The command downloads the plugin from your Torrix instance, writes it to
`~/.config/opencode/plugins/torrix.js`, and saves the connection to `~/.torrix/opencode.json` with
owner-only permissions. Restart opencode (or T3 Code) and start a new session. Re-run the same
command whenever your key or Torrix address changes.

No environment variables are needed: opencode, editors and T3 Code read the connection file, which
makes the plugin work even when a GUI app does not inherit your shell environment.

To log a single project only, copy the served plugin to `<project>/.opencode/plugins/torrix.js`
instead of installing it globally. The connection file is still read from your home folder.

### Manual installation

1. Copy the plugin into your opencode plugins folder. In a Torrix source checkout the canonical
   file is `packages/server/src/assets/opencode-torrix.plugin.js`; the repository's
   `.opencode/plugins/torrix.js` is only a loader for Torrix's own sessions.

   macOS and Linux:

   ```bash
   mkdir -p ~/.config/opencode/plugins
   cp packages/server/src/assets/opencode-torrix.plugin.js ~/.config/opencode/plugins/torrix.js
   ```

   Windows PowerShell:

   ```powershell
   New-Item -ItemType Directory -Force "$HOME\.config\opencode\plugins" | Out-Null
   Copy-Item packages\server\src\assets\opencode-torrix.plugin.js "$HOME\.config\opencode\plugins\torrix.js"
   ```

2. Save the connection, then start opencode from a new terminal:

   ```bash
   mkdir -p ~/.torrix
   printf '{"url":"%s","api_key":"%s"}\n' "http://localhost:8088" "trxk_YOUR_KEY" > ~/.torrix/opencode.json
   chmod 600 ~/.torrix/opencode.json
   ```

   Environment variables still work and take precedence over the file:

   | Variable | Required | Meaning |
   |---|---|---|
   | `TORRIX_API_KEY` | yes | your Torrix key; without it the plugin does nothing |
   | `TORRIX_URL` | no | Torrix address, default `http://localhost:8088` |
   | `TORRIX_PROJECT` | no | project id or name |
   | `TORRIX_TAGS` | no | extra labels, `key=value,key=value` |
   | `TORRIX_DEBUG` | no | `1` writes plugin diagnostics to `torrix-opencode.log` in your temp folder |

   The JSON file accepts the same settings in snake_case: `url`, `api_key`, `project`, `tags`,
   `ingest`, `proxy_tags`, `debug`, `guard`, `guard_fail`, `agent_key`.

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

- Restart opencode (or T3 Code) after installing and start a new session. A session that was
  already running keeps the old plugin state.
- Check that `~/.torrix/opencode.json` exists and contains your key. Re-run the installer command
  if it is missing, and remember that `TORRIX_API_KEY` and `TORRIX_URL` override the file.
- Open the **Integrations** page in Torrix. The opencode card says **Connected** once a run arrives.
- Set `TORRIX_DEBUG=1`, run one prompt, and read `torrix-opencode.log` in your temp folder. It
  shows whether the plugin loaded, whether it found your key, and what Torrix answered.
