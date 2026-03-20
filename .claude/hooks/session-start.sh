#!/bin/bash
set -euo pipefail

# Only run in remote (cloud) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

###############################################################################
# Persistent bin directory — survives across remote sessions
###############################################################################
PERSISTENT_BIN="$CLAUDE_PROJECT_DIR/.claude/bin"
mkdir -p "$PERSISTENT_BIN"
export PATH="$PERSISTENT_BIN:$PATH"

# Persist PATH for all subsequent Bash tool calls in this session
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$PERSISTENT_BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

###############################################################################
# GitHub CLI — default repo so `gh` works despite local-proxy remote
###############################################################################
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export GH_REPO=lalli-oni/cards" >> "$CLAUDE_ENV_FILE"
fi
export GH_REPO="lalli-oni/cards"
if ! command -v gh &>/dev/null; then
  echo "Installing GitHub CLI..."
  GH_VERSION="2.65.0"
  GH_ARCH="$(uname -m)"
  case "$GH_ARCH" in
    x86_64)  GH_ARCH="amd64" ;;
    aarch64) GH_ARCH="arm64" ;;
  esac
  GH_TAR="gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz"
  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${GH_TAR}" -o "/tmp/${GH_TAR}"
  tar -xzf "/tmp/${GH_TAR}" -C /tmp
  cp "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}/bin/gh" "$PERSISTENT_BIN/gh"
  chmod +x "$PERSISTENT_BIN/gh"
  rm -rf "/tmp/${GH_TAR}" "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}"
fi

###############################################################################
# Nushell — used by /card-query and /session-query skills
###############################################################################
if ! command -v nu &>/dev/null; then
  echo "Installing Nushell..."
  NU_VERSION="0.103.0"
  NU_ARCH="$(uname -m)"
  case "$NU_ARCH" in
    x86_64)  NU_ARCH="x86_64" ;;
    aarch64) NU_ARCH="aarch64" ;;
  esac
  NU_TAR="nu-${NU_VERSION}-${NU_ARCH}-unknown-linux-gnu.tar.gz"
  curl -fsSL "https://github.com/nushell/nushell/releases/download/${NU_VERSION}/${NU_TAR}" -o "/tmp/${NU_TAR}"
  tar -xzf "/tmp/${NU_TAR}" -C /tmp
  cp "/tmp/nu-${NU_VERSION}-${NU_ARCH}-unknown-linux-gnu/nu" "$PERSISTENT_BIN/nu"
  chmod +x "$PERSISTENT_BIN/nu"
  rm -rf "/tmp/${NU_TAR}" "/tmp/nu-${NU_VERSION}-${NU_ARCH}-unknown-linux-gnu"
fi

###############################################################################
# Bun dependencies — install only if node_modules appears incomplete
###############################################################################
cd "$CLAUDE_PROJECT_DIR"
if [ ! -d "engine/node_modules/immer" ]; then
  echo "Installing bun workspace dependencies..."
  bun install
fi

