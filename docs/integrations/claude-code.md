# Claude Code

The Torrix plugin for Claude Code records every model call your Claude Code sessions make: tokens,
prompt cache, cost, prompts, responses, tool calls and subagents. It works with a Claude
subscription or an API key.

The plugin does not sit between Claude Code and Anthropic. It reads the session transcript after
each turn and sends it to Torrix in the background. If Torrix is down, Claude Code keeps working
and the plugin catches up on the next turn without creating duplicates.

## Requirements

- Claude Code with the `claude` command available in your terminal. If you only use the VS Code
  extension, install the CLI first. It shares your login and settings:
  - macOS and Linux: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- Node.js 18 or newer on your PATH (the plugin's hook runs with `node`).

## Install

The easiest way is the **Integrations** page in Torrix: click **Generate key** on the Claude Code
card and copy the command. It looks like this:

```bash
claude plugin install torrix --marketplace TorrixAI/torrix --config api_key=trxk_YOUR_KEY --config base_url=http://localhost:8088
```

Then start a new Claude Code session, or run `/reload-plugins` in the current one.

You can also install from inside Claude Code:

```
/plugin marketplace add TorrixAI/torrix
/plugin install torrix@torrix
```

Claude Code asks for the Torrix URL, your API key (stored in your system's secure store) and an
optional project.

## Change the key or URL later

macOS and Linux:

```bash
echo '{"api_key":"trxk_NEW_KEY","base_url":"http://localhost:8088"}' | claude plugin configure torrix@torrix --values-stdin
```

Windows PowerShell:

```powershell
$utf8 = New-Object System.Text.UTF8Encoding $false; $OutputEncoding = $utf8; [Console]::InputEncoding = $utf8
'{"api_key":"trxk_NEW_KEY","base_url":"http://localhost:8088"}' | claude plugin configure torrix@torrix --values-stdin
```

## What you see in Torrix

| In Torrix | Comes from |
|---|---|
| Run | one model call |
| Session | your Claude Code session |
| Trace | each prompt you type, and everything it triggered |
| Agent | `claude-code`, or the subagent type such as `Explore` or `Plan` |
| Parent run | the call that started a subagent |
| Tags | Claude Code version, git branch, tools used |

Failed API calls (for example "overloaded" errors) appear as failed runs in the same trace.

## Troubleshooting

- **Nothing shows up.** Check that the plugin is enabled with `claude plugin list`, that you
  started a new session after installing, and that the key works on the Integrations page.
- **Cost shows $0.** Torrix has no price for that model yet. Add it under
  **Cost & Alerts > Pricing**.
- **Logs.** Errors are written to `torrix-hook.log` in the plugin's data folder under
  `~/.claude/plugins/data/`.
- **Pause logging** for a session by setting `TORRIX_DISABLED=1` before starting Claude Code.
