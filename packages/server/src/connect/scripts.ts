// One-command connect scripts served by the Integrations page. They are
// intentionally plain POSIX shell and PowerShell so a self-hosted instance can
// onboard a tool without publishing a package first. The API key is passed in
// the environment by the command shown in the UI and never appears in the URL
// or in this module.
import opencodePluginSource from "../assets/opencode-torrix.plugin.js" with { type: "text" };

const OPENCODE_PLUGIN = opencodePluginSource.endsWith("\n") ? opencodePluginSource : `${opencodePluginSource}\n`;
const OPENCODE_HEREDOC = "TORRIX_OPENCODE_PLUGIN_EOF";
const POWERSHELL_HEREDOC = "@'";

function base(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Single-quote a value for POSIX sh. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Single-quote a value for PowerShell. */
function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function requireQuotesFree(name: string): string {
  return `case "$${name}" in *\\"*|*\\\\*) echo "${name} must not contain quotes or backslashes." >&2; exit 1;; esac`;
}

export function opencodeInstallScript(baseUrl: string): string {
  const url = base(baseUrl);
  return `#!/bin/sh
set -eu

if [ -z "\${TORRIX_API_KEY:-}" ]; then
  echo "Set TORRIX_API_KEY to a Torrix API key from Integrations, then run this again." >&2
  exit 1
fi

TORRIX_URL="\${TORRIX_URL:-${url}}"
${requireQuotesFree("TORRIX_URL")}
${requireQuotesFree("TORRIX_API_KEY")}

PLUGIN_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins"
CONFIG_DIR="$HOME/.torrix"
mkdir -p "$PLUGIN_DIR" "$CONFIG_DIR"

cat > "$PLUGIN_DIR/torrix.js" <<'${OPENCODE_HEREDOC}'
${OPENCODE_PLUGIN}${OPENCODE_HEREDOC}

umask 077
printf '%s\\n' "{\\"url\\":\\"$TORRIX_URL\\",\\"api_key\\":\\"$TORRIX_API_KEY\\"}" > "$CONFIG_DIR/opencode.json"
chmod 700 "$CONFIG_DIR" 2>/dev/null || true
chmod 600 "$CONFIG_DIR/opencode.json" 2>/dev/null || true
chmod 644 "$PLUGIN_DIR/torrix.js" 2>/dev/null || true

echo "Torrix installed for opencode."
echo "  plugin: $PLUGIN_DIR/torrix.js"
echo "  config: $CONFIG_DIR/opencode.json"
echo "Restart opencode or T3 Code, then start a new session."
`;
}

export function opencodeInstallScriptPowerShell(baseUrl: string): string {
  const url = base(baseUrl);
  return `$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($env:TORRIX_API_KEY)) {
  throw "Set TORRIX_API_KEY to a Torrix API key from Integrations, then run this again."
}
$TorrixUrl = if ([string]::IsNullOrWhiteSpace($env:TORRIX_URL)) { "${url}" } else { $env:TORRIX_URL }
$pluginDir = Join-Path $HOME ".config\\opencode\\plugins"
$configDir = Join-Path $HOME ".torrix"
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$plugin = ${POWERSHELL_HEREDOC}
${OPENCODE_PLUGIN}'@
[System.IO.File]::WriteAllText((Join-Path $pluginDir "torrix.js"), $plugin, [System.Text.UTF8Encoding]::new($false))
$json = @{ url = $TorrixUrl; api_key = $env:TORRIX_API_KEY } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $configDir "opencode.json"), $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Torrix installed for opencode."
Write-Host ("  plugin: " + (Join-Path $pluginDir "torrix.js"))
Write-Host ("  config: " + (Join-Path $configDir "opencode.json"))
Write-Host "Restart opencode or T3 Code, then start a new session."
`;
}

export function claudeCodeInstallScript(
  baseUrl: string,
  marketplace: string,
  fallbackMarketplace = "TorrixAI/torrix",
): string {
  const url = base(baseUrl);
  return `#!/bin/sh
set -eu

if [ -z "\${TORRIX_API_KEY:-}" ]; then
  echo "Set TORRIX_API_KEY to a Torrix API key from Integrations, then run this again." >&2
  exit 1
fi

TORRIX_URL="\${TORRIX_URL:-${url}}"
${requireQuotesFree("TORRIX_URL")}
${requireQuotesFree("TORRIX_API_KEY")}

if ! command -v claude >/dev/null 2>&1; then
  echo "The claude command is not on PATH. Install Claude Code first:" >&2
  echo "  curl -fsSL https://claude.ai/install.sh | bash" >&2
  exit 1
fi

# A source checkout serves its own marketplace path; it only makes sense on the
# machine that runs Torrix. Remote users get the published marketplace instead.
MARKETPLACE=${shellQuote(marketplace)}
case "$MARKETPLACE" in
  /*) if [ ! -d "$MARKETPLACE" ]; then MARKETPLACE=${shellQuote(fallbackMarketplace)}; fi ;;
esac

if claude plugin install torrix --marketplace "$MARKETPLACE" --config "api_key=$TORRIX_API_KEY" --config "base_url=$TORRIX_URL"; then
  :
else
  printf '%s\\n' "{\\"api_key\\":\\"$TORRIX_API_KEY\\",\\"base_url\\":\\"$TORRIX_URL\\"}" | claude plugin configure torrix@torrix --values-stdin
fi

echo "Torrix installed for Claude Code. Start a new session, or run /reload-plugins."
`;
}

export function claudeCodeInstallScriptPowerShell(
  baseUrl: string,
  marketplace: string,
  fallbackMarketplace = "TorrixAI/torrix",
): string {
  const url = base(baseUrl);
  return `$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($env:TORRIX_API_KEY)) {
  throw "Set TORRIX_API_KEY to a Torrix API key from Integrations, then run this again."
}
$TorrixUrl = if ([string]::IsNullOrWhiteSpace($env:TORRIX_URL)) { "${url}" } else { $env:TORRIX_URL }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw "The claude command is not on PATH. Install Claude Code first: irm https://claude.ai/install.ps1 | iex"
}

# A source checkout serves its own marketplace path; it only makes sense on the
# machine that runs Torrix. Remote users get the published marketplace instead.
$Marketplace = ${powershellQuote(marketplace)}
if ([System.IO.Path]::IsPathRooted($Marketplace) -and -not (Test-Path $Marketplace)) {
  $Marketplace = ${powershellQuote(fallbackMarketplace)}
}

& claude plugin install torrix --marketplace $Marketplace --config "api_key=$env:TORRIX_API_KEY" --config "base_url=$TorrixUrl"
if ($LASTEXITCODE -ne 0) {
  $json = @{ api_key = $env:TORRIX_API_KEY; base_url = $TorrixUrl } | ConvertTo-Json -Compress
  $json | & claude plugin configure torrix@torrix --values-stdin
  if ($LASTEXITCODE -ne 0) { throw "claude plugin configure failed with exit code $LASTEXITCODE" }
}
Write-Host "Torrix installed for Claude Code. Start a new session, or run /reload-plugins."
`;
}
