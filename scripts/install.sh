#!/bin/sh
# SAF Kanban CLI installer for macOS and Linux
#
# Install or upgrade:
#   curl -fsSL https://whlshy.github.io/SAF_Kanban/install.sh | sh
#
# Options (CLI flags via `sh -s -- ...` or environment variables):
#   --version VER   / SAF_KANBAN_VERSION      Specific version (e.g. 0.6.0 or desktop-v0.6.0)
#   --dir DIR       / SAF_KANBAN_INSTALL_DIR  Install directory (default: ~/.local/bin)
#   --no-path       / SAF_KANBAN_NO_PATH=1    Do not modify shell profile PATH
#   --uninstall     / SAF_KANBAN_UNINSTALL=1  Remove saf-kanban-cli

set -eu

REPO="whlshy/SAF_Kanban"
INSTALL_DIR="${SAF_KANBAN_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${SAF_KANBAN_VERSION:-}"
NO_PATH="${SAF_KANBAN_NO_PATH:-0}"
UNINSTALL="${SAF_KANBAN_UNINSTALL:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --no-path)
      NO_PATH=1
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    -h|--help)
      sed -n '2,12p' "$0" 2>/dev/null || echo "Usage: curl -fsSL https://whlshy.github.io/SAF_Kanban/install.sh | sh"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

BIN_PATH="$INSTALL_DIR/saf-kanban-cli"

if [ "$UNINSTALL" = "1" ]; then
  if [ -f "$BIN_PATH" ]; then
    rm -f "$BIN_PATH"
    echo "Removed $BIN_PATH"
  else
    echo "saf-kanban-cli was not found at $BIN_PATH"
  fi
  echo "Done. Board files in ~/.local/share/saf-kanban were kept."
  exit 0
fi

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64|aarch64) TARGET="macos-arm64" ;;
      x86_64|amd64)  TARGET="macos-x64" ;;
      *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64) TARGET="linux-x64" ;;
      *) echo "Unsupported Linux architecture: $ARCH (currently x86_64 is supported)" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS (on Windows, use PowerShell: irm https://whlshy.github.io/SAF_Kanban/install.ps1 | iex)" >&2
    exit 1
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install saf-kanban-cli." >&2
  exit 1
fi

if [ -n "$VERSION" ]; then
  case "$VERSION" in
    desktop-v*) TAG="$VERSION" ;;
    v*)         TAG="desktop-$VERSION" ;;
    *)          TAG="desktop-v$VERSION" ;;
  esac
else
  FINAL_URL="$(curl -fsSI -L -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
  TAG="${FINAL_URL##*/}"
  if [ -z "$TAG" ] || [ "$TAG" = "latest" ]; then
    echo "Couldn't determine the latest SAF Kanban release." >&2
    exit 1
  fi
fi

VER="${TAG#desktop-v}"
ASSET="saf-kanban-cli-${VER}-${TARGET}.tar.gz"
BASE_URL="https://github.com/$REPO/releases/download/$TAG"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

echo "Downloading SAF Kanban CLI $VER ($ASSET)..."
curl -fsSL "$BASE_URL/$ASSET" -o "$TMP_DIR/$ASSET"
curl -fsSL "$BASE_URL/SHA256SUMS.txt" -o "$TMP_DIR/SHA256SUMS.txt"

EXPECTED="$(awk -v f="$ASSET" '$2 == f || $2 == "*" f { print tolower($1); exit }' "$TMP_DIR/SHA256SUMS.txt")"
if [ -z "$EXPECTED" ]; then
  echo "SHA256SUMS.txt does not contain an entry for $ASSET." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP_DIR/$ASSET" | awk '{ print tolower($1) }')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TMP_DIR/$ASSET" | awk '{ print tolower($1) }')"
else
  echo "Neither sha256sum nor shasum is available to verify the download." >&2
  exit 1
fi

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "SHA-256 checksum mismatch for $ASSET (expected $EXPECTED, got $ACTUAL)." >&2
  exit 1
fi

tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR"
if [ ! -f "$TMP_DIR/saf-kanban-cli" ]; then
  echo "saf-kanban-cli was not found inside $ASSET." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
mv -f "$TMP_DIR/saf-kanban-cli" "$BIN_PATH"
chmod 755 "$BIN_PATH"

ADDED_RC=""
if [ "$NO_PATH" != "1" ]; then
  case ":${PATH:-}:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      SHELL_NAME="$(basename "${SHELL:-}")"
      case "$SHELL_NAME" in
        zsh)  RC_FILE="$HOME/.zshrc" ;;
        bash)
          if [ "$OS" = "Darwin" ] && [ -f "$HOME/.bash_profile" ]; then
            RC_FILE="$HOME/.bash_profile"
          else
            RC_FILE="$HOME/.bashrc"
          fi
          ;;
        *)    RC_FILE="$HOME/.profile" ;;
      esac
      PATH_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""
      if [ ! -f "$RC_FILE" ] || ! grep -Fq "$INSTALL_DIR" "$RC_FILE"; then
        printf '\n# Added by SAF Kanban CLI installer\n%s\n' "$PATH_LINE" >> "$RC_FILE"
        ADDED_RC="$RC_FILE"
      fi
      ;;
  esac
fi

INSTALLED_VERSION="$("$BIN_PATH" --version)"
echo ""
echo "Installed $INSTALLED_VERSION to $BIN_PATH"
echo "Next steps:"
echo "  saf-kanban-cli boards           # List your boards"
echo "  saf-kanban-cli skill --install  # Install the AI agent skill (Claude Code, Codex, Cursor, Antigravity, ...)"
if [ -n "$ADDED_RC" ]; then
  echo ""
  echo "Added $INSTALL_DIR to $ADDED_RC."
  echo "Run \`source $ADDED_RC\` or open a new terminal to use \`saf-kanban-cli\`."
fi
