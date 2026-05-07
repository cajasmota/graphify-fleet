#!/usr/bin/env bash
# graphify-fleet installer — one-line install
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<you>/graphify-fleet/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/<you>/graphify-fleet/main/install.sh | bash -s -- --branch dev
#
# What it does:
#   1. Verifies prerequisites (git, node 18.19+, uv, python 3.10+) and fixes what it can
#   2. Clones graphify-fleet to ~/.graphify-fleet (or pulls if it already exists)
#   3. Runs `npm install`
#   4. Symlinks bin/gfleet onto PATH (~/.local/bin)
#   5. Runs `gfleet doctor`
#   6. Prints next steps

set -euo pipefail

REPO_URL="${GFLEET_REPO_URL:-https://github.com/cajasmota/graphify-fleet.git}"
INSTALL_DIR="${GFLEET_INSTALL_DIR:-$HOME/.graphify-fleet}"
BIN_DIR="${GFLEET_BIN_DIR:-$HOME/.local/bin}"
BRANCH="main"

# parse args
while [ $# -gt 0 ]; do
    case "$1" in
        --branch) BRANCH="$2"; shift 2 ;;
        --dir)    INSTALL_DIR="$2"; shift 2 ;;
        --bin)    BIN_DIR="$2"; shift 2 ;;
        --repo)   REPO_URL="$2"; shift 2 ;;
        *) echo "unknown flag: $1" >&2; exit 1 ;;
    esac
done

# ----- ui -----
c_red()   { printf '\033[31m%s\033[0m\n' "$*"; }
c_green() { printf '\033[32m%s\033[0m\n' "$*"; }
c_yel()   { printf '\033[33m%s\033[0m\n' "$*"; }
c_dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
say()     { printf '%s\n' "$*"; }
hr()      { printf '\033[2m─────────────────────────────────────────────\033[0m\n'; }
ok()      { c_green "✓ $*"; }
warn()    { c_yel  "! $*"; }
err()     { c_red  "✗ $*"; }
info()    { say "  $*"; }

# ----- platform -----
case "$(uname -s)" in
    Darwin)  PLATFORM="darwin" ;;
    Linux)   PLATFORM="linux" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)       PLATFORM="unknown" ;;
esac

say ""
c_green "graphify-fleet installer"
hr
say "platform:    $PLATFORM"
say "install to:  $INSTALL_DIR"
say "bin dir:     $BIN_DIR"
say "branch:      $BRANCH"
say ""

# ----- prerequisites -----
need_install_uv=0
need_install_node=0

if command -v git >/dev/null 2>&1; then
    ok "git: $(git --version | head -1)"
else
    err "git is required and not found. Install it first."
    case "$PLATFORM" in
        darwin) info "  brew install git    (or install Xcode Command Line Tools)" ;;
        linux)  info "  apt install git   /  dnf install git   /  pacman -S git" ;;
    esac
    exit 1
fi

# Node 18.19+
if command -v node >/dev/null 2>&1; then
    NODE_VER="$(node -v 2>/dev/null | sed 's/^v//' | head -1)"
    NODE_MAJOR="${NODE_VER%%.*}"
    if [ "$NODE_MAJOR" -ge 18 ]; then
        ok "node: v$NODE_VER"
    else
        warn "node v$NODE_VER is too old; gfleet needs Node 18.19+"
        need_install_node=1
    fi
else
    warn "node not found"
    need_install_node=1
fi

if [ "$need_install_node" = 1 ]; then
    say ""
    info "Installing Node 18.19+ via fnm (https://github.com/Schniz/fnm)..."
    if ! command -v fnm >/dev/null 2>&1; then
        case "$PLATFORM" in
            darwin|linux)
                curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell || {
                    err "fnm install failed. Install Node 18.19+ manually and re-run this script."
                    exit 1
                }
                # shellcheck disable=SC1090
                export PATH="$HOME/.local/share/fnm:$HOME/.fnm:$PATH"
                eval "$(fnm env --use-on-cd 2>/dev/null || fnm env)"
                ;;
            *)
                err "Auto Node install not supported on $PLATFORM. Install Node 18.19+ manually."
                exit 1
                ;;
        esac
    fi
    fnm install 22 >/dev/null 2>&1 || fnm install 20 >/dev/null 2>&1 || true
    fnm use 22 >/dev/null 2>&1 || fnm use 20 >/dev/null 2>&1 || {
        err "Could not select a Node version. Install Node 18.19+ manually."
        exit 1
    }
    ok "node installed: $(node -v)"
fi

# uv
if command -v uv >/dev/null 2>&1; then
    ok "uv: $(uv --version 2>&1 | head -1)"
else
    warn "uv not found; will install"
    need_install_uv=1
fi

if [ "$need_install_uv" = 1 ]; then
    say ""
    info "Installing uv (Astral)..."
    curl -fsSL https://astral.sh/uv/install.sh | sh
    # uv installs to ~/.local/bin (or ~/.cargo/bin on some setups)
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    if command -v uv >/dev/null 2>&1; then
        ok "uv installed: $(uv --version)"
    else
        err "uv install completed but binary not on PATH; you may need to restart your shell"
        info "Add to your shell rc: export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
fi

# Python 3.10+ (uv can install Python if missing)
if command -v python3 >/dev/null 2>&1; then
    PY_VER="$(python3 --version 2>&1 | awk '{print $2}')"
    PY_MAJOR="${PY_VER%%.*}"
    PY_MINOR="${PY_VER#*.}"; PY_MINOR="${PY_MINOR%%.*}"
    if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 10 ]; then
        ok "python3: $PY_VER"
    else
        warn "python3 $PY_VER is too old (need 3.10+); uv will install one for graphify"
    fi
else
    warn "python3 not found; uv will provision one for graphify"
fi

# jq (optional but useful for legacy paths; gfleet itself uses Node JSON)
command -v jq >/dev/null 2>&1 && ok "jq found (optional)" || c_dim "  jq not found (optional)"

say ""
hr

# ----- clone or pull -----
if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing install at $INSTALL_DIR..."
    git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
    git -C "$INSTALL_DIR" pull --quiet --ff-only origin "$BRANCH" || {
        warn "git pull failed (probably uncommitted local changes). Skipping update."
    }
    ok "repo updated"
else
    if [ -e "$INSTALL_DIR" ]; then
        err "$INSTALL_DIR exists but isn't a git repo. Move/remove it and re-run."
        exit 1
    fi
    info "Cloning $REPO_URL → $INSTALL_DIR..."
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    ok "repo cloned"
fi

# ----- npm install -----
say ""
info "Running npm install in $INSTALL_DIR..."
( cd "$INSTALL_DIR" && npm install --silent --no-audit --no-fund 2>&1 | tail -3 )
ok "node deps installed"

# ----- symlink onto PATH -----
mkdir -p "$BIN_DIR"
GFLEET_BIN_TARGET="$INSTALL_DIR/bin/gfleet"
GFLEET_BIN_LINK="$BIN_DIR/gfleet"

if [ -e "$GFLEET_BIN_LINK" ] && [ ! -L "$GFLEET_BIN_LINK" ]; then
    warn "$GFLEET_BIN_LINK exists and isn't a symlink. Leaving it alone."
elif [ -L "$GFLEET_BIN_LINK" ] && [ "$(readlink "$GFLEET_BIN_LINK")" = "$GFLEET_BIN_TARGET" ]; then
    ok "symlink already in place: $GFLEET_BIN_LINK"
else
    ln -sf "$GFLEET_BIN_TARGET" "$GFLEET_BIN_LINK"
    ok "symlinked: $GFLEET_BIN_LINK → $GFLEET_BIN_TARGET"
fi
chmod +x "$GFLEET_BIN_TARGET" 2>/dev/null || true

# ----- PATH check -----
case ":$PATH:" in
    *":$BIN_DIR:"*) ok "$BIN_DIR is already on PATH" ;;
    *)
        warn "$BIN_DIR is not on PATH"
        info "Add this to your shell rc (~/.zshrc, ~/.bashrc):"
        info ""
        info "  export PATH=\"$BIN_DIR:\$PATH\""
        info ""
        info "Then: source ~/.zshrc  (or open a new terminal)"
        ;;
esac

# ----- run doctor -----
say ""
hr
info "Running gfleet doctor..."
say ""
"$GFLEET_BIN_TARGET" doctor || true

# ----- next steps -----
say ""
hr
ok "graphify-fleet installed"
say ""
say "Next steps:"
say ""
say "  • First time setting up?  Run the wizard:"
say "      gfleet wizard"
say ""
say "  • Joining a team that already uses gfleet?"
say "      cd <some-cloned-repo>"
say "      gfleet onboard"
say ""
say "  • Update later:"
say "      curl -fsSL https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.sh | bash"
say "      (the script handles updates idempotently)"
say ""
say "Docs: $INSTALL_DIR/README.md"
