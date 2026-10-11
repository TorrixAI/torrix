#!/usr/bin/env sh
# Torrix installer: downloads the latest compiled binary and, when possible,
# registers a system service. Mirrors the install command shown in the UI:
#   curl -fsSL https://torrix.ai/install.sh | sh
set -eu

REPO="${TORRIX_REPO:-TorrixAI/torrix}"
BIN_DIR="${TORRIX_BIN_DIR:-/usr/local/bin}"
DATA_DIR="${TORRIX_DATA_DIR:-/var/lib/torrix}"
PORT="${PORT:-8088}"
DB_PATH="${DB_PATH:-$DATA_DIR/torrix.sqlite}"

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || [ "$(uname -s)" = "Darwin" ] || fail "unsupported OS: $(uname -s)"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

asset="torrix-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"
tmp="$(mktemp)"
say "Downloading ${url}…"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp" || fail "download failed"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$url" || fail "download failed"
else
  fail "curl or wget is required"
fi
chmod +x "$tmp"

if [ -w "$BIN_DIR" ]; then
  mv "$tmp" "$BIN_DIR/torrix"
else
  say "Installing to ${BIN_DIR} (sudo required)…"
  sudo mv "$tmp" "$BIN_DIR/torrix"
fi
say "Installed $("$BIN_DIR/torrix" --version 2>/dev/null || echo torrix) to ${BIN_DIR}/torrix"

if [ "$os" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
  if [ ! -d "$DATA_DIR" ]; then
    sudo mkdir -p "$DATA_DIR"
    sudo chmod 750 "$DATA_DIR"
  fi
  script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
  unit_src="$script_dir/systemd/torrix.service"
  [ -f "$unit_src" ] || unit_src="$script_dir/../deploy/systemd/torrix.service"
  if [ -f "$unit_src" ]; then
    say "Installing systemd unit…"
    sudo sed "s|__DB_PATH__|$DB_PATH|; s|__PORT__|$PORT|" "$unit_src" | sudo tee /etc/systemd/system/torrix.service >/dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable --now torrix.service
    say "Torrix is running: systemctl status torrix"
    exit 0
  fi
fi

if [ "$os" = "darwin" ]; then
  plist_src="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/launchd/ai.torrix.plist"
  [ -f "$plist_src" ] || plist_src="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/../deploy/launchd/ai.torrix.plist"
  if [ -f "$plist_src" ]; then
    say "Installing launchd agent…"
    target="$HOME/Library/LaunchAgents/ai.torrix.plist"
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.torrix"
    sed "s|__DB_PATH__|$HOME/.torrix/torrix.sqlite|; s|__PORT__|$PORT|" "$plist_src" > "$target"
    launchctl unload "$target" 2>/dev/null || true
    launchctl load "$target"
    say "Torrix is running: launchctl list | grep torrix"
    exit 0
  fi
fi

say "Run it with: DB_PATH=${DB_PATH} PORT=${PORT} torrix"
